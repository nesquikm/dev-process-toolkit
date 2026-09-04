// stack_layout — the ONE marker table the toolkit reads a project's shape out of.
//
// STE-547. Before this module, two surfaces each carried half the knowledge and
// neither could see the other's half:
//
//   * `capture_skip_baseline.ts` knew which marker file means which TEST RUNNER
//     (`pubspec.yaml` → `flutter test`), but nothing about where source and test
//     files live.
//   * `pre-commit-tdd-orchestrator.ts` knew a set of PATH REGEXES (`^src/`,
//     `__tests__/`, `.(test|spec).(ts|tsx|js)`) and nothing about stacks — so a
//     Dart, Python, Kotlin or Go commit staging a source file AND its test
//     classified as `no-fr`, the same verdict as a commit with nothing to guard.
//
// One entry per marker, ordered most specific first, carrying BOTH halves:
// `gate` (the runner, or `null` for a stack this repo parses no count out of)
// and `layout` (where sources and tests live). A gate-less entry is still a
// recognised LAYOUT — the gate scan skips past it, the path classifier does not.
//
// The layout is deliberately data, not code: `buildLayoutPredicates` is the only
// place a path is matched, so emptying an entry's `layout` is a falsifiable
// mutation that flips exactly that stack's recognition off (AC-STE-547.6).

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Stack } from "./test_count_parser";

/** The gate to run for a stack, and how to read its output. */
export interface GateInvocation {
  /** Which runner's output shape `parseTestOutput` should be told to read. */
  readonly stack: Stack;
  /** argv of the gate command, run with the project root as its cwd. */
  readonly command: readonly string[];
}

/**
 * Where one stack keeps its source and test files.
 *
 * `sourceDirs` / `testDirs` are directory prefixes matched as whole path
 * segments anywhere in the path (`src/main/` matches `src/main/kotlin/X.kt`).
 * An EMPTY `sourceDirs` means "any directory" — Go keeps sources at the repo
 * root — and is not the same as an empty `sourceExtensions`, which recognises
 * nothing at all.
 *
 * Everything under a `testDirs` entry is a test whatever its extension — a
 * fixture, a README or a note in the test tree is test material. `testGlobs`
 * are `**`/`*` globs matched against the whole path, and are what recognises a
 * test file living OUTSIDE a test directory.
 */
export interface StackPathLayout {
  readonly sourceDirs: readonly string[];
  readonly sourceExtensions: readonly string[];
  readonly testDirs: readonly string[];
  readonly testGlobs: readonly string[];
}

/** One recognised project shape: its marker, its runner, and its layout. */
export interface StackLayoutEntry {
  /** The file whose presence at the project root identifies this stack. */
  readonly marker: string;
  /** Stable id — equal to `gate.stack` whenever a gate is defined. */
  readonly id: string;
  /** The gate to run, or `null` when this repo can parse no count out of it. */
  readonly gate: GateInvocation | null;
  readonly layout: StackPathLayout;
}

// A stack that answers to MORE THAN ONE marker gets ONE rule, named here and
// referenced by each of its markers. Two markers of the same stack disagreeing
// about where that stack keeps its tests is not a state worth being able to
// represent: `pytest.ini` and `pyproject.toml` are two spellings of one project
// shape, as are `build.gradle.kts` and `build.gradle`. Single-marker stacks stay
// inline — hoisting a constant used once buys nothing and costs a hop.

const PYTEST_GATE: GateInvocation = {
  stack: "pytest",
  command: ["python3", "-m", "pytest"],
};

const PYTEST_LAYOUT: StackPathLayout = {
  sourceDirs: ["src/"],
  sourceExtensions: [".py"],
  testDirs: ["tests/", "test/"],
  testGlobs: ["**/test_*.py", "**/*_test.py"],
};

const KOTLIN_LAYOUT: StackPathLayout = {
  sourceDirs: ["src/main/"],
  sourceExtensions: [".kt", ".kts", ".java"],
  testDirs: ["src/test/"],
  testGlobs: ["**/*Test.kt", "**/*Tests.kt", "**/*Test.java"],
};

/**
 * Marker file → stack. Ordered MOST SPECIFIC FIRST: a Flutter package carries a
 * `pubspec.yaml` and nothing else here, a Python project can carry either of two
 * markers, and `package.json` is the broadest of the gated three — so it stays
 * ahead of the gate-less JVM/Go entries, and a project carrying both a
 * `package.json` and a `build.gradle.kts` keeps its bun gate.
 */
export const STACK_LAYOUTS: ReadonlyArray<StackLayoutEntry> = [
  {
    marker: "pubspec.yaml",
    id: "flutter",
    gate: { stack: "flutter", command: ["flutter", "test"] },
    layout: {
      sourceDirs: ["lib/"],
      sourceExtensions: [".dart"],
      testDirs: ["test/", "integration_test/"],
      testGlobs: ["**/*_test.dart"],
    },
  },
  {
    marker: "pyproject.toml",
    id: "pytest",
    gate: PYTEST_GATE,
    layout: PYTEST_LAYOUT,
  },
  {
    marker: "pytest.ini",
    id: "pytest",
    gate: PYTEST_GATE,
    layout: PYTEST_LAYOUT,
  },
  {
    marker: "package.json",
    id: "bun",
    gate: { stack: "bun", command: ["bun", "test"] },
    layout: {
      sourceDirs: ["src/"],
      sourceExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      testDirs: ["__tests__/", "tests/"],
      testGlobs: ["**/*.test.*", "**/*.spec.*"],
    },
  },
  {
    marker: "build.gradle.kts",
    id: "kotlin",
    gate: null,
    layout: KOTLIN_LAYOUT,
  },
  {
    marker: "build.gradle",
    id: "kotlin",
    gate: null,
    layout: KOTLIN_LAYOUT,
  },
  {
    marker: "go.mod",
    id: "go",
    gate: null,
    layout: {
      sourceDirs: [],
      sourceExtensions: [".go"],
      testDirs: [],
      testGlobs: ["**/*_test.go"],
    },
  },
];

// STE-548 retired the "layout assumed when NO marker resolves" constant that
// stood here. There is no such layout any more: a project no marker resolves for
// is not silently read as a TypeScript one, it is reported as unidentified. What
// stood here was also a SECOND divergent TypeScript layout beside the
// `package.json` entry above — three extensions and one test directory against
// six and two — which is the private copy M142 exists to end.

/** Path predicates derived from one layout. */
export interface LayoutPredicates {
  readonly isSource: (path: string) => boolean;
  readonly isTest: (path: string) => boolean;
}

const escapeRegExp = (s: string): string =>
  s.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");

/** `lib/`, `./lib` and `lib` all name the same directory. */
const normalizeDir = (dir: string): string =>
  dir.replace(/^\.\//, "").replace(/\/+$/, "");

/** Glob → anchored RegExp: a double star crosses directories, a single one does not. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?"; // `**/` — zero or more leading segments
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else {
      out += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

/** Matches `dir` as a whole path segment prefix anywhere in the path. */
const dirToRegExp = (dir: string): RegExp =>
  new RegExp(`(^|/)${escapeRegExp(normalizeDir(dir))}/`);

/**
 * Build the `{ isSource, isTest }` pair for one layout.
 *
 * The ONLY place a staged path is matched against a stack's conventions. An
 * empty layout recognises nothing — which is exactly what makes "empty this
 * stack's rule and watch its fixture fall back to `no-fr`" a real mutation
 * rather than a re-implementation of the predicate under test.
 */
export function buildLayoutPredicates(
  layout: StackPathLayout,
): LayoutPredicates {
  const sourceDirRes = layout.sourceDirs.map(dirToRegExp);
  const testDirRes = layout.testDirs.map(dirToRegExp);
  const testGlobRes = layout.testGlobs.map(globToRegExp);
  const extensions = layout.sourceExtensions;

  const hasKnownExtension = (path: string): boolean =>
    extensions.some((ext) => path.endsWith(ext));

  const isSource = (path: string): boolean => {
    if (!hasKnownExtension(path)) return false;
    // No source dirs declared means "anywhere" (Go keeps sources at the root),
    // which is why the extension list — never this list — is the kill switch.
    if (sourceDirRes.length === 0) return true;
    return sourceDirRes.some((re) => re.test(path));
  };

  const isTest = (path: string): boolean => {
    // Outside a test directory, the naming convention is the only signal, so the
    // globs are what recognise a test there.
    if (testGlobRes.some((re) => re.test(path))) return true;
    // INSIDE the stack's test tree, everything is test material: a fixture, a
    // README or a note living there is as much a part of the suite as the
    // `.ts` beside it. Demanding a source extension here would drop exactly
    // those files out of the guard.
    return testDirRes.some((re) => re.test(path));
  };

  return { isSource, isTest };
}

/** The first entry whose marker file exists directly in `projectRoot`, else null. */
export function detectStackLayout(projectRoot: string): StackLayoutEntry | null {
  for (const entry of STACK_LAYOUTS) {
    if (existsSync(join(projectRoot, entry.marker))) {
      return entry;
    }
  }
  return null;
}

/**
 * Walk up from `startDir` to the first directory carrying a recognised marker.
 *
 * Stops at a `.git` checkout root — a repository with no marker of its own is an
 * unrecognised project, not an invitation to inherit its parent's stack.
 */
export function resolveStackLayout(startDir: string): StackLayoutEntry | null {
  let dir = resolve(startDir);
  for (;;) {
    const entry = detectStackLayout(dir);
    if (entry !== null) return entry;
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

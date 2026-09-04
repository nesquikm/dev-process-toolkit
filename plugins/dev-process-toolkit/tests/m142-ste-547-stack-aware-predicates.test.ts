// M142 / STE-547 — the TDD hook's path predicates derive from the detected stack.
//
// The shipped guard recognises exactly one project layout: `^src/`, `__tests__/`,
// and `.(test|spec).(ts|tsx|js)`. Measured on this tree, a Dart, Python, Kotlin or
// Go commit carrying a source file AND its test classifies as `no-fr` — the same
// verdict as a commit with nothing to guard. These tests hold the implementation
// to the design recorded in `specs/plan/M142.md` § "Measured before implementation":
//
//   * ONE marker table lives in `adapters/_shared/src/stack_layout.ts`. Each entry
//     is `{ marker, id, gate, layout }`, where `gate` is a `{ stack, command }`
//     GateInvocation or `null` for a stack this repo can parse no count out of, and
//     `layout` is `{ sourceDirs, sourceExtensions, testDirs, testGlobs }`.
//   * The module exports `detectStackLayout(projectRoot)` (first entry whose marker
//     exists, else null) and `buildLayoutPredicates(layout)` → `{ isSource, isTest }`.
//   * `capture_skip_baseline.ts` imports that table. `detectGate` stays DEFINED there
//     and still returns exactly `{ stack, command }`, scanning past gate-less entries.
//   * The hook's `classifyStagedPaths(paths, projectRoot?)` gains an OPTIONAL second
//     parameter (default: walk up from cwd to the first stack marker or `.git`), and
//     exposes `classifyStagedPathsForEntry(paths, entry | null)` — the same code path,
//     with the resolved table entry injected, so the AC.6 mutation exercises the real
//     predicate builder rather than a copy of it.
//
// STE-547 SCOPE ONLY: when no marker resolves, the classifier keeps today's fold to
// `no-fr`. The distinct fourth verdict for "could not tell" is STE-548 and is neither
// written nor asserted here.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as hook from "../templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator";
import * as skipBaseline from "../adapters/_shared/src/capture_skip_baseline";

const STACK_LAYOUT_MODULE = "../adapters/_shared/src/stack_layout";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const HOOKS_REFERENCE = join(PLUGIN_ROOT, "docs", "hooks-reference.md");
const SHIPPED_TEST_FILE = join(
  import.meta.dir,
  "pre-commit-tdd-orchestrator.test.ts",
);

// --------------------------------------------------------------------------
// Loaders — dynamic so a missing module fails THIS test with a named reason
// rather than collapsing every AC leg into one module-resolution error.
// --------------------------------------------------------------------------

async function loadStackLayout(): Promise<any> {
  return await import(STACK_LAYOUT_MODULE);
}

function classifyForEntry(paths: string[], entry: any): string {
  const fn = (hook as any).classifyStagedPathsForEntry;
  if (typeof fn !== "function") {
    throw new Error(
      "pre-commit-tdd-orchestrator must export classifyStagedPathsForEntry(paths, entry|null)",
    );
  }
  return fn(paths, entry);
}

function classifyIn(paths: string[], projectRoot: string): string {
  return (hook.classifyStagedPaths as any)(paths, projectRoot);
}

/** A throwaway project root carrying exactly the given marker files. */
function fixtureRoot(label: string, markers: string[]): string {
  const root = mkdtempSync(join(tmpdir(), `ste-547-${label}-`));
  for (const marker of markers) {
    const full = join(root, marker);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

const EMPTY_LAYOUT = {
  sourceDirs: [] as string[],
  sourceExtensions: [] as string[],
  testDirs: [] as string[],
  testGlobs: [] as string[],
};

/** `lib/` and `lib` are the same directory; compare them as the same token. */
const normalizeDir = (d: string): string =>
  d.replace(/^\.\//, "").replace(/\/+$/, "");

// ===========================================================================
// AC-STE-547.1 — a source-plus-test staged set requires the run on every stack
// the toolkit ships an example configuration for. Asserted per stack, never as
// a group, so a stack that regresses names itself in the failure.
// ===========================================================================

describe("AC-STE-547.1 — source + its test requires /tdd, per stack", () => {
  test("Dart/Flutter: lib/counter.dart + test/counter_test.dart → tdd-required", () => {
    const root = fixtureRoot("flutter", ["pubspec.yaml"]);
    expect(
      classifyIn(["lib/counter.dart", "test/counter_test.dart"], root),
    ).toBe("tdd-required");
  });

  test("Python/pytest: src/counter.py + tests/test_counter.py → tdd-required", () => {
    const root = fixtureRoot("pytest", ["pyproject.toml"]);
    expect(classifyIn(["src/counter.py", "tests/test_counter.py"], root)).toBe(
      "tdd-required",
    );
  });

  test("Kotlin: src/main/kotlin/Counter.kt + src/test/kotlin/CounterTest.kt → tdd-required", () => {
    const root = fixtureRoot("kotlin", ["build.gradle.kts"]);
    expect(
      classifyIn(
        ["src/main/kotlin/Counter.kt", "src/test/kotlin/CounterTest.kt"],
        root,
      ),
    ).toBe("tdd-required");
  });

  test("Go: counter.go + counter_test.go → tdd-required", () => {
    const root = fixtureRoot("go", ["go.mod"]);
    expect(classifyIn(["counter.go", "counter_test.go"], root)).toBe(
      "tdd-required",
    );
  });

  test("TypeScript/bun: src/counter.ts + src/counter.test.ts → tdd-required", () => {
    const root = fixtureRoot("bun", ["package.json"]);
    expect(classifyIn(["src/counter.ts", "src/counter.test.ts"], root)).toBe(
      "tdd-required",
    );
  });

  test("a recognised stack with NO test staged still classifies no-fr", () => {
    // The rule is the stack's test convention, not "any file in a known stack".
    const root = fixtureRoot("flutter-srconly", ["pubspec.yaml"]);
    expect(classifyIn(["lib/counter.dart", "lib/widget.dart"], root)).toBe(
      "no-fr",
    );
  });
});

// ===========================================================================
// AC-STE-547.2 — one shared marker table, not a second copy inside the hook.
// One fixture per recognised marker; the hook's resolved stack and the gate
// detector's answer must agree, and detectGate must keep its exact shape.
// ===========================================================================

const MARKER_FIXTURES: ReadonlyArray<{
  marker: string;
  id: string;
  gated: boolean;
}> = [
  { marker: "pubspec.yaml", id: "flutter", gated: true },
  { marker: "pyproject.toml", id: "pytest", gated: true },
  { marker: "pytest.ini", id: "pytest", gated: true },
  { marker: "package.json", id: "bun", gated: true },
  { marker: "build.gradle.kts", id: "kotlin", gated: false },
  { marker: "build.gradle", id: "kotlin", gated: false },
  { marker: "go.mod", id: "go", gated: false },
];

describe("AC-STE-547.2 — hook stack === gate-detector stack, one fixture per marker", () => {
  for (const fixture of MARKER_FIXTURES) {
    test(`marker ${fixture.marker} → stack "${fixture.id}", hook and detectGate agree`, async () => {
      const { detectStackLayout } = await loadStackLayout();
      const root = fixtureRoot(
        fixture.marker.replace(/[^a-z0-9]/gi, "-"),
        [fixture.marker],
      );

      const entry = detectStackLayout(root);
      expect(entry).not.toBeNull();
      expect(entry.marker).toBe(fixture.marker);
      expect(entry.id).toBe(fixture.id);

      const gate = skipBaseline.detectGate(root);
      if (fixture.gated) {
        expect(entry.gate).not.toBeNull();
        // The hook's stack IS the gate detector's stack — same table, one answer.
        expect(gate).not.toBeNull();
        expect(gate!.stack).toBe(entry.id);
        expect(gate).toEqual(entry.gate);
        // detectGate still returns exactly `{ stack, command }` — nothing else.
        expect(Object.keys(gate as object).sort()).toEqual([
          "command",
          "stack",
        ]);
      } else {
        // A gate-less entry is still a recognised LAYOUT; the gate scan skips it.
        expect(entry.gate).toBeNull();
        expect(gate).toBeNull();
      }
    });
  }

  test("precedence: a project carrying package.json AND build.gradle.kts keeps the bun gate", async () => {
    // The measured regression this pins: an entry placed by specificity ahead of
    // `package.json` must not turn detectGate's answer from the bun command to null.
    const { detectStackLayout } = await loadStackLayout();
    const root = fixtureRoot("dual", ["package.json", "build.gradle.kts"]);

    expect(skipBaseline.detectGate(root)).toEqual({
      stack: "bun",
      command: ["bun", "test"],
    });

    // Layout resolution picks the `package.json` entry SPECIFICALLY — not merely
    // "one of the markers the project carries". A `toContain` over both markers,
    // guarded by `if (entry.gate !== null)`, stays green while resolution returns
    // the KOTLIN entry and the hook applies `src/main/` + `*Test.kt` rules to a
    // TypeScript repo. Assert the resolved entry unconditionally.
    const entry = detectStackLayout(root);
    expect(entry).not.toBeNull();
    expect(entry.marker).toBe("package.json");
    expect(entry.id).toBe("bun");
    expect(entry.gate).toEqual(skipBaseline.detectGate(root));

    // ...and the layout resolution hands the classifier is the TypeScript one:
    // the bun pair fires, the Kotlin pair does not.
    expect(classifyIn(["src/counter.ts", "src/counter.test.ts"], root)).toBe(
      "tdd-required",
    );
    expect(
      classifyIn(
        ["src/main/kotlin/Counter.kt", "src/test/kotlin/CounterTest.kt"],
        root,
      ),
    ).toBe("no-fr");
  });

  test("the hook imports the shared table rather than keeping private path regexes", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    expect(Array.isArray(STACK_LAYOUTS)).toBe(true);
    expect(STACK_LAYOUTS.length).toBe(MARKER_FIXTURES.length);
    expect(STACK_LAYOUTS.map((e: any) => e.marker)).toEqual(
      MARKER_FIXTURES.map((f) => f.marker),
    );

    const hookSource = readFileSync(
      join(
        PLUGIN_ROOT,
        "templates",
        "hooks",
        "_lib",
        "hooks",
        "pre-commit-tdd-orchestrator.ts",
      ),
      "utf8",
    );
    expect(hookSource).toContain("stack_layout");
    // No private copy of the layout knowledge left behind in the hook.
    expect(hookSource).not.toContain("const SRC_RE");
    expect(hookSource).not.toContain("const TESTS_DIR_RE");
    expect(hookSource).not.toContain("const TEST_SUFFIX_RE");

    // The skip ratchet reads the same one table.
    const captureSource = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "capture_skip_baseline.ts"),
      "utf8",
    );
    expect(captureSource).toContain("stack_layout");
    expect(captureSource).toContain("detectGate(");
  });
});

// ===========================================================================
// AC-STE-547.3 — the documented trigger and the implemented predicates name the
// same directories, asserted from BOTH sides so neither can drift alone.
//
// Contract: the `### pre-commit-tdd-orchestrator` section's `- **Requirement:**`
// bullet names every directory in the shipped table, as a backticked token with a
// trailing slash (e.g. `lib/`, `src/main/`), and names no directory the table does
// not carry. `specs/frs/<id>.md` and other non-directory backticked tokens are
// ignored — only trailing-slash tokens are read as directory names.
// ===========================================================================

function requirementBullet(): string {
  const doc = readFileSync(HOOKS_REFERENCE, "utf8");
  const sectionStart = doc.indexOf("### pre-commit-tdd-orchestrator");
  expect(sectionStart).toBeGreaterThan(-1);
  const sectionEnd = doc.indexOf("\n### ", sectionStart + 1);
  const section = doc.slice(
    sectionStart,
    sectionEnd === -1 ? doc.length : sectionEnd,
  );
  const bullet = section
    .split("\n")
    .find((line) => line.startsWith("- **Requirement:**"));
  expect(bullet).toBeDefined();
  return bullet!;
}

function documentedTriggerDirs(): string[] {
  const bullet = requirementBullet();
  const dirs = new Set<string>();
  for (const match of bullet.matchAll(/`([^`]+)`/g)) {
    const token = match[1];
    if (/^[A-Za-z0-9_][A-Za-z0-9_.\-]*(\/[A-Za-z0-9_.\-]+)*\/$/.test(token)) {
      dirs.add(normalizeDir(token));
    }
  }
  return [...dirs].sort();
}

/**
 * Backticked tokens in the Requirement bullet that name a FILE convention rather
 * than a directory — `_test.go`, not `lib/`. `specs/frs/<id>.md`,
 * `Skill(/dev-process-toolkit:tdd)` and `tool_use` are excluded by shape.
 *
 * The directory equality above reads only trailing-slash tokens, and Go
 * contributes NO directory to the table — so without this the doc's Go clause is
 * asserted from neither side and can drift alone, which is the exact state
 * AC-STE-547.3 exists to end.
 */
function documentedTriggerFileTokens(): string[] {
  const bullet = requirementBullet();
  const tokens = new Set<string>();
  for (const match of bullet.matchAll(/`([^`]+)`/g)) {
    const token = match[1];
    if (/^[A-Za-z0-9_*][A-Za-z0-9_.*\-]*\.[A-Za-z0-9]+$/.test(token)) {
      tokens.add(token);
    }
  }
  return [...tokens].sort();
}

/** `**\/*_test.go` → `_test.go`: the file-convention token a glob asserts. */
const globSuffixToken = (glob: string): string =>
  glob.replace(/^\*\*\//, "").replace(/^\*/, "");

function tableDirs(layouts: any[]): string[] {
  const dirs = new Set<string>();
  for (const entry of layouts) {
    for (const dir of entry.layout.sourceDirs) dirs.add(normalizeDir(dir));
    for (const dir of entry.layout.testDirs) dirs.add(normalizeDir(dir));
  }
  return [...dirs].sort();
}

describe("AC-STE-547.3 — docs/hooks-reference.md and the code name the same directories", () => {
  test("the documented trigger names exactly the shipped table's directories", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    expect(documentedTriggerDirs()).toEqual(tableDirs(STACK_LAYOUTS));
  });

  test("doc → code: every directory the reference names is in the shipped table", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    const inTable = new Set(tableDirs(STACK_LAYOUTS));
    const undocumentedInCode = documentedTriggerDirs().filter(
      (d) => !inTable.has(d),
    );
    expect(undocumentedInCode).toEqual([]);
  });

  test("code → doc: every directory the shipped table carries is named in the reference", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    const documented = new Set(documentedTriggerDirs());
    const missingFromDoc = tableDirs(STACK_LAYOUTS).filter(
      (d) => !documented.has(d),
    );
    expect(missingFromDoc).toEqual([]);
  });

  test("the reference no longer names `tests/` as the sole test directory", () => {
    // The measured contradiction: the doc named a directory the code never matched.
    // Whichever way it is resolved, `tests/` alone can no longer be the whole story.
    expect(documentedTriggerDirs()).not.toEqual(["tests"]);
  });

  test("doc → code: the reference's Go file token is a glob the go entry carries", async () => {
    const { STACK_LAYOUTS, buildLayoutPredicates } = await loadStackLayout();
    const goEntry = STACK_LAYOUTS.find((e: any) => e.id === "go");
    expect(goEntry).toBeDefined();

    const goTokens = documentedTriggerFileTokens().filter((t) =>
      t.endsWith(".go"),
    );
    expect(goTokens.length).toBeGreaterThan(0);

    const { isTest } = buildLayoutPredicates(goEntry.layout);
    for (const token of goTokens) {
      expect(
        goEntry.layout.testGlobs.map(globSuffixToken).includes(token),
      ).toBe(true);
      // ...and the token the doc prints is one the shipped predicate acts on.
      expect(isTest(`pkg/counter${token}`)).toBe(true);
    }
  });

  test("code → doc: the go entry's testGlobs token is printed in the reference", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    const goEntry = STACK_LAYOUTS.find((e: any) => e.id === "go");
    const tokens = goEntry.layout.testGlobs.map(globSuffixToken);
    expect(tokens.length).toBeGreaterThan(0);

    const bullet = requirementBullet();
    for (const token of tokens) {
      // Rename the glob to `_spec.go` and this fails — the doc cannot drift alone
      // and neither can the table.
      expect(bullet).toContain(`\`${token}\``);
    }
  });

  test("code → doc: 'Go sources anywhere' is the go entry carrying no directory", async () => {
    const { STACK_LAYOUTS } = await loadStackLayout();
    const goEntry = STACK_LAYOUTS.find((e: any) => e.id === "go");
    // The clause the directory equality can never see: Go names no directory, so
    // "anywhere" is the assertion, and it is the emptiness of both dir lists.
    expect(requirementBullet()).toContain("Go sources anywhere");
    expect([...goEntry.layout.sourceDirs]).toEqual([]);
    expect([...goEntry.layout.testDirs]).toEqual([]);
    expect([...goEntry.layout.sourceExtensions]).toEqual([".go"]);
  });
});

// ===========================================================================
// AC-STE-547.4 — the currently-recognised TypeScript layout is unchanged. The
// shipped expectations run UNMODIFIED; this leg pins them rather than rewriting
// them, because a rewritten assertion would conceal exactly this regression.
// ===========================================================================

const SHIPPED_ASSERTION_PINS: ReadonlyArray<string> = [
  `expect(classifyStagedPaths(["specs/frs/STE-295.md"])).toBe("spec-only");`,
  `expect(classifyStagedPaths(["specs/plan/M70.md"])).toBe("spec-only");`,
  `expect(classifyStagedPaths(["src/foo.test.ts"])).toBe("tdd-required");`,
  `      classifyStagedPaths(["src/foo.ts", "src/foo.test.ts"]),\n    ).toBe("tdd-required");`,
  `      classifyStagedPaths(["packages/x/__tests__/foo.test.ts"]),\n    ).toBe("tdd-required");`,
  `expect(classifyStagedPaths(["README.md", "CHANGELOG.md"])).toBe("no-fr");`,
  `expect(classifyStagedPaths([])).toBe("no-fr");`,
];

describe("AC-STE-547.4 — the TypeScript layout's shipped expectations are untouched", () => {
  test("pre-commit-tdd-orchestrator.test.ts still carries exactly 18 assertions", () => {
    const source = readFileSync(SHIPPED_TEST_FILE, "utf8");
    expect(source.match(/expect\(/g)?.length ?? 0).toBe(18);
  });

  test("every shipped classifier expectation still reads byte-identically", () => {
    const source = readFileSync(SHIPPED_TEST_FILE, "utf8");
    const rewritten = SHIPPED_ASSERTION_PINS.filter(
      (pin) => !source.includes(pin),
    );
    expect(rewritten).toEqual([]);
  });

  test("the shipped integration exit-code expectations are unchanged (2 × exit 0, 3 × exit 2)", () => {
    const source = readFileSync(SHIPPED_TEST_FILE, "utf8");
    expect(source.match(/expect\(r\.exitCode\)\.toBe\(0\);/g)?.length ?? 0).toBe(
      2,
    );
    expect(source.match(/expect\(r\.exitCode\)\.toBe\(2\);/g)?.length ?? 0).toBe(
      3,
    );
  });

  test("classifyStagedPaths keeps its single-argument call signature working", () => {
    // The second parameter is OPTIONAL; the default root walk-up from the gate's
    // cwd (plugins/dev-process-toolkit, markerless) reaches the checkout root.
    expect(hook.classifyStagedPaths(["src/foo.test.ts"])).toBe("tdd-required");
    expect(hook.classifyStagedPaths(["specs/frs/STE-295.md"])).toBe(
      "spec-only",
    );
    expect(hook.classifyStagedPaths([])).toBe("no-fr");
  });

  test("the bun layout reproduces today's verdicts on the paths today's regexes matched", () => {
    const root = fixtureRoot("bun-parity", ["package.json"]);
    expect(classifyIn(["src/foo.test.ts"], root)).toBe("tdd-required");
    expect(classifyIn(["packages/x/__tests__/foo.test.ts"], root)).toBe(
      "tdd-required",
    );
    expect(classifyIn(["lib/thing.spec.js"], root)).toBe("tdd-required");
    expect(classifyIn(["app/widget.test.tsx"], root)).toBe("tdd-required");
    expect(classifyIn(["README.md", "CHANGELOG.md"], root)).toBe("no-fr");
    expect(classifyIn(["specs/frs/STE-295.md"], root)).toBe("spec-only");
    expect(classifyIn(["specs/frs/STE-295.md", "src/feature.ts"], root)).toBe(
      "tdd-required",
    );
  });

  test("an unrecognised project still folds to today's no-fr (STE-548 is a separate verdict)", () => {
    const root = fixtureRoot("markerless", []);
    expect(classifyIn(["counter.dart", "counter_test.dart"], root)).toBe(
      "no-fr",
    );
  });
});

// ===========================================================================
// AC-STE-547.4 (the PROPERTY, not the pins) — "the currently-recognised
// TypeScript layout is unchanged" is a statement about EVERY path, not about the
// handful the shipped file happens to name. The pins above prove the shipped
// assertions were not rewritten; they cannot prove a path nobody wrote an
// assertion for kept its verdict.
//
// So: the RETIRED predicates are transcribed verbatim below from
// `git show HEAD:…/pre-commit-tdd-orchestrator.ts` and differenced against the
// shipped classifier over a shared corpus, evaluated in a temp root carrying
// only `package.json` (the TypeScript stack, which is the layout this AC is
// about). NO path may NARROW — old `tdd-required` → new anything else.
//
// Exactly ONE narrowing is sanctioned, and it is named: `weird__tests__dir/x.ts`.
// The retired TRIGGER tested the SUBSTRING `p.includes("__tests__")` while the
// retired CARVE-OUT tested the segment-anchored `(^|\/)__tests__(\/|$)`, so the
// old code contradicted itself on that path — it required /tdd for a file it
// simultaneously declared not to be a source or test file. The new agreement on
// `no-fr` is deliberate, and a fix that restores the substring rule to make the
// difference vanish is a regression, not a repair.
// ===========================================================================

// --- verbatim transcription of the retired predicates (HEAD) ---------------
const RETIRED_FR_RE = /^specs\/frs\/.*\.md$/;
const RETIRED_TEST_SUFFIX_RE = /\.(test|spec)\.(ts|tsx|js)$/;

const RETIRED_SPEC_PATTERNS: RegExp[] = [
  /^specs\/frs\/[^/]+\.md$/, // specs/frs/*.md (excludes subdirs except archive below)
  /^specs\/frs\/archive\/[^/]+\.md$/, // specs/frs/archive/*.md
  /^specs\/plan\/M[^/]*\.md$/, // specs/plan/M*.md
  /^specs\/plan\/archive\/[^/]+\.md$/, // specs/plan/archive/*.md
  /^specs\/requirements\.md$/,
  /^specs\/technical-spec\.md$/,
  /^specs\/testing-spec\.md$/,
];

const RETIRED_SRC_RE = /^src\//;
const RETIRED_TESTS_DIR_RE = /(^|\/)__tests__(\/|$)/;

const retiredIsSpecPath = (p: string): boolean =>
  RETIRED_SPEC_PATTERNS.some((re) => re.test(p));

const retiredIsSrcOrTestPath = (p: string): boolean =>
  RETIRED_SRC_RE.test(p) ||
  RETIRED_TESTS_DIR_RE.test(p) ||
  RETIRED_TEST_SUFFIX_RE.test(p);

const retiredIsFrRelated = (p: string): boolean =>
  RETIRED_FR_RE.test(p) ||
  p.includes("__tests__") ||
  RETIRED_TEST_SUFFIX_RE.test(p);

function classifyRetired(paths: string[]): string {
  if (paths.length === 0) {
    return "no-fr";
  }
  const hasSrcOrTest = paths.some(retiredIsSrcOrTestPath);
  const allSpec = paths.every(retiredIsSpecPath);
  if (!hasSrcOrTest && allSpec) {
    return "spec-only";
  }
  if (paths.some(retiredIsFrRelated)) {
    return "tdd-required";
  }
  return "no-fr";
}
// --- end verbatim transcription --------------------------------------------

/** The one path where the retired code contradicted itself; see the note above. */
const SANCTIONED_NARROWING = "weird__tests__dir/x.ts";

const PARITY_CORPUS: ReadonlyArray<{ label: string; paths: string[] }> = [
  // Paths the retired __tests__ rules reached.
  { label: "__tests__/fixtures/data.json", paths: ["__tests__/fixtures/data.json"] },
  { label: "__tests__/README.md", paths: ["__tests__/README.md"] },
  { label: "__tests__/helper.ts", paths: ["__tests__/helper.ts"] },
  { label: "docs/__tests__/notes.txt", paths: ["docs/__tests__/notes.txt"] },
  {
    label: "packages/x/__tests__/foo.test.ts",
    paths: ["packages/x/__tests__/foo.test.ts"],
  },
  { label: SANCTIONED_NARROWING, paths: [SANCTIONED_NARROWING] },

  // Paths the retired suffix / src rules reached.
  { label: "src/foo.test.ts", paths: ["src/foo.test.ts"] },
  { label: "src/foo.ts", paths: ["src/foo.ts"] },
  { label: "tests/foo.test.ts", paths: ["tests/foo.test.ts"] },
  { label: "lib/thing.spec.js", paths: ["lib/thing.spec.js"] },
  { label: "app/widget.test.tsx", paths: ["app/widget.test.tsx"] },
  { label: ".placeholder.test.ts", paths: [".placeholder.test.ts"] },

  // Spec paths and non-code paths.
  { label: "specs/frs/STE-1.md", paths: ["specs/frs/STE-1.md"] },
  { label: "specs/plan/M70.md", paths: ["specs/plan/M70.md"] },
  { label: "specs/requirements.md", paths: ["specs/requirements.md"] },
  { label: "specs/frs/archive/STE-2.md", paths: ["specs/frs/archive/STE-2.md"] },
  { label: "README.md", paths: ["README.md"] },
  { label: "CHANGELOG.md", paths: ["CHANGELOG.md"] },

  // Mixed sets — the STE-290 semantics the carve-out must not swallow.
  {
    label: "mixed spec+src",
    paths: ["specs/frs/STE-1.md", "src/foo.ts"],
  },
  {
    label: "mixed spec+test",
    paths: ["specs/frs/STE-1.md", "src/foo.test.ts"],
  },
  {
    label: "mixed spec+__tests__ non-code",
    paths: ["specs/frs/STE-1.md", "__tests__/README.md"],
  },
  {
    label: "pure spec set",
    paths: ["specs/frs/STE-1.md", "specs/plan/M70.md"],
  },
  { label: "readme + test", paths: ["README.md", "src/foo.test.ts"] },
  { label: "empty set", paths: [] },
];

describe("AC-STE-547.4 — no TypeScript path narrows against the retired predicates", () => {
  const CORPUS_ROOT = fixtureRoot("ts-parity-corpus", ["package.json"]);

  const difference = () =>
    PARITY_CORPUS.map((c) => ({
      label: c.label,
      old: classifyRetired(c.paths),
      now: classifyIn(c.paths, CORPUS_ROOT),
    }));

  test("the retired reference implementation is live, not decorative", () => {
    // If the transcription stopped classifying, every "no narrowing" result
    // below would be vacuously clean. Pin its three verdicts first.
    expect(classifyRetired(["src/foo.test.ts"])).toBe("tdd-required");
    expect(classifyRetired(["specs/frs/STE-1.md"])).toBe("spec-only");
    expect(classifyRetired(["README.md"])).toBe("no-fr");
    expect(
      difference().filter((d) => d.old === "tdd-required").length,
    ).toBeGreaterThan(5);
  });

  test("no path the retired code required /tdd for now escapes it", () => {
    const narrowed = difference()
      .filter((d) => d.old === "tdd-required" && d.now !== "tdd-required")
      .filter((d) => d.label !== SANCTIONED_NARROWING)
      .map((d) => `${d.label}: tdd-required → ${d.now}`);
    expect(narrowed).toEqual([]);
  });

  test("no spec-only commit lost its carve-out", () => {
    const lost = difference()
      .filter((d) => d.old === "spec-only" && d.now !== "spec-only")
      .map((d) => `${d.label}: spec-only → ${d.now}`);
    expect(lost).toEqual([]);
  });

  test("the ONE sanctioned narrowing is the self-contradiction, and it is real", () => {
    // The retired trigger said "requires /tdd" (substring) while the retired
    // carve-out said "not a source or test file" (segment-anchored) about the
    // SAME path. The new code agrees with the carve-out half.
    expect(retiredIsFrRelated(SANCTIONED_NARROWING)).toBe(true);
    expect(retiredIsSrcOrTestPath(SANCTIONED_NARROWING)).toBe(false);
    expect(classifyRetired([SANCTIONED_NARROWING])).toBe("tdd-required");
    expect(classifyIn([SANCTIONED_NARROWING], CORPUS_ROOT)).toBe("no-fr");

    // The segment-anchored sibling still fires — the exception is the missing
    // slash, not the `__tests__` name.
    expect(classifyIn(["weird/__tests__/x.ts"], CORPUS_ROOT)).toBe(
      "tdd-required",
    );
  });
});

// ===========================================================================
// AC-STE-547.5 — the rule is the stack's own convention, not an extension list.
// A suffix outside the recognised `.(test|spec).(ts|tsx|js)` set still requires
// the run when the recognised stack's convention matches it.
// ===========================================================================

describe("AC-STE-547.5 — suffixes outside the recognised set fire on their own stack", () => {
  test("bun: a .test.mjs file (outside ts|tsx|js) → tdd-required", () => {
    const root = fixtureRoot("bun-mjs", ["package.json"]);
    expect(classifyIn(["src/util.mjs", "src/util.test.mjs"], root)).toBe(
      "tdd-required",
    );
  });

  test("bun: a .spec.cjs file (outside ts|tsx|js) → tdd-required", () => {
    const root = fixtureRoot("bun-cjs", ["package.json"]);
    expect(classifyIn(["src/util.cjs", "src/util.spec.cjs"], root)).toBe(
      "tdd-required",
    );
  });

  test("pytest: the *_test.py convention (no .test. segment at all) → tdd-required", () => {
    const root = fixtureRoot("pytest-suffix", ["pytest.ini"]);
    expect(classifyIn(["src/util.py", "tests/util_test.py"], root)).toBe(
      "tdd-required",
    );
  });

  test("kotlin: the *Tests.kt convention (no dot-delimited suffix) → tdd-required", () => {
    const root = fixtureRoot("kotlin-suffix", ["build.gradle"]);
    expect(
      classifyIn(
        ["src/main/kotlin/Util.kt", "src/test/kotlin/UtilTests.kt"],
        root,
      ),
    ).toBe("tdd-required");
  });

  test("flutter: the *_test.dart convention under integration_test/ → tdd-required", () => {
    const root = fixtureRoot("flutter-suffix", ["pubspec.yaml"]);
    expect(
      classifyIn(
        ["lib/app.dart", "integration_test/app_flow_test.dart"],
        root,
      ),
    ).toBe("tdd-required");
  });

  test("a stack's convention does not leak: a .dart test in a bun project stays no-fr", () => {
    const root = fixtureRoot("bun-nodart", ["package.json"]);
    expect(classifyIn(["lib/counter.dart", "test/counter_test.dart"], root)).toBe(
      "no-fr",
    );
  });
});

// ===========================================================================
// AC-STE-547.6 — each new stack's recognition is falsifiable by MUTATION: empty
// that stack's LAYOUT (leaving its marker entry standing) and its fixture must
// fall back from `tdd-required` to `no-fr`, then recover when restored.
//
// The mutation feeds the real classifier through the real predicate builder via
// `classifyStagedPathsForEntry`; nothing here re-implements a predicate.
// ===========================================================================

const MUTATION_CASES: ReadonlyArray<{
  id: string;
  marker: string;
  paths: string[];
}> = [
  {
    id: "flutter",
    marker: "pubspec.yaml",
    paths: ["lib/counter.dart", "test/counter_test.dart"],
  },
  {
    id: "pytest",
    marker: "pyproject.toml",
    paths: ["src/counter.py", "tests/test_counter.py"],
  },
  {
    id: "kotlin",
    marker: "build.gradle.kts",
    paths: ["src/main/kotlin/Counter.kt", "src/test/kotlin/CounterTest.kt"],
  },
  { id: "go", marker: "go.mod", paths: ["counter.go", "counter_test.go"] },
];

describe("AC-STE-547.6 — removing a stack's rule flips its fixture back to no-fr", () => {
  for (const mutation of MUTATION_CASES) {
    test(`${mutation.id}: emptied layout → no-fr; restored → tdd-required`, async () => {
      const { STACK_LAYOUTS } = await loadStackLayout();
      const entry = STACK_LAYOUTS.find((e: any) => e.id === mutation.id);
      expect(entry).toBeDefined();

      // The live rule recognises the fixture...
      expect(classifyForEntry(mutation.paths, entry)).toBe("tdd-required");

      // ...and the SAME code path stops recognising it once the layout is empty.
      // The mutation is IN PLACE on the shared table entry. A spread copy would
      // leave the original entry untouched, so the restore assertion below could
      // not fail no matter what "restore" did — it would re-read a value nothing
      // had ever written to.
      const originalLayout = entry.layout;
      try {
        entry.layout = { ...EMPTY_LAYOUT };
        // The marker entry stands — deleting it is STE-548's question, not this one.
        expect(entry.marker).toBe(mutation.marker);
        expect(entry.id).toBe(mutation.id);
        expect(classifyForEntry(mutation.paths, entry)).toBe("no-fr");
      } finally {
        entry.layout = originalLayout;
      }

      // Restore proof: the module's own table hands back the ORIGINAL layout
      // object, and the same entry recognises the fixture again. Skip the
      // restore and both of these fail.
      const { STACK_LAYOUTS: reread } = await loadStackLayout();
      const rereadEntry = reread.find((e: any) => e.id === mutation.id);
      expect(rereadEntry.layout).toBe(originalLayout);
      expect(classifyForEntry(mutation.paths, rereadEntry)).toBe(
        "tdd-required",
      );
    });

    test(`${mutation.id}: the mutation runs through the shipped predicate builder`, async () => {
      const { STACK_LAYOUTS, buildLayoutPredicates } = await loadStackLayout();
      expect(typeof buildLayoutPredicates).toBe("function");
      const entry = STACK_LAYOUTS.find((e: any) => e.id === mutation.id);

      const live = buildLayoutPredicates(entry.layout);
      const dead = buildLayoutPredicates({ ...EMPTY_LAYOUT });
      const [source, testPath] = mutation.paths;
      expect(live.isSource(source)).toBe(true);
      expect(live.isTest(testPath)).toBe(true);
      expect(dead.isSource(source)).toBe(false);
      expect(dead.isTest(testPath)).toBe(false);
    });
  }

  test("the entry-injected classifier is the same code path as the root-resolved one", async () => {
    const { detectStackLayout } = await loadStackLayout();
    for (const mutation of MUTATION_CASES) {
      const root = fixtureRoot(`same-path-${mutation.id}`, [mutation.marker]);
      expect(classifyForEntry(mutation.paths, detectStackLayout(root))).toBe(
        classifyIn(mutation.paths, root),
      );
    }
  });

  test("a null entry (no marker resolved) folds to no-fr, STE-547's scope boundary", () => {
    expect(classifyForEntry(["counter.dart", "counter_test.dart"], null)).toBe(
      "no-fr",
    );
    // FR markdown is stack-independent and keeps firing with no stack at all.
    expect(classifyForEntry(["specs/frs/STE-547.md"], null)).toBe("spec-only");
  });
});

// M142 / STE-548 — an unrecognised layout is a loud signal, not a silent pass.
//
// STE-547 decided what "recognised" means: `adapters/_shared/src/stack_layout.ts`
// carries one marker table, and `resolveStackLayout(root)` returns the matching
// entry or `null`. STE-547 deliberately left the `null` case folding to `no-fr`
// — the same verdict a commit with nothing to guard gets — and said so in its own
// test titles. This FR is that fold's removal.
//
// The design these tests hold the implementation to:
//
//   * `StagedClassification` gains a FOURTH member for the unidentifiable case,
//     distinct from `no-fr`. AC.6 asserts the MEMBER COUNT is four and that
//     `spec-only` is still among them: the matrix proves every fixture lands
//     somewhere, only the count proves nothing was quietly removed.
//   * `classifyStagedPaths` returns it when marker detection resolves NO stack.
//   * The exit path is ADVISORY: exit 0 plus a named NFR-10 line on stderr with
//     the "Reminder" verdict, never "Refusing" (AC.4).
//   * `FALLBACK_LAYOUT` becomes dead the moment the null-entry case returns the
//     new verdict before any layout predicate is consulted, and is DELETED — it
//     is a second divergent TypeScript layout beside the `package.json` entry,
//     which is the private copy this milestone exists to end.
//
// THE ONE THING THESE TESTS DO NOT PIN: the new member's spelling. Every leg
// below DERIVES it by running the shipped classifier against a markerless root,
// so the implementer picked the name rather than matching one chosen here.
//
// That freedom does NOT extend across the milestone. `tests/m142-ste-547-
// stack-aware-predicates.test.ts` now hard-codes the chosen literal in two
// places (its markerless-root leg and its null-entry leg), which is a stronger
// pin than deriving it — and the honest cost of renaming the member is those
// two edits. An earlier draft of this comment claimed nothing wrote that
// literal; it was true when written and false by the end of the same FR.
//
// ---------------------------------------------------------------------------
// CONSEQUENCE THE IMPLEMENTER MUST HANDLE, recorded here so it is not discovered
// as a mystery red at gate time.
//
// `tests/m142-ste-547-stack-aware-predicates.test.ts` carries TWO assertions
// that STE-547 wrote as explicit placeholders for this FR, and that this FR
// necessarily supersedes. Both name STE-548 in their own titles:
//
//   1. `test("an unrecognised project still folds to today's no-fr (STE-548 is
//      a separate verdict)")` — `classifyIn(["counter.dart", "counter_test.dart"],
//      markerlessRoot)` expects `"no-fr"`.
//   2. `test("a null entry (no marker resolved) folds to no-fr, STE-547's scope
//      boundary")` — its FIRST assertion,
//      `classifyForEntry(["counter.dart", "counter_test.dart"], null)` expects
//      `"no-fr"`.
//
// Both must move to the new member. The SECOND assertion of (2),
// `classifyForEntry(["specs/frs/STE-547.md"], null)` → `"spec-only"`, must stay
// byte-identical — see the AC.6 section below on why `spec-only` survives with
// no stack resolved.
//
// The AC-STE-547.4 pins (assertion count 18, the literal expectation strings,
// 2 × exit 0 / 3 × exit 2) all read `tests/pre-commit-tdd-orchestrator.test.ts`,
// NOT the file above, and are untouched by any of this.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as hook from "../templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator";
import * as stackLayout from "../adapters/_shared/src/stack_layout";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "_lib",
  "hooks",
  "pre-commit-tdd-orchestrator.ts",
);
const STACK_LAYOUT_PATH = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "stack_layout.ts",
);

/** A parseable `package.json` — these fixture roots are also `bun run` cwds. */
const PKG_JSON = '{"name":"m142-fixture","version":"0.0.0","private":true}\n';

/** The three verdicts that shipped before this FR. */
const PRE_EXISTING: ReadonlyArray<string> = [
  "spec-only",
  "tdd-required",
  "no-fr",
];

// ---------------------------------------------------------------------------
// Fixture roots and the classifier front door.
// ---------------------------------------------------------------------------

/** A throwaway project root carrying exactly the given marker files. */
function fixtureRoot(label: string, markers: string[]): string {
  const root = mkdtempSync(join(tmpdir(), `ste-548-${label}-`));
  for (const marker of markers) {
    const full = join(root, marker);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, marker === "package.json" ? PKG_JSON : "");
  }
  return root;
}

function classifyIn(paths: string[], projectRoot: string): string {
  return (hook.classifyStagedPaths as any)(paths, projectRoot);
}

/**
 * The new member, DERIVED rather than spelled.
 *
 * A markerless root plus a staged set carrying nothing to guard is the exact
 * pair AC.1 contrasts, so whatever comes back here IS the "cannot tell" verdict
 * — and while the fold is still in place it comes back `"no-fr"`, which is what
 * makes every leg below RED before the implementation lands.
 */
function unrecognisedVerdict(): string {
  return classifyIn(
    ["README.md", "CHANGELOG.md"],
    fixtureRoot("derive", []),
  );
}

/** The members of the `StagedClassification` union, read off the declaration. */
function declaredMembers(): string[] {
  const source = readFileSync(MODULE_PATH, "utf8");
  const decl = source.match(
    /export\s+type\s+StagedClassification\s*=([\s\S]*?);/,
  );
  if (!decl) {
    throw new Error(
      "pre-commit-tdd-orchestrator.ts must declare `export type StagedClassification = ...;`",
    );
  }
  return [...decl[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// ===========================================================================
// AC-STE-548.1 — an unidentifiable stack produces an outcome distinct from the
// one produced by a staged set that carries nothing to guard. The two fixtures
// differ ONLY in recognisability; either one alone proves nothing.
// ===========================================================================

describe("AC-STE-548.1 — 'could not tell' is not 'nothing to guard'", () => {
  test("the same staged set resolves differently either side of a stack marker", () => {
    const recognised = fixtureRoot("ac1-recognised", ["package.json"]);
    const unrecognised = fixtureRoot("ac1-unrecognised", []);
    const staged = ["README.md", "CHANGELOG.md"];

    const withStack = classifyIn(staged, recognised);
    const withoutStack = classifyIn(staged, unrecognised);

    // The recognised side is the pre-existing quiet verdict, unchanged.
    expect(withStack).toBe("no-fr");
    // The unrecognised side is a DIFFERENT outcome. This is the whole FR.
    expect(withoutStack).not.toBe("no-fr");
    expect(withoutStack).not.toBe(withStack);
  });

  test("the pair differs only in recognisability — nothing else about the roots", () => {
    const recognised = fixtureRoot("ac1-only-recognised", ["package.json"]);
    const unrecognised = fixtureRoot("ac1-only-unrecognised", []);
    // If the two roots differed in anything but the marker, the assertion above
    // would be measuring that difference instead.
    expect(readdirSync(recognised).sort()).toEqual(["package.json"]);
    expect(readdirSync(unrecognised).sort()).toEqual([]);
  });

  test("the new verdict is a genuinely new member, not one of the shipped three", () => {
    const verdict = unrecognisedVerdict();
    expect(PRE_EXISTING).not.toContain(verdict);
    expect(typeof verdict).toBe("string");
    expect(verdict.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Integration harness — spawn the real hook against temp git repos, so AC.2 and
// AC.4 are matched on emitted bytes and a real exit status rather than on a
// format string or a classifier return value.
// ===========================================================================

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Fixture {
  tmpRoot: string;
  repoDir: string;
  /** `<mkdtemp basename>/repo` — unique per run and free of `/private` drift. */
  uniqueTail: string;
  transcript: string;
}

async function makeRepo(
  label: string,
  files: Record<string, string>,
  markers: string[],
): Promise<Fixture> {
  const tmpRoot = mkdtempSync(join(tmpdir(), `ste-548-${label}-`));
  const repoDir = join(tmpRoot, "repo");
  mkdirSync(repoDir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repoDir], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  await Bun.spawn([
    "git",
    "-C",
    repoDir,
    "config",
    "user.email",
    "test@example.com",
  ]).exited;
  await Bun.spawn(["git", "-C", repoDir, "config", "user.name", "Test"]).exited;

  // Markers are written but NEVER staged: staging one would change the staged
  // set the classifier is being asked about.
  for (const marker of markers) {
    writeFileSync(
      join(repoDir, marker),
      marker === "package.json" ? PKG_JSON : "",
    );
  }
  for (const [rel, body] of Object.entries(files)) {
    const full = join(repoDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", repoDir, "add", rel]).exited;
  }

  const transcript = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({
      type: "tool_use",
      name: "Bash",
      input: { command: "ls" },
    }) + "\n",
  );

  return {
    tmpRoot,
    repoDir,
    uniqueTail: join(basename(tmpRoot), "repo"),
    transcript,
  };
}

async function runHook(fixture: Fixture): Promise<RunResult> {
  const stdin = JSON.stringify({
    session_id: "s1",
    transcript_path: fixture.transcript,
    cwd: fixture.repoDir,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git commit -m 'feat: add counter'" },
  });
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: fixture.repoDir,
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

const SRC_AND_TEST: Record<string, string> = {
  "src/counter.ts": "export const counter = () => 1;\n",
  "src/counter.test.ts": "// a test\n",
};

// ===========================================================================
// AC-STE-548.2 — the outcome names its reason where the operator reads it:
// WHICH project, and that NO stack was identified. Matched on the real emitted
// stderr of a spawned hook, so a renamed field fails here rather than silently
// later.
// ===========================================================================

describe("AC-STE-548.2 — the reason is named in the text the operator reads", () => {
  test("stderr names the project whose stack could not be identified", async () => {
    const fx = await makeRepo("ac2", SRC_AND_TEST, []);
    const r = await runHook(fx);

    // Not a bare status: something was actually written.
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    // WHICH project — the real path, not a placeholder. `uniqueTail` is this
    // run's own mkdtemp name, so a hard-coded string cannot satisfy it, and it
    // survives macOS's /var → /private/var realpath drift.
    expect(r.stderr).toContain(fx.uniqueTail);
    // ...and that NO stack was identified.
    expect(r.stderr).toMatch(/stack/i);
    expect(r.stderr).toMatch(/no|not|unrecognis|unidentif|unknown/i);
  });

  test("the line follows the house NFR-10 shape with the Reminder verdict", async () => {
    const fx = await makeRepo("ac2-shape", SRC_AND_TEST, []);
    const r = await runHook(fx);

    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context: mode=hook, ticket=unbound, skill=");
    expect(r.stderr).toContain("hook=pre-commit-tdd-orchestrator");
  });

  test("a recognised project staging the same files emits no such line", async () => {
    // The control: without it, a hook that printed the reminder unconditionally
    // would pass the two tests above.
    const fx = await makeRepo("ac2-control", SRC_AND_TEST, ["package.json"]);
    const r = await runHook(fx);
    expect(r.stderr).not.toContain("Reminder:");
  });
});

// ===========================================================================
// AC-STE-548.3 — a project whose stack IS identified but whose staged set
// genuinely carries no source-and-test pair keeps today's quiet outcome. The new
// signal reports inability to look, never absence of anything to see.
// ===========================================================================

describe("AC-STE-548.3 — a recognised stack with nothing to guard stays quiet", () => {
  test("recognised + no source-and-test pair → no-fr, with its positive control", () => {
    const root = fixtureRoot("ac3", ["package.json"]);

    // A source file with no test beside it: nothing to guard, quietly.
    expect(classifyIn(["src/counter.ts"], root)).toBe("no-fr");

    // POSITIVE CONTROL, same fixture. Without it this leg passes on a classifier
    // that answers `no-fr` to everything a recognised stack is asked.
    expect(classifyIn(["src/counter.ts", "src/counter.test.ts"], root)).toBe(
      "tdd-required",
    );
  });

  test("the SAME staged set on an unrecognisable project does not answer no-fr", () => {
    // Inability to look, not absence of anything to see: identical paths, and
    // only the marker's presence decides which of the two answers comes back.
    const recognised = fixtureRoot("ac3-recognised", ["package.json"]);
    const unrecognised = fixtureRoot("ac3-unrecognised", []);
    expect(classifyIn(["src/counter.ts"], recognised)).toBe("no-fr");
    expect(classifyIn(["src/counter.ts"], unrecognised)).not.toBe("no-fr");
    expect(classifyIn(["src/counter.ts"], unrecognised)).toBe(
      unrecognisedVerdict(),
    );
  });

  test("integration: a recognised project with nothing to guard exits 0 in silence", async () => {
    const fx = await makeRepo(
      "ac3-quiet",
      { "README.md": "# readme\n", "CHANGELOG.md": "# changelog\n" },
      ["package.json"],
    );
    const r = await runHook(fx);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.trim()).toBe("");
  });
});

// ===========================================================================
// AC-STE-548.4 — the signal is not a refusal. A commit is not blocked because
// the toolkit does not know the stack.
// ===========================================================================

describe("AC-STE-548.4 — advisory, never a refusal", () => {
  test("an unidentifiable project with src+test staged and no /tdd evidence exits 0", async () => {
    const fx = await makeRepo("ac4", SRC_AND_TEST, []);
    const r = await runHook(fx);
    expect(r.exitCode).toBe(0);
    expect(r.exitCode).not.toBe(2);
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("the same staged set on a recognised project IS refused (the fixture is real)", async () => {
    // Without this control the test above is satisfied by a hook that never
    // refuses anything, which would prove nothing about the ignorance path.
    const fx = await makeRepo("ac4-control", SRC_AND_TEST, ["package.json"]);
    const r = await runHook(fx);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });
});

// ===========================================================================
// AC-STE-548.5 — falsifiability. Collapsing the new outcome back onto `no-fr`
// turns AC.1's pair green, which is the state this FR exists to make impossible.
//
// Two mutations, because each covers the other's blind spot: the first is a
// pure-logic collapse over the shipped classifier's OUTPUT, the second rewrites
// the shipped module's own bytes and re-imports it.
// ===========================================================================

const AC1_PAIR_PATHS = ["README.md", "CHANGELOG.md"];

describe("AC-STE-548.5 — the distinction can fail", () => {
  test("mapping the new member onto no-fr makes AC.1's pair stop differing", () => {
    const recognised = fixtureRoot("ac5-recognised", ["package.json"]);
    const unrecognised = fixtureRoot("ac5-unrecognised", []);
    const collapse = (v: string): string =>
      v === unrecognisedVerdict() ? "no-fr" : v;

    const live = [
      classifyIn(AC1_PAIR_PATHS, recognised),
      classifyIn(AC1_PAIR_PATHS, unrecognised),
    ];
    expect(live[0]).not.toBe(live[1]);

    const collapsed = live.map(collapse);
    expect(collapsed[0]).toBe(collapsed[1]);
    expect(collapsed[1]).toBe("no-fr");
  });

  test("rewriting the shipped module's own bytes collapses it, and the control does not", async () => {
    const recognised = fixtureRoot("ac5-src-recognised", ["package.json"]);
    const unrecognised = fixtureRoot("ac5-src-unrecognised", []);
    const member = unrecognisedVerdict();

    // Control first: the SAME load pipeline, no mutation. If the pipeline itself
    // were what flattened the pair, this would fail and the mutation below would
    // be manufacturing evidence.
    const control = await loadHookCopy((s) => s);
    expect(control.classifyStagedPaths(AC1_PAIR_PATHS, recognised)).not.toBe(
      control.classifyStagedPaths(AC1_PAIR_PATHS, unrecognised),
    );

    // The mutation: every `"<new member>"` literal in the shipped source becomes
    // `"no-fr"`, which is exactly "fold the fourth outcome back into the third".
    let applied = 0;
    const mutant = await loadHookCopy((s) => {
      const find = `"${member}"`;
      applied = s.split(find).length - 1;
      return s.split(find).join('"no-fr"');
    });
    // The mutation LANDED — a zero-hit replace reads as a passing mutation test.
    expect(applied).toBeGreaterThan(0);

    expect(mutant.classifyStagedPaths(AC1_PAIR_PATHS, recognised)).toBe(
      mutant.classifyStagedPaths(AC1_PAIR_PATHS, unrecognised),
    );
    expect(mutant.classifyStagedPaths(AC1_PAIR_PATHS, unrecognised)).toBe(
      "no-fr",
    );
  });
});

/**
 * Load a copy of the shipped hook module, transformed by `mutate`.
 *
 * Relative import specifiers are rewritten to absolute paths so the copy can
 * live in a temp directory rather than inside `templates/hooks/_lib/hooks/`,
 * where a crash between write and cleanup would leave a stray module in a
 * shipped directory. The rewrite is generic — it does not name any specifier —
 * and asserts it rewrote something.
 */
async function loadHookCopy(mutate: (src: string) => string): Promise<any> {
  const source = readFileSync(MODULE_PATH, "utf8");
  let rewritten = 0;
  const absolutised = source.replace(
    /from\s+"(\.\.?\/[^"]*)"/g,
    (_match, spec: string) => {
      rewritten += 1;
      return `from "${resolve(dirname(MODULE_PATH), spec)}"`;
    },
  );
  expect(rewritten).toBeGreaterThan(0);

  const dir = mkdtempSync(join(tmpdir(), "ste-548-hookcopy-"));
  const file = join(dir, "hook-copy.ts");
  writeFileSync(file, mutate(absolutised));
  return await import(pathToFileURL(file).href);
}

// ===========================================================================
// AC-STE-548.6 — the four outcomes are exhaustive and mutually exclusive over
// the classifier's inputs. `spec-only` is named explicitly: it is pre-existing
// and load-bearing, and this FR's own evidence exists because that carve-out
// behaved correctly.
//
// WHY `spec-only` STILL FIRES WITH NO STACK RESOLVED, and it is not an oversight
// in the fixture matrix: a spec path is stack-independent by construction —
// `specs/frs/*.md` is spec material whatever the project is written in — so a
// staged set of nothing but spec files carries nothing a stack could tell you
// about. Short-circuiting the null-entry case AHEAD of the carve-out would fold
// `spec-only` away in exactly the projects this FR is about, which is the
// reading AC.6 names in order to forbid.
// ===========================================================================

interface MatrixCase {
  label: string;
  markers: string[];
  paths: string[];
  /** `null` means "the derived fourth member". */
  expected: string | null;
}

const MATRIX: ReadonlyArray<MatrixCase> = [
  {
    label: "bun: spec files alone",
    markers: ["package.json"],
    paths: ["specs/frs/STE-548.md", "specs/plan/M142.md"],
    expected: "spec-only",
  },
  {
    label: "bun: docs only",
    markers: ["package.json"],
    paths: ["README.md", "CHANGELOG.md"],
    expected: "no-fr",
  },
  {
    label: "bun: empty staged set",
    markers: ["package.json"],
    paths: [],
    expected: "no-fr",
  },
  {
    label: "bun: source and its test",
    markers: ["package.json"],
    paths: ["src/counter.ts", "src/counter.test.ts"],
    expected: "tdd-required",
  },
  {
    label: "flutter: source and its test",
    markers: ["pubspec.yaml"],
    paths: ["lib/counter.dart", "test/counter_test.dart"],
    expected: "tdd-required",
  },
  {
    label: "flutter: docs only",
    markers: ["pubspec.yaml"],
    paths: ["README.md"],
    expected: "no-fr",
  },
  {
    label: "unrecognisable: docs only",
    markers: [],
    paths: ["README.md", "CHANGELOG.md"],
    expected: null,
  },
  {
    label: "unrecognisable: source and its test",
    markers: [],
    paths: ["src/counter.ts", "src/counter.test.ts"],
    expected: null,
  },
  {
    label: "unrecognisable: spec files alone keep the carve-out",
    markers: [],
    paths: ["specs/frs/STE-548.md"],
    expected: "spec-only",
  },
  {
    label: "unrecognisable: empty staged set",
    markers: [],
    paths: [],
    expected: "no-fr",
  },
];

describe("AC-STE-548.6 — four outcomes, exhaustive and mutually exclusive", () => {
  test("StagedClassification declares exactly four distinct members", () => {
    const members = declaredMembers();
    expect(members.length).toBe(4);
    expect(new Set(members).size).toBe(4);
  });

  test("the three pre-existing members are all still declared, spec-only included", () => {
    const members = declaredMembers();
    for (const member of PRE_EXISTING) {
      expect(members).toContain(member);
    }
  });

  test("the fourth declared member is the verdict an unrecognisable project gets", () => {
    const members = declaredMembers();
    const added = members.filter((m) => !PRE_EXISTING.includes(m));
    expect(added.length).toBe(1);
    expect(added[0]).toBe(unrecognisedVerdict());
  });

  for (const row of MATRIX) {
    test(`matrix — ${row.label} lands on exactly one outcome`, () => {
      const members = declaredMembers();
      const expected = row.expected ?? unrecognisedVerdict();
      const root = fixtureRoot(
        row.label.replace(/[^a-z0-9]+/gi, "-"),
        row.markers,
      );
      const verdict = classifyIn(row.paths, root);

      expect(members).toContain(verdict);
      expect(verdict).toBe(expected);
      // Exactly ONE: asserted against every other declared member rather than
      // assumed from the single return value.
      for (const other of members.filter((m) => m !== expected)) {
        expect(verdict).not.toBe(other);
      }
    });
  }

  test("the matrix exercises all four outcomes — none is declared but unreachable", () => {
    const members = declaredMembers();
    const seen = new Set(
      MATRIX.map((row) =>
        classifyIn(
          row.paths,
          fixtureRoot(
            `cover-${row.label.replace(/[^a-z0-9]+/gi, "-")}`,
            row.markers,
          ),
        ),
      ),
    );
    expect([...seen].sort()).toEqual([...members].sort());
  });
});

// ===========================================================================
// Technical Design — `FALLBACK_LAYOUT` is DELETED, not left standing.
//
// It is dead the moment the null-entry case answers before any predicate is
// built. Leaving it standing leaves a SECOND divergent TypeScript layout beside
// the `package.json` entry — three extensions and one test directory against six
// and two — which is precisely the private copy M142 exists to end.
// ===========================================================================

describe("STE-548 — the private TypeScript fallback layout is gone", () => {
  test("stack_layout no longer exports FALLBACK_LAYOUT", () => {
    expect(Object.keys(stackLayout)).not.toContain("FALLBACK_LAYOUT");
  });

  test("neither the table module nor the hook still names it", () => {
    // `.includes(...)` rather than `.not.toContain(...)`: the latter prints the
    // whole 300-line module into the failure, burying the reason.
    expect(readFileSync(STACK_LAYOUT_PATH, "utf8").includes("FALLBACK_LAYOUT"))
      .toBe(false);
    expect(readFileSync(MODULE_PATH, "utf8").includes("FALLBACK_LAYOUT")).toBe(
      false,
    );
  });

  test("the one TypeScript layout left is the package.json entry's own", () => {
    const entry = stackLayout.STACK_LAYOUTS.find(
      (e) => e.marker === "package.json",
    );
    expect(entry).toBeDefined();
    // The retired fallback recognised only `__tests__/`; the surviving entry is
    // the wider, documented one. Asserting the difference keeps a future
    // "restore the old shape" from passing silently.
    expect([...entry!.layout.testDirs].sort()).toEqual(["__tests__/", "tests/"]);
  });
});

// STE-565 — the harness keeps the evidence it gathered.
//
// Two ways a completed run threw away its own work.
//
// (a) `$(set -- ${SELECTED_LEGS}; echo $#)` needs POSIX field splitting. zsh
//     does not split unquoted expansions, so "linear none" collapsed to ONE
//     word, the guard read examined=2 against count=1, and a COMPLETED
//     two-leg run was aborted at its final gate. Measured live 2026-09-05 at
//     2h40m. It fails CLOSED, so it could never fake a green — which is why it
//     survived: the damage is discarded work, and nothing red.
//
//     The suite was green because the fences were executed under `bash`, the
//     one shell where the bug is invisible. Labelled bash, tested under bash,
//     executed by an agent whose Bash tool runs zsh.
//
// (b) Sub-fixture 8a persisted its capture inside the repository, untracked
//     AND un-ignored, so the next run's pre-flight #4 refused to start.
//
// EVERY SHELL LEG BELOW RUNS THE RETIRED FORM TOO. A test that exercises only
// the fix cannot tell a fix from a coincidence, and this defect's whole history
// is a green suite that never ran the failing case.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HARNESS_SKILL_RELATIVE_PATHS,
  PLUGIN_ROOT_RELATIVE,
  inRepoArtifactPaths,
  repoRelativeArtifactPath,
  sampleArtifactPath,
  scanUnignoredRepoArtifacts,
} from "../adapters/_shared/src/harness_artifact_paths";
import {
  FENCE_SHELLS,
  availableFenceShells,
  fenceContaining,
  mutate,
  runInEveryShell,
  runInShell,
  shellAvailable,
} from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

/** The loop driver is a repo-local dogfood skill; a consumer tree has none. */
const loop = existsSync(LOOP_SKILL) ? readFileSync(LOOP_SKILL, "utf-8") : null;
const describeIfLoop = loop ? describe : describe.skip;

/** The shipped count expression, and the one it replaced. */
const SHIPPED_COUNT = 'SELECTED_COUNT=$(printf %s "${SELECTED_LEGS}" | wc -w | tr -dc 0-9)';
const RETIRED_COUNT = "SELECTED_COUNT=$(set -- ${SELECTED_LEGS}; echo $#)";

function countUnder(shell: string, expression: string, legs: string): string {
  return runInShell(shell as (typeof FENCE_SHELLS)[number], [
    `SELECTED_LEGS="${legs}"`,
    expression,
    'echo "${SELECTED_COUNT}"',
  ].join("\n")).stdout;
}

// ===========================================================================
// AC.1 — the guards count correctly under every shell that runs them.
// ===========================================================================

describe("AC-STE-565.1 — the count no longer depends on the shell", () => {
  test("at least one shell is available — otherwise every leg here is vacuous", () => {
    expect(availableFenceShells().length).toBeGreaterThan(0);
  });

  for (const shell of FENCE_SHELLS) {
    test(`${shell}: the shipped expression counts "linear none" as 2`, () => {
      if (!shellAvailable(shell)) return; // AC.5 covers the skip contract
      expect(countUnder(shell, SHIPPED_COUNT, "linear none")).toBe("2");
    });
  }

  test("THE DEFECT, REPRODUCED: the retired form reads 1 under zsh and 2 under bash", () => {
    if (!shellAvailable("zsh") || !shellAvailable("bash")) return;
    // This is the finding, executed rather than described. If this assertion
    // ever stops holding, the premise of the whole FR has changed.
    expect(countUnder("bash", RETIRED_COUNT, "linear none")).toBe("2");
    expect(countUnder("zsh", RETIRED_COUNT, "linear none")).toBe("1");
    // …and the shipped form agrees with itself across the same pair.
    expect(countUnder("bash", SHIPPED_COUNT, "linear none")).toBe(
      countUnder("zsh", SHIPPED_COUNT, "linear none"),
    );
  });

  test("the guard's own comparison aborts under zsh with the retired form, and not with the shipped one", () => {
    if (!shellAvailable("zsh")) return;
    const guard = (countExpr: string) =>
      runInShell("zsh", [
        'SELECTED_LEGS="linear none"',
        "EXAMINED_LEGS=2",
        countExpr,
        'if [ "${EXAMINED_LEGS}" -ne "${SELECTED_COUNT}" ]; then echo ABORT; exit 1; fi',
        "echo PROCEED",
      ].join("\n"));

    const retired = guard(RETIRED_COUNT);
    expect(retired.stdout).toBe("ABORT");
    expect(retired.status).toBe(1);

    const shipped = guard(SHIPPED_COUNT);
    expect(shipped.stdout).toBe("PROCEED");
    expect(shipped.status).toBe(0);
  });
});

// ===========================================================================
// AC.2 — the empty and single-leg cases, unchanged.
// ===========================================================================

describe("AC-STE-565.2 — 0 and 1 still count as 0 and 1", () => {
  for (const shell of FENCE_SHELLS) {
    test(`${shell}: single leg is 1, empty is 0, three legs are 3`, () => {
      if (!shellAvailable(shell)) return;
      expect(countUnder(shell, SHIPPED_COUNT, "linear")).toBe("1");
      expect(countUnder(shell, SHIPPED_COUNT, "")).toBe("0");
      expect(countUnder(shell, SHIPPED_COUNT, "linear jira none")).toBe("3");
    });
  }
});

describeIfLoop("AC-STE-565.1 + AC-STE-565.2 — over the shipped fences", () => {
  test("both accounting guards carry the shipped form and neither carries the retired one", () => {
    const occurrences = loop!.split(SHIPPED_COUNT).length - 1;
    expect(occurrences).toBe(2); // the RC gate and the green probe
    // Anchored on the ASSIGNMENT: both fences' rationale comments QUOTE the
    // retired expression while explaining why it was retired, and a check that
    // could not tell an argument from an assertion would forbid the comment.
    expect(loop!).not.toContain("SELECTED_COUNT=$(set --");
  });

  test("the empty-selection refusal above each guard is untouched", () => {
    const rc = fenceContaining(loop!, "RC_LINEAR=");
    const green = fenceContaining(loop!, "STATUS=green");
    for (const fence of [rc, green]) {
      expect(fence).toContain('if [ -z "${SELECTED_LEGS:-}" ]');
    }
  });

  test("each guard's membership arms stay quoted — they never depended on splitting", () => {
    const rc = fenceContaining(loop!, "RC_LINEAR=");
    // `case " ${SELECTED_LEGS} " in` compares a QUOTED expansion, which neither
    // shell splits. Only the count was shell-dependent, which is why the fix is
    // one line per guard rather than a rewrite — asserted, not asserted-about.
    expect(rc).toContain('case " ${SELECTED_LEGS} " in *" linear "*)');
  });

  test("MUTANT: restoring the retired form reds under zsh and stays green under bash", () => {
    if (!shellAvailable("zsh") || !shellAvailable("bash")) return;
    const rc = fenceContaining(loop!, "RC_LINEAR=");
    const mutated = mutate(rc, SHIPPED_COUNT, RETIRED_COUNT);

    const script = (fence: string) =>
      [
        "DATE=ste565 ITER=1",
        'SELECTED_LEGS="linear none"',
        fence.slice(0, fence.indexOf("# STE-359")),
        "echo REACHED-END",
      ].join("\n");

    const mutantBash = runInShell("bash", script(mutated));
    const mutantZsh = runInShell("zsh", script(mutated));
    const shippedZsh = runInShell("zsh", script(rc));

    // The mutation applied and the two shells disagree about it — which is the
    // finding. `mutate` throws if the pattern matched nothing, so a silent
    // no-op cannot masquerade as a pass here.
    expect(mutantZsh.stdout).toContain("Aborting");
    expect(mutantBash.stdout).not.toContain("Aborting");
    expect(shippedZsh.stdout).not.toContain("Aborting");
  });
});

// ===========================================================================
// AC.3 / AC.4 — the fences are exercised by the shell an agent actually uses.
// ===========================================================================

describe("AC-STE-565.3 + AC-STE-565.4 — the dual-shell runner", () => {
  const HARNESS = join(pluginRoot, "tests", "m121-ste-452-termination-harness.test.ts");
  const RC_GATE = join(pluginRoot, "tests", "m128-ste-490-rc-verdict-gate.test.ts");

  test("the runner lives in the shared fence home, not in a private copy", () => {
    const fence = readFileSync(join(pluginRoot, "tests", "_fence.ts"), "utf-8");
    for (const name of ["FENCE_SHELLS", "runInShell", "runInEveryShell", "availableFenceShells"]) {
      expect(fence).toContain(`export ${name.startsWith("FENCE") ? "const" : "function"} ${name}`);
    }
  });

  test("zsh is on the roster — bash alone is the blind spot this FR closes", () => {
    expect([...FENCE_SHELLS]).toContain("zsh");
    expect([...FENCE_SHELLS]).toContain("bash");
  });

  for (const [label, path] of [
    ["termination harness", HARNESS],
    ["rc-verdict gate", RC_GATE],
  ] as const) {
    test(`${label} executes through the shared runner, not a private bash spawn`, () => {
      const body = readFileSync(path, "utf-8");
      expect(body).toContain("runInShell");
      expect(body).toContain("availableFenceShells");
      // The private `Bun.spawnSync(["bash", …])` that hard-coded one shell is
      // gone from the fence runner in both files.
      expect(body).not.toContain('Bun.spawnSync(["bash", "-c"');
    });
  }

  test("a fence that disagrees between shells is reported, not averaged", () => {
    // The runner's contract, exercised directly: a script whose behaviour is
    // shell-dependent produces genuinely different results, and the harness's
    // runScript turns that into a throw naming both shells.
    if (!shellAvailable("zsh") || !shellAvailable("bash")) return;
    const runs = runInEveryShell('SELECTED_LEGS="a b"; set -- ${SELECTED_LEGS}; echo $#');
    const answers = new Set(runs.map((r) => r.stdout));
    expect(answers.size).toBe(2); // they disagree — and that is visible
  });
});

// ===========================================================================
// AC.5 — a missing shell SKIPS with a reason, never silently passes.
// ===========================================================================

describe("AC-STE-565.5 — absence is a skip that says so", () => {
  test("shellAvailable reports false for a shell that does not exist", () => {
    expect(shellAvailable("definitely-not-a-shell-ste565")).toBe(false);
  });

  test("availableFenceShells is a SUBSET of the roster, in roster order", () => {
    const available = availableFenceShells();
    for (const s of available) expect([...FENCE_SHELLS]).toContain(s);
    expect(available).toEqual(FENCE_SHELLS.filter((s) => available.includes(s)));
  });

  test("an empty roster is a refusal, never a quiet bash-only pass", () => {
    // The harness runner throws rather than degrading. Asserted on the message
    // so a future edit cannot turn it into a silent fallback.
    const body = readFileSync(
      join(pluginRoot, "tests", "m121-ste-452-termination-harness.test.ts"),
      "utf-8",
    );
    expect(body).toContain("refusing to report a vacuous pass");
  });
});

// ===========================================================================
// AC.6 / AC.7 / AC.8 — a run leaves the tree clean.
// ===========================================================================

describe("AC-STE-565.6 — the scan is DERIVED from the existing extraction", () => {
  test("the in-repo subset comes out of enumeratePerRunArtifactPaths", () => {
    if (loop === null) return;
    const smoke = readFileSync(
      join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
      "utf-8",
    );
    const inRepo = inRepoArtifactPaths(smoke);
    expect(inRepo.length).toBeGreaterThan(0);
    for (const ref of inRepo) {
      expect(ref.path).toContain("tests/fixtures/");
      expect(ref.path.startsWith("/tmp/")).toBe(false);
    }
    // The 8a persist path — the measured offender — is among them.
    expect(inRepo.some((r) => r.path.includes("nested-spawn"))).toBe(true);
  });

  test("literals resolve to where the files actually land", () => {
    // The SKILLs write PLUGIN-root-relative paths; the files land under the
    // plugin. Asking git about the unprefixed form reported every ALREADY
    // ignored class as un-ignored — measured while building this scan.
    expect(PLUGIN_ROOT_RELATIVE).toBe("plugins/dev-process-toolkit");
    expect(repoRelativeArtifactPath("tests/fixtures/nested-spawn/8a-<tracker>-<d>.log")).toBe(
      "plugins/dev-process-toolkit/tests/fixtures/nested-spawn/8a-sample-sample.log",
    );
    // Already-prefixed literals are not prefixed twice.
    const already = "plugins/dev-process-toolkit/tests/fixtures/x/y-<tracker>.log";
    expect(repoRelativeArtifactPath(already).startsWith("plugins/dev-process-toolkit/tests")).toBe(
      true,
    );
    expect(repoRelativeArtifactPath(already)).not.toContain(
      "plugins/dev-process-toolkit/plugins",
    );
  });

  test("placeholders resolve to a concrete filename that keeps its extension", () => {
    expect(sampleArtifactPath("a/b-<tracker>-<YYYY-MM-DD>.log")).toBe("a/b-sample-sample.log");
    expect(sampleArtifactPath("a/b-${DATE}.json")).toBe("a/b-sample.json");
  });

  test("MUTANT: dropping a path from the extraction reds the derivation", () => {
    const smoke = readFileSync(
      join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
      "utf-8",
    );
    const stripped = mutate(smoke, /tests\/fixtures\/nested-spawn\/8a-<tracker>-<YYYY-MM-DD>\.log/g, "REMOVED");
    expect(inRepoArtifactPaths(smoke).some((r) => r.path.includes("nested-spawn"))).toBe(true);
    expect(inRepoArtifactPaths(stripped).some((r) => r.path.includes("nested-spawn"))).toBe(false);
  });
});

describe("AC-STE-565.7 — coverage is git's verdict, not a grep", () => {
  test("this repository has no un-ignored in-repo artifact class", () => {
    if (loop === null) return;
    expect(scanUnignoredRepoArtifacts(repoRoot)).toEqual([]);
  });

  test("the tracked reproducers under those roots stay tracked", () => {
    const reproducers = join(
      pluginRoot,
      "tests",
      "fixtures",
      "socratic-first-turn",
      "regression",
    );
    if (!existsSync(reproducers)) return;
    const p = Bun.spawnSync(["git", "ls-files", "--error-unmatch", reproducers], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(0);
  });

  test("MUTANT: a class git does not ignore is reported", () => {
    // Over a throwaway repository, so the assertion is about the SCAN and not
    // about this tree's current `.gitignore`.
    const root = mkdtempSync(join(tmpdir(), "ste565-git-"));
    try {
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      const skillDir = join(root, ".claude", "skills", "smoke-test");
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(join(root, "plugins", "dev-process-toolkit"), { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "Persist to `tests/fixtures/ste565-probe/x-<tracker>-<YYYY-MM-DD>.log` for replay.\n",
      );

      const rel = [join(".claude", "skills", "smoke-test", "SKILL.md")];

      // No .gitignore at all ⇒ reported.
      const before = scanUnignoredRepoArtifacts(root, rel);
      expect(before.length).toBe(1);
      expect(before[0]!.path).toContain("ste565-probe");

      // Ignored ⇒ silent. Same tree, one line different.
      writeFileSync(
        join(root, ".gitignore"),
        "plugins/dev-process-toolkit/tests/fixtures/ste565-probe/*.log\n",
      );
      expect(scanUnignoredRepoArtifacts(root, rel)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an absent harness SKILL is the consumer case, not a violation", () => {
    const root = mkdtempSync(join(tmpdir(), "ste565-empty-"));
    try {
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      expect(scanUnignoredRepoArtifacts(root, HARNESS_SKILL_RELATIVE_PATHS)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-565.8 — a completed run leaves the tree clean", () => {
  test("writing a file at every enumerated persist path leaves git status empty", () => {
    if (loop === null) return;
    const smoke = readFileSync(
      join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
      "utf-8",
    );
    const paths = inRepoArtifactPaths(smoke).map((r) => repoRelativeArtifactPath(r.path));
    expect(paths.length).toBeGreaterThan(0);

    const written: string[] = [];
    try {
      for (const rel of paths) {
        const abs = join(repoRoot, rel);
        if (existsSync(abs)) continue;
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, "ste565 run output\n");
        written.push(abs);
      }
      // This is the END-TO-END statement. AC.6 and AC.7 are how it is
      // achieved; neither implies it, because a class can be enumerated and
      // ignored by a rule that does not match the file that lands.
      const status = Bun.spawnSync(["git", "status", "--porcelain"], {
        cwd: repoRoot,
        stdout: "pipe",
      });
      const dirty = new TextDecoder()
        .decode(status.stdout)
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .filter((l) => paths.some((p) => l.includes(p.split("/").slice(0, -1).join("/"))));
      expect(dirty).toEqual([]);
    } finally {
      for (const abs of written) rmSync(abs, { force: true });
    }
  });
});

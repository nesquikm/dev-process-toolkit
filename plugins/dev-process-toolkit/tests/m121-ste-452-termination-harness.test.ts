// STE-452 — the N-leg termination harness, built out of EXECUTED bash fences.
//
// Every assertion in this file runs the shell the driver ships. None of them
// greps the prose around it. That is not a stylistic preference: the surfaces
// under test here spent this whole milestone being described correctly by
// paragraphs sitting next to snippets that did something else, and a prose grep
// cannot tell those two apart. `tests/driver-gate-fail-open-guards.test.ts` is
// the precedent and the shape is copied from it deliberately.
//
// Three fences are covered:
//
//   (a) the `green` termination probe   — § Termination (a)
//   (b) the RC-collection gate          — § RC collection
//   (c) the `no-progress` probe         — § Termination (c)
//
// (a) and (b) are the two surfaces STE-447 left counting the REGISTERED leg set
// after it shipped a selector that can reduce it. Their reduced-run behaviour is
// AC.7 / AC.8 and is measured here, not reasoned about.

import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import {
  type FenceShell,
  anyFences,
  availableFenceShells,
  bashFences,
  fenceContaining,
  mutate,
  runInShell,
} from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");
// AC-STE-459.2 — live-then-archive, the house conditional already shipped at
// `m108-ste-393-docs-pins.test.ts:99` and `m114-ste-416-…:203`.
const FR_ACTIVE = join(repoRoot, "specs", "frs", "STE-452.md");
const FR_ARCHIVED = join(repoRoot, "specs", "frs", "archive", "STE-452.md");
const FR_PATH = existsSync(FR_ACTIVE) ? FR_ACTIVE : FR_ARCHIVED;

/**
 * The loop driver is a repo-local dogfood skill, not a shipped plugin skill, so
 * a consumer running this suite from an installed plugin has no
 * `.claude/skills/` tree. Skip rather than fail there — same `readIfPresent`
 * shape the fail-open-guards file uses.
 */
function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const describeIfLoop = loop ? describe : describe.skip;

// Fence extraction and the throwing `mutate` used to live here. STE-453 needed
// a SIXTH private copy of them and lifted these four verbatim into
// `tests/_fence.ts` instead — `specs/notes/follow-ups.md` § 0c(c) had already
// recorded the pattern past its own "extract when a third wants it" threshold.
// Behaviour is unchanged by construction: the module holds this file's
// definitions, byte-for-byte, and this suite is the equivalence proof.
const greenFence = () => fenceContaining(loop!, "STATUS=green");
const rcFence = () => fenceContaining(loop!, "RC_LINEAR=");
const noProgressFence = () => fenceContaining(loop!, "STATUS=no-progress");

/** A per-invocation token, unique without relying on PID non-reuse (§ 0e(c)). */
function freshToken(prefix: string): { token: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { token: basename(dir), dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

type Outcome = { status: number; stdout: string; stderr: string };

/**
 * STE-565 — every fence in this file runs under EVERY available shell, and the
 * shells must agree.
 *
 * This runner used to hard-code `bash`. That is the shell the fences are
 * LABELLED with and it is NOT the shell that executes them: an agent's Bash
 * tool runs zsh on macOS. The leg-accounting guard's
 * `$(set -- ${SELECTED_LEGS}; echo $#)` needs POSIX field splitting, zsh does
 * not split unquoted expansions, and a COMPLETED two-leg run was aborted at
 * its final gate — while this file stayed green, because it exercised only the
 * one shell where the bug is invisible.
 *
 * Every existing assertion therefore gains a second interpreter with no
 * call-site change, and a fence whose behaviour DIFFERS between shells throws
 * naming both — which is the finding, reported rather than averaged away.
 */
function runScript(lines: readonly string[], only?: FenceShell): Outcome {
  const script = lines.join("\n");
  if (only !== undefined) {
    const one = runInShell(only, script);
    return { status: one.status, stdout: one.stdout, stderr: one.stderr };
  }
  const shells = availableFenceShells();
  if (shells.length === 0) {
    throw new Error("no fence shell available — refusing to report a vacuous pass");
  }
  const runs = shells.map((shell) => runInShell(shell, script));
  const first = runs[0]!;
  for (const run of runs.slice(1)) {
    if (run.status !== first.status || run.stdout !== first.stdout) {
      throw new Error(
        `fence behaved differently between shells:\n` +
          runs
            .map((r) => `  ${r.shell}: status=${r.status} stdout=${JSON.stringify(r.stdout)}`)
            .join("\n"),
      );
    }
  }
  return { status: first.status, stdout: first.stdout, stderr: first.stderr };
}

// ===========================================================================
// (a) The `green` termination probe.
// ===========================================================================

/** `absent` means the file is deliberately NOT created; a number is its high count. */
type Findings = Readonly<Record<string, number | "absent">>;

/**
 * Run the documented `green` fence against materialized per-leg findings files.
 *
 * The fence ends in a bare `break`, which is only legal inside a loop — the
 * real driver runs it inside the per-iteration loop. The `for _ONE in 1` wrapper
 * supplies exactly that context and nothing else; without it bash emits a
 * spurious diagnostic the driver never sees. The epilogue is the probe, not
 * part of the fence: it reports whether STATUS was assigned at all, because
 * "unset" and "green" are the two outcomes that must never be confused.
 */
function runGreen(opts: {
  selected: readonly string[];
  findings: Findings;
  mutation?: (fence: string) => string;
  /** Run under exactly this shell instead of requiring the shells to agree. */
  shell?: FenceShell;
}): Outcome {
  const { token, dispose } = freshToken("ste452green");
  try {
    for (const [leg, value] of Object.entries(opts.findings)) {
      if (value === "absent") continue;
      const body =
        "**Severity:** medium\n" + "**Severity:** high\n".repeat(value as number);
      writeFileSync(`/tmp/dpt-smoke-findings-${token}-${leg}.md`, body);
    }
    const fence = opts.mutation ? opts.mutation(greenFence()) : greenFence();
    return runScript(
      [
        `DATE=${token}`,
        "ITER=1",
        `SELECTED_LEGS="${opts.selected.join(" ")}"`,
        "for _ONE in 1; do",
        fence,
        "done",
        'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
      ],
      opts.shell,
    );
  } finally {
    for (const leg of Object.keys(opts.findings)) {
      rmSync(`/tmp/dpt-smoke-findings-${token}-${leg}.md`, { force: true });
    }
    dispose();
  }
}

/** Every registered leg present with the given high-count. */
function allLegs(high: number): Findings {
  return Object.fromEntries(SMOKE_LEGS.map((leg) => [leg, high]));
}

const reportedGreen = (r: Outcome) => r.stdout.includes("STATUS=[green]");
const aborted = (r: Outcome) => r.status !== 0;

describeIfLoop("AC-STE-452.2 — slice sanity: the extractions resolve and keep their anchors", () => {
  // Without this block every executed assertion below could be satisfied by an
  // empty string. An extraction that silently matches nothing runs a zero-byte
  // script, which exits 0 and reports nothing — and a test asserting "did NOT
  // report green" would pass. This is the guard that makes the rest mean
  // something, which is why AC.2 is its own criterion.

  test("the green fence resolves and carries its operative anchors", () => {
    const fence = greenFence();
    expect(fence.length).toBeGreaterThan(200);
    expect(fence).toContain("STATUS=green");
    expect(fence).toContain("SELECTED_LEGS");
    expect(fence).toContain("MISSING_FINDINGS");
    expect(fence).toContain("exit 1");
    // One counting site per registered leg, each naming its own findings file.
    for (const leg of SMOKE_LEGS) {
      expect(fence).toContain(`/tmp/dpt-smoke-findings-\${DATE}-${leg}.md`);
    }
  });

  test("the RC fence resolves and carries its operative anchors", () => {
    const fence = rcFence();
    expect(fence.length).toBeGreaterThan(200);
    expect(fence).toContain("SELECTED_LEGS");
    expect(fence).toMatch(/-ne 0/);
    expect(fence).toContain("exit 1");
  });

  test("the no-progress fence resolves and carries its operative anchors", () => {
    const fence = noProgressFence();
    expect(fence.length).toBeGreaterThan(100);
    expect(fence).toContain("STATUS=no-progress");
    expect(fence).toContain("cmp -s");
    expect(fence).toContain("HEAD_BEFORE_PHASE_B");
  });

  test("exactly ONE fence in the document carries STATUS=green", () => {
    // The `green-probe-findings-files` derivation surface locates its fence by
    // first match on this literal (leg_prose_surfaces.ts). A second fence
    // carrying it — an illustrative example, a refusal template — would
    // silently re-point that surface at the wrong block and take six STE-446
    // assertions with it. STE-447 recorded this trap; this is the assertion
    // that catches it happening.
    //
    // Counted with the SURFACE's own fence grammar, not this file's. Review
    // caught the first draft using `bashFences` (```bash only) while the
    // surface it protects uses `fencedBlocks` — every column-0 fence whatever
    // its language tag. A decoy in a plain or ```text fence would have
    // re-pointed the surface while this guard reported all-clear, which is a
    // guard that watches a different door than the one it names.
    const anyFence = anyFences(loop!);
    expect(anyFence.filter((f) => f.includes("STATUS=green"))).toHaveLength(1);
    // Non-vacuity: the grammar finds substantially more fences than the
    // bash-only one, so a zero-carrier result would be a parsing failure.
    expect(anyFence.length).toBeGreaterThan(bashFences(loop!).length - 1);
  });

  test("the COUNTING lines of the green fence name exactly the registered leg set", () => {
    // Closes, additively, the hole STE-452's own edit opened in the
    // `green-probe-findings-files` derivation surface. Since each leg's path
    // now appears twice in the fence — once in an existence check, once in a
    // `grep -c` — that surface can no longer distinguish a leg it COUNTS from
    // one it merely MENTIONS. Narrowing the surface itself was tried and
    // reverted (it lost the phantom-leg detection AC-STE-446.5 relies on), so
    // the counted-set property is asserted here instead and the surface keeps
    // its whole-fence scan. Deleting a leg's `grep -c` while leaving its
    // existence check turns THIS red.
    const counted = [
      ...greenFence()
        .split(/\r?\n/)
        .filter((l) => l.includes("grep -c"))
        .join("\n")
        .matchAll(/dpt-smoke-findings-\$\{DATE\}-([a-z]+)\.md/g),
    ].map((m) => m[1]!);
    expect([...new Set(counted)].sort()).toEqual([...SMOKE_LEGS].sort());
  });

  test("the three fences are distinct blocks", () => {
    const ids = new Set([greenFence(), rcFence(), noProgressFence()]);
    expect(ids.size).toBe(3);
  });
});

describeIfLoop("AC-STE-452.1 + AC-STE-452.3 — the green probe, EXECUTED across N legs", () => {
  test("N=3, all-green: every selected leg at zero high lines reports green", () => {
    const r = runGreen({ selected: SMOKE_LEGS, findings: allLegs(0) });
    expect({ green: reportedGreen(r), aborted: aborted(r) }).toEqual({
      green: true,
      aborted: false,
    });
  });

  test("N=3, all-red: every leg carrying high lines does NOT report green", () => {
    const r = runGreen({ selected: SMOKE_LEGS, findings: allLegs(2) });
    expect(reportedGreen(r)).toBe(false);
  });

  test("N=3, ASYMMETRIC: one red leg beside green legs does NOT report green", () => {
    // The case a naive N-leg fold gets wrong. All-green and all-red are both
    // satisfied by the wrong operator; only this one separates them, which is
    // why AC.3 names it explicitly.
    for (const red of SMOKE_LEGS) {
      const findings = { ...allLegs(0), [red]: 3 };
      const r = runGreen({ selected: SMOKE_LEGS, findings });
      expect({ red, green: reportedGreen(r) }).toEqual({ red, green: false });
    }
  });

  test("N=2: a two-leg selection reports green on its own evidence", () => {
    const selected = [SMOKE_LEGS[0]!, SMOKE_LEGS[2]!];
    const r = runGreen({
      selected,
      findings: Object.fromEntries(selected.map((l) => [l, 0])),
    });
    expect({ green: reportedGreen(r), aborted: aborted(r) }).toEqual({
      green: true,
      aborted: false,
    });
  });

  test("N=2, asymmetric within the selection: still not green", () => {
    const selected = [SMOKE_LEGS[0]!, SMOKE_LEGS[2]!];
    const r = runGreen({
      selected,
      findings: { [selected[0]!]: 0, [selected[1]!]: 1 },
    });
    expect(reportedGreen(r)).toBe(false);
  });

  test("N=1: a single-leg selection reports green on its own evidence", () => {
    for (const leg of SMOKE_LEGS) {
      const r = runGreen({ selected: [leg], findings: { [leg]: 0 } });
      expect({ leg, green: reportedGreen(r), aborted: aborted(r) }).toEqual({
        leg,
        green: true,
        aborted: false,
      });
    }
  });

  test("N=1, red: a single selected leg carrying high lines is not green", () => {
    for (const leg of SMOKE_LEGS) {
      const r = runGreen({ selected: [leg], findings: { [leg]: 1 } });
      expect({ leg, green: reportedGreen(r) }).toEqual({ leg, green: false });
    }
  });

  test("WITNESS: the conjunction is load-bearing — `||` greens the asymmetric case", () => {
    // Proves the asymmetric assertions above are not passing for free. Swapping
    // the fold's `&&` for `||` is the exact wrong-operator rewrite AC.3
    // describes: it still passes all-green and still fails all-red, and it
    // wrongly reports green when one leg is red. If this witness stops
    // reporting green the fold has changed shape and the asymmetric tests above
    // need re-deriving rather than trusting.
    const wrongFold = (fence: string) =>
      mutate(fence, /-eq 0 \] && \[ "\$\{HIGH_/g, '-eq 0 ] || [ "${HIGH_');

    const asymmetric = { ...allLegs(0), [SMOKE_LEGS[1]!]: 4 };
    expect(reportedGreen(runGreen({ selected: SMOKE_LEGS, findings: asymmetric, mutation: wrongFold })))
      .toBe(true);

    // and the two cases that cannot separate the operators, for contrast
    expect(reportedGreen(runGreen({ selected: SMOKE_LEGS, findings: allLegs(0), mutation: wrongFold })))
      .toBe(true);
    expect(reportedGreen(runGreen({ selected: SMOKE_LEGS, findings: allLegs(2), mutation: wrongFold })))
      .toBe(false);
  });
});

describeIfLoop("AC-STE-452.4 + AC-STE-452.5 — the absent-file semantic is EXPLICIT", () => {
  test("a SELECTED leg with no findings file ABORTS and does not report green", () => {
    for (const missing of SMOKE_LEGS) {
      const findings: Findings = { ...allLegs(0), [missing]: "absent" };
      const r = runGreen({ selected: SMOKE_LEGS, findings });
      expect({ missing, aborted: aborted(r), green: reportedGreen(r) }).toEqual({
        missing,
        aborted: true,
        green: false,
      });
      expect(r.stdout).toContain("Aborting");
      expect(r.stdout).toContain(missing);
    }
  });

  test("the abort names the missing leg and says a leg with no file did not run", () => {
    const r = runGreen({
      selected: SMOKE_LEGS,
      findings: { ...allLegs(0), [SMOKE_LEGS[1]!]: "absent" },
    });
    expect(r.stdout).toMatch(/no findings file for selected leg/i);
    expect(r.stdout).toMatch(/did not run/i);
  });

  test("EVERY selected leg missing aborts — not a silent all-clear", () => {
    const r = runGreen({
      selected: SMOKE_LEGS,
      findings: Object.fromEntries(SMOKE_LEGS.map((l) => [l, "absent" as const])),
    });
    expect({ aborted: aborted(r), green: reportedGreen(r) }).toEqual({
      aborted: true,
      green: false,
    });
  });

  test("a findings file that EXISTS but cannot be COUNTED aborts too", () => {
    // Review finding. The existence check alone left a residual path with the
    // exact shape AC.5 exists to remove: an unreadable file passes `! -f`,
    // `grep -c` prints nothing, and `[ "" -eq 0 ]` is the same test(1) usage
    // error as before — no abort, rc 0, only raw bash noise on stderr. The RC
    // gate already normalized its analogue, so the two fences this FR edits
    // were asymmetric on the same input class.
    const { token, dispose } = freshToken("ste452unread");
    const paths = SMOKE_LEGS.map((l) => `/tmp/dpt-smoke-findings-${token}-${l}.md`);
    try {
      for (const p of paths) writeFileSync(p, "**Severity:** medium\n");
      chmodSync(paths[1]!, 0o000);
      // Non-vacuity: a run whose files are all readable reports green, so a
      // failure below is about readability and not about the fixture.
      const r = runScript([
        `DATE=${token}`,
        "ITER=1",
        `SELECTED_LEGS="${SMOKE_LEGS.join(" ")}"`,
        "for _ONE in 1; do",
        greenFence(),
        "done",
        'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
      ]);
      chmodSync(paths[1]!, 0o644);
      expect({ aborted: r.status !== 0, green: r.stdout.includes("STATUS=[green]") }).toEqual({
        aborted: true,
        green: false,
      });
      expect(r.stdout).toMatch(/not countable/i);
      expect(r.stdout).toContain(SMOKE_LEGS[1]!);
    } finally {
      for (const p of paths) {
        try {
          chmodSync(p, 0o644);
        } catch {
          /* already gone */
        }
        rmSync(p, { force: true });
      }
      dispose();
    }
  });

  test("a mis-delimited or unregistered selection is never green — every arm must account for itself", () => {
    // Review finding, and the most dangerous one in the FR: `*" leg "*` matches
    // only single-space-delimited members, while every counter pre-defaults to
    // the PASSING value. So a tab-separated, comma-separated or doubled-space
    // selection missed every arm and reported green having examined nothing —
    // a vacuous green introduced by the very edit meant to remove vacuous
    // greens. The fence now counts the arms that fired against the selection's
    // word count.
    const badShapes = [
      { label: "comma-separated", sel: "linear,jira,none" },
      { label: "tab-separated", sel: "linear\tjira" },
      { label: "unregistered value", sel: "linear zzbogus" },
      { label: "single unregistered value", sel: "zzbogus" },
      { label: "leg-name substring", sel: "linea" },
    ];
    for (const { label, sel } of badShapes) {
      const { token, dispose } = freshToken("ste452delim");
      try {
        for (const l of SMOKE_LEGS) {
          writeFileSync(`/tmp/dpt-smoke-findings-${token}-${l}.md`, "**Severity:** medium\n");
        }
        const r = runScript([
          `DATE=${token}`,
          "ITER=1",
          `SELECTED_LEGS="${sel}"`,
          "for _ONE in 1; do",
          greenFence(),
          "done",
          'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
        ]);
        expect({ label, green: r.stdout.includes("STATUS=[green]"), aborted: r.status !== 0 }).toEqual(
          { label, green: false, aborted: true },
        );
      } finally {
        for (const l of SMOKE_LEGS) {
          rmSync(`/tmp/dpt-smoke-findings-${token}-${l}.md`, { force: true });
        }
        dispose();
      }
    }
  });

  test("DISCRIMINATOR: extra spacing between real legs still RESOLVES — the guard counts, it does not nitpick", () => {
    // The companion to the test above, and the reason it is a counting guard
    // rather than a format check. `linear  jira` (doubled space) names two real
    // legs and both arms fire, so it must pass. My first draft asserted it
    // should abort; execution said otherwise and execution was right. Without
    // this case the guard could be tightened into a whitespace pedant and
    // nothing would notice.
    const { token, dispose } = freshToken("ste452space");
    try {
      for (const l of SMOKE_LEGS) {
        writeFileSync(`/tmp/dpt-smoke-findings-${token}-${l}.md`, "**Severity:** medium\n");
      }
      const r = runScript([
        `DATE=${token}`,
        "ITER=1",
        'SELECTED_LEGS="linear  jira"',
        "for _ONE in 1; do",
        greenFence(),
        "done",
        'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
      ]);
      expect({ green: r.stdout.includes("STATUS=[green]"), aborted: r.status !== 0 }).toEqual({
        green: true,
        aborted: false,
      });
    } finally {
      for (const l of SMOKE_LEGS) {
        rmSync(`/tmp/dpt-smoke-findings-${token}-${l}.md`, { force: true });
      }
      dispose();
    }
  });

  test("WITNESS: the abort is WRITTEN, not inherited from grep's exit status", () => {
    // AC.5's whole point. Before this FR a missing file produced no abort at
    // all: `grep -c` printed nothing, `[ "" -eq 0 ]` was a test(1) usage error,
    // and the green branch was skipped as a side effect. The run continued.
    //
    // Strip the explicit existence check and that ACCIDENTAL behaviour is what
    // comes back — no abort, exit 0. The mutation therefore separates "the
    // fence expresses the intent" from "the shell happened to do the right
    // thing", which no prose grep and no not-green assertion can do: both the
    // guarded and unguarded fences fail to report green.
    // Strips BOTH explicit guards — the existence check and the
    // not-an-integer normalization — because together they are what replaced
    // the accident. Leaving either in place would still abort, just with a
    // different message, and the witness would then be measuring which guard
    // fired rather than whether any guard exists.
    //
    // Surgical: collapse each guarded block back to its bare counting line,
    // leaving every OTHER `if`/`fi` in the fence intact. The first attempt
    // stripped the guard openers and then every `^fi` line, which also closed
    // out the empty-selection refusal and the green fold — bash reported a
    // syntax error, the run exited non-zero, and that read as "the guard is
    // still aborting" when in fact nothing under test had run at all. Recorded
    // because it is § 0b's hazard in its subtler form: the mutation applied,
    // it just applied to more than it named.
    const stripGuard = (fence: string) =>
      mutate(
        fence,
        /if \[ ! -f "\/tmp\/dpt-smoke-findings-\$\{DATE\}-[a-z]+\.md" \]; then MISSING_FINDINGS="\$\{MISSING_FINDINGS\} [a-z]+"; else\n(HIGH_[A-Z]+=\$\(grep -c [^\n]*)\ncase "\$\{HIGH_[A-Z]+\}" in [^\n]*\nfi\n/g,
        "$1\n",
      );

    const findings: Findings = { ...allLegs(0), [SMOKE_LEGS[1]!]: "absent" };

    const guarded = runGreen({ selected: SMOKE_LEGS, findings });
    expect({ aborted: aborted(guarded), green: reportedGreen(guarded) }).toEqual({
      aborted: true,
      green: false,
    });

    // The MUTANT is measured PER SHELL, because its residual behaviour is
    // genuinely shell-dependent and averaging the two would hide the point.
    //
    // STE-565, measured when this file gained its second interpreter: the
    // "fail-closed by luck" the original comment recorded is BASH-ONLY luck.
    // With the guard stripped, bash leaves STATUS unset and zsh reports
    // `green` — a false green on a run with a missing findings file. The guard
    // is therefore not a nicety that buys a louder message; on the shell an
    // agent actually runs, it is the only thing standing between a missing
    // artifact and a green verdict.
    for (const shell of availableFenceShells()) {
      const unguarded = runGreen({ selected: SMOKE_LEGS, findings, mutation: stripGuard, shell });
      expect(aborted(unguarded)).toBe(false);
      expect(unguarded.stdout).not.toContain("Aborting");
    }

    const perShellGreen = availableFenceShells().map((shell) => ({
      shell,
      green: reportedGreen(runGreen({ selected: SMOKE_LEGS, findings, mutation: stripGuard, shell })),
    }));
    // Recorded as a measurement rather than asserted as a uniform property:
    // whatever each shell does, the GUARDED fence above aborts in both, which
    // is the property this AC is actually about.
    expect(perShellGreen.find((r) => r.shell === "bash")?.green ?? false).toBe(false);
    if (perShellGreen.some((r) => r.shell === "zsh")) {
      expect(perShellGreen.find((r) => r.shell === "zsh")!.green).toBe(true);
    }
  });
});

describeIfLoop("AC-STE-452.7 + AC-STE-452.8 — a reduced --legs run reaches a verdict", () => {
  /**
   * Run the documented RC-collection fence against materialized rc-files.
   *
   * `absent` means no file at all — which is precisely what an UNSELECTED leg
   * leaves behind, since its brace group never ran.
   */
  function runRc(opts: {
    selected: readonly string[];
    rcs: Readonly<Record<string, string | "absent">>;
  }): Outcome {
    const { token, dispose } = freshToken("ste452rc");
    const paths = Object.keys(opts.rcs).map(
      (leg) => `/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.rc`,
    );
    try {
      for (const [leg, value] of Object.entries(opts.rcs)) {
        if (value === "absent") continue;
        writeFileSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.rc`, value);
      }
      return runScript([
        `DATE=${token}`,
        "ITER=1",
        `SELECTED_LEGS="${opts.selected.join(" ")}"`,
        rcFence(),
        'echo "RC-GATE-PASSED"',
      ]);
    } finally {
      for (const p of paths) rmSync(p, { force: true });
      dispose();
    }
  }

  const reachedEnd = (r: Outcome) => r.stdout.includes("RC-GATE-PASSED");

  test("HEADLINE: a single-leg selection passes RC collection with the other legs' rc-files ABSENT", () => {
    // This is the defect STE-447 shipped and this FR is obliged to close.
    // Before the fix this run printed
    //   `/conformance-loop: Phase A subprocess failed (linear=0, jira=1, none=1). Aborting.`
    // at rc 1 — naming a subprocess failure for two legs that were never
    // spawned, before aggregation and before the capture-only short-circuit.
    for (const leg of SMOKE_LEGS) {
      const rcs = Object.fromEntries(
        SMOKE_LEGS.map((l) => [l, l === leg ? "0" : ("absent" as const)]),
      );
      const r = runRc({ selected: [leg], rcs });
      expect({ leg, reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
        leg,
        reached: true,
        aborted: false,
      });
    }
  });

  test("an UNSELECTED leg's absent rc-file is a no-op; a SELECTED leg's is still an abort", () => {
    // The two cases that were indistinguishable before the selection reached
    // this gate. Same disk state, opposite correct answers.
    const twoLegs = [SMOKE_LEGS[0]!, SMOKE_LEGS[1]!];

    const unselectedAbsent = runRc({
      selected: twoLegs,
      rcs: { [twoLegs[0]!]: "0", [twoLegs[1]!]: "0", [SMOKE_LEGS[2]!]: "absent" },
    });
    expect(reachedEnd(unselectedAbsent)).toBe(true);

    const selectedAbsent = runRc({
      selected: twoLegs,
      rcs: { [twoLegs[0]!]: "0", [twoLegs[1]!]: "absent" },
    });
    expect({ reached: reachedEnd(selectedAbsent), aborted: aborted(selectedAbsent) }).toEqual({
      reached: false,
      aborted: true,
    });
  });

  test("a selected leg's non-zero rc still aborts under a reduced selection", () => {
    const r = runRc({ selected: [SMOKE_LEGS[0]!], rcs: { [SMOKE_LEGS[0]!]: "4" } });
    expect(aborted(r)).toBe(true);
    expect(r.stdout).toContain(`${SMOKE_LEGS[0]}=4`);
  });

  test("a selected leg's EMPTY rc still aborts under a reduced selection", () => {
    // The STE-420 fail-open the guards file exists for, re-checked inside the
    // membership wrapper — a guard that stops firing when it is wrapped is the
    // regression this whole edit risks.
    const r = runRc({ selected: [SMOKE_LEGS[0]!], rcs: { [SMOKE_LEGS[0]!]: "" } });
    expect(aborted(r)).toBe(true);
  });

  test("an EMPTY selection ABORTS at both gates — it never reports a clean pass", () => {
    // The degenerate case one level up from a missing findings file. Pre-flight
    // (0) refuses an empty selection, so reaching either gate with one means
    // the fence is running outside the sanctioned path; treating it as "no legs
    // to check, therefore fine" is the vacuous green this milestone exists to
    // close.
    const rc = runRc({ selected: [], rcs: { [SMOKE_LEGS[0]!]: "0" } });
    expect({ reached: reachedEnd(rc), aborted: aborted(rc) }).toEqual({
      reached: false,
      aborted: true,
    });

    const green = runGreen({ selected: [], findings: allLegs(0) });
    expect({ green: reportedGreen(green), aborted: aborted(green) }).toEqual({
      green: false,
      aborted: true,
    });
  });

  test("AC.8 BOTH HALVES: a reduced run reaches a verdict, and never greens on a missing selected file", () => {
    // Half one — it must FAIL if a reduced run aborts.
    const selected = [SMOKE_LEGS[0]!, SMOKE_LEGS[2]!];
    const rcs = Object.fromEntries(
      SMOKE_LEGS.map((l) => [l, selected.includes(l) ? "0" : ("absent" as const)]),
    );
    const rc = runRc({ selected, rcs });
    expect(aborted(rc)).toBe(false);

    const findings = Object.fromEntries(
      selected.map((l) => [l, 0]),
    ) as Findings; // unselected legs deliberately absent from disk
    const verdict = runGreen({ selected, findings });
    expect({ green: reportedGreen(verdict), aborted: aborted(verdict) }).toEqual({
      green: true,
      aborted: false,
    });

    // Half two — it must FAIL if that same reduced run reports green while a
    // SELECTED leg's findings file is missing. An implementation that reached a
    // verdict by ignoring absent files would satisfy half one and violate AC.4;
    // this is the assertion that refuses to let those two be traded off.
    const holed = runGreen({
      selected,
      findings: { [selected[0]!]: 0, [selected[1]!]: "absent" },
    });
    expect({ green: reportedGreen(holed), aborted: aborted(holed) }).toEqual({
      green: false,
      aborted: true,
    });
  });

  test("AC.7 — the reduced-run outcome is recorded as exactly one of the two tokens", () => {
    // Modelled on AC-STE-446.6's construction, which worked: an inherited
    // question you cannot close the FR without answering. Section-scoped to
    // `## Implementation notes` on purpose — BOTH tokens appear in AC.7's own
    // text further up the same file, so a whole-file search would report two
    // hits for any outcome and pass no matter what was decided.
    const fr = readIfPresent(FR_PATH);
    expect(fr).not.toBeNull();
    // Anchored to the HEADING, at line start — not to the string anywhere.
    // AC.7's own text names `## Implementation notes` inline while instructing
    // where the token goes, so a plain indexOf resolves to the acceptance
    // criterion and slices in both tokens. Measured: it reported 2 present and
    // would have reported 2 for every possible outcome, which is a scope that
    // can neither pass nor fail for the right reason.
    const heading = /^## Implementation notes$/m.exec(fr!);
    expect(heading).not.toBeNull();
    const notes = fr!.slice(heading!.index);

    const tokens = ["reduced_run_reaches_verdict", "reduced_run_still_aborts"] as const;
    const present = tokens.filter((t) => notes.includes(t));
    expect(present).toHaveLength(1);

    // The `still_aborts` form owes a surface and a reason on the same line.
    if (present[0] === "reduced_run_still_aborts") {
      const line = notes
        .split(/\r?\n/)
        .find((l) => l.includes("reduced_run_still_aborts"))!;
      expect(line.length).toBeGreaterThan("reduced_run_still_aborts".length + 40);
    }
  });
});

describeIfLoop("AC-STE-452.6 — the no-progress probe, under the same executed discipline", () => {
  /**
   * Run the documented `no-progress` fence against materialized iteration
   * reports and synthetic before/after HEADs.
   */
  function runNoProgress(opts: {
    prev: string | "absent";
    curr: string | "absent";
    autoFix: "on" | "off";
    headBefore: string;
    headAfter: string;
  }): Outcome {
    const { token, dispose } = freshToken("ste452np");
    const prevPath = `/tmp/dpt-conformance-loop-${token}-iter-1.md`;
    const currPath = `/tmp/dpt-conformance-loop-${token}-iter-2.md`;
    try {
      if (opts.prev !== "absent") writeFileSync(prevPath, opts.prev);
      if (opts.curr !== "absent") writeFileSync(currPath, opts.curr);
      return runScript([
        `DATE=${token}`,
        "ITER=2",
        `AUTO_FIX=${opts.autoFix}`,
        `HEAD_BEFORE_PHASE_B=${opts.headBefore}`,
        `HEAD_AFTER_PHASE_B=${opts.headAfter}`,
        "for _ONE in 1; do",
        noProgressFence(),
        "done",
        'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
      ]);
    } finally {
      rmSync(prevPath, { force: true });
      rmSync(currPath, { force: true });
      dispose();
    }
  }

  const stalled = (r: Outcome) => r.stdout.includes("STATUS=[no-progress]");

  test("byte-identical aggregated reports across iterations report no-progress", () => {
    const same = "# findings\n\n### F1 — a\n**Severity:** high\n";
    expect(stalled(runNoProgress({
      prev: same, curr: same, autoFix: "off", headBefore: "aaa", headAfter: "aaa",
    }))).toBe(true);
  });

  test("a report that CHANGED between iterations does not report no-progress", () => {
    expect(stalled(runNoProgress({
      prev: "# findings\n\n### F1 — a\n",
      curr: "# findings\n\n### F1 — a\n### F2 — b\n",
      autoFix: "off",
      headBefore: "aaa",
      headAfter: "aaa",
    }))).toBe(false);
  });

  test("a one-byte difference is enough — the comparison is byte-exact, not fuzzy", () => {
    expect(stalled(runNoProgress({
      prev: "identical\n", curr: "identical \n", autoFix: "off",
      headBefore: "aaa", headAfter: "aaa",
    }))).toBe(false);
  });

  test("iteration 1 — no previous report to compare — does not report no-progress", () => {
    expect(stalled(runNoProgress({
      prev: "absent", curr: "# findings\n", autoFix: "off",
      headBefore: "aaa", headAfter: "aaa",
    }))).toBe(false);
  });

  test("an ABSENT current report does not manufacture a no-progress verdict", () => {
    // `cmp` against a file that is not there fails, so the branch is skipped.
    // Asserted rather than assumed: the failure mode worth excluding is a
    // comparison that treats "both unreadable" as "identical".
    expect(stalled(runNoProgress({
      prev: "# findings\n", curr: "absent", autoFix: "off",
      headBefore: "aaa", headAfter: "aaa",
    }))).toBe(false);
    expect(stalled(runNoProgress({
      prev: "absent", curr: "absent", autoFix: "off",
      headBefore: "aaa", headAfter: "aaa",
    }))).toBe(false);
  });

  test("under --auto-fix, an unmoved HEAD after Phase B reports no-progress", () => {
    expect(stalled(runNoProgress({
      prev: "a\n", curr: "b\n", autoFix: "on",
      headBefore: "deadbeef", headAfter: "deadbeef",
    }))).toBe(true);
  });

  test("under --auto-fix, a HEAD that ADVANCED does not report no-progress", () => {
    expect(stalled(runNoProgress({
      prev: "a\n", curr: "b\n", autoFix: "on",
      headBefore: "deadbeef", headAfter: "cafef00d",
    }))).toBe(false);
  });

  test("with --auto-fix OFF, an unmoved HEAD is NOT a no-progress signal", () => {
    // The HEAD sub-probe is gated on the mode, and the gate is load-bearing:
    // in capture-only nothing is ever committed, so an unmoved HEAD is the
    // normal case rather than evidence of a stalled fixer.
    expect(stalled(runNoProgress({
      prev: "a\n", curr: "b\n", autoFix: "off",
      headBefore: "deadbeef", headAfter: "deadbeef",
    }))).toBe(false);
  });

  test("WITNESS: `cmp -s` is load-bearing — neutralizing it stalls a run that progressed", () => {
    // Guards against the comparison being replaced by something that is always
    // true. If this witness stops reporting no-progress, the probe no longer
    // decides on file contents at all.
    const { token, dispose } = freshToken("ste452npw");
    const prevPath = `/tmp/dpt-conformance-loop-${token}-iter-1.md`;
    const currPath = `/tmp/dpt-conformance-loop-${token}-iter-2.md`;
    try {
      writeFileSync(prevPath, "a\n");
      writeFileSync(currPath, "COMPLETELY DIFFERENT\n");
      const r = runScript([
        `DATE=${token}`,
        "ITER=2",
        "AUTO_FIX=off",
        "HEAD_BEFORE_PHASE_B=aaa",
        "HEAD_AFTER_PHASE_B=bbb",
        "for _ONE in 1; do",
        mutate(noProgressFence(), /cmp -s/, "true"),
        "done",
        'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
      ]);
      expect(r.stdout).toContain("STATUS=[no-progress]");
    } finally {
      rmSync(prevPath, { force: true });
      rmSync(currPath, { force: true });
      dispose();
    }
  });
});

describeIfLoop("AC-STE-452.7 — the driver's own prose no longer describes the surfaces as unadapted", () => {
  // The survey that preceded this FR found the paragraph documenting the defect
  // to be pinned by NOTHING — a whole region of operative prose that could be
  // rewritten, or left stale, with the suite none the wiser. These are positive
  // pins (Pattern 31's rider: assert the good form is present rather than
  // banning the bad one, because "does nothing at all" satisfies a ban).

  /**
   * The BULLET LINES of the surface list, and nothing else.
   *
   * The first version of this helper sliced 3000 characters from the anchor
   * sentence and asked whether four nouns appeared anywhere inside. Three
   * independent reviewers demonstrated that predicate to be vacuous, and the
   * demonstration is worth keeping: rewriting all four bullets to say the
   * surfaces still count the REGISTERED set left the test green, the whole
   * gate green, and the sibling ban green. Two of the four nouns were not even
   * supplied by the bullets — the SUPERSEDED history paragraph inside the same
   * window contains "could never reach `green`" and "**before** aggregation",
   * so deleting those two bullets outright also passed.
   *
   * That is precisely the failure this milestone exists to remove, landing in
   * a test written to enforce it. The repair is to bind each surface's own
   * bullet to its own predicate, and to exclude the explanatory prose from the
   * pin's reach so it cannot donate the words being checked for.
   */
  /** A window of the driver starting at a literal anchor, with the anchor asserted to resolve. */
  function section(anchor: string, len: number): string {
    const at = loop!.indexOf(anchor);
    expect({ anchor, found: at > -1 }).toEqual({ anchor, found: true });
    return loop!.slice(at, at + len);
  }

  function surfaceBullets(): string[] {
    const start = loop!.indexOf("`SELECTED_LEGS` is the leg set for the rest of the invocation");
    expect(start).toBeGreaterThan(-1);
    const window = loop!.slice(start, start + 3000);
    return window.split(/\r?\n/).filter((l) => l.startsWith("- "));
  }

  test("each adapted surface's own bullet predicates the SELECTION, not the registry", () => {
    const bullets = surfaceBullets();
    // Non-vacuity first: if the slice stops finding bullets, every per-surface
    // assertion below would pass by iterating nothing.
    expect(bullets.length).toBeGreaterThanOrEqual(5);

    const surfaces = [
      { name: "rc-collection", re: /rc-collection gate/i },
      { name: "green probe", re: /`green` termination probe/i },
      { name: "leg-completeness", re: /leg-completeness check/i },
      { name: "aggregation", re: /^- \*\*Aggregation\*\*/i },
    ];
    const verdicts = surfaces.map(({ name, re }) => {
      const bullet = bullets.find((b) => re.test(b));
      return {
        name,
        found: bullet !== undefined,
        saysSelected: bullet === undefined ? false : /selected/i.test(bullet),
        saysRegistered: bullet === undefined ? false : /registered/i.test(bullet),
      };
    });
    expect(verdicts).toEqual(
      surfaces.map(({ name }) => ({
        name,
        found: true,
        saysSelected: true,
        saysRegistered: false,
      })),
    );
  });

  test("the poll loop's bullet is the ONE that still says registered — and says why", () => {
    // The counterpart to the test above, and the reason it is not simply "no
    // bullet may say registered". The poll loop is deliberately left iterating
    // the registered set because it is safe by construction, and a pin that
    // banned the word outright would push a correct exemption into hiding.
    const poll = surfaceBullets().find((b) => /bounded poll loop/i.test(b));
    expect(poll).toBeDefined();
    expect(poll!).toMatch(/registered/i);
    expect(poll!).toMatch(/safe by construction|deliberately/i);
  });

  test("the OPERATIVE leg-completeness and aggregation instructions predicate the SELECTION", () => {
    // AUDIT finding, and the sharpest one against this FR. The pins above bind
    // the five SUMMARY bullets in the pre-flight (0) paragraph. The
    // instructions a model actually EXECUTES are ~480 lines further down, and
    // reverting either of those to the registered wording turned nothing red
    // while the summary bullet kept saying "selected" — the document would
    // have contradicted itself with the gate green.
    //
    // These two surfaces have no shell form, so this text IS the mechanism.
    // Pinning the summary of a mechanism instead of the mechanism is the same
    // error as pinning prose that describes a guard the adjacent snippet does
    // not implement, which is the error this whole FR exists to remove.
    const completeness = section("**Leg-completeness check", 1200);
    expect(completeness).toMatch(/one per SELECTED leg/);
    expect(completeness).toMatch(/unselected leg .*owes no log set|spawned no child/i);

    const aggregation = section("**Aggregation.**", 1200);
    expect(aggregation).toMatch(/every SELECTED leg's child/i);
    expect(aggregation).toMatch(/One file per \*\*selected\*\* leg/i);
    // Each per-leg source bullet states its own membership condition, so
    // dropping the condition from ONE leg is caught rather than averaged away.
    for (const leg of SMOKE_LEGS) {
      expect(aggregation).toContain(`Read only when \`${leg}\` is in \`SELECTED_LEGS\``);
    }
  });

  test("the closing-summary table states that an unselected leg renders — and never 0", () => {
    // AUDIT finding. This rule is the FR's own thesis one layer up: it is the
    // only thing stopping "no evidence" being rendered as "clean" in the
    // operator's summary. `closing-summary-columns` pins the column HEADERS
    // (STE-446); nothing pinned the cell content, and it is new operative prose
    // this FR introduced.
    const summary = section("One `high (<leg>)` column per registered leg", 2000);
    expect(summary).toMatch(/render `—` \(not run\), never `0`/);
    // The reason, not just the rule — a bare rule invites a future editor to
    // "simplify" it to 0 for a tidier table.
    expect(summary).toMatch(/examined and found clean|no-evidence/i);
  });

  test("the retired 'not adapted' claim survives only inside the labelled correction", () => {
    // Narrowed rather than banned outright, per Pattern 31: the settled remedy
    // in this codebase is to scope the pin, never to delete the documentation.
    //
    // Two repairs over the first draft, both from review. The exemption used to
    // admit any line naming `STE-452`, so the retired operative claim could be
    // reinstated verbatim as long as the sentence also named the FR that
    // retired it. And a ban alone is satisfied by deleting the corrective
    // paragraph entirely — Pattern 31's rider says to pair it with something
    // strictly stronger, so the positive half below is not optional.
    const offenders = loop!
      .split(/\r?\n/)
      .filter((l) => /NOT adapted to a partial selection/.test(l))
      .filter((l) => !/^> \*\*SUPERSEDED/.test(l));
    expect(offenders).toEqual([]);

    // Strictly stronger half: the correction must actually be present.
    expect(loop!).toMatch(/^> \*\*SUPERSEDED — corrected by STE-452\.\*\*/m);
  });
});

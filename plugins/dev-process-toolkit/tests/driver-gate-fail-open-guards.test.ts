// Driver gate fail-open guards — three gates that answered "pass" when they
// could not read their own input.
//
// Post-release review of the M116 + M117 branch (v2.56.1 "Keystone" and
// v2.57.0 "Litmus") found the same defect shape in three places, each one
// introduced or left standing by the very FRs whose purpose was to kill
// can't-fail checks. In all three the gate does not decide "fail" on a
// malformed reading — it decides nothing, and the caller reads that as a pass.
//
//   (A) /conformance-loop RC collection. STE-420 replaced `echo $? > rc-file`
//       (which always wrote an integer) with a `bun … reconcile > rc-file`
//       redirect. The redirect creates the file BEFORE bun runs, so any
//       invocation producing no stdout leaves 0 bytes. The consumer read it as
//       `$(cat … || echo 1)` — and `cat` SUCCEEDS on an existing empty file, so
//       the `|| echo 1` never fires, RC is empty, and `[ "" -ne 0 ]` is a
//       test(1) usage error whose non-zero status SKIPS the abort branch. Same
//       dead-gate outcome STE-420 exists to eliminate, by a quieter route.
//
//   (B) smoke_verdict emit --outcome. An unrecognized value fell to
//       `undefined`, and `buildSmokeVerdict` then computed `pass`. Measured:
//       `--outcome FAIL` wrote `{"outcome":"pass"}` at rc=0, silently, and so
//       did `abrt`, `failed`, `Abort` and `fail (rc=1)`. The asymmetry was the
//       tell — a MISSING `--tracker` already produced a loud usage error and
//       exit 2, but a bad value on the one flag carrying the entire verdict was
//       discarded without a word.
//
//   (C) Phase 8 coverage gate. `[ -s "$FIXTURE" ]` is a SIZE test on a
//       DAY-KEYED path. A second run on the same day whose spawn is denied
//       finds the earlier run's non-empty capture at the identical path and
//       counts it. Reachable, not theoretical: STE-425's disposal rule keeps
//       those captures on disk on purpose, and the capture convention already
//       concedes the day key "cannot separate two legs that ran on the same
//       day". Seven such captures (105–447 KB, 2026-07-27) were on disk when
//       this was found.
//
// EVERY assertion below EXECUTES the documented artifact rather than grepping
// it: the shell snippets are extracted from the SKILL bodies and run, and the
// CLI is spawned. A grep would pass against prose that describes a guard the
// snippet does not implement — which is the class of check this file exists to
// replace, so it may not be the class of check this file is built from.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");
const SMOKE_SKILL = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const VERDICT_CLI = join(pluginRoot, "adapters", "_shared", "src", "smoke_verdict.ts");

/**
 * The driver SKILLs are repo-local dogfood skills, not shipped plugin skills.
 * A consumer project running this suite from an installed plugin has no
 * `.claude/skills/` tree, so those describes skip rather than fail — the same
 * `readIfPresent` shape `m116-ste-420-verdict-artifact.test.ts` uses.
 */
function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const smoke = readIfPresent(SMOKE_SKILL);
const describeIfLoop = loop ? describe : describe.skip;
const describeIfSmoke = smoke ? describe : describe.skip;

/** Every ```bash fence body in a SKILL, in document order. */
function bashFences(body: string): string[] {
  return [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

// ===========================================================================
// (A) /conformance-loop RC collection — an unreadable rc is a failure.
// ===========================================================================

describeIfLoop("(A) RC collection: an rc-file it cannot read is never a pass", () => {
  /** The documented RC-collection fence: the one assigning RC_LINEAR. */
  function rcFence(): string {
    return bashFences(loop!).find((f) => f.includes("RC_LINEAR=")) ?? "";
  }

  /**
   * Run the documented RC-collection snippet against materialized rc-files.
   * `undefined` means the file is absent. Returns the snippet's exit status and
   * stdout — the abort branch is the one that exits non-zero.
   *
   * The snippet hard-codes `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-…`,
   * so DATE carries a per-invocation token instead of a date: the real path
   * shape is what is under test, and two concurrent runs of this suite must not
   * meet in /tmp.
   */
  let seq = 0;
  function runRcGate(
    linear: string | undefined,
    jira: string | undefined,
  ): { status: number; stdout: string } {
    const token = `guardtest-${process.pid}-${seq++}`;
    const paths = {
      linear: `/tmp/dpt-conformance-loop-${token}-iter-1-linear.rc`,
      jira: `/tmp/dpt-conformance-loop-${token}-iter-1-jira.rc`,
    };
    try {
      if (linear !== undefined) writeFileSync(paths.linear, linear);
      if (jira !== undefined) writeFileSync(paths.jira, jira);
      const script = [`DATE=${token}`, "ITER=1", rcFence()].join("\n");
      const proc = Bun.spawnSync(["bash", "-c", script]);
      return {
        status: proc.exitCode,
        stdout: new TextDecoder().decode(proc.stdout).trim(),
      };
    } finally {
      rmSync(paths.linear, { force: true });
      rmSync(paths.jira, { force: true });
    }
  }

  test("slice sanity: the RC-collection fence anchors and still carries its abort branch", () => {
    const fence = rcFence();
    expect(fence.length).toBeGreaterThan(100);
    expect(fence).toContain("RC_JIRA");
    expect(fence).toMatch(/-ne 0/);
    expect(fence).toContain("exit 1");
  });

  test("DISCRIMINATOR: two clean legs still pass (the gate is not stuck closed)", () => {
    const r = runRcGate("0", "0");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  // --- the regression this file exists for --------------------------------

  test("REGRESSION: an EMPTY linear rc-file aborts instead of falling through", () => {
    // `cat` exits 0 on an existing empty file, so the old `|| echo 1` never
    // fired and `[ "" -ne 0 ]` skipped the abort. Verified failing open in
    // bash, zsh and sh before the fix.
    const r = runRcGate("", "0");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("Aborting");
  });

  test("REGRESSION: an EMPTY jira rc-file aborts too (both legs, not just the first)", () => {
    const r = runRcGate("0", "");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("Aborting");
  });

  test("REGRESSION: both rc-files empty aborts", () => {
    const r = runRcGate("", "");
    expect(r.status).not.toBe(0);
  });

  test("a NON-INTEGER rc-file aborts — a diagnostic on stdout is not a zero", () => {
    // Same test(1) usage error as the empty case, reached whenever the
    // redirect captures something that is not the reconciled number.
    for (const junk of ["error: bun not found", "warn\n0", "0 ", "-1", "nan"]) {
      const r = runRcGate(junk, "0");
      expect({ junk, status: r.status }).toEqual({ junk, status: r.status });
      expect(r.status).not.toBe(0);
    }
  });

  test("a MISSING rc-file still aborts (the behaviour the old `|| echo 1` bought)", () => {
    expect(runRcGate(undefined, "0").status).not.toBe(0);
    expect(runRcGate("0", undefined).status).not.toBe(0);
  });

  test("a real non-zero rc is preserved, not flattened to 1", () => {
    // `reconcile` maps missing / malformed / stale / non-pass artifacts to
    // DISTINCT non-zero codes, and the SKILL prose promises each "maps to its
    // own". A validator that rewrote every failure to 1 would erase that.
    const r = runRcGate("4", "0");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("linear=4");
  });

  test("the documented prose says an unreadable rc is a failure, not just a missing one", () => {
    // The pinned STE-420 sentence survives; the new clause extends it.
    const clause = loop!.slice(loop!.indexOf("**RC collection"));
    expect(clause).toContain("A missing rc-file after exit is treated as a failure");
    expect(clause.slice(0, 2000)).toMatch(/plain integer/i);
  });
});

// ===========================================================================
// (B) smoke_verdict emit --outcome — an unrecognized value is rejected loudly.
// ===========================================================================

describe("(B) smoke_verdict emit: a bad --outcome is an error, not a pass", () => {
  function runEmit(args: readonly string[]): {
    status: number;
    stdout: string;
    stderr: string;
    artifact: string | null;
  } {
    const dir = mkdtempSync(join(tmpdir(), "verdict-outcome-"));
    const path = join(dir, "verdict.json");
    try {
      const proc = Bun.spawnSync([
        "bun",
        VERDICT_CLI,
        "emit",
        "--tracker",
        "linear",
        "--path",
        path,
        ...args,
      ]);
      return {
        status: proc.exitCode,
        stdout: new TextDecoder().decode(proc.stdout).trim(),
        stderr: new TextDecoder().decode(proc.stderr).trim(),
        artifact: existsSync(path) ? readFileSync(path, "utf-8") : null,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Every one of these was MEASURED writing `{"outcome":"pass"}` at rc=0.
  const WRONG_SPELLINGS = ["FAIL", "failed", "Abort", "abrt", "fail (rc=1)", "PASS", ""];

  for (const bad of WRONG_SPELLINGS) {
    test(`REGRESSION: --outcome ${JSON.stringify(bad)} exits 2 and writes nothing`, () => {
      const r = runEmit(["--outcome", bad]);
      expect(r.status).toBe(2);
      // The artifact is the thing a downstream reconcile reads. A rejected
      // invocation must not leave one — a `pass` file beside a rejection is
      // the same fail-open by another route.
      expect(r.artifact).toBeNull();
      expect(r.stderr).toContain("--outcome");
      expect(r.stderr).toMatch(/pass \| fail \| abort/);
    });
  }

  test("the rejection matches the --tracker treatment it was asymmetric with", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-tracker-"));
    try {
      const proc = Bun.spawnSync(["bun", VERDICT_CLI, "emit"]);
      expect(proc.exitCode).toBe(2);
      expect(new TextDecoder().decode(proc.stderr)).toContain("usage:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- non-vacuity: the three real values and the ABSENT mode still work ----

  for (const good of ["pass", "fail", "abort"] as const) {
    test(`DISCRIMINATOR: --outcome ${good} is accepted and recorded`, () => {
      const r = runEmit(["--outcome", good]);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.artifact!).outcome).toBe(good);
    });
  }

  test("DISCRIMINATOR: an ABSENT --outcome is still supported and computes from the triggers", () => {
    // The usage line spells the flag optional and `buildSmokeVerdict` takes
    // `declared?`. Rejecting absence would break the documented emit path;
    // this asserts the fix did not overreach into that.
    const clean = runEmit([]);
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.artifact!).outcome).toBe("pass");

    const armed = runEmit(["--chain-finding", "chain truncated at /implement"]);
    expect(armed.status).toBe(0);
    const verdict = JSON.parse(armed.artifact!);
    expect(verdict.outcome).toBe("abort");
    expect(verdict.trigger).toContain("chain truncated at /implement");
  });
});

// ===========================================================================
// (C) Phase 8 coverage gate — presence is dated, not just measured.
// ===========================================================================

describeIfSmoke("(C) Phase 8 coverage: a predecessor's capture is not this run's", () => {
  const COVERAGE_BEGIN = "# BEGIN phase-8 coverage gate";
  const COVERAGE_END = "# END phase-8 coverage gate";
  const IN_SCOPE = ["setup", "brainstorm", "spec-write", "report-issue"] as const;

  /** `/bin/bash`'s `-nt` compares WHOLE SECONDS on macOS; never race the clock. */
  const SKEW_S = 2;

  function phase8Fence(): string {
    return bashFences(smoke!).find((f) => f.includes(COVERAGE_BEGIN)) ?? "";
  }

  function coverageGateSnippet(): string {
    const lines = phase8Fence().split("\n");
    const begin = lines.findIndex((l) => l.includes(COVERAGE_BEGIN));
    const end = lines.findIndex((l) => l.includes(COVERAGE_END));
    if (begin === -1 || end === -1 || end <= begin) return "";
    return lines.slice(begin + 1, end).join("\n");
  }

  /**
   * Seed a fixture dir and run the documented gate.
   * `fresh` — captures this run produced (dated after the phase-start stamp).
   * `stale` — captures an EARLIER run of this leg left on the SAME calendar
   *   day: non-empty, at the identical day-keyed path, dated before the stamp.
   */
  function runGate(opts: {
    fresh?: readonly string[];
    stale?: readonly string[];
    stamp?: "present" | "absent";
  }): string {
    const dir = mkdtempSync(join(tmpdir(), "phase8-freshness-"));
    const stamp = join(dir, ".phase8-start");
    try {
      writeFileSync(stamp, "");
      const baseS = Math.floor(statSync(stamp).mtimeMs / 1000);
      const seed = (skills: readonly string[], delta: number) => {
        for (const skill of skills) {
          const p = join(dir, `${skill}-linear-2026-07-27.json`);
          writeFileSync(p, '{"type":"result","subtype":"success"}\n');
          utimesSync(p, baseS + delta, baseS + delta);
        }
      };
      seed(opts.stale ?? [], -SKEW_S);
      seed(opts.fresh ?? [], SKEW_S);
      const script = [
        `FIXTURE_DIR=${JSON.stringify(dir)}`,
        "TRACKER=linear",
        "DATE=2026-07-27",
        opts.stamp === "absent" ? "PHASE8_STAMP=" : `PHASE8_STAMP=${JSON.stringify(stamp)}`,
        coverageGateSnippet(),
      ].join("\n");
      const proc = Bun.spawnSync(["bash", "-c", script]);
      return new TextDecoder().decode(proc.stdout).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("slice sanity: the sentinel-delimited gate still anchors", () => {
    expect(coverageGateSnippet().trim().length).toBeGreaterThan(0);
    expect(coverageGateSnippet()).toContain("PHASE8_STAMP");
  });

  test("DISCRIMINATOR: four fresh captures are a complete run", () => {
    expect(runGate({ fresh: IN_SCOPE })).toBe("PHASE8-COVERAGE: complete — 4/4 fixtures");
  });

  test("REGRESSION: a denied spawn does NOT inherit the same day's earlier capture", () => {
    // The reachable shape. Run 1 covered all four and its captures are still on
    // disk (STE-425 keeps them). Run 2's report-issue spawn is denied one layer
    // out — the Bash call itself refused, so no shell ran and no redirect
    // truncated anything. Size says "covered"; the bytes are run 1's.
    const out = runGate({
      fresh: ["setup", "brainstorm", "spec-write"],
      stale: ["report-issue"],
    });
    expect(out).toBe("PHASE8-COVERAGE: incomplete — missing report-issue");
    expect(out).not.toMatch(/COVERAGE: complete\b/);
  });

  test("REGRESSION: a wholly denied rotation cannot inherit a complete predecessor", () => {
    // The worst case: every capture on disk belongs to an earlier run.
    const out = runGate({ stale: IN_SCOPE });
    expect(out).toBe(
      "PHASE8-COVERAGE: incomplete — missing setup brainstorm spec-write report-issue",
    );
  });

  test("an unusable stamp withholds the verdict instead of granting it", () => {
    // `-nt` against a nonexistent second operand is TRUE for every existing
    // file, so a gate that skipped this branch would fail open harder than the
    // bug it replaced.
    const out = runGate({ fresh: IN_SCOPE, stamp: "absent" });
    expect(out).toMatch(/^PHASE8-COVERAGE: unusable\b/);
    expect(out).not.toMatch(/COVERAGE: complete\b/);
  });

  test("COVERAGE_OK is 0 on both refusal shapes, so the aggregate cannot pass", () => {
    // The gate's stdout is for the operator; COVERAGE_OK is what the hard-fail
    // line reads. Assert the variable, not just the message.
    for (const opts of [
      { fresh: ["setup"], stale: ["brainstorm", "spec-write", "report-issue"] },
      { fresh: IN_SCOPE, stamp: "absent" as const },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "phase8-ok-"));
      const stamp = join(dir, ".phase8-start");
      try {
        writeFileSync(stamp, "");
        const baseS = Math.floor(statSync(stamp).mtimeMs / 1000);
        for (const skill of opts.fresh ?? []) {
          const p = join(dir, `${skill}-linear-2026-07-27.json`);
          writeFileSync(p, "{}\n");
          utimesSync(p, baseS + SKEW_S, baseS + SKEW_S);
        }
        for (const skill of (opts as { stale?: readonly string[] }).stale ?? []) {
          const p = join(dir, `${skill}-linear-2026-07-27.json`);
          writeFileSync(p, "{}\n");
          utimesSync(p, baseS - SKEW_S, baseS - SKEW_S);
        }
        const script = [
          `FIXTURE_DIR=${JSON.stringify(dir)}`,
          "TRACKER=linear",
          "DATE=2026-07-27",
          opts.stamp === "absent" ? "PHASE8_STAMP=" : `PHASE8_STAMP=${JSON.stringify(stamp)}`,
          coverageGateSnippet(),
          'echo "COVERAGE_OK=${COVERAGE_OK}"',
        ].join("\n");
        const proc = Bun.spawnSync(["bash", "-c", script]);
        expect(new TextDecoder().decode(proc.stdout)).toContain("COVERAGE_OK=0");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("the phase-start stamp is created BEFORE the rotation it dates", () => {
    // A stamp written after the spawns would be newer than every capture and
    // would fail every run closed. Order is the whole contract.
    const fence = phase8Fence();
    const stampAt = fence.indexOf("PHASE8_STAMP=$(mktemp");
    const rotationAt = fence.indexOf("for SKILL in");
    expect(stampAt).toBeGreaterThanOrEqual(0);
    expect(rotationAt).toBeGreaterThan(stampAt);
  });

  test("the stamp is per-run and tracker-scoped, so no earlier run's stamp can be read as this one's", () => {
    const fence = phase8Fence();
    expect(fence).toMatch(/PHASE8_STAMP=\$\(mktemp .*\$\{TRACKER\}\.XXXXXX"?\)/);
  });

  test("prose documents the freshness rule, not just the size one", () => {
    expect(smoke!).toMatch(/newer than the stamp|dated, not just measured/i);
  });
});

// STE-490 — RC collection must read the verdict artifact, not the raw exit code.
//
// THE COLLISION. STE-420 made the leg's exit code CARRY the verdict:
// `reconcileLegRc` returns `RC_VERDICT_NON_PASS = 64` for any non-`pass`
// artifact, which in capture-only mode is the normal outcome of a run that
// found anything. § RC collection, written earlier, aborts the whole iteration
// on ANY non-zero. Both decisions were right when made; together they mean the
// loop cannot reach aggregation on the runs that matter most.
//
// THE FIX UNDER TEST. rc 64 stops being self-describing: at 64 — and ONLY at
// 64 — the gate reads the leg's verdict artifact and lets a
// `{"outcome":"fail","trigger":"declared"}` leg through, while every other
// non-zero code, every unparseable rc-file, and every ARMED-trigger artifact
// still abort. The armed-trigger case is the load-bearing one: an armed abort
// ALSO reconciles to 64, so the exit code alone cannot separate "we found
// findings" from "the chain never completed".
//
// DISCIPLINE. The gate's assertions here EXECUTE the shipped bash fence
// (`tests/m121-ste-452-termination-harness.test.ts` is the precedent and the
// idiom is copied from it — `fenceContaining` + a `bash -c` runner + an
// `RC-GATE-PASSED` epilogue). The verdict artifact is read at its real
// production path, `smokeVerdictPath(leg)`; there is deliberately no env
// override, because inventing one here would make this harness read a file the
// spawn wrapper never writes.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import * as smokeVerdictModule from "../adapters/_shared/src/smoke_verdict";
import {
  RC_VERDICT_NON_PASS,
  formatSmokeVerdict,
  reconcileLegRc,
  smokeVerdictPath,
  type SmokeOutcome,
  type SmokeVerdict,
  type SmokeVerdictRead,
} from "../adapters/_shared/src/smoke_verdict";
import { fenceContaining, mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const VERDICT_CLI = join(pluginRoot, "adapters", "_shared", "src", "smoke_verdict.ts");
const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

/** live-then-archive, the house conditional (m121-ste-452 §, m108-ste-393:99). */
function firstPresent(...paths: readonly string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

const FR_PATH = firstPresent(
  join(repoRoot, "specs", "frs", "STE-490.md"),
  join(repoRoot, "specs", "frs", "archive", "STE-490.md"),
);
const PLAN_PATH = firstPresent(
  join(repoRoot, "specs", "plan", "M128.md"),
  join(repoRoot, "specs", "plan", "archive", "M128.md"),
);

function readIfPresent(path: string | null): string | null {
  return path && existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const describeIfLoop = loop ? describe : describe.skip;

const rcFence = () => fenceContaining(loop!, "RC_LINEAR=");

// ===========================================================================
// The contract surface. `classifyLegRc` does not exist yet, so it is reached
// through the module namespace rather than a named import: a named import of a
// missing export takes the WHOLE file down at load time and every AC below
// would report as one undifferentiated error. This way each clause fails on
// its own line, with its own message.
// ===========================================================================

type LegRcDisposition =
  | { disposition: "pass" }
  | { disposition: "declared-findings" }
  | { disposition: "failure"; reason: string };

const surface = smokeVerdictModule as unknown as {
  classifyLegRc?: (
    rcFileValue: string | number | null | undefined,
    verdict: SmokeVerdictRead,
  ) => LegRcDisposition;
};

function classifyLegRc(
  rcFileValue: string | number | null | undefined,
  verdict: SmokeVerdictRead,
): LegRcDisposition {
  if (typeof surface.classifyLegRc !== "function") {
    throw new Error(
      "adapters/_shared/src/smoke_verdict.ts does not export `classifyLegRc` — " +
        "the AC-STE-490.1/.2/.3 decision rule is unimplemented",
    );
  }
  return surface.classifyLegRc(rcFileValue, verdict);
}

/** An `ok` read carrying the given outcome (and trigger, when one is named). */
function okRead(outcome: SmokeOutcome, trigger?: string): SmokeVerdictRead {
  const verdict: SmokeVerdict = trigger === undefined ? { outcome } : { outcome, trigger };
  return { status: "ok", verdict };
}

/** The two REAL armed-trigger strings `buildSmokeVerdict` produces. */
const ARMED_CHAIN =
  "incomplete grandchild chain (2 chain-integrity findings: leg jira captured 4 of 6 phases; " +
  "phase 2.Y log absent)";
const ARMED_PIDFILE = "live pidfile still answering kill -0 (/tmp/dpt-smoke-jira.pid)";

const kind = (d: LegRcDisposition) => d.disposition;

// ===========================================================================
// 1. `classifyLegRc` — the pure decision rule. AC.1 / AC.2 / AC.3.
// ===========================================================================

describe("AC-STE-490.1/.2/.3 — classifyLegRc: only rc 64 defers to the artifact", () => {
  test("rc 0 beside a fresh `pass` artifact is a pass", () => {
    expect(kind(classifyLegRc("0", okRead("pass")))).toBe("pass");
    expect(kind(classifyLegRc(0, okRead("pass")))).toBe("pass");
    expect(kind(classifyLegRc(" 0 \n", okRead("pass")))).toBe("pass");
  });

  test("PRESERVATION (AC.3) — an unparseable rc-file is a failure, all four shapes", () => {
    // The STE-420 fail-closed hardening, restated at the new decision point.
    // These four are the shapes the rc-file redirect can actually produce:
    // never written, written empty, written with a diagnostic, or handed a
    // non-integer. None of them may become a `pass` and none of them may reach
    // the artifact carve-out.
    const shapes: Array<[string, string | number | null | undefined]> = [
      ["undefined (no rc-file at all)", undefined],
      ["null", null],
      ["empty string (0-byte rc-file)", ""],
      ["whitespace only", "   \n"],
      ["non-integer diagnostic text", "bun: command not found"],
      ["fractional", "1.5"],
    ];
    for (const [label, value] of shapes) {
      const d = classifyLegRc(value, okRead("fail", "declared"));
      expect({ label, disposition: kind(d) }).toEqual({ label, disposition: "failure" });
      expect({ label, reasoned: (d as { reason?: string }).reason ?? "" }).not.toEqual({
        label,
        reasoned: "",
      });
    }
  });

  test("every non-zero code that is NOT 64 is a failure, artifact notwithstanding", () => {
    // The carve-out is a carve-out, not an amnesty. Each of these is a real
    // code from `smoke_verdict.ts` (65..68 = missing/malformed/stale/unreadable
    // artifact, 1 = missing rc-file) plus two arbitrary process statuses.
    for (const rc of [1, 4, 65, 66, 67, 68, 130, 137, 255]) {
      const d = classifyLegRc(String(rc), okRead("fail", "declared"));
      expect({ rc, disposition: kind(d) }).toEqual({ rc, disposition: "failure" });
      expect((d as { reason?: string }).reason ?? "").not.toBe("");
    }
  });

  test("HEADLINE (AC.1) — rc 64 beside `fail`/`declared` is declared-findings", () => {
    expect(kind(classifyLegRc(String(RC_VERDICT_NON_PASS), okRead("fail", "declared")))).toBe(
      "declared-findings",
    );
    expect(kind(classifyLegRc(64, okRead("fail", "declared")))).toBe("declared-findings");
  });

  test("AC.1 — the additive `--trigger` form `declared + <operator context>` also proceeds", () => {
    // `smoke_verdict emit --trigger` APPENDS operator context to the computed
    // trigger; on a declared-only verdict the computed part is the bare word,
    // so the real artifact reads `declared + <whatever the operator typed>`.
    // A rule matching only the bare literal would abort every operator-annotated
    // capture-only leg — i.e. exactly the runs this FR exists to unblock.
    for (const suffix of [
      "declared + iter-1 capture-only, graded by hand",
      "declared + 7 findings (2 high)",
    ]) {
      expect({ suffix, d: kind(classifyLegRc("64", okRead("fail", suffix))) }).toEqual({
        suffix,
        d: "declared-findings",
      });
    }
  });

  test("LOAD-BEARING (AC.2) — rc 64 with an ARMED trigger is a failure", () => {
    // An armed abort reconciles to 64 too. If the gate keyed on the code alone
    // — or on `outcome !== "pass"` — a leg whose grandchild chain never
    // completed would sail through the narrowed gate as "declared findings",
    // which is the fail-open this narrowing must not introduce.
    const armed: Array<[string, SmokeVerdictRead]> = [
      ["abort + incomplete chain", okRead("abort", ARMED_CHAIN)],
      ["abort + live pidfile", okRead("abort", ARMED_PIDFILE)],
      ["abort + both triggers", okRead("abort", `${ARMED_CHAIN} + ${ARMED_PIDFILE}`)],
      ["fail + incomplete chain", okRead("fail", ARMED_CHAIN)],
      ["fail + live pidfile", okRead("fail", ARMED_PIDFILE)],
    ];
    for (const [label, read] of armed) {
      const d = classifyLegRc("64", read);
      expect({ label, disposition: kind(d) }).toEqual({ label, disposition: "failure" });
      expect((d as { reason?: string }).reason ?? "").not.toBe("");
    }
  });

  test("SUBSTRING TRAP — an armed trigger that merely CONTAINS the word `declared` still fails", () => {
    // `--trigger` is additive, so operator prose lands on the same flat string
    // as the computed diagnosis. A `includes("declared")` test would pass every
    // one of these — an incomplete chain annotated "declared by operator" is
    // still an incomplete chain. The rule is the declared literal or a
    // `declared + …` PREFIX, not a substring anywhere.
    for (const trigger of [
      `${ARMED_CHAIN} + declared`,
      `${ARMED_PIDFILE} + declared by the operator`,
      "not declared",
      "undeclared",
    ]) {
      expect({ trigger, d: kind(classifyLegRc("64", okRead("abort", trigger))) }).toEqual({
        trigger,
        d: "failure",
      });
    }
  });

  test("AC.2 — a driver-declared ABORT is an abort, even at trigger `declared`", () => {
    // The one shape where outcome and trigger disagree about severity. `abort`
    // is the driver saying the run did not complete; the trigger's provenance
    // does not change that.
    expect(kind(classifyLegRc("64", okRead("abort", "declared")))).toBe("failure");
    expect(kind(classifyLegRc("64", okRead("abort")))).toBe("failure");
  });

  test("AC.2 — rc 64 beside a `pass` artifact is a failure: the two contradict", () => {
    // 64 means non-pass by construction. A `pass` artifact at rc 64 means the
    // artifact and the reconciler disagree, and disagreement is not consent.
    expect(kind(classifyLegRc("64", okRead("pass")))).toBe("failure");
  });

  test("AC.2 — rc 64 with a `fail` outcome and NO trigger at all is a failure", () => {
    // Fail-closed default. `buildSmokeVerdict` never emits a non-`pass` without
    // a trigger, so an artifact in this shape was hand-edited or truncated —
    // no findings and no evidence must not reconcile to the same answer as
    // findings-with-evidence.
    expect(kind(classifyLegRc("64", okRead("fail")))).toBe("failure");
  });

  test("AC.3 — a missing / stale / unreadable / malformed artifact is a failure at rc 64", () => {
    // "A missing or unreadable artifact remains a failure" — the FR's own
    // clause. This is where the narrowed gate could quietly become no gate at
    // all: at 64 the artifact is the ONLY evidence, so no artifact means no
    // grounds to proceed.
    for (const status of ["missing", "stale", "unreadable", "malformed"] as const) {
      const d = classifyLegRc("64", { status } as SmokeVerdictRead);
      expect({ status, disposition: kind(d) }).toEqual({ status, disposition: "failure" });
      expect((d as { reason?: string }).reason ?? "").not.toBe("");
    }
  });

  test("ISOLATION — the artifact only matters at 64; at 0 and at 65 it changes nothing", () => {
    // A clause is isolated only when it also fails where it should. Same two
    // artifacts, three codes: the answer must differ at 64 and be identical
    // everywhere else.
    const declared = okRead("fail", "declared");
    const arme = okRead("abort", ARMED_CHAIN);
    expect([kind(classifyLegRc("64", declared)), kind(classifyLegRc("64", arme))]).toEqual([
      "declared-findings",
      "failure",
    ]);
    expect([kind(classifyLegRc("65", declared)), kind(classifyLegRc("65", arme))]).toEqual([
      "failure",
      "failure",
    ]);
    expect([kind(classifyLegRc("0", declared)), kind(classifyLegRc("0", arme))]).toEqual([
      "failure",
      "failure",
    ]);
  });

  test("THE COLLISION, DEMONSTRATED — reconcileLegRc gives 64 for BOTH artifacts", () => {
    // Why the classifier must exist at all, asserted rather than asserted-in-
    // prose: the reconciler folds a declared-findings leg and an armed-abort
    // leg onto the same integer, so any gate reading the integer alone is
    // deciding on evidence that cannot distinguish them.
    const declared = okRead("fail", "declared");
    const arme = okRead("abort", ARMED_CHAIN);
    expect([reconcileLegRc("0", declared), reconcileLegRc("0", arme)]).toEqual([64, 64]);
    expect([kind(classifyLegRc("64", declared)), kind(classifyLegRc("64", arme))]).toEqual([
      "declared-findings",
      "failure",
    ]);
  });
});

// ===========================================================================
// 2. The `classify` CLI subcommand — scored on EXIT CODE.
// ===========================================================================

describe("AC-STE-490.1/.2/.3 — the `classify` CLI, scored on exit status", () => {
  type CliRun = { status: number; stdout: string; stderr: string };

  function runClassify(args: readonly string[]): CliRun {
    const proc = Bun.spawnSync(["bun", VERDICT_CLI, "classify", ...args], { cwd: pluginRoot });
    const run: CliRun = {
      status: proc.exitCode,
      stdout: new TextDecoder().decode(proc.stdout).trim(),
      stderr: new TextDecoder().decode(proc.stderr).trim(),
    };
    // NON-VACUITY, and the reason it lives in the runner rather than in one
    // test. An UNRECOGNIZED subcommand falls through to the shim's trailing
    // `usage: … <emit|reconcile>` and exits 2 — so on a tree where `classify`
    // does not exist at all, EVERY "exits non-zero" assertion below passes,
    // and passes for a reason that has nothing to do with the rule it claims
    // to measure. Refusing that reading once, here, covers every caller.
    const unrecognized = /usage: bun smoke_verdict\.ts <emit/.test(run.stderr);
    expect({ args: args.join(" "), unrecognized }).toEqual({
      args: args.join(" "),
      unrecognized: false,
    });
    return run;
  }

  /** Materialize an artifact in a scratch dir and hand its path to the CLI. */
  function withArtifact<T>(verdict: SmokeVerdict | "absent", body: (path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "ste490-cli-"));
    const path = join(dir, "verdict.json");
    try {
      if (verdict !== "absent") writeFileSync(path, formatSmokeVerdict(verdict), "utf8");
      return body(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("HEADLINE — a declared-findings artifact at rc 64 exits 0", () => {
    const r = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
      runClassify(["--rc", "64", "--artifact", p]),
    );
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
  });

  test("WITNESS — the SAME rc with an armed-trigger artifact exits non-zero", () => {
    // Opposite outcomes from the same exit code is the whole claim. Scored on
    // status, never on counting a printed line: a runner that prints its own
    // verdict text would satisfy a line-count assertion in both directions.
    const declared = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
      runClassify(["--rc", "64", "--artifact", p]),
    );
    const armed = withArtifact({ outcome: "abort", trigger: ARMED_CHAIN }, (p) =>
      runClassify(["--rc", "64", "--artifact", p]),
    );
    expect({ declared: declared.status === 0, armed: armed.status !== 0 }).toEqual({
      declared: true,
      armed: true,
    });
  });

  test("a `pass` artifact at rc 0 exits 0", () => {
    const r = withArtifact({ outcome: "pass" }, (p) => runClassify(["--rc", "0", "--artifact", p]));
    expect(r.status).toBe(0);
  });

  test("PRESERVATION (AC.3) — missing / empty / non-integer rc all exit non-zero", () => {
    for (const args of [
      ["--rc", "", "--artifact"] as const,
      ["--rc", "not-a-number", "--artifact"] as const,
    ]) {
      const r = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
        runClassify([...args, p]),
      );
      expect({ args: args.join(" "), ok: r.status !== 0 }).toEqual({
        args: args.join(" "),
        ok: true,
      });
    }
    // No `--rc` flag at all.
    const noFlag = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
      runClassify(["--artifact", p]),
    );
    expect(noFlag.status).not.toBe(0);
  });

  test("AC.2/.3 — an ABSENT artifact at rc 64 exits non-zero", () => {
    const r = withArtifact("absent", (p) => runClassify(["--rc", "64", "--artifact", p]));
    expect(r.status).not.toBe(0);
  });

  test("AC.2 — a plain crash code exits non-zero whatever the artifact says", () => {
    for (const rc of ["1", "137", "65"]) {
      const r = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
        runClassify(["--rc", rc, "--artifact", p]),
      );
      expect({ rc, ok: r.status !== 0 }).toEqual({ rc, ok: true });
    }
  });

  test("AC.3 — `--run-start` in the future makes a declared artifact STALE and exits non-zero", () => {
    const future = String(Date.now() + 3_600_000);
    const r = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
      runClassify(["--rc", "64", "--artifact", p, "--run-start", future]),
    );
    expect(r.status).not.toBe(0);
  });

  test("the disposition is printed on stdout (secondary to the exit code)", () => {
    const declared = withArtifact({ outcome: "fail", trigger: "declared" }, (p) =>
      runClassify(["--rc", "64", "--artifact", p]),
    );
    expect(declared.stdout).toContain("declared-findings");

    const armed = withArtifact({ outcome: "abort", trigger: ARMED_PIDFILE }, (p) =>
      runClassify(["--rc", "64", "--artifact", p]),
    );
    expect(armed.stdout + armed.stderr).toContain("failure");
  });
});

// ===========================================================================
// 3. The EXECUTED fence. AC.5, and the real proof of AC.1 / AC.2 / AC.3.
// ===========================================================================

type Outcome = { status: number; stdout: string; stderr: string };

function runScript(lines: readonly string[]): Outcome {
  const proc = Bun.spawnSync(["bash", "-c", lines.join("\n")]);
  return {
    status: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

/** A per-invocation token, unique without relying on PID non-reuse. */
function freshToken(prefix: string): { token: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { token: basename(dir), dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

// Which of the executed-fence assertions below are green on the pre-fix tree,
// and why that is correct rather than vacuous. AC.2 and AC.3 are PRESERVATION
// criteria — "the gate is narrowed, not removed", "preserved byte-for-byte" —
// so every abort case here (armed trigger, plain crash, absent artifact, the
// asymmetric mixes, the non-64 codes, the three malformed rc shapes, the empty
// selection, the unrecognized leg) passes today by construction and must still
// pass after the fix. They are the SIBLINGS that make the two HEADLINE cases
// mean something: today's gate aborts on all of them AND on the declared-
// findings case, and the fix is the edit that separates the last one from the
// rest. Isolation is the pair, not either half.
describeIfLoop("AC-STE-490.5 — § RC collection's fence, EXTRACTED and EXECUTED", () => {
  /**
   * Run the documented RC-collection fence against materialized rc-files AND
   * materialized verdict artifacts.
   *
   * The artifacts go to the REAL production path (`smokeVerdictPath(leg)`),
   * because that is the path the spawn wrapper writes; an env override invented
   * for the harness would put producer and consumer on different files and the
   * whole executed-fence claim would be about a path nothing ships. Any
   * pre-existing file is saved and restored in the `finally`.
   */
  function runRc(opts: {
    selected: readonly string[];
    rcs: Readonly<Record<string, string | "absent">>;
    artifacts?: Readonly<Record<string, SmokeVerdict | "absent">>;
  }): Outcome {
    const { token, dispose } = freshToken("ste490rc");
    const rcPaths = Object.keys(opts.rcs).map(
      (leg) => `/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.rc`,
    );
    const saved = new Map<string, string | null>();
    try {
      for (const [leg, value] of Object.entries(opts.rcs)) {
        if (value === "absent") continue;
        writeFileSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.rc`, value);
      }
      for (const [leg, verdict] of Object.entries(opts.artifacts ?? {})) {
        const p = smokeVerdictPath(leg);
        saved.set(p, existsSync(p) ? readFileSync(p, "utf8") : null);
        if (verdict === "absent") rmSync(p, { force: true });
        else writeFileSync(p, formatSmokeVerdict(verdict), "utf8");
      }
      return runScript([
        `DATE=${token}`,
        "ITER=1",
        `SELECTED_LEGS="${opts.selected.join(" ")}"`,
        `PLUGIN_DIR=${pluginRoot}`,
        rcFence(),
        'echo "RC-GATE-PASSED"',
      ]);
    } finally {
      for (const p of rcPaths) rmSync(p, { force: true });
      for (const [p, prior] of saved) {
        if (prior === null) rmSync(p, { force: true });
        else writeFileSync(p, prior, "utf8");
      }
      dispose();
    }
  }

  const reachedEnd = (r: Outcome) => r.stdout.includes("RC-GATE-PASSED");
  const aborted = (r: Outcome) => r.status !== 0;

  const DECLARED: SmokeVerdict = { outcome: "fail", trigger: "declared" };
  const ARMED: SmokeVerdict = { outcome: "abort", trigger: ARMED_CHAIN };

  test("HEADLINE (AC.1) — a leg at rc 64 with a declared-findings artifact PROCEEDS", () => {
    for (const leg of SMOKE_LEGS) {
      const r = runRc({
        selected: [leg],
        rcs: { [leg]: "64" },
        artifacts: { [leg]: DECLARED },
      });
      expect({ leg, reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
        leg,
        reached: true,
        aborted: false,
      });
    }
  });

  test("AC.1 — ALL THREE legs at rc 64 with declared findings reach aggregation", () => {
    // The shape the 2026-08-16 run actually produced, and the one the operator
    // had to grade around by hand.
    const r = runRc({
      selected: SMOKE_LEGS,
      rcs: Object.fromEntries(SMOKE_LEGS.map((l) => [l, "64"])),
      artifacts: Object.fromEntries(SMOKE_LEGS.map((l) => [l, DECLARED])),
    });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: true,
      aborted: false,
    });
  });

  test("OPPOSITE OUTCOME (AC.2/.5) — the same rc 64 with an ARMED-trigger artifact ABORTS", () => {
    for (const leg of SMOKE_LEGS) {
      const r = runRc({
        selected: [leg],
        rcs: { [leg]: "64" },
        artifacts: { [leg]: ARMED },
      });
      expect({ leg, reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
        leg,
        reached: false,
        aborted: true,
      });
      expect(r.stdout).toMatch(/Aborting/);
      expect(r.stdout).toMatch(/linear=\d+, jira=\d+, none=\d+/);
    }
  });

  test("AC.2 — a plain crash (rc 137, no artifact) aborts with a naming diagnostic", () => {
    const leg = SMOKE_LEGS[0]!;
    const r = runRc({
      selected: [leg],
      rcs: { [leg]: "137" },
      artifacts: { [leg]: "absent" },
    });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: false,
      aborted: true,
    });
    expect(r.stdout).toContain(`${leg}=137`);
    expect(r.stdout).toMatch(/linear=\d+, jira=\d+, none=\d+/);
    expect(r.stdout).toMatch(/Aborting/);
  });

  test("AC.2 — rc 64 with NO artifact aborts: no evidence is not the same as no findings", () => {
    const leg = SMOKE_LEGS[1]!;
    const r = runRc({ selected: [leg], rcs: { [leg]: "64" }, artifacts: { [leg]: "absent" } });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: false,
      aborted: true,
    });
  });

  test("ASYMMETRY — one declared-findings leg beside one crashed leg still ABORTS", () => {
    // The case a naive fold gets wrong. All-declared and all-crashed are both
    // satisfied by the wrong operator; only the mixed run separates them.
    const [a, b] = [SMOKE_LEGS[0]!, SMOKE_LEGS[1]!];
    const r = runRc({
      selected: [a, b],
      rcs: { [a]: "64", [b]: "137" },
      artifacts: { [a]: DECLARED, [b]: "absent" },
    });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: false,
      aborted: true,
    });
    expect(r.stdout).toContain(`${b}=137`);
  });

  test("ASYMMETRY — one declared-findings leg beside one ARMED leg still ABORTS", () => {
    const [a, b] = [SMOKE_LEGS[0]!, SMOKE_LEGS[2]!];
    const r = runRc({
      selected: [a, b],
      rcs: { [a]: "64", [b]: "64" },
      artifacts: { [a]: DECLARED, [b]: ARMED },
    });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: false,
      aborted: true,
    });
  });

  test("AC.2 — every non-64 non-zero code still aborts, declared artifact or not", () => {
    const leg = SMOKE_LEGS[0]!;
    for (const rc of ["1", "4", "65", "66", "67", "68"]) {
      const r = runRc({ selected: [leg], rcs: { [leg]: rc }, artifacts: { [leg]: DECLARED } });
      expect({ rc, reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
        rc,
        reached: false,
        aborted: true,
      });
    }
  });

  test("PRESERVATION (AC.3) — absent / empty / non-integer rc-files still abort THROUGH THE FENCE", () => {
    // The three shapes the STE-420 hardening exists for, re-checked at the
    // narrowed gate. A declared-findings artifact is present for every one of
    // them, so a gate that consulted the artifact FIRST — before the integer
    // normalization — would let all three through.
    const leg = SMOKE_LEGS[0]!;
    const shapes: Array<[string, string | "absent"]> = [
      ["absent rc-file", "absent"],
      ["empty rc-file", ""],
      ["non-integer rc-file", "bun: command not found"],
    ];
    for (const [label, value] of shapes) {
      const r = runRc({ selected: [leg], rcs: { [leg]: value }, artifacts: { [leg]: DECLARED } });
      expect({ label, reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
        label,
        reached: false,
        aborted: true,
      });
    }
  });

  test("PRESERVATION — rc 0 with a clean run still passes, and an EMPTY selection still refuses", () => {
    // The two ends of the untouched behaviour. Without the first, every
    // assertion above could be satisfied by a fence that aborts unconditionally;
    // without the second, STE-452's vacuous-green refusal could be dropped by
    // the same edit that adds the carve-out.
    const leg = SMOKE_LEGS[0]!;
    const clean = runRc({ selected: [leg], rcs: { [leg]: "0" }, artifacts: { [leg]: { outcome: "pass" } } });
    expect({ reached: reachedEnd(clean), aborted: aborted(clean) }).toEqual({
      reached: true,
      aborted: false,
    });

    const empty = runRc({ selected: [], rcs: { [leg]: "0" } });
    expect({ reached: reachedEnd(empty), aborted: aborted(empty) }).toEqual({
      reached: false,
      aborted: true,
    });
  });

  test("PRESERVATION — an unrecognized selected leg is still an unexamined leg", () => {
    // STE-452's EXAMINED_LEGS / SELECTED_COUNT accounting guard, which the FR
    // requires to survive unchanged.
    const r = runRc({ selected: ["zzbogus"], rcs: {} });
    expect({ reached: reachedEnd(r), aborted: aborted(r) }).toEqual({
      reached: false,
      aborted: true,
    });
  });
});

// ===========================================================================
// 4. Slice sanity + anchor mutation. AC.5's non-vacuity half.
// ===========================================================================

describeIfLoop("AC-STE-490.5 — the extraction is anchored and the fence keeps its guards", () => {
  test("GUARD (non-vacuity) — a one-byte rewording of the anchor returns NOTHING", () => {
    // STE-456 AC.7's method. Without this, every executed assertion above could
    // be satisfied by an empty extraction: a zero-byte script exits 0 and
    // prints nothing, and "did not abort" would be true for free. `mutate`
    // throws when the pattern matches nothing, so a silently-inapplicable
    // mutation cannot read as a pass here.
    const mutated = mutate(loop!, /RC_LINEAR=/g, "RC_LINEAR =");
    expect(mutated).not.toBe(loop!);
    expect(mutated.includes("RC_LINEAR=")).toBe(false);
    expect(fenceContaining(mutated, "RC_LINEAR=")).toBe("");
    // …and the unmutated document still resolves to a substantial fence.
    expect(rcFence().length).toBeGreaterThan(400);
  });

  test("PRESERVATION (AC.3) — the fence keeps its empty-selection guard, three cat blocks, and accounting guard", () => {
    const fence = rcFence();
    expect(fence).toContain('if [ -z "${SELECTED_LEGS:-}" ]');
    expect(fence).toContain("EXAMINED_LEGS=0");
    expect(fence).toContain("SELECTED_COUNT=$(set -- ${SELECTED_LEGS}; echo $#)");
    expect(fence).toContain('if [ "${EXAMINED_LEGS}" -ne "${SELECTED_COUNT}" ]');
    for (const leg of SMOKE_LEGS) {
      const upper = leg.toUpperCase();
      expect(fence).toContain(
        `RC_${upper}=$(cat "/tmp/dpt-conformance-loop-\${DATE}-iter-\${ITER}-${leg}.rc" 2>/dev/null)`,
      );
      // The integer normalization, byte-for-byte per AC.3.
      expect(fence).toContain(`''|*[!0-9]*) RC_${upper}=1 ;;`);
    }
    // The diagnostic substring `m121-ste-452-termination-harness.test.ts`
    // asserts. Breaking it here would turn that suite red for the wrong reason.
    expect(fence).toContain("linear=${RC_LINEAR}, jira=${RC_JIRA}, none=${RC_NONE}");
  });

  test("the fence now CONSULTS the verdict artifact per non-zero leg", () => {
    // The new half. Prose describing a carve-out beside a fence that does not
    // implement one is the exact failure mode this whole harness exists to
    // catch, so the mechanism is pinned in the fence, not in the paragraph.
    const fence = rcFence();
    expect(fence).toContain("smoke_verdict.ts");
    expect(fence).toMatch(/\bclassify\b/);
    expect(fence).toContain("dpt-smoke-verdict-");
    expect(fence).toMatch(/64/);
  });

  test("the RC fence is still a single distinct block carrying RC_LINEAR=", () => {
    expect(fenceContaining(loop!, "RC_LINEAR=")).toBe(rcFence());
    expect(fenceContaining(loop!, "STATUS=green")).not.toBe(rcFence());
  });
});

// ===========================================================================
// 5. Prose. AC.4 and AC.6.
// ===========================================================================

describeIfLoop("AC-STE-490.4 — § RC collection no longer states abort-on-any-non-zero as intent", () => {
  /** The § RC collection region, both anchors asserted to resolve. */
  function rcSection(): string {
    const start = loop!.indexOf("**RC collection");
    const end = loop!.indexOf("**Why detached + poll");
    expect({ start: start > -1, end: end > start }).toEqual({ start: true, end: true });
    return loop!.slice(start, end);
  }

  test("no line asserts abort-on-any-non-zero WITHOUT naming the carve-out", () => {
    // A ban, narrowed rather than absolute (Pattern 31). The corrected sentence
    // will still say "any non-zero" — it has to, since 64 is the only exception
    // — so the pin is on the exception being named on the same line.
    //
    // Measured against HEAD (pre-STE-490), not assumed: two lines state the
    // shape flatly — the § opener ("and abort on any non-zero") and the closing
    // STE-420 paragraph ("it still just aborts on any non-zero") — but only ONE
    // of them reaches this assertion. The closing paragraph escapes the
    // exemption filter on the unrelated phrase "both legs declared failure in
    // prose", so the filter yields exactly one surviving offender on HEAD. That
    // is still enough to make this test genuinely RED before the fix, which is
    // the property that matters; it is recorded rather than overstated because
    // the exemption is word-level and a future edit could reintroduce the
    // banned intent on any line that happens to contain "declared".
    // Follow-up: tighten the exemption to a same-clause match.
    const offenders = rcSection()
      .split(/\r?\n/)
      .filter((l) => /any non-?zero/i.test(l))
      .filter((l) => !/^> \*\*SUPERSEDED/.test(l))
      .filter((l) => !/64|declared|classif/i.test(l));
    expect(offenders).toEqual([]);
  });

  test("the § RECORDS the collision it resolves — the strictly stronger half", () => {
    // A ban alone is satisfied by deleting the paragraph. Pattern 31's rider:
    // pair it with a positive pin. These name the two decisions that collided
    // and the code they collided on.
    const section = rcSection();
    expect(section).toMatch(/collision|collide/i);
    expect(section).toContain("STE-420");
    expect(section).toContain("STE-490");
    expect(section).toMatch(/\b64\b/);
    expect(section).toMatch(/declared/);
  });

  test("the § states which evidence decides at 64 — the artifact, not the code", () => {
    const section = rcSection();
    expect(section).toMatch(/verdict artifact/i);
    // …and that a missing artifact is still a failure, so the narrowing cannot
    // be read as an amnesty.
    expect(section).toMatch(/missing|absent/i);
    expect(section).toMatch(/armed|incomplete (grandchild )?chain|live pidfile/i);
  });
});

describe("AC-STE-490.6 — the 2026-08-01 recurrence is in the record", () => {
  const RECURRENCE = /recur|again|repeat|second time/i;
  const UNFIXED = /unfixed|not fixed|without being fixed|never fixed|no fix/i;

  test("the FR's Notes name the date, the recurrence, and that it went unfixed", () => {
    const fr = readIfPresent(FR_PATH);
    expect({ path: FR_PATH, present: fr !== null }).toEqual({ path: FR_PATH, present: true });
    const heading = /^## Notes$/m.exec(fr!);
    expect(heading).not.toBeNull();
    const notes = fr!.slice(heading!.index);
    expect(notes).toContain("2026-08-01");
    expect(notes).toMatch(RECURRENCE);
    expect(notes).toMatch(UNFIXED);
  });

  test("PRESERVATION — the plan's Notes carry the same recurrence record", () => {
    // Already true when this test was written, and pinned so the ship-time
    // rewrite of M128's plan cannot smooth it out on the way to the archive.
    const plan = readIfPresent(PLAN_PATH);
    expect({ path: PLAN_PATH, present: plan !== null }).toEqual({ path: PLAN_PATH, present: true });
    const heading = /^### Notes$/m.exec(plan!);
    expect(heading).not.toBeNull();
    const notes = plan!.slice(heading!.index);
    expect(notes).toContain("2026-08-01");
    expect(notes).toMatch(RECURRENCE);
    expect(notes).toMatch(UNFIXED);
  });
});

// M143 STE-550 — an inline phase does not close with a terminal report.
//
// WHAT IS BROKEN, measured on this tree. Eleven skills each close with exactly
// one `stage-status-block` fence, mandated as the LAST thing in the report with
// nothing permitted after it. Under a fork that is harmless — ending the turn
// returns control to the orchestrator. Run INLINE as a step of `/deliver`'s
// Phase 1 / Phase 2, the same instruction ends the whole run: the operator has
// to type again for Phase 2 to start, and again for Phase 3 to spawn. Two
// blocks in one report is separately refused by the shipped grader, so one turn
// cannot legally span two phases either.
//
// WHY EACH LEG BELOW IS NOT A TAUTOLOGY.
//
//   * AC.1 AND AC.2 ARE ONE ASSERTION, ON ONE STAGE. Either half alone proves
//     nothing about the distinction: "zero fences" is satisfied by a renderer
//     that never emits one, "exactly one fence" by a renderer that ignores the
//     signal. The pair is built from the SAME standalone report, so the only
//     thing that differs between the two calls is the invocation body.
//   * AC.3 IS NON-VACUOUS BY CONSTRUCTION. A clean scanner verdict over a tree
//     it graded ZERO surfaces on is the shape this repository has recorded
//     reading as compliance, so the probe half is asserted `vacuous: false`
//     alongside the empty violation list.
//   * AC.4 IS EXECUTED, NOT ASSERTED — and it carries its own control. A probe
//     that returns clean on everything would pass the fixture leg; the control
//     mutates the AUTHORING file the probe's subject actually is, and the
//     mutation is measured before it is scored.
//   * AC.5 IS ASSERTED AGAINST THE SHIPPED GRADER, so this FR cannot be
//     satisfied by relaxing the one-fence rule: the two-fence refusal is
//     re-pinned here, and the driven output's ZERO fences is shown to be a
//     different case rather than a hole opened in that rule.
//   * AC.6 IS THE ONLY LEG THAT OBSERVES THE DEFECT. The per-stage legs observe
//     its parts. The chain's phase bodies are derived from the SHIPPED
//     `skills/deliver/SKILL.md` through `drivingSiteSupplies`, so a `/deliver`
//     that stopped supplying the signal at a site reddens this leg.
//   * AC.7 MEASURES THE MUTATION BEFORE SCORING IT. A mutation that silently
//     never applied reads as a pass (the trap this repository has recorded), so
//     each mutation asserts the fence actually came back.
//   * AC.8 MEASURES WITH `split("\n")`, NOT `wc -l`, and takes the BASELINE from
//     a constant captured before the edits rather than from the post-edit file:
//     a leg that only reads the final number cannot tell "unchanged" from "was
//     already over".

import { describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runClosingSummaryCapabilityKeysProbe } from "../adapters/_shared/src/closing_summary_capability_keys";
import { DELIVER_STAGE_FENCE_BANNER } from "../adapters/_shared/src/deliver_stage_capture";
import {
  DRIVEN_MARKER,
  drivingSiteSupplies,
  isDrivenRun,
} from "../adapters/_shared/src/driven_run_signal";
import {
  ADOPTING_STAGES,
  runStageBlockAdoptionProbe,
  scanStageBlockAdoption,
  verifyStageReportAdoption,
} from "../adapters/_shared/src/stage_block_adoption";
import {
  STAGE_BLOCK_FENCE_BANNER,
  closedStatusFences,
} from "../adapters/_shared/src/stage_status_block";

// The module THIS FR lands: the shared predicate plus the suppression the
// adopting stages' closing-summary clause documents. Never a second reader of
// the driven literal — `terminalBlockSuppressed` delegates to `isDrivenRun`,
// asserted behaviourally below.
import {
  DRIVEN_SUPPRESSION_CLAUSE,
  documentsDrivenSuppression,
  scanDrivenSuppressionAdoption,
  stageReportFor,
  terminalBlockSuppressed,
} from "../adapters/_shared/src/inline_terminal_block";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (path: string): string => readFileSync(path, "utf-8");
const skillPath = (stage: string): string =>
  join(PLUGIN_ROOT, "skills", stage, "SKILL.md");

/** AC.8's mandated measurement: `split("\n")`, never `wc -l`. */
const lineCount = (text: string): number => text.split("\n").length;

const DELIVER = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const deliverBody = (): string => read(DELIVER);

// ---------------------------------------------------------------------------
// One stage's STANDALONE report, taken from the shipped model report.
//
// Rebannered onto the adopting stages' own fence exactly as the M137 suite
// does, so every count here comes from the shipped fixture rather than from a
// report hand-typed for this file. `brainstorm` owes no cap-exempt sections,
// which keeps the pair below a clean two-call difference test.
// ---------------------------------------------------------------------------

const MODEL_REPORT = read(
  join(import.meta.dir, "fixtures", "deliver-stage-capture", "worker-stage-report.txt"),
)
  .replace(/\n+$/, "")
  .replace(DELIVER_STAGE_FENCE_BANNER, STAGE_BLOCK_FENCE_BANNER);

const standaloneReportFor = (stage: string): string =>
  MODEL_REPORT.replace(/^(\s*stage:).*$/m, `$1 ${stage}`);

/** The invocation body a person types — no signal of any kind. */
const PLAIN_BODY = [
  "/dev-process-toolkit:brainstorm",
  "",
  "A feature request, typed by a person at a prompt.",
].join("\n");

/** The SAME body with the driven literal, built from it rather than retyped. */
const DRIVEN_BODY = `${DRIVEN_MARKER}\n${PLAIN_BODY}`;

/**
 * The modelled turn boundary: a stage that emits a terminal block ENDS ITS
 * TURN, and the operator must type again for the next step to run. This is the
 * defect, expressed once, and every chain leg below reads it.
 */
const turnEnds = (emitted: string): boolean =>
  closedStatusFences(emitted).length > 0;

// ===========================================================================
// AC-STE-550.1 / AC-STE-550.2 — the pair, on one stage.
// ===========================================================================

describe("AC-STE-550.1/.2 — the same stage, driven and standalone", () => {
  test("the two invocation bodies differ in exactly one readable fact", () => {
    // Reconstruction, not a second hand-written string: whatever else these
    // bodies differ in is nothing, because one is built from the other.
    expect(DRIVEN_BODY.replace(`${DRIVEN_MARKER}\n`, "")).toBe(PLAIN_BODY);
    expect(isDrivenRun(DRIVEN_BODY)).toBe(true);
    expect(isDrivenRun(PLAIN_BODY)).toBe(false);
  });

  test("AC.1 — driven: no fence, and the turn does not end", () => {
    const emitted = stageReportFor(standaloneReportFor("brainstorm"), DRIVEN_BODY);
    expect(closedStatusFences(emitted).length).toBe(0);
    expect(emitted).not.toContain(STAGE_BLOCK_FENCE_BANNER);
    expect(turnEnds(emitted)).toBe(false);
  });

  test("AC.2 — standalone: exactly one fence, byte-identical to today", () => {
    const standalone = standaloneReportFor("brainstorm");
    const emitted = stageReportFor(standalone, PLAIN_BODY);
    // "positioned and bounded exactly as today" — the strongest available
    // statement of that is that the report is unchanged, byte for byte.
    expect(emitted).toBe(standalone);
    expect(closedStatusFences(emitted).length).toBe(1);
    expect(verifyStageReportAdoption(emitted)).toEqual({ ok: true, reasons: [] });
    // ...and it is the LAST thing in the report.
    const lines = emitted.split("\n");
    const lastNonBlank = lines.reduce(
      (acc, line, i) => (line.trim() === "" ? acc : i),
      -1,
    );
    expect(lines[lastNonBlank]!.trim()).toBe("```");
    expect(turnEnds(emitted)).toBe(true);
  });

  test("the pair is the assertion: one input, two outputs, one difference", () => {
    const standalone = standaloneReportFor("brainstorm");
    const driven = stageReportFor(standalone, DRIVEN_BODY);
    const plain = stageReportFor(standalone, PLAIN_BODY);
    expect(driven).not.toBe(plain);
    expect(closedStatusFences(driven).length).toBe(0);
    expect(closedStatusFences(plain).length).toBe(1);
  });

  test("every adopting stage behaves the same way, not just the sampled one", () => {
    for (const stage of ADOPTING_STAGES) {
      const standalone = standaloneReportFor(stage);
      expect(closedStatusFences(stageReportFor(standalone, DRIVEN_BODY)).length).toBe(0);
      expect(closedStatusFences(stageReportFor(standalone, PLAIN_BODY)).length).toBe(1);
    }
  });

  test("`terminalBlockSuppressed` is not a second reader of the literal", () => {
    // A predicate free to disagree with `isDrivenRun` is the drift STE-549's
    // one-owner indirection exists to prevent; agreement is asserted over a
    // matrix rather than on the happy case alone.
    const bodies = [
      PLAIN_BODY,
      DRIVEN_BODY,
      "",
      "<dpt:auto-approve>v1</dpt:auto-approve>\n" + PLAIN_BODY,
      "<dpt:auto-approve>v1</dpt:auto-approve>\n" + DRIVEN_BODY,
      "You are a worker spawned by /deliver to run the chain for M143.",
      "<dpt:driven>v2</dpt:driven>",
      `prose before ${DRIVEN_MARKER} prose after`,
    ];
    for (const body of bodies) {
      expect(terminalBlockSuppressed(body)).toBe(isDrivenRun(body));
    }
    // At least one cell of that matrix is true and at least one is false, so
    // agreement is not the agreement of two constant functions.
    expect(bodies.some((b) => terminalBlockSuppressed(b))).toBe(true);
    expect(bodies.some((b) => !terminalBlockSuppressed(b))).toBe(true);
  });

  test("the module reads the shipped predicate rather than re-deriving it", () => {
    const src = read(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "inline_terminal_block.ts"),
    );
    expect(src).toContain('from "./driven_run_signal"');
    expect(src).toMatch(/isDrivenRun/);
  });
});

// ===========================================================================
// AC-STE-550.3 — the authoring contract is untouched, and gains a branch.
// ===========================================================================

describe("AC-STE-550.3 — the adoption scanner's verdict is unchanged", () => {
  test("the scanner still finds no violation across the tree", () => {
    // BASELINE, measured on this tree 2026-09-04 before any edit: zero
    // violations over eleven graded surfaces.
    expect(scanStageBlockAdoption(REPO_ROOT)).toEqual([]);
  });

  test("that clean verdict is not vacuous — the eleven were graded", async () => {
    const report = await runStageBlockAdoptionProbe(REPO_ROOT);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
  });

  test("every adopting SKILL.md still documents a closed fence", () => {
    for (const stage of ADOPTING_STAGES) {
      expect(closedStatusFences(read(skillPath(stage))).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("suppression is a documented branch, present in all eleven", () => {
    // The clause is a shared literal with ONE owner, so a reword reaches every
    // adopting surface at once instead of drifting file by file.
    expect(DRIVEN_SUPPRESSION_CLAUSE.length).toBeGreaterThanOrEqual(24);
    expect(DRIVEN_SUPPRESSION_CLAUSE).toMatch(/driven/i);
    for (const stage of ADOPTING_STAGES) {
      const body = read(skillPath(stage));
      expect(documentsDrivenSuppression(body)).toBe(true);
    }
    expect(scanDrivenSuppressionAdoption(REPO_ROOT)).toEqual([]);
  });

  test("MUTATION — a clause with the driven branch removed is refused", () => {
    for (const stage of ADOPTING_STAGES) {
      const body = read(skillPath(stage));
      const mutant = body.split(DRIVEN_SUPPRESSION_CLAUSE).join("");
      // Measure the mutation before scoring it: a removal that never applied
      // reads as a pass.
      expect(mutant.length).toBeLessThan(body.length);
      expect(documentsDrivenSuppression(mutant)).toBe(false);
    }
  });

  test("MUTATION — the scanner names the stage whose branch is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-550-adoption-"));
    try {
      for (const stage of ADOPTING_STAGES) {
        const dir = join(root, "plugins", "dev-process-toolkit", "skills", stage);
        mkdirSync(dir, { recursive: true });
        cpSync(skillPath(stage), join(dir, "SKILL.md"));
      }
      // The unmutated copy grades exactly as the real tree does.
      expect(scanDrivenSuppressionAdoption(root)).toEqual([]);

      const victim = "brainstorm";
      const target = join(
        root, "plugins", "dev-process-toolkit", "skills", victim, "SKILL.md",
      );
      const before = read(target);
      writeFileSync(target, before.split(DRIVEN_SUPPRESSION_CLAUSE).join(""));
      expect(read(target).length).toBeLessThan(before.length);

      const violations = scanDrivenSuppressionAdoption(root);
      expect(violations.length).toBe(1);
      expect(violations[0]!.stage).toBe(victim);
      // The block-adoption scanner is a DIFFERENT subject and stays clean: the
      // authoring contract it grades is untouched by the missing branch.
      expect(scanStageBlockAdoption(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-550.4 — the capability-keys probe, run rather than argued about.
// ===========================================================================

describe("AC-STE-550.4 — closing_summary_capability_keys is unaffected", () => {
  test("EXECUTED against a tree whose rendered reports carry no tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-550-capkeys-"));
    try {
      const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
      mkdirSync(dir, { recursive: true });
      cpSync(skillPath("spec-write"), join(dir, "SKILL.md"));

      // The RENDERED reports in this tree carry no capability token at all —
      // which is exactly what a driven stage emits, and exactly what the probe
      // does not read. Its subject is the authoring file above.
      const reports = join(root, "reports");
      mkdirSync(reports, { recursive: true });
      const rendered = [
        "Design approved; proceeding to the next phase.",
        "",
        "No status block, no capability rows, no tokens of any kind.",
      ].join("\n");
      writeFileSync(join(reports, "phase1.txt"), rendered);
      expect(/`[a-z_]+`/.test(rendered)).toBe(false);

      const fixture = await runClosingSummaryCapabilityKeysProbe(root);
      const live = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
      // The SAME verdict as the real tree — the token-free reports moved it
      // not at all.
      expect(fixture.violations).toEqual([]);
      expect(live.violations).toEqual([]);
      expect(fixture.violations.length).toBe(live.violations.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CONTROL — mutating the AUTHORING file reddens the same probe", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-550-capkeys-control-"));
    try {
      const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, "SKILL.md");
      const before = read(skillPath("spec-write"));

      const directive = /MUST emit\s*`([a-z_]+)`/.exec(before);
      expect(directive).not.toBeNull();
      const killedKey = directive![1]!;
      const after = before.replace(directive![0], "the summary will mention it");
      // Measure the mutation before scoring it.
      expect(after).not.toBe(before);
      writeFileSync(target, after);

      const report = await runClosingSummaryCapabilityKeysProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(report.violations.map((v) => v.missingKey)).toContain(killedKey);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-550.5 — the one-fence-per-report refusal is untouched.
// ===========================================================================

describe("AC-STE-550.5 — two fences in one report are still refused", () => {
  test("the shipped grader refuses a two-fence report", () => {
    const one = standaloneReportFor("brainstorm");
    const two = `${one}\n${one}`;
    expect(closedStatusFences(two).length).toBe(2);
    const verdict = verifyStageReportAdoption(two);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.join("\n")).toMatch(/exactly one|two|2 /i);
  });

  test("this FR did not satisfy itself by relaxing the count rule", () => {
    // A driven report carries ZERO fences, which is a different case from the
    // one this rule polices; the rule's verdict on both non-one counts is
    // unchanged, so nothing here was widened to let the driven path through.
    const one = standaloneReportFor("brainstorm");
    expect(verifyStageReportAdoption(`${one}\n${one}`).ok).toBe(false);
    expect(verifyStageReportAdoption("just prose, no block at all").ok).toBe(false);
    expect(verifyStageReportAdoption(one).ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-550.6 / AC-STE-550.7 — the end-to-end leg, and its mutation.
// ===========================================================================

/** One inline step of the modelled `/deliver` chain. */
interface ChainPhase {
  /** The driving-site id in `DRIVING_SITES` — the shipped enumeration. */
  readonly site: string;
  /** The adopting stage `/deliver` invokes at that site. */
  readonly stage: string;
  /** Human label used in failure messages. */
  readonly label: string;
}

const CHAIN: readonly ChainPhase[] = [
  { site: "phase1_brainstorm_inline", stage: "brainstorm", label: "Phase 1" },
  { site: "phase2_spec_write_inline", stage: "spec-write", label: "Phase 2" },
  { site: "phase3_worker_kickoff", stage: "implement", label: "Phase 3" },
];

type Renderer = (standaloneReport: string, promptBody: string) => string;

interface ChainRun {
  reached: string[];
  operatorTurns: number;
  stoppedAt: string | null;
}

/**
 * Walk the chain in ONE turn, reading each phase's invocation body off the
 * SHIPPED `/deliver` surface: a site that supplies the driven literal hands its
 * stage a driven body, a site that does not hands it a plain one. A phase whose
 * emitted report ends the turn costs an operator turn before the next phase.
 */
function runChain(deliver: string, render: Renderer): ChainRun {
  const run: ChainRun = { reached: [], operatorTurns: 0, stoppedAt: null };
  for (const phase of CHAIN) {
    run.reached.push(phase.label);
    const driven = drivingSiteSupplies(deliver, phase.site);
    const body = driven ? `${DRIVEN_MARKER}\n${PLAIN_BODY}` : PLAIN_BODY;
    const emitted = render(standaloneReportFor(phase.stage), body);
    if (turnEnds(emitted)) {
      run.stoppedAt ??= phase.label;
      run.operatorTurns += 1;
    }
  }
  return run;
}

/** The chain up to the point the operator would have to type again. */
function runUntilOperator(deliver: string, render: Renderer): ChainRun {
  const run: ChainRun = { reached: [], operatorTurns: 0, stoppedAt: null };
  for (const phase of CHAIN) {
    run.reached.push(phase.label);
    const driven = drivingSiteSupplies(deliver, phase.site);
    const body = driven ? `${DRIVEN_MARKER}\n${PLAIN_BODY}` : PLAIN_BODY;
    if (turnEnds(render(standaloneReportFor(phase.stage), body))) {
      run.stoppedAt = phase.label;
      run.operatorTurns = 1;
      break;
    }
  }
  return run;
}

describe("AC-STE-550.6 — a driven /deliver run reaches Phase 3 in one turn", () => {
  test("the shipped /deliver supplies the signal at all three sites", () => {
    const deliver = deliverBody();
    for (const phase of CHAIN) {
      expect(drivingSiteSupplies(deliver, phase.site)).toBe(true);
    }
  });

  test("Phase 1 → Phase 3 with no operator turn in between", () => {
    const run = runUntilOperator(deliverBody(), stageReportFor);
    expect(run.stoppedAt).toBeNull();
    expect(run.operatorTurns).toBe(0);
    expect(run.reached).toEqual(["Phase 1", "Phase 2", "Phase 3"]);
  });

  test("no inline phase ends its turn", () => {
    const run = runChain(deliverBody(), stageReportFor);
    expect(run.operatorTurns).toBe(0);
    expect(run.stoppedAt).toBeNull();
  });
});

describe("AC-STE-550.7 — falsifiability: restore the fence on the driven path", () => {
  test("MUTATION — a renderer that ignores the signal stops at Phase 1", () => {
    // Restoring the fence on the driven path, expressed as the one change that
    // does it: strip the signal before the stage reads it, so every phase
    // renders its standalone report.
    const mutant: Renderer = (report, body) =>
      stageReportFor(report, body.split(DRIVEN_MARKER).join(""));

    // Measure the mutation before scoring it: the fence must actually be back.
    const phase1 = mutant(standaloneReportFor("brainstorm"), `${DRIVEN_MARKER}\n${PLAIN_BODY}`);
    expect(closedStatusFences(phase1).length).toBe(1);

    const run = runUntilOperator(deliverBody(), mutant);
    expect(run.stoppedAt).toBe("Phase 1");
    expect(run.operatorTurns).toBe(1);
    expect(run.reached).toEqual(["Phase 1"]);
    expect(run.reached).not.toContain("Phase 3");
  });

  test("MUTATION — a /deliver that stops supplying the signal stops at Phase 1", () => {
    const deliver = deliverBody();
    const mutant = deliver.split(DRIVEN_MARKER).join("");
    // Measure the mutation before scoring it.
    expect(mutant.length).toBeLessThan(deliver.length);
    expect(drivingSiteSupplies(mutant, "phase1_brainstorm_inline")).toBe(false);

    const run = runUntilOperator(mutant, stageReportFor);
    expect(run.stoppedAt).toBe("Phase 1");
    expect(run.reached).not.toContain("Phase 3");
  });
});

// ===========================================================================
// AC-STE-550.8 — the line caps, per file, against a pre-edit baseline.
// ===========================================================================

/**
 * MEASURED on this tree 2026-09-04, BEFORE any edit this FR makes. The three at
 * 358 have zero headroom, so their edits must be net-zero or shorter; the rest
 * are recorded so a silent growth spurt is visible too.
 */
const BASELINE_LINES: Readonly<Record<string, number>> = {
  "best-practices": 247,
  brainstorm: 139,
  deps: 356,
  "gate-check": 354,
  implement: 358,
  "report-issue": 205,
  setup: 358,
  "spec-archive": 193,
  "spec-review": 109,
  "spec-write": 358,
  upgrade: 240,
};

/** The zero-headroom three: their edits must not add a line. */
const NO_HEADROOM = ["implement", "setup", "spec-write"] as const;

describe("AC-STE-550.8 — every edited SKILL.md stays inside its line cap", () => {
  test("the cap is re-derived from the suite that enforces it, not recited", () => {
    const nfr1 = read(join(import.meta.dir, "skill-nfr-1-length.test.ts"));
    const m = /SKILL_LINE_CAP\s*=\s*(\d+)/.exec(nfr1);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(358);
  });

  test("`split(\"\\n\")` is the measurement, and it is not `wc -l`", () => {
    const body = read(skillPath("brainstorm"));
    expect(body.endsWith("\n")).toBe(true);
    // `wc -l` counts newlines and so reports one FEWER than this measurement.
    expect(lineCount(body)).toBe(body.split("\n").length);
    expect(lineCount(body)).toBe((body.match(/\n/g) ?? []).length + 1);
  });

  test("the baseline names every adopting stage, none more, none fewer", () => {
    expect(Object.keys(BASELINE_LINES).sort()).toEqual([...ADOPTING_STAGES].sort());
  });

  for (const stage of ADOPTING_STAGES) {
    test(`${stage}/SKILL.md is within the 358-line cap`, () => {
      expect(lineCount(read(skillPath(stage)))).toBeLessThanOrEqual(358);
    });
  }

  for (const stage of NO_HEADROOM) {
    test(`${stage}/SKILL.md is net-zero or shorter than its pre-edit baseline`, () => {
      // Asserted PER FILE, never in aggregate: one file absorbing another's
      // overflow must not read as compliance.
      expect(lineCount(read(skillPath(stage)))).toBeLessThanOrEqual(
        BASELINE_LINES[stage]!,
      );
    });
  }

  test("the baseline is a PRE-EDIT number, so 'unchanged' is distinguishable", () => {
    // The three zero-headroom files are recorded AT the cap. A leg that only
    // read the post-edit number could not tell "unchanged" from "was already
    // over"; this pins that the recorded baseline is the cap itself, which is
    // what makes the net-zero assertion above meaningful rather than slack.
    for (const stage of NO_HEADROOM) expect(BASELINE_LINES[stage]).toBe(358);
    expect(BASELINE_LINES["gate-check"]).toBe(354);
    expect(BASELINE_LINES["deps"]).toBe(356);
  });
});

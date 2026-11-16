// STE-795 (M_c46877) — TDD rounds record whether they claimed a file change.
//
// AC-STE-795.1 › claimed, .2 › not observable, .3 › zero_yield_round,
// .4 › type and schema, .5 › retro-reference. AC-STE-795.6 is the full-suite
// gate and has no test here.
//
// Every timeline is built by the shipped `buildTimeline` over a synthetic
// transcript in the measured Claude Code record shape (the STE-717 fixture
// helpers). A forked round's tool_result is the background stub, and its
// result block arrives in a `<task-notification>`; an inline round carries the
// block in the tool_result itself. Both sources are covered.
//
// All names, paths and ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateRetroRules, SKIPPED_DISPOSITION, type RetroInputs } from "../adapters/_shared/src/retro_rules";
import { parseTddResultBlock } from "../adapters/_shared/src/tdd_result";
import { buildTimeline, TIMELINE_SCHEMA, type Timeline } from "../adapters/_shared/src/tool_call_timeline";
import { PLUGIN_ROOT, cleanupTemps, tempDir } from "./_m_7bc805_capture_fixture";
import {
  T0,
  notification,
  skillUse,
  specReviewBlock,
  stubFor,
  tddSpecReviewBlock,
  toolResult,
} from "./_m_7bc805_timeline_fixture";

afterAll(cleanupTemps);

const T = 30_000;

const WRITE = "dev-process-toolkit:tdd-write-test";
const IMPL = "dev-process-toolkit:tdd-implement";
const REFAC = "dev-process-toolkit:tdd-refactor";
const TSR = "dev-process-toolkit:tdd-spec-review";
const SRA = "dev-process-toolkit:spec-review-audit";

/** A `tdd-result` block claiming exactly `files` (an empty list renders `files: []`). */
function claimBlock(role: string, status: "ok" | "failed", files: string[]): string {
  return [
    "```tdd-result",
    `role: ${role}`,
    `status: ${status}`,
    ...(files.length === 0 ? ["files: []"] : ["files:", ...files.map((f) => `  - ${f}`)]),
    "command: bun test tests/x.test.ts",
    "output_excerpt: |",
    "  ok",
    "```",
  ].join("\n");
}

/** A block the shipped parser refuses: no `command` field. */
const MALFORMED_BLOCK = ["```tdd-result", "role: implementer", "status: ok", "files: []", "output_excerpt: |", "  ok", "```"].join("\n");

type Step = { id: string; skill: string; result: string; forked: boolean } | { id: string; skill: string; stubOnly: true };

function transcriptOf(steps: Step[]): string {
  const records: string[] = [];
  steps.forEach((s, i) => {
    const at = T0 + i * 10_000;
    records.push(skillUse(s.id, s.skill, at));
    if ("stubOnly" in s) {
      records.push(toolResult(s.id, at + 45, { isError: false, content: stubFor(s.skill) }));
    } else if (s.forked) {
      records.push(toolResult(s.id, at + 45, { isError: false, content: stubFor(s.skill) }));
      records.push(...notification(s.id, at + 9000, s.result, "both", `agent_SYNTH_${i}`));
    } else {
      records.push(toolResult(s.id, at + 40, { isError: false, content: `Done.\n\n${s.result}\n` }));
    }
  });
  return `${records.join("\n")}\n`;
}

async function timelineOf(steps: Step[]): Promise<Timeline> {
  return buildTimeline(transcriptOf(steps), tempDir("ste795"), null);
}

const roundOf = (t: Timeline, id: string) => {
  const r = t.rounds.find((x) => x.tool_use_id === id);
  if (r === undefined) throw new Error(`no round ${id} in ${JSON.stringify(t.rounds.map((x) => x.tool_use_id))}`);
  return { tree_changed: r.tree_changed, tree_disposition: r.tree_disposition };
};

// ===========================================================================
// AC-STE-795.1 › claimed
// ===========================================================================

const CLAIMED_STEPS: Step[] = [
  // Inline write-test round claiming two files.
  { id: "toolu_C1", skill: WRITE, result: claimBlock("test-writer", "ok", ["tests/a.test.ts", "tests/b.test.ts"]), forked: false },
  // Forked implement round claiming no files.
  { id: "toolu_C2", skill: IMPL, result: claimBlock("implementer", "ok", []), forked: true },
  // Forked implement round claiming one file.
  { id: "toolu_C3", skill: IMPL, result: claimBlock("implementer", "ok", ["src/a.ts"]), forked: true },
  // Forked refactor round claiming no files.
  { id: "toolu_C4", skill: REFAC, result: claimBlock("refactorer", "ok", []), forked: true },
  // Forked refactor round claiming one file.
  { id: "toolu_C5", skill: REFAC, result: claimBlock("refactorer", "ok", ["src/b.ts"]), forked: true },
  // A failed implement round that still claims a file: the claim follows `files:`, not `status`.
  { id: "toolu_C6", skill: IMPL, result: claimBlock("implementer", "failed", ["src/c.ts"]), forked: true },
  // A failed write-test round claiming nothing.
  { id: "toolu_C7", skill: WRITE, result: claimBlock("test-writer", "failed", []), forked: false },
];

describe("AC-STE-795.1 › claimed", () => {
  test("CONTROL: the shipped parser reads each fixture block's files list as written", () => {
    expect(parseTddResultBlock(claimBlock("implementer", "ok", []))).toMatchObject({ ok: true, block: { files: [] } });
    expect(parseTddResultBlock(claimBlock("test-writer", "ok", ["tests/a.test.ts", "tests/b.test.ts"]))).toMatchObject({
      ok: true,
      block: { files: ["tests/a.test.ts", "tests/b.test.ts"] },
    });
    expect(parseTddResultBlock(MALFORMED_BLOCK).ok).toBe(false);
  });

  test("inline tdd-write-test round claiming two files records tree_changed true, claimed", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C1")).toEqual({ tree_changed: true, tree_disposition: "claimed" });
  }, T);

  test("forked tdd-implement round with `files: []` records tree_changed false, claimed", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C2")).toEqual({ tree_changed: false, tree_disposition: "claimed" });
  }, T);

  test("forked tdd-implement round claiming one file records tree_changed true, claimed", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C3")).toEqual({ tree_changed: true, tree_disposition: "claimed" });
  }, T);

  test("forked tdd-refactor round with `files: []` records tree_changed false, claimed", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C4")).toEqual({ tree_changed: false, tree_disposition: "claimed" });
  }, T);

  test("forked tdd-refactor round claiming one file records tree_changed true, claimed", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C5")).toEqual({ tree_changed: true, tree_disposition: "claimed" });
  }, T);

  test("a failed round's claim follows its files list: failed + one file reads true", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C6")).toEqual({ tree_changed: true, tree_disposition: "claimed" });
  }, T);

  test("a failed round's claim follows its files list: failed + no files reads false", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(roundOf(t, "toolu_C7")).toEqual({ tree_changed: false, tree_disposition: "claimed" });
  }, T);

  test("the round's status is still the block's status alongside the claim", async () => {
    const t = await timelineOf(CLAIMED_STEPS);
    expect(t.rounds.map((r) => [r.tool_use_id, r.status, r.tree_changed])).toEqual([
      ["toolu_C1", "ok", true],
      ["toolu_C2", "ok", false],
      ["toolu_C3", "ok", true],
      ["toolu_C4", "ok", false],
      ["toolu_C5", "ok", true],
      ["toolu_C6", "failed", true],
      ["toolu_C7", "failed", false],
    ]);
  }, T);
});

// ===========================================================================
// AC-STE-795.2 › not observable
// ===========================================================================

const NOT_OBSERVABLE = { tree_changed: null, tree_disposition: "not-observable" };

const UNOBSERVED_STEPS: Step[] = [
  // A TDD round whose notification holds no block.
  { id: "toolu_U1", skill: IMPL, result: "I changed things but forgot the fence.", forked: true },
  // A TDD round whose block the parser refuses.
  { id: "toolu_U2", skill: REFAC, result: MALFORMED_BLOCK, forked: true },
  // A forked TDD round with no notification at all.
  { id: "toolu_U3", skill: WRITE, stubOnly: true },
  // A tdd-spec-review round with a parsed ok block.
  { id: "toolu_U4", skill: TSR, result: tddSpecReviewBlock("ok"), forked: true },
  // A spec-review-audit round with a parsed clean block.
  { id: "toolu_U5", skill: SRA, result: specReviewBlock(false), forked: false },
  // A spec-review-audit round with a parsed drift block.
  { id: "toolu_U6", skill: SRA, result: specReviewBlock(true), forked: true },
  // A tdd-spec-review round whose result carries a tdd-result block claiming files:
  // a review round is never a claim, whatever its text holds.
  { id: "toolu_U7", skill: TSR, result: claimBlock("implementer", "ok", ["src/a.ts"]), forked: true },
];

describe("AC-STE-795.2 › not observable", () => {
  test("a TDD round whose result holds no block stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U1")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a TDD round whose block does not parse stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U2")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a forked TDD round with no notification stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U3")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a parsed tdd-spec-review round stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U4")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a parsed clean spec-review-audit round stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U5")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a parsed drift spec-review-audit round stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U6")).toEqual(NOT_OBSERVABLE);
  }, T);

  test("a tdd-spec-review round carrying a tdd-result claim block stays null + not-observable", async () => {
    const t = await timelineOf(UNOBSERVED_STEPS);
    expect(roundOf(t, "toolu_U7")).toEqual(NOT_OBSERVABLE);
  }, T);
});

// ===========================================================================
// AC-STE-795.3 › zero_yield_round
// ===========================================================================

function inputsFor(timeline: Timeline): RetroInputs {
  return {
    sessions: [{ session_id: "00000000-0000-4000-8000-000000000795", timeline, capture_rows: [] }],
    token_rows: [],
    tracking: { token_stats: true, tool_calls: true, gate_outcomes: true },
  };
}

function zeroYield(timeline: Timeline) {
  const r = evaluateRetroRules(inputsFor(timeline)).find((x) => x.id === "zero_yield_round");
  if (r === undefined) throw new Error("no zero_yield_round result");
  return { value: r.value, disposition: r.disposition, reason: r.reason };
}

describe("AC-STE-795.3 › zero_yield_round", () => {
  test("two implement rounds claiming no files and one claiming a file: observable, value 2, tripped", async () => {
    const t = await timelineOf([
      { id: "toolu_Z1", skill: IMPL, result: claimBlock("implementer", "ok", []), forked: true },
      { id: "toolu_Z2", skill: IMPL, result: claimBlock("implementer", "ok", []), forked: true },
      { id: "toolu_Z3", skill: IMPL, result: claimBlock("implementer", "ok", ["src/a.ts"]), forked: true },
    ]);
    expect(zeroYield(t)).toEqual({ value: 2, disposition: "tripped", reason: null });
  }, T);

  test("every round not observable: stays skipped with today's reason", async () => {
    const t = await timelineOf([
      { id: "toolu_Z4", skill: IMPL, result: "no fence here", forked: true },
      { id: "toolu_Z5", skill: REFAC, stubOnly: true },
      { id: "toolu_Z6", skill: IMPL, result: MALFORMED_BLOCK, forked: false },
    ]);
    expect(zeroYield(t)).toEqual({
      value: null,
      disposition: SKIPPED_DISPOSITION,
      reason: "every tdd-implement or tdd-refactor round has tree_disposition not-observable",
    });
  }, T);
});

// ===========================================================================
// AC-STE-795.4 › type and schema
// ===========================================================================

const TIMELINE_SOURCE = readFileSync(join(PLUGIN_ROOT, "adapters", "_shared", "src", "tool_call_timeline.ts"), "utf-8");

function timelineRoundInterface(): string {
  const m = /export interface TimelineRound \{([\s\S]*?)\n\}/.exec(TIMELINE_SOURCE);
  if (m === null) throw new Error("no `export interface TimelineRound` in tool_call_timeline.ts");
  return m[1]!;
}

describe("AC-STE-795.4 › type and schema", () => {
  test("TimelineRound.tree_changed admits boolean | null", () => {
    expect(/^\s*tree_changed: boolean \| null;$/m.test(timelineRoundInterface())).toBe(true);
  });

  test('TimelineRound.tree_disposition admits "claimed" | "not-observable"', () => {
    expect(/^\s*tree_disposition: "claimed" \| "not-observable";$/m.test(timelineRoundInterface())).toBe(true);
  });

  test("the schema id stays tool-call-timeline/v1, in the constant and on a built timeline with a claimed round", async () => {
    expect(TIMELINE_SCHEMA).toBe("tool-call-timeline/v1");
    const t = await timelineOf([{ id: "toolu_S1", skill: IMPL, result: claimBlock("implementer", "ok", []), forked: true }]);
    expect({ schema: t.schema, disposition: t.rounds[0]?.tree_disposition }).toEqual({ schema: "tool-call-timeline/v1", disposition: "claimed" });
  }, T);
});

// ===========================================================================
// AC-STE-795.5 › retro-reference
// ===========================================================================

describe("AC-STE-795.5 › retro-reference", () => {
  const doc = readFileSync(join(PLUGIN_ROOT, "docs", "retro-reference.md"), "utf-8");
  const paragraphs = doc.split(/\n\s*\n/);
  const claimParagraph = (): string | undefined =>
    paragraphs.find((p) => /round record is the round's claim, not a measured diff/i.test(p));

  test("the doc says the round record is the round's claim, not a measured diff", () => {
    expect(claimParagraph()).toBeString();
  });

  test("the same paragraph gives the reason: forked rounds share the tree and no snapshot is taken at their edges", () => {
    const p = claimParagraph() ?? "";
    expect({ sharedTree: /shared (working )?tree/i.test(p), snapshot: /snapshot/i.test(p) }).toEqual({ sharedTree: true, snapshot: true });
  });
});

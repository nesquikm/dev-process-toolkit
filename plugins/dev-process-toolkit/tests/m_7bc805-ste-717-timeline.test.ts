// STE-717 (M_7bc805) — the tool-call timeline reader.
//
// AC-STE-717.1 › calls, .2 › pairing, .3 › rounds, .4 › tokens, .5 › gate runs,
// .6 › privacy, .7 › front door, .10 (the STE-714 slice), .11 (mutation
// controls for the reader), .14 (session id).
//
// Every timeline here comes from SPAWNING the shipped CLI
// (`bun run adapters/_shared/src/tool_call_timeline.ts <transcript> <root>`),
// so a missing module reds each test rather than the file. Every receipt is
// minted by spawning the shipped gate_receipt.ts front door (the STE-614 rule).
//
// Measured facts (specs/notes/ste-714-hook-payload-measurement.md): D2 no (no
// `exit_code`), D3 no (per-round `tokens` is "not-observable"), D5 no
// (`tree_changed` null with `tree_disposition: "not-observable"` on every
// round). The tokens and tree cases read the decision row and take its branch.
//
// A forked Skill call's tool_result is only the background stub; its result
// block arrives as a `<task-notification>` naming the call's id. A round's
// status is parsed from the tool_result text, or — when that is the stub — the
// matching notification's `<result>` body. Both sources are covered.

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseSpecReviewResultBlock } from "../adapters/_shared/src/spec_review_result";
import { parseTddResultBlock } from "../adapters/_shared/src/tdd_result";
import { parseTddSpecReviewBlock } from "../adapters/_shared/src/tdd_spec_review_result";
import { PLUGIN_ROOT, cleanupTemps, makeCheckout, pluginCopy, runCapture, payload as capturePayload, tempDir } from "./_m_7bc805_capture_fixture";
import { makeTree, mintRun, parseAnnouncement, readJson, runCli } from "./_m_7bc805_gate_outcome_fixture";
import {
  CALL_KEYS,
  GAP_KEYS,
  GATE_RUN_KEYS,
  NFR10_RE,
  ROUND_KEYS,
  T0,
  TIMELINE_MODULE,
  TOP_KEYS,
  type Timeline,
  bashUse,
  decision,
  iso,
  notification,
  registeredCheckout,
  runTimelineCli,
  skillUse,
  specReviewBlock,
  stubFor,
  tddBlock,
  tddSpecReviewBlock,
  timelineOf,
  toolResult,
  toolUse,
  usageRecord,
  writeCaptureRows,
  writeSessionTranscript,
} from "./_m_7bc805_timeline_fixture";

const T = 60_000;
const SID = "00000000-0000-4000-8000-000000000717";
const GATE_SID = "00000000-0000-4000-8000-000000000007";

afterAll(cleanupTemps);

// ===========================================================================
// AC-STE-717.1 › calls
// ===========================================================================

function callsRecords(cwd: string): string[] {
  return [
    bashUse("toolu_C1", "ls", T0, { cwd }),
    toolResult("toolu_C1", T0 + 250, { isError: false, content: "a.txt" }),
    bashUse("toolu_C2", "false", T0 + 1000, { cwd }),
    toolResult("toolu_C2", T0 + 1100, { isError: true, content: "Exit code 1" }),
    bashUse("toolu_C3", "echo hi", T0 + 2000, { cwd }),
    toolResult("toolu_C3", T0 + 2040, { content: "hi" }), // no is_error field at all
    skillUse("toolu_C4", "dev-process-toolkit:best-practices", T0 + 3000, { cwd }),
    toolResult("toolu_C4", T0 + 3030, { content: "Launching skill: dev-process-toolkit:best-practices" }),
    toolUse("toolu_C5", "Read", { file_path: "a.txt" }, T0 + 3500, { cwd }),
    toolResult("toolu_C5", T0 + 3510, { content: "one" }),
    bashUse("toolu_C6", "sleep 100", T0 + 4000, { cwd }), // never returned
    // One call written twice (first copy unstamped), and its result written twice.
    bashUse("toolu_D1", "pwd", T0 + 5000, { cwd, unstamped: true }),
    bashUse("toolu_D1", "pwd", T0 + 5001, { cwd }),
    toolResult("toolu_D1", T0 + 5100, { isError: false, content: "/x" }),
    toolResult("toolu_D1", T0 + 5900, { isError: true, content: "/x" }),
    skillUse("toolu_C7", "someone-else:skill", T0 + 6000, { cwd }),
    toolResult("toolu_C7", T0 + 6010, { isError: false }),
  ];
}

const EXPECTED_CALLS: Array<Record<string, unknown>> = [
  { tool_use_id: "toolu_C1", tool: "Bash", class: "other", skill: null, started_at: T0, ended_at: T0 + 250, wall_ms: 250, is_error: false },
  { tool_use_id: "toolu_C2", tool: "Bash", class: "other", skill: null, started_at: T0 + 1000, ended_at: T0 + 1100, wall_ms: 100, is_error: true },
  { tool_use_id: "toolu_C3", tool: "Bash", class: "other", skill: null, started_at: T0 + 2000, ended_at: T0 + 2040, wall_ms: 40, is_error: false },
  {
    tool_use_id: "toolu_C4",
    tool: "Skill",
    class: "skill",
    skill: "dev-process-toolkit:best-practices",
    started_at: T0 + 3000,
    ended_at: T0 + 3030,
    wall_ms: 30,
    is_error: false,
  },
  { tool_use_id: "toolu_C6", tool: "Bash", class: "other", skill: null, started_at: T0 + 4000, ended_at: null, wall_ms: null, is_error: false },
  { tool_use_id: "toolu_D1", tool: "Bash", class: "other", skill: null, started_at: T0 + 5001, ended_at: T0 + 5100, wall_ms: 99, is_error: false },
  { tool_use_id: "toolu_C7", tool: "Skill", class: "skill", skill: "other", started_at: T0 + 6000, ended_at: T0 + 6010, wall_ms: 10, is_error: false },
];

/** The `› calls` assertion, as a list of mismatches (reused by the mutation controls). */
function callsFailures(t: Timeline): string[] {
  const out: string[] = [];
  const ids = t.calls.map((c) => c.tool_use_id);
  const want = EXPECTED_CALLS.map((c) => c.tool_use_id);
  if (JSON.stringify(ids) !== JSON.stringify(want)) out.push(`ids ${JSON.stringify(ids)} != ${JSON.stringify(want)}`);
  for (const exp of EXPECTED_CALLS) {
    const got = t.calls.filter((c) => c.tool_use_id === exp.tool_use_id);
    if (got.length !== 1) {
      out.push(`${exp.tool_use_id}: ${got.length} calls`);
      continue;
    }
    for (const [k, v] of Object.entries(exp)) if (got[0]![k] !== v) out.push(`${exp.tool_use_id}.${k}: ${JSON.stringify(got[0]![k])} != ${JSON.stringify(v)}`);
  }
  return out;
}

function callsTimeline(pluginRoot?: string): Timeline {
  const root = makeCheckout("calls", "none");
  const transcript = writeSessionTranscript(tempDir("calls-tr"), SID, callsRecords(root));
  return timelineOf(transcript, root, { pluginRoot });
}

describe("AC-STE-717.1 › calls", () => {
  test("calls: started_at, ended_at, wall_ms and is_error per Bash and Skill call; a call written twice is one call", () => {
    const t = callsTimeline();
    expect(t.schema).toBe("tool-call-timeline/v1");
    expect(callsFailures(t)).toEqual([]);
  }, T);

  test("calls: a result with no is_error field reads false; only `is_error === true` reads true", () => {
    const t = callsTimeline();
    expect(t.calls.find((c) => c.tool_use_id === "toolu_C3")?.is_error).toBe(false);
    expect(t.calls.find((c) => c.tool_use_id === "toolu_C6")?.is_error).toBe(false);
    expect(t.calls.find((c) => c.tool_use_id === "toolu_C2")?.is_error).toBe(true);
  }, T);

  test("calls: a non-Bash, non-Skill tool_use (Read) is not a call", () => {
    const t = callsTimeline();
    expect(t.calls.some((c) => c.tool_use_id === "toolu_C5")).toBe(false);
  }, T);

  test("calls: each call's class equals the class the STE-716 capture hook writes for the same command", () => {
    const { root, cfg, record } = registeredCheckout("classes");
    const commands: Record<string, string> = {
      toolu_K1: "ls",
      toolu_K2: 'git commit -m "x"',
      toolu_K3: "gh pr create --fill",
      toolu_K4: `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check "${root}"`,
    };
    const records: string[] = [];
    let at = T0;
    for (const [id, command] of Object.entries(commands)) {
      const r = runCapture(capturePayload({ event: "pre", tool: "Bash", cwd: root, command, toolUseId: id, sid: SID }), {
        record,
        env: { CLAUDE_CONFIG_DIR: cfg },
      });
      expect(r.exitCode).toBe(0);
      records.push(bashUse(id, command, at, { cwd: root }), toolResult(id, at + 5, { isError: false }));
      at += 100;
    }
    const rows = readFileSync(join(root, ".dpt", "ledger", "tool-calls", `${SID}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const hookClass = Object.fromEntries(rows.map((r) => [r.tool_use_id, r.class]));
    expect(hookClass).toEqual({ toolu_K1: "other", toolu_K2: "commit", toolu_K3: "pr-create", toolu_K4: "gate-receipt" });
    const t = timelineOf(writeSessionTranscript(tempDir("classes-tr"), SID, records), root);
    expect(Object.fromEntries(t.calls.map((c) => [c.tool_use_id, c.class]))).toEqual(hookClass);
  }, T);

  test("calls: the reader reads blocks through firstCopies(…, { topLevel: true }) and never recordTimestamp", () => {
    const src = readFileSync(TIMELINE_MODULE, "utf-8");
    expect(src).toContain("firstCopies");
    expect(src).toMatch(/topLevel:\s*true/);
    expect(src).not.toContain("recordTimestamp");
    const session = readFileSync(join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts"), "utf-8");
    expect(session).not.toMatch(/export function recordTimestamp/);
  });
});

// ===========================================================================
// AC-STE-717.2 › pairing
// ===========================================================================

describe("AC-STE-717.2 › pairing", () => {
  test("pairing: paired, orphan-pre, orphan-post, uncaptured and a duplicated pre; duration_ms, every gaps count, diff from a commit pre row", () => {
    const root = makeCheckout("pairing", "none");
    const records = [
      bashUse("toolu_P1", "ls", T0, { cwd: root }),
      toolResult("toolu_P1", T0 + 100, { isError: false }),
      bashUse("toolu_P2", "ls", T0 + 1000, { cwd: root }),
      toolResult("toolu_P2", T0 + 1100, { isError: true }),
      bashUse("toolu_P3", "ls", T0 + 2000, { cwd: root }),
      toolResult("toolu_P3", T0 + 2100, { isError: false }),
      bashUse("toolu_P4", "ls", T0 + 3000, { cwd: root }),
      toolResult("toolu_P4", T0 + 3100, { isError: false }),
      bashUse("toolu_P5", "ls", T0 + 4000, { cwd: root }),
      toolResult("toolu_P5", T0 + 4100, { isError: false }),
      bashUse("toolu_P6", 'git commit -m "x"', T0 + 5000, { cwd: root }),
      toolResult("toolu_P6", T0 + 5300, { isError: false }),
    ];
    const diff = { files: 2, insertions: 5, deletions: 1 };
    writeCaptureRows(root, SID, [
      { event: "pre", id: "toolu_P1", ts: T0 + 25 },
      { event: "post", id: "toolu_P1", ts: T0 + 65 },
      { event: "pre", id: "toolu_P2", ts: T0 + 1025 },
      { event: "post", id: "toolu_P3", ts: T0 + 2095 },
      // P4: no rows at all
      { event: "pre", id: "toolu_P5", ts: T0 + 4020 },
      { event: "pre", id: "toolu_P5", ts: T0 + 4500 }, // duplicate: the first row wins
      { event: "post", id: "toolu_P5", ts: T0 + 4080 },
      { event: "pre", id: "toolu_P6", cls: "commit", ts: T0 + 5020, tree: "sha256:aa", diff },
      { event: "post", id: "toolu_P6", cls: "commit", ts: T0 + 5290 },
    ]);
    const t = timelineOf(writeSessionTranscript(tempDir("pairing-tr"), SID, records), root);
    const by = Object.fromEntries(t.calls.map((c) => [c.tool_use_id, c]));
    expect(
      Object.fromEntries(Object.entries(by).map(([id, c]) => [id, { pairing: c.pairing, duration_ms: c.duration_ms }])),
    ).toEqual({
      toolu_P1: { pairing: "paired", duration_ms: 40 },
      toolu_P2: { pairing: "orphan-pre", duration_ms: null },
      toolu_P3: { pairing: "orphan-post", duration_ms: null },
      toolu_P4: { pairing: "uncaptured", duration_ms: null },
      toolu_P5: { pairing: "paired", duration_ms: 60 },
      toolu_P6: { pairing: "paired", duration_ms: 270 },
    });
    expect(t.gaps).toEqual({ orphan_pre: 1, orphan_post: 1, uncaptured: 1, duplicates: 1 });
    expect(by.toolu_P6!.class).toBe("commit");
    expect(by.toolu_P6!.diff).toEqual(diff);
    expect(by.toolu_P1!.diff).toBeNull();
    expect(by.toolu_P4!.diff).toBeNull();
  }, T);

  test("pairing: rows of another session are not read", () => {
    const root = makeCheckout("pairing-other", "none");
    writeCaptureRows(root, "00000000-0000-4000-8000-000000000799", [
      { event: "pre", id: "toolu_Q1", ts: T0 + 10 },
      { event: "post", id: "toolu_Q1", ts: T0 + 20 },
    ]);
    const records = [bashUse("toolu_Q1", "ls", T0, { cwd: root }), toolResult("toolu_Q1", T0 + 30, { isError: false })];
    const t = timelineOf(writeSessionTranscript(tempDir("pairing-other-tr"), SID, records), root);
    expect(t.calls[0]!.pairing).toBe("uncaptured");
    expect(t.gaps).toEqual({ orphan_pre: 0, orphan_post: 0, uncaptured: 1, duplicates: 0 });
  }, T);
});

// ===========================================================================
// AC-STE-717.3 › rounds, AC-STE-717.4 › tokens
// ===========================================================================

const D3 = decision("D3");
const D5 = decision("D5");

interface RoundCase {
  id: string;
  skill: string;
  status: "ok" | "failed" | "unparsed";
  /** What tree_changed would be if D5 were yes. */
  treeIfObservable: boolean | null;
}

const ROUND_CASES: RoundCase[] = [
  { id: "toolu_R1", skill: "dev-process-toolkit:tdd-write-test", status: "ok", treeIfObservable: true },
  { id: "toolu_R2", skill: "dev-process-toolkit:tdd-implement", status: "failed", treeIfObservable: false },
  { id: "toolu_R3", skill: "dev-process-toolkit:spec-review-audit", status: "failed", treeIfObservable: null },
  { id: "toolu_R4", skill: "dev-process-toolkit:spec-review-audit", status: "ok", treeIfObservable: null },
  { id: "toolu_R5", skill: "dev-process-toolkit:tdd-refactor", status: "unparsed", treeIfObservable: null },
  { id: "toolu_R6", skill: "dev-process-toolkit:tdd-spec-review", status: "ok", treeIfObservable: null },
  { id: "toolu_R7", skill: "dev-process-toolkit:tdd-implement", status: "unparsed", treeIfObservable: null },
];

function roundsFixture(): { root: string; transcript: string } {
  const root = makeCheckout("rounds", "none");
  const c = { cwd: root };
  const records = [
    // R1: inline-shaped tool_result carrying the tdd block (status ok).
    skillUse("toolu_R1", "dev-process-toolkit:tdd-write-test", T0, c),
    toolResult("toolu_R1", T0 + 40, { isError: false, content: `RED confirmed.\n\n${tddBlock("test-writer", "ok")}\n` }),
    usageRecord(T0 + 50, "dev-process-toolkit:tdd-write-test", 1234),
    // R2: background stub, then a notification (both forms) carrying a failed tdd block.
    skillUse("toolu_R2", "dev-process-toolkit:tdd-implement", T0 + 1000, c),
    toolResult("toolu_R2", T0 + 1045, { isError: false, content: stubFor("dev-process-toolkit:tdd-implement") }),
    usageRecord(T0 + 1100, "dev-process-toolkit:tdd-implement", 2222),
    ...notification("toolu_R2", T0 + 9000, tddBlock("implementer", "failed"), "both", "agent_SYNTH_72"),
    // R3: stub + queue-operation notification only, spec-review block with drift.
    skillUse("toolu_R3", "dev-process-toolkit:spec-review-audit", T0 + 10_000, c),
    toolResult("toolu_R3", T0 + 10_045, { isError: false, content: [{ type: "text", text: stubFor("dev-process-toolkit:spec-review-audit") }] }),
    ...notification("toolu_R3", T0 + 19_000, specReviewBlock(true), "queue", "agent_SYNTH_73"),
    // R4: inline content-block array carrying a clean spec-review block.
    skillUse("toolu_R4", "dev-process-toolkit:spec-review-audit", T0 + 20_000, c),
    toolResult("toolu_R4", T0 + 20_040, { isError: false, content: [{ type: "text", text: specReviewBlock(false) }] }),
    // R5: stub + a notification whose result holds no block.
    skillUse("toolu_R5", "dev-process-toolkit:tdd-refactor", T0 + 30_000, c),
    toolResult("toolu_R5", T0 + 30_045, { isError: false, content: stubFor("dev-process-toolkit:tdd-refactor") }),
    ...notification("toolu_R5", T0 + 39_000, "I cleaned things up but forgot the fence.", "user", "agent_SYNTH_75"),
    // R6: stub + user-text notification only, tdd-spec-review block ok.
    skillUse("toolu_R6", "dev-process-toolkit:tdd-spec-review", T0 + 40_000, c),
    toolResult("toolu_R6", T0 + 40_045, { isError: false, content: stubFor("dev-process-toolkit:tdd-spec-review") }),
    ...notification("toolu_R6", T0 + 49_000, tddSpecReviewBlock("ok"), "user", "agent_SYNTH_76"),
    // R7: stub and no notification at all.
    skillUse("toolu_R7", "dev-process-toolkit:tdd-implement", T0 + 50_000, c),
    toolResult("toolu_R7", T0 + 50_045, { isError: false, content: stubFor("dev-process-toolkit:tdd-implement") }),
    // Not a round: an inline gate skill.
    skillUse("toolu_N1", "dev-process-toolkit:gate-check", T0 + 60_000, c),
    toolResult("toolu_N1", T0 + 60_005, { isError: false, content: tddBlock("test-writer", "ok") }),
    // Not a round: a fork-internal Bash call.
    bashUse("toolu_N2", "ls", T0 + 60_100, c),
    toolResult("toolu_N2", T0 + 60_200, { isError: false }),
  ];
  writeCaptureRows(root, SID, [
    { event: "pre", id: "toolu_R1", tool: "Skill", skill: "dev-process-toolkit:tdd-write-test", ts: T0 + 20, tree: "sha256:aaaa" },
    { event: "post", id: "toolu_R1", tool: "Skill", skill: "dev-process-toolkit:tdd-write-test", ts: T0 + 35, tree: "sha256:bbbb" },
    { event: "pre", id: "toolu_R2", tool: "Skill", skill: "dev-process-toolkit:tdd-implement", ts: T0 + 1020, tree: "sha256:cccc" },
    { event: "post", id: "toolu_R2", tool: "Skill", skill: "dev-process-toolkit:tdd-implement", ts: T0 + 1040, tree: "sha256:cccc" },
    { event: "pre", id: "toolu_R3", tool: "Skill", skill: "dev-process-toolkit:spec-review-audit", ts: T0 + 10_020, tree: "sha256:dddd" },
  ]);
  return { root, transcript: writeSessionTranscript(tempDir("rounds-tr"), SID, records) };
}

/** The `› rounds` status and tree assertion, as mismatches. */
function roundsFailures(t: Timeline, d5: boolean): string[] {
  const out: string[] = [];
  const ids = t.rounds.map((r) => r.tool_use_id);
  if (JSON.stringify(ids) !== JSON.stringify(ROUND_CASES.map((c) => c.id))) out.push(`round ids ${JSON.stringify(ids)}`);
  for (const c of ROUND_CASES) {
    const r = t.rounds.find((x) => x.tool_use_id === c.id);
    if (r === undefined) {
      out.push(`${c.id}: no round`);
      continue;
    }
    if (r.skill !== c.skill) out.push(`${c.id}.skill ${r.skill}`);
    if (r.status !== c.status) out.push(`${c.id}.status ${r.status} != ${c.status}`);
    if (d5 && c.treeIfObservable !== null) {
      if (r.tree_changed !== c.treeIfObservable) out.push(`${c.id}.tree_changed ${r.tree_changed}`);
    } else {
      if (r.tree_changed !== null) out.push(`${c.id}.tree_changed ${JSON.stringify(r.tree_changed)} != null`);
      if (r.tree_disposition !== "not-observable") out.push(`${c.id}.tree_disposition ${JSON.stringify(r.tree_disposition)}`);
    }
  }
  return out;
}

/** The `› tokens` D3 branch, as mismatches. */
function tokensFailures(t: Timeline, d3: boolean): string[] {
  const out: string[] = [];
  if (t.rounds.length === 0) out.push("no rounds");
  for (const r of t.rounds) {
    if (d3) {
      if (typeof r.tokens !== "number") out.push(`${r.tool_use_id}.tokens ${JSON.stringify(r.tokens)} is not a number`);
    } else if (r.tokens !== "not-observable") out.push(`${r.tool_use_id}.tokens ${JSON.stringify(r.tokens)} != "not-observable"`);
  }
  return out;
}

describe("AC-STE-717.3 › rounds", () => {
  test("CONTROL: every fixture block parses with the shipped parsers to the status the case expects", () => {
    expect(parseTddResultBlock(tddBlock("test-writer", "ok"))).toMatchObject({ ok: true, block: { status: "ok" } });
    expect(parseTddResultBlock(tddBlock("implementer", "failed"))).toMatchObject({ ok: true, block: { status: "failed" } });
    expect(parseTddSpecReviewBlock(tddSpecReviewBlock("ok"))).toMatchObject({ ok: true, block: { status: "ok" } });
    const drift = parseSpecReviewResultBlock(specReviewBlock(true));
    const clean = parseSpecReviewResultBlock(specReviewBlock(false));
    expect(drift.ok && clean.ok).toBe(true);
    if (drift.ok && clean.ok) {
      expect(drift.block.drift_count).toBeGreaterThan(0);
      expect(clean.block.drift_count).toBe(0);
      expect(clean.block.traceability.every((r) => r.status === "done")).toBe(true);
    }
  });

  test("rounds: status ok / failed (tdd), failed / ok (spec-review with and without drift), unparsed; from the tool_result or the task-notification", () => {
    const { root, transcript } = roundsFixture();
    const t = timelineOf(transcript, root);
    expect(roundsFailures(t, D5)).toEqual([]);
  }, T);

  test(`rounds: tree_changed per D5 (${D5 ? "yes" : "no"}) — ${D5 ? "true / false from the digests, null + not-observable on a missing post" : "null + not-observable on every round, digests or not"}`, () => {
    const { root, transcript } = roundsFixture();
    const t = timelineOf(transcript, root);
    for (const r of t.rounds) {
      if (!D5) expect({ id: r.tool_use_id, tree_changed: r.tree_changed, tree_disposition: r.tree_disposition }).toEqual({
        id: r.tool_use_id,
        tree_changed: null,
        tree_disposition: "not-observable",
      });
    }
    const r3 = t.rounds.find((r) => r.tool_use_id === "toolu_R3");
    expect(r3).toMatchObject({ tree_changed: null, tree_disposition: "not-observable" });
  }, T);

  test("rounds: only the five child skills make rounds; gate-check and Bash calls do not", () => {
    const { root, transcript } = roundsFixture();
    const t = timelineOf(transcript, root);
    expect(t.rounds.some((r) => r.tool_use_id === "toolu_N1" || r.tool_use_id === "toolu_N2")).toBe(false);
    expect(t.calls.some((c) => c.tool_use_id === "toolu_N1")).toBe(true);
  }, T);

  test("rounds (AC-STE-717.10): the committed STE-714 /tdd slice and payloads — one round per child skill, status unparsed, tree and tokens not-observable", () => {
    const fixtures = join(PLUGIN_ROOT, "tests", "fixtures", "hook-payloads");
    const sliceSid = "00000000-0000-4000-8000-000000000002";
    const dir = tempDir("slice");
    const transcript = join(dir, `${sliceSid}.jsonl`);
    copyFileSync(join(fixtures, "tdd-run-main-transcript-slice.jsonl"), transcript);
    const root = makeCheckout("slice-root", "none");
    const pre = JSON.parse(readFileSync(join(fixtures, "pre-skill-fork-tdd-write-test.json"), "utf-8")) as Record<string, any>;
    const post = JSON.parse(readFileSync(join(fixtures, "post-skill-fork-tdd-write-test.json"), "utf-8")) as Record<string, any>;
    expect(pre.payload.tool_use_id).toBe("toolu_SYNTH_06");
    writeCaptureRows(root, sliceSid, [
      { event: "pre", id: pre.payload.tool_use_id, tool: "Skill", skill: pre.payload.tool_input.skill, ts: pre.wall_clock_ms, tree: "sha256:1111" },
      { event: "post", id: post.payload.tool_use_id, tool: "Skill", skill: post.payload.tool_input.skill, ts: post.wall_clock_ms, tree: "sha256:1111" },
    ]);
    const t = timelineOf(transcript, root);
    expect(t.rounds.map((r) => [r.tool_use_id, r.skill])).toEqual([
      ["toolu_SYNTH_06", "dev-process-toolkit:tdd-write-test"],
      ["toolu_SYNTH_14", "dev-process-toolkit:tdd-implement"],
      ["toolu_SYNTH_16", "dev-process-toolkit:tdd-refactor"],
      ["toolu_SYNTH_18", "dev-process-toolkit:tdd-spec-review"],
    ]);
    // The slice's result bodies are scrubbed, so no block is observable.
    for (const r of t.rounds) expect(r.status).toBe("unparsed");
    // D5 no: equal pre/post digests on SYNTH_06 still read null + not-observable.
    if (!D5) {
      for (const r of t.rounds) expect({ id: r.tool_use_id, tc: r.tree_changed, td: r.tree_disposition }).toEqual({ id: r.tool_use_id, tc: null, td: "not-observable" });
    }
    expect(tokensFailures(t, D3)).toEqual([]);
    expect(t.calls.map((c) => c.tool_use_id)).toEqual([
      "toolu_SYNTH_12",
      "toolu_SYNTH_06",
      "toolu_SYNTH_13",
      "toolu_SYNTH_14",
      "toolu_SYNTH_15",
      "toolu_SYNTH_16",
      "toolu_SYNTH_17",
      "toolu_SYNTH_18",
    ]);
    const c12 = t.calls.find((c) => c.tool_use_id === "toolu_SYNTH_12")!;
    expect({ is_error: c12.is_error, started_at: c12.started_at, ended_at: c12.ended_at, wall_ms: c12.wall_ms }).toEqual({
      is_error: true,
      started_at: Date.parse("2026-11-06T04:57:41.662Z"),
      ended_at: Date.parse("2026-11-06T04:57:41.770Z"),
      wall_ms: 108,
    });
    const c06 = t.calls.find((c) => c.tool_use_id === "toolu_SYNTH_06")!;
    expect({ wall_ms: c06.wall_ms, pairing: c06.pairing, duration_ms: c06.duration_ms, class: c06.class }).toEqual({
      wall_ms: 76,
      pairing: "paired",
      duration_ms: post.wall_clock_ms - pre.wall_clock_ms,
      class: "skill",
    });
    expect(t.gate_runs).toEqual([]);
  }, T);
});

describe("AC-STE-717.4 › tokens", () => {
  test(`tokens: D3 is ${D3 ? "yes — a number on every round" : 'no — "not-observable" on every round, never 0'}, though child-attributed usage records sit in the transcript`, () => {
    const { root, transcript } = roundsFixture();
    const t = timelineOf(transcript, root);
    expect(tokensFailures(t, D3)).toEqual([]);
    if (!D3) for (const r of t.rounds) expect(r.tokens).not.toBe(0);
  }, T);
});

// ===========================================================================
// AC-STE-717.5 › gate runs, AC-STE-717.14 session id
// ===========================================================================

function gateCheckSpan(root: string): string[] {
  // A gate-check Skill call spanning 5 ms: never a gate's run time.
  return [skillUse("toolu_G1", "dev-process-toolkit:gate-check", T0, { cwd: root }), toolResult("toolu_G1", T0 + 5, { isError: false })];
}

function mintOutcome(root: string, skill: string, verdict: "pass" | "fail", sid = GATE_SID): string {
  const r = runCli(["outcome", skill, root, verdict], { sid });
  if (r.exitCode !== 0) throw new Error(`outcome CLI exit ${r.exitCode}: ${r.stderr}`);
  const parsed = parseAnnouncement(r.stdout.split("\n")[0] ?? "", "dpt-gate-outcome: ");
  if (parsed === null) throw new Error(`outcome CLI announced nothing: ${r.stdout}`);
  return parsed.path;
}

describe("AC-STE-717.5 › gate runs", () => {
  test("gate runs: one run per gate receipt; outcome and wall_ms from the paired outcome; none / null when unpaired; a 5 ms gate-check call with receipts 90 s apart yields 90000", () => {
    const root = makeTree("gate-runs", "on");
    const g = mintRun(root, "gate-check", { sid: GATE_SID });
    const gOut = mintOutcome(root, "gate-check", "pass");
    const s = mintRun(root, "spec-review", { sid: GATE_SID });
    mintOutcome(root, "spec-review", "fail");
    const d = mintRun(root, "tdd", { sid: GATE_SID });
    // Re-stamp the gate-check outcome 90 s after its run. The outcome's own bytes
    // are digested by nothing, so its pairing (evidence.run) still holds.
    const run = readJson(g.path);
    const out = readJson(gOut);
    out.createdAt = iso(Date.parse(run.createdAt as string) + 90_000);
    writeFileSync(gOut, `${JSON.stringify(out)}\n`);

    const t = timelineOf(writeSessionTranscript(tempDir("gate-tr"), GATE_SID, gateCheckSpan(root)), root);
    expect(t.gate_runs.length).toBe(3);
    const by = Object.fromEntries(t.gate_runs.map((r) => [r.subject, r]));
    expect(Object.keys(by).sort()).toEqual(["dev-process-toolkit:gate-check", "dev-process-toolkit:spec-review", "dev-process-toolkit:tdd"]);
    const gc = by["dev-process-toolkit:gate-check"]!;
    expect({ ran_at: gc.ran_at, outcome: gc.outcome, wall_ms: gc.wall_ms }).toEqual({ ran_at: run.createdAt, outcome: "pass", wall_ms: 90_000 });
    expect(gc.key_digest).toBe((run.evidence as Record<string, unknown>).key_digest);
    expect(typeof gc.key_digest).toBe("string");
    expect(gc.key_stable).toBe((out.evidence as Record<string, unknown>).key_stable);
    const sr = by["dev-process-toolkit:spec-review"]!;
    expect(sr.outcome).toBe("fail");
    expect(sr.ran_at).toBe(readJson(s.path).createdAt);
    expect(typeof sr.wall_ms).toBe("number");
    const td = by["dev-process-toolkit:tdd"]!;
    expect({ ran_at: td.ran_at, outcome: td.outcome, wall_ms: td.wall_ms, key_stable: td.key_stable }).toEqual({
      ran_at: readJson(d.path).createdAt,
      outcome: "none",
      wall_ms: null,
      key_stable: null,
    });
    // The 5 ms Skill call is a call, never the gate's time.
    expect(t.calls.find((c) => c.tool_use_id === "toolu_G1")?.wall_ms).toBe(5);
  }, T);

  test("gate runs: with tracking.gate_outcomes off every run reads outcome none, key_digest null, key_stable null", () => {
    const root = makeTree("gate-runs-off", "absent");
    mintRun(root, "gate-check", { sid: GATE_SID });
    mintRun(root, "tdd", { sid: GATE_SID });
    mintRun(root, "spec-review", { sid: GATE_SID });
    const silent = runCli(["outcome", "gate-check", root, "pass"], { sid: GATE_SID });
    expect({ code: silent.exitCode, out: silent.stdout }).toEqual({ code: 0, out: "" });
    const t = timelineOf(writeSessionTranscript(tempDir("gate-off-tr"), GATE_SID, gateCheckSpan(root)), root);
    expect(t.gate_runs.length).toBe(3);
    for (const r of t.gate_runs) {
      expect({ outcome: r.outcome, wall_ms: r.wall_ms, key_digest: r.key_digest, key_stable: r.key_stable }).toEqual({
        outcome: "none",
        wall_ms: null,
        key_digest: null,
        key_stable: null,
      });
    }
  }, T);
});

describe("AC-STE-717.14 session id", () => {
  test("the CLI on a transcript named 00000000-0000-4000-8000-000000000007.jsonl reads that session's receipts, and no other session's", () => {
    const root = makeTree("sid", "absent");
    mintRun(root, "gate-check", { sid: GATE_SID });
    mintRun(root, "tdd", { sid: "00000000-0000-4000-8000-000000000799" });
    const transcript = writeSessionTranscript(tempDir("sid-tr"), GATE_SID, gateCheckSpan(root));
    expect(transcript.endsWith("/00000000-0000-4000-8000-000000000007.jsonl")).toBe(true);
    const t = timelineOf(transcript, root);
    expect(t.gate_runs.map((r) => r.subject)).toEqual(["dev-process-toolkit:gate-check"]);
  }, T);

  for (const bad of ["unsafe id!", "a$b"]) {
    test(`a transcript whose basename (${JSON.stringify(bad)}) is not path-safe refuses: exit 1, empty stdout, NFR-10 stderr`, () => {
      const root = makeTree("sid-bad", "absent");
      const dir = tempDir("sid-bad-tr");
      const transcript = join(dir, `${bad}.jsonl`);
      writeFileSync(transcript, `${gateCheckSpan(root).join("\n")}\n`);
      const r = runTimelineCli(transcript, root);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(NFR10_RE);
    }, T);
  }
});

// ===========================================================================
// AC-STE-717.6 › privacy
// ===========================================================================

const SECRETS = ["/Users/synthetic-user/x", "/home/synthetic/y", "feature/synthetic-secret"];

describe("AC-STE-717.6 › privacy", () => {
  test("privacy: commands, cwd and gitBranch carrying paths and a branch name leave none of them, no /Users/ or /home/, and the key sets are closed", () => {
    const root = makeTree("privacy", "on");
    mintRun(root, "gate-check", { sid: GATE_SID });
    mintOutcome(root, "gate-check", "pass");
    const o = { cwd: "/Users/synthetic-user/x", gitBranch: "feature/synthetic-secret", sid: GATE_SID };
    const records = [
      bashUse("toolu_V1", "cd /home/synthetic/y && ls /Users/synthetic-user/x", T0, o),
      toolResult("toolu_V1", T0 + 10, { isError: false, content: "/home/synthetic/y/file", ...o }),
      bashUse("toolu_V2", 'git -C /Users/synthetic-user/x commit -m "feature/synthetic-secret"', T0 + 100, o),
      toolResult("toolu_V2", T0 + 120, { isError: true, ...o }),
      skillUse("toolu_V3", "dev-process-toolkit:tdd-write-test", T0 + 200, o),
      toolResult("toolu_V3", T0 + 240, { isError: false, content: stubFor("dev-process-toolkit:tdd-write-test"), ...o }),
      ...notification("toolu_V3", T0 + 5000, `${tddBlock("test-writer", "ok")}\n/Users/synthetic-user/x`),
    ];
    writeCaptureRows(root, GATE_SID, [
      { event: "pre", id: "toolu_V2", cls: "commit", ts: T0 + 105, tree: "sha256:ee", diff: { files: 1, insertions: 1, deletions: 0 } },
      { event: "pre", id: "toolu_V3", tool: "Skill", skill: "dev-process-toolkit:tdd-write-test", ts: T0 + 210, tree: "sha256:ff" },
    ]);
    const r = runTimelineCli(writeSessionTranscript(tempDir("privacy-tr"), GATE_SID, records), root);
    expect(r.exitCode).toBe(0);
    const text = r.stdout;
    for (const s of [...SECRETS, "/Users/", "/home/", root, realpathSync(root), GATE_SID]) expect({ s, found: text.includes(s) }).toEqual({ s, found: false });
    const t = JSON.parse(text) as Timeline;
    expect(Object.keys(t).sort()).toEqual(TOP_KEYS);
    expect(t.calls.length).toBe(3);
    for (const c of t.calls) expect(Object.keys(c).sort()).toEqual(CALL_KEYS);
    expect(t.rounds.length).toBe(1);
    for (const x of t.rounds) expect(Object.keys(x).sort()).toEqual(ROUND_KEYS);
    expect(t.gate_runs.length).toBe(1);
    for (const g of t.gate_runs) expect(Object.keys(g).sort()).toEqual(GATE_RUN_KEYS);
    expect(Object.keys(t.gaps).sort()).toEqual(GAP_KEYS);
    expect(t.calls.some((c) => "exit_code" in c)).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-717.7 › front door, and the composer
// ===========================================================================

describe("AC-STE-717.7 › front door", () => {
  test("front door: the shipped CLI exits 0 with parseable JSON on a fixture", () => {
    const root = makeCheckout("door", "none");
    const r = runTimelineCli(writeSessionTranscript(tempDir("door-tr"), SID, callsRecords(root)), root);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect((JSON.parse(r.stdout) as Timeline).schema).toBe("tool-call-timeline/v1");
  }, T);

  test("front door: a missing transcript exits 1 with empty stdout and an NFR-10 stderr block", () => {
    const root = makeCheckout("door-missing", "none");
    const missing = join(tempDir("door-missing-tr"), `${SID}.jsonl`);
    expect(existsSync(missing)).toBe(false);
    const r = runTimelineCli(missing, root);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(NFR10_RE);
  }, T);

  test("composer: toolCallTimelinePath composes <root>/.dpt/ledger/tool-calls/<sid>.timeline.json and refuses an unsafe id", async () => {
    const m = (await import("../adapters/_shared/src/dpt_paths")) as Record<string, any>;
    expect(typeof m.toolCallTimelinePath).toBe("function");
    expect(m.toolCallTimelinePath("/r", SID)).toBe(join("/r", ".dpt", "ledger", "tool-calls", `${SID}.timeline.json`));
    expect(() => m.toolCallTimelinePath("/r", "../x")).toThrow();
    expect(() => m.toolCallTimelinePath("/r", "a b")).toThrow();
    expect("assertPathSafeSessionId" in m).toBe(false);
  });

  test("composer: docs/layout-reference.md names toolCallTimelinePath in its composer list", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "layout-reference.md"), "utf-8");
    const line = doc.split("\n").find((l) => l.includes("is composed by")) ?? "";
    expect(line).toContain("`toolCallTimelinePath`");
    expect(line).toContain("`toolCallLedgerPath`");
  });
});

// ===========================================================================
// AC-STE-717.11 — mutation controls (reader half; the fold half is in the fold suite)
// ===========================================================================

describe("AC-STE-717.11 mutation controls (reader)", () => {
  test("MUTATION: bypassing firstCopies deduplication (a temp plugin copy) turns `› calls` red", () => {
    const copy = pluginCopy("m-firstcopies");
    const file = join(copy, "templates", "hooks", "_lib", "session.ts");
    const src = readFileSync(file, "utf-8");
    const mutated = src
      .replace("if (earlier !== undefined) {", "if (false && earlier !== undefined) {")
      .replace("if (results.has(block.tool_use_id)) continue;", "/* dedup bypassed */");
    expect(mutated).not.toBe(src);
    expect(mutated).toContain("/* dedup bypassed */");
    writeFileSync(file, mutated);
    const intact = callsTimeline();
    expect(callsFailures(intact)).toEqual([]);
    const t = callsTimeline(copy);
    expect(callsFailures(t).some((f) => f.includes("toolu_D1"))).toBe(true);
  }, T);

  test("MUTATION: treating an absent is_error as an error turns `› calls` red", () => {
    const t = callsTimeline();
    expect(callsFailures(t)).toEqual([]);
    const absent = new Set(["toolu_C3", "toolu_C6"]);
    const mutant: Timeline = { ...t, calls: t.calls.map((c) => (absent.has(c.tool_use_id) ? { ...c, is_error: true } : c)) };
    expect(callsFailures(mutant).filter((f) => f.endsWith(".is_error: true != false"))).toEqual([
      "toolu_C3.is_error: true != false",
      "toolu_C6.is_error: true != false",
    ]);
  }, T);

  test("MUTATION: reporting not-observable as false or 0 turns `› rounds` and `› tokens` red", () => {
    const { root, transcript } = roundsFixture();
    const t = timelineOf(transcript, root);
    expect(roundsFailures(t, D5)).toEqual([]);
    expect(tokensFailures(t, D3)).toEqual([]);
    const asFalse: Timeline = { ...t, rounds: t.rounds.map((r) => ({ ...r, tree_changed: false })) };
    const asZero: Timeline = { ...t, rounds: t.rounds.map((r) => ({ ...r, tokens: 0 })) };
    if (!D5) expect(roundsFailures(asFalse, D5).length).toBeGreaterThan(0);
    if (!D3) expect(tokensFailures(asZero, D3).length).toBe(t.rounds.length);
  }, T);
});

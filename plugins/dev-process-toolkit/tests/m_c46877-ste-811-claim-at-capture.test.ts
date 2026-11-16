// STE-811 (M_c46877) — token rows are claimed by the FR whose run produced them.
//
// AC-STE-811.1  attribution: a usage line → the latest same-session, same-skill
//               run start at or before it; a null `fr` inherits the latest
//               non-null `fr` (any skill) started between that run and the line
// AC-STE-811.2  one row per (skill, model, FR) with `claim_source: "run"`; one
//               unattributed row per (skill, model); sums equal today's
// AC-STE-811.3  filterRowsForFR treats `claim_source: "run"` rows as settled
// AC-STE-811.4  STE-698 carry applies to unattributed rows only; re-fire is byte-stable
// AC-STE-811.5  a session with no run-start rows is written byte-equal to today
// AC-STE-811.6  the claim_coverage.ts CLI
// AC-STE-811.7  docs/retro-reference.md
// AC-STE-811.8  is the full-suite gate the orchestrator runs; no test here.
//
// Shapes assumed (read off the FR's Technical Design):
//   token_usage.ts exports parseTranscriptTokenUsageByRun(transcriptPath, starts)
//     with `starts` the RunStartRow[] of the session; TokenLedgerRow gains
//     optional `claim_source: "run"`.
//   The session-token-ledger hook reads readRunStarts(root, session) itself.
//
// All names, paths and ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import * as tokenUsage from "../adapters/_shared/src/token_usage";
import { ledgerPath, readLedgerRows, type TokenLedgerRow, writeSessionRows } from "../adapters/_shared/src/token_usage";
import { claimRowsForFR, filterRowsForFR } from "../adapters/_shared/src/token_stats_render";
import { runStartLedgerPath } from "../adapters/_shared/src/dpt_paths";
import type { RunStartRow } from "../adapters/_shared/src/run_start";
import { GIT_ENV, PLUGIN_ROOT, SETTINGS_HEAD, cleanupTemps, tempDir } from "./_m_7bc805_gate_outcome_fixture";

const T = 60_000;
const SID = "00000000-0000-4000-8000-000000000911";
const OTHER_SID = "00000000-0000-4000-8000-000000000912";
const BRANCH = "feat/ste-900-synthetic";
const TDD = "dev-process-toolkit:tdd";
const IMPLEMENT = "dev-process-toolkit:implement";
const SPEC_WRITE = "dev-process-toolkit:spec-write";
const MAIN = "(main-loop)";
const OPUS = "claude-opus-synthetic";
const SONNET = "claude-sonnet-synthetic";
const DESIGN = "design/exploration";
const HOOK_ENTRY = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "session-token-ledger.ts");
const COVERAGE_CLI = join(PLUGIN_ROOT, "adapters", "_shared", "src", "claim_coverage.ts");
const TOKENS_ON = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n`;

afterAll(cleanupTemps);

// ------------------------------------------------------------------ fixtures

/** `2026-11-16T10:MM:00.000Z` — every timestamp in this file uses this one format. */
function at(hh: number, mm: number): string {
  return `2026-11-16T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
}

function start(skill: string, fr: string | null, startedAt: string, session = SID): RunStartRow {
  return {
    schema: "dpt-run-start/1",
    session_id: session,
    skill,
    fr,
    started_at: startedAt,
    settings_hash: "0".repeat(64),
    settings: {},
    plugin_version: "0.0.0-synthetic",
    registration: "current",
  };
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface Line {
  skill: string; // MAIN ⇒ no attributionSkill key
  model: string;
  timestamp: string;
  usage: Usage;
}

function transcriptLine(l: Line): string {
  const o: Record<string, unknown> = {
    type: "assistant",
    timestamp: l.timestamp,
    sessionId: SID,
    gitBranch: BRANCH,
    message: { role: "assistant", model: l.model, usage: l.usage },
  };
  if (l.skill !== MAIN) {
    o.attributionSkill = l.skill;
    o.attributionPlugin = "dev-process-toolkit";
  }
  return JSON.stringify(o);
}

function writeTranscript(dir: string, lines: Line[]): string {
  const file = join(dir, "transcript.jsonl");
  writeFileSync(file, lines.map(transcriptLine).join("\n") + "\n");
  return file;
}

function usage(n: number): Usage {
  return {
    input_tokens: 10 * n,
    output_tokens: n,
    cache_read_input_tokens: 100 * n,
    cache_creation_input_tokens: 1000 * n,
  };
}

/** A git-init'd project root with the token-stats switch on. */
function makeRoot(label: string): string {
  const root = join(tempDir(`ste811-${label}`), "repo");
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# Synthetic project\n");
  writeFileSync(join(root, "specs", "settings.yaml"), TOKENS_ON);
  const r = spawnSync("git", ["init", "-q"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  return root;
}

function writeRunStarts(root: string, rows: RunStartRow[]): void {
  const file = runStartLedgerPath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function writeLedger(root: string, rows: TokenLedgerRow[]): void {
  const file = ledgerPath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function ledgerBytes(root: string): string {
  return readFileSync(ledgerPath(root), "utf-8");
}

function runHook(root: string, transcript: string): void {
  const r = spawnSync("bun", ["run", HOOK_ENTRY], {
    cwd: root,
    input: JSON.stringify({ session_id: SID, transcript_path: transcript, cwd: root, hook_event_name: "SessionEnd" }),
    encoding: "utf-8",
    timeout: T,
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
}

type ByRun = (transcriptPath: string, starts: RunStartRow[]) => TokenLedgerRow[];

function byRun(): ByRun {
  const fn = (tokenUsage as Record<string, unknown>).parseTranscriptTokenUsageByRun;
  expect(typeof fn).toBe("function");
  return fn as ByRun;
}

/** Parse a one-line transcript under `starts`; return the single row it yields. */
function attributeOne(line: Line, starts: RunStartRow[]): TokenLedgerRow {
  const dir = tempDir("ste811-one");
  const rows = byRun()(writeTranscript(dir, [line]), starts);
  expect(rows.length).toBe(1);
  return rows[0]!;
}

function expectUnattributed(row: TokenLedgerRow): void {
  expect(row.claimed_by).toBeUndefined();
  expect("claim_source" in row).toBe(false);
}

function row(overrides: Partial<TokenLedgerRow> & Record<string, unknown>): TokenLedgerRow {
  return {
    schema: "token-ledger/v1",
    ts: at(10, 0),
    session_id: SID,
    git_branch: BRANCH,
    skill: TDD,
    model: OPUS,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    message_count: 3,
    ...overrides,
  } as TokenLedgerRow;
}

// The main session fixture: four run starts (plus one of another session) and
// nine usage lines whose expected FR is fixed by the AC-STE-811.1 rule.
const STARTS: RunStartRow[] = [
  start(TDD, "STE-901", at(10, 0)),
  start(IMPLEMENT, null, at(10, 10)),
  start(TDD, "STE-902", at(10, 20)),
  start(TDD, "STE-903", at(10, 40)),
];
const FOREIGN_START = start(TDD, "STE-999", at(10, 1), OTHER_SID);

const LINES: Array<Line & { fr: string | null }> = [
  { skill: TDD, model: OPUS, timestamp: at(9, 50), usage: usage(1), fr: null }, // before any tdd start
  { skill: TDD, model: OPUS, timestamp: at(10, 0), usage: usage(2), fr: "STE-901" }, // at the start
  { skill: TDD, model: OPUS, timestamp: at(10, 5), usage: usage(3), fr: "STE-901" },
  { skill: IMPLEMENT, model: OPUS, timestamp: at(10, 15), usage: usage(4), fr: null }, // null fr, nothing between
  { skill: TDD, model: SONNET, timestamp: at(10, 25), usage: usage(5), fr: "STE-902" },
  { skill: IMPLEMENT, model: OPUS, timestamp: at(10, 30), usage: usage(6), fr: "STE-902" }, // inherits
  { skill: IMPLEMENT, model: OPUS, timestamp: at(10, 50), usage: usage(7), fr: "STE-903" }, // inherits latest
  { skill: MAIN, model: OPUS, timestamp: at(10, 30), usage: usage(8), fr: null },
  { skill: SPEC_WRITE, model: OPUS, timestamp: at(10, 30), usage: usage(9), fr: null }, // no spec-write start
];

/** Expected (skill, model, fr) → { sums, count } computed from the fixture itself. */
function expectedBuckets(byFr: boolean): Map<string, Usage & { message_count: number }> {
  const m = new Map<string, Usage & { message_count: number }>();
  for (const l of LINES) {
    const key = byFr ? `${l.skill}|${l.model}|${l.fr ?? "-"}` : `${l.skill}|${l.model}`;
    const b = m.get(key) ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, message_count: 0 };
    b.input_tokens += l.usage.input_tokens;
    b.output_tokens += l.usage.output_tokens;
    b.cache_read_input_tokens += l.usage.cache_read_input_tokens;
    b.cache_creation_input_tokens += l.usage.cache_creation_input_tokens;
    b.message_count += 1;
    m.set(key, b);
  }
  return m;
}

function actualBuckets(rows: TokenLedgerRow[], byFr: boolean): Map<string, Usage & { message_count: number }> {
  const m = new Map<string, Usage & { message_count: number }>();
  for (const r of rows) {
    const key = byFr ? `${r.skill}|${r.model}|${r.claimed_by ?? "-"}` : `${r.skill}|${r.model}`;
    const b = m.get(key) ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, message_count: 0 };
    b.input_tokens += r.input_tokens;
    b.output_tokens += r.output_tokens;
    b.cache_read_input_tokens += r.cache_read_input_tokens;
    b.cache_creation_input_tokens += r.cache_creation_input_tokens;
    b.message_count += r.message_count;
    m.set(key, b);
  }
  return m;
}

function sorted<V>(m: Map<string, V>): Array<[string, V]> {
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// ===========================================================================
// AC-STE-811.1 — the attribution rule
// ===========================================================================

describe("AC-STE-811.1 a usage line is attributed to the run that produced it", () => {
  test("a same-skill run started before the line claims it for its FR", () => {
    const r = attributeOne({ skill: TDD, model: OPUS, timestamp: at(10, 5), usage: usage(1) }, [start(TDD, "STE-901", at(10, 0))]);
    expect(r.claimed_by).toBe("STE-901");
  });

  test("a run started at exactly the line's timestamp claims it", () => {
    const r = attributeOne({ skill: TDD, model: OPUS, timestamp: at(10, 0), usage: usage(1) }, [start(TDD, "STE-901", at(10, 0))]);
    expect(r.claimed_by).toBe("STE-901");
  });

  test("of two same-skill runs, the latest one at or before the line wins", () => {
    const r = attributeOne({ skill: TDD, model: OPUS, timestamp: at(10, 25), usage: usage(1) }, [
      start(TDD, "STE-901", at(10, 0)),
      start(TDD, "STE-902", at(10, 20)),
      start(TDD, "STE-903", at(10, 40)),
    ]);
    expect(r.claimed_by).toBe("STE-902");
  });

  test("a line before every same-skill run start is unattributed", () => {
    expectUnattributed(attributeOne({ skill: TDD, model: OPUS, timestamp: at(9, 50), usage: usage(1) }, [start(TDD, "STE-901", at(10, 0))]));
  });

  test("a run of a different skill never claims the line", () => {
    expectUnattributed(attributeOne({ skill: IMPLEMENT, model: OPUS, timestamp: at(10, 5), usage: usage(1) }, [start(TDD, "STE-901", at(10, 0))]));
  });

  test("a later same-skill run with a null fr supersedes an earlier non-null one", () => {
    expectUnattributed(
      attributeOne({ skill: TDD, model: OPUS, timestamp: at(10, 15), usage: usage(1) }, [
        start(TDD, "STE-901", at(10, 0)),
        start(TDD, null, at(10, 10)),
      ]),
    );
  });

  test("a null-fr run inherits the fr of a run of another skill started between it and the line", () => {
    const r = attributeOne({ skill: IMPLEMENT, model: OPUS, timestamp: at(10, 30), usage: usage(1) }, [
      start(IMPLEMENT, null, at(10, 10)),
      start(TDD, "STE-902", at(10, 20)),
    ]);
    expect(r.claimed_by).toBe("STE-902");
  });

  test("the inherited fr is the latest non-null one between the run start and the line", () => {
    const r = attributeOne({ skill: IMPLEMENT, model: OPUS, timestamp: at(10, 50), usage: usage(1) }, [
      start(IMPLEMENT, null, at(10, 10)),
      start(TDD, "STE-902", at(10, 20)),
      start(TDD, "STE-903", at(10, 40)),
    ]);
    expect(r.claimed_by).toBe("STE-903");
  });

  test("a non-null run started before the null-fr run is never inherited", () => {
    expectUnattributed(
      attributeOne({ skill: IMPLEMENT, model: OPUS, timestamp: at(10, 15), usage: usage(1) }, [
        start(TDD, "STE-901", at(10, 0)),
        start(IMPLEMENT, null, at(10, 10)),
      ]),
    );
  });

  test("a non-null run started after the line is never inherited", () => {
    expectUnattributed(
      attributeOne({ skill: IMPLEMENT, model: OPUS, timestamp: at(10, 15), usage: usage(1) }, [
        start(IMPLEMENT, null, at(10, 10)),
        start(TDD, "STE-902", at(10, 20)),
      ]),
    );
  });

  test("a (main-loop) line is unattributed even when a run start carries its skill string", () => {
    expectUnattributed(
      attributeOne({ skill: MAIN, model: OPUS, timestamp: at(10, 30), usage: usage(1) }, [
        start(MAIN, "STE-901", at(10, 0)),
        start(TDD, "STE-902", at(10, 0)),
      ]),
    );
  });

  test(
    "the hook ignores run starts of another session",
    () => {
      const root = makeRoot("foreign");
      writeRunStarts(root, [start(TDD, "STE-999", at(10, 0), OTHER_SID)]);
      runHook(root, writeTranscript(tempDir("ste811-foreign-t"), [{ skill: TDD, model: OPUS, timestamp: at(10, 5), usage: usage(1) }]));
      const rows = readLedgerRows(root);
      expect(rows.map((r) => r.claimed_by ?? null)).toEqual([null]);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-811.2 — rows per (skill, model, FR); totals unchanged
// ===========================================================================

describe("AC-STE-811.2 claimed rows per (skill, model, FR), totals unchanged", () => {
  const parseMain = (): TokenLedgerRow[] => byRun()(writeTranscript(tempDir("ste811-main"), LINES), STARTS);

  test("one row per (skill, model, FR) for attributed lines and per (skill, model) for the rest", () => {
    const keys = parseMain()
      .map((r) => `${r.skill}|${r.model}|${r.claimed_by ?? "-"}`)
      .sort();
    expect(keys).toEqual([...expectedBuckets(true).keys()].sort());
  });

  test("each row's sums and message_count match the lines attributed to it", () => {
    expect(sorted(actualBuckets(parseMain(), true))).toEqual(sorted(expectedBuckets(true)));
  });

  test("every attributed row carries claim_source: \"run\"", () => {
    const attributed = parseMain().filter((r) => r.claimed_by !== undefined);
    expect(attributed.length).toBe(4);
    expect(attributed.map((r) => (r as Record<string, unknown>).claim_source)).toEqual(["run", "run", "run", "run"]);
  });

  test("unattributed rows carry neither claimed_by nor claim_source", () => {
    const unattributed = parseMain().filter((r) => r.claimed_by === undefined);
    expect(unattributed.length).toBe(4);
    expect(unattributed.filter((r) => "claim_source" in r)).toEqual([]);
  });

  test("per (skill, model) the four token sums and message_count equal the single-row values", () => {
    expect(sorted(actualBuckets(parseMain(), false))).toEqual(sorted(expectedBuckets(false)));
  });

  test(
    "the hook writes the split rows for the session, ignoring a foreign session's start",
    () => {
      const root = makeRoot("hook-split");
      writeRunStarts(root, [...STARTS, FOREIGN_START]);
      runHook(root, writeTranscript(tempDir("ste811-hook-split-t"), LINES));
      const rows = readLedgerRows(root);
      expect(sorted(actualBuckets(rows, true))).toEqual(sorted(expectedBuckets(true)));
    },
    T,
  );

  test(
    "the hook keys every written row on the payload's session id",
    () => {
      const root = makeRoot("hook-sid");
      writeRunStarts(root, STARTS);
      runHook(root, writeTranscript(tempDir("ste811-hook-sid-t"), LINES));
      expect([...new Set(readLedgerRows(root).map((r) => r.session_id))]).toEqual([SID]);
      expect(readLedgerRows(root).filter((r) => r.claimed_by !== undefined).length).toBe(4);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-811.3 — run claims are settled
// ===========================================================================

describe("AC-STE-811.3 filterRowsForFR treats a run claim as settled", () => {
  const runRow = (): TokenLedgerRow => row({ claimed_by: "STE-901", claim_source: "run" });

  test("a run-claimed row in another FR's lineage is not demoted to the design bucket", () => {
    const r = runRow();
    filterRowsForFR([r], { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-902" });
    expect(r.claimed_by).toBe("STE-901");
  });

  test("a run-claimed row is not selected for another FR whose lineage holds its session", () => {
    const selected = filterRowsForFR([runRow()], { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-902" });
    expect(selected).toEqual([]);
  });

  test("a run-claimed row keeps claim_source after another FR's claim", () => {
    const r = runRow();
    filterRowsForFR([r], { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-902" });
    expect((r as Record<string, unknown>).claim_source).toBe("run");
  });

  test("a run-claimed row is selected for its own FR, in lineage or not", () => {
    const inLineage = filterRowsForFR([runRow()], { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-901" });
    const offLineage = filterRowsForFR([runRow()], { branch: BRANCH, sessionLineage: [], brainstormClaim: "STE-901" });
    expect([inLineage.length, offLineage.length]).toEqual([1, 1]);
  });

  test("a claim without claim_source is still demoted by a second FR's lineage (control)", () => {
    const r = row({ claimed_by: "STE-901" });
    filterRowsForFR([r], { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-902" });
    expect(r.claimed_by).toBe(DESIGN);
  });

  test("on disk, a run-claimed row survives a second FR's lineage claim", () => {
    const root = makeRoot("claim-disk");
    writeLedger(root, [runRow(), row({ skill: IMPLEMENT })]);
    claimRowsForFR(root, { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-902" });
    const rows = readLedgerRows(root);
    expect(rows.map((r) => [r.skill, r.claimed_by])).toEqual([
      [TDD, "STE-901"],
      [IMPLEMENT, "STE-902"],
    ]);
  });
});

// ===========================================================================
// AC-STE-811.4 — carry for unattributed rows only; re-fire byte-stable
// ===========================================================================

describe("AC-STE-811.4 the STE-698 carry applies to unattributed rows only", () => {
  test("a prior manual claim never overwrites a fresh run claim of the same skill and model", () => {
    const root = makeRoot("carry-run");
    writeLedger(root, [row({ claimed_by: "STE-950" })]);
    writeSessionRows(root, SID, [row({ claimed_by: "STE-901", claim_source: "run" })]);
    expect(readLedgerRows(root).map((r) => r.claimed_by)).toEqual(["STE-901"]);
  });

  test("a prior manual claim still carries onto the unattributed fresh row", () => {
    const root = makeRoot("carry-unattr");
    writeLedger(root, [row({ claimed_by: "STE-950" })]);
    writeSessionRows(root, SID, [row({ claimed_by: "STE-901", claim_source: "run" }), row({ input_tokens: 7 })]);
    const unattributed = readLedgerRows(root).filter((r) => !("claim_source" in r));
    expect(unattributed.map((r) => r.claimed_by)).toEqual(["STE-950"]);
  });

  test("a prior run claim is never carried onto an unattributed fresh row", () => {
    const root = makeRoot("carry-no-run");
    writeLedger(root, [row({ claimed_by: "STE-901", claim_source: "run" })]);
    writeSessionRows(root, SID, [row({ claimed_by: "STE-901", claim_source: "run" }), row({ input_tokens: 7 })]);
    const unattributed = readLedgerRows(root).filter((r) => !("claim_source" in r));
    expect(unattributed.map((r) => r.claimed_by ?? null)).toEqual([null]);
  });

  for (const order of ["run-first", "manual-first"] as const) {
    test(`with a run row and a manual claim on one skill and model (${order}), the unattributed row carries the manual one`, () => {
      const root = makeRoot(`carry-${order}`);
      const prior = [row({ claimed_by: "STE-901", claim_source: "run" }), row({ input_tokens: 7, claimed_by: "STE-950" })];
      writeLedger(root, order === "run-first" ? prior : [...prior].reverse());
      writeSessionRows(root, SID, [row({ claimed_by: "STE-901", claim_source: "run" }), row({ input_tokens: 7 })]);
      const rows = readLedgerRows(root);
      expect(rows.map((r) => [r.claimed_by, (r as Record<string, unknown>).claim_source ?? null])).toEqual([
        ["STE-901", "run"],
        ["STE-950", null],
      ]);
    });
  }

  test(
    "re-running the hook on the same transcript and run starts yields the same ledger bytes",
    () => {
      const root = makeRoot("refire");
      writeRunStarts(root, STARTS);
      const transcript = writeTranscript(tempDir("ste811-refire-t"), LINES);
      runHook(root, transcript);
      const first = ledgerBytes(root);
      runHook(root, transcript);
      expect(ledgerBytes(root)).toBe(first);
      expect(readLedgerRows(root).filter((r) => r.claimed_by !== undefined).length).toBe(4);
    },
    T,
  );

  test(
    "after a lineage claim between fires, re-fires keep run claims, carry the manual one, and are byte-stable",
    () => {
      const root = makeRoot("refire-claim");
      writeRunStarts(root, STARTS);
      const transcript = writeTranscript(tempDir("ste811-refire-claim-t"), LINES);
      runHook(root, transcript);
      claimRowsForFR(root, { branch: BRANCH, sessionLineage: [SID], brainstormClaim: "STE-950" });
      runHook(root, transcript);
      const second = ledgerBytes(root);
      runHook(root, transcript);
      expect(ledgerBytes(root)).toBe(second);
      const claims = readLedgerRows(root)
        .map((r) => `${r.skill}|${r.model}|${r.claimed_by}|${(r as Record<string, unknown>).claim_source ?? "-"}`)
        .sort();
      expect(claims).toEqual(
        [
          `${TDD}|${OPUS}|STE-950|-`,
          `${TDD}|${OPUS}|STE-901|run`,
          `${IMPLEMENT}|${OPUS}|STE-950|-`,
          `${TDD}|${SONNET}|STE-902|run`,
          `${IMPLEMENT}|${OPUS}|STE-902|run`,
          `${IMPLEMENT}|${OPUS}|STE-903|run`,
          `${MAIN}|${OPUS}|STE-950|-`,
          `${SPEC_WRITE}|${OPUS}|STE-950|-`,
        ].sort(),
      );
    },
    T,
  );
});

// ===========================================================================
// AC-STE-811.5 — no run starts ⇒ today's bytes
// ===========================================================================

describe("AC-STE-811.5 a session with no run-start rows is written as today", () => {
  const PRE_B_LINES: Line[] = [
    { skill: TDD, model: OPUS, timestamp: at(10, 5), usage: usage(1) },
    { skill: MAIN, model: OPUS, timestamp: at(10, 6), usage: usage(2) },
    { skill: TDD, model: OPUS, timestamp: at(10, 7), usage: usage(3) },
    { skill: TDD, model: SONNET, timestamp: at(10, 8), usage: usage(4) },
  ];
  // Today's rows for PRE_B_LINES, spelled out literally in today's key order.
  const EXPECTED_ROWS = [
    { schema: "token-ledger/v1", ts: at(10, 5), session_id: SID, git_branch: BRANCH, skill: TDD, model: OPUS, input_tokens: 40, output_tokens: 4, cache_read_input_tokens: 400, cache_creation_input_tokens: 4000, message_count: 2 },
    { schema: "token-ledger/v1", ts: at(10, 6), session_id: SID, git_branch: BRANCH, skill: MAIN, model: OPUS, input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 200, cache_creation_input_tokens: 2000, message_count: 1 },
    { schema: "token-ledger/v1", ts: at(10, 8), session_id: SID, git_branch: BRANCH, skill: TDD, model: SONNET, input_tokens: 40, output_tokens: 4, cache_read_input_tokens: 400, cache_creation_input_tokens: 4000, message_count: 1 },
  ];
  const EXPECTED_BYTES = EXPECTED_ROWS.map((r) => JSON.stringify(r)).join("\n") + "\n";

  test("parseTranscriptTokenUsageByRun with no starts returns today's rows exactly", () => {
    const rows = byRun()(writeTranscript(tempDir("ste811-preb-pure"), PRE_B_LINES), []);
    expect(rows.map((r) => JSON.stringify(r))).toEqual(EXPECTED_ROWS.map((r) => JSON.stringify(r)));
  });

  test(
    "the hook with no run-start ledger writes today's bytes",
    () => {
      const root = makeRoot("preb-none");
      runHook(root, writeTranscript(tempDir("ste811-preb-none-t"), PRE_B_LINES));
      expect(ledgerBytes(root)).toBe(EXPECTED_BYTES);
    },
    T,
  );

  // STE-811 review (Pass 2): a run-start ledger the hook cannot read must not cost the
  // session its token rows — the unreadable read falls back to the unattributed parse.
  test(
    "the hook with an unreadable run-start ledger still writes today's bytes",
    () => {
      const root = makeRoot("preb-unreadable");
      mkdirSync(join(root, ".dpt", "ledger", "run-starts.jsonl"), { recursive: true });
      runHook(root, writeTranscript(tempDir("ste811-preb-unreadable-t"), PRE_B_LINES));
      expect(ledgerBytes(root)).toBe(EXPECTED_BYTES);
    },
    T,
  );

  // STE-811 review (Pass 2): a start whose fr is not a non-empty string names no FR,
  // so it can neither claim a line nor mark one settled.
  test("a start whose fr is missing, empty or not a string claims nothing", () => {
    for (const bad of [undefined, "", 42]) {
      const s = { ...start(TDD, null, at(10, 0)), fr: bad } as unknown as RunStartRow;
      const row = attributeOne({ skill: TDD, model: OPUS, timestamp: at(10, 5), usage: usage(1) }, [s]);
      expect({ bad, claimed: row.claimed_by, source: (row as { claim_source?: unknown }).claim_source }).toEqual({ bad, claimed: undefined, source: undefined });
    }
  });

  test(
    "the hook with run starts of another session only writes today's bytes",
    () => {
      const root = makeRoot("preb-foreign");
      writeRunStarts(root, [start(TDD, "STE-999", at(10, 0), OTHER_SID), start(MAIN, "STE-999", at(10, 0), OTHER_SID)]);
      runHook(root, writeTranscript(tempDir("ste811-preb-foreign-t"), PRE_B_LINES));
      expect(ledgerBytes(root)).toBe(EXPECTED_BYTES);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-811.6 — claim_coverage.ts CLI
// ===========================================================================

describe("AC-STE-811.6 claim_coverage.ts prints the ledger's claim coverage", () => {
  test(
    "counts FR claims, excludes the design bucket and unclaimed rows",
    () => {
      const root = makeRoot("coverage");
      writeLedger(root, [
        row({ output_tokens: 50, claimed_by: "STE-901" }),
        row({ output_tokens: 3, claimed_by: "STE-902", claim_source: "run" }),
        row({ output_tokens: 7, claimed_by: DESIGN }),
        row({ output_tokens: 11 }),
        row({ output_tokens: 13, session_id: OTHER_SID }),
      ]);
      const r = spawnSync("bun", ["run", COVERAGE_CLI, root], { cwd: PLUGIN_ROOT, encoding: "utf-8", timeout: T });
      expect({ status: r.status, stdout: r.stdout }).toEqual({
        status: 0,
        stdout: "claimed=2 total=5 output_tokens_claimed=53 output_tokens_total=84\n",
      });
    },
    T,
  );
});

// ===========================================================================
// AC-STE-811.7 — docs/retro-reference.md
// ===========================================================================

describe("AC-STE-811.7 docs/retro-reference.md describes attribution and settled claims", () => {
  const doc = (): string => readFileSync(join(PLUGIN_ROOT, "docs", "retro-reference.md"), "utf-8");

  test("names the claim_source field and its run value", () => {
    expect(doc()).toMatch(/`claim_source`[^\n]*`?"?run"?`?/);
  });

  test("states the attribution rule: latest same-skill run start at or before the line", () => {
    const d = doc();
    expect(d).toMatch(/same skill/i);
    expect(d).toMatch(/at or before/i);
  });

  test("states the null-fr inheritance and the (main-loop) exclusion", () => {
    const d = doc();
    expect(d).toMatch(/`?null`?[^\n]*inherit|inherit[^\n]*`?null`?/i);
    expect(d).toContain("(main-loop)");
  });

  test("states the settled-claim rule: never demoted to the design bucket", () => {
    const d = doc();
    expect(d).toMatch(/settled/i);
    expect(d).toMatch(/design bucket|design\/exploration/i);
  });
});

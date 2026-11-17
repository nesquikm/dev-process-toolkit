// STE-812 Stage B review fixes.
//
// 1. AC-STE-812.2 says child rows aggregate per (skill, model, FR). Two children of the
//    same skill and model run for the same FR fold into ONE row, and that row is
//    complete only when every child it folds is complete.
// 2. The STE-698 claim carry in writeSessionRows keys one prior claim per
//    (session, skill, model). Fork rows share skill and model with parent rows, so the
//    carry must also key on scope, or a parent claim leaks onto a fork row.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forkChildRows } from "../adapters/_shared/src/fork_child_tokens.ts";
import { readLedgerRows, TOKEN_LEDGER_SCHEMA, type TokenLedgerRow, writeSessionRows } from "../adapters/_shared/src/token_usage.ts";

const SESSION = "00000000-0000-4000-8000-000000000999";
const SKILL = "dev-process-toolkit:tdd-implement";
const MODEL = "claude-opus-synthetic";

const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function assistant(ts: string, output: number): unknown {
  return {
    type: "assistant",
    sessionId: SESSION,
    isSidechain: true,
    attributionSkill: SKILL,
    timestamp: ts,
    message: {
      role: "assistant",
      model: MODEL,
      usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  };
}

/** A parent transcript naming two forked children of SKILL, each with its own transcript. */
function layout(finished: [boolean, boolean]): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-812-fold-"));
  const sub = join(dir, SESSION, "subagents");
  mkdirSync(sub, { recursive: true });
  const ids = ["a0000000000000901", "a0000000000000902"];
  writeFileSync(
    join(dir, `${SESSION}.jsonl`),
    jsonl(
      ids.map((agentId, i) => ({
        type: "user",
        sessionId: SESSION,
        timestamp: `2026-11-16T10:0${i}:00.000Z`,
        toolUseResult: { success: true, commandName: SKILL, status: "forked", agentId },
      })),
    ),
  );
  ids.forEach((id, i) => {
    writeFileSync(join(sub, `agent-${id}.forked-skill.json`), JSON.stringify({ skillName: SKILL }));
    writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify({ finished: finished[i] }));
    writeFileSync(join(sub, `agent-${id}.jsonl`), jsonl([assistant(`2026-11-16T10:0${i}:30.000Z`, 10 * (i + 1))]));
  });
  return join(dir, `${SESSION}.jsonl`);
}

describe("STE-812 review: child rows fold per (skill, model, FR) across children", () => {
  test("two finished children of one skill, model and FR fold into one complete row", () => {
    const rows = forkChildRows(layout([true, true]), SESSION, () => "STE-901");
    expect(rows.map((r) => ({ skill: r.skill, fr: r.claimed_by, out: r.output_tokens, n: r.message_count, complete: r.complete }))).toEqual([
      { skill: SKILL, fr: "STE-901", out: 30, n: 2, complete: true },
    ]);
  });

  test("the folded row is incomplete when any child it folds is unfinished", () => {
    const rows = forkChildRows(layout([true, false]), SESSION, () => "STE-901");
    expect(rows.map((r) => ({ out: r.output_tokens, complete: r.complete }))).toEqual([{ out: 30, complete: false }]);
  });

  test("children attributed to different FRs stay separate rows", () => {
    let k = 0;
    const rows = forkChildRows(layout([true, true]), SESSION, () => (k++ === 0 ? "STE-901" : "STE-902"));
    expect(rows.map((r) => [r.claimed_by, r.output_tokens]).sort()).toEqual([
      ["STE-901", 10],
      ["STE-902", 20],
    ]);
  });
});

describe("STE-812 review: the claim carry never crosses scope", () => {
  const base = (over: Partial<TokenLedgerRow>): TokenLedgerRow => ({
    schema: TOKEN_LEDGER_SCHEMA,
    ts: "2026-11-16T10:00:00.000Z",
    session_id: SESSION,
    git_branch: "feat/ste-900-synthetic",
    skill: SKILL,
    model: MODEL,
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    message_count: 1,
    ...over,
  });

  test("a parent row's carried claim does not leak onto an unclaimed fork row of the same skill and model", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-812-carry-"));
    writeSessionRows(root, SESSION, [base({ claimed_by: "STE-345" })]);
    writeSessionRows(root, SESSION, [base({}), base({ scope: "fork", complete: true })]);
    const rows = readLedgerRows(root).filter((r) => r.session_id === SESSION);
    expect(rows.map((r) => ({ scope: r.scope ?? "parent", claimed_by: r.claimed_by ?? null }))).toEqual([
      { scope: "parent", claimed_by: "STE-345" },
      { scope: "fork", claimed_by: null },
    ]);
  });

  test("a fork row's carried claim does not leak onto the parent row of the same skill and model", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-812-carry-"));
    writeSessionRows(root, SESSION, [base({ scope: "fork", complete: true, claimed_by: "STE-345" })]);
    writeSessionRows(root, SESSION, [base({}), base({ scope: "fork", complete: true })]);
    const rows = readLedgerRows(root).filter((r) => r.session_id === SESSION);
    expect(rows.map((r) => ({ scope: r.scope ?? "parent", claimed_by: r.claimed_by ?? null }))).toEqual([
      { scope: "parent", claimed_by: null },
      { scope: "fork", claimed_by: "STE-345" },
    ]);
  });
});

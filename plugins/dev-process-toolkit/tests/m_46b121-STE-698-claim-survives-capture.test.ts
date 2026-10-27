// STE-698 — a token claim survives the next session-end capture.
//
// The capture hook re-derives a whole session from its transcript on every
// Stop / SessionEnd fire and hands the fresh rows to `writeSessionRows`, which
// drops the session's existing rows and appends the fresh ones. A
// `claimed_by` mark that `claimRowsForFR` wrote while that session was still
// live was lost on the next fire, so the release rollup found no rows for the
// claimed FR. These tests pin the carry-forward: each existing row's claim is
// copied onto the fresh row of the same session with the same skill and model.
//
// Synthetic ids only (syn-session-*, STE-900/STE-901); temp project roots only.

import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as realModule from "../adapters/_shared/src/token_usage";
import {
  ledgerPath,
  readLedgerRows,
  type TokenLedgerRow,
  writeSessionRows,
} from "../adapters/_shared/src/token_usage";
import {
  claimRowsForFR,
  renderMilestoneRollup,
} from "../adapters/_shared/src/token_stats_render";

const SRC_DIR = join(import.meta.dir, "..", "adapters", "_shared", "src");

/** The literal design bucket label (not exported by token_stats_render). */
const DESIGN = "design/exploration";

const BRANCH = "fix/ste-900-synthetic";
const IMPLEMENT = "dev-process-toolkit:implement";
const TDD = "dev-process-toolkit:tdd";
const OPUS = "claude-opus-synthetic";
const SONNET = "claude-sonnet-synthetic";

function row(overrides: Partial<TokenLedgerRow>): TokenLedgerRow {
  return {
    schema: "token-ledger/v1",
    ts: "2026-10-27T10:00:00Z",
    session_id: "syn-session-1",
    git_branch: BRANCH,
    skill: IMPLEMENT,
    model: OPUS,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    message_count: 3,
    ...overrides,
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "ste-698-"));
}

function writeLedger(root: string, rows: TokenLedgerRow[]): void {
  const path = ledgerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function rawLines(root: string): string[] {
  return readFileSync(ledgerPath(root), "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

function find(
  rows: TokenLedgerRow[],
  session: string,
  skill: string,
  model: string,
): TokenLedgerRow | undefined {
  return rows.find(
    (r) => r.session_id === session && r.skill === skill && r.model === model,
  );
}

/** Minimal module surface a scenario drives (real or mutated copy). */
interface LedgerModule {
  writeSessionRows: typeof writeSessionRows;
  readLedgerRows: typeof readLedgerRows;
}

// ---------------------------------------------------------------------------
// Named scenarios — each returns a list of failures (empty ⇒ pass). They are
// run against the real module by the AC tests below and against mutated temp
// copies by the AC-STE-698.6 mutation tests.
// ---------------------------------------------------------------------------

/** FR steps to reproduce: claim mid-session, then a fresh capture write. */
function regressionScenario(mod: LedgerModule): string[] {
  const failures: string[] = [];
  const root = tempRoot();
  writeLedger(root, [
    row({ skill: IMPLEMENT }),
    row({ skill: TDD, input_tokens: 200 }),
  ]);

  claimRowsForFR(root, {
    branch: BRANCH,
    sessionLineage: ["syn-session-1"],
    brainstormClaim: "STE-900",
  });
  const claimed = mod.readLedgerRows(root);
  if (!claimed.every((r) => r.claimed_by === "STE-900")) {
    failures.push("precondition: claimRowsForFR did not claim both rows");
  }

  // Stop-hook re-derive: grown token counts, no claim on the fresh rows.
  mod.writeSessionRows(root, "syn-session-1", [
    row({ skill: IMPLEMENT, input_tokens: 150, message_count: 5 }),
    row({ skill: TDD, input_tokens: 260, message_count: 7 }),
  ]);

  const after = mod.readLedgerRows(root);
  if (after.length !== 2) failures.push(`expected 2 rows, got ${after.length}`);
  const impl = find(after, "syn-session-1", IMPLEMENT, OPUS);
  const tdd = find(after, "syn-session-1", TDD, OPUS);
  if (impl?.claimed_by !== "STE-900") {
    failures.push(`implement row claimed_by=${String(impl?.claimed_by)}`);
  }
  if (tdd?.claimed_by !== "STE-900") {
    failures.push(`tdd row claimed_by=${String(tdd?.claimed_by)}`);
  }
  if (impl?.input_tokens !== 150) failures.push("implement tokens not updated");
  if (tdd?.input_tokens !== 260) failures.push("tdd tokens not updated");
  return failures;
}

/** Two models under one skill, carrying different claims. */
function twoModelsOneSkillScenario(mod: LedgerModule): string[] {
  const failures: string[] = [];
  const root = tempRoot();
  writeLedger(root, [
    row({ skill: TDD, model: OPUS, claimed_by: "STE-900" }),
    row({ skill: TDD, model: SONNET, claimed_by: DESIGN }),
  ]);

  mod.writeSessionRows(root, "syn-session-1", [
    row({ skill: TDD, model: OPUS, input_tokens: 111 }),
    row({ skill: TDD, model: SONNET, input_tokens: 222 }),
  ]);

  const after = mod.readLedgerRows(root);
  const opus = find(after, "syn-session-1", TDD, OPUS);
  const sonnet = find(after, "syn-session-1", TDD, SONNET);
  if (opus?.claimed_by !== "STE-900") {
    failures.push(`opus row claimed_by=${String(opus?.claimed_by)}`);
  }
  if (sonnet?.claimed_by !== DESIGN) {
    failures.push(`sonnet row claimed_by=${String(sonnet?.claimed_by)}`);
  }
  if (opus?.input_tokens !== 111 || sonnet?.input_tokens !== 222) {
    failures.push("fresh token counts not written");
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Mutation harness — copy the module to a temp dir and swap the
// `writeSessionRows` definition for a known variant.
// ---------------------------------------------------------------------------

const MUTANT_NO_CARRY = `export function writeSessionRows(
  projectRoot: string,
  sessionId: string,
  rows: TokenLedgerRow[],
): void {
  // MUTANT: carry-forward removed.
  const existing = readLedgerRows(projectRoot).filter(
    (row) => row.session_id !== sessionId,
  );
  rewriteLedgerRows(projectRoot, [...existing, ...rows]);
}
`;

const MUTANT_SKILL_ONLY = `export function writeSessionRows(
  projectRoot: string,
  sessionId: string,
  rows: TokenLedgerRow[],
): void {
  // MUTANT: carry-forward keyed by skill alone.
  const all = readLedgerRows(projectRoot);
  const claims = new Map<string, string>();
  for (const row of all) {
    if (row.session_id === sessionId && row.claimed_by !== undefined) {
      claims.set(row.skill, row.claimed_by);
    }
  }
  const existing = all.filter((row) => row.session_id !== sessionId);
  const fresh = rows.map((row) => {
    const claim = claims.get(row.skill);
    return claim === undefined ? row : { ...row, claimed_by: claim };
  });
  rewriteLedgerRows(projectRoot, [...existing, ...fresh]);
}
`;

let mutantSeq = 0;

async function loadMutant(replacement: string): Promise<LedgerModule> {
  const source = readFileSync(join(SRC_DIR, "token_usage.ts"), "utf-8");
  const start = source.indexOf("export function writeSessionRows(");
  if (start < 0) throw new Error("writeSessionRows not found in source");
  // The definition ends at the first column-0 closing brace after its start.
  const endMatch = /\n\}\n/.exec(source.slice(start));
  if (!endMatch) throw new Error("end of writeSessionRows not found");
  const end = start + endMatch.index + endMatch[0].length;
  const mutated = source.slice(0, start) + replacement + source.slice(end);
  if (mutated === source || !mutated.includes("// MUTANT:")) {
    throw new Error("mutation did not apply");
  }

  const dir = mkdtempSync(join(tmpdir(), `ste-698-mutant-${mutantSeq++}-`));
  writeFileSync(join(dir, "token_usage.ts"), mutated);
  copyFileSync(join(SRC_DIR, "dpt_paths.ts"), join(dir, "dpt_paths.ts"));
  return (await import(join(dir, "token_usage.ts"))) as LedgerModule;
}

// ---------------------------------------------------------------------------

describe("STE-698 — a token claim survives the next session-end capture", () => {
  test("a claim made mid-session survives the next session-row write", () => {
    // AC-STE-698.1 — the FR's steps to reproduce.
    expect(regressionScenario(realModule)).toEqual([]);
  });

  test("AC-STE-698.2: each existing row's claim is carried onto the fresh row of the same skill and model", () => {
    const root = tempRoot();
    writeLedger(root, [
      row({ skill: IMPLEMENT, model: OPUS, claimed_by: "STE-900" }),
      row({ skill: TDD, model: OPUS, claimed_by: "STE-901" }),
    ]);

    writeSessionRows(root, "syn-session-1", [
      row({ skill: IMPLEMENT, model: OPUS, output_tokens: 70 }),
      row({ skill: TDD, model: OPUS, output_tokens: 90 }),
    ]);

    const after = readLedgerRows(root);
    expect(after).toHaveLength(2);
    expect(find(after, "syn-session-1", IMPLEMENT, OPUS)?.claimed_by).toBe("STE-900");
    expect(find(after, "syn-session-1", TDD, OPUS)?.claimed_by).toBe("STE-901");
    expect(find(after, "syn-session-1", IMPLEMENT, OPUS)?.output_tokens).toBe(70);
    expect(find(after, "syn-session-1", TDD, OPUS)?.output_tokens).toBe(90);
  });

  test("AC-STE-698.2: a demotion to the design bucket is carried forward too", () => {
    const root = tempRoot();
    writeLedger(root, [row({ skill: IMPLEMENT, claimed_by: DESIGN })]);

    writeSessionRows(root, "syn-session-1", [
      row({ skill: IMPLEMENT, input_tokens: 999 }),
    ]);

    const after = readLedgerRows(root);
    const fresh = find(after, "syn-session-1", IMPLEMENT, OPUS);
    expect(fresh?.claimed_by).toBe(DESIGN);
    expect(fresh?.input_tokens).toBe(999);
  });

  test("AC-STE-698.2: two models under one skill keep their own claims", () => {
    expect(twoModelsOneSkillScenario(realModule)).toEqual([]);
  });

  test("AC-STE-698.3: a fresh row with no earlier row of its skill and model carries no claim", () => {
    const root = tempRoot();
    writeLedger(root, [row({ skill: IMPLEMENT, model: OPUS, claimed_by: "STE-900" })]);

    writeSessionRows(root, "syn-session-1", [
      row({ skill: IMPLEMENT, model: OPUS }),
      // New skill in this session, and a new model under a known skill.
      row({ skill: TDD, model: OPUS }),
      row({ skill: IMPLEMENT, model: SONNET }),
    ]);

    const after = readLedgerRows(root);
    // The carried row proves the write ran the carry-forward at all.
    expect(find(after, "syn-session-1", IMPLEMENT, OPUS)?.claimed_by).toBe("STE-900");
    expect(find(after, "syn-session-1", TDD, OPUS)).toBeDefined();
    expect(find(after, "syn-session-1", TDD, OPUS)?.claimed_by).toBeUndefined();
    expect(find(after, "syn-session-1", IMPLEMENT, SONNET)).toBeDefined();
    expect(find(after, "syn-session-1", IMPLEMENT, SONNET)?.claimed_by).toBeUndefined();
  });

  test("AC-STE-698.3: a fresh row never takes a claim from another session's row", () => {
    const root = tempRoot();
    writeLedger(root, [
      // Another session, same skill and model, claimed.
      row({ session_id: "syn-session-2", skill: TDD, model: OPUS, claimed_by: "STE-901" }),
      // This session: one claimed row so the carry-forward has work to do.
      row({ session_id: "syn-session-1", skill: IMPLEMENT, model: OPUS, claimed_by: "STE-900" }),
    ]);

    writeSessionRows(root, "syn-session-1", [
      row({ skill: IMPLEMENT, model: OPUS }),
      row({ skill: TDD, model: OPUS }),
    ]);

    const after = readLedgerRows(root);
    expect(find(after, "syn-session-1", IMPLEMENT, OPUS)?.claimed_by).toBe("STE-900");
    expect(find(after, "syn-session-1", TDD, OPUS)).toBeDefined();
    expect(find(after, "syn-session-1", TDD, OPUS)?.claimed_by).toBeUndefined();
    expect(find(after, "syn-session-2", TDD, OPUS)?.claimed_by).toBe("STE-901");
  });

  test("AC-STE-698.4: rows of other sessions stay byte-identical across a carrying write", () => {
    const root = tempRoot();
    const others = [
      row({ session_id: "syn-session-2", skill: TDD, claimed_by: "STE-901" }),
      row({ session_id: "syn-session-3", skill: IMPLEMENT, model: SONNET }),
      row({ session_id: "syn-session-2", skill: IMPLEMENT, claimed_by: DESIGN }),
    ];
    writeLedger(root, [
      others[0]!,
      row({ session_id: "syn-session-1", skill: IMPLEMENT, claimed_by: "STE-900" }),
      others[1]!,
      others[2]!,
    ]);
    const before = rawLines(root).filter((l) => !l.includes('"syn-session-1"'));
    expect(before).toHaveLength(3);

    writeSessionRows(root, "syn-session-1", [
      row({ session_id: "syn-session-1", skill: IMPLEMENT, input_tokens: 4242 }),
    ]);

    const afterLines = rawLines(root);
    const afterOthers = afterLines.filter((l) => !l.includes('"syn-session-1"'));
    expect(afterOthers).toEqual(before);
    // The write under test is a carrying one: the session's claim survived.
    const own = readLedgerRows(root).find((r) => r.session_id === "syn-session-1");
    expect(own?.input_tokens).toBe(4242);
    expect(own?.claimed_by).toBe("STE-900");
  });

  test("AC-STE-698.5: after a claim and a later capture write, the milestone rollup renders a bucket for the claimed FR", () => {
    const root = tempRoot();
    writeLedger(root, [
      row({ skill: IMPLEMENT, input_tokens: 100 }),
      row({ skill: TDD, input_tokens: 200 }),
    ]);
    claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["syn-session-1"],
      brainstormClaim: "STE-900",
    });

    writeSessionRows(root, "syn-session-1", [
      row({ skill: IMPLEMENT, input_tokens: 300 }),
      row({ skill: TDD, input_tokens: 400 }),
    ]);

    const block = renderMilestoneRollup(readLedgerRows(root), { frOrder: ["STE-900"] });
    const cells = block
      .split("\n")
      .filter((l) => l.startsWith("|"))
      .map((l) =>
        l
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    const fr = cells.find((c) => c[0] === "STE-900" && c[1] === OPUS);
    expect(fr).toBeDefined();
    // Bucket sums the two fresh rows' input tokens.
    expect(fr?.[2]).toBe("700");
  });

  test("AC-STE-698.6: removing the carry-forward reddens the regression scenario", async () => {
    // Green on the unmutated source…
    expect(regressionScenario(realModule)).toEqual([]);
    // …red on a temp copy with the carry-forward removed.
    const mutant = await loadMutant(MUTANT_NO_CARRY);
    expect(regressionScenario(mutant).length).toBeGreaterThan(0);
  });

  test("AC-STE-698.6: keying the carry-forward by skill alone reddens the two-models-one-skill scenario", async () => {
    expect(twoModelsOneSkillScenario(realModule)).toEqual([]);
    const mutant = await loadMutant(MUTANT_SKILL_ONLY);
    // Control: the skill-only mutant still carries a claim (it is not a no-op).
    expect(regressionScenario(mutant)).toEqual([]);
    expect(twoModelsOneSkillScenario(mutant).length).toBeGreaterThan(0);
  });
});

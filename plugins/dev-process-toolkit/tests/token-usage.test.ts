// STE-344 — Token-usage capture layer: ledger schema + pure transcript parser.
//
// AC mapping:
//   AC-STE-344.1 — ledger schema + location (`ledgerPath`, `TokenLedgerRow`,
//                  `writeSessionRows` writing `token-ledger/v1` JSONL lines).
//   AC-STE-344.2 — `parseTranscriptTokenUsage` pure parser: group-by
//                  (attributionSkill ?? "(main-loop)") × message.model,
//                  four token fields summed + message_count; fail-open on
//                  missing / unreadable / whitespace-only transcripts;
//                  malformed individual lines skipped, never thrown.
//   AC-STE-344.3 — fork roll-up + graceful degradation, proven by the
//                  committed trimmed-real fixtures under
//                  tests/fixtures/token-usage/.
//
// Fixture provenance (AC-STE-344.3): trimmed from a real Claude Code
// transcript of session 9990e660-4e85-4288-9661-e79f7378aa9c (a
// `/dev-process-toolkit:tdd` run whose `context:fork` children inherit the
// parent's `attributionSkill`). Only the fields the parser reads were kept
// (`type`, `attributionSkill`, `message.model`, `message.usage.*` + line
// discriminators); all message content and personal data stripped. Line 1
// carries the Skill tool_use that forked `tdd-write-test`; the three
// subsequent `dev-process-toolkit:tdd` usage lines are the fork child's
// turns — tagged with the PARENT skill, which is the roll-up under test.
//
// Documented, NOT asserted (per AC-STE-344.3): `Agent`-tool subagents (e.g.
// code-reviewer in /implement Phase 3) carry no `isSidechain`, no
// `attributionAgent`, and produce no agent-*.jsonl in this harness version —
// their per-message tokens are a known under-count of the spawning skill.
// `context:fork` skills are unaffected (they roll up via attributionSkill).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ledgerPath,
  parseTranscriptTokenUsage,
  writeSessionRows,
  type TokenLedgerRow,
} from "../adapters/_shared/src/token_usage";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "token-usage");
const FORK_FIXTURE = join(FIXTURE_DIR, "fork-session.jsonl");
const NO_ATTRIBUTION_FIXTURE = join(FIXTURE_DIR, "no-attribution.jsonl");

const MAIN_LOOP = "(main-loop)";
const SCHEMA = "token-ledger/v1";

const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-344-usage-"));
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** Build one real-shape transcript line (assistant turn carrying usage). */
function usageLine(
  skill: string | null,
  model: string,
  usage: Usage,
): string {
  const line: Record<string, unknown> = {
    type: "assistant",
    timestamp: "2026-07-06T12:00:00.000Z",
    sessionId: "sess-unit",
    gitBranch: "main",
    message: { role: "assistant", model, usage },
  };
  if (skill !== null) {
    line.attributionSkill = skill;
    line.attributionPlugin = "dev-process-toolkit";
  }
  return JSON.stringify(line);
}

function writeTranscript(lines: string[]): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function makeRow(partial: Partial<TokenLedgerRow>): TokenLedgerRow {
  return {
    schema: SCHEMA,
    ts: "2026-07-06T00:00:00Z",
    session_id: "sess-a",
    git_branch: "main",
    skill: MAIN_LOOP,
    model: "claude-fable-5",
    input_tokens: 1,
    output_tokens: 2,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 4,
    message_count: 1,
    ...partial,
  };
}

function readLedgerRows(path: string): TokenLedgerRow[] {
  const body = readFileSync(path, "utf-8");
  return body
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TokenLedgerRow);
}

function findRow(
  rows: TokenLedgerRow[],
  skill: string,
  model: string,
): TokenLedgerRow | undefined {
  return rows.find((r) => r.skill === skill && r.model === model);
}

// ---------------------------------------------------------------------------
// AC-STE-344.1 — ledger schema + location
// ---------------------------------------------------------------------------

describe("AC-STE-344.1 — ledgerPath resolves to <projectRoot>/.dev-process/token-ledger.jsonl", () => {
  test("ledgerPath(projectRoot) joins the fixed relative ledger location", () => {
    const root = join(tmpRoot, "proj");
    expect(ledgerPath(root)).toBe(
      join(root, ".dev-process", "token-ledger.jsonl"),
    );
  });
});

describe("AC-STE-344.1 — ledger rows carry the full token-ledger/v1 schema", () => {
  test("writeSessionRows creates the ledger and writes one JSONL line per row with all 11 schema fields", () => {
    const row = makeRow({
      session_id: "sess-a",
      skill: "dev-process-toolkit:spec-write",
      model: "claude-fable-5",
      input_tokens: 9487,
      output_tokens: 7319,
      cache_read_input_tokens: 16432,
      cache_creation_input_tokens: 13974,
      message_count: 58,
    });
    writeSessionRows(tmpRoot, "sess-a", [row]);

    const path = ledgerPath(tmpRoot);
    expect(existsSync(path)).toBe(true);

    const rows = readLedgerRows(path);
    expect(rows.length).toBe(1);
    const got = rows[0]!;
    expect(got.schema).toBe(SCHEMA);
    expect(typeof got.ts).toBe("string");
    expect(got.session_id).toBe("sess-a");
    expect(typeof got.git_branch).toBe("string");
    expect(got.skill).toBe("dev-process-toolkit:spec-write");
    expect(got.model).toBe("claude-fable-5");
    expect(got.input_tokens).toBe(9487);
    expect(got.output_tokens).toBe(7319);
    expect(got.cache_read_input_tokens).toBe(16432);
    expect(got.cache_creation_input_tokens).toBe(13974);
    expect(got.message_count).toBe(58);
  });

  test("the `(main-loop)` sentinel is a valid `skill` value on a ledger line", () => {
    writeSessionRows(tmpRoot, "sess-a", [
      makeRow({ session_id: "sess-a", skill: MAIN_LOOP }),
    ]);
    const rows = readLedgerRows(ledgerPath(tmpRoot));
    expect(rows.length).toBe(1);
    expect(rows[0]!.skill).toBe(MAIN_LOOP);
  });

  test("ledger is append-only across sessions: writing session B preserves session A's rows", () => {
    writeSessionRows(tmpRoot, "sess-a", [
      makeRow({ session_id: "sess-a", skill: "dev-process-toolkit:tdd" }),
    ]);
    writeSessionRows(tmpRoot, "sess-b", [
      makeRow({ session_id: "sess-b", skill: MAIN_LOOP, input_tokens: 99 }),
    ]);

    const rows = readLedgerRows(ledgerPath(tmpRoot));
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.session_id === "sess-a")).toBe(true);
    expect(rows.some((r) => r.session_id === "sess-b")).toBe(true);
  });

  test("re-writing the same session replaces its rows instead of appending duplicates", () => {
    writeSessionRows(tmpRoot, "sess-a", [
      makeRow({ session_id: "sess-a", skill: MAIN_LOOP, input_tokens: 10 }),
    ]);
    writeSessionRows(tmpRoot, "sess-a", [
      makeRow({ session_id: "sess-a", skill: MAIN_LOOP, input_tokens: 20 }),
    ]);

    const rows = readLedgerRows(ledgerPath(tmpRoot));
    expect(rows.length).toBe(1);
    expect(rows[0]!.input_tokens).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-344.2 — pure transcript parser
// ---------------------------------------------------------------------------

describe("AC-STE-344.2 — parseTranscriptTokenUsage groups by (attributionSkill, model)", () => {
  test("buckets by skill × model, sums the four token fields, sets message_count", () => {
    const transcript = writeTranscript([
      usageLine("dev-process-toolkit:implement", "claude-fable-5", {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      }),
      usageLine("dev-process-toolkit:implement", "claude-fable-5", {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
      // same skill, DIFFERENT model → its own bucket
      usageLine("dev-process-toolkit:implement", "claude-opus-4-8", {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 400,
      }),
      // different skill
      usageLine("dev-process-toolkit:gate-check", "claude-fable-5", {
        input_tokens: 7,
        output_tokens: 8,
        cache_read_input_tokens: 9,
        cache_creation_input_tokens: 11,
      }),
      // no attributionSkill → (main-loop)
      usageLine(null, "claude-fable-5", {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 8,
      }),
    ]);

    const rows = parseTranscriptTokenUsage(transcript);
    expect(rows.length).toBe(4);

    const impl = findRow(rows, "dev-process-toolkit:implement", "claude-fable-5");
    expect(impl).toBeDefined();
    expect(impl!.input_tokens).toBe(11);
    expect(impl!.output_tokens).toBe(22);
    expect(impl!.cache_read_input_tokens).toBe(33);
    expect(impl!.cache_creation_input_tokens).toBe(44);
    expect(impl!.message_count).toBe(2);

    const implOpus = findRow(
      rows,
      "dev-process-toolkit:implement",
      "claude-opus-4-8",
    );
    expect(implOpus).toBeDefined();
    expect(implOpus!.input_tokens).toBe(100);
    expect(implOpus!.message_count).toBe(1);

    const gate = findRow(rows, "dev-process-toolkit:gate-check", "claude-fable-5");
    expect(gate).toBeDefined();
    expect(gate!.output_tokens).toBe(8);
    expect(gate!.message_count).toBe(1);

    const main = findRow(rows, MAIN_LOOP, "claude-fable-5");
    expect(main).toBeDefined();
    expect(main!.input_tokens).toBe(5);
    expect(main!.cache_creation_input_tokens).toBe(8);
    expect(main!.message_count).toBe(1);
  });

  test("returned rows structurally satisfy TokenLedgerRow (all 11 fields, correct primitive types)", () => {
    const transcript = writeTranscript([
      usageLine("dev-process-toolkit:tdd", "claude-fable-5", {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
    ]);
    const rows = parseTranscriptTokenUsage(transcript);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(typeof row.schema).toBe("string");
    expect(typeof row.ts).toBe("string");
    expect(typeof row.session_id).toBe("string");
    expect(typeof row.git_branch).toBe("string");
    expect(typeof row.skill).toBe("string");
    expect(typeof row.model).toBe("string");
    for (const field of TOKEN_FIELDS) {
      expect(typeof row[field]).toBe("number");
    }
    expect(typeof row.message_count).toBe("number");
  });

  test("lines without message.usage (user / mode / attachment turns) are ignored", () => {
    const transcript = writeTranscript([
      JSON.stringify({
        type: "user",
        sessionId: "sess-unit",
        message: { role: "user" },
      }),
      JSON.stringify({ type: "mode", sessionId: "sess-unit" }),
      JSON.stringify({ type: "attachment", sessionId: "sess-unit" }),
      usageLine("dev-process-toolkit:tdd", "claude-fable-5", {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
    ]);
    const rows = parseTranscriptTokenUsage(transcript);
    expect(rows.length).toBe(1);
    expect(rows[0]!.message_count).toBe(1);
  });
});

describe("AC-STE-344.2 — fail-open posture", () => {
  test("missing transcript → []", () => {
    const rows = parseTranscriptTokenUsage(
      join(tmpRoot, "does-not-exist.jsonl"),
    );
    expect(rows).toEqual([]);
  });

  test("whitespace-only transcript → []", () => {
    const file = join(tmpRoot, "blank.jsonl");
    writeFileSync(file, "  \n\t\n  \n");
    expect(parseTranscriptTokenUsage(file)).toEqual([]);
  });

  test("unreadable transcript (path is a directory) → [], no throw", () => {
    const dir = join(tmpRoot, "a-directory");
    mkdirSync(dir);
    expect(parseTranscriptTokenUsage(dir)).toEqual([]);
  });

  test("malformed individual lines are skipped; valid lines still counted; never throws", () => {
    const transcript = writeTranscript([
      usageLine("dev-process-toolkit:tdd", "claude-fable-5", {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
      "{{{definitely not json",
      '{"type":"assistant","message":{"model":"claude-fable-5","usage":', // truncated
      '"a bare json string"',
      "null",
      usageLine("dev-process-toolkit:tdd", "claude-fable-5", {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      }),
    ]);

    let rows: TokenLedgerRow[] = [];
    expect(() => {
      rows = parseTranscriptTokenUsage(transcript);
    }).not.toThrow();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.skill).toBe("dev-process-toolkit:tdd");
    expect(row.input_tokens).toBe(11);
    expect(row.output_tokens).toBe(22);
    expect(row.cache_read_input_tokens).toBe(33);
    expect(row.cache_creation_input_tokens).toBe(44);
    expect(row.message_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-344.3 — fork roll-up + graceful degradation (committed real fixture)
// ---------------------------------------------------------------------------

// Hand-computed from tests/fixtures/token-usage/fork-session.jsonl:
//   PARENT   = the 1 parent-context `dev-process-toolkit:tdd` line (the Skill
//              tool_use that forked tdd-write-test).
//   CHILDREN = the 3 fork-child lines that follow it, tagged with the
//              inherited parent attributionSkill.
//   MAIN     = the 2 lines carrying no attributionSkill.
const PARENT = {
  input_tokens: 1,
  output_tokens: 2327,
  cache_read_input_tokens: 156547,
  cache_creation_input_tokens: 5605,
  message_count: 1,
};
const CHILDREN = {
  input_tokens: 6,
  output_tokens: 1911,
  cache_read_input_tokens: 495999,
  cache_creation_input_tokens: 6712,
  message_count: 3,
};
const MAIN = {
  input_tokens: 11480,
  output_tokens: 2391,
  cache_read_input_tokens: 49250,
  cache_creation_input_tokens: 25576,
  message_count: 2,
};

describe("AC-STE-344.3 — fixtures are committed", () => {
  test("fork-session.jsonl exists", () => {
    expect(existsSync(FORK_FIXTURE)).toBe(true);
  });

  test("no-attribution.jsonl exists", () => {
    expect(existsSync(NO_ATTRIBUTION_FIXTURE)).toBe(true);
  });
});

describe("AC-STE-344.3(a) — context:fork children roll up into the parent skill's bucket", () => {
  test("the dev-process-toolkit:tdd row's totals equal parent + fork-child tokens", () => {
    const rows = parseTranscriptTokenUsage(FORK_FIXTURE);
    const tdd = findRow(rows, "dev-process-toolkit:tdd", "claude-fable-5");
    expect(tdd).toBeDefined();
    for (const field of TOKEN_FIELDS) {
      expect(tdd![field]).toBe(PARENT[field] + CHILDREN[field]);
    }
    expect(tdd!.message_count).toBe(
      PARENT.message_count + CHILDREN.message_count,
    );
  });

  test("no separate bucket appears for the forked child skill (tdd-write-test)", () => {
    const rows = parseTranscriptTokenUsage(FORK_FIXTURE);
    expect(
      rows.some((r) => r.skill.includes("tdd-write-test")),
    ).toBe(false);
    // Exactly one tdd bucket — parent + children merged, not split.
    expect(
      rows.filter((r) => r.skill === "dev-process-toolkit:tdd").length,
    ).toBe(1);
  });

  test("rows carry the session id from the transcript lines", () => {
    const rows = parseTranscriptTokenUsage(FORK_FIXTURE);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.session_id).toBe("9990e660-4e85-4288-9661-e79f7378aa9c");
    }
  });
});

describe("AC-STE-344.3(b) — no-attributionSkill lines land in the (main-loop) bucket", () => {
  test("the (main-loop) row sums exactly the two untagged assistant lines", () => {
    const rows = parseTranscriptTokenUsage(FORK_FIXTURE);
    const main = findRow(rows, MAIN_LOOP, "claude-fable-5");
    expect(main).toBeDefined();
    for (const field of TOKEN_FIELDS) {
      expect(main![field]).toBe(MAIN[field]);
    }
    expect(main!.message_count).toBe(MAIN.message_count);
  });

  test("the fork fixture yields exactly two buckets: the tdd skill and (main-loop)", () => {
    const rows = parseTranscriptTokenUsage(FORK_FIXTURE);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.skill))).toEqual(
      new Set(["dev-process-toolkit:tdd", MAIN_LOOP]),
    );
  });
});

describe("AC-STE-344.3(c) — degradation: no attributionSkill anywhere → single (main-loop) bucket, no data dropped", () => {
  test("older-Claude-Code fixture parses to exactly one (main-loop) row carrying ALL tokens", () => {
    const rows = parseTranscriptTokenUsage(NO_ATTRIBUTION_FIXTURE);
    expect(rows.length).toBe(1);
    const only = rows[0]!;
    expect(only.skill).toBe(MAIN_LOOP);
    expect(only.model).toBe("claude-fable-5");
    for (const field of TOKEN_FIELDS) {
      expect(only[field]).toBe(PARENT[field] + CHILDREN[field] + MAIN[field]);
    }
    expect(only.message_count).toBe(
      PARENT.message_count + CHILDREN.message_count + MAIN.message_count,
    );
  });
});

// STE-812 (M_c46877) — forked child skills' tokens reach the ledger.
//
// AC-STE-812.1  the hook reads every <dir>/<session>/subagents/agent-<id>.forked-skill.json
//               whose skillName is a string, whose agent-<id>.jsonl exists and whose <id>
//               is the toolUseResult.agentId of a parent line with status "forked"
// AC-STE-812.2  rows per (skill, model, FR): skill = skillName, session_id = the parent
//               session, scope: "fork"; FR = the STE-811 attribution of the parent line
//               carrying the toolUseResult, claimed with claim_source: "run"
// AC-STE-812.3  meta.json missing or not finished: true ⇒ complete: false, else
//               complete: true; parent rows carry neither key
// AC-STE-812.4  fail-open per child; parent rows byte-equal to STE-811; silent; exit 0
// AC-STE-812.5  the checked-in fixture tests/fixtures/ste-812-fork-layout/ pins the join,
//               one variant per AC-STE-812.4 case yields no child rows
// AC-STE-812.6  cost_per_changed_line reads only non-fork rows; runs_detail tokens_scope;
//               per-run tokens null + `tokens: fork tokens incomplete`; group tokens note
// AC-STE-812.7  docs/retro-reference.md
// AC-STE-812.8  is the full-suite gate the orchestrator runs; no test here.
//
// The fixture reproduces the Claude Code layout seen on 2026-11-16 with every id and
// path replaced: a parent transcript <SID>.jsonl and, under <SID>/subagents/, four files
// per agent (forked-skill.json, forked-skill.marker.json, meta.json, the child jsonl).
// Agent A (tdd-implement) and agent B (tdd-refactor) both finished.
//
// The parent line carrying a toolUseResult has no attributionSkill (as recorded); the
// assistant line it answers carries the orchestrator's skill. The run starts name
// STE-901 for the orchestrator and for each child skill, so the parent line's FR is
// STE-901 whichever skill the join attributes it under. A later run start (STE-902)
// that opens while child A is still running pins "the parent line's time, not the
// child lines' time".
//
// All names, paths and ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ledgerPath, readLedgerRows } from "../adapters/_shared/src/token_usage";
import { runStartLedgerPath } from "../adapters/_shared/src/dpt_paths";
import type { RunStartRow } from "../adapters/_shared/src/run_start";
import { evaluateRetroRules, RETRO_RULES } from "../adapters/_shared/src/retro_rules";
import { buildTrendReport } from "../adapters/_shared/src/retro_trend";
import {
  ALL_ON,
  GIT_ENV,
  PLUGIN_ROOT,
  SETTINGS_HEAD,
  SETUP_MD,
  cleanupTemps,
  commitRows,
  sid,
  tempDir,
  tokenRow,
  writeTokenLedger,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const T = 60_000;
const LONG = 120_000;
const FIXTURE = join(PLUGIN_ROOT, "tests", "fixtures", "ste-812-fork-layout");
const HOOK_ENTRY = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "session-token-ledger.ts");
const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");

const SID = "00000000-0000-4000-8000-000000000812";
const A = "a0000000000000812";
const B = "a0000000000000813";
const BRANCH = "feat/ste-900-synthetic";
const TDD = "dev-process-toolkit:tdd";
const IMPL = "dev-process-toolkit:tdd-implement";
const REF = "dev-process-toolkit:tdd-refactor";
const MAIN = "(main-loop)";
const OPUS = "claude-opus-synthetic";
const SONNET = "claude-sonnet-synthetic";
const TOKENS_ON = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n`;

const at = (hh: number, mm: number, ss = 0): string =>
  `2026-11-16T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.000Z`;

function start(skill: string, fr: string | null, startedAt: string): RunStartRow {
  return {
    schema: "dpt-run-start/1",
    session_id: SID,
    skill,
    fr,
    started_at: startedAt,
    settings_hash: "0".repeat(64),
    settings: {},
    plugin_version: "0.0.0-synthetic",
    registration: "current",
  };
}

const STARTS: RunStartRow[] = [start(TDD, "STE-901", at(10, 0)), start(IMPL, "STE-901", at(10, 2)), start(REF, "STE-901", at(10, 10))];

// What STE-811 writes for the fixture's parent transcript under STARTS, spelled out
// literally: the three orchestrator lines (usage ×1, ×2, ×3) claimed by STE-901 and the
// main-loop line (×4) unattributed. The two Skill-result user lines carry no usage.
const PARENT_ROWS_STARTS = [
  { schema: "token-ledger/v1", ts: at(10, 1), session_id: SID, git_branch: BRANCH, skill: TDD, model: OPUS, input_tokens: 60, output_tokens: 6, cache_read_input_tokens: 600, cache_creation_input_tokens: 6000, message_count: 3, claimed_by: "STE-901", claim_source: "run" },
  { schema: "token-ledger/v1", ts: at(10, 20), session_id: SID, git_branch: BRANCH, skill: MAIN, model: OPUS, input_tokens: 40, output_tokens: 4, cache_read_input_tokens: 400, cache_creation_input_tokens: 4000, message_count: 1 },
];
const PARENT_BYTES = PARENT_ROWS_STARTS.map((r) => JSON.stringify(r)).join("\n") + "\n";

// The child rows the fixture yields, hand-derived from its child transcripts:
//   A: OPUS ×10, ×20, ×30 (one line with no attributionSkill — still A's skill), SONNET ×40
//   B: OPUS ×100, ×200
interface ChildRow {
  skill: string;
  model: string;
  claimed_by: string | null;
  claim_source: string | null;
  scope: unknown;
  complete: unknown;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  message_count: number;
}
const tok = (n: number, count: number) => ({
  input_tokens: 10 * n,
  output_tokens: n,
  cache_read_input_tokens: 100 * n,
  cache_creation_input_tokens: 1000 * n,
  message_count: count,
});
const A_OPUS = (fr: string | null, complete = true): ChildRow => ({ skill: IMPL, model: OPUS, claimed_by: fr, claim_source: fr === null ? null : "run", scope: "fork", complete, session_id: SID, ...tok(60, 3) });
const A_SONNET = (fr: string | null, complete = true): ChildRow => ({ skill: IMPL, model: SONNET, claimed_by: fr, claim_source: fr === null ? null : "run", scope: "fork", complete, session_id: SID, ...tok(40, 1) });
const B_OPUS = (fr: string | null, complete = true): ChildRow => ({ skill: REF, model: OPUS, claimed_by: fr, claim_source: fr === null ? null : "run", scope: "fork", complete, session_id: SID, ...tok(300, 2) });

// ------------------------------------------------------------------ helpers

/** A copy of the checked-in layout in a temp dir; returns the parent transcript path. */
function copyLayout(label: string): { transcript: string; subagents: string } {
  const dir = join(tempDir(`ste812-${label}-t`), "projects", "synthetic");
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, { recursive: true });
  return { transcript: join(dir, `${SID}.jsonl`), subagents: join(dir, SID, "subagents") };
}

/** A git-init'd project root with token stats on and `starts` in its run-start ledger. */
function makeRoot(label: string, starts: RunStartRow[] = STARTS): string {
  const root = join(tempDir(`ste812-${label}`), "repo");
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# Synthetic project\n");
  writeFileSync(join(root, "specs", "settings.yaml"), TOKENS_ON);
  const r = spawnSync("git", ["init", "-q"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  if (starts.length > 0) {
    const file = runStartLedgerPath(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, starts.map((s) => JSON.stringify(s)).join("\n") + "\n");
  }
  return root;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(root: string, transcript: string): HookRun {
  const r = spawnSync("bun", ["run", HOOK_ENTRY], {
    cwd: root,
    input: JSON.stringify({ session_id: SID, transcript_path: transcript, cwd: root, hook_event_name: "SessionEnd" }),
    encoding: "utf-8",
    timeout: T,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run the hook on a (possibly mutated) layout copy; throw on a non-zero exit. */
function capture(label: string, mutate: (l: { transcript: string; subagents: string }) => void = () => {}, starts: RunStartRow[] = STARTS) {
  const root = makeRoot(label, starts);
  const layout = copyLayout(label);
  mutate(layout);
  const run = runHook(root, layout.transcript);
  if (run.status !== 0) throw new Error(`hook exited ${run.status}: ${run.stderr}`);
  return { root, run, layout };
}

const isFork = (r: Record<string, unknown>): boolean => r.scope === "fork";

function childRows(root: string): ChildRow[] {
  return (readLedgerRows(root) as unknown as Record<string, unknown>[])
    .filter(isFork)
    .map((r) => ({
      skill: r.skill as string,
      model: r.model as string,
      claimed_by: (r.claimed_by as string | undefined) ?? null,
      claim_source: (r.claim_source as string | undefined) ?? null,
      scope: r.scope,
      complete: r.complete,
      session_id: r.session_id as string,
      input_tokens: r.input_tokens as number,
      output_tokens: r.output_tokens as number,
      cache_read_input_tokens: r.cache_read_input_tokens as number,
      cache_creation_input_tokens: r.cache_creation_input_tokens as number,
      message_count: r.message_count as number,
    }))
    .sort((x, y) => `${x.skill}|${x.model}|${x.claimed_by}`.localeCompare(`${y.skill}|${y.model}|${y.claimed_by}`));
}

const sortRows = (rows: ChildRow[]): ChildRow[] => [...rows].sort((x, y) => `${x.skill}|${x.model}|${x.claimed_by}`.localeCompare(`${y.skill}|${y.model}|${y.claimed_by}`));

/** The ledger's non-fork lines, as bytes. */
function parentBytes(root: string): string {
  const lines = readFileSync(ledgerPath(root), "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .filter((l) => !isFork(JSON.parse(l) as Record<string, unknown>));
  return lines.join("\n") + "\n";
}

const agentFile = (subagents: string, id: string, suffix: string): string => join(subagents, `agent-${id}${suffix}`);

/** Rewrite the parent transcript's Skill-result line for `agentId` through `edit`. */
function editParentResult(transcript: string, agentId: string, edit: (o: Record<string, any>) => void): void {
  const lines = readFileSync(transcript, "utf-8").split("\n");
  let hit = 0;
  const out = lines.map((l) => {
    if (l.trim() === "") return l;
    const o = JSON.parse(l) as Record<string, any>;
    if (o.toolUseResult?.agentId !== agentId) return l;
    hit++;
    edit(o);
    return JSON.stringify(o);
  });
  if (hit !== 1) throw new Error(`precondition: expected one Skill result for ${agentId}, found ${hit}`);
  writeFileSync(transcript, out.join("\n"));
}

// ===========================================================================
// AC-STE-812.1 — which children are read
// ===========================================================================

describe("AC-STE-812.1 the hook reads the forked children the parent's Skill results name", () => {
  test(
    "both finished children of the layout yield rows under their marker skillName",
    () => {
      const { root } = capture("read-both");
      expect([...new Set(childRows(root).map((r) => r.skill))].sort()).toEqual([IMPL, REF]);
    },
    T,
  );

  test(
    "a marker whose skillName is not a string yields no rows for that child",
    () => {
      const { root } = capture("skillname-num", (l) => writeFileSync(agentFile(l.subagents, A, ".forked-skill.json"), JSON.stringify({ skillName: 42, attributionName: IMPL })));
      expect([...new Set(childRows(root).map((r) => r.skill))]).toEqual([REF]);
    },
    T,
  );

  test(
    "a marker whose agent-<id>.jsonl is missing yields no rows for that child",
    () => {
      const { root } = capture("no-child-jsonl", (l) => rmSync(agentFile(l.subagents, A, ".jsonl")));
      expect([...new Set(childRows(root).map((r) => r.skill))]).toEqual([REF]);
    },
    T,
  );

  test(
    "a marker file with no forked-skill.json (only marker.json) is not read",
    () => {
      const { root } = capture("no-forked-skill-json", (l) => rmSync(agentFile(l.subagents, A, ".forked-skill.json")));
      expect([...new Set(childRows(root).map((r) => r.skill))]).toEqual([REF]);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-812.2 — row shape, skill, session, FR, claim
// ===========================================================================

describe("AC-STE-812.2 child rows per (skill, model, FR), claimed as run claims", () => {
  test(
    "the layout yields exactly the hand-derived child rows",
    () => {
      const { root } = capture("rows");
      expect(childRows(root)).toEqual(sortRows([A_OPUS("STE-901"), A_SONNET("STE-901"), B_OPUS("STE-901")]));
    },
    T,
  );

  test(
    "every child line counts under the marker's skillName, even one with no attributionSkill",
    () => {
      const { root } = capture("forced-skill");
      const opus = childRows(root).find((r) => r.skill === IMPL && r.model === OPUS);
      expect(opus?.message_count).toBe(3);
      expect(readLedgerRows(root).filter((r) => r.skill === MAIN && isFork(r as unknown as Record<string, unknown>))).toEqual([]);
    },
    T,
  );

  test(
    "child rows carry the parent session id even when a child line names another session",
    () => {
      const { root } = capture("parent-sid", (l) => {
        const f = agentFile(l.subagents, B, ".jsonl");
        const body = readFileSync(f, "utf-8").split(SID).join("00000000-0000-4000-8000-000000000899");
        writeFileSync(f, body);
      });
      expect([...new Set(childRows(root).map((r) => r.session_id))]).toEqual([SID]);
    },
    T,
  );

  test(
    "the FR is the parent line's attribution: a run start opening while the child runs does not split it",
    () => {
      const later = [...STARTS, start(TDD, "STE-902", at(10, 4)), start(IMPL, "STE-902", at(10, 4))];
      const { root } = capture("parent-time", () => {}, later);
      const a = childRows(root).filter((r) => r.skill === IMPL);
      expect(a.map((r) => [r.model, r.claimed_by, r.message_count])).toEqual([
        [OPUS, "STE-901", 3],
        [SONNET, "STE-901", 1],
      ]);
    },
    T,
  );

  test(
    "with no run starts the child rows are unattributed: no claimed_by, no claim_source",
    () => {
      const { root } = capture("no-starts", () => {}, []);
      expect(childRows(root)).toEqual(sortRows([A_OPUS(null), A_SONNET(null), B_OPUS(null)]));
    },
    T,
  );

  test(
    "re-running the hook on the same layout yields the same ledger bytes",
    () => {
      const { root, layout } = capture("refire");
      const first = readFileSync(ledgerPath(root), "utf-8");
      expect(runHook(root, layout.transcript).status).toBe(0);
      expect(readFileSync(ledgerPath(root), "utf-8")).toBe(first);
      expect(childRows(root).length).toBe(3);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-812.3 — complete marker
// ===========================================================================

describe("AC-STE-812.3 an unfinished child is marked complete: false", () => {
  // Amended by the PR #142 review (AC-STE-812.4 had these two skip the child): a meta
  // file that cannot be read says nothing about whether the child finished, so the child's
  // tokens are written and marked incomplete. Dropping them made a parent-only total look
  // complete, which is the silent-incomplete case AC-STE-812.6 forbids.
  for (const [name, mutate] of [
    ["unreadable (a directory)", (l: { subagents: string }) => { rmSync(agentFile(l.subagents, B, ".meta.json")); mkdirSync(agentFile(l.subagents, B, ".meta.json")); }],
    ["malformed (not JSON)", (l: { subagents: string }) => writeFileSync(agentFile(l.subagents, B, ".meta.json"), "{ not json\n")],
    ["a JSON array", (l: { subagents: string }) => writeFileSync(agentFile(l.subagents, B, ".meta.json"), "[]\n")],
  ] as const) {
    test(
      `a child whose meta.json is ${name} writes complete: false, never drops the child`,
      () => {
        const { root } = capture(`meta-bad-${name.replace(/[^a-z]+/gi, "-")}`, mutate);
        expect(childRows(root)).toEqual(sortRows([A_OPUS("STE-901"), A_SONNET("STE-901"), B_OPUS("STE-901", false)]));
      },
      T,
    );
  }

  test(
    "a child whose meta.json is missing writes complete: false; its finished sibling complete: true",
    () => {
      const { root } = capture("meta-missing", (l) => rmSync(agentFile(l.subagents, B, ".meta.json")));
      expect(childRows(root)).toEqual(sortRows([A_OPUS("STE-901"), A_SONNET("STE-901"), B_OPUS("STE-901", false)]));
    },
    T,
  );

  test(
    "a child whose meta.json holds finished: false writes complete: false",
    () => {
      const { root } = capture("meta-unfinished", (l) => {
        const f = agentFile(l.subagents, B, ".meta.json");
        writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf-8")), finished: false }) + "\n");
      });
      expect(childRows(root).filter((r) => r.skill === REF).map((r) => r.complete)).toEqual([false]);
    },
    T,
  );

  test(
    "a child whose meta.json has no finished key writes complete: false",
    () => {
      const { root } = capture("meta-no-key", (l) => {
        const f = agentFile(l.subagents, B, ".meta.json");
        const { finished: _drop, ...rest } = JSON.parse(readFileSync(f, "utf-8")) as Record<string, unknown>;
        writeFileSync(f, JSON.stringify(rest) + "\n");
      });
      expect(childRows(root).filter((r) => r.skill === REF).map((r) => r.complete)).toEqual([false]);
    },
    T,
  );

  test(
    "a child whose meta.json holds finished: \"true\" (a string) writes complete: false",
    () => {
      const { root } = capture("meta-string", (l) => {
        const f = agentFile(l.subagents, B, ".meta.json");
        writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf-8")), finished: "true" }) + "\n");
      });
      expect(childRows(root).filter((r) => r.skill === REF).map((r) => r.complete)).toEqual([false]);
    },
    T,
  );

  test(
    "parent rows carry neither scope nor complete",
    () => {
      const { root } = capture("parent-keys");
      const parents = (readLedgerRows(root) as unknown as Record<string, unknown>[]).filter((r) => r.skill === TDD || r.skill === MAIN);
      expect(parents.length).toBe(2);
      expect(parents.map((r) => ["scope" in r, "complete" in r])).toEqual([
        [false, false],
        [false, false],
      ]);
      expect(childRows(root).length).toBe(3);
    },
    T,
  );
});

// ===========================================================================
// AC-STE-812.4 + AC-STE-812.5 — the pinned layout and its fail-open variants
// ===========================================================================

describe("AC-STE-812.5 the checked-in fixture reproduces the recorded layout", () => {
  test("the fixture holds the parent transcript and four files per agent", () => {
    const sub = join(FIXTURE, SID, "subagents");
    const want = [`${SID}.jsonl`, ...[A, B].flatMap((id) => [".forked-skill.json", ".forked-skill.marker.json", ".meta.json", ".jsonl"].map((s) => join(SID, "subagents", `agent-${id}${s}`)))];
    expect(want.filter((p) => !existsSync(join(FIXTURE, p)))).toEqual([]);
    expect(existsSync(sub)).toBe(true);
  });

  test("the fixture's parent transcript holds one forked Skill result per agent", () => {
    const results = readFileSync(join(FIXTURE, `${SID}.jsonl`), "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Record<string, any>)
      .filter((o) => o.type === "user" && o.toolUseResult?.status === "forked")
      .map((o) => [o.toolUseResult.agentId, o.toolUseResult.commandName]);
    expect(results).toEqual([
      [A, IMPL],
      [B, REF],
    ]);
  });

  test(
    "the hook on the fixture pins the join: parent rows as STE-811 writes them, then the child rows",
    () => {
      const { root } = capture("pin");
      expect(parentBytes(root)).toBe(PARENT_BYTES);
      expect(childRows(root)).toEqual(sortRows([A_OPUS("STE-901"), A_SONNET("STE-901"), B_OPUS("STE-901")]));
    },
    T,
  );

  test(
    "child rows are appended after the parent rows",
    () => {
      const { root } = capture("order");
      const flags = (readLedgerRows(root) as unknown as Record<string, unknown>[]).map(isFork);
      expect(flags).toEqual([false, false, true, true, true]);
    },
    T,
  );
});

type Mutation = (l: { transcript: string; subagents: string }) => void;

// Each AC-STE-812.4 case breaks agent A only; agent B stays valid, so a correct join
// still yields B's row (proving the break is per child, not a blanket skip).
const BREAK_A: [string, Mutation][] = [
  ["an unreadable marker (a directory)", (l) => { rmSync(agentFile(l.subagents, A, ".forked-skill.json")); mkdirSync(agentFile(l.subagents, A, ".forked-skill.json")); }],
  ["a malformed marker (not JSON)", (l) => writeFileSync(agentFile(l.subagents, A, ".forked-skill.json"), "{ not json\n")],
  ["a marker that is a JSON array", (l) => writeFileSync(agentFile(l.subagents, A, ".forked-skill.json"), "[]\n")],
  ["an unreadable child transcript (a directory)", (l) => { rmSync(agentFile(l.subagents, A, ".jsonl")); mkdirSync(agentFile(l.subagents, A, ".jsonl")); }],
  ["a malformed child transcript (no JSON line)", (l) => writeFileSync(agentFile(l.subagents, A, ".jsonl"), "not json\nstill not json\n")],
  ["a parent Skill result whose status is not forked", (l) => editParentResult(l.transcript, A, (o) => { o.toolUseResult.status = "completed"; })],
  ["an agent id with no parent match", (l) => editParentResult(l.transcript, A, (o) => { o.toolUseResult.agentId = "a0000000000000999"; })],
];

describe("AC-STE-812.4 the join fails open, per child", () => {
  for (const [name, mutate] of BREAK_A) {
    test(
      `${name}: no rows for that child, the sibling's row stays`,
      () => {
        const { root } = capture(`break-${name.replace(/[^a-z]+/gi, "-")}`, mutate);
        expect(childRows(root)).toEqual([B_OPUS("STE-901")]);
      },
      T,
    );

    test(
      `${name}: parent rows byte-equal to STE-811, nothing printed, exit 0`,
      () => {
        const root = makeRoot(`quiet-${name.replace(/[^a-z]+/gi, "-")}`);
        const layout = copyLayout(`quiet-${name.replace(/[^a-z]+/gi, "-")}`);
        mutate(layout);
        const run = runHook(root, layout.transcript);
        expect({ status: run.status, stdout: run.stdout, stderr: run.stderr, parent: parentBytes(root) }).toEqual({ status: 0, stdout: "", stderr: "", parent: PARENT_BYTES });
      },
      T,
    );
  }

  test(
    "a missing subagents directory: the ledger is exactly the STE-811 parent rows, silent, exit 0",
    () => {
      const root = makeRoot("no-subagents");
      const layout = copyLayout("no-subagents");
      rmSync(join(dirname(layout.subagents)), { recursive: true, force: true });
      const run = runHook(root, layout.transcript);
      expect({ status: run.status, stdout: run.stdout, stderr: run.stderr, ledger: readFileSync(ledgerPath(root), "utf-8") }).toEqual({ status: 0, stdout: "", stderr: "", ledger: PARENT_BYTES });
    },
    T,
  );

  test(
    "a subagents path that is a file, not a directory: parent rows only, silent, exit 0",
    () => {
      const root = makeRoot("subagents-file");
      const layout = copyLayout("subagents-file");
      rmSync(layout.subagents, { recursive: true, force: true });
      writeFileSync(layout.subagents, "not a directory\n");
      const run = runHook(root, layout.transcript);
      expect({ status: run.status, stdout: run.stdout, stderr: run.stderr, ledger: readFileSync(ledgerPath(root), "utf-8") }).toEqual({ status: 0, stdout: "", stderr: "", ledger: PARENT_BYTES });
    },
    T,
  );
});

// ===========================================================================
// AC-STE-812.6 — the retro reads fork rows honestly
// ===========================================================================

describe("AC-STE-812.6 cost_per_changed_line reads parent-visible rows only", () => {
  const rule = RETRO_RULES.find((r) => r.id === "cost_per_changed_line")!;
  const session = { session_id: sid(1), timeline: null, capture_rows: commitRows(10, 0) };
  const evaluate = (token_rows: unknown[]) =>
    evaluateRetroRules({ sessions: [session], token_rows, tracking: { ...ALL_ON } } as any, [rule])[0]!;

  test("a fork row's output tokens do not move the value", () => {
    const res = evaluate([tokenRow(sid(1), 1000), tokenRow(sid(1), 5000, { skill: IMPL, scope: "fork", complete: true })]);
    expect(res.value).toBe(100);
  });

  test("an incomplete fork row's output tokens do not move the value either", () => {
    const res = evaluate([tokenRow(sid(1), 1000), tokenRow(sid(1), 5000, { skill: IMPL, scope: "fork", complete: false })]);
    expect(res.value).toBe(100);
  });

  test("control: without fork rows the value is the parent sum over the changed lines", () => {
    expect(evaluate([tokenRow(sid(1), 1000)]).value).toBe(100);
  });

  test("only fork rows in scope: skipped, the reason naming its tokens parent-visible", () => {
    const res = evaluate([tokenRow(sid(1), 5000, { skill: IMPL, scope: "fork", complete: true })]);
    expect({ value: res.value, disposition: res.disposition }).toEqual({ value: null, disposition: "skipped: input not observable" });
    expect(res.reason).toContain("parent-visible tokens");
  });

  test("the report unit still names its tokens parent-visible", () => {
    expect(evaluate([tokenRow(sid(1), 1000)]).unit).toBe("parent-visible tokens/line");
  });
});

// ---------------------------------------------------------------- trend fixture
//
// Run i is the archived FR STE-(9501 + i), delivered by one `Refs:` commit of 20 lines
// on day i, with a parent row (skill "implement") claimed by its id in session sid(i + 1).
// `fork` adds a tdd-implement row with scope: "fork" in that session; `parentIncomplete`
// sets complete: false on the run's parent row.

interface TrendRun {
  fork?: "complete" | "incomplete";
  parentIncomplete?: boolean;
}

const TREND_BASE = Date.parse("2026-09-01T10:00:00.000Z");
const dayAt = (d: number): string => new Date(TREND_BASE + d * 86_400_000).toISOString();
const frOf = (i: number): string => `STE-${9501 + i}`;

function gitAt(cwd: string, when: string, ...args: string[]): void {
  const p = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
}

function trendSettings(): string {
  return `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  gate_outcomes:\n    enabled: true\n  tool_calls:\n    enabled: true\n  review_findings:\n    enabled: true\n`;
}

const trendMemo = new Map<string, any>();
function trend(label: string, runs: TrendRun[]): any {
  const hit = trendMemo.get(label);
  if (hit !== undefined) return hit;
  const root = join(tempDir(`ste812-trend-${label}`), "repo");
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  gitAt(root, dayAt(-2), "init", "-q", "-b", "main");
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "specs", "settings.yaml"), trendSettings());
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  runs.forEach((_, i) => {
    writeFileSync(
      join(root, "specs", "frs", "archive", `${frOf(i)}.md`),
      `---\ntitle: Synthetic ${frOf(i)}\nmilestone: M_fixture\nstatus: archived\narchived_at: ${dayAt(i).replace(/\.000Z$/, "Z")}\ntracker:\n  linear: ${frOf(i)}\ncreated_at: 2026-08-20T00:00:00Z\nchangelog_category: Added\n---\n\n# Synthetic ${frOf(i)}\n`,
    );
  });
  gitAt(root, dayAt(-1), "add", "-A");
  gitAt(root, dayAt(-1), "commit", "-q", "-m", "chore: fixture setup");
  const msg = join(root, "..", "msg.txt");
  runs.forEach((_, i) => {
    writeFileSync(join(root, "src", `${frOf(i)}.txt`), Array.from({ length: 20 }, (_, k) => `line ${k + 1}`).join("\n") + "\n");
    gitAt(root, dayAt(i), "add", "-A");
    writeFileSync(msg, `feat(core): deliver ${frOf(i)}\n\nRefs: ${frOf(i)}\n`);
    gitAt(root, dayAt(i), "commit", "-q", "-F", msg);
  });
  const rows: unknown[] = [];
  runs.forEach((r, i) => {
    const s = sid(i + 1);
    rows.push(tokenRow(s, 200, { skill: "implement", claimed_by: frOf(i), ...(r.parentIncomplete ? { complete: false } : {}) }));
    if (r.fork) rows.push(tokenRow(s, 400, { skill: IMPL, claimed_by: frOf(i), claim_source: "run", scope: "fork", complete: r.fork === "complete" }));
  });
  writeTokenLedger(root, rows);
  const report = buildTrendReport(root, 20);
  trendMemo.set(label, report);
  return report;
}

function group(report: any, skill: string): any {
  const gs = (report.groups as any[]).filter((g) => g.skill === skill);
  if (gs.length !== 1) throw new Error(`expected one ${skill} group, found ${gs.length}: ${JSON.stringify(report.groups.map((g: any) => g.skill))}`);
  return gs[0];
}
function detail(g: any, fr: string): any {
  const e = (g.runs_detail as any[]).find((x) => x.fr === fr);
  if (e === undefined) throw new Error(`no runs_detail entry for ${fr}`);
  return e;
}
const scopes = (g: any): [string, unknown][] => (g.runs_detail as any[]).map((e) => [e.fr, e.tokens_scope] as [string, unknown]).sort((a, b) => a[0].localeCompare(b[0]));
function tokensCell(g: any): any {
  const m = (g.metrics as any[]).find((x) => x.id === "tokens");
  if (m === undefined) throw new Error(`no tokens cell: ${JSON.stringify(g.metrics)}`);
  return m;
}

// Eight runs: 0 and 1 have no fork row (parent-only); 2..7 have one, run 3's incomplete;
// run 5's parent row is itself marked complete: false.
const MIXED: TrendRun[] = [{}, {}, { fork: "complete" }, { fork: "incomplete" }, { fork: "complete" }, { fork: "complete", parentIncomplete: true }, { fork: "complete" }, { fork: "complete" }];
const mixed = () => trend("mixed", MIXED);
const allFork = () => trend("all-fork", [0, 1, 2, 3, 4].map(() => ({ fork: "complete" as const })));
const preB = () => trend("pre-b", [0, 1, 2, 3, 4].map(() => ({})));

describe("AC-STE-812.6 runs_detail tokens_scope", () => {
  test(
    "a run whose sessions hold no fork row is parent-only; one with a complete fork row is parent+fork",
    () => {
      const g = group(mixed(), "implement");
      expect(scopes(g).filter(([fr]) => fr !== frOf(5))).toEqual([
        [frOf(0), "parent-only"],
        [frOf(1), "parent-only"],
        [frOf(2), "parent+fork"],
        [frOf(3), "parent+fork"],
        [frOf(4), "parent+fork"],
        [frOf(6), "parent+fork"],
        [frOf(7), "parent+fork"],
      ]);
    },
    LONG,
  );

  test(
    "a run any of whose rows has complete: false is incomplete",
    () => {
      expect(detail(group(mixed(), "implement"), frOf(5)).tokens_scope).toBe("incomplete");
      expect(detail(group(mixed(), IMPL), frOf(3)).tokens_scope).toBe("incomplete");
    },
    LONG,
  );

  test(
    "the fork skill's own runs with complete rows are parent+fork",
    () => {
      expect(scopes(group(mixed(), IMPL)).filter(([fr]) => fr !== frOf(3)).map(([, s]) => s)).toEqual(["parent+fork", "parent+fork", "parent+fork", "parent+fork", "parent+fork"]);
    },
    LONG,
  );

  test(
    "every run of a pre-B ledger (no fork row anywhere) is parent-only",
    () => {
      expect(scopes(group(preB(), "implement")).map(([, s]) => s)).toEqual(["parent-only", "parent-only", "parent-only", "parent-only", "parent-only"]);
    },
    LONG,
  );
});

describe("AC-STE-812.6 an incomplete run's tokens are null with the fork note", () => {
  test(
    "the incomplete fork run's tokens is null and its note is exactly `tokens: fork tokens incomplete`",
    () => {
      const e = detail(group(mixed(), IMPL), frOf(3));
      expect({ tokens: e.metrics.tokens, notes: (e.notes as string[]).filter((n) => n.startsWith("tokens: ")) }).toEqual({ tokens: null, notes: ["tokens: fork tokens incomplete"] });
    },
    LONG,
  );

  test(
    "a run whose parent row is incomplete reads the same null and note",
    () => {
      const e = detail(group(mixed(), "implement"), frOf(5));
      expect({ tokens: e.metrics.tokens, notes: (e.notes as string[]).filter((n) => n.startsWith("tokens: ")) }).toEqual({ tokens: null, notes: ["tokens: fork tokens incomplete"] });
    },
    LONG,
  );

  test(
    "control: a complete run keeps its tokens per line (200 / 20 = 10) with no tokens note",
    () => {
      const e = detail(group(mixed(), "implement"), frOf(2));
      expect({ tokens: e.metrics.tokens, notes: (e.notes as string[]).filter((n) => n.startsWith("tokens: ")) }).toEqual({ tokens: 10, notes: [] });
    },
    LONG,
  );
});

describe("AC-STE-812.6 a group's tokens cell names its parent-only and incomplete runs", () => {
  test(
    "two parent-only and one incomplete run",
    () => {
      expect(tokensCell(group(mixed(), "implement")).note).toBe("includes 2 parent-only and 1 incomplete runs");
    },
    LONG,
  );

  test(
    "no parent-only and one incomplete run",
    () => {
      expect(tokensCell(group(mixed(), IMPL)).note).toBe("includes 0 parent-only and 1 incomplete runs");
    },
    LONG,
  );

  test(
    "a pre-B group: every run parent-only",
    () => {
      expect(tokensCell(group(preB(), "implement")).note).toBe("includes 5 parent-only and 0 incomplete runs");
    },
    LONG,
  );

  test(
    "control: every run parent+fork leaves the tokens cell with no note",
    () => {
      const g = group(allFork(), "implement");
      expect({ scopes: scopes(g).map(([, s]) => s), note: tokensCell(g).note }).toEqual({ scopes: ["parent+fork", "parent+fork", "parent+fork", "parent+fork", "parent+fork"], note: null });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-812.7 — docs/retro-reference.md
// ===========================================================================

describe("AC-STE-812.7 docs/retro-reference.md describes fork child rows", () => {
  const doc = (): string => readFileSync(RETRO_REFERENCE, "utf-8");
  /** The paragraphs of the doc that mention the forked-skill marker. */
  const forkParas = (): string =>
    doc()
      .split(/\n\s*\n/)
      .filter((p) => p.includes("forked-skill.json"))
      .join("\n\n");

  test("names the child-row source: the subagents directory and the forked-skill marker", () => {
    const p = forkParas();
    expect(p).toContain("subagents/");
    expect(p).toMatch(/agent-<id>\.jsonl/);
  });

  test("names the scope: \"fork\" value on child rows", () => {
    expect(forkParas()).toMatch(/`scope: "fork"`|`scope`[^\n]*`"?fork"?`/);
  });

  test("states the fail-open rule", () => {
    expect(forkParas()).toMatch(/fail(s|ing)?[ -]open/i);
  });

  test("names the incomplete marker complete: false", () => {
    expect(forkParas()).toMatch(/`complete: false`|`complete`[^\n]*`false`/);
  });

  test("says the source is undocumented upstream", () => {
    expect(forkParas()).toMatch(/undocumented|not documented/i);
  });
});

// STE-814 (M_c46877) — the trend reports each run's own quality signals.
//
// AC-STE-814.1  each runs_detail entry carries `metrics` (waste, tokens, time),
//               `signals` (the four quality signals) and `notes` (strings),
//               computed from that run's own sessions, receipts and commits
// AC-STE-814.2  a per-run value whose tracking switch is off is null, and notes
//               hold `<id>: tracking.<key> is off` per switch; real switches
// AC-STE-814.3  no observable input reads null with a note naming why, never 0;
//               tokens is null for a run holding an incomplete fork row
// AC-STE-814.4  a shared session feeds each run's own values (not additive);
//               the pooled group values still count it once and are unchanged
// AC-STE-814.5  docs/retro-reference.md
// AC-STE-814.6  is the full-suite gate the orchestrator runs; no test here.
//
// Shape assumed: `metrics` and `signals` are keyed by id. Either an object
// `{ <id>: number | null }` or a list `[{ id, value }]` is read (the AC names
// the ids, not the container), and a missing id is a failure, not a null.
//
// Each fixture is a temp git checkout outside the repo. Run i is the archived
// FR STE-(9401 + i), delivered by one `Refs:` commit on day 2i and archived on
// day 2i + 1, with token-ledger rows claimed by its id in session sid(i + 1).
// All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  GC,
  GIT_ENV,
  KEY_A,
  PLUGIN_ROOT,
  SETUP_MD,
  cleanupTemps,
  gateRun,
  reportFiles,
  retroDir,
  round,
  runRetro,
  sid,
  tempDir,
  timeline,
  tokenRow,
  writeTimeline,
  writeTokenLedger,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");
const LONG = 120_000;
const SHARED_SESSION = sid(99);
const TDD_IMPL = "dev-process-toolkit:tdd-implement";

const METRIC_IDS = ["waste", "tokens", "time"] as const;
const SIGNAL_IDS = ["gate_failure_rate", "spec_review_gaps_per_fr", "code_review_concerns_per_100_lines", "post_merge_fixes"] as const;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type TrackingKey = "token_stats" | "gate_outcomes" | "tool_calls" | "review_findings";
type Tracking = Record<TrackingKey, boolean>;
const ALL_ON: Tracking = { token_stats: true, gate_outcomes: true, tool_calls: true, review_findings: true };

type G = [outcome: "P" | "F", wall: number];

interface Receipt {
  reviewer: "spec-review" | "code-review";
  frs: string[];
  counts: unknown;
}

interface RunDef {
  lines: number;
  tokens?: number;
  gates?: G[];
  rounds?: [string, boolean | null][];
  receipts?: (id: string) => Receipt[];
  shared?: boolean;
  /** The run's ledger row is an incomplete fork row (STE-812 `complete: false`). */
  incomplete?: boolean;
}

interface Ev {
  when: string;
  message: string;
}

interface Fixture {
  tracking?: Tracking;
  runs: RunDef[];
  /** Commits appending to src/notes.txt; none carries a Refs: trailer. */
  events?: Ev[];
  shared?: { gates?: G[]; receipts?: Receipt[] };
  /** Hide `.git` after building, so git cannot be read. */
  hideGit?: boolean;
}

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();
const idOf = (i: number): string => `STE-${9401 + i}`;

function gitAt(cwd: string, when: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

function settingsYaml(t: Tracking): string {
  return (
    'schema_version: 1\nmin_dpt_version: "3.0.0"\n' +
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n` +
    `  review_findings:\n    enabled: ${t.review_findings}\n`
  );
}

function frFile(id: string, archivedAt: string): string {
  return (
    "---\n" +
    `title: Synthetic ${id}\n` +
    "milestone: M_fixture\n" +
    "status: archived\n" +
    `archived_at: ${archivedAt}\n` +
    `tracker:\n  linear: ${id}\n` +
    "created_at: 2026-08-20T00:00:00Z\n" +
    "changelog_category: Added\n" +
    "---\n\n" +
    `# Synthetic ${id}\n`
  );
}

const linesOf = (n: number, tag: string): string => Array.from({ length: n }, (_, k) => `${tag} line ${k + 1}`).join("\n") + "\n";

let receiptSeq = 0;
function writeReviewReceipt(root: string, session: string, createdAt: string, r: Receipt): void {
  const dir = join(root, ".dpt", "ledger", "receipts", session);
  mkdirSync(dir, { recursive: true });
  const receipt = {
    v: 1,
    kind: "review-findings",
    sessionId: session,
    root,
    adapter: null,
    container: null,
    subject: r.reviewer,
    decision: "recorded",
    evidence: { reviewer: r.reviewer, head: "0".repeat(40), frs: r.frs, counts: r.counts },
    createdAt,
  };
  const name = `${createdAt.replace(/[:.]/g, "-")}-${createHash("sha256").update(`${r.reviewer}${session}${++receiptSeq}`).digest("hex").slice(0, 8)}.json`;
  writeFileSync(join(dir, name), `${JSON.stringify(receipt)}\n`);
}

const gateRows = (gs: G[]) =>
  gs.map(([o, wall]) => gateRun(wall, { subject: GC, outcome: o === "P" ? "pass" : "fail", key_digest: KEY_A, key_stable: true }));

function buildFixture(label: string, f: Fixture): string {
  const root = join(tempDir(`ste814-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  gitAt(root, at(-2), "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml(f.tracking ?? ALL_ON));
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "notes.txt"), "notes\n");
  f.runs.forEach((_, i) => {
    const id = idOf(i);
    writeFileSync(join(root, "specs", "frs", "archive", `${id}.md`), frFile(id, at(2 * i + 1).replace(/\.000Z$/, "Z")));
  });
  gitAt(root, at(-1), "add", "-A");
  gitAt(root, at(-1), "commit", "-q", "-m", "chore: fixture setup");

  type Step = { when: string; file: string; lines: number | null; message: string };
  const steps: Step[] = f.runs.map((r, i) => ({
    when: at(2 * i),
    file: join("src", `${idOf(i)}.txt`),
    lines: r.lines,
    message: `feat(core): deliver ${idOf(i)}\n\nRefs: ${idOf(i)}\n`,
  }));
  for (const e of f.events ?? []) steps.push({ when: e.when, file: join("src", "notes.txt"), lines: null, message: e.message });
  steps.sort((x, y) => Date.parse(x.when) - Date.parse(y.when));
  const msgFile = join(root, "..", "msg.txt");
  for (const s of steps) {
    if (s.lines === null) appendFileSync(join(root, s.file), `touched at ${s.when}\n`);
    else writeFileSync(join(root, s.file), linesOf(s.lines, s.file));
    gitAt(root, s.when, "add", "-A");
    writeFileSync(msgFile, s.message);
    gitAt(root, s.when, "commit", "-q", "-F", msgFile);
  }

  const rows: unknown[] = [];
  f.runs.forEach((r, i) => {
    const id = idOf(i);
    const s = sid(i + 1);
    rows.push(tokenRow(s, r.tokens ?? 100, { skill: "implement", claimed_by: id, ...(r.incomplete ? { complete: false } : {}) }));
    if (r.shared) rows.push(tokenRow(SHARED_SESSION, 0, { skill: "implement", claimed_by: id }));
    if (r.gates !== undefined || r.rounds !== undefined) {
      writeTimeline(root, s, timeline({ gate_runs: gateRows(r.gates ?? []), rounds: (r.rounds ?? []).map(([k, c]) => round(k, c)) }));
    }
    (r.receipts?.(id) ?? []).forEach((rc, k) => writeReviewReceipt(root, s, at(2 * i + 1, k + 1), rc));
  });
  if (f.shared?.gates !== undefined) writeTimeline(root, SHARED_SESSION, timeline({ gate_runs: gateRows(f.shared.gates) }));
  (f.shared?.receipts ?? []).forEach((rc, k) => writeReviewReceipt(root, SHARED_SESSION, at(30, k + 1), rc));
  writeTokenLedger(root, rows);
  if (f.hideGit) renameSync(join(root, ".git"), join(root, "..", "hidden-git"));
  return realpathSync(root);
}

const memo = new Map<string, any>();
function trend(label: string, f: () => Fixture): any {
  const hit = memo.get(label);
  if (hit !== undefined) return hit;
  const root = buildFixture(label, f());
  const r = runRetro(root, ["--trend"]);
  if (r.status !== 0) throw new Error(`retro.ts --trend exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const files = reportFiles(root).filter((n) => n.startsWith("trend-"));
  if (files.length !== 1) throw new Error(`expected one trend report, found ${JSON.stringify(reportFiles(root))}`);
  const report = JSON.parse(readFileSync(join(retroDir(root), files[0]!), "utf-8"));
  memo.set(label, report);
  return report;
}

function onlyGroup(report: any): any {
  const gs = (report.groups as any[]).filter((g) => g.skill === "implement");
  if (gs.length !== 1) throw new Error(`expected one implement group, found ${gs.length}: ${JSON.stringify(report.groups)}`);
  return gs[0];
}
function entry(g: any, fr: string): any {
  if (!Array.isArray(g.runs_detail)) throw new Error(`group has no runs_detail array: ${JSON.stringify(Object.keys(g))}`);
  const e = (g.runs_detail as any[]).find((x) => x.fr === fr);
  if (e === undefined) throw new Error(`no runs_detail entry for ${fr}: ${JSON.stringify(g.runs_detail)}`);
  return e;
}
/** One per-run value: number or null. A missing container or id throws. */
function val(e: any, part: "metrics" | "signals", id: string): number | null {
  const c = e?.[part];
  if (c === undefined || c === null || typeof c !== "object") throw new Error(`runs_detail entry has no ${part}: ${JSON.stringify(e)}`);
  let v: unknown;
  if (Array.isArray(c)) {
    const cell = c.find((x: any) => x?.id === id);
    if (cell === undefined) throw new Error(`${part} has no ${id}: ${JSON.stringify(c)}`);
    v = cell.value;
  } else {
    if (!(id in c)) throw new Error(`${part} has no ${id}: ${JSON.stringify(c)}`);
    v = c[id];
  }
  if (v !== null && typeof v !== "number") throw new Error(`${part}.${id} is neither a number nor null: ${JSON.stringify(v)}`);
  return v as number | null;
}
function notes(e: any): string[] {
  if (!Array.isArray(e?.notes)) throw new Error(`runs_detail entry has no notes list: ${JSON.stringify(e)}`);
  return e.notes as string[];
}
const notesFor = (e: any, id: string): string[] => notes(e).filter((n) => n.startsWith(`${id}: `));
function groupSignal(g: any, id: string): any {
  const s = (g.signals as any[]).find((x) => x.id === id);
  if (s === undefined) throw new Error(`no group signal ${id}: ${JSON.stringify(g.signals)}`);
  return s;
}
function groupMetric(g: any, id: string): any {
  const m = (g.metrics as any[]).find((x) => x.id === id);
  if (m === undefined) throw new Error(`no group metric ${id}: ${JSON.stringify(g.metrics)}`);
  return m;
}

// ---------------------------------------------------------------------------
// The "own" fixture: five runs, every value observable and different per run.
//
// run  lines tokens  gates (wall ms)          rounds (changed)   spec gaps  concerns  fixes
//  0    20    100    P100 F300                 [false]            1          1         2
//  1    20    200    P100 P100 P500            [true]             2          2         0
//  2    20    300    F50                       [false, false]     3          3         1
//  3    20    400    P10 F20 F30 F40           [true]             4          4         0
//  4    40    800    P1000                     [false]            5          5         0
//
// Expected per run (all hand-derived from the table):
//   tokens = tokens / lines              -> 5, 10, 15, 20, 20
//   time   = median wall of P/F runs     -> 200, 100, 50, 25, 1000
//   waste  = passes on one key - 1, plus unchanged rounds
//                                        -> 0+1, 2+0, 0+2, 0+0, 0+1 = 1, 2, 2, 0, 1
//   gate_failure_rate                    -> 1/2, 0, 1, 3/4, 0
//   spec_review_gaps_per_fr (one FR)     -> 1, 2, 3, 4, 5
//   code_review_concerns_per_100_lines   -> 5, 10, 15, 20, 12.5
//   post_merge_fixes                     -> 2, 0, 1, 0, 0
// The fixes name the FR in the subject only (no Refs:), so no run's size or
// window order moves.
// ---------------------------------------------------------------------------

const OWN_TABLE: { lines: number; tokens: number; gates: G[]; rounds: boolean[] }[] = [
  { lines: 20, tokens: 100, gates: [["P", 100], ["F", 300]], rounds: [false] },
  { lines: 20, tokens: 200, gates: [["P", 100], ["P", 100], ["P", 500]], rounds: [true] },
  { lines: 20, tokens: 300, gates: [["F", 50]], rounds: [false, false] },
  { lines: 20, tokens: 400, gates: [["P", 10], ["F", 20], ["F", 30], ["F", 40]], rounds: [true] },
  { lines: 40, tokens: 800, gates: [["P", 1000]], rounds: [false] },
];

const ownFixture = (tracking: Tracking = ALL_ON): Fixture => ({
  tracking,
  runs: OWN_TABLE.map((t, i) => ({
    lines: t.lines,
    tokens: t.tokens,
    gates: t.gates,
    rounds: t.rounds.map((c) => [TDD_IMPL, c] as [string, boolean]),
    receipts: (id) => [
      { reviewer: "spec-review", frs: [id], counts: { [id]: { done: 3, partial: i, missing: 1 } } },
      { reviewer: "code-review", frs: [id], counts: { concerns: i + 1 } },
    ],
  })),
  events: [
    { when: at(2, 3), message: `fix(core): close an edge of ${idOf(0)}\n` },
    { when: at(3, 3), message: `fix: AC-${idOf(0)}.2 regression\n` },
    { when: at(6, 3), message: `fix(core): ${idOf(2)} follow-up\n` },
  ],
});

const OWN_EXPECTED: Record<string, (number | null)[]> = {
  tokens: [5, 10, 15, 20, 20],
  time: [200, 100, 50, 25, 1000],
  waste: [1, 2, 2, 0, 1],
  gate_failure_rate: [0.5, 0, 1, 0.75, 0],
  spec_review_gaps_per_fr: [1, 2, 3, 4, 5],
  code_review_concerns_per_100_lines: [5, 10, 15, 20, 12.5],
  post_merge_fixes: [2, 0, 1, 0, 0],
};

const own = () => trend("own", () => ownFixture());
const perRunOf = (report: any, part: "metrics" | "signals", id: string) => [0, 1, 2, 3, 4].map((i) => val(entry(onlyGroup(report), idOf(i)), part, id));
const round6 = (xs: (number | null)[]) => xs.map((x) => (x === null ? null : Math.round(x * 1e6) / 1e6));

// ===========================================================================
// AC-STE-814.1 — each run carries its own metrics, signals and notes
// ===========================================================================

describe("AC-STE-814.1 each runs_detail entry carries its own values", () => {
  for (const id of METRIC_IDS) {
    test(
      `AC-STE-814.1 metrics.${id} per run is computed from that run alone: ${JSON.stringify(OWN_EXPECTED[id])}`,
      () => {
        expect(round6(perRunOf(own(), "metrics", id))).toEqual(OWN_EXPECTED[id]!);
      },
      LONG,
    );
  }

  for (const id of SIGNAL_IDS) {
    test(
      `AC-STE-814.1 signals.${id} per run is computed from that run alone: ${JSON.stringify(OWN_EXPECTED[id])}`,
      () => {
        expect(round6(perRunOf(own(), "signals", id))).toEqual(OWN_EXPECTED[id]!);
      },
      LONG,
    );
  }

  test(
    "AC-STE-814.1 every entry carries a notes list, empty when every value is observable",
    () => {
      const g = onlyGroup(own());
      expect([0, 1, 2, 3, 4].map((i) => notes(entry(g, idOf(i))))).toEqual([[], [], [], [], []]);
    },
    LONG,
  );

  test(
    "AC-STE-814.1 metrics hold exactly waste, tokens and time; signals exactly the four signal ids",
    () => {
      const e = entry(onlyGroup(own()), idOf(0));
      const ids = (c: any) => (Array.isArray(c) ? c.map((x: any) => x.id) : Object.keys(c ?? {})).sort();
      expect({ metrics: ids(e.metrics), signals: ids(e.signals) }).toEqual({
        metrics: [...METRIC_IDS].sort(),
        signals: [...SIGNAL_IDS].sort(),
      });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-814.2 — a switch that is off makes the value null and names itself
// ===========================================================================

/** The ids whose input reads each key (the INPUT_KEY table). */
const READS: Record<TrackingKey, string[]> = {
  token_stats: ["tokens"],
  gate_outcomes: ["waste", "time", "gate_failure_rate"],
  tool_calls: ["waste", "time", "gate_failure_rate"],
  review_findings: ["spec_review_gaps_per_fr", "code_review_concerns_per_100_lines"],
};
const ALL_IDS = [...METRIC_IDS, ...SIGNAL_IDS] as string[];
const partOf = (id: string): "metrics" | "signals" => ((METRIC_IDS as readonly string[]).includes(id) ? "metrics" : "signals");

describe("AC-STE-814.2 per-run values honour the project's tracking switches", () => {
  for (const key of Object.keys(READS) as TrackingKey[]) {
    const off = () => trend(`off-${key}`, () => ownFixture({ ...ALL_ON, [key]: false }));

    test(
      `AC-STE-814.2 tracking.${key} off: ${READS[key].join(", ")} read null on every run`,
      () => {
        const got = Object.fromEntries(READS[key].map((id) => [id, perRunOf(off(), partOf(id), id)]));
        expect(got).toEqual(Object.fromEntries(READS[key].map((id) => [id, [null, null, null, null, null]])));
      },
      LONG,
    );

    test(
      `AC-STE-814.2 tracking.${key} off: each run's notes hold "<id>: tracking.${key} is off" for ${READS[key].join(", ")}`,
      () => {
        const g = onlyGroup(off());
        for (let i = 0; i < 5; i++) {
          const ns = notes(entry(g, idOf(i)));
          for (const id of READS[key]) expect(ns).toContain(`${id}: tracking.${key} is off`);
        }
      },
      LONG,
    );

    test(
      `AC-STE-814.2 tracking.${key} off: the values that do not read it keep their numbers`,
      () => {
        const untouched = ALL_IDS.filter((id) => !READS[key].includes(id));
        const got = Object.fromEntries(untouched.map((id) => [id, round6(perRunOf(off(), partOf(id), id))]));
        expect(got).toEqual(Object.fromEntries(untouched.map((id) => [id, OWN_EXPECTED[id]])));
      },
      LONG,
    );

    test(
      `AC-STE-814.2 tracking.${key} off: no note names a switch that is on`,
      () => {
        const g = onlyGroup(off());
        const others = (Object.keys(READS) as TrackingKey[]).filter((k) => k !== key);
        const named = [0, 1, 2, 3, 4].flatMap((i) => notes(entry(g, idOf(i)))).filter((n) => others.some((k) => n.includes(`tracking.${k}`)));
        expect(named).toEqual([]);
      },
      LONG,
    );
  }

  test(
    "AC-STE-814.2 gate_outcomes and tool_calls both off: time carries one note per switch",
    () => {
      const r = trend("off-both", () => ownFixture({ ...ALL_ON, gate_outcomes: false, tool_calls: false }));
      const e = entry(onlyGroup(r), idOf(0));
      expect(val(e, "metrics", "time")).toBeNull();
      expect(notes(e)).toEqual(expect.arrayContaining(["time: tracking.gate_outcomes is off", "time: tracking.tool_calls is off"]));
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-814.3 — no observable input reads null with a note, never 0
// ===========================================================================

/** Five runs with timelines and spec-review receipts but no code-review receipt; run 2 holds an incomplete fork row. */
const sparseFixture = (): Fixture => ({
  runs: [0, 1, 2, 3, 4].map((i) => ({
    lines: 20,
    tokens: 100,
    // Run 1 has no timeline at all: no gate run, no round.
    gates: i === 1 ? undefined : ([["P", 100]] as G[]),
    rounds: i === 1 ? undefined : ([[TDD_IMPL, true]] as [string, boolean][]),
    incomplete: i === 2,
    // Run 3 has no review receipt of either kind.
    receipts: i === 3 ? undefined : (id: string) => [{ reviewer: "spec-review" as const, frs: [id], counts: { [id]: { done: 1, partial: 0, missing: 0 } } }],
  })),
});
const sparse = () => trend("sparse", sparseFixture);

/** Asserts a value is null (not 0) and its run's notes hold a reason for it that is not a switch. */
function expectUnobservable(e: any, id: string): void {
  const v = val(e, partOf(id), id);
  const why = notesFor(e, id);
  expect({ id, value: v, noted: why.length > 0, switchNote: why.some((n) => n.includes("is off")) }).toEqual({
    id,
    value: null,
    noted: true,
    switchNote: false,
  });
}

describe("AC-STE-814.3 an unobservable per-run value is null with a reason, never 0", () => {
  test(
    "AC-STE-814.3 no code-review receipt on any run: code_review_concerns_per_100_lines is null with a note, not 0",
    () => {
      const g = onlyGroup(sparse());
      for (const i of [0, 1, 2, 3, 4]) expectUnobservable(entry(g, idOf(i)), "code_review_concerns_per_100_lines");
    },
    LONG,
  );

  test(
    "AC-STE-814.3 a run with no spec-review receipt: spec_review_gaps_per_fr is null with a note, while a run with one reads 0",
    () => {
      const g = onlyGroup(sparse());
      expectUnobservable(entry(g, idOf(3)), "spec_review_gaps_per_fr");
      expect(val(entry(g, idOf(0)), "signals", "spec_review_gaps_per_fr")).toBe(0);
    },
    LONG,
  );

  // Stage B review: a spec-review receipt that never names this run's FR is not an
  // observation of that FR, so the per-run value is null with a note, not gaps / 1 = 0.
  test(
    "AC-STE-814.3 a run whose spec-review receipt counts only another FR: spec_review_gaps_per_fr is null with a note",
    () => {
      const g = onlyGroup(
        trend("foreign-spec", () => ({
          runs: [0, 1, 2, 3, 4].map((i) => ({
            lines: 20,
            tokens: 100,
            gates: [["P", 100]] as G[],
            rounds: [[TDD_IMPL, true]] as [string, boolean][],
            receipts: (id: string) =>
              i === 4
                ? [{ reviewer: "spec-review" as const, frs: ["STE-9999"], counts: { "STE-9999": { done: 1, partial: 2, missing: 0 } } }]
                : [{ reviewer: "spec-review" as const, frs: [id], counts: { [id]: { done: 1, partial: 0, missing: 0 } } }],
          })),
        })),
      );
      expectUnobservable(entry(g, idOf(4)), "spec_review_gaps_per_fr");
      expect(val(entry(g, idOf(0)), "signals", "spec_review_gaps_per_fr")).toBe(0);
    },
    LONG,
  );

  test(
    "AC-STE-814.3 a run with no gate run: gate_failure_rate and time are null with notes",
    () => {
      const e = entry(onlyGroup(sparse()), idOf(1));
      expectUnobservable(e, "gate_failure_rate");
      expectUnobservable(e, "time");
    },
    LONG,
  );

  test(
    "AC-STE-814.3 a run with no timeline: waste is null with a note, not 0",
    () => {
      expectUnobservable(entry(onlyGroup(sparse()), idOf(1)), "waste");
    },
    LONG,
  );

  test(
    "AC-STE-814.3 a run holding an incomplete fork row: tokens is null with a note",
    () => {
      expectUnobservable(entry(onlyGroup(sparse()), idOf(2)), "tokens");
    },
    LONG,
  );

  test(
    "AC-STE-814.3 control: the complete runs of the same fixture keep tokens 5",
    () => {
      const g = onlyGroup(sparse());
      expect([0, 1, 3, 4].map((i) => val(entry(g, idOf(i)), "metrics", "tokens"))).toEqual([5, 5, 5, 5]);
    },
    LONG,
  );

  test(
    "AC-STE-814.3 git unreadable: post_merge_fixes is null with a note on every run",
    () => {
      const r = trend("no-git", () => ({ ...ownFixture(), hideGit: true }));
      const gs = r.groups as any[];
      expect(gs.length).toBe(1);
      for (const i of [0, 1, 2, 3, 4]) expectUnobservable(entry(gs[0], idOf(i)), "post_merge_fixes");
    },
    LONG,
  );

  test(
    "AC-STE-814.3 a non-Conventional history in a run's fix window: post_merge_fixes is null with a note naming it",
    () => {
      const plain: Ev[] = Array.from({ length: 12 }, (_, k) => ({ when: at(2 + k, 5), message: `Update notes ${k + 1}\n` }));
      const r = trend("not-cc", () => ({ ...ownFixture(), events: [...ownFixture().events!, ...plain] }));
      const e = entry(onlyGroup(r), idOf(0));
      expectUnobservable(e, "post_merge_fixes");
      expect(notesFor(e, "post_merge_fixes").some((n) => n.includes("Conventional"))).toBe(true);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-814.4 — a shared session feeds each run; the pool counts it once
// ===========================================================================

// Five runs, 96 changed lines in all, every run also claiming SHARED_SESSION.
// Each run's own session records one passed gate run; the shared session
// records one failed gate run and one code-review receipt of 2 concerns that
// names no FR.
const sharedFixture = (): Fixture => ({
  runs: [20, 20, 20, 20, 16].map((n) => ({ lines: n, gates: [["P", 100]] as G[], shared: true })),
  shared: { gates: [["F", 100]], receipts: [{ reviewer: "code-review", frs: [], counts: { concerns: 2 } }] },
});
const shared = () => trend("shared", sharedFixture);

describe("AC-STE-814.4 a shared session counts for each run, and once for the group", () => {
  test(
    "AC-STE-814.4 each run's gate_failure_rate counts the shared failed gate run: 1/2 on every run",
    () => {
      expect(round6(perRunOf(shared(), "signals", "gate_failure_rate"))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    },
    LONG,
  );

  test(
    "AC-STE-814.4 each run's code_review_concerns_per_100_lines counts the shared receipt: 10, 10, 10, 10, 12.5",
    () => {
      expect(round6(perRunOf(shared(), "signals", "code_review_concerns_per_100_lines"))).toEqual([10, 10, 10, 10, 12.5]);
    },
    LONG,
  );

  test(
    "AC-STE-814.4 the pooled gate_failure_rate still counts the shared session once: 1 fail over 6",
    () => {
      const s = groupSignal(onlyGroup(shared()), "gate_failure_rate");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(1 / 6, 9);
    },
    LONG,
  );

  test(
    "AC-STE-814.4 the pooled code_review_concerns_per_100_lines still counts the shared receipt once: 200/96",
    () => {
      const s = groupSignal(onlyGroup(shared()), "code_review_concerns_per_100_lines");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(200 / 96, 6);
    },
    LONG,
  );

  // The pooled cells of the "own" fixture, hand-derived from its table:
  //   gate_failure_rate  5 fails / 11 outcomes
  //   spec gaps          (1+2+3+4+5) / 5 = 3
  //   concerns           100 * 15 / 120 = 12.5
  //   post_merge_fixes   2 + 1 = 3
  //   tokens             median 15; older [5,10] 7.5, newer [20,20] 20 -> delta 12.5
  //   time               median 100; older [200,100] 150, newer [25,1000] 512.5 -> delta 362.5
  //   waste              median 1; older [1,2] 1.5, newer [0,1] 0.5 -> delta -1
  test(
    "AC-STE-814.4 the pooled group signals on the own fixture equal their hand-derived values",
    () => {
      const g = onlyGroup(own());
      const got = Object.fromEntries(SIGNAL_IDS.map((id) => [id, groupSignal(g, id)]));
      expect({
        gate_failure_rate: round6([got.gate_failure_rate.value])[0],
        spec_review_gaps_per_fr: got.spec_review_gaps_per_fr.value,
        code_review_concerns_per_100_lines: got.code_review_concerns_per_100_lines.value,
        post_merge_fixes: got.post_merge_fixes.value,
      }).toEqual({
        gate_failure_rate: Math.round((5 / 11) * 1e6) / 1e6,
        spec_review_gaps_per_fr: 3,
        code_review_concerns_per_100_lines: 12.5,
        post_merge_fixes: 3,
      });
    },
    LONG,
  );

  test(
    "AC-STE-814.4 the pooled group metrics on the own fixture equal their hand-derived values",
    () => {
      const g = onlyGroup(own());
      const cell = (id: string) => {
        const m = groupMetric(g, id);
        return { median: m.median, delta: m.delta, note: m.note };
      };
      expect({ tokens: cell("tokens"), time: cell("time"), waste: cell("waste") }).toEqual({
        tokens: { median: 15, delta: 12.5, note: null },
        time: { median: 100, delta: 362.5, note: null },
        waste: { median: 1, delta: -1, note: null },
      });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-814.5 — docs/retro-reference.md
// ===========================================================================

function trendSection(): string {
  const doc = readFileSync(RETRO_REFERENCE, "utf-8");
  const start = doc.indexOf("\n## Trend\n");
  if (start < 0) throw new Error("docs/retro-reference.md has no ## Trend section");
  const rest = doc.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("AC-STE-814.5 docs/retro-reference.md describes the per-run values", () => {
  test("AC-STE-814.5 the Trend section names the runs_detail entry keys metrics, signals and notes", () => {
    const para = trendSection()
      .split("\n\n")
      .find((p) => p.includes("`runs_detail`") && p.includes("`notes`"));
    expect(para).toBeString();
    expect({ metrics: para!.includes("`metrics`"), signals: para!.includes("`signals`") }).toEqual({ metrics: true, signals: true });
  });

  test("AC-STE-814.5 the Trend section gives the per-run switch note `<id>: tracking.<key> is off`", () => {
    expect(trendSection()).toContain("<id>: tracking.<key> is off");
  });

  test("AC-STE-814.5 the Trend section says per-run values are not additive because a shared session feeds each run", () => {
    const para = trendSection()
      .split("\n\n")
      .find((p) => /not additive/.test(p));
    expect(para).toBeString();
    expect({ shared: /shared session|session (?:several|two) runs share/.test(para!), codeReview: /code-review/.test(para!) }).toEqual({
      shared: true,
      codeReview: true,
    });
  });
});

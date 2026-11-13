// STE-776 (M_4daa6e) — a retrospective shows the trend across runs.
//
//   bun run adapters/_shared/src/retro.ts <projectRoot> --trend [--last N]
//
// Modules under test:
//   adapters/_shared/src/retro.ts        — the front door; routes `--trend` (AC-.1)
//   adapters/_shared/src/retro_trend.ts  — the new trend module (AC-.1..AC-.7)
//   adapters/_shared/src/retro_proposal.ts — refuses a trend report (AC-.7)
//   skills/retro/SKILL.md                — documents the flag (AC-.1)
//
// ---------------------------------------------------------------------------
// The public shape this file pins (the implementer follows it):
//
//   retro_trend.ts exports
//     TREND_DEFAULT_LAST = 20        the default window
//     TREND_MIN_RUNS     = 5         a group below it reads `insufficient: <n> runs`
//     sizeBucket(lines): "S" | "M" | "L"   S < 100, M 100..500, L > 500
//
//   `retro.ts <root> --trend [--last N]` exits 0, prints one JSON line whose
//   `report` is the absolute path of the one file it writes,
//   `.dpt/ledger/retro/trend-<UTC yyyymmddThhmmssZ>.json`. A bad N (not a
//   positive integer, or `--last` with no value) exits non-zero with the
//   NFR-10 `Refusing:` / `Remedy:` / `Context:` lines on stderr and writes
//   nothing.
//
//   The report (schema `dpt-retro-trend/1`) carries at least:
//     schema    "dpt-retro-trend/1"
//     last      the window N
//     priority  the retro.priority order the columns follow
//     sessions  [{ alias: "s<N>", digest: <16 hex> }]  — one per run session
//     groups    [{ skill, category, size, runs,
//                  metrics: [{ id: "waste"|"tokens"|"time", median, delta, note }]   (priority order)
//                  signals: [{ id, value, note }] }]                               (ids below)
//   A metric cell: `median` / `delta` numbers and `note: null`, or both null and
//   `note` a string. A signal cell: `value` a number and `note: null`, or
//   `value: null` and `note` a string. A note is either
//   `skipped: not observable ...` naming the `tracking.<key>` that is off, or
//   `insufficient: <n> runs` (every cell of a group under TREND_MIN_RUNS).
//   Signal ids: gate_failure_rate, spec_review_gaps_per_fr,
//   code_review_concerns_per_100_lines, post_merge_fixes.
//
// Definitions the fixture's hand-computed numbers follow:
//   - A run is one ARCHIVED FR (specs/frs/archive/) with token-ledger rows
//     `claimed_by` its id; its sessions are those rows' sessions. An active FR
//     is not a run. Runs are read from the ledger's claims whatever
//     tracking.token_stats says; that switch governs only the tokens value
//     (like the single-run cost_per_changed_line rule).
//   - Group = (the claimed rows' `skill`, the FR's `changelog_category`,
//     sizeBucket(added+deleted lines of commits whose FOOTER is `Refs: <id>`)).
//     A commit that merely names the id in its body is not an FR commit.
//   - Window = the newest N runs of each group, ordered by the FR's last
//     `Refs:` commit date.
//   - Per-run values: waste = reruns on an unchanged key (pass + key_stable
//     runs of one subject+key_digest, minus one) + tdd-implement/tdd-refactor
//     rounds with tree_changed false (a not-observable round is not counted);
//     tokens = sum of the run's claimed output_tokens / its changed lines;
//     time = median wall_ms of the run's gate runs. Gate data is the session
//     timelines' `gate_runs` (the composed gate + gate-outcome receipts, as
//     retro_rules.ts reads it).
//   - median = median of the per-run values over the window; delta = median of
//     the newer half minus median of the older half (the fixture is built so a
//     middle run of an odd window gives the same delta whichever half takes it).
//   - gate_failure_rate = fail outcomes / (pass + fail outcomes), pooled.
//   - spec_review_gaps_per_fr = sum of partial + missing in `spec-review`
//     review-findings receipts for the run's FR, divided by the runs (tdd-audit
//     receipts are not spec-review).
//   - code_review_concerns_per_100_lines = 100 * sum of `code-review` concerns /
//     sum of changed lines, pooled.
//   - post_merge_fixes = count of `fix` / `fix(<scope>)` commits within 14 days
//     after the FR's last Refs commit that touch a file the FR changed and whose
//     message does not name the FR id.
//   - Groups sort worst first by the delta of the first-ranked metric (larger
//     increase = worse); every metric is higher-is-worse.
//
// AC-STE-776.8 (mutation controls) — each guarded behaviour, and the named
// tests that red when it is removed:
//   - the grouping (skill, category, size) ->
//       "AC-.2 four groups: skill, category and size each split runs"
//       "AC-.3 group implement/Added/S waste: median 2, delta 3" (and its tokens/time twins)
//   - the skipped rule ->
//       "AC-.5 tracking.tool_calls off: waste reads skipped and names tracking.tool_calls"
//       "AC-.5 tracking.review_findings off: both review signals read skipped and name tracking.review_findings"
//       (and the token_stats / gate_outcomes twins)
//   - the insufficient rule ->
//       "AC-.5 a 4-run group reads insufficient: 4 runs in every cell"
//       "AC-.5 a 2-run group reads insufficient: 2 runs in every cell"
//       "AC-.1 --last 3 narrows each group's window: a 5-run group reads insufficient: 3 runs"
//
// AC-STE-776.9 is the full-suite gate (`bun test` from plugins/dev-process-toolkit
// reports 0 failures, skip identities equal to trunk by name). It is graded by
// the gate run, not by a test in this file.
//
// Every tree is a temp git checkout outside the repo. All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  BRANCH,
  GC,
  GIT_ENV,
  KEY_A,
  KEY_B,
  PLUGIN_ROOT,
  SETUP_MD,
  UUID_RE,
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

const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const TREND_MOD = join(SRC, "retro_trend.ts");
const PROPOSAL_MOD = join(SRC, "retro_proposal.ts");
const ALIAS_MOD = join(SRC, "session_aliases.ts");
const RETRO_SKILL = join(PLUGIN_ROOT, "skills", "retro", "SKILL.md");

const SCHEMA = "dpt-retro-trend/1";
const SKIPPED_PREFIX = "skipped: not observable";
const TREND_NAME_RE = /^trend-\d{8}T\d{6}Z\.json$/;
const NFR10_RE = /^Refusing: .+\nRemedy: .+\nContext: .+/m;
const SIGNAL_IDS = ["gate_failure_rate", "spec_review_gaps_per_fr", "code_review_concerns_per_100_lines", "post_merge_fixes"];
const IMPL = "dev-process-toolkit:tdd-implement";
const REFACTOR = "dev-process-toolkit:tdd-refactor";
const LONG = 120_000;

// ---------------------------------------------------------------------------
// The pinned fixture project
// ---------------------------------------------------------------------------

type TrackingKey = "token_stats" | "gate_outcomes" | "tool_calls" | "review_findings";
type Tracking = Record<TrackingKey, boolean>;
const ALL_ON: Tracking = { token_stats: true, gate_outcomes: true, tool_calls: true, review_findings: true };

/** A gate run: P/F, wall ms, key A/B. */
type G = [outcome: "P" | "F", wall: number, key: "A" | "B"];
type R = [skill: string, changed: boolean | null];

interface RunSpec {
  skill: "implement" | "deliver";
  category: "Added" | "Fixed";
  /** Lines added per `Refs:` commit (each a new file). */
  commits: number[];
  /** Total claimed output tokens, split across two ledger rows. */
  tokens: number;
  gates?: G[];
  rounds?: R[];
  spec?: { partial: number; missing: number };
  tdd?: { partial: number; missing: number };
  concerns?: number;
  active?: boolean;
}

const P100: G = ["P", 100, "A"];
const F100: G = ["F", 100, "A"];
const P150: G = ["P", 150, "A"];
const P300: G = ["P", 300, "A"];
const F300B: G = ["F", 300, "B"];
const P200: G = ["P", 200, "A"];

// Group A — implement / Added / S, 5 runs (oldest -> newest).
//   lines   [50, 40, 20, 10, 80]          (sum 200)
//   tokens  [400, 320, 200, 140, 1120]    -> per line [8, 8, 10, 14, 14]: median 10, delta 6
//   waste   reruns [1,0,1,2,0] + zero-yield [0,1,1,2,4] = [1,1,2,4,4]: median 2, delta 3
//   time    per-run median wall [100,100,150,300,300]: median 150, delta 200
//   gate outcomes 12, fails 3 -> 0.25
//   spec-review partial+missing [0,1,3,0,3] = 7 over 5 FRs -> 1.4 (tdd-audit 5+5 ignored)
//   code-review concerns [1,0,0,0,3] = 4 over 200 lines -> 2 per 100
//   post-merge fixes: A1 +3d (in), A2 +15d (out), A3 +13d (in), A4 chore (out),
//     A4 fix naming the FR (out), A5 fix on an unrelated file (out) -> 2
const A: RunSpec[] = [
  { skill: "implement", category: "Added", commits: [30, 20], tokens: 400, gates: [P100, P100], rounds: [[IMPL, true]], spec: { partial: 0, missing: 0 }, tdd: { partial: 5, missing: 5 }, concerns: 1 },
  { skill: "implement", category: "Added", commits: [40], tokens: 320, gates: [F100, F100, P100], rounds: [[IMPL, false], [IMPL, true]], spec: { partial: 1, missing: 0 }, concerns: 0 },
  { skill: "implement", category: "Added", commits: [20], tokens: 200, gates: [P150, P150], rounds: [[REFACTOR, false]], spec: { partial: 1, missing: 2 }, concerns: 0 },
  { skill: "implement", category: "Added", commits: [10], tokens: 140, gates: [P300, P300, P300], rounds: [[IMPL, false], [IMPL, false]], spec: { partial: 0, missing: 0 }, concerns: 0 },
  { skill: "implement", category: "Added", commits: [80], tokens: 1120, gates: [F300B, P300], rounds: [[IMPL, false], [IMPL, false], [IMPL, false], [IMPL, false], [IMPL, null]], spec: { partial: 2, missing: 1 }, concerns: 3 },
];

// Group D — deliver / Added / S, 5 runs: differs from A by skill only.
//   lines 20 each; tokens [100,100,200,600,600] -> per line [5,5,10,30,30]: median 10, delta 25
//   waste 1 each: median 1, delta 0; time 200 each: median 200, delta 0
const D: RunSpec[] = [100, 100, 200, 600, 600].map((t) => ({
  skill: "deliver",
  category: "Added",
  commits: [20],
  tokens: t,
  gates: [P200, P200],
  rounds: [[IMPL, true]],
  spec: { partial: 0, missing: 0 },
  concerns: 0,
}));

// Group B — implement / Fixed / S, 4 runs: differs from A by category only.
const B: RunSpec[] = [0, 1, 2, 3].map(() => ({ skill: "implement", category: "Fixed", commits: [30], tokens: 300 }));
// Group C — implement / Added / M, 2 runs at the M boundaries 100 and 500: differs from A by size only.
const C: RunSpec[] = [100, 500].map((n) => ({ skill: "implement", category: "Added", commits: [n], tokens: 1000 }));
// An active FR (not archived) shaped like group A: never a run.
const ACTIVE: RunSpec = { skill: "implement", category: "Added", commits: [10], tokens: 100, gates: [P100], active: true };

/** Global delivery order (oldest first); FR id = STE-(9001 + index), session = sid(index + 1). */
const ORDER: RunSpec[] = [A[0]!, D[0]!, B[0]!, C[0]!, A[1]!, D[1]!, B[1]!, C[1]!, A[2]!, D[2]!, B[2]!, A[3]!, D[3]!, B[3]!, A[4]!, D[4]!];
const frId = (i: number): string => (i === 16 ? "STE-9100" : `STE-${9001 + i}`);
const ALL_RUNS = [...ORDER.map((s, i) => ({ spec: s, i })), { spec: ACTIVE, i: 16 }];
const idOf = (spec: RunSpec): string => frId(ORDER.indexOf(spec));
const RUN_SESSIONS = ORDER.map((_, i) => sid(i + 1));

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();

function gitAt(cwd: string, when: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

function settingsYaml(t: Tracking, priority: string[] | null): string {
  return (
    'schema_version: 1\nmin_dpt_version: "3.0.0"\n' +
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n` +
    `  review_findings:\n    enabled: ${t.review_findings}\n` +
    (priority === null ? "" : `retro:\n  priority: [${priority.join(", ")}]\n`)
  );
}

function frFile(id: string, spec: RunSpec, archivedAt: string): string {
  return (
    "---\n" +
    `title: Synthetic ${id}\n` +
    "milestone: M_fixture\n" +
    `status: ${spec.active ? "active" : "archived"}\n` +
    `archived_at: ${spec.active ? "null" : archivedAt}\n` +
    `tracker:\n  linear: ${id}\n` +
    "created_at: 2026-08-20T00:00:00Z\n" +
    `changelog_category: ${spec.category}\n` +
    "---\n\n" +
    `# Synthetic ${id}\n`
  );
}

function linesOf(n: number, tag: string): string {
  return Array.from({ length: n }, (_, k) => `${tag} line ${k + 1}`).join("\n") + "\n";
}

function writeReviewReceipt(root: string, session: string, createdAt: string, reviewer: string, frs: string[], counts: unknown): void {
  const dir = join(root, ".dpt", "ledger", "receipts", session);
  mkdirSync(dir, { recursive: true });
  const receipt = {
    v: 1,
    kind: "review-findings",
    sessionId: session,
    root,
    adapter: null,
    container: null,
    subject: reviewer,
    decision: "recorded",
    evidence: { reviewer, head: "0".repeat(40), frs, counts },
    createdAt,
  };
  const name = `${createdAt.replace(/[:.]/g, "-")}-${createHash("sha256").update(reviewer + session).digest("hex").slice(0, 8)}.json`;
  writeFileSync(join(dir, name), `${JSON.stringify(receipt)}\n`);
}

interface CommitEvent {
  when: string;
  file: string;
  /** null: append one line to an existing file. */
  lines: number | null;
  message: string;
}

interface FixtureOpts {
  tracking?: Tracking;
  priority?: string[] | null;
  /** Extra commits, given group A's FR id and last-commit day by A-index. */
  extraEvents?: (a: (k: number) => string, lastDay: (k: number) => number) => CommitEvent[];
  /** FR ids whose delivery commits carry no `Refs:` footer. */
  stripRefs?: string[];
  /** Runs after the tree, ledger and receipts are written. */
  after?: (root: string) => void;
}

/** Build the pinned fixture project; returns its realpath. */
function buildFixture(label: string, o: FixtureOpts = {}): string {
  const tracking = o.tracking ?? ALL_ON;
  const root = join(tempDir(`ste776-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  gitAt(root, at(-2), "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml(tracking, o.priority ?? null));
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  mkdirSync(join(root, "src"), { recursive: true });

  for (const { spec, i } of ALL_RUNS) {
    const id = frId(i);
    const rel = spec.active ? join("specs", "frs", `${id}.md`) : join("specs", "frs", "archive", `${id}.md`);
    writeFileSync(join(root, rel), frFile(id, spec, at(2 * i + 2).replace(/\.000Z$/, "Z")));
  }
  gitAt(root, at(-1), "add", "-A");
  gitAt(root, at(-1), "commit", "-q", "-m", "chore: fixture setup");

  const events: CommitEvent[] = [];
  for (const { spec, i } of ALL_RUNS) {
    const id = frId(i);
    spec.commits.forEach((n, k) => {
      events.push({
        when: at(2 * i + k),
        file: join("src", k === 0 ? `${id}.txt` : `${id}-${k}.txt`),
        lines: n,
        message: o.stripRefs?.includes(id) ? `feat(core): deliver part ${k + 1}\n` : `feat(core): deliver ${id} part ${k + 1}\n\nRefs: ${id}\n`,
      });
    });
  }
  const a = (k: number) => idOf(A[k]!);
  const lastDay = (k: number) => {
    const i = ORDER.indexOf(A[k]!);
    return 2 * i + A[k]!.commits.length - 1;
  };
  // Post-merge fix candidates (only two count).
  events.push({ when: at(lastDay(0) + 3), file: join("src", `${a(0)}.txt`), lines: null, message: "fix: tighten the first delivery\n" });
  events.push({ when: at(lastDay(1) + 15), file: join("src", `${a(1)}.txt`), lines: null, message: "fix(core): too late to count\n" });
  events.push({ when: at(lastDay(2) + 13), file: join("src", `${a(2)}.txt`), lines: null, message: "fix(core): inside the window\n" });
  events.push({ when: at(lastDay(3) + 2), file: join("src", `${a(3)}.txt`), lines: null, message: "chore: not a fix\n" });
  events.push({ when: at(lastDay(3) + 3), file: join("src", `${a(3)}.txt`), lines: null, message: `fix: tidy up\n\nFollow-up to ${a(3)}.\n` });
  events.push({ when: at(lastDay(4) + 1, 4), file: join("src", "other.txt"), lines: null, message: "fix: an unrelated file\n" });
  if (o.extraEvents) events.push(...o.extraEvents(a, lastDay));
  events.sort((x, y) => Date.parse(x.when) - Date.parse(y.when));

  for (const e of events) {
    const p = join(root, e.file);
    if (e.lines === null) appendFileSync(p, `touched at ${e.when}\n`);
    else writeFileSync(p, linesOf(e.lines, e.file));
    gitAt(root, e.when, "add", "-A");
    const msgFile = join(root, "..", "msg.txt");
    writeFileSync(msgFile, e.message);
    gitAt(root, e.when, "commit", "-q", "-F", msgFile);
  }

  // Ledger, timelines and review receipts.
  const rows: unknown[] = [];
  for (const { spec, i } of ALL_RUNS) {
    const id = frId(i);
    const s = sid(i + 1);
    const half = Math.floor(spec.tokens / 2);
    rows.push(tokenRow(s, half, { skill: spec.skill, claimed_by: id }));
    rows.push(tokenRow(s, spec.tokens - half, { skill: spec.skill, claimed_by: id }));

    if (tracking.tool_calls && (spec.gates !== undefined || spec.rounds !== undefined)) {
      const gate_runs = (spec.gates ?? []).map(([o, wall, key]) =>
        tracking.gate_outcomes
          ? gateRun(wall, { subject: GC, outcome: o === "P" ? "pass" : "fail", key_digest: key === "A" ? KEY_A : KEY_B, key_stable: true })
          : gateRun(null, { subject: GC, outcome: "none", key_digest: key === "A" ? KEY_A : KEY_B, key_stable: null }),
      );
      const rounds = (spec.rounds ?? []).map(([skill, changed]) => round(skill, changed));
      writeTimeline(root, s, timeline({ gate_runs, rounds }));
    }

    if (tracking.review_findings) {
      const when = at(2 * i + 1, 1);
      if (spec.spec !== undefined) writeReviewReceipt(root, s, when, "spec-review", [id], { [id]: { done: 3, ...spec.spec } });
      if (spec.tdd !== undefined) writeReviewReceipt(root, s, at(2 * i + 1, 2), "tdd-audit", [id], { [id]: { ...spec.tdd } });
      if (spec.concerns !== undefined) writeReviewReceipt(root, s, at(2 * i + 1, 3), "code-review", [id], { concerns: spec.concerns });
    }
  }
  writeTokenLedger(root, rows);
  const real = realpathSync(root);
  o.after?.(real);
  return real;
}

interface TrendRun {
  root: string;
  status: number | null;
  stdout: string;
  stderr: string;
  path: string;
  text: string;
  report: any;
}

function runTrend(root: string, extra: string[] = []): TrendRun {
  const r = runRetro(root, ["--trend", ...extra]);
  if (r.status !== 0) throw new Error(`retro.ts --trend exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const files = reportFiles(root).filter((f) => f.startsWith("trend-"));
  if (files.length !== 1) throw new Error(`expected one trend report, found ${JSON.stringify(reportFiles(root))}`);
  const path = join(retroDir(root), files[0]!);
  const text = readFileSync(path, "utf-8");
  return { root, ...r, path, text, report: JSON.parse(text) };
}

const memo = new Map<string, TrendRun>();
function trendFor(label: string, o: FixtureOpts = {}, extra: string[] = []): TrendRun {
  const hit = memo.get(label);
  if (hit !== undefined) return hit;
  const run = runTrend(buildFixture(label, o), extra);
  memo.set(label, run);
  return run;
}
const defaultTrend = (): TrendRun => trendFor("default");

function groupKeys(report: any): string[] {
  return (report.groups as any[]).map((g) => `${g.skill}/${g.category}/${g.size}`);
}

function group(report: any, skill: string, category: string, size: string): any {
  const g = (report.groups as any[]).find((x) => x.skill === skill && x.category === category && x.size === size);
  if (g === undefined) throw new Error(`no group ${skill}/${category}/${size}; groups: ${JSON.stringify(groupKeys(report))}`);
  return g;
}
const groupA = (report: any) => group(report, "implement", "Added", "S");
const groupD = (report: any) => group(report, "deliver", "Added", "S");
const groupB = (report: any) => group(report, "implement", "Fixed", "S");
const groupC = (report: any) => group(report, "implement", "Added", "M");

function metric(g: any, id: string): any {
  const m = (g.metrics as any[]).find((x) => x.id === id);
  if (m === undefined) throw new Error(`group has no metric ${id}: ${JSON.stringify(g.metrics)}`);
  return m;
}
function signal(g: any, id: string): any {
  const s = (g.signals as any[]).find((x) => x.id === id);
  if (s === undefined) throw new Error(`group has no signal ${id}: ${JSON.stringify(g.signals)}`);
  return s;
}

/** Every file under root except `.git/`, keyed by relative path, hashed. */
function treeSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const rel = relative(root, full);
      if (rel === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

// ===========================================================================
// AC-STE-776.1 — --trend [--last N]
// ===========================================================================

describe("AC-STE-776.1 --trend [--last N]", () => {
  test("AC-.1 TREND_DEFAULT_LAST is the constant 20", async () => {
    const m = await import(TREND_MOD);
    expect(m.TREND_DEFAULT_LAST).toBe(20);
  });

  test(
    "AC-.1 a run with no --last reports last 20, exits 0 and prints the report path",
    () => {
      const t = defaultTrend();
      expect(t.report.last).toBe(20);
      const line = t.stdout.trim().split("\n").pop()!;
      expect(JSON.parse(line).report).toBe(t.path);
    },
    LONG,
  );

  test(
    "AC-.1 --last 3 narrows each group's window: a 5-run group reads insufficient: 3 runs",
    () => {
      const t = trendFor("last3", {}, ["--last", "3"]);
      expect(t.report.last).toBe(3);
      const g = groupA(t.report);
      expect(g.runs).toBe(3);
      expect(metric(g, "waste").note).toBe("insufficient: 3 runs");
    },
    LONG,
  );

  for (const [label, args] of [
    ["0", ["--last", "0"]],
    ["-1", ["--last", "-1"]],
    ["abc", ["--last", "abc"]],
    ["2.5", ["--last", "2.5"]],
    ["no value", ["--last"]],
  ] as const) {
    test(
      `AC-.1 --last ${label} is refused in the NFR-10 shape and writes nothing`,
      () => {
        const root = buildFixture(`refuse-${label.replace(/\W+/g, "_")}`);
        const before = treeSnapshot(root);
        const r = runRetro(root, ["--trend", ...args]);
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(NFR10_RE);
        // The refusal is about N, not about `--trend` being read as free text.
        expect(r.stderr).toContain("--last");
        expect(r.stderr).not.toContain('("--trend")');
        expect(r.stdout.trim()).toBe("");
        expect(treeSnapshot(root)).toEqual(before);
      },
      LONG,
    );
  }

  // Phase 3 review round 1: an argument the trend does not know is refused, never
  // ignored (a typo like `--lasst 5` must not run silently with the default).
  for (const [label, args] of [
    ["--lasst 5", ["--lasst", "5"]],
    ["a stray word", ["extra"]],
    ["--last twice", ["--last", "3", "--last", "4"]],
  ] as const) {
    test(
      `AC-.1 ${label} is refused in the NFR-10 shape and writes nothing`,
      () => {
        const root = buildFixture(`refuse-arg-${label.replace(/\W+/g, "_")}`);
        const before = treeSnapshot(root);
        const r = runRetro(root, ["--trend", ...args]);
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(NFR10_RE);
        expect(r.stdout.trim()).toBe("");
        expect(treeSnapshot(root)).toEqual(before);
      },
      LONG,
    );
  }

  // Phase 3 review round 1: a retro section the loader refuses is surfaced, never
  // silently replaced by the default priority.
  test(
    "AC-.1 a malformed retro.priority refuses in the NFR-10 shape and writes nothing",
    () => {
      const root = buildFixture("refuse-bad-priority", {
        after: (r) => {
          const p = join(r, "specs", "settings.yaml");
          writeFileSync(p, `${readFileSync(p, "utf-8").replace(/^retro:[\s\S]*?(?=^\S|$(?![\s\S]))/m, "")}retro:\n  priority: [waste, waste, time]\n`);
        },
      });
      const before = treeSnapshot(root);
      const r = runRetro(root, ["--trend"]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(NFR10_RE);
      expect(r.stderr).toContain("retro.priority");
      expect(treeSnapshot(root)).toEqual(before);
    },
    LONG,
  );

  test("AC-.1 skills/retro/SKILL.md documents --trend and --last", () => {
    const doc = readFileSync(RETRO_SKILL, "utf-8");
    expect(doc).toContain("--trend");
    expect(doc).toContain("--last");
  });
});

// ===========================================================================
// AC-STE-776.2 — runs and groups
// ===========================================================================

describe("AC-STE-776.2 a run is an archived FR's delivery, grouped by skill, category and size", () => {
  test("AC-.2 sizeBucket: S under 100, M 100 to 500, L over 500", async () => {
    const m = await import(TREND_MOD);
    expect([m.sizeBucket(0), m.sizeBucket(99), m.sizeBucket(100), m.sizeBucket(500), m.sizeBucket(501)]).toEqual(["S", "S", "M", "M", "L"]);
  });

  test(
    "AC-.2 four groups: skill, category and size each split runs",
    () => {
      const t = defaultTrend();
      const got = (t.report.groups as any[]).map((g) => `${g.skill}/${g.category}/${g.size}=${g.runs}`).sort();
      expect(got).toEqual(["deliver/Added/S=5", "implement/Added/M=2", "implement/Added/S=5", "implement/Fixed/S=4"]);
    },
    LONG,
  );

  test(
    "AC-.2 the report's sessions are exactly the archived runs' sessions (an active FR is no run)",
    async () => {
      const t = defaultTrend();
      const { sessionDigest } = await import(ALIAS_MOD);
      const got = (t.report.sessions as any[]).map((s) => s.digest).sort();
      expect(got).toEqual(RUN_SESSIONS.map((s) => sessionDigest(s)).sort());
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-776.3 — waste, tokens, time: window median and newer-minus-older delta
// ===========================================================================

describe("AC-STE-776.3 metrics per group", () => {
  test(
    "AC-.3 group implement/Added/S waste: median 2, delta 3",
    () => {
      const m = metric(groupA(defaultTrend().report), "waste");
      expect({ median: m.median, delta: m.delta, note: m.note }).toEqual({ median: 2, delta: 3, note: null });
    },
    LONG,
  );

  test(
    "AC-.3 group implement/Added/S tokens per changed line: median 10, delta 6",
    () => {
      const m = metric(groupA(defaultTrend().report), "tokens");
      expect({ median: m.median, delta: m.delta, note: m.note }).toEqual({ median: 10, delta: 6, note: null });
    },
    LONG,
  );

  test(
    "AC-.3 group implement/Added/S time (median gate wall ms): median 150, delta 200",
    () => {
      const m = metric(groupA(defaultTrend().report), "time");
      expect({ median: m.median, delta: m.delta, note: m.note }).toEqual({ median: 150, delta: 200, note: null });
    },
    LONG,
  );

  test(
    "AC-.3 group deliver/Added/S: waste 1/0, tokens 10/25, time 200/0",
    () => {
      const g = groupD(defaultTrend().report);
      const got = Object.fromEntries(["waste", "tokens", "time"].map((id) => [id, [metric(g, id).median, metric(g, id).delta]]));
      expect(got).toEqual({ waste: [1, 0], tokens: [10, 25], time: [200, 0] });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-776.4 — the four quality signals
// ===========================================================================

describe("AC-STE-776.4 quality signals per group", () => {
  test(
    "AC-.4 gate failure rate: 3 fails over 12 outcomes = 0.25",
    () => {
      const s = signal(groupA(defaultTrend().report), "gate_failure_rate");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(0.25, 9);
    },
    LONG,
  );

  test(
    "AC-.4 spec-review missing plus partial per FR: 7 over 5 FRs = 1.4 (tdd-audit not counted)",
    () => {
      const s = signal(groupA(defaultTrend().report), "spec_review_gaps_per_fr");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(1.4, 9);
    },
    LONG,
  );

  test(
    "AC-.4 code-review concerns per 100 changed lines: 4 over 200 lines = 2",
    () => {
      const s = signal(groupA(defaultTrend().report), "code_review_concerns_per_100_lines");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(2, 9);
    },
    LONG,
  );

  test(
    "AC-.4 post-merge fixes: 2 (late, chore, self-naming and unrelated-file commits excluded)",
    () => {
      const s = signal(groupA(defaultTrend().report), "post_merge_fixes");
      expect({ value: s.value, note: s.note }).toEqual({ value: 2, note: null });
    },
    LONG,
  );

  // "Reference the FR" is a whole-id match: A1's id is STE-9001, and a fix that
  // names STE-90011 (a different FR whose id starts with STE-9001) still counts.
  const prefixFix = (a: (k: number) => string, lastDay: (k: number) => number): CommitEvent => ({
    when: at(lastDay(0) + 5),
    file: join("src", `${a(0)}.txt`),
    lines: null,
    message: `fix(core): follow-up from ${a(0)}1\n`,
  });
  const exactFix = (a: (k: number) => string, lastDay: (k: number) => number): CommitEvent => ({
    when: at(lastDay(0) + 6),
    file: join("src", `${a(0)}.txt`),
    lines: null,
    message: `fix(core): finish (${a(0)})\n`,
  });

  test(
    "AC-.4 post-merge fixes: a fix naming a longer id that starts with the FR's id counts (3)",
    () => {
      const g = groupA(trendFor("pmf-prefix", { extraEvents: (a, d) => [prefixFix(a, d)] }).report);
      const s = signal(g, "post_merge_fixes");
      expect({ value: s.value, note: s.note }).toEqual({ value: 3, note: null });
    },
    LONG,
  );

  test(
    "AC-.4 post-merge fixes: beside the longer-id fix, a fix naming the FR's exact id is still excluded (3)",
    () => {
      const g = groupA(trendFor("pmf-prefix-exact", { extraEvents: (a, d) => [prefixFix(a, d), exactFix(a, d)] }).report);
      const s = signal(g, "post_merge_fixes");
      expect({ value: s.value, note: s.note }).toEqual({ value: 3, note: null });
    },
    LONG,
  );

  test(
    "AC-.4 signal ids are the four named signals, in order",
    () => {
      expect((groupA(defaultTrend().report).signals as any[]).map((s) => s.id)).toEqual(SIGNAL_IDS);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-776.5 — skipped and insufficient, never 0
// ===========================================================================

function cells(g: any): { id: string; num: unknown; note: unknown }[] {
  return [
    ...(g.metrics as any[]).flatMap((m) => [
      { id: `${m.id}.median`, num: m.median, note: m.note },
      { id: `${m.id}.delta`, num: m.delta, note: m.note },
    ]),
    ...(g.signals as any[]).map((s) => ({ id: s.id, num: s.value, note: s.note })),
  ];
}

describe("AC-STE-776.5 not observable and insufficient read as such, never 0", () => {
  test("AC-.5 TREND_MIN_RUNS is 5", async () => {
    const m = await import(TREND_MOD);
    expect(m.TREND_MIN_RUNS).toBe(5);
  });

  test(
    "AC-.5 a 4-run group reads insufficient: 4 runs in every cell",
    () => {
      const g = groupB(defaultTrend().report);
      expect(g.runs).toBe(4);
      const got = cells(g);
      expect(got.length).toBe(3 * 2 + 4);
      expect(got).toEqual(got.map((c) => ({ id: c.id, num: null, note: "insufficient: 4 runs" })));
    },
    LONG,
  );

  test(
    "AC-.5 a 2-run group reads insufficient: 2 runs in every cell",
    () => {
      const g = groupC(defaultTrend().report);
      expect(g.runs).toBe(2);
      const got = cells(g);
      expect(got.length).toBe(3 * 2 + 4);
      expect(got).toEqual(got.map((c) => ({ id: c.id, num: null, note: "insufficient: 2 runs" })));
    },
    LONG,
  );

  test(
    "AC-.5 tracking.tool_calls off: waste reads skipped and names tracking.tool_calls",
    () => {
      const g = groupA(trendFor("off-tool_calls", { tracking: { ...ALL_ON, tool_calls: false } }).report);
      const m = metric(g, "waste");
      expect({ median: m.median, delta: m.delta }).toEqual({ median: null, delta: null });
      expect(String(m.note)).toStartWith(SKIPPED_PREFIX);
      expect(String(m.note)).toContain("tracking.tool_calls");
      expect(signal(g, "post_merge_fixes").value).toBe(2);
    },
    LONG,
  );

  test(
    "AC-.5 tracking.gate_outcomes off: time and gate failure rate read skipped and name tracking.gate_outcomes",
    () => {
      const g = groupA(trendFor("off-gate_outcomes", { tracking: { ...ALL_ON, gate_outcomes: false } }).report);
      const time = metric(g, "time");
      const rate = signal(g, "gate_failure_rate");
      expect({ median: time.median, delta: time.delta, value: rate.value }).toEqual({ median: null, delta: null, value: null });
      for (const note of [time.note, rate.note]) {
        expect(String(note)).toStartWith(SKIPPED_PREFIX);
        expect(String(note)).toContain("tracking.gate_outcomes");
      }
      expect(signal(g, "post_merge_fixes").value).toBe(2);
    },
    LONG,
  );

  test(
    "AC-.5 tracking.token_stats off: tokens reads skipped and names tracking.token_stats",
    () => {
      const g = groupA(trendFor("off-token_stats", { tracking: { ...ALL_ON, token_stats: false } }).report);
      const m = metric(g, "tokens");
      expect({ median: m.median, delta: m.delta }).toEqual({ median: null, delta: null });
      expect(String(m.note)).toStartWith(SKIPPED_PREFIX);
      expect(String(m.note)).toContain("tracking.token_stats");
      expect(signal(g, "post_merge_fixes").value).toBe(2);
    },
    LONG,
  );

  test(
    "AC-.5 tracking.review_findings off: both review signals read skipped and name tracking.review_findings",
    () => {
      const g = groupA(trendFor("off-review_findings", { tracking: { ...ALL_ON, review_findings: false } }).report);
      for (const id of ["spec_review_gaps_per_fr", "code_review_concerns_per_100_lines"]) {
        const s = signal(g, id);
        expect({ id, value: s.value }).toEqual({ id, value: null });
        expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
        expect(String(s.note)).toContain("tracking.review_findings");
      }
      expect(signal(g, "post_merge_fixes").value).toBe(2);
    },
    LONG,
  );
});

describe("AC-STE-776.5 post-merge fixes with an unobservable input read skipped, never 0", () => {
  test(
    "AC-.5 a run in the window with no Refs: commits: post_merge_fixes reads skipped with value null",
    () => {
      const g = groupA(trendFor("pmf-no-refs", { stripRefs: [idOf(A[4]!)] }).report);
      const s = signal(g, "post_merge_fixes");
      expect(s.value).toBeNull();
      expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
    },
    LONG,
  );

  test(
    "AC-.5 git cannot be read: post_merge_fixes reads skipped with value null",
    () => {
      const t = trendFor("pmf-no-git", {
        after: (root) => {
          // A `.git` file pointing nowhere: git fails here and does not fall back to a parent repo.
          renameSync(join(root, ".git"), join(root, ".git-moved"));
          writeFileSync(join(root, ".git"), `gitdir: ${join(root, ".git-missing")}\n`);
        },
      });
      // Phase 3 review round 1: with git unreadable no run can be sized, so the
      // size reads `unknown` — never a silent S.
      expect(groupKeys(t.report).every((k) => k.endsWith("/unknown"))).toBe(true);
      const g = group(t.report, "implement", "Added", "unknown");
      const s = signal(g, "post_merge_fixes");
      expect(s.value).toBeNull();
      expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-776.6 — columns follow retro.priority; groups sort worst first
// ===========================================================================

describe("AC-STE-776.6 retro.priority orders the columns and the groups", () => {
  test(
    "AC-.6 default priority: columns waste, tokens, time; report.priority echoes it",
    () => {
      const r = defaultTrend().report;
      expect(r.priority).toEqual(["waste", "tokens", "time"]);
      expect((groupA(r).metrics as any[]).map((m) => m.id)).toEqual(["waste", "tokens", "time"]);
    },
    LONG,
  );

  test(
    "AC-.6 default priority: implement/Added/S (waste delta 3) sorts before deliver/Added/S (waste delta 0)",
    () => {
      const keys = groupKeys(defaultTrend().report);
      expect(keys.indexOf("implement/Added/S")).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf("deliver/Added/S")).toBeGreaterThan(keys.indexOf("implement/Added/S"));
    },
    LONG,
  );

  test(
    "AC-.6 priority tokens first: columns tokens, waste, time and deliver/Added/S (tokens delta 25) sorts first",
    () => {
      const r = trendFor("tokens-first", { priority: ["tokens", "waste", "time"] }).report;
      expect(r.priority).toEqual(["tokens", "waste", "time"]);
      expect((groupA(r).metrics as any[]).map((m) => m.id)).toEqual(["tokens", "waste", "time"]);
      const keys = groupKeys(r);
      expect(keys.indexOf("deliver/Added/S")).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf("implement/Added/S")).toBeGreaterThan(keys.indexOf("deliver/Added/S"));
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-776.7 — one file, aliases only, nothing else written
// ===========================================================================

describe("AC-STE-776.7 the trend writes one report and nothing else", () => {
  test(
    "AC-.7 exactly one new file, .dpt/ledger/retro/trend-<stamp>.json, and no other byte changes",
    () => {
      const root = buildFixture("one-file");
      const before = treeSnapshot(root);
      const t = runTrend(root);
      const after = treeSnapshot(root);
      const added = Object.keys(after).filter((k) => !(k in before));
      expect(added).toEqual([relative(root, t.path)]);
      expect(relative(retroDir(root), t.path)).toMatch(TREND_NAME_RE);
      const kept = Object.fromEntries(Object.entries(after).filter(([k]) => k in before));
      expect(kept).toEqual(before);
    },
    LONG,
  );

  test(
    "AC-.7 schema is dpt-retro-trend/1",
    () => {
      expect(defaultTrend().report.schema).toBe(SCHEMA);
    },
    LONG,
  );

  test(
    "AC-.7 sessions appear only as s<N> aliases with 16-hex digests; no raw session id",
    () => {
      const t = defaultTrend();
      expect((t.report.sessions as any[]).length).toBe(RUN_SESSIONS.length);
      for (const s of t.report.sessions as any[]) {
        expect(Object.keys(s).sort()).toEqual(["alias", "digest"]);
        expect(s.alias).toMatch(/^s[1-9]\d*$/);
        expect(s.digest).toMatch(/^[0-9a-f]{16}$/);
      }
      expect(t.text.match(UUID_RE)).toBeNull();
    },
    LONG,
  );

  test(
    "AC-.7 the report holds no path, command or branch name",
    () => {
      const t = defaultTrend();
      for (const needle of [t.root, BRANCH, "synthetic-branch", "src/", ".dpt", "specs/", "bun run", "git log", ".txt", ".md"]) {
        expect({ needle, found: t.text.includes(needle) }).toEqual({ needle, found: false });
      }
    },
    LONG,
  );

  test(
    "AC-.7 retro_proposal refuses a trend report: proposeLines throws",
    async () => {
      const t = defaultTrend();
      const { proposeLines } = await import(PROPOSAL_MOD);
      expect(() => proposeLines(t.root, t.text)).toThrow();
    },
    LONG,
  );

  test(
    "AC-.7 retro_proposal apply refuses a trend report in the NFR-10 shape and writes nothing",
    () => {
      const root = buildFixture("apply-refuse");
      const t = runTrend(root);
      const before = treeSnapshot(root);
      const p = spawnSync(process.execPath, ["run", PROPOSAL_MOD, "apply", root, t.path, "0".repeat(64)], {
        cwd: root,
        encoding: "utf-8",
        env: { ...process.env, ...GIT_ENV, CLAUDE_CODE_SESSION_ID: sid(70), CLAUDE_CONFIG_DIR: tempDir("apply-config") },
        timeout: 60_000,
      });
      expect(p.status).toBe(1);
      expect(p.stderr ?? "").toMatch(NFR10_RE);
      expect(treeSnapshot(root)).toEqual(before);
      expect(existsSync(join(root, ".dpt", "ledger", "receipts", sid(70)))).toBe(false);
    },
    LONG,
  );
});

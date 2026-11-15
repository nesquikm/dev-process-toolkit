// STE-776 (M_4daa6e) — a retrospective across runs.
//
//   bun run adapters/_shared/src/retro.ts <projectRoot> --trend [--last N]
//   bun run adapters/_shared/src/retro_trend.ts <projectRoot> [--last N]
//
// A run is one archived FR with token-ledger rows claimed by its id. Runs are
// grouped by (skill, changelog_category, size bucket) and each group keeps its
// newest N runs. Writes exactly one file:
// `.dpt/ledger/retro/trend-<UTC yyyymmddThhmmssZ>.json` (schema `dpt-retro-trend/1`).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { retroReportsDir, toolCallTimelinePath } from "./dpt_paths";
import { parseFrontmatter } from "./frontmatter";
import { DEFAULT_RETRO_PRIORITY, loadProjectSection, type RetroMetric } from "./project_settings";
import { RETRO_RULES, evaluateRetroRules, type RetroInputs } from "./retro_rules";
import { REVIEW_FINDINGS_KIND } from "./review_findings_receipt";
import { aliasFor, createAliasMap, sessionDigest } from "./session_aliases";
import { readLedgerRows } from "./token_usage";
import { readSessionReceipts } from "./tracker_receipts";

export const TREND_SCHEMA = "dpt-retro-trend/1";
/** The default window: the newest N runs of each group. */
export const TREND_DEFAULT_LAST = 20;
/** A group with fewer runs than this reads `insufficient: <n> runs` in every cell. */
export const TREND_MIN_RUNS = 5;

export type SizeBucket = "S" | "M" | "L";

export function sizeBucket(lines: number): SizeBucket {
  if (lines < 100) return "S";
  if (lines <= 500) return "M";
  return "L";
}

/** NFR-10 refusal for a bad `--last` value. */
export class TrendArgError extends Error {}

function refuseLast(value: string | undefined): TrendArgError {
  const shown = value === undefined ? "no value" : JSON.stringify(value);
  return new TrendArgError(
    `Refusing: --last takes a positive integer, got ${shown}.\n` +
      `Remedy: pass --last <N> with N a whole number of 1 or more, or omit --last for the default ${TREND_DEFAULT_LAST}.\n` +
      `Context: mode=retro, phase=trend, argument=--last`,
  );
}

function refuseArg(arg: string, why: string): TrendArgError {
  return new TrendArgError(
    `Refusing: ${why} (${JSON.stringify(arg)}), so no trend was computed.\n` +
      `Remedy: run --trend with at most one --last <N> and nothing else.\n` +
      `Context: mode=retro, phase=trend, argument=${JSON.stringify(arg)}`,
  );
}

/** Parse the arguments after `--trend`; throws TrendArgError on a bad N, an unknown argument or a repeated --last. */
export function parseTrendArgs(args: string[]): { last: number } {
  let last = TREND_DEFAULT_LAST;
  let seen = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--last") throw refuseArg(args[i]!, "--trend takes only --last <N>, and this argument is not it");
    if (seen) throw refuseArg("--last", "--last was given twice");
    const v = args[i + 1];
    if (v === undefined || !/^[1-9]\d*$/.test(v)) throw refuseLast(v);
    last = Number(v);
    seen = true;
    i++;
  }
  return { last };
}

interface Run {
  id: string;
  /** False when git could not be read, so the run's size is unknown. */
  sized: boolean;
  skill: string;
  category: string;
  lines: number;
  lastCommitAt: number;
  files: string[];
  sessions: string[];
  outputTokens: number;
}

function archivedFrs(projectRoot: string): { id: string; category: string }[] {
  const dir = join(projectRoot, "specs", "frs", "archive");
  if (!existsSync(dir)) return [];
  const out: { id: string; category: string }[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(readFileSync(join(dir, name), "utf-8"), { lenient: true });
    } catch {
      continue;
    }
    out.push({ id: name.slice(0, -3), category: typeof fm.changelog_category === "string" ? fm.changelog_category : "unknown" });
  }
  return out;
}

/**
 * One `git log` whose `--format` opens each commit with `%x1e%ct%x1f<field>%x1f`;
 * returns each commit's `[epoch-ms, field, trailing output]`, or `null` when git
 * cannot be read — never an empty log in disguise.
 */
function gitLogRecords(projectRoot: string, field: string, extra: string): [number, string, string][] | null {
  const p = spawnSync("git", ["log", `--format=%x1e%ct%x1f${field}%x1f`, extra], {
    cwd: projectRoot,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    env: process.env,
  });
  if (p.status !== 0) return null;
  const out: [number, string, string][] = [];
  for (const chunk of (p.stdout ?? "").split("\x1e")) {
    const parts = chunk.split("\x1f");
    if (parts.length < 3) continue;
    out.push([Number(parts[0]) * 1000, parts[1]!, parts[2]!]);
  }
  return out;
}

interface RefsTotals {
  lines: number;
  last: number;
  files: Set<string>;
}

const noRefs = (): RefsTotals => ({ lines: 0, last: 0, files: new Set<string>() });

/**
 * A numstat path as the paths it names: a rename (`dir/{a.ts => b.ts}` or
 * `a.ts => b.ts`) yields the new and the old path, anything else itself.
 */
function renamePaths(path: string): string[] {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace) {
    const [, pre, from, to, post] = brace;
    const join = (mid: string) => `${pre}${mid}${post}`.replace(/\/\/+/g, "/");
    return [join(to!), join(from!)];
  }
  const arrow = /^(.+) => (.+)$/.exec(path);
  return arrow ? [arrow[2]!, arrow[1]!] : [path];
}

/** Changed lines, files and last commit time per FR id, from commits whose `Refs:` trailer names it. */
function refsCommits(projectRoot: string): Map<string, RefsTotals> | null {
  const records = gitLogRecords(projectRoot, "%(trailers:key=Refs,valueonly,separator=%x2C)", "--numstat");
  if (records === null) return null;
  const out = new Map<string, RefsTotals>();
  for (const [when, refs, numstat] of records) {
    const ids = refs.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (ids.length === 0) continue;
    let lines = 0;
    const files: string[] = [];
    for (const row of numstat.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row);
      if (!m) continue;
      if (m[1] !== "-") lines += Number(m[1]) + Number(m[2]);
      files.push(...renamePaths(m[3]!));
    }
    for (const id of ids) {
      const cur = out.get(id) ?? noRefs();
      cur.lines += lines;
      for (const f of files) cur.files.add(f);
      cur.last = Math.max(cur.last, when);
      out.set(id, cur);
    }
  }
  return out;
}

function collectRuns(projectRoot: string): Run[] {
  // Index the ledger once by claiming FR instead of filtering it per FR.
  const byFr = new Map<string, ReturnType<typeof readLedgerRows>>();
  for (const r of readLedgerRows(projectRoot)) {
    const by = (r as { claimed_by?: unknown }).claimed_by;
    if (typeof by === "string") byFr.set(by, [...(byFr.get(by) ?? []), r]);
  }
  const commits = refsCommits(projectRoot);
  const runs: Run[] = [];
  for (const fr of archivedFrs(projectRoot)) {
    const claimed = byFr.get(fr.id) ?? [];
    if (claimed.length === 0) continue;
    const skill = String((claimed[0] as { skill?: unknown }).skill ?? "unknown");
    const sessions = [...new Set(claimed.map((r) => r.session_id).filter((s): s is string => typeof s === "string"))];
    const c = commits?.get(fr.id) ?? noRefs();
    const outputTokens = claimed.reduce((n, r) => n + (typeof r.output_tokens === "number" ? r.output_tokens : 0), 0);
    runs.push({ id: fr.id, sized: commits !== null, skill, category: fr.category, lines: c.lines, lastCommitAt: c.last, files: [...c.files], sessions, outputTokens });
  }
  return runs;
}

interface Commit {
  when: number;
  message: string;
  files: string[];
}

/** Every commit with its full message and touched files, or `null` when git cannot be read. */
function allCommits(projectRoot: string): Commit[] | null {
  const records = gitLogRecords(projectRoot, "%B", "--name-only");
  if (records === null) return null;
  return records.map(([when, message, names]) => ({
    when,
    message,
    files: names.split("\n").map((s) => s.trim()).filter((s) => s !== ""),
  }));
}

/** The window a commit counts as a post-merge fix of an FR. */
const POST_MERGE_WINDOW_MS = 14 * 86_400_000;
const FIX_SUBJECT_RE = /^fix(\([^)]*\))?!?:/;

/**
 * True when the message names `id` as a whole id (STE-1 is not named by STE-10),
 * bare or as an AC citation `AC-<id>.<n>` (AC-STE-784.5).
 */
function namesId(message: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:(?<![A-Za-z0-9_-])|(?<=(?<![A-Za-z0-9_-])AC-))${escaped}(?![A-Za-z0-9_])`).test(message);
}

/**
 * `fix` commits within 14 days after the run's last commit, touching its files,
 * not naming it — or `null` when that is not observable: the run has no `Refs:`
 * commit to measure from, or git could not be read.
 */
function postMergeFixes(run: Run, commits: Commit[] | null): number | null {
  if (commits === null || run.lastCommitAt === 0) return null;
  const files = new Set(run.files);
  return commits.filter(
    (c) =>
      FIX_SUBJECT_RE.test(c.message) &&
      c.when > run.lastCommitAt &&
      c.when - run.lastCommitAt <= POST_MERGE_WINDOW_MS &&
      !namesId(c.message, run.id) &&
      c.files.some((f) => files.has(f)),
  ).length;
}

/** One session's `review-findings` receipts' evidence. */
function reviewFindings(projectRoot: string, session: string): { reviewer?: unknown; frs?: unknown; counts?: unknown }[] {
  try {
    return readSessionReceipts(projectRoot, session)
      .receipts.filter((r) => r.kind === REVIEW_FINDINGS_KIND)
      .map((r) => (r.evidence ?? {}) as { reviewer?: unknown; frs?: unknown; counts?: unknown });
  } catch {
    return [];
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The four pooled quality signals over a group's window. */
function signalValues(projectRoot: string, window: Run[], commits: Commit[] | null): Record<string, number | null> {
  let pass = 0;
  let fail = 0;
  let gaps = 0;
  let concerns = 0;
  let lines = 0;
  let sawSpecReview = false;
  let sawCodeReview = false;
  let fixes: number | null = 0;
  const ids = new Set(window.map((r) => r.id));
  // A session several runs share counts its gate runs and code-review receipts once (AC-STE-784.3).
  const seen = new Set<string>();
  for (const run of window) {
    for (const s of run.sessions) {
      const first = !seen.has(s);
      seen.add(s);
      if (first) {
        for (const g of gateRuns(readTimeline(projectRoot, s))) {
          if (g.outcome === "pass") pass++;
          else if (g.outcome === "fail") fail++;
        }
      }
      for (const ev of reviewFindings(projectRoot, s)) {
        const counts = (ev.counts ?? {}) as Record<string, unknown>;
        if (ev.reviewer === "spec-review") {
          sawSpecReview = true;
          const row = counts[run.id] as { partial?: unknown; missing?: unknown } | undefined;
          if (row) gaps += num(row.partial) + num(row.missing);
        } else if (ev.reviewer === "code-review") {
          sawCodeReview = true;
          // A receipt naming no FR (a rubric pass, AC-STE-774.2) joins the window by session.
          const named = !Array.isArray(ev.frs) || ev.frs.length === 0 || ev.frs.some((f) => ids.has(f as string));
          if (first && named) concerns += num(counts.concerns);
        }
      }
    }
    lines += run.lines;
    // One unobservable run makes the pooled count unobservable, never a smaller number.
    const f = postMergeFixes(run, commits);
    fixes = fixes === null || f === null ? null : fixes + f;
  }
  return {
    gate_failure_rate: pass + fail > 0 ? fail / (pass + fail) : null,
    // No receipt of a kind in the window is not observable, never 0 (AC-STE-784.2).
    spec_review_gaps_per_fr: sawSpecReview && window.length > 0 ? gaps / window.length : null,
    code_review_concerns_per_100_lines: sawCodeReview && lines > 0 ? (100 * concerns) / lines : null,
    post_merge_fixes: fixes,
  };
}

/** A timeline's `gate_runs` rows, or `[]` when it has none. */
function gateRuns(timeline: unknown): Record<string, unknown>[] {
  const runs = (timeline as { gate_runs?: unknown } | null)?.gate_runs;
  return Array.isArray(runs) ? (runs as Record<string, unknown>[]) : [];
}

const timelineCache = new Map<string, unknown | null>();

/** A session's timeline, read and parsed once per report build (see buildTrendReport). */
function readTimeline(projectRoot: string, session: string): unknown | null {
  const key = `${projectRoot}\0${session}`;
  if (timelineCache.has(key)) return timelineCache.get(key)!;
  const value = readTimelineUncached(projectRoot, session);
  timelineCache.set(key, value);
  return value;
}

function readTimelineUncached(projectRoot: string, session: string): unknown | null {
  const p = toolCallTimelinePath(projectRoot, session);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** The value one single-run retro rule reports over a run's sessions, or null when not observable. */
function ruleValue(inputs: RetroInputs, id: string): number | null {
  const rule = RETRO_RULES.find((r) => r.id === id);
  if (rule === undefined) return null;
  const [res] = evaluateRetroRules(inputs, [rule]);
  return res && res.disposition !== "skipped: input not observable" ? res.value : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Per-run waste / tokens / time (null = not observable for that run). */
function runValues(projectRoot: string, run: Run): Record<RetroMetric, number | null> {
  const inputs: RetroInputs = {
    sessions: run.sessions.map((s) => ({ session_id: s, timeline: readTimeline(projectRoot, s), capture_rows: [] })),
    token_rows: [],
    tracking: { token_stats: true, tool_calls: true, gate_outcomes: true },
  };
  const reruns = ruleValue(inputs, "gate_rerun_unchanged_key");
  const zeroYield = ruleValue(inputs, "zero_yield_round");
  // Both halves must be observable: one unmeasured half is not 0 (AC-STE-776.5).
  const waste = reruns === null || zeroYield === null ? null : reruns + zeroYield;
  const walls = inputs.sessions
    .flatMap((s) => gateRuns(s.timeline))
    .filter((g) => (g.outcome === "pass" || g.outcome === "fail") && typeof g.wall_ms === "number")
    .map((g) => g.wall_ms as number);
  return {
    waste,
    tokens: run.lines > 0 ? run.outputTokens / run.lines : null,
    time: median(walls),
  };
}

const emptyMetric = (id: RetroMetric, note: string) => ({ id, median: null, delta: null, note });

/** Window median and newer-half minus older-half delta of one metric. */
function metricCell(id: RetroMetric, values: (number | null)[]) {
  const vals = values.filter((v): v is number => v !== null);
  const half = Math.floor(values.length / 2);
  const older = values.slice(0, half).filter((v): v is number => v !== null);
  const newer = values.slice(values.length - half).filter((v): v is number => v !== null);
  const m = median(vals);
  const o = median(older);
  const n = median(newer);
  if (m === null || o === null || n === null) return emptyMetric(id, "skipped: not observable");
  return { id, median: m, delta: n - o, note: null };
}

type TrackingKey = "token_stats" | "gate_outcomes" | "tool_calls" | "review_findings";

/** The tracking keys whose input each metric and signal reads (AC-STE-784.4: time and gate_failure_rate need both). */
const INPUT_KEY: Record<string, TrackingKey[] | undefined> = {
  waste: ["tool_calls"],
  tokens: ["token_stats"],
  time: ["gate_outcomes", "tool_calls"],
  gate_failure_rate: ["gate_outcomes", "tool_calls"],
  spec_review_gaps_per_fr: ["review_findings"],
  code_review_concerns_per_100_lines: ["review_findings"],
};

/** The tracking keys that are off; an unreadable settings file leaves every key off. */
function trackingOff(projectRoot: string): Set<TrackingKey> {
  let tr: Record<string, { enabled?: boolean } | undefined> = {};
  try {
    tr = (loadProjectSection(projectRoot, "tracking") ?? {}) as typeof tr;
  } catch {
    // every switch off
  }
  const keys: TrackingKey[] = ["token_stats", "gate_outcomes", "tool_calls", "review_findings"];
  return new Set(keys.filter((k) => tr[k]?.enabled !== true));
}

/** `skipped: not observable (tracking.<key> is off)` naming every off key the cell reads, else null. */
function offNote(off: Set<TrackingKey>, id: string): string | null {
  const keys = (INPUT_KEY[id] ?? []).filter((k) => off.has(k)).map((k) => `tracking.${k}`);
  if (keys.length === 0) return null;
  return `skipped: not observable (${keys.join(" and ")} ${keys.length === 1 ? "is" : "are"} off)`;
}

/** The `retro.priority` order; a loader refusal propagates (NFR-10), never a silent default. */
function priorityOf(projectRoot: string): RetroMetric[] {
  return [...(loadProjectSection(projectRoot, "retro")?.priority ?? DEFAULT_RETRO_PRIORITY)];
}

export function buildTrendReport(projectRoot: string, last: number) {
  // The timeline cache lives for one report: a later report reads fresh timelines.
  timelineCache.clear();
  const priority = priorityOf(projectRoot);
  const off = trackingOff(projectRoot);
  const byGroup = new Map<string, Run[]>();
  for (const run of collectRuns(projectRoot)) {
    const key = `${run.skill}\0${run.category}\0${run.sized ? sizeBucket(run.lines) : "unknown"}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), run]);
  }
  const commits = allCommits(projectRoot);
  const sessionIds: string[] = [];
  const seenSessions = new Set<string>();
  const aliases = createAliasMap();
  const groups = [...byGroup.entries()].map(([key, all]) => {
    const [skill, category, size] = key.split("\0");
    const window = [...all].sort((a, b) => a.lastCommitAt - b.lastCommitAt).slice(-last);
    for (const r of window) for (const s of r.sessions) if (!seenSessions.has(s)) (seenSessions.add(s), sessionIds.push(s));
    const note = window.length < TREND_MIN_RUNS ? `insufficient: ${window.length} runs` : null;
    const values = note === null ? signalValues(projectRoot, window, commits) : null;
    const perRun = note === null ? window.map((r) => runValues(projectRoot, r)) : [];
    return {
      skill,
      category,
      size,
      runs: window.length,
      metrics: priority.map((id) => {
        if (note !== null) return emptyMetric(id, note);
        const skipped = offNote(off, id);
        if (skipped !== null) return emptyMetric(id, skipped);
        return metricCell(id, perRun.map((v) => v[id]));
      }),
      signals: ["gate_failure_rate", "spec_review_gaps_per_fr", "code_review_concerns_per_100_lines", "post_merge_fixes"].map((id) => {
        if (values === null) return { id, value: null, note };
        const skipped = offNote(off, id);
        if (skipped !== null) return { id, value: null, note: skipped };
        const value = values[id] ?? null;
        return value === null ? { id, value: null, note: "skipped: not observable" } : { id, value, note: null };
      }),
    };
  });
  // Worst first by the first-ranked metric's delta; a null delta (insufficient / skipped) sorts
  // after a number, and a null on both sides falls through to the next ranked metric.
  groups.sort((a, b) => {
    for (let i = 0; i < priority.length; i++) {
      const da = a.metrics[i]?.delta ?? null;
      const db = b.metrics[i]?.delta ?? null;
      if (da === null && db === null) continue;
      if (da === null) return 1;
      if (db === null) return -1;
      return da === db ? 0 : db > da ? 1 : -1;
    }
    return 0;
  });
  return { schema: TREND_SCHEMA, last, priority, sessions: sessionIds.map((s) => ({ alias: aliasFor(aliases, s), digest: sessionDigest(s) })), groups };
}

export function runTrend(projectRoot: string, args: string[], now: Date = new Date()): { path: string } {
  const { last } = parseTrendArgs(args);
  const report = buildTrendReport(projectRoot, last);
  const dir = retroReportsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  const path = join(dir, `trend-${stamp}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  return { path };
}

/** Shared CLI body: prints `{ report }` or the refusal; returns the exit code. */
export function trendMain(rootArg: string, args: string[]): number {
  try {
    const { path } = runTrend(resolve(rootArg), args);
    process.stdout.write(JSON.stringify({ report: path }) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const [rootArg, ...rest] = process.argv.slice(2);
  if (rootArg === undefined || rootArg.trim() === "") {
    process.stderr.write("usage: bun run retro_trend.ts <projectRoot> [--last N]\n");
    process.exit(2);
  }
  process.exit(trendMain(rootArg, rest));
}

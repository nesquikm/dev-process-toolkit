// STE-776 (M_4daa6e) — a retrospective across runs.
//
//   bun run adapters/_shared/src/retro.ts <projectRoot> --trend [--last N]
//   bun run adapters/_shared/src/retro_trend.ts <projectRoot> [--last N]
//
// A run is one archived FR with token-ledger rows claimed by its id. Runs are
// grouped by (skill, changelog_category, size bucket) and each group keeps its
// newest N runs. Writes exactly one file:
// `.dpt/ledger/retro/trend-<UTC yyyymmddThhmmssZ>.json` (schema `dpt-retro-trend/2`).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { retroReportsDir, toolCallTimelinePath } from "./dpt_paths";
import { parseFrontmatter } from "./frontmatter";
import { DEFAULT_RETRO_PRIORITY, loadProjectSection, type RetroMetric } from "./project_settings";
import { RETRO_RULES, evaluateRetroRules, type RetroInputs } from "./retro_rules";
import { REVIEW_FINDINGS_KIND } from "./review_findings_receipt";
import { aliasFor, createAliasMap, sessionDigest } from "./session_aliases";
import { readRunStarts, type RunStartRow } from "./run_start_ledger";
import { readLedgerRows } from "./token_usage";
import { readSessionReceipts } from "./tracker_receipts";

export const TREND_SCHEMA = "dpt-retro-trend/2";
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

export interface Run {
  /** The archived FR id. */
  id: string;
  /** True when any of this skill's claimed rows is an incomplete fork row (`complete: false`). */
  incomplete: boolean;
  /**
   * AC-STE-812.6: "incomplete", "parent-only" (no fork row in any of its sessions) or
   * "parent+fork" (fork capture ran in its sessions). It describes capture, not the sum:
   * a run's tokens are its own skill's rows only, so forked children are runs of their own.
   */
  tokensScope: "incomplete" | "parent-only" | "parent+fork";
  /** False when git could not be read, so the run's size is unknown. */
  sized: boolean;
  skill: string;
  category: string;
  lines: number;
  lastCommitAt: number;
  sessions: string[];
  outputTokens: number;
  /** The STE-810 settings hash this run started under, or "settings unknown" (AC-STE-813.2). */
  settings: string;
  /** Epoch ms of the archive file's `archived_at`; NaN when absent or unreadable. */
  archivedAt: number;
}

/** A frontmatter `archived_at` value as epoch ms, NaN when it is not a date. */
function archivedAtMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return typeof v === "string" ? Date.parse(v) : NaN;
}

function archivedFrs(projectRoot: string): { id: string; category: string; archivedAt: number }[] {
  const dir = join(projectRoot, "specs", "frs", "archive");
  if (!existsSync(dir)) return [];
  const out: { id: string; category: string; archivedAt: number }[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(readFileSync(join(dir, name), "utf-8"), { lenient: true });
    } catch {
      continue;
    }
    out.push({ id: name.slice(0, -3), category: typeof fm.changelog_category === "string" ? fm.changelog_category : "unknown", archivedAt: archivedAtMs(fm.archived_at) });
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
}

const noRefs = (): RefsTotals => ({ lines: 0, last: 0 });

/** Changed lines and last commit time per FR id, from commits whose `Refs:` trailer names it. */
function refsCommits(projectRoot: string): Map<string, RefsTotals> | null {
  const records = gitLogRecords(projectRoot, "%(trailers:key=Refs,valueonly,separator=%x2C)", "--numstat");
  if (records === null) return null;
  const out = new Map<string, RefsTotals>();
  for (const [when, refs, numstat] of records) {
    const ids = refs.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (ids.length === 0) continue;
    let lines = 0;
    for (const row of numstat.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row);
      if (!m) continue;
      if (m[1] !== "-") lines += Number(m[1]) + Number(m[2]);
    }
    for (const id of ids) {
      const cur = out.get(id) ?? noRefs();
      cur.lines += lines;
      cur.last = Math.max(cur.last, when);
      out.set(id, cur);
    }
  }
  return out;
}

export const SETTINGS_UNKNOWN = "settings unknown";

/** The settings hash of the earliest run-start row matching `match`, or null when none does. */
function earliestHash(starts: RunStartRow[], match: (r: RunStartRow) => boolean): string | null {
  // A row whose started_at is not a date has no place in "earliest", so it is no candidate.
  let best: RunStartRow | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const r of starts) {
    const at = Date.parse(r.started_at);
    if (!match(r) || !Number.isFinite(at) || at >= bestAt) continue;
    best = r;
    bestAt = at;
  }
  return best === null ? null : typeof best.settings_hash === "string" ? best.settings_hash : SETTINGS_UNKNOWN;
}

/** AC-STE-813.2: an FR + skill match first, then a session + skill match, else unknown. */
function settingsFor(starts: RunStartRow[], fr: string, skill: string, sessions: string[]): string {
  return (
    earliestHash(starts, (r) => r.skill === skill && r.fr === fr) ??
    // The session fallback takes only rows naming no FR: a row naming another FR is that
    // run's settings, and settings can change between two runs of one session.
    earliestHash(starts, (r) => r.skill === skill && (r.fr === null || r.fr === undefined || r.fr === "") && sessions.includes(r.session_id)) ??
    SETTINGS_UNKNOWN
  );
}

/** AC-STE-813.3: the window's runs per settings value, most runs first, ties by hash. */
function settingsCounts(window: Run[]): { hash: string; runs: number }[] {
  const counts = new Map<string, number>();
  for (const r of window) counts.set(r.settings, (counts.get(r.settings) ?? 0) + 1);
  return [...counts.entries()]
    .map(([hash, runs]) => ({ hash, runs }))
    .sort((a, b) => b.runs - a.runs || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}

/** One run per (archived FR, skill) among the FR's claimed ledger rows (AC-STE-813.1). */
export function collectRuns(projectRoot: string): Run[] {
  // Index the ledger once by claiming FR instead of filtering it per FR.
  const byFr = new Map<string, ReturnType<typeof readLedgerRows>>();
  // Sessions holding any fork row, claimed or not (AC-STE-812.6).
  const forkSessions = new Set<string>();
  for (const r of readLedgerRows(projectRoot)) {
    if ((r as { scope?: unknown }).scope === "fork" && typeof r.session_id === "string") forkSessions.add(r.session_id);
    const by = (r as { claimed_by?: unknown }).claimed_by;
    if (typeof by === "string") byFr.set(by, [...(byFr.get(by) ?? []), r]);
  }
  const commits = refsCommits(projectRoot);
  const runs: Run[] = [];
  const starts = readRunStarts(projectRoot);
  for (const fr of archivedFrs(projectRoot)) {
    const claimed = byFr.get(fr.id) ?? [];
    if (claimed.length === 0) continue;
    const bySkill = new Map<string, typeof claimed>();
    for (const r of claimed) {
      const skill = String((r as { skill?: unknown }).skill ?? "unknown");
      const rows = bySkill.get(skill);
      if (rows) rows.push(r);
      else bySkill.set(skill, [r]);
    }
    // The FR's changed lines are shared by all of its runs.
    const c = commits?.get(fr.id) ?? noRefs();
    for (const [skill, rows] of bySkill) {
      const sessions = [...new Set(rows.map((r) => r.session_id).filter((s): s is string => typeof s === "string"))];
      const outputTokens = rows.reduce((n, r) => n + (typeof r.output_tokens === "number" ? r.output_tokens : 0), 0);
      const incomplete = rows.some((r) => (r as { complete?: unknown }).complete === false);
      const settings = settingsFor(starts, fr.id, skill, sessions);
      const tokensScope = incomplete ? "incomplete" : sessions.some((s) => forkSessions.has(s)) ? "parent+fork" : "parent-only";
      runs.push({ id: fr.id, incomplete, tokensScope, sized: commits !== null, skill, category: fr.category, lines: c.lines, lastCommitAt: c.last, sessions, outputTokens, settings, archivedAt: fr.archivedAt });
    }
  }
  return runs;
}

interface Commit {
  when: number;
  subject: string;
  refs: string[];
}

/** Every commit with its subject and `Refs:` trailer ids, or `null` when git cannot be read. */
function allCommits(projectRoot: string): Commit[] | null {
  const records = gitLogRecords(projectRoot, "%s%x1d%(trailers:key=Refs,valueonly,separator=%x2C)", "HEAD");
  if (records === null) return null;
  return records.map(([when, field]) => {
    const [subject = "", refs = ""] = field.split("\x1d");
    return { when, subject, refs: refs.split(",").map((s) => s.trim()).filter((s) => s !== "") };
  });
}

/** The window, counted from the FR's `archived_at`, in which a commit counts as its post-merge fix. */
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
 * `fix` commits dated after the run's `archived_at` and no more than 14 days
 * after it whose subject or `Refs:` trailer names the run's id (AC-STE-796.1) —
 * or `null` when git could not be read.
 */
function postMergeFixes(run: Run, commits: Commit[] | null): number | null {
  if (commits === null) return null;
  // An `archived_at` that is not a date has no window to count in (AC-STE-796.2).
  if (!Number.isFinite(run.archivedAt)) return null;
  return commits.filter(
    (c) =>
      FIX_SUBJECT_RE.test(c.subject) &&
      c.when > run.archivedAt &&
      c.when - run.archivedAt <= POST_MERGE_WINDOW_MS &&
      (namesId(c.subject, run.id) || c.refs.some((r) => namesId(r, run.id))),
  ).length;
}

/** The subject grammar the `commit-msg` hook enforces (templates/git-hooks/commit-msg.sh). */
const CONVENTIONAL_SUBJECT_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;
const NOT_CONVENTIONAL_WHY = "not observable (history is not Conventional Commits)";
const NOT_CONVENTIONAL_NOTE = `skipped: ${NOT_CONVENTIONAL_WHY}`;

/**
 * False when fewer than half of the commit subjects dated inside the window's
 * fix windows are Conventional Commits (AC-STE-796.3); windows holding no
 * commit at all stay observable.
 */
function conventionalHistory(window: Run[], commits: Commit[] | null): boolean {
  if (commits === null) return true;
  const inside = commits.filter((c) =>
    window.some((r) => Number.isFinite(r.archivedAt) && c.when > r.archivedAt && c.when - r.archivedAt <= POST_MERGE_WINDOW_MS),
  );
  const matched = inside.filter((c) => CONVENTIONAL_SUBJECT_RE.test(c.subject)).length;
  return inside.length === 0 || matched * 2 >= inside.length;
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
function signalValues(
  projectRoot: string,
  window: Run[],
  commits: Commit[] | null,
  // Per-run values (AC-STE-814.3): a spec-review receipt observes a run only when it counts that run's FR.
  perRun = false,
): Record<string, number | null> {
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
          const row = counts[run.id] as { partial?: unknown; missing?: unknown } | undefined;
          if (!perRun || row) sawSpecReview = true;
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

/** Why one run's value `id` has no observable input (AC-STE-814.3). */
function unobservedWhy(id: string, run: Run, commits: Commit[] | null): string {
  switch (id) {
    case "waste":
      return "not observable (no gate run or TDD round recorded)";
    case "tokens":
      return run.incomplete ? "fork tokens incomplete" : "not observable (no changed lines)";
    case "time":
    case "gate_failure_rate":
      return "not observable (no gate run)";
    case "spec_review_gaps_per_fr":
      return "not observable (no spec-review receipt counting this FR)";
    case "code_review_concerns_per_100_lines":
      return run.lines > 0 ? "not observable (no code-review receipt)" : "not observable (no changed lines)";
    case "post_merge_fixes":
      if (commits === null) return "not observable (git history unreadable)";
      if (!conventionalHistory([run], commits)) return NOT_CONVENTIONAL_WHY;
      return "not observable (archived_at is not a date)";
    default:
      return "not observable";
  }
}

/** Per-run waste / tokens / time (null = not observable for that run). */
function runValues(projectRoot: string, run: Run, off: Set<TrackingKey>): Record<RetroMetric, number | null> {
  const inputs: RetroInputs = {
    sessions: run.sessions.map((s) => ({ session_id: s, timeline: readTimeline(projectRoot, s), capture_rows: [] })),
    token_rows: [],
    tracking: { token_stats: !off.has("token_stats"), tool_calls: !off.has("tool_calls"), gate_outcomes: !off.has("gate_outcomes") },
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

/** The tracking keys whose input each metric and signal reads (AC-STE-784.4, AC-STE-796.4: waste, time and gate_failure_rate need both). */
const INPUT_KEY: Record<string, TrackingKey[] | undefined> = {
  waste: ["gate_outcomes", "tool_calls"],
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

/** The off tracking keys among those value `id` reads. */
function offKeysFor(off: Set<TrackingKey>, id: string): TrackingKey[] {
  return (INPUT_KEY[id] ?? []).filter((k) => off.has(k));
}

/** `skipped: not observable (tracking.<key> is off)` naming every off key the cell reads, else null. */
function offNote(off: Set<TrackingKey>, id: string): string | null {
  const keys = offKeysFor(off, id).map((k) => `tracking.${k}`);
  if (keys.length === 0) return null;
  return `skipped: not observable (${keys.join(" and ")} ${keys.length === 1 ? "is" : "are"} off)`;
}

/** The `retro.priority` order; a loader refusal propagates (NFR-10), never a silent default. */
function priorityOf(projectRoot: string): RetroMetric[] {
  return [...(loadProjectSection(projectRoot, "retro")?.priority ?? DEFAULT_RETRO_PRIORITY)];
}

/**
 * One `runs_detail` entry: the run's identity plus its own metrics and signals
 * (AC-STE-814.1), each null with a note when its switch is off (AC-STE-814.2) or
 * its input is not observable (AC-STE-814.3). `own` reuses the group's per-run
 * values when they were already computed.
 */
function runDetail(
  projectRoot: string,
  r: Run,
  off: Set<TrackingKey>,
  commits: Commit[] | null,
  aliases: ReturnType<typeof createAliasMap>,
  own: Record<RetroMetric, number | null> = runValues(projectRoot, r, off),
) {
  // The pooled signals over a one-run window.
  const sig = signalValues(projectRoot, [r], commits, true);
  const notes: string[] = [];
  const gated = (id: string, v: number | null | undefined): number | null => {
    const offKeys = offKeysFor(off, id);
    for (const k of offKeys) notes.push(`${id}: tracking.${k} is off`);
    if (offKeys.length > 0) return null;
    // Never 0 for an unobserved value: null, with a note naming why.
    const value = v ?? null;
    if (value === null) notes.push(`${id}: ${unobservedWhy(id, r, commits)}`);
    return value;
  };
  // An incomplete fork row's token total is parent-only (STE-812): not observable.
  const tokens = r.incomplete ? null : own.tokens;
  const fixes = conventionalHistory([r], commits) ? sig.post_merge_fixes : null;
  return {
    fr: r.id,
    skill: r.skill,
    settings: r.settings,
    tokens_scope: r.tokensScope,
    sessions: r.sessions.map((s) => aliasFor(aliases, s)),
    metrics: { waste: gated("waste", own.waste), tokens: gated("tokens", tokens), time: gated("time", own.time) },
    signals: {
      gate_failure_rate: gated("gate_failure_rate", sig.gate_failure_rate),
      spec_review_gaps_per_fr: gated("spec_review_gaps_per_fr", sig.spec_review_gaps_per_fr),
      code_review_concerns_per_100_lines: gated("code_review_concerns_per_100_lines", sig.code_review_concerns_per_100_lines),
      post_merge_fixes: gated("post_merge_fixes", fixes),
    },
    notes,
  };
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
    const perRun = note === null ? window.map((r) => runValues(projectRoot, r, off)) : [];
    return {
      skill,
      category,
      size,
      runs: window.length,
      runs_detail: window.map((r, i) => runDetail(projectRoot, r, off, commits, aliases, perRun[i])),
      settings: settingsCounts(window),
      metrics: priority.map((id) => {
        if (note !== null) return emptyMetric(id, note);
        const skipped = offNote(off, id);
        if (skipped !== null) return emptyMetric(id, skipped);
        const cell = metricCell(id, perRun.map((v) => v[id]));
        if (id !== "tokens") return cell;
        // AC-STE-812.6: a parent-only or incomplete total is never shown silently.
        const parentOnly = window.filter((r) => r.tokensScope === "parent-only").length;
        const incomplete = window.filter((r) => r.tokensScope === "incomplete").length;
        if (parentOnly === 0 && incomplete === 0) return cell;
        const includes = `includes ${parentOnly} parent-only and ${incomplete} incomplete runs`;
        return { ...cell, note: cell.note === null ? includes : `${cell.note}; ${includes}` };
      }),
      signals: ["gate_failure_rate", "spec_review_gaps_per_fr", "code_review_concerns_per_100_lines", "post_merge_fixes"].map((id) => {
        if (values === null) return { id, value: null, note };
        const skipped = offNote(off, id);
        if (skipped !== null) return { id, value: null, note: skipped };
        if (id === "post_merge_fixes" && !conventionalHistory(window, commits)) return { id, value: null, note: NOT_CONVENTIONAL_NOTE };
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

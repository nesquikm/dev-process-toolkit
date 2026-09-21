// live_proof_gate — STE-618.
//
// The shared-tracker programme's release waits for a passing live proof. The
// milestone plan carries a `### Live proof` table, one row per tracker
// (`jira`, `linear`): the committed evidence bundle's path under
// `plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/`, the run
// date, the run nonce, the tracker spaces (`Spaces`: the Jira project keys,
// or the Linear team key) and the bundle's content hash (`bundleHash`, the
// grader's ONE definition, over exactly `bundle.json` and `verdict.json`, as
// `grade` printed it). This module finds
// the plan, parses that table and grades each tracker's bundle AGAIN through
// the live grader's `gradeBundle` — the outcome recorded in the bundle's
// `verdict.json` is compared with the re-grade, never read as the answer: any
// disagreement between the two is `recorded-verdict-disagrees`, and a tracker
// passes only when both read `pass`. A row is graded only against a bundle of
// its own tracker (`tracker-mismatch` otherwise).
//
// Blocking rides on refusals `/ship-milestone` already runs: the synthetic and
// real-plan suites call this gate, a red suite fails refusal #3, and this FR
// cannot close (refusal #1) while its suite is red. No probe id, capability
// key or skill text changes.
//
//   - The plan is resolved at `specs/plan/<M>.md` OR `specs/plan/archive/<M>.md`.
//     Neither → `plan-not-found`; both → `plan-ambiguous`; never picks one.
//   - Exactly one row per tracker. A row whose cells read `pending` is a named
//     state (`pending`), a tracker without a row is `missing-tracker:<t>`,
//     neither is ever a pass.
//   - `shipped_in: null` is pre-release mode; a stamp is post-release mode
//     only when CHANGELOG.md carries its release heading AND it is strictly
//     newer than the plugin version every bundle recorded at its run.
//
// Siblings (AC-STE-618.10): each property P the gate enforces has exactly one
// switch, set to true between its begin and end marker in the PROPERTY block
// below. The falsifiability suite flips one switch in a scratch copy and
// measures that copy give the opposite verdict. A property's logic reads only
// its own switch.
//
// Front door (read-only, no network):
//   bun run adapters/_shared/src/live_proof_gate.ts <repoRoot> <planPath>
// prints `mode=<mode>` and one `<tracker> pass|fail ...` line per tracker on
// stdout; exits 0 only when both pass, else 1 with the three-line NFR-10
// refusal on stderr (2 on a usage error).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { BUNDLE_FILE, behaviourDigest, bundleHash, gradeBundle, VERDICT_FILE, type BehaviourDigestResult, type LiveBundle, type LiveVerdict } from "./shared_tracker_live_grader";

// ---------------------------------------------------------------------------
// property switches (AC-STE-618.10) — one `= true;` per region, nothing else
// ---------------------------------------------------------------------------

export type LiveProofProperty =
  | "regrade"
  | "freshness"
  | "tracked-only"
  | "bundle-hash"
  | "registry-set"
  | "row-required"
  | "stamp-release"
  | "live-only"
  | "jira-repoint";

const PROPERTY = {} as Record<LiveProofProperty, boolean>;
// @property-begin regrade
PROPERTY.regrade = true;
// @property-end regrade
// @property-begin freshness
PROPERTY.freshness = true;
// @property-end freshness
// @property-begin tracked-only
PROPERTY["tracked-only"] = true;
// @property-end tracked-only
// @property-begin bundle-hash
PROPERTY["bundle-hash"] = true;
// @property-end bundle-hash
// @property-begin registry-set
PROPERTY["registry-set"] = true;
// @property-end registry-set
// @property-begin row-required
PROPERTY["row-required"] = true;
// @property-end row-required
// @property-begin stamp-release
PROPERTY["stamp-release"] = true;
// @property-end stamp-release
// @property-begin live-only
PROPERTY["live-only"] = true;
// @property-end live-only
// @property-begin jira-repoint
PROPERTY["jira-repoint"] = true;
// @property-end jira-repoint

// ---------------------------------------------------------------------------
// constants and result shapes
// ---------------------------------------------------------------------------

export const LIVE_PROOF_TRACKERS = ["jira", "linear"] as const;
export type LiveProofTracker = (typeof LIVE_PROOF_TRACKERS)[number];

export const PLUGIN_REL = "plugins/dev-process-toolkit";
export const BUNDLE_BASE = `${PLUGIN_REL}/tests/fixtures/shared-tracker-live/`;
/** The recorded verdict the grader's `grade` (the smoke skill's Phase 6) writes beside `bundle.json`; defined once, in the grader. */
export { VERDICT_FILE };
export const LIVE_PROOF_HEADING = "Live proof";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/;
const HASH_RE = /^[0-9a-f]{64}$/;
const BUNDLE_PATH_RE = new RegExp(`^${escapeRegex(BUNDLE_BASE)}(?!\\.\\.?/?$)[^/\\s]+/?$`);

export type LiveProofMode = "pre-release" | "post-release" | "stamp-without-release";

export interface TrackerResult {
  outcome: "pass" | "fail";
  reason: string;
  detail?: string;
}

export interface LiveProofResult {
  verdict: "pass" | "fail";
  mode: LiveProofMode | null;
  reason: string | null;
  detail?: string;
  plan?: string;
  trackers: Record<LiveProofTracker, TrackerResult>;
}

export interface LiveProofRow {
  tracker: string;
  bundle: string;
  date: string;
  nonce: string;
  spaces: string;
  hash: string;
}

const pass = (): TrackerResult => ({ outcome: "pass", reason: "pass" });
const fail = (reason: string, detail?: string): TrackerResult => (detail === undefined ? { outcome: "fail", reason } : { outcome: "fail", reason, detail });

function planLevelFail(reason: string, detail: string, mode: LiveProofMode | null = null, plan?: string): LiveProofResult {
  const t = fail(reason, detail);
  return { verdict: "fail", mode, reason, detail, ...(plan ? { plan } : {}), trackers: { jira: { ...t }, linear: { ...t } } };
}

// ---------------------------------------------------------------------------
// plan resolution
// ---------------------------------------------------------------------------

export type PlanResolution =
  | { ok: true; rel: string; abs: string }
  | { ok: false; reason: "plan-not-found" | "plan-ambiguous"; detail: string };

/**
 * Resolve `planPath` (repo-relative, spelled at either path) to the one plan
 * that exists at `specs/plan/<M>.md` or `specs/plan/archive/<M>.md`.
 */
export function resolvePlan(repoRoot: string, planPath: string): PlanResolution {
  const name = basename(planPath);
  const active = `specs/plan/${name}`;
  const archived = `specs/plan/archive/${name}`;
  const isFile = (rel: string) => {
    try {
      return statSync(join(repoRoot, rel)).isFile();
    } catch {
      return false;
    }
  };
  const a = isFile(active);
  const b = isFile(archived);
  if (a && b) return { ok: false, reason: "plan-ambiguous", detail: `the plan exists at both ${active} and ${archived}; the gate never picks one` };
  if (!a && !b) return { ok: false, reason: "plan-not-found", detail: `no plan at ${active} or ${archived}` };
  const rel = a ? active : archived;
  return { ok: true, rel, abs: join(repoRoot, rel) };
}

// ---------------------------------------------------------------------------
// the `### Live proof` table
// ---------------------------------------------------------------------------

const COLUMNS: Record<keyof LiveProofRow, string> = {
  tracker: "tracker",
  bundle: "bundle",
  date: "run date",
  nonce: "nonce",
  spaces: "spaces",
  hash: "bundle hash",
};

export type LiveProofTable =
  | { found: false }
  | { found: true; ok: false; detail: string }
  | { found: true; ok: true; rows: LiveProofRow[] };

/** Parse the `### Live proof` section's table; columns are matched by header name. */
export function parseLiveProofTable(planText: string): LiveProofTable {
  const lines = planText.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => new RegExp(`^###\\s+${LIVE_PROOF_HEADING}\\s*$`).test(l));
  if (at < 0) return { found: false };
  const table: string[][] = [];
  for (let i = at + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]!); i++) {
    const l = lines[i]!.trim();
    if (!l.startsWith("|") || /^\|[\s|:-]+\|$/.test(l)) continue;
    table.push(l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  }
  const [header, ...body] = table;
  if (!header) return { found: true, ok: false, detail: "the Live proof section holds no table" };
  const index = {} as Record<keyof LiveProofRow, number>;
  for (const [k, name] of Object.entries(COLUMNS) as Array<[keyof LiveProofRow, string]>) {
    const i = header.findIndex((h) => h.toLowerCase() === name);
    if (i < 0) return { found: true, ok: false, detail: `the Live proof table has no "${name}" column` };
    index[k] = i;
  }
  const rows = body.map((cells) => {
    const r = {} as LiveProofRow;
    for (const k of Object.keys(index) as Array<keyof LiveProofRow>) r[k] = cells[index[k]] ?? "";
    return r;
  });
  return { found: true, ok: true, rows };
}

/** The plan frontmatter's `shipped_in` value; null for the `null` sentinel or no field. */
export function shippedInOf(planText: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(planText);
  const m = fm ? /^shipped_in:\s*(.*)$/m.exec(fm[1]!) : null;
  const v = m ? m[1]!.trim().replace(/^["']|["']$/g, "") : "";
  return v === "" || v === "null" || v === "~" ? null : v;
}

/** Does the repository CHANGELOG.md carry a release heading (`## [X.Y.Z]`) for the `shipped_in` stamp? */
export function changelogHasRelease(repoRoot: string, stamp: string): boolean {
  const version = stamp.replace(/^v/, "");
  let text: string;
  try {
    text = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf-8");
  } catch {
    return false;
  }
  return new RegExp(`^##\\s+\\[v?${escapeRegex(version)}\\]`, "m").test(text);
}

/** `X.Y.Z` (an optional leading `v`) as numbers; null when it is not that shape. */
function semver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Is `a` strictly newer than `b`? Both must be `X.Y.Z`; anything else is not newer. */
function newerThan(a: string, b: string): boolean {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

/**
 * The plugin versions the rows' bundles recorded at their runs
 * (`run.pluginVersion`) that the stamp is NOT strictly newer than. A row that
 * is pending, malformed or whose bundle cannot be read is skipped here: its
 * own row grading fails it.
 */
function versionsNotBeforeStamp(repoRoot: string, rows: LiveProofRow[], stamp: string): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (isPending(r) || rowShape(r) !== null) continue;
    let recorded: unknown;
    try {
      recorded = (JSON.parse(readFileSync(join(repoRoot, r.bundle, BUNDLE_FILE), "utf-8")) as LiveBundle)?.run?.pluginVersion;
    } catch {
      continue;
    }
    const v = typeof recorded === "string" ? recorded : String(recorded);
    if (!newerThan(stamp, v)) out.push(`${r.tracker} recorded ${v}`);
  }
  return out;
}

/** A row's value cells — every column but `tracker`; `pending` in any of them marks the row pending. */
const valueCells = (r: LiveProofRow): string[] => [r.bundle, r.date, r.nonce, r.spaces, r.hash];
const isPending = (r: LiveProofRow) => valueCells(r).some((c) => c.toLowerCase() === "pending");

/** Row shape (AC-STE-618.1): bundle path, run date, hash, and non-empty nonce and spaces cells. */
function rowShape(r: LiveProofRow): string | null {
  if (!BUNDLE_PATH_RE.test(r.bundle)) return `bundle path ${r.bundle} is not a directory under ${BUNDLE_BASE}`;
  if (!DATE_RE.test(r.date)) return `run date ${r.date} is not shaped 20YY-MM-DD`;
  if (!HASH_RE.test(r.hash)) return `bundle hash ${r.hash} is not 64 lowercase hex`;
  if (r.nonce === "") return "the nonce cell is empty";
  if (r.spaces === "") return "the spaces cell is empty";
  return null;
}

// ---------------------------------------------------------------------------
// freshness (AC-STE-618.5)
// ---------------------------------------------------------------------------

/** Every file on disk under `dir` (plugin-relative), `.git` excluded — the tracked-only sibling's list. */
function filesOnDisk(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(relative(dir, abs));
    }
  };
  walk(dir);
  return out;
}

/** The working tree's behaviour digest through the grader's ONE definition. */
function workingTreeDigest(repoRoot: string): BehaviourDigestResult {
  const plugin = join(repoRoot, PLUGIN_REL);
  if (PROPERTY["tracked-only"]) return behaviourDigest(plugin);
  let all: string[];
  try {
    all = filesOnDisk(plugin);
  } catch (e) {
    return { ok: false, reason: "digest-unavailable", message: `${plugin} cannot be listed: ${(e as Error).message}` };
  }
  return behaviourDigest(plugin, { trackedFiles: all });
}

/** Added, removed and changed paths between the recorded per-file map and the tree's. */
function digestDelta(recorded: Record<string, string>, now: Record<string, string>): { added: string[]; removed: string[]; changed: string[] } {
  const added = Object.keys(now).filter((p) => !(p in recorded)).sort();
  const removed = Object.keys(recorded).filter((p) => !(p in now)).sort();
  const changed = Object.keys(now).filter((p) => p in recorded && recorded[p] !== now[p]).sort();
  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// grading one tracker
// ---------------------------------------------------------------------------

interface TrackerContext {
  repoRoot: string;
  mode: LiveProofMode;
  /** The working tree's behaviour digest, taken once; null when freshness is not asserted. */
  digestNow: BehaviourDigestResult | null;
}

/** The re-grade's outcome restricted to the scenario ids in `scope` (post-release: the recorded set). */
function outcomeOn(v: LiveVerdict, scope: readonly string[]): string {
  if (v.findings.length > 0) return v.outcome;
  const failed = scope.some((id) => {
    const s = v.scenarios[id];
    return !s || s.outcome === "fail" || s.outcome === "not-observed";
  });
  return failed ? "fail" : "pass";
}

/**
 * Item keys whose space prefix is not among the row's `Spaces`. Jira: every
 * item but projects (issues and Epic milestones carry `KEY-N`). Linear: every
 * issue (`TEAM-N`); projects and milestones carry names and ids, not team keys.
 */
function keysOutside(t: LiveProofTracker, b: LiveBundle, spacesCell: string): string[] {
  const spaces = new Set(spacesCell.split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase()));
  const out = new Set<string>();
  for (const s of b.sessions ?? []) {
    for (const c of s.calls ?? []) {
      for (const i of c.result?.items ?? []) {
        if (i.kind === "project" || (t === "linear" && i.kind !== "issue")) continue;
        const m = /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(i.key);
        if (!m || !spaces.has(m[1]!.toUpperCase())) out.add(i.key);
      }
    }
  }
  return [...out].sort();
}

function gradeRow(t: LiveProofTracker, rows: LiveProofRow[], ctx: TrackerContext): TrackerResult {
  const mine = rows.filter((r) => r.tracker.toLowerCase() === t);
  if (mine.length > 1) return fail(`duplicate-tracker:${t}`, `the Live proof table carries ${mine.length} ${t} rows, not exactly one`);
  const row = mine[0];
  if (!row) return PROPERTY["row-required"] ? fail(`missing-tracker:${t}`, `the Live proof table has no ${t} row`) : pass();
  if (isPending(row)) return PROPERTY["row-required"] ? fail("pending", `the ${t} row reads pending: no live run is recorded yet`) : pass();
  const shape = rowShape(row);
  if (shape !== null) return fail("row-malformed", `the ${t} row: ${shape}`);

  const dir = join(ctx.repoRoot, row.bundle);
  let bundleText: string;
  let verdictText: string;
  try {
    bundleText = readFileSync(join(dir, BUNDLE_FILE), "utf-8");
    verdictText = readFileSync(join(dir, VERDICT_FILE), "utf-8");
  } catch (e) {
    return fail("bundle-unreadable", `${row.bundle}: ${(e as Error).message}`);
  }
  let bundle: LiveBundle;
  let recorded: LiveVerdict;
  try {
    bundle = JSON.parse(bundleText) as LiveBundle;
    recorded = JSON.parse(verdictText) as LiveVerdict;
    if (!bundle || typeof bundle !== "object" || !bundle.run || typeof bundle.run !== "object") throw new Error("no run metadata");
  } catch (e) {
    return fail("bundle-malformed", `${row.bundle}: ${(e as Error).message}`);
  }
  // Tracker identity: the row is graded only against its own tracker's bundle,
  // so a row pointed at the other tracker's bundle cannot borrow its pass and
  // skip the checks that belong to this tracker.
  const verdictTracker = recorded && typeof recorded === "object" && "tracker" in recorded ? recorded.tracker : undefined;
  if (bundle.run.tracker !== t || (verdictTracker !== undefined && verdictTracker !== t)) {
    return fail("tracker-mismatch", `the ${t} row points at ${row.bundle}, whose bundle records tracker ${String(bundle.run.tracker)}${verdictTracker !== undefined ? ` and whose verdict records tracker ${String(verdictTracker)}` : ""}`);
  }
  // Empty: zero scenario records — in verdict.json, or zero sessions in
  // bundle.json — is named before any later check can claim it.
  if (!recorded || typeof recorded !== "object" || Object.keys(recorded.scenarios ?? {}).length === 0) {
    return fail("bundle-empty", `${row.bundle} holds zero scenario records in ${VERDICT_FILE}`);
  }
  if (!Array.isArray(bundle.sessions) || bundle.sessions.length === 0) {
    return fail("bundle-empty", `${row.bundle} holds zero sessions in ${BUNDLE_FILE}`);
  }

  // Not live: a synthetic stamp, or an item key outside the row's spaces.
  if (PROPERTY["live-only"]) {
    if (bundle.synthetic !== false) return fail("not-live", `${row.bundle} carries the synthetic stamp: a test fixture is not a live run`);
    const outside = keysOutside(t, bundle, row.spaces);
    if (outside.length > 0) return fail("not-live", `${row.bundle} holds ${t} item keys outside the row's spaces (${row.spaces}): ${outside.slice(0, 5).join(", ")}`);
  }
  if (PROPERTY["bundle-hash"]) {
    if (bundle.run.nonce !== row.nonce) return fail("nonce-mismatch", `${row.bundle} records nonce ${bundle.run.nonce}, not the plan row's ${row.nonce}`);
  }

  // Freshness: pre-release only; the digest the run recorded must equal the tree's.
  if (PROPERTY.freshness && ctx.mode === "pre-release") {
    const now = ctx.digestNow;
    if (!now || !now.ok) return fail("digest-unavailable", now && !now.ok ? now.message : "the working tree's behaviour digest was not taken");
    const rec = bundle.run.behaviourDigest;
    if (!rec || rec.digest !== now.digest) {
      const d = digestDelta(rec?.files ?? {}, now.files);
      return fail(
        "stale-proof",
        `${row.bundle} was recorded against behaviour digest ${rec?.digest ?? "none"}, the tree is ${now.digest} — added ${d.added.join(", ") || "none"}; removed ${d.removed.join(", ") || "none"}; changed ${d.changed.join(", ") || "none"}`,
      );
    }
  }

  // Re-grade, never trust. The digest the run recorded is passed as "now":
  // freshness is judged by the gate separately, so the re-grade answers only
  // "did this run pass".
  const regraded = gradeBundle(bundle, { behaviourDigestNow: bundle.run.behaviourDigest?.digest ?? "" });
  const recordedIds = Object.keys(recorded.scenarios).sort();
  let scope: string[] | null = null;
  if (PROPERTY["registry-set"]) {
    if (ctx.mode === "pre-release") {
      const current = Object.keys(regraded.scenarios).sort();
      const added = current.filter((id) => !recordedIds.includes(id));
      const removed = recordedIds.filter((id) => !current.includes(id));
      if (added.length > 0 || removed.length > 0) {
        return fail("registry-changed", `${row.bundle}: the registry's applicable set differs from the recorded one — added ${added.join(", ") || "none"}; removed ${removed.join(", ") || "none"}`);
      }
    } else {
      scope = recordedIds;
    }
  }
  const regradedOutcome = scope === null ? regraded.outcome : outcomeOn(regraded, scope);
  // The recorded outcome is compared with the re-grade in both directions, and
  // a tracker passes only when both read pass.
  if (PROPERTY.regrade && recorded.outcome !== regradedOutcome) {
    return fail("recorded-verdict-disagrees", `${row.bundle} records ${String(recorded.outcome)} but re-grades ${regradedOutcome}`);
  }
  const outcome = PROPERTY.regrade ? regradedOutcome : recorded.outcome;
  if (outcome !== "pass") return fail("regrade-not-pass", `${row.bundle} re-grades ${regradedOutcome}`);
  // The Jira repoint (S8) must have passed on the re-grade: a named skip, or
  // no S8 record at all, is not a proven repoint. Linear is never asked.
  if (PROPERTY["jira-repoint"] && t === "jira") {
    const s8 = regraded.scenarios.S8;
    if (!s8 || s8.outcome !== "pass") {
      return fail("jira-repoint-not-proven", `${row.bundle}: S8 (the Jira repoint) re-grades ${s8 ? `${s8.outcome}${s8.reason ? ` (${s8.reason})` : ""}` : "absent"}, not pass`);
    }
  }
  if (PROPERTY["bundle-hash"]) {
    const now = bundleHash(dir);
    if (now !== row.hash) return fail("bundle-altered", `${row.bundle} hashes ${now}, not the plan row's ${row.hash}`);
  }
  return pass();
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

export function gradeLiveProof(o: { repoRoot: string; planPath?: string }): LiveProofResult {
  const repoRoot = resolve(o.repoRoot);
  if (!o.planPath) return planLevelFail("plan-not-found", "no plan path was given");
  const found = resolvePlan(repoRoot, o.planPath);
  if (!found.ok) return planLevelFail(found.reason, found.detail);
  let text: string;
  try {
    text = readFileSync(found.abs, "utf-8");
  } catch (e) {
    return planLevelFail("plan-not-found", `${found.rel} cannot be read: ${(e as Error).message}`);
  }
  const stamp = shippedInOf(text);
  const mode: LiveProofMode = stamp === null ? "pre-release" : "post-release";
  if (stamp !== null && PROPERTY["stamp-release"] && !changelogHasRelease(repoRoot, stamp)) {
    return planLevelFail("stamp-without-release", `${found.rel} carries shipped_in ${stamp} but CHANGELOG.md has no release heading for it`, "stamp-without-release", found.rel);
  }
  const table = parseLiveProofTable(text);
  if (!table.found) return planLevelFail("no-live-proof-section", `${found.rel} has no ### ${LIVE_PROOF_HEADING} section`, mode, found.rel);
  if (!table.ok) return planLevelFail("no-live-proof-section", `${found.rel}: ${table.detail}`, mode, found.rel);
  // A stamp must also be strictly newer than the plugin version each bundle
  // recorded at its run: hand-stamping an already-released version (the run's
  // own pre-bump version, say) cannot switch freshness off.
  if (stamp !== null && PROPERTY["stamp-release"]) {
    const notBefore = versionsNotBeforeStamp(repoRoot, table.rows, stamp);
    if (notBefore.length > 0 || semver(stamp) === null) {
      return planLevelFail(
        "stamp-without-release",
        `${found.rel} carries shipped_in ${stamp}, which is not a release newer than the run: ${notBefore.join(", ") || `${stamp} is not X.Y.Z`}`,
        "stamp-without-release",
        found.rel,
      );
    }
  }
  const ctx: TrackerContext = { repoRoot, mode, digestNow: PROPERTY.freshness && mode === "pre-release" ? workingTreeDigest(repoRoot) : null };
  const trackers = {} as Record<LiveProofTracker, TrackerResult>;
  for (const t of LIVE_PROOF_TRACKERS) trackers[t] = gradeRow(t, table.rows, ctx);
  const verdict = LIVE_PROOF_TRACKERS.every((t) => trackers[t].outcome === "pass") ? "pass" : "fail";
  return { verdict, mode, reason: null, plan: found.rel, trackers };
}

// ---------------------------------------------------------------------------
// the closing guard (AC-STE-618.8)
// ---------------------------------------------------------------------------

export interface RealPlanSuiteGuardResult {
  ok: boolean;
  reason: "real-plan-suite-missing" | null;
  detail: string;
}

/**
 * Once the FR sits under `specs/frs/archive/`, or either tracker's Live proof
 * row reads other than `pending`, the real-plan suite must exist. It fails
 * closed: the suite is NOT required only when the FR is plainly active (at
 * `specs/frs/<fr>.md` and not archived) and the plan resolves to one readable
 * file whose Live proof table has a row for each tracker, every row reading
 * `pending`. A missing or ambiguous plan, no section, no table, a tracker
 * without a row, or an FR found at neither path each require the suite. All
 * paths are repo-relative.
 */
export function realPlanSuiteGuard(o: { repoRoot: string; fr: string; planPath: string; suitePath: string }): RealPlanSuiteGuardResult {
  const repoRoot = resolve(o.repoRoot);
  const triggers: string[] = [];
  if (existsSync(join(repoRoot, "specs", "frs", "archive", `${o.fr}.md`))) triggers.push(`${o.fr} is archived`);
  else if (!existsSync(join(repoRoot, "specs", "frs", `${o.fr}.md`))) triggers.push(`${o.fr} is found at neither specs/frs/ nor specs/frs/archive/`);
  const found = resolvePlan(repoRoot, o.planPath);
  if (!found.ok) {
    triggers.push(`the Live proof rows cannot be read (${found.reason}: ${found.detail})`);
  } else {
    let text: string | null;
    try {
      text = readFileSync(found.abs, "utf-8");
    } catch (e) {
      text = null;
      triggers.push(`the Live proof rows cannot be read (${found.rel}: ${(e as Error).message})`);
    }
    const table = text === null ? null : parseLiveProofTable(text);
    if (table !== null && !table.found) triggers.push(`the Live proof rows cannot be read (${found.rel} has no ### ${LIVE_PROOF_HEADING} section)`);
    else if (table !== null && !table.ok) triggers.push(`the Live proof rows cannot be read (${found.rel}: ${table.detail})`);
    else if (table !== null && table.ok) {
      for (const t of LIVE_PROOF_TRACKERS) {
        const mine = table.rows.filter((r) => r.tracker.toLowerCase() === t);
        if (mine.length === 0) triggers.push(`the Live proof table has no ${t} row`);
        else if (mine.some((r) => valueCells(r).some((c) => c.toLowerCase() !== "pending"))) triggers.push(`the ${t} Live proof row reads other than pending`);
      }
    }
  }
  if (triggers.length === 0) return { ok: true, reason: null, detail: `${o.fr} is active and every Live proof row reads pending: the real-plan suite is not yet required` };
  if (existsSync(join(repoRoot, o.suitePath))) return { ok: true, reason: null, detail: `${triggers.join("; ")}, and the real-plan suite ${o.suitePath} exists` };
  return { ok: false, reason: "real-plan-suite-missing", detail: `${triggers.join("; ")}, but the real-plan suite ${o.suitePath} does not exist` };
}

// ---------------------------------------------------------------------------
// the command-line front door
// ---------------------------------------------------------------------------

function trackerLine(t: LiveProofTracker, r: TrackerResult): string {
  return r.outcome === "pass" ? `${t} pass` : `${t} fail ${r.reason}${r.detail ? ` — ${r.detail}` : ""}`;
}

if (import.meta.main) {
  const [root, planPath, ...rest] = process.argv.slice(2);
  if (!root || !planPath || rest.length > 0) {
    process.stderr.write("usage: live_proof_gate.ts <repoRoot> <planPath>\n");
    process.exit(2);
  }
  const r = gradeLiveProof({ repoRoot: root, planPath });
  process.stdout.write(`mode=${r.mode ?? "unknown"}\n`);
  for (const t of LIVE_PROOF_TRACKERS) process.stdout.write(`${trackerLine(t, r.trackers[t])}\n`);
  if (r.verdict === "pass") process.exit(0);
  const failing = LIVE_PROOF_TRACKERS.filter((t) => r.trackers[t].outcome !== "pass");
  process.stderr.write(
    [
      `live_proof_gate: refused — the live proof does not pass (${r.reason ?? failing.map((t) => `${t}: ${r.trackers[t].reason}`).join(", ")})`,
      "Remedy: run /shared-tracker-smoke on each failing tracker, commit its bundle and fill the plan's ### Live proof row with the bundle path, run date, nonce, spaces and bundleHash.",
      `Context: plan=${r.plan ?? planPath}, mode=${r.mode ?? "unknown"}, failing=${failing.join(",")}, gate=live_proof_gate`,
    ].join("\n") + "\n",
  );
  process.exit(1);
}

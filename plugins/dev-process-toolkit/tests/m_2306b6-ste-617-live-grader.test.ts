// STE-617 (M_2306b6) — the live shared-tracker grader, graded on synthetic
// bundles (tests/_live_bundle_fixtures.ts) and on the on-disk records a
// synthetic bundle materializes into (transcripts, receipts, git history).
//
// The module under test is adapters/_shared/src/shared_tracker_live_grader.ts:
//
//   behaviourDigest(pluginRoot, { trackedFiles? })
//       → { ok: true, digest, files } | { ok: false, reason: "digest-unavailable", message }
//   extractBundle({ configDirs, ledgerSessionIds, roots: { A: { path, tag }, B: { path, tag } }, run, synthetic? })
//       → { ok: true, bundle } | { ok: false, verdict: { outcome: "abort", findings } }
//   gradeBundle(bundle, { behaviourDigestNow, hooksJsonPath?, inventoryPath? }) → LiveVerdict
//   privacyViolations(bundle) → [{ pattern, value, where }]
//   writeEvidenceBundle(bundle, dir) → { ok: true, path } | { ok: false, reason: "privacy", violations }
//   scanCommittedBundles(root) → { scanned, status: "no-bundles-yet" | "scanned", violations }
//   LIVE_PREDICATE_IDS — the registry ids the grader holds a live predicate for
//   RECEIPT_WRITERS — tracker receipt kind → { module, subcommand } that writes
//       and announces it; the only run whose announcement of that kind counts
//   TRACKER_WRITE_TOOL_NAMES — the tracker-write tools the grader treats as
//       writes; a drift guard keeps it equal to the hook's TRACKER_WRITE_TOOLS
//
// A verdict carries `outcome` (SMOKE_OUTCOMES), `findings` (each `{ code,
// scenario?, session?, item?, tool?, detail? }`; a finding about one scenario
// carries its id in `scenario`), `scenarios` (per id `{ outcome: pass | fail |
// not-observed | offline-only | skipped, reason?, refs }`), and the artifact
// fields AC.8 names.
//
// Every refusal here has a permit twin that differs in the one variable the
// refusal keys on; every order case is graded both ways, the arrangement named
// in the test title. The grader is loaded dynamically so a missing module
// fails each test with a named reason instead of failing the file's load.

import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync as spawnSyncCleanup } from "node:child_process";
import { symlinkSync as symlinkFs, writeFileSync as writeFs } from "node:fs";
import { dirname, join } from "node:path";

import { SMOKE_OUTCOMES } from "../adapters/_shared/src/smoke_verdict";
import { LINEAR_MILESTONE_WINDOW } from "../adapters/_shared/src/tracker_answer";
import { milestoneLabel } from "../adapters/_shared/src/attach_project_milestone";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { mutateInRegion } from "./_sited-mutation";
// The hook's own lists, imported only to pin the grader's copies to them: the
// writer map (the drift guard in "a receipt counts as announced only by its
// writer") and the tracker-write tool set (the drift guard in "HARDENING 8").
import { RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS, TRACKER_WRITE_TOOLS } from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";
import {
  addToAudit,
  audits,
  AUTO_APPROVE,
  breakScenario,
  buildPassingBundle,
  clone,
  createdKeys,
  dropFromAudit,
  editAuditItem,
  isCreateCall,
  LINEAR_CAP_TEXT,
  type LiveBundle,
  markerLine,
  AUDIT_FIELDS,
  JIRA_SHAPES,
  type JiraShape,
  materialize,
  materialize as materializeRecords,
  type Materialized,
  type MaterializeOptions,
  NONCE,
  removeSessions,
  rewriteAssistantText,
  SCENARIO_BREAKS,
  serverPrefix,
  sessionsOf,
  sid,
  slugOf,
  TAG_A,
  TAG_B,
  title,
  type ToolCall,
  type Tracker,
  type TrackerItem,
  type BundleSession,
} from "./_live_bundle_fixtures";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const GRADER_PATH = join(pluginRoot, "adapters", "_shared", "src", "shared_tracker_live_grader.ts");
const REGISTRY_PATH = join(pluginRoot, "adapters", "_shared", "src", "shared_tracker_scenarios.ts");
const CLEANUP_PATH = join(pluginRoot, "adapters", "_shared", "src", "smoke_session_cleanup.ts");
const HOOKS_JSON = join(pluginRoot, "hooks", "hooks.json");
const TRACKERS: readonly Tracker[] = ["jira", "linear"];
/**
 * The extraction legs. Jira's server was recorded answering in two shapes
 * (plain and wrapped) within days, so every materialized passing bundle must
 * extract and pass under both; the legs parameterise one suite, never a fork.
 */
const LEGS: ReadonlyArray<{ t: Tracker; shape: JiraShape; name: string }> = [
  { t: "jira", shape: "plain", name: "jira (plain answers)" },
  { t: "jira", shape: "wrapped", name: "jira (wrapped answers)" },
  { t: "linear", shape: "plain", name: "linear" },
];

// ===========================================================================
// Dynamic loads
// ===========================================================================

interface Finding {
  code: string;
  scenario?: string;
  session?: string;
  item?: string;
  tool?: string;
  detail?: string;
}
interface ScenarioOutcome {
  outcome: "pass" | "fail" | "not-observed" | "offline-only" | "skipped";
  reason?: string;
  refs: string[];
}
interface LiveVerdict {
  outcome: string;
  findings: Finding[];
  scenarios: Record<string, ScenarioOutcome>;
  runId: string;
  nonce: string;
  tracker: string;
  pluginVersion: string;
  behaviourDigest: { digest: string; files: Record<string, string> };
  graderDigest: string;
  linearBudget: { declared: number; spent: number; created: string[] } | null;
}
type DigestResult = { ok: true; digest: string; files: Record<string, string> } | { ok: false; reason: string; message: string };
type Extracted = { ok: true; bundle: LiveBundle } | { ok: false; verdict: { outcome: string; findings: Finding[] } };
interface PrivacyViolation {
  pattern: string;
  value: string;
  where: string;
}
interface GraderModule {
  behaviourDigest(root: string, opts?: { trackedFiles?: readonly string[] }): DigestResult;
  extractBundle(o: {
    configDirs: string[];
    ledgerSessionIds: string[];
    roots: { A: { path: string; tag: string }; B: { path: string; tag: string } };
    run: LiveBundle["run"];
    synthetic?: boolean;
  }): Extracted;
  gradeBundle(b: LiveBundle, o: { behaviourDigestNow: string; hooksJsonPath?: string; inventoryPath?: string }): LiveVerdict;
  privacyViolations(b: unknown): PrivacyViolation[];
  writeEvidenceBundle(b: LiveBundle, dir: string): { ok: true; path: string } | { ok: false; reason: string; violations: PrivacyViolation[] };
  scanCommittedBundles(root: string): { scanned: number; status: string; violations: PrivacyViolation[] };
  LIVE_PREDICATE_IDS: readonly string[];
  RECEIPT_WRITERS: Readonly<Record<string, { module: string; subcommand: string | null }>>;
  TRACKER_WRITE_TOOL_NAMES?: readonly string[];
}
interface RegistryScenario {
  id: string;
  trackers: readonly string[];
  live: boolean;
  offlineReason?: string;
}
interface RegistryModule {
  SHARED_TRACKER_SCENARIOS: readonly RegistryScenario[];
  spawnCeiling?: (t: Tracker) => number;
  linearWorstCase?: () => number;
}

let G: GraderModule | null = null;
let gErr = "";
try {
  G = (await import(GRADER_PATH)) as GraderModule;
} catch (e) {
  gErr = (e as Error)?.message ?? String(e);
}
function grader(): GraderModule {
  if (G === null) throw new Error(`the live grader ${GRADER_PATH} cannot be loaded (${gErr}); STE-617 ships it`);
  return G;
}

const REG = (await import(REGISTRY_PATH)) as RegistryModule;
const liveIds = (t: Tracker) => REG.SHARED_TRACKER_SCENARIOS.filter((s) => s.live && s.trackers.includes(t)).map((s) => s.id);
function ceiling(t: Tracker): number {
  if (typeof REG.spawnCeiling !== "function") throw new Error("the registry exports no spawnCeiling(tracker) — STE-617 derives the ceiling from it");
  return REG.spawnCeiling(t);
}
function worstCase(): number {
  if (typeof REG.linearWorstCase !== "function") throw new Error("the registry exports no linearWorstCase() — STE-617 derives it");
  return REG.linearWorstCase();
}

// ===========================================================================
// Helpers
// ===========================================================================

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Review F1 — the grader's re-list scoping, read off the module under test. */
const F1 = () => grader() as unknown as { HOOK_SOURCE: string; PRE_RELIST_HOOK_SOURCES: ReadonlySet<string>; hookDemandsRelist: (b: LiveBundle) => boolean };

/**
 * STE-650 AC.7 — the behaviour digest `behaviourDigest` would record over
 * `files`: one SHA-256 over the sorted "<file sha>  <path>\n" list. A bundle
 * whose recorded digest equals this is self-consistent; the committed live
 * bundles all are. Legs that plant a listed pre-STE-644 hook hash seal the
 * digest with this so the bundle stays consistent.
 */
const digestOfFiles = (files: Record<string, string>): string =>
  sha256(Object.keys(files).sort().map((p) => `${files[p]}  ${p}\n`).join(""));
function sealDigest(b: LiveBundle): LiveBundle {
  const sealed = digestOfFiles(b.run.behaviourDigest.files);
  // The below-floor copy was recorded against the same tree: keep them equal.
  if (b.run.belowFloorDigest === b.run.behaviourDigest.digest) b.run.belowFloorDigest = sealed;
  b.run.behaviourDigest.digest = sealed;
  return b;
}

function grade(b: LiveBundle, extra: { hooksJsonPath?: string; inventoryPath?: string; behaviourDigestNow?: string } = {}): LiveVerdict {
  return grader().gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest, ...extra });
}

/** Scenario ids graded as failing (a not-observed scenario counts as a failure). */
function failing(v: LiveVerdict): string[] {
  return Object.entries(v.scenarios)
    .filter(([, s]) => s.outcome === "fail" || s.outcome === "not-observed")
    .map(([id]) => id)
    .sort();
}

function codes(v: { findings: Finding[] }): string[] {
  return [...new Set(v.findings.map((f) => f.code))].sort();
}

function findingsOf(v: { findings: Finding[] }, code: string): Finding[] {
  return v.findings.filter((f) => f.code === code);
}

function expectFailsExactly(v: LiveVerdict, id: string, why: string): void {
  expect({ outcome: v.outcome, failing: failing(v) }, why).toEqual({ outcome: "fail", failing: [id] });
  const stray = v.findings.filter((f) => f.scenario !== id);
  expect(stray, `${why}: every finding names ${id} and no run-wide check fired`).toEqual([]);
}

function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function withTmp<T>(prefix: string, f: (dir: string) => T): T {
  const d = tmp(prefix);
  try {
    return f(d);
  } finally {
    // Bun 1.3.14's rmSync fails silently on a git-created .git; the system rm is reliable, and its result is asserted.
    spawnSyncCleanup("rm", ["-rf", d]);
    if (existsSync(d)) throw new Error(`cleanup: ${d} (and its git-created .git) survived rm -rf`);
  }
}

function session(b: LiveBundle, marker: string, nth = 0): BundleSession {
  const s = sessionsOf(b, marker)[nth];
  if (!s) throw new Error(`fixture: no ${marker} session #${nth}`);
  return s;
}

function swapCalls(s: BundleSession, i: number, j: number): void {
  const a = s.calls[i]!;
  const c = s.calls[j]!;
  const at = a.at;
  a.at = c.at;
  c.at = at;
  s.calls[i] = c;
  s.calls[j] = a;
}

function extractFor(m: Materialized, synthetic = true): Extracted {
  return grader().extractBundle({
    configDirs: [m.configDir],
    ledgerSessionIds: m.ledger,
    roots: { A: { path: m.roots.A, tag: TAG_A }, B: { path: m.roots.B, tag: TAG_B } },
    run: m.run,
    synthetic,
  });
}

/** The extracted bundle, or a failed expectation naming the abort. */
function extractedBundle(x: Extracted): LiveBundle {
  expect(x.ok, x.ok ? "" : JSON.stringify(x.verdict.findings)).toBe(true);
  return (x as { ok: true; bundle: LiveBundle }).bundle;
}

function gradeExtracted(x: Extracted): { outcome: string; findings: Finding[]; v: LiveVerdict | null } {
  if (!x.ok) return { outcome: x.verdict.outcome, findings: x.verdict.findings, v: null };
  const v = grade(x.bundle);
  return { outcome: v.outcome, findings: v.findings, v };
}

function namesSession(f: { findings: Finding[] }, sessionId: string): boolean {
  return f.findings.some((x) => x.session === sessionId || JSON.stringify(x).includes(sessionId));
}

/** Rewrite a transcript's first non-meta user record's text. */
function setFirstUserText(file: string, text: string): void {
  const lines = readFileSync(file, "utf-8").split("\n").filter((l) => l.trim() !== "");
  const i = lines.findIndex((l) => {
    const r = JSON.parse(l);
    return r.type === "user" && r.isMeta !== true;
  });
  const rec = JSON.parse(lines[i]!);
  rec.message.content = text;
  lines[i] = JSON.stringify(rec);
  writeFileSync(file, lines.join("\n") + "\n");
}

function insertUserText(file: string, at: number, text: string): void {
  const lines = readFileSync(file, "utf-8").split("\n").filter((l) => l.trim() !== "");
  const first = JSON.parse(lines[0]!);
  lines.splice(at, 0, JSON.stringify({ ...first, uuid: `${first.uuid.slice(0, 30)}999999`, message: { role: "user", content: text } }));
  writeFileSync(file, lines.join("\n") + "\n");
}

/** A grader that reads assistant text — the mutation AC.7's control shows the real grader is not. */
function naiveTextGrade(files: readonly string[]): "pass" | "fail" {
  for (const f of files) {
    for (const l of readFileSync(f, "utf-8").split("\n")) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      if (r.type !== "assistant") continue;
      for (const blk of r.message?.content ?? []) if (blk.type === "text" && /\bFAIL/.test(blk.text)) return "fail";
    }
  }
  return "pass";
}

function transcriptFiles(configDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(configDir);
  return out;
}

// ===========================================================================
// The module
// ===========================================================================

describe("the live grader module loads and exposes its contract", () => {
  test("shared_tracker_live_grader.ts exports behaviourDigest, extractBundle, gradeBundle, privacyViolations, writeEvidenceBundle, scanCommittedBundles and LIVE_PREDICATE_IDS", () => {
    const g = grader();
    for (const f of ["behaviourDigest", "extractBundle", "gradeBundle", "privacyViolations", "writeEvidenceBundle", "scanCommittedBundles"] as const) {
      expect({ export: f, type: typeof g[f] }).toEqual({ export: f, type: "function" });
    }
    expect(Array.isArray(g.LIVE_PREDICATE_IDS)).toBe(true);
  });
  test("CONTROL — every fixture bundle is stamped synthetic (STE-618 refuses a synthetic bundle as live proof)", () => {
    for (const t of TRACKERS) expect(buildPassingBundle(t).synthetic).toBe(true);
    expect(buildPassingBundle("jira", { jiraRepointFrom: null }).synthetic).toBe(true);
  });
});

// ===========================================================================
// The passing bundle (AC.8, AC.9)
// ===========================================================================

for (const t of TRACKERS) {
  describe(`${t} — the passing bundle grades pass`, () => {
    test("CONTROL — the passing bundle starts exactly the registry-derived ceiling of children", () => {
      expect(buildPassingBundle(t).ledger.length).toBe(ceiling(t));
    });
    test("outcome pass, no finding, every applicable live scenario pass, and the outcome word is from SMOKE_OUTCOMES", () => {
      const v = grade(buildPassingBundle(t));
      expect((SMOKE_OUTCOMES as readonly string[]).includes(v.outcome)).toBe(true);
      expect({ outcome: v.outcome, findings: v.findings }).toEqual({ outcome: "pass", findings: [] });
      for (const id of liveIds(t)) expect({ id, outcome: v.scenarios[id]?.outcome }).toEqual({ id, outcome: "pass" });
    });
    test("every offline-only id is listed as offline-only, never omitted", () => {
      const v = grade(buildPassingBundle(t));
      const offline = REG.SHARED_TRACKER_SCENARIOS.filter((s) => !s.live && s.trackers.includes(t)).map((s) => s.id);
      expect(offline.length, "control: the registry has offline-only ids for this tracker").toBeGreaterThan(0);
      for (const id of offline) expect({ id, outcome: v.scenarios[id]?.outcome }).toEqual({ id, outcome: "offline-only" });
    });
    test("AC.8 — the artifact carries run id, nonce, tracker, plugin version, the behaviour digest with its per-file hashes and the grader's own digest", () => {
      const b = buildPassingBundle(t);
      const v = grade(b);
      expect({ runId: v.runId, nonce: v.nonce, tracker: v.tracker, pluginVersion: v.pluginVersion }).toEqual({
        runId: b.run.runId,
        nonce: NONCE,
        tracker: t,
        pluginVersion: b.run.pluginVersion,
      });
      expect(v.behaviourDigest).toEqual(b.run.behaviourDigest);
      expect(v.graderDigest, "the grader module's own digest is sha256 over its bytes").toBe(sha256(readFileSync(GRADER_PATH)));
    });
    test("AC.8 — each scenario's outcome carries the record references it was decided on, at least one from its own sessions", () => {
      const b = buildPassingBundle(t);
      const v = grade(b);
      for (const id of liveIds(t)) {
        const own = new Set(sessionsOf(b, id).flatMap((s) => s.calls.map((c) => c.ref)));
        const refs = v.scenarios[id]?.refs ?? [];
        expect({ id, ownRef: refs.some((r) => own.has(r)) }).toEqual({ id, ownRef: true });
      }
    });
    test(`AC.8/AC.14 — the Linear budget declared and spent ${t === "linear" ? "is recorded with every created issue" : "is null on Jira"}`, () => {
      const b = buildPassingBundle(t);
      const v = grade(b);
      if (t === "linear") {
        const issues = b.sessions
          .filter((s) => s.marker !== "audit")
          .flatMap((s) => s.calls.filter((c) => /__save_issue$/.test(c.name) && !c.input.id && !c.result.isError).flatMap((c) => c.result.items!.map((i) => i.key)));
        expect(issues.length, "control: the fixture creates the seven budgeted issues").toBe(7);
        expect({ declared: v.linearBudget?.declared, spent: v.linearBudget?.spent, created: [...(v.linearBudget?.created ?? [])].sort() }).toEqual({
          declared: worstCase(),
          spent: 7,
          created: [...issues].sort(),
        });
      } else {
        expect(v.linearBudget).toBeNull();
      }
    });
  });
}

// ===========================================================================
// AC.9 — every live id has a predicate, and a single-scenario break fails it alone
// ===========================================================================

function coverageErrors(registry: readonly RegistryScenario[], predicateIds: readonly string[]): string[] {
  if (registry.length === 0) return ["the registry is empty — no scenario can be graded"];
  const errs: string[] = [];
  const preds = new Set(predicateIds);
  for (const s of registry) {
    if (s.live && !preds.has(s.id)) errs.push(`${s.id} is live but the grader holds no predicate for it`);
    if (!s.live && !(s.offlineReason ?? "").trim()) errs.push(`${s.id} is offline-only with no written reason`);
  }
  for (const p of preds) if (!registry.some((s) => s.id === p && s.live)) errs.push(`${p} has a predicate but is not a live registry id`);
  return errs;
}

describe("AC.9 — the registry and the grader's predicates agree by name", () => {
  test("every live id has a predicate, every predicate is a live id, and every offline-only id has a reason", () => {
    expect(coverageErrors(REG.SHARED_TRACKER_SCENARIOS, grader().LIVE_PREDICATE_IDS)).toEqual([]);
  });
  test("CONTROL — a live id with no predicate, an offline-only id with no reason, a stray predicate and an empty registry each fail naming it", () => {
    const reg: RegistryScenario[] = [
      { id: "S1", trackers: ["jira"], live: true },
      { id: "S2", trackers: ["jira"], live: true },
      { id: "S3", trackers: ["jira"], live: false },
    ];
    const errs = coverageErrors(reg, ["S1", "S9"]);
    expect(errs.some((e) => e.startsWith("S2 ") && e.includes("no predicate"))).toBe(true);
    expect(errs.some((e) => e.startsWith("S3 ") && e.includes("no written reason"))).toBe(true);
    expect(errs.some((e) => e.startsWith("S9 "))).toBe(true);
    expect(coverageErrors([], ["S1"])).toEqual(["the registry is empty — no scenario can be graded"]);
  });
});

for (const t of TRACKERS) {
  const ids = liveIds(t);
  describe(`AC.9 — ${t}: a bundle differing only in one scenario's records fails naming exactly that id`, () => {
    test("CONTROL — the loop is over the registry, is not empty, and every live id has a defined break", () => {
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id) => SCENARIO_BREAKS[id] === undefined), "live ids with no break in the fixture").toEqual([]);
    });
    for (const id of ids) {
      test(`${id} — broken alone, the grade fails naming ${id} and no other`, () => {
        const b = buildPassingBundle(t);
        const why = breakScenario(b, id);
        expectFailsExactly(grade(b), id, `${id}: ${why}`);
      });
    }
  });
}

// ===========================================================================
// AC.6 / AC.7 / AC.8 — extraction from the on-disk records
// ===========================================================================

for (const { t, shape, name } of LEGS) {
  describe(`${name} — extraction from transcripts, receipts and git (round trip)`, () => {
    const materialize = (b: LiveBundle, base: string, o: MaterializeOptions = {}): Materialized => materializeRecords(b, base, { jiraShape: shape, ...o });
    test("the materialized passing bundle extracts and grades pass", () => {
      withTmp("ste617-rt-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        const r = gradeExtracted(extractFor(m));
        expect({ outcome: r.outcome, findings: r.findings }).toEqual({ outcome: "pass", findings: [] });
      });
    });
    test("AC.16 — the extracted bundle is a projection: the raw records carry site hosts, emails and account ids, the bundle none", () => {
      withTmp("ste617-proj-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        const raw = transcriptFiles(m.configDir).map((f) => readFileSync(f, "utf-8")).join("\n");
        expect(raw, "control: the raw tracker answers carry an email").toContain("ops@acme-sandbox.io");
        expect(raw, "control: the raw records carry the absolute roots").toContain(m.roots.A);
        const bundle = extractedBundle(extractFor(m));
        expect(grader().privacyViolations(bundle)).toEqual([]);
        expect(JSON.stringify(bundle)).not.toContain(m.roots.A);
        expect(JSON.stringify(bundle)).toContain("<A>");
      });
    });
    test("ROOT ALIAS, roots named through a symlink and transcripts carrying the real path: the sessions map to their roots and the run grades pass", () => {
      withTmp("ste617-alias-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        const alias = join(dirname(d), `${d.split("/").pop()}-alias`);
        symlinkFs(d, alias);
        try {
          const via = (p: string) => join(alias, p.slice(d.length + 1));
          const x = grader().extractBundle({
            configDirs: [m.configDir],
            ledgerSessionIds: m.ledger,
            roots: { A: { path: via(m.roots.A), tag: TAG_A }, B: { path: via(m.roots.B), tag: TAG_B } },
            run: m.run,
            synthetic: true,
          });
          const r = gradeExtracted(x);
          expect({ outcome: r.outcome, findings: r.findings }).toEqual({ outcome: "pass", findings: [] });
        } finally {
          spawnSyncCleanup("rm", ["-f", alias]);
        }
      });
    });
    test("ROOT ALIAS, the mirror FAILS CLOSED: transcripts carrying a symlinked path the grader was never given abort as session-outside-roots, never map inside a root", () => {
      withTmp("ste617-alias2-", (d) => {
        const alias = join(dirname(d), `${d.split("/").pop()}-alias`);
        symlinkFs(d, alias);
        try {
          const m = materialize(buildPassingBundle(t), alias, { keepBase: true });
          expect(m.roots.A.startsWith(`${alias}/`), "control: the transcripts carry the symlinked spelling").toBe(true);
          const real = (p: string) => join(d, p.slice(alias.length + 1));
          const x = grader().extractBundle({
            configDirs: [m.configDir],
            ledgerSessionIds: m.ledger,
            roots: { A: { path: real(m.roots.A), tag: TAG_A }, B: { path: real(m.roots.B), tag: TAG_B } },
            run: m.run,
            synthetic: true,
          });
          // A session's own cwd is never resolved (a planted symlink must not pull
          // an outside session into a root), so this arrangement is refused. It
          // does not arise live: the skill spells roots physically and Claude Code
          // records a resolved cwd.
          const r = gradeExtracted(x);
          expect(r.outcome).toBe("abort");
          expect(r.findings.some((f) => f.code === "session-outside-roots")).toBe(true);
        } finally {
          spawnSyncCleanup("rm", ["-f", alias]);
        }
      });
    });
    test("ROOT ALIAS: an UNLEDGERED session filed under a root's resolved slug is still reported unledgered when the root is named through a symlink", () => {
      withTmp("ste617-alias3-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        const main = transcriptFiles(m.configDir).find((f) => !f.includes("/subagents/"))!;
        const stray = "5e55aeee-617a-4c00-8000-00000000eeee";
        writeFs(join(dirname(main), `${stray}.jsonl`), readFileSync(main, "utf-8"));
        const alias = join(dirname(d), `${d.split("/").pop()}-alias`);
        symlinkFs(d, alias);
        try {
          const via = (p: string) => join(alias, p.slice(d.length + 1));
          const x = grader().extractBundle({
            configDirs: [m.configDir],
            ledgerSessionIds: m.ledger,
            roots: { A: { path: via(m.roots.A), tag: TAG_A }, B: { path: via(m.roots.B), tag: TAG_B } },
            run: m.run,
            synthetic: true,
          });
          expect(x.ok && x.bundle.unledgeredSessions).toEqual([stray]);
        } finally {
          spawnSyncCleanup("rm", ["-f", alias]);
        }
      });
    });
    test("the root rewrite is anchored at a path boundary: a path that only SHARES a root's prefix is not rewritten", () => {
      withTmp("ste617-bound-", (d) => {
        const b = buildPassingBundle(t);
        const s0 = b.sessions.find((s) => s.calls.some((c) => c.name === "Bash"))!;
        const c0 = s0.calls.find((c) => c.name === "Bash")!;
        c0.result.text = `${c0.result.text}\nsee <A>-scratch/notes.txt`;
        const m = materialize(b, d);
        const x = extractFor(m);
        const text = JSON.stringify(extractedBundle(x));
        expect(text, "control: the root itself is rewritten").toContain("<A>");
        expect(text, "a sibling path sharing the root's prefix was rewritten into the root token").not.toContain("<A>-scratch");
      });
    });
    test("the synthetic stamp is carried by extraction only when asked: synthetic material stays stamped, a real extraction is not", () => {
      withTmp("ste617-stamp-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        const a = extractFor(m, true);
        const b = extractFor(m, false);
        expect({ a: a.ok && a.bundle.synthetic, b: b.ok && b.bundle.synthetic }).toEqual({ a: true, b: false });
      });
    });
  });
}

describe("AC.6 — each ledgered session maps to exactly one scenario by its first user message's marker line", () => {
  const b = buildPassingBundle("jira");
  const target = session(b, "S4", 1).sessionId;
  const cases: Array<[string, (m: Materialized) => void]> = [
    ["no marker line", (m) => setFirstUserText(m.transcripts[target]!, "Run the scenario step.")],
    ["two marker lines", (m) => setFirstUserText(m.transcripts[target]!, `${markerLine("S4")}\n${markerLine("S5")}`)],
    ["an unknown marker (S99)", (m) => setFirstUserText(m.transcripts[target]!, markerLine("S99"))],
    [
      "the marker only in a LATER user message, none in the first",
      (m) => {
        setFirstUserText(m.transcripts[target]!, "Run the scenario step.");
        insertUserText(m.transcripts[target]!, 2, markerLine("S4"));
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    test(`${name} aborts the grade naming the session`, () => {
      withTmp("ste617-mk-", (d) => {
        const m = materialize(b, d);
        mutate(m);
        const r = gradeExtracted(extractFor(m));
        expect(r.outcome).toBe("abort");
        expect(namesSession(r, target), JSON.stringify(r.findings)).toBe(true);
      });
    });
  }
  test("PERMIT TWIN — the reserved markers audit and intruder, and a registry id, each map without an abort", () => {
    withTmp("ste617-mk-ok-", (d) => {
      const m = materialize(b, d);
      const bundle = extractedBundle(extractFor(m));
      expect(new Set(bundle.sessions.map((s) => s.marker))).toEqual(new Set(b.sessions.map((s) => s.marker)));
      expect(bundle.sessions.find((s) => s.marker === "intruder")?.client).toBe("intruder");
      expect(bundle.sessions.filter((s) => s.marker === "audit").length).toBe(2);
    });
  });
  test("a registry scenario applicable to the tracker with no session is not-observed, and the run fails", () => {
    const c = clone(b);
    removeSessions(c, sessionsOf(c, "S16").map((s) => s.sessionId));
    const v = grade(c);
    expect({ outcome: v.outcome, s16: v.scenarios.S16?.outcome }).toEqual({ outcome: "fail", s16: "not-observed" });
  });
});

describe("AC.7 — the grader never reads assistant text", () => {
  const FAIL_CLAIM = "FAILED: every scenario failed; S2 bound the same ticket in both repositories.";
  const PASS_CLAIM = "PASS: every scenario passed.";
  test("replacing every assistant text block of a passing run with a failure claim leaves the verdict pass", () => {
    withTmp("ste617-txt-", (d) => {
      const m = materialize(buildPassingBundle("jira"), d);
      const files = transcriptFiles(m.configDir);
      expect(naiveTextGrade(files), "control: the neutral text reads as pass to a text-reading grader").toBe("pass");
      const before = gradeExtracted(extractFor(m)).outcome;
      const n = rewriteAssistantText(files, FAIL_CLAIM);
      expect(n, "control: assistant text blocks were rewritten").toBeGreaterThan(0);
      expect(naiveTextGrade(files), "CONTROL — a grader that reads text flips to fail on the same records").toBe("fail");
      expect({ before, after: gradeExtracted(extractFor(m)).outcome }).toEqual({ before: "pass", after: "pass" });
    });
  });
  for (const claim of [FAIL_CLAIM, PASS_CLAIM]) {
    test(`both repositories binding one ticket fails naming S2 whatever the text says (text: ${claim.slice(0, 5)})`, () => {
      withTmp("ste617-s2-", (d) => {
        const b = buildPassingBundle("jira");
        const aKey = b.repos.A.frBindings.find((f) => f.path === "specs/frs/fr-s2.md")!.key;
        const m = materialize(b, d);
        rewriteAssistantText(transcriptFiles(m.configDir), claim);
        const fr = join(m.roots.B, "specs", "frs", "fr-s2.md");
        const bKey = b.repos.B.frBindings.find((f) => f.path === "specs/frs/fr-s2.md")!.key;
        writeFileSync(fr, readFileSync(fr, "utf-8").replace(`jira: ${bKey}`, `jira: ${aKey}`));
        const at = "2026-09-21T12:00:00Z";
        const env = { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: "s", GIT_AUTHOR_EMAIL: "s@localhost", GIT_COMMITTER_NAME: "s", GIT_COMMITTER_EMAIL: "s@localhost", HOME: d };
        Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "commit", "-qam", "rebind fr-s2"], { cwd: m.roots.B, env });
        const r = gradeExtracted(extractFor(m));
        expect(r.v).not.toBeNull();
        expectFailsExactly(r.v!, "S2", "both fr-s2 files bind A's key");
      });
    });
  }
});

describe("extraction — sidechains, persisted tool_results, missing and unledgered transcripts", () => {
  const b = buildPassingBundle("jira");
  const detector = sessionsOf(b, "S10").find((s) => s.calls.some((c) => c.sidechain))!;
  const audit1 = audits(b)[0]!;
  const lastPage = audit1.calls.find((c) => c.result.lastPage === true)!;

  test("CONTROL — the fixture runs the S10 detector inside a subagent sidechain", () => {
    expect(detector.calls.every((c) => c.sidechain)).toBe(true);
  });
  test("subagent sidechains are read: the S10 detector run recorded only in a sidechain passes S10", () => {
    withTmp("ste617-side-", (d) => {
      const m = materialize(b, d);
      const r = gradeExtracted(extractFor(m));
      expect(r.v?.scenarios.S10?.outcome).toBe("pass");
    });
  });
  test("CONTROL — with the sidechain file removed, the same run does not pass S10", () => {
    withTmp("ste617-side-x-", (d) => {
      const m = materialize(b, d);
      rmSync(join(dirname(m.transcripts[detector.sessionId]!), detector.sessionId, "subagents"), { recursive: true, force: true });
      const r = gradeExtracted(extractFor(m));
      expect(r.v?.scenarios.S10?.outcome).not.toBe("pass");
    });
  });
  test("a persisted tool_result is graded from its <sid>/tool-results/<id>.txt file, never from its 2 KB preview", () => {
    withTmp("ste617-ptr-", (d) => {
      const m = materialize(b, d, { persistRefs: [lastPage.ref] });
      const raw = readFileSync(m.transcripts[audit1.sessionId]!, "utf-8");
      expect(raw, "control: the audit's last page is stored as a pointer").toContain("Full output saved to:");
      const r = gradeExtracted(extractFor(m));
      expect({ outcome: r.outcome, findings: r.findings }).toEqual({ outcome: "pass", findings: [] });
    });
  });
  // Live leg 9 (2026-09-25): two Epic listings (29 Epics, 62-112 KB) came back
  // in the MCP form of the pointer, which the Bash-form pattern never matched.
  // The grader kept the pointer text as the answer, read no items and no last
  // page, and reported `unlisted-decision` on two decisions whose listing the
  // session HAD fetched. The container only grows, so each leg makes it likelier.
  test("an MCP answer persisted over the token limit is graded from its saved file, never from the pointer text", () => {
    withTmp("ste617-ptr-mcp-", (d) => {
      const m = materialize(b, d, { persistRefs: [lastPage.ref], persistShape: "mcp-token-limit" });
      const raw = readFileSync(m.transcripts[audit1.sessionId]!, "utf-8");
      expect(raw, "control: the audit's last page is stored as an MCP pointer").toContain("exceeds maximum allowed tokens. Output has been saved to ");
      const r = gradeExtracted(extractFor(m));
      expect({ outcome: r.outcome, findings: r.findings }).toEqual({ outcome: "pass", findings: [] });
    });
  });
  test("an MCP pointer whose saved file is missing aborts naming the session", () => {
    withTmp("ste617-ptr-mcp-x-", (d) => {
      const m = materialize(b, d, { persistRefs: [lastPage.ref], dropPersistedFiles: [lastPage.ref], persistShape: "mcp-token-limit" });
      const r = gradeExtracted(extractFor(m));
      expect(r.outcome).toBe("abort");
      expect(r.findings.some((f) => f.code === "tool-result-missing" && f.session === audit1.sessionId), JSON.stringify(r.findings)).toBe(true);
    });
  });
  test("a pointer whose tool-results file is missing aborts naming the session", () => {
    withTmp("ste617-ptr-x-", (d) => {
      const m = materialize(b, d, { persistRefs: [lastPage.ref], dropPersistedFiles: [lastPage.ref] });
      const r = gradeExtracted(extractFor(m));
      expect(r.outcome).toBe("abort");
      expect(namesSession(r, audit1.sessionId), JSON.stringify(r.findings)).toBe(true);
    });
  });
  test("AC.8 — a ledgered session with no readable transcript aborts naming it", () => {
    withTmp("ste617-miss-", (d) => {
      const m = materialize(b, d);
      const gone = session(b, "S4", 1).sessionId;
      rmSync(m.transcripts[gone]!);
      const r = gradeExtracted(extractFor(m));
      expect(r.outcome).toBe("abort");
      expect(namesSession(r, gone), JSON.stringify(r.findings)).toBe(true);
    });
  });

  function copyTranscript(m: Materialized, from: string, newSid: string, cwd: string, at?: string): void {
    const src = readFileSync(m.transcripts[from]!, "utf-8");
    const dir = join(m.configDir, "projects", slugOf(cwd));
    mkdirSync(dir, { recursive: true });
    const out = src
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const r = JSON.parse(l);
        r.sessionId = newSid;
        r.cwd = cwd;
        // `at` re-dates EVERY record, so the transcript's latest timestamp is
        // `at` — the value the unledgered scan reads.
        if (at !== undefined) r.timestamp = at;
        return JSON.stringify(r);
      });
    writeFileSync(join(dir, `${newSid}.jsonl`), out.join("\n") + "\n");
  }

  test("AC.15 — a transcript whose cwd is a throwaway root but which the ledger lacks is listed unledgered-session and fails the run", () => {
    withTmp("ste617-unl-", (d) => {
      const m = materialize(b, d);
      const stray = sid(200);
      copyTranscript(m, session(b, "S16").sessionId, stray, m.roots.A);
      const bundle = extractedBundle(extractFor(m));
      expect(bundle.unledgeredSessions).toEqual([stray]);
      const v = grade(bundle);
      expect(v.outcome).toBe("fail");
      expect(findingsOf(v, "unledgered-session").some((f) => JSON.stringify(f).includes(stray))).toBe(true);
    });
  });
  // AC-STE-617.15, scoped by the run's own start (live leg 3, 2026-09-23). The
  // throwaway roots are REUSED across legs, so every child of every earlier leg
  // sits in the same directories forever. Leg 3 inherited 8; leg 4 would have
  // inherited those plus leg 3's, and any re-run on the same paths would be
  // failed before it started. These two rows differ in ONE variable — the
  // transcript's timestamp against `run.startedAt` — because a fix that merely
  // silenced the finding would pass a one-sided test and delete the guard.
  test("a transcript from an EARLIER run in the same reusable roots is not listed: its last activity precedes this run's start", () => {
    withTmp("ste617-unl-old-", (d) => {
      const m = materialize(b, d);
      const stray = sid(201);
      // One hour before the run's recorded start.
      const before = new Date(Date.parse(b.run.startedAt) - 3_600_000).toISOString();
      copyTranscript(m, session(b, "S16").sessionId, stray, m.roots.A, before);
      const bundle = extractedBundle(extractFor(m));
      expect(bundle.unledgeredSessions).toEqual([]);
      expect(codes(grade(bundle))).not.toContain("unledgered-session");
    });
  });

  test("PERMIT TWIN — the SAME transcript dated after this run's start is still listed and still fails the run", () => {
    withTmp("ste617-unl-new-", (d) => {
      const m = materialize(b, d);
      const stray = sid(202);
      // One hour after the same start — the only difference from the row above.
      const after = new Date(Date.parse(b.run.startedAt) + 3_600_000).toISOString();
      copyTranscript(m, session(b, "S16").sessionId, stray, m.roots.A, after);
      const bundle = extractedBundle(extractFor(m));
      expect(bundle.unledgeredSessions).toEqual([stray]);
      const v = grade(bundle);
      expect(v.outcome).toBe("fail");
      expect(findingsOf(v, "unledgered-session").some((f) => JSON.stringify(f).includes(stray))).toBe(true);
    });
  });

  test("an undatable transcript is still listed — the filter narrows the scan and can never widen it into silence", () => {
    withTmp("ste617-unl-undated-", (d) => {
      const m = materialize(b, d);
      const stray = sid(203);
      // Every record's timestamp is unparseable, so the scan cannot date it.
      // AC.15 says such a session is never SILENTLY kept, so it stays loud.
      copyTranscript(m, session(b, "S16").sessionId, stray, m.roots.A, "not-a-date");
      expect(extractedBundle(extractFor(m)).unledgeredSessions).toEqual([stray]);
    });
  });

  test("PERMIT TWIN — the same unledgered transcript under a cwd outside the run's roots is not listed", () => {
    withTmp("ste617-unl-ok-", (d) => {
      const m = materialize(b, d);
      const elsewhere = join(d, "dev-process-toolkit");
      mkdirSync(elsewhere, { recursive: true });
      copyTranscript(m, session(b, "S16").sessionId, sid(201), elsewhere);
      const x = extractFor(m);
      expect(x.ok && x.bundle.unledgeredSessions).toEqual([]);
    });
  });
});

describe("the transcript index is exported from smoke_session_cleanup.ts and sees sidechains (one directory walk)", () => {
  test("indexTranscripts lists every main transcript and every <sid>/subagents/agent-*.jsonl under its parent's sid", async () => {
    const mod = (await import(CLEANUP_PATH)) as { indexTranscripts?: (dirs: string[]) => { sids: Set<string>; files: Array<{ sid: string; path: string }> } };
    expect(typeof mod.indexTranscripts, "smoke_session_cleanup.ts exports indexTranscripts").toBe("function");
    withTmp("ste617-idx-", (d) => {
      const b = buildPassingBundle("linear");
      const m = materialize(b, d);
      const idx = mod.indexTranscripts!([m.configDir]);
      for (const s of b.sessions) expect(idx.sids.has(s.sessionId)).toBe(true);
      const det = sessionsOf(b, "S10").find((s) => s.calls.some((c) => c.sidechain))!;
      const side = idx.files.filter((f) => f.path.includes(`${det.sessionId}/subagents/`));
      expect(side.map((f) => f.sid)).toEqual([det.sessionId]);
    });
  });
  test("the grader reaches transcripts through that index, never a walk of its own", () => {
    const src = readFileSync(GRADER_PATH, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\bindexTranscripts\b[^}]*\}\s*from\s*["']\.\/smoke_session_cleanup(?:\.ts)?["']/);
    expect(src.includes('"projects"') || src.includes("'projects'"), "the grader composes no <config>/projects path").toBe(false);
  });
});

// ===========================================================================
// AC.8 — aborts, each with its permit twin
// ===========================================================================

describe("AC.8 — abort outcomes and their permit twins", () => {
  test("zero scenarios observed (only the audits ran) aborts as no-scenarios", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, b.sessions.filter((s) => s.marker !== "audit").map((s) => s.sessionId));
    const v = grade(b);
    expect({ outcome: v.outcome, codes: codes(v).includes("no-scenarios") }).toEqual({ outcome: "abort", codes: true });
  });
  test("PERMIT TWIN — one scenario observed besides the audits is not no-scenarios (the rest are not-observed, so it fails)", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, b.sessions.filter((s) => s.marker !== "audit" && s.marker !== "S16").map((s) => s.sessionId));
    const v = grade(b);
    expect(codes(v)).not.toContain("no-scenarios");
    expect(v.outcome).toBe("fail");
  });
  test("a ledgered session with no session record aborts naming it", () => {
    const b = buildPassingBundle("jira");
    const ghost = sid(150);
    b.ledger.splice(3, 0, ghost);
    const v = grade(b);
    expect(v.outcome).toBe("abort");
    expect(namesSession(v, ghost)).toBe(true);
  });
  test("an unreadable receipts directory in a repository that made gated writes aborts as receipts-unreadable", () => {
    const b = buildPassingBundle("jira");
    b.repos.A.receipts = { readable: false, error: "EACCES: permission denied" };
    const v = grade(b);
    expect({ outcome: v.outcome, has: codes(v).includes("receipts-unreadable") }).toEqual({ outcome: "abort", has: true });
  });
  test("PERMIT TWIN — a READABLE but empty receipts directory is graded, not aborted: its writes are ungated, never receipted", () => {
    const b = buildPassingBundle("jira");
    b.repos.A.receipts = { readable: true, records: [] };
    const v = grade(b);
    expect(codes(v)).not.toContain("receipts-unreadable");
    expect(v.outcome).toBe("fail");
    expect(codes(v)).toContain("ungated-write");
  });
  test("a behaviour digest that differs between the run's start and its grading aborts as plugin-changed-mid-run", () => {
    const b = buildPassingBundle("linear");
    const v = grade(b, { behaviourDigestNow: "0".repeat(64) });
    expect({ outcome: v.outcome, has: codes(v).includes("plugin-changed-mid-run") }).toEqual({ outcome: "abort", has: true });
  });
  test("PERMIT TWIN — the same digest at start and at grading does not abort", () => {
    const v = grade(buildPassingBundle("linear"));
    expect(codes(v)).not.toContain("plugin-changed-mid-run");
  });
});

// ===========================================================================
// AC.3 — the spawn ceiling
// ===========================================================================

for (const t of TRACKERS) {
  describe(`AC.3 — ${t}: a run ledger over the registry-derived ceiling aborts`, () => {
    test("one row over the ceiling (a 29th ledgered session, fully recorded) aborts as spawn-overrun", () => {
      const b = buildPassingBundle(t);
      const extra = clone(session(b, "S16"));
      extra.sessionId = sid(99);
      extra.calls = extra.calls.map((c, i) => ({ ...c, ref: `${extra.sessionId}:toolu_9${i}` }));
      b.sessions.push(extra);
      b.ledger.push(extra.sessionId);
      expect(b.ledger.length).toBe(ceiling(t) + 1);
      const v = grade(b);
      expect({ outcome: v.outcome, has: codes(v).includes("spawn-overrun") }).toEqual({ outcome: "abort", has: true });
    });
    test("PERMIT TWIN — exactly at the ceiling is not an overrun", () => {
      const b = buildPassingBundle(t);
      expect(b.ledger.length).toBe(ceiling(t));
      expect(codes(grade(b))).not.toContain("spawn-overrun");
    });
  });
}

// ===========================================================================
// AC.17 — the run-wide checks, each on a bundle differing by the one defect
// ===========================================================================

// The two repoint inputs no Atlassian MCP tool can list (Jira statuses and
// labels) pass on a completeness the SESSION asserts, not one the tracker
// proves. The repoint receipt records which inputs rested on such a claim
// (`evidence.assertedCompleteness`), and the verdict must carry it: a pass that
// silently rests on an assertion is what this milestone removes.
// An INERT guard: with no team in a repository's binding, the create
// decision's team conjunct never enters its query, so the identifier-prefix
// team rule cannot fire on the live run. A passing run used to IMPLY the guard
// was live only because Linear rejects a create without `team` — an external
// invariant. The grade now reads it directly: every Linear create decision's
// recorded payload carries the run's team.
describe("the Linear team conjunct is shown live, not inferred", () => {
  const creates = (b: LiveBundle) => (["A", "B"] as const).flatMap((r) => {
    const set = b.repos[r].receipts;
    return set.readable ? set.records.filter((x) => x.kind === "create") : [];
  });
  test("PERMIT — every create decision of a passing Linear bundle carries the run's team", () => {
    expect(codes(grade(buildPassingBundle("linear")))).not.toContain("team-conjunct-inert");
  });
  test("REFUSE — a create decision whose payload carries no team fails as team-conjunct-inert, naming its receipt", () => {
    const b = buildPassingBundle("linear");
    const r = creates(b)[0]!;
    delete (r.evidence.createPayload as Record<string, unknown>).team;
    const f = findingsOf(grade(b), "team-conjunct-inert");
    expect(f.length).toBe(1);
    expect(f[0]!.detail).toContain(r.path);
  });
  test("REFUSE — a create decision carrying another team's key fails too", () => {
    const b = buildPassingBundle("linear");
    (creates(b)[0]!.evidence.createPayload as Record<string, unknown>).team = "OPS";
    expect(codes(grade(b))).toContain("team-conjunct-inert");
  });
  test("REFUSE — a Linear run with no create decision at all never showed the guard live", () => {
    const b = buildPassingBundle("linear");
    for (const r of ["A", "B"] as const) {
      const set = b.repos[r].receipts;
      if (set.readable) set.records = set.records.filter((x) => x.kind !== "create");
    }
    expect(findingsOf(grade(b), "team-conjunct-inert").some((f) => /never/.test(f.detail))).toBe(true);
  });
  test("a Jira run is never asked (Jira has no team)", () => {
    expect(codes(grade(buildPassingBundle("jira")))).not.toContain("team-conjunct-inert");
  });
});

describe("S8 — the verdict says which repoint inputs' completeness was asserted, not proven", () => {
  const repointReceipt = (b: LiveBundle) => {
    const set = b.repos.B.receipts;
    if (!set.readable) throw new Error("fixture: B's receipts unreadable");
    return set.records.find((r) => r.kind === "repoint")!;
  };
  test("Jira: the verdict names the asserted inputs from B's repoint receipt", () => {
    const b = buildPassingBundle("jira");
    expect(repointReceipt(b).evidence.assertedCompleteness).toEqual(["statuses", "labels"]);
    const v = grade(b);
    expect({ outcome: v.outcome, asserted: v.assertedCompleteness }).toEqual({ outcome: "pass", asserted: ["statuses", "labels"] });
  });
  test("Linear: every repoint input was proven by the tracker, so the verdict names none", () => {
    const v = grade(buildPassingBundle("linear"));
    expect({ outcome: v.outcome, asserted: v.assertedCompleteness }).toEqual({ outcome: "pass", asserted: [] });
  });
  test("REFUSE — a repoint receipt that does not record the field fails S8: it cannot say what the pass rested on", () => {
    const b = buildPassingBundle("jira");
    delete repointReceipt(b).evidence.assertedCompleteness;
    const v = grade(b);
    expect(failing(v)).toContain("S8");
    expect(v.scenarios.S8?.reason).toMatch(/assertedCompleteness/);
  });
  test("REFUSE — a field that is not a list of input names fails S8 too", () => {
    const b = buildPassingBundle("jira");
    repointReceipt(b).evidence.assertedCompleteness = "statuses";
    expect(failing(grade(b))).toContain("S8");
  });
  test("a Jira run with no repoint (S8 the named skip) carries no claim: null, not an empty list", () => {
    const b = buildPassingBundle("jira", { jiraRepointFrom: null });
    expect(grade(b).assertedCompleteness).toBeNull();
  });
});

describe("AC.17 — gated writes", () => {
  test("a successful create with no preceding front-door run in its session fails ungated-write naming that session", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S2");
    const receipt = s.calls[0]!.result.text.match(/dpt-receipt: (\S+)/)![1]!;
    s.calls.splice(0, 1);
    if (b.repos.A.receipts.readable) b.repos.A.receipts.records = b.repos.A.receipts.records.filter((r) => r.path !== receipt);
    const v = grade(b);
    expect(v.outcome).toBe("fail");
    expect(findingsOf(v, "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
    expect(codes(v)).not.toContain("unannounced-receipt");
  });
  test("ORDER — the front door AFTER the create (same records, swapped) fails ungated-write; BEFORE it passes", () => {
    const b = buildPassingBundle("linear");
    // calls[0] is the create decision, calls[1] the attach run, calls[2] the create (tests/_live_bundle_fixtures.ts frCreate).
    swapCalls(session(b, "S1"), 0, 2);
    const v = grade(b);
    expect(findingsOf(v, "ungated-write").some((f) => f.session === session(b, "S1").sessionId)).toBe(true);
    expect(codes(grade(buildPassingBundle("linear")))).not.toContain("ungated-write");
  });
  test("an announced receipt absent from the decided-for repository fails ungated-write", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S1", 1); // rooted in B
    const path = s.calls[0]!.result.text.match(/dpt-receipt: (\S+)/)![1]!;
    if (b.repos.B.receipts.readable) b.repos.B.receipts.records = b.repos.B.receipts.records.filter((r) => r.path !== path);
    expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
  });
  test("a receipt that records a different decision (another title) than the write carries fails ungated-write", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S2", 1);
    const path = s.calls[0]!.result.text.match(/dpt-receipt: (\S+)/)![1]!;
    const rec = b.repos.B.receipts.readable ? b.repos.B.receipts.records.find((r) => r.path === path)! : null;
    (rec!.evidence.createPayload as Record<string, unknown>).title = title("some other title");
    rec!.subject = title("some other title");
    expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
  });
  test("a create receipt announced by gate_receipt.ts (outside RECEIPT_ANNOUNCING_MODULES, not its writer) gates nothing (ungated-write) and is unannounced (unannounced-receipt)", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S2");
    const path = s.calls[0]!.result.text.match(/dpt-receipt: (\S+)/)![1]!;
    s.calls[0]!.input.command = String(s.calls[0]!.input.command).replace("create_idempotency_probe.ts\" decide", "gate_receipt.ts\" gate-check");
    expect(String(s.calls[0]!.input.command), "CONTROL — the swap applied").toContain("gate_receipt.ts\" gate-check");
    const v = grade(b);
    expect(findingsOf(v, "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
    expect(
      findingsOf(v, "unannounced-receipt").map((f) => f.item),
      "a create receipt counts as announced only by create_idempotency_probe.ts decide, its writer",
    ).toEqual([path]);
  });

  function addUngatedCreate(b: LiveBundle, target: BundleSession, summary: string): void {
    const t = b.run.tracker;
    const key = t === "jira" ? "DST-180" : "STE-980";
    const item: TrackerItem = { key, summary, labels: [TAG_A], status: t === "jira" ? "To Do" : "Todo", parent: null, milestone: null, issueType: t === "jira" ? "Task" : null, kind: "issue", container: b.run.container };
    const last = target.calls.at(-1)!;
    const call: ToolCall = {
      ref: `${target.sessionId}:toolu_777`,
      at: new Date(Date.parse(last.at) + 1000).toISOString(),
      name: `${serverPrefix(t, target.root)}${t === "jira" ? "createJiraIssue" : "save_issue"}`,
      input: t === "jira" ? { cloudId: "cloud-dst", projectKey: b.run.container, issueTypeName: "Task", summary, additional_fields: { labels: [TAG_A] } } : { team: "STE", project: b.run.container, title: summary, labels: [TAG_A] },
      result: { isError: false, text: "", exitCode: null, items: [item], lastPage: null },
      sidechain: false,
    };
    target.calls.push(call);
    addToAudit(b, item);
  }

  // Container-class writes. The hook gates them by policy, not by receipt
  // (gateContainer): in a declared container it permits one — a label create
  // whose name is a declared repository tag — and refuses every other project,
  // label, status-update, document or milestone-edit write outright. So a
  // SUCCESSFUL container write in a gated session is ungated unless it is that
  // one permitted write. Linear only: Jira's one container-class tool is the
  // Epic create, graded by the milestone arm.
  function addContainerWrite(b: LiveBundle, target: BundleSession, tool: string, input: Record<string, unknown>, isError = false): void {
    const last = target.calls.at(-1)!;
    target.calls.push({
      ref: `${target.sessionId}:toolu_778`,
      at: new Date(Date.parse(last.at) + 1000).toISOString(),
      name: `${serverPrefix("linear", target.root)}${tool}`,
      input,
      result: { isError, text: isError ? "Error: 400 Bad Request" : "{}", exitCode: null, items: null, lastPage: null },
      sidechain: false,
    });
  }
  for (const [label, tool, input] of [
    ["a project edit", "save_project", { id: "proj-1", name: "renamed" }],
    ["a project create", "save_project", { name: "another project", team: "STE" }],
    ["a status update", "save_status_update", { project: "shared", body: "on track" }],
    ["a document", "save_document", { project: "shared", title: "notes", content: "x" }],
    ["a milestone edit", "save_milestone", { id: "ms-1", project: "shared", name: "renamed" }],
    ["a label create naming no repository tag", "create_issue_label", { name: "other-tag", teamId: "team-1" }],
    ["a label rename", "save_issue_label", { id: "lbl-1", name: TAG_A }],
    ["a label retire", "retire_issue_label", { id: "lbl-1" }],
  ] as const) {
    test(`CONTAINER — a successful ${label} in a tree session fails ungated-write naming that session`, () => {
      const b = buildPassingBundle("linear");
      const s = session(b, "S1");
      addContainerWrite(b, s, tool, { ...input });
      expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s.sessionId && f.tool?.endsWith(tool))).toBe(true);
    });
  }
  test("CONTAINER PERMIT — a label create whose name is A's repository tag is not ungated-write", () => {
    const b = buildPassingBundle("linear");
    addContainerWrite(b, session(b, "S1"), "create_issue_label", { name: TAG_A, teamId: "team-1" });
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  test("CONTAINER PERMIT — save_issue_label with NO id naming A's tag (the MCP's non-deprecated create) is not ungated-write", () => {
    const b = buildPassingBundle("linear");
    addContainerWrite(b, session(b, "S1"), "save_issue_label", { name: TAG_A, teamId: "team-1" });
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  for (const [label, extra] of [["a label GROUP", { isGroup: true }], ["a label nested under a parent group", { parent: "some-group" }]] as const) {
    test(`CONTAINER — save_issue_label creating ${label} named A's tag is ungated-write (only a plain label is permitted)`, () => {
      const b = buildPassingBundle("linear");
      const s = session(b, "S1");
      addContainerWrite(b, s, "save_issue_label", { name: TAG_A, teamId: "team-1", ...extra });
      expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
    });
  }
  test("CONTAINER — save_issue_label with no id naming no repository tag is ungated-write", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S1");
    addContainerWrite(b, s, "save_issue_label", { name: "other-tag", teamId: "team-1" });
    expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s.sessionId)).toBe(true);
  });
  test("CONTAINER PERMIT — a label create whose name is B's repository tag is not ungated-write", () => {
    const b = buildPassingBundle("linear");
    addContainerWrite(b, session(b, "S1"), "create_issue_label", { name: TAG_B, teamId: "team-1" });
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  test("CONTAINER PERMIT — a container write the tracker REJECTED (is_error) is not ungated-write", () => {
    const b = buildPassingBundle("linear");
    addContainerWrite(b, session(b, "S1"), "save_project", { id: "proj-1", name: "renamed" }, true);
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  test("CONTAINER EXEMPTION — a container write in the OLD-CLIENT session is not ungated-write", () => {
    const b = buildPassingBundle("linear");
    addContainerWrite(b, sessionsOf(b, "S10").find((x) => x.client === "old-client")!, "save_status_update", { project: "shared", body: "x" });
    expect(codes(grade(b))).not.toContain("ungated-write");
  });

  test("EXEMPTION — an ungated create in the OLD-CLIENT session is not ungated-write (graded by the detector instead)", () => {
    const b = buildPassingBundle("jira");
    const old = sessionsOf(b, "S10").find((s) => s.client === "old-client")!;
    addUngatedCreate(b, old, title("old client second write"));
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  test("EXEMPTION — an ungated create in the INTRUDER session is not ungated-write", () => {
    const b = buildPassingBundle("jira");
    addUngatedCreate(b, session(b, "intruder"), title("intruder second write"));
    expect(codes(grade(b))).not.toContain("ungated-write");
  });
  test("the exemption does NOT reach any other session: the same create in S10's tree-client detector session fails ungated-write", () => {
    const b = buildPassingBundle("jira");
    const det = sessionsOf(b, "S10").find((s) => s.client === "tree")!;
    addUngatedCreate(b, det, title("detector session write"));
    expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === det.sessionId)).toBe(true);
  });
  test("the exemption does NOT reach a below-floor session either", () => {
    const b = buildPassingBundle("linear");
    const s6 = session(b, "S6");
    addUngatedCreate(b, s6, title("below-floor write through"));
    expect(findingsOf(grade(b), "ungated-write").some((f) => f.session === s6.sessionId)).toBe(true);
  });
});

// P1 (audit round 2) — the ninth fail-open: a write on a ticket OUTSIDE the run.
//
// `keys` was `subjectKeys(c).filter(inRunContainers)`, and the branches covered
// "no resolvable key" and "at least one key in the containers". A write naming
// real keys of which NONE is in the run's containers satisfied neither, so `why`
// stayed null and it graded as GATED. That is a successful write on a ticket
// belonging to someone else in the shared space, passing ungraded — the exact
// harm this programme exists to rule out, and a pass carrying it would claim
// "no ungated writes" while having checked only the in-container ones.
//
// Jira-only by construction: `inRunContainers` is true for every Linear key,
// because a Linear run has one team, so the gap cannot arise there. The linear
// row below is the control that says so rather than leaving it to be assumed.
describe("P1 — a write on a ticket outside the run's containers is ungated", () => {
  /**
   * S13's SUCCESSFUL edit, repointed at `key`. Deliberately not S9's, which is
   * a refused write (`is_error`) — this predicate grades successful writes, so
   * a row built on the refusal would have proved nothing about either branch.
   */
  const withSubject = (key: string) => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S13");
    const call = s.calls.find((c) => /editJiraIssue$/.test(c.name) && !c.result.isError)!;
    expect(call, "the fixture has a successful ticket edit to repoint").toBeDefined();
    call.input = { ...call.input, issueIdOrKey: key };
    return { b, s, call };
  };

  test("HARM — the same edit aimed at a key in NEITHER the shared nor the repoint-from space is a finding naming it", () => {
    const { b, s } = withSubject("OTHER-5");
    const f = findingsOf(grade(b), "ungated-write").filter((x) => x.session === s.sessionId);
    expect(f.length, "the write is graded").toBeGreaterThan(0);
    expect(f.map((x) => x.detail).join("\n"), "and the finding names the key").toContain("OTHER-5");
    expect(f.map((x) => x.detail).join("\n"), "and says what it is outside of").toMatch(/DST|container/);
  });

  test("PERMIT TWIN — the same edit on its own in-container key is not a finding", () => {
    const { b, s } = withSubject("DST-101");
    expect(findingsOf(grade(b), "ungated-write").filter((x) => x.session === s.sessionId)).toEqual([]);
  });

  test("PERMIT TWIN — a key in the REPOINT-FROM space is in the run's containers, not outside them", () => {
    const { b } = withSubject("DST2-9");
    const f = findingsOf(grade(b), "ungated-write").map((x) => x.detail).join("\n");
    expect(f, "it is graded by ownership, not by the outside-the-run rule").not.toContain("outside this run");
  });

  test("CONTROL — on Linear every key is in the run's single team, so the outside-the-run rule cannot fire", () => {
    const b = buildPassingBundle("linear");
    const s = b.sessions.find((x) => x.marker === "S9")!;
    const call = s.calls.find((c) => /save_issue$/.test(c.name));
    if (call) call.input = { ...call.input, id: "ZZZ-999" };
    expect(findingsOf(grade(b), "ungated-write").map((x) => x.detail).join("\n")).not.toContain("outside this run");
  });
});

describe("AC.17 — unannounced receipts", () => {
  function plantReceipt(b: LiveBundle, sessionId: string): string {
    const path = `<A>/.dpt/ledger/receipts/${sessionId}/create-99.json`;
    if (b.repos.A.receipts.readable) {
      b.repos.A.receipts.records.push({
        path,
        sessionId,
        sha256: sha256(path),
        kind: "create",
        adapter: b.run.tracker,
        container: b.run.container,
        subject: title("planted"),
        decision: "create",
        evidence: { createPayload: { title: title("planted") } },
      });
    }
    return path;
  }
  test("a tracker receipt on disk that no front-door run announced fails unannounced-receipt naming it", () => {
    const b = buildPassingBundle("jira");
    const path = plantReceipt(b, session(b, "S4").sessionId);
    const v = grade(b);
    expect(v.outcome).toBe("fail");
    expect(findingsOf(v, "unannounced-receipt").some((f) => JSON.stringify(f).includes(path))).toBe(true);
  });
  test("PERMIT TWIN — the same receipt announced by a front-door module run is not unannounced", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_555`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      input: { command: 'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/create_idempotency_probe.ts" decide <A> --title-file <A>/.dpt/tmp/t.txt', description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(codes(grade(b))).not.toContain("unannounced-receipt");
  });
  // AC-STE-617.20 (live leg 3, 2026-09-23). The document's spawn contract ORDERS
  // every child to run modules from its client's ABSOLUTE path — SKILL.md § step
  // prompt: `bun "${STEP_PLUGIN}/adapters/_shared/src/<name>.ts"`, because
  // "$CLAUDE_PLUGIN_ROOT is empty inside a Bash call" — which the bundle redacts
  // to `<toolkit>/plugins/dev-process-toolkit/…` for the tree client and to a
  // `/tmp/…` path for the below-floor copy. The grader recognised ONLY the
  // `${CLAUDE_PLUGIN_ROOT}` spelling, the one the document FORBIDS, so it
  // discarded every announcement a compliant child could make and graded perfect
  // compliance as forgery: leg 3 shasum'd two announced receipts byte-identical
  // against disk and still drew 4× unannounced-receipt and 2× ungated-write.
  //
  // The commands below are REAL, lifted verbatim from leg 3's committed bundle.
  // That is load-bearing rather than decorative: every pre-existing row here
  // builds its input through the fixtures' `MODULE()` helper, which emits the
  // `${CLAUDE_PLUGIN_ROOT}` spelling — the only spelling the predicate could
  // accept. A suite written that way cannot fail, because every input it can
  // construct is one the predicate was written to accept. Note also that a real
  // command is UNQUOTED (`bun run <toolkit>/…`), so the shell grammar would read
  // `<` as a redirect unless the token is spelled back as a plain word first.
  const realRun = (module: string, sub: string, arg: string) =>
    `bun run <toolkit>/plugins/dev-process-toolkit/adapters/_shared/src/${module} ${sub} <B> ${arg} --title "shr2a79c78c S8 legacy item"`;

  test("a receipt announced by a REAL absolute-path module run (the spelling the document mandates) is not unannounced", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_5e1`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      input: { command: realRun("create_idempotency_probe.ts", "decide", "<B>/.dpt/scratch/s8/probe-fast.json"), description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(codes(grade(b))).not.toContain("unannounced-receipt");
  });

  test("the BARE `bun <abs path>` form announces too — leg 3 recorded both it and `bun run <abs path>`", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_5e4`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      // No `run` hop. Both forms occur in leg 3's records, so both are pinned:
      // otherwise a later edit to the `words[1] === "run"` hop breaks the bare
      // form silently, and only a live leg would find it.
      input: { command: 'bun <toolkit>/plugins/dev-process-toolkit/adapters/_shared/src/create_idempotency_probe.ts decide <B> --title "shr2a79c78c S8 legacy item"', description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(codes(grade(b))).not.toContain("unannounced-receipt");
  });

  test("REFUSAL TWIN — the same real command with its module path removed announces nothing: still unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_5e2`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      // Differs from the permit row in exactly one variable: the target is no
      // longer a toolkit module directory. Everything else — plain single bun
      // command, absolute path, same subcommand, same announcement — is equal.
      input: { command: 'bun run <toolkit>/plugins/dev-process-toolkit/scripts/not_a_module.ts decide <B> --title "x"', description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(findingsOf(grade(b), "unannounced-receipt").some((f) => JSON.stringify(f).includes(path))).toBe(true);
  });

  test("REFUSAL TWIN — a module run from INSIDE a throwaway repository is not a run of the toolkit under test: still unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_5e5`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      // CONSTRUCTED, not measured: leg 3 aborted at step 2 and recorded no such
      // command. It is the case the suffix match would otherwise admit — a
      // child that copied the adapters into its own repo and ran them there,
      // which the step prompt forbids and which satisfies every other test
      // (absolute, one plain bun, right suffix).
      input: { command: 'bun run <B>/adapters/_shared/src/create_idempotency_probe.ts decide <B> --title "x"', description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(findingsOf(grade(b), "unannounced-receipt").some((f) => JSON.stringify(f).includes(path))).toBe(true);
  });

  test("REFUSAL TWIN — a relative module path is a path the child resolved itself, which the step prompt forbids: still unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_5e3`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      input: { command: 'bun run adapters/_shared/src/create_idempotency_probe.ts decide <B> --title "x"', description: "run" },
      result: { isError: false, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(findingsOf(grade(b), "unannounced-receipt").some((f) => JSON.stringify(f).includes(path))).toBe(true);
  });

  test("an announcement ECHOED by a non-toolkit command announces nothing: still unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantReceipt(b, s.sessionId);
    s.calls.push({
      ref: `${s.sessionId}:toolu_556`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      input: { command: `echo "dpt-receipt: ${path} sha256:${sha256(path)}"`, description: "run" },
      result: { isError: false, text: `dpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    expect(findingsOf(grade(b), "unannounced-receipt").some((f) => JSON.stringify(f).includes(path))).toBe(true);
  });
  test("EXEMPTION — an unannounced receipt written by the old-client session is not unannounced-receipt; the same in a tree session is", () => {
    const old = buildPassingBundle("jira");
    plantReceipt(old, sessionsOf(old, "S10").find((s) => s.client === "old-client")!.sessionId);
    expect(codes(grade(old))).not.toContain("unannounced-receipt");
    const tree = buildPassingBundle("jira");
    plantReceipt(tree, sessionsOf(tree, "S10").find((s) => s.client === "tree")!.sessionId);
    expect(codes(grade(tree))).toContain("unannounced-receipt");
  });
});

// ===========================================================================
// AC.17 — a receipt counts as announced only by the module that writes it
// ===========================================================================

/**
 * Each tracker receipt kind and the module run that writes and announces it,
 * read from the modules' own `writeReceipt({ kind: … })` calls (the source test
 * below re-reads them). `args` is an accepted-shape argv after the module (and
 * its subcommand). Gate receipts (`adapter: null`) are out of scope.
 */
const WRITER_TABLE: ReadonlyArray<{ kind: string; module: string; subcommand: string | null; args: string }> = [
  { kind: "create", module: "create_idempotency_probe.ts", subcommand: "decide", args: "<A> --title-file <A>/.dpt/tmp/t.txt" },
  { kind: "reuse", module: "create_idempotency_probe.ts", subcommand: "decide", args: "<A> --title-file <A>/.dpt/tmp/t.txt" },
  { kind: "milestone-decision", module: "resolve_milestone_identity.ts", subcommand: null, args: '<A> jira DST <A>/.dpt/tmp/listing.json --title "planted"' },
  { kind: "binding", module: "ticket_ownership.ts", subcommand: "confirm", args: "<A> DST-1" },
  { kind: "import", module: "container_ownership.ts", subcommand: "consent", args: "<A> DST-1 <A>/.dpt/tmp/page.json" },
  { kind: "attach-target", module: "attach_project_milestone.ts", subcommand: null, args: "<A> jira DST <A>/specs/plan/M_x.md <A>/.dpt/tmp/listing.json" },
  { kind: "repoint", module: "repoint_tracker_binding.ts", subcommand: null, args: "<A> jira DST --peer <B>" },
];
/** The module the tracker-write hook does not list but the grader must: repoint receipts are written outside the hook's gate. */
const REPOINT_MODULE = "repoint_tracker_binding.ts";

const moduleCommand = (module: string, subcommand: string | null, args: string): string =>
  `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${module}" ${subcommand ? `${subcommand} ` : ""}${args}`;

/** A receipt of `kind` in `s`'s repository, announced by one Bash run of `command`. Returns its path. */
function plantAnnounced(b: LiveBundle, s: BundleSession, kind: string, command: string): string {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/${kind}-planted.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({ path, sessionId: s.sessionId, sha256: sha256(path), kind, adapter: b.run.tracker, container: b.run.container, subject: title("planted"), decision: kind, evidence: {} });
  s.calls.push({
    ref: `${s.sessionId}:toolu_planted_${kind}`,
    at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
    name: "Bash",
    input: { command, description: "run" },
    result: { isError: false, text: `decided\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null },
    sidechain: false,
  });
  return path;
}

/** Hook modules missing from the grader's gated-kind writers, and writer modules the hook does not list (repoint excepted). */
function writerDrift(writers: Readonly<Record<string, { module: string; subcommand: string | null }>>, hookModules: readonly string[], hookSubs: Readonly<Record<string, string | null>>): string[] {
  const gated = Object.values(writers).filter((w) => w.module !== REPOINT_MODULE);
  const mine = new Set(gated.map((w) => w.module));
  const errors: string[] = [];
  for (const m of hookModules) if (!mine.has(m)) errors.push(`the hook lists ${m}; the grader's writer map does not`);
  for (const m of mine) if (!hookModules.includes(m)) errors.push(`the grader's writer map lists ${m}; the hook does not`);
  for (const w of gated) if (hookModules.includes(w.module) && hookSubs[w.module] !== w.subcommand) errors.push(`${w.module}: the grader expects subcommand ${w.subcommand}, the hook ${hookSubs[w.module]}`);
  return errors;
}

describe("AC.17 — a receipt counts as announced only by its writer", () => {
  test("the grader's RECEIPT_WRITERS maps every tracker receipt kind to its writing module and subcommand", () => {
    const expected = Object.fromEntries(WRITER_TABLE.map((w) => [w.kind, { module: w.module, subcommand: w.subcommand }]));
    expect(grader().RECEIPT_WRITERS).toEqual(expected);
  });
  test("each kind is the literal its module passes to writeReceipt (kinds followed from the code)", () => {
    for (const w of WRITER_TABLE) {
      const src = readFileSync(join(pluginRoot, "adapters", "_shared", "src", w.module), "utf-8");
      expect(new RegExp(`kind:[^,\\n]*"${w.kind}"`).test(src), `${w.module} writes kind "${w.kind}"`).toBe(true);
    }
  });
  test("CONTROL — the kind-literal check fails on a near-miss name (\"attach\" for attach-target)", () => {
    const src = readFileSync(join(pluginRoot, "adapters", "_shared", "src", "attach_project_milestone.ts"), "utf-8");
    expect(/kind:[^,\n]*"attach"/.test(src)).toBe(false);
  });

  test("DRIFT GUARD — the grader's writer modules for hook-gated kinds equal the hook's RECEIPT_ANNOUNCING_MODULES (with the same subcommands); repoint_tracker_binding.ts is the one named extra", () => {
    const writers = grader().RECEIPT_WRITERS;
    expect(Object.values(writers ?? {}).map((w) => w.module), "the repoint module is in the grader's map").toContain(REPOINT_MODULE);
    expect(RECEIPT_ANNOUNCING_MODULES, "the hook does not list the repoint module").not.toContain(REPOINT_MODULE);
    expect(writerDrift(writers ?? {}, RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS)).toEqual([]);
  });
  test("CONTROL — the drift guard names a hook module the map lacks, a stray map module, and a subcommand mismatch", () => {
    const base = Object.fromEntries(WRITER_TABLE.map((w) => [w.kind, { module: w.module, subcommand: w.subcommand }]));
    expect(writerDrift(base, RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS), "the table itself agrees").toEqual([]);
    const { binding: _b, ...lacking } = base;
    expect(writerDrift(lacking, RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS)).toEqual(["the hook lists ticket_ownership.ts; the grader's writer map does not"]);
    const stray = { ...base, gate: { module: "gate_receipt.ts", subcommand: "gate-check" } };
    expect(writerDrift(stray, RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS)).toEqual(["the grader's writer map lists gate_receipt.ts; the hook does not"]);
    const wrongSub = { ...base, import: { module: "container_ownership.ts", subcommand: "list" } };
    expect(writerDrift(wrongSub, RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS)).toEqual(["container_ownership.ts: the grader expects subcommand list, the hook consent"]);
  });

  test("PERMIT TWIN — the passing bundle as is (each receipt announced by its own writer, the repoint receipt by repoint_tracker_binding.ts) has no unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const kinds = new Set((b.repos.A.receipts.readable ? b.repos.A.receipts.records : []).concat(b.repos.B.receipts.readable ? b.repos.B.receipts.records : []).filter((r) => r.adapter !== null).map((r) => r.kind));
    expect([...kinds].sort(), "CONTROL — the passing bundle carries these tracker receipt kinds").toEqual(["attach-target", "create", "import", "milestone-decision", "repoint"]);
    expect(codes(grade(b))).not.toContain("unannounced-receipt");
  });

  WRITER_TABLE.forEach((w, i) => {
    // The next writer (cyclically) whose module differs: every module stands in for another once.
    const rotated = [...WRITER_TABLE.slice(i + 1), ...WRITER_TABLE.slice(0, i)];
    const other = rotated.find((x) => x.module !== w.module)!;
    test(`${w.kind} — announced by ${other.module} (another writer) fails unannounced-receipt naming it; announced by ${w.module} (its writer) does not`, () => {
      const cross = buildPassingBundle("jira");
      const pathX = plantAnnounced(cross, session(cross, "S4"), w.kind, moduleCommand(other.module, other.subcommand, other.args));
      expect(findingsOf(grade(cross), "unannounced-receipt").map((f) => f.item)).toEqual([pathX]);
      const own = buildPassingBundle("jira");
      plantAnnounced(own, session(own, "S4"), w.kind, moduleCommand(w.module, w.subcommand, w.args));
      expect(codes(grade(own))).not.toContain("unannounced-receipt");
    });
    if (w.subcommand !== null) {
      test(`${w.kind} — announced by ${w.module} under a subcommand other than ${w.subcommand} fails unannounced-receipt`, () => {
        const b = buildPassingBundle("jira");
        const path = plantAnnounced(b, session(b, "S4"), w.kind, moduleCommand(w.module, "normalize", w.args));
        expect(findingsOf(grade(b), "unannounced-receipt").map((f) => f.item)).toEqual([path]);
      });
    }
  });

  test("an ECHOED announcement by the right writer's name still announces nothing: unannounced-receipt", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantAnnounced(b, s, "import", `echo ${moduleCommand("container_ownership.ts", "consent", "<A> DST-1 <A>/.dpt/tmp/page.json")}`);
    expect(findingsOf(grade(b), "unannounced-receipt").map((f) => f.item)).toEqual([path]);
  });
});

describe("AC.17 — listing provenance (MI-5)", () => {
  function receiptOf(b: LiveBundle, s: BundleSession) {
    const path = s.calls.map((c) => c.result.text.match(/dpt-receipt: (\S+)/)?.[1]).find(Boolean)!;
    const set = b.repos[s.root].receipts;
    return set.readable ? set.records.find((r) => r.path === path)! : null;
  }
  test("a milestone receipt whose listing matches no recorded last-page listing fails unlisted-decision", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S3");
    ((receiptOf(b, s)!.evidence.listing as { rowKeys: string[] }).rowKeys = ["DST-999"]);
    const v = grade(b);
    expect(findingsOf(v, "unlisted-decision").some((f) => namesSession({ findings: [f] }, s.sessionId))).toBe(true);
  });
  test("a listing recorded only as a NON-last page does not count: unlisted-decision", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S3", 1);
    s.calls[0]!.result.lastPage = false;
    expect(findingsOf(grade(b), "unlisted-decision").some((f) => namesSession({ findings: [f] }, s.sessionId))).toBe(true);
  });
  test("a matching listing recorded in ANOTHER session does not count: unlisted-decision", () => {
    const b = buildPassingBundle("jira");
    const s3b = session(b, "S3", 1);
    const listing = s3b.calls.splice(0, 1)[0]!;
    const other = session(b, "S14");
    other.calls.unshift({ ...listing, ref: `${other.sessionId}:toolu_000` });
    expect(findingsOf(grade(b), "unlisted-decision").some((f) => namesSession({ findings: [f] }, s3b.sessionId))).toBe(true);
  });
  test("ORDER — the listing AFTER the decision fails unlisted-decision; BEFORE it (the passing bundle) does not", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S3");
    swapCalls(s, 0, 1);
    expect(findingsOf(grade(b), "unlisted-decision").some((f) => namesSession({ findings: [f] }, s.sessionId))).toBe(true);
    expect(codes(grade(buildPassingBundle("linear")))).not.toContain("unlisted-decision");
  });
});

describe("AC.17 — audit completeness", () => {
  for (const t of TRACKERS) {
    test(`${t}: an audit query that differs from its fence's by one byte aborts audit-incomplete`, () => {
      const b = buildPassingBundle(t);
      const first = audits(b)[0]!.calls[0]!;
      if (t === "jira") first.input.jql = `${first.input.jql} `;
      else first.input.query = `${first.input.query} `;
      const v = grade(b);
      expect({ outcome: v.outcome, has: codes(v).includes("audit-incomplete") }).toEqual({ outcome: "abort", has: true });
    });
    test(`${t}: an audit that stops short of its last page aborts audit-incomplete`, () => {
      const b = buildPassingBundle(t);
      const a = audits(b)[0]!;
      const i = a.calls.findIndex((c) => c.result.lastPage === true);
      a.calls.splice(i, 1);
      const v = grade(b);
      expect({ outcome: v.outcome, has: codes(v).includes("audit-incomplete") }).toEqual({ outcome: "abort", has: true });
    });
    test(`${t}: an audit missing one key a scenario created aborts audit-incomplete naming it`, () => {
      const b = buildPassingBundle(t);
      const key = createdKeys(session(b, "S1"))[0]!;
      dropFromAudit(b, key);
      const v = grade(b);
      expect(v.outcome).toBe("abort");
      expect(findingsOf(v, "audit-incomplete").some((f) => JSON.stringify(f).includes(key))).toBe(true);
    });
    test(`${t}: PERMIT TWIN — the byte-equal query paged to its last page and holding every created key passes`, () => {
      expect(codes(grade(buildPassingBundle(t)))).not.toContain("audit-incomplete");
    });
  }
});

// ===========================================================================
// AC.10 — predicates: order cases graded both ways, and named not-observed cases
// ===========================================================================

describe("AC.10 — scenario predicates, both orders", () => {
  // S1 (live leg 4, 2026-09-24). `createdTitles` collects the title of EVERY
  // successful create and has no issue-type filter, so the milestone EPIC's
  // title enters the set beside the FR titles. `sameTitle` then requires two
  // NON-Epic items per title, which an Epic title can never have — so S1 failed
  // by construction on every run that minted a milestone, which is every run.
  // One collector is type-blind and its consumer is type-strict, and nothing
  // reconciled them.
  //
  // Fixed in the CONSUMER, not the collector: `createdTitles`' other caller
  // (`sameTitleBindsDifferentKeys`) looks FR bindings up BY TITLE, so an Epic
  // title finds nothing there and a type-aware collector would buy it nothing
  // while changing a shared helper for one caller's benefit.
  function mintEpicInto(b: LiveBundle, marker: string, epicTitle: string, inAudit: boolean, issueType = "Epic") {
    const s = session(b, marker);
    const epic = {
      key: "DST-9001", summary: epicTitle, labels: [] as string[], status: "To Do",
      parent: null, milestone: null, issueType, kind: "issue" as const, container: b.run.container,
    };
    s.calls.push({
      ref: `${s.sessionId}:toolu_epic`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: `${serverPrefix("jira", "A")}createJiraIssue`,
      input: { cloudId: "cloud-dst", projectKey: b.run.container, issueTypeName: issueType, summary: epicTitle },
      result: { isError: false, text: "created", exitCode: 0, items: [epic], lastPage: null },
      sidechain: false,
    } as never);
    if (inAudit) {
      const audit = b.sessions.find((x) => x.marker === "audit")!;
      audit.calls[0]!.result.items = [...(audit.calls[0]!.result.items ?? []), epic] as never;
    }
    return epicTitle;
  }

  // The quiet half of the compound-command refusal (live leg 4): 20 real module
  // runs were discarded and the instrument said nothing, so "no detector run is
  // recorded" read as "the child never ran it". The refusal STAYS — a recorded
  // exitCode belongs to the command's last segment, and seven consumers gate on
  // an exact exit code — but it now speaks.
  function pushBash(b: LiveBundle, marker: string, ref: string, command: string) {
    const s = session(b, marker);
    s.calls.push({
      ref: `${s.sessionId}:${ref}`,
      at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
      name: "Bash",
      input: { command, description: "run" },
      result: { isError: false, text: "ok", exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    } as never);
  }
  const REAL_RUN = 'bun "<toolkit>/plugins/dev-process-toolkit/adapters/_shared/src/tracker_local_reconciliation_drift.ts" <A> /tmp/p1.json';

  test("a module run behind a trailing `echo` is OBSERVED as discarded — and does not change the verdict", () => {
    const clean = grade(buildPassingBundle("jira"));
    const b = buildPassingBundle("jira");
    // Verbatim shape from leg 4, echo included: the idiom that hid 20 runs.
    pushBash(b, "S4", "toolu_disc", `${REAL_RUN}; echo "exit=$?"`);
    const v = grade(b);
    expect((v.observations ?? []).some((o) => o.code === "discarded-module-run")).toBe(true);
    expect(String((v.observations ?? []).map((o) => o.detail))).toContain("tracker_local_reconciliation_drift.ts");
    expect(v.outcome, "an observation must never change a verdict").toBe(clean.outcome);
    expect(codes(v)).not.toContain("discarded-module-run");
  });

  test("REFUSAL TWIN — a PLAIN run is not reported as discarded, because nothing discarded it", () => {
    const b = buildPassingBundle("jira");
    pushBash(b, "S4", "toolu_plain", REAL_RUN);
    expect((grade(b).observations ?? []).some((o) => o.code === "discarded-module-run")).toBe(false);
  });

  test("the SAME defect through git is observed too: two subcommands in one call, only the first read", () => {
    const b = buildPassingBundle("jira");
    // Verbatim shape from S17: the merge is credited, the aliased commit after
    // the `;` is invisible, because gitSubcommand returns the FIRST match for
    // the whole string. Different mechanism from the module case — here the
    // exit code is irrelevant — so it is reported separately.
    pushBash(b, "S4", "toolu_git2", 'git -C <B> merge --no-ff feature-s17 -m "m"; echo "exit=$?"; git -C <B> ci --allow-empty -m "aliased"');
    const obs = grade(b).observations ?? [];
    expect(obs.some((o) => o.code === "discarded-git-run")).toBe(true);
    expect(String(obs.map((o) => o.detail))).toContain("merge");
  });

  test("REFUSAL TWIN — ONE git subcommand per call is not observed, however many echoes ride with it", () => {
    const b = buildPassingBundle("jira");
    pushBash(b, "S4", "toolu_git1", 'git -C <B> merge --no-ff feature-s17 -m "m"; echo "exit=$?"');
    expect((grade(b).observations ?? []).some((o) => o.code === "discarded-git-run")).toBe(false);
  });

  test("REFUSAL TWIN — a heredoc WRITING that command is data, not a discarded run", () => {
    const b = buildPassingBundle("jira");
    // The conflation this programme lost five separate times: a command inside
    // a `cat > file <<EOF` body is being written, not run.
    pushBash(b, "S4", "toolu_heredoc", `cat > /tmp/x.sh <<'EOF'\n${REAL_RUN}\nEOF`);
    expect((grade(b).observations ?? []).some((o) => o.code === "discarded-module-run")).toBe(false);
  });

  // S4's recall half is a loop over the intruder's keys, and over an empty list
  // it never executes. On live leg 4 the intruder created nothing, so "names
  // the intruder as unattributed" passed VACUOUSLY inside a scenario that
  // failed for an unrelated reason — the vacuity was invisible because the
  // scenario was already red.
  test("S4 — with no intruder item the recall half is never exercised, and the scenario says so instead of passing it", () => {
    const b = buildPassingBundle("jira");
    const intruder = b.sessions.find((x) => x.marker === "intruder")!;
    // Remove only the intruder's creates: every other check of S4 still runs.
    intruder.calls = intruder.calls.filter((c) => !/create|save_issue/i.test(c.name)) as never;
    const v = grade(b);
    expect(v.scenarios.S4!.outcome).toBe("not-observed");
    expect(String(v.scenarios.S4!.reason)).toContain("never exercised");
  });

  test("PERMIT TWIN — with the intruder's item present S4 passes, and the recall half is what it passed on", () => {
    expect(failing(grade(buildPassingBundle("jira")))).not.toContain("S4");
  });

  test("S1 — a title created by the milestone EPIC is not an FR title and does not fail S1", () => {
    const b = buildPassingBundle("jira");
    mintEpicInto(b, "S1", title("S1 milestone"), true);
    expect(failing(grade(b))).not.toContain("S1");
  });

  test("REFUSAL TWIN — a NON-Epic create whose title the audit does not hold still fails S1", () => {
    const b = buildPassingBundle("jira");
    // Differs in exactly one variable: the issue type. A non-Epic title with no
    // matching audit items is a real problem and must keep failing.
    mintEpicInto(b, "S1", title("S1 stray task"), false, "Task");
    expect(failing(grade(b))).toContain("S1");
  });

  test("REFUSAL TWIN — an EPIC title the audit does NOT hold still fails S1: the skip needs the Epic in evidence", () => {
    const b = buildPassingBundle("jira");
    mintEpicInto(b, "S1", title("S1 unseen milestone"), false);
    expect(failing(grade(b))).toContain("S1");
  });

  test("S13 ORDER — the import AFTER the answered `Import <KEY>` passes; the import BEFORE the answer fails S13", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S13");
    const ask = s.calls.findIndex((c) => c.name === "AskUserQuestion");
    swapCalls(s, ask, ask + 1);
    expect(failing(grade(b))).toContain("S13");
    expect(failing(grade(buildPassingBundle("jira")))).not.toContain("S13");
  });
  test("S8 ORDER — the refusal BEFORE the successful repoint passes; the refusal AFTER it fails S8", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S8", 1);
    swapCalls(s, 0, 1);
    b.repos.B.commits.find((c) => /declare the shared tracker/.test(c.subject))!.at = s.calls[0]!.at;
    expect(failing(grade(b))).toContain("S8");
  });
  test("S8 — a container write between the refusal and the successful repoint fails S8 (zero container writes)", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S8", 1);
    const w: ToolCall = {
      ref: `${s.sessionId}:toolu_444`,
      at: new Date((Date.parse(s.calls[0]!.at) + Date.parse(s.calls[1]!.at)) / 2).toISOString(),
      name: `${serverPrefix("jira", "B")}editJiraIssue`,
      input: { cloudId: "cloud-dst", issueIdOrKey: createdKeys(session(b, "S8"))[0]!, fields: { labels: [TAG_B] } },
      result: { isError: false, text: "", exitCode: null, items: [], lastPage: null },
      sidechain: false,
    };
    s.calls.splice(1, 0, w);
    expect(failing(grade(b))).toContain("S8");
  });
  test("S12 ORDER — the commit landing AFTER B's gate evidence passes; landing BEFORE it fails S12", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S12");
    const gate = s.calls.findIndex((c) => /gate_receipt\.ts/.test(String(c.input.command)));
    swapCalls(s, gate, gate + 1);
    b.repos.B.commits.find((c) => c.subject === "s12: commit into B")!.at = s.calls[gate]!.at;
    expect(failing(grade(b))).toContain("S12");
  });
  test("S12 — the permitted PR answered by a HOOK refusal (not a gh error) fails S12", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S12");
    const pr = s.calls.at(-1)!;
    pr.result = { ...session(b, "S12").calls[1]!.result };
    expect(failing(grade(b))).toContain("S12");
  });
  // A forbidden-refusal site must see ANY hook error, not only the full
  // refusal shape: a hook refusal worded differently is still a hook refusal,
  // and reading it as "not refused" is the permitting answer. Unreachable for
  // a run of this tree (the hook text is frozen with it), fixed while cheap.
  const REWORDED = (tool: string) => ({ isError: true, text: `PreToolUse:${tool} hook error: [x]: blocked by the gate — decide first.`, exitCode: null, items: null, lastPage: null });
  test("S12 — the permitted PR answered by a REWORDED hook refusal (no Refusing:, no hook=) fails S12", () => {
    const b = buildPassingBundle("jira");
    const pr = session(b, "S12").calls.at(-1)!;
    pr.result = REWORDED(pr.name);
    expect(failing(grade(b))).toContain("S12");
  });
  test("PERMIT TWIN — the permitted PR answered by a gh error naming a server-side hook still passes S12", () => {
    const b = buildPassingBundle("jira");
    const pr = session(b, "S12").calls.at(-1)!;
    pr.result = { ...pr.result, isError: true, text: "pull request create failed: GraphQL: pre-receive hook declined (createPullRequest)" };
    expect(failing(grade(b))).not.toContain("S12");
  });
  test("S5 — a /ship-milestone that stopped at an earlier refusal, never running sibling_release.ts, is not-observed", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S5");
    s.calls = s.calls.filter((c) => !/sibling_release\.ts/.test(String(c.input.command ?? "")));
    s.calls.push({ ...s.calls[0]!, ref: `${s.sessionId}:toolu_333`, name: "Bash", input: { command: "git -C <A> status --porcelain" }, result: { isError: true, text: "/ship-milestone: Refusing: the working tree is dirty.", exitCode: 1, items: null, lastPage: null } });
    const v = grade(b);
    expect(v.scenarios.S5?.outcome).toBe("not-observed");
    expect(v.outcome).toBe("fail");
  });
  // Live leg 9 (2026-09-25): the busy refusal was its session's LAST call, so
  // "until the next call in the session" was +Infinity and step 20's commit,
  // eleven minutes and seven steps later, was graded as landing during step 14.
  // Steps run serially, so a step also ends where the next session begins.
  const lastCallRefusal = (b: LiveBundle) => {
    const busy = session(b, "S5");
    const at = busy.calls.findIndex((c) => /sibling_release\.ts/.test(String(c.input.command ?? "")));
    busy.calls = busy.calls.slice(0, at + 1);
  };
  const commitA = (b: LiveBundle, subject: string, at: string) => {
    b.repos.A.commits.push({ subject, at });
    b.repos.A.commits.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  };
  test("S5 — a refusal that is its session's last call does not own a LATER step's commit into A", () => {
    const b = buildPassingBundle("jira");
    lastCallRefusal(b);
    const later = session(b, "S10").calls[0]!.at;
    commitA(b, "chore(specs): write FR fr-s10", new Date(Date.parse(later) + 1000).toISOString());
    expect(failing(grade(b))).not.toContain("S5");
  });
  test("S5 CONTROL — with the refusal last, a commit into A before the next step begins still fails S5", () => {
    const b = buildPassingBundle("jira");
    lastCallRefusal(b);
    const twin = session(b, "S5", 1).calls[0]!.at;
    commitA(b, "chore(release): v0.2.0", new Date(Date.parse(twin) - 5000).toISOString());
    expect(failing(grade(b))).toContain("S5");
  });
  // Live Linear leg 2 (shr15b24814): step 1's child named its PRE milestone
  // exactly like its FR, the audit read that milestone with container "" (a
  // Linear milestone answer names no project), and S8's duplicate check, which
  // reads "" as the shared container, called the legacy item's own milestone a
  // duplicate FR. A duplicate is an item of the SAME class: an FR recreated
  // beside the legacy FR, or a second milestone container beside its milestone.
  const containerTwin = (b: LiveBundle, title: string, container: string): void =>
    addToAudit(b, {
      key: b.run.tracker === "jira" ? "DST-192" : "71d73ec9-614f-40eb-836e-733fca6438f0",
      summary: title,
      labels: [],
      status: "",
      parent: null,
      milestone: null,
      issueType: b.run.tracker === "jira" ? "Epic" : null,
      kind: b.run.tracker === "jira" ? "issue" : "milestone",
      container,
    });
  for (const t of ["jira", "linear"] as const) {
    test(`${t}: S8 — a milestone container titled like the legacy FR (Linear leg 2's shape) is not a duplicate of it`, () => {
      const b = buildPassingBundle(t);
      const legacy = createdKeys(session(b, "S8"))[0]!;
      const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
      containerTwin(b, orig.summary, t === "jira" ? b.run.container : "");
      expect(grade(b).scenarios.S8?.outcome, grade(b).scenarios.S8?.reason).toBe("pass");
    });
    test(`${t}: S8 CONTROL — a same-titled ISSUE in the shared container still fails`, () => {
      const b = buildPassingBundle(t);
      const legacy = createdKeys(session(b, "S8"))[0]!;
      const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
      addToAudit(b, { ...orig, key: t === "jira" ? "DST-193" : "STE-993", container: b.run.container });
      expect(grade(b).scenarios.S8?.outcome).toBe("fail");
      expect(grade(b).scenarios.S8?.reason).toMatch(/duplicates the legacy item's title/);
    });
    test(`${t}: S8 CONTROL — an issue read WITHOUT its container still counts as shared (fail closed)`, () => {
      const b = buildPassingBundle(t);
      const legacy = createdKeys(session(b, "S8"))[0]!;
      const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
      addToAudit(b, { ...orig, key: t === "jira" ? "DST-194" : "STE-994", container: "" });
      expect(grade(b).scenarios.S8?.outcome).toBe("fail");
    });
    // The same kind-blind shape, twice more: S6 and S11 fail on ANY audit item
    // titled like a refused create attempt, so a milestone that merely shares
    // the title would red them. Their attempts create issues.
    test(`${t}: S6 — a milestone container titled like the below-floor write is not the write landing`, () => {
      const b = buildPassingBundle(t);
      containerTwin(b, title("S6 below-floor write"), t === "jira" ? b.run.container : "");
      expect(grade(b).scenarios.S6?.outcome, grade(b).scenarios.S6?.reason).toBe("pass");
    });
    test(`${t}: S6 CONTROL — an ISSUE titled like the below-floor write still fails`, () => {
      const b = buildPassingBundle(t);
      const legacy = createdKeys(session(b, "S8"))[0]!;
      const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
      addToAudit(b, { ...orig, key: t === "jira" ? "DST-195" : "STE-995", summary: title("S6 below-floor write"), container: b.run.container });
      expect(grade(b).scenarios.S6?.outcome).toBe("fail");
    });
  }
  // Live Linear leg 1 (shr8f740e57): step 5's S1 child joined A's same-title
  // milestone, so B's FIRST join receipt was not S14's span join. joinAt fell
  // before step 7 and the refused attach was graded as never having happened.
  // `plantEarlierJoin` reproduces that shape: an announced, unrelated join by B,
  // made in S1's B session, recorded ahead of the span join.
  const OTHER_MILESTONE: Record<"jira" | "linear", string> = { jira: "DST-150", linear: "6c28ed40-2bc7-46bf-9936-961e92fd13f0" };
  const plantEarlierJoin = (b: LiveBundle): void => {
    const s1b = session(b, "S1", 1);
    if (!b.repos.B.receipts.readable) throw new Error("fixture: B's receipts are unreadable");
    const span = b.repos.B.receipts.records.find((r) => r.kind === "milestone-decision" && r.evidence.act === "join")!;
    const key = OTHER_MILESTONE[b.run.tracker];
    const r = {
      ...span,
      path: `<B>/.dpt/ledger/receipts/${s1b.sessionId}/early-join.json`,
      sessionId: s1b.sessionId,
      sha256: "e".repeat(64),
      subject: title("S1 same title"),
      evidence: { ...span.evidence, act: "join", via: "title", key, joinKey: undefined, name: title("S1 same title") },
    };
    b.repos.B.receipts.records.unshift(r);
    const last = s1b.calls.at(-1)!;
    s1b.calls.push({
      ...last,
      ref: `${s1b.sessionId}:toolu_earlyjoin`,
      at: new Date(Date.parse(last.at) + 1000).toISOString(),
      name: "Bash",
      input: { command: `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/resolve_milestone_identity.ts" <B> ${b.run.tracker} ${b.run.container} <B>/.dpt/tmp/listing-s1.json --title "${title("S1 same title")}"` },
      result: { isError: false, text: `act=join\nvia=title\nkey=${key}\ndpt-receipt: ${r.path} sha256:${r.sha256}`, exitCode: 0, items: null, lastPage: null },
    });
  };
  for (const t of ["jira", "linear"] as const) {
    test(`${t}: S14 — an earlier, unrelated join by B (step 5's S1 join) is not S14's join; the span join still grades the refused attach`, () => {
      const b = buildPassingBundle(t);
      plantEarlierJoin(b);
      expect(grade(b).scenarios.S14?.outcome, grade(b).scenarios.S14?.reason).toBe("pass");
    });
    test(`${t}: S14 CONTROL — with that earlier join planted, a span join that has no refused attach before it still fails`, () => {
      const b = buildPassingBundle(t);
      plantEarlierJoin(b);
      const attach = session(b, "S14").calls.find((c) => /attach_project_milestone\.ts/.test(String(c.input.command ?? "")))!;
      attach.at = new Date(Date.parse(session(b, "S2", 1).calls[0]!.at) + 500).toISOString();
      expect(grade(b).scenarios.S14?.outcome).toBe("fail");
      expect(grade(b).scenarios.S14?.reason).toMatch(/attach-target run before its join is not recorded/);
    });
  }
  test("S14 CONTROL — a B join into ANOTHER milestone alone is not the span join: S14 fails naming the span milestone", () => {
    const b = buildPassingBundle("jira");
    if (!b.repos.B.receipts.readable) throw new Error("fixture: B's receipts are unreadable");
    const span = b.repos.B.receipts.records.find((r) => r.kind === "milestone-decision" && r.evidence.act === "join")!;
    span.evidence = { ...span.evidence, key: OTHER_MILESTONE.jira };
    expect(grade(b).scenarios.S14?.outcome).toBe("fail");
    expect(grade(b).scenarios.S14?.reason).toMatch(/join decision into the span milestone \(M_/);
  });
  test("S17 — a run that is its session's last call does not land by a LATER step's commit into B", () => {
    const b = buildPassingBundle("jira");
    const aliased = b.repos.B.commits.find((k) => k.subject === "s17: aliased commit")!;
    aliased.at = new Date(Date.parse(session(b, "S16").calls[0]!.at) + 1000).toISOString();
    expect(failing(grade(b))).toContain("S17");
  });
  test("S3 — B's decision recorded as act create (not a join by key) fails S3", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S3", 1);
    const path = s.calls[1]!.result.text.match(/dpt-receipt: (\S+)/)![1]!;
    const rec = b.repos.B.receipts.readable ? b.repos.B.receipts.records.find((r) => r.path === path)! : null;
    rec!.decision = "create";
    Object.assign(rec!.evidence, { act: "create", via: "", key: "" });
    expect(failing(grade(b))).toContain("S3");
  });
  test("S13 — the import receipt without the answered question (AskUserQuestion answered Skip) fails S13", () => {
    const b = buildPassingBundle("linear");
    const ask = session(b, "S13").calls.find((c) => c.name === "AskUserQuestion")!;
    ask.result.text = ask.result.text.replace(/="Import /, '="Skip ');
    expect(failing(grade(b))).toContain("S13");
  });
  test("S16 — a tracker call in a numeric-milestone session fails S16 (record-only)", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S16");
    s.calls.push({ ...audits(b)[0]!.calls[0]!, ref: `${s.sessionId}:toolu_222`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString() });
    expect(failing(grade(b))).toContain("S16");
  });
});

// ===========================================================================
// AC.11 — the below-floor client
// ===========================================================================

describe("AC.11 — the below-floor scenario", () => {
  test("its plugin copy's digest differing from the tree under test's fails S6", () => {
    const b = buildPassingBundle("jira");
    b.run.belowFloorDigest = "f".repeat(64);
    expect(failing(grade(b))).toContain("S6");
  });
  test("a below-floor session that attempted no write is not-observed", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S6");
    s.calls = [{ ...s.calls[0]!, name: "Bash", input: { command: "cat <B>/CLAUDE.md" }, result: { isError: false, text: "# B", exitCode: 0, items: null, lastPage: null } }];
    expect(grade(b).scenarios.S6?.outcome).toBe("not-observed");
  });
  test("an item with the below-floor write's title in the audit fails S6 (counted from the audit too)", () => {
    const b = buildPassingBundle("jira");
    addToAudit(b, { key: "DST-181", summary: title("S6 below-floor write"), labels: [TAG_B], status: "To Do", parent: null, milestone: null, issueType: "Task", kind: "issue", container: "DST" });
    expect(failing(grade(b))).toContain("S6");
  });
  test("PERMIT TWIN — the refusal on the second server name with an equal digest and no created item passes S6", () => {
    expect(grade(buildPassingBundle("jira")).scenarios.S6?.outcome).toBe("pass");
  });
});

// ===========================================================================
// AC.12 — the old client, the intruder, the detector
// ===========================================================================

for (const t of TRACKERS) {
  describe(`AC.12 — ${t}: old client and intruder`, () => {
    test("zero old-client write attempts is the named outcome old-client-stopped, recall graded on the intruder's item alone", () => {
      const v = grade(buildPassingBundle(t, { oldClientWrites: 0 }));
      expect({ outcome: v.outcome, s10: v.scenarios.S10?.outcome, reason: v.scenarios.S10?.reason }).toEqual({ outcome: "pass", s10: "pass", reason: "old-client-stopped" });
    });
    test("PERMIT TWIN — an old client that wrote is graded on recall and carries no old-client-stopped reason", () => {
      expect(grade(buildPassingBundle(t)).scenarios.S10?.reason).toBeUndefined();
    });
    // Live leg 9 (2026-09-25): the 2.86.0 old client applied A's default_labels,
    // so its Task was TAGGED, and its Epic is a milestone container, which the
    // detector excludes by design. The predicate demanded a flag on both, and
    // AC.12's own second clause forbids flagging the first. Recall is owed on
    // what the old client left untagged. When the old client wrote, created at
    // least one item and left NONE untagged, the operator's ruling (AC.12, after
    // leg 9) names the outcome `old-client-tagged`, graded like
    // `old-client-stopped`: recall on the intruder's item alone, never skipped.
    const oldSession = (b: LiveBundle) => sessionsOf(b, "S10").find((s) => s.client === "old-client")!;
    const detectorOf = (b: LiveBundle) => sessionsOf(b, "S10").find((s) => s.client === "tree")!.calls[0]!;
    const unflag = (b: LiveBundle, k: string) => {
      const det = detectorOf(b);
      det.result.text = det.result.text.split("\n").filter((l) => !l.includes(`unowned-container-ticket: ${k} `)).join("\n");
    };
    const makeContainer = (b: LiveBundle, k: string) =>
      editAuditItem(b, k, (i) => {
        if (t === "jira") i.issueType = "Epic";
        else i.kind = "milestone";
      });
    /** Leg 9's shape: the old client wrote a container and a TAGGED ticket, and the detector flagged neither. */
    const leg9Shape = (b: LiveBundle): { task: string; epic: string } => {
      const [task, epic] = createdKeys(oldSession(b)) as [string, string];
      editAuditItem(b, task, (i) => void (i.labels = [TAG_A]));
      makeContainer(b, epic);
      unflag(b, task);
      unflag(b, epic);
      return { task, epic };
    };
    test("LEG 9 — an old client that wrote only a container and a TAGGED ticket passes as the named outcome old-client-tagged, naming each item", () => {
      const b = buildPassingBundle(t, { oldClientWrites: 2 });
      const { task, epic } = leg9Shape(b);
      const s10 = grade(b).scenarios.S10;
      expect(s10?.outcome).toBe("pass");
      expect(s10?.reason).toMatch(/^old-client-tagged\b/);
      expect(s10?.reason).toContain(`${epic}: a milestone container`);
      expect(s10?.reason).toContain(`${task}: tagged`);
    });
    test("CONTROL — under old-client-tagged, a detector missing the intruder's item fails S10 (recall is never skipped)", () => {
      const b = buildPassingBundle(t, { oldClientWrites: 2 });
      leg9Shape(b);
      const det = detectorOf(b);
      det.result.text = det.result.text.split("\n").filter((l) => !/intruder untagged item/.test(l)).join("\n");
      expect(grade(b).scenarios.S10?.outcome).toBe("fail");
      expect(grade(b).scenarios.S10?.reason).toMatch(/does not flag/);
    });
    test("PERMIT TWIN — a container the old client made is owed no flag; its untagged ticket, flagged, passes S10", () => {
      const b = buildPassingBundle(t, { oldClientWrites: 2 });
      const [, epic] = createdKeys(oldSession(b)) as [string, string];
      makeContainer(b, epic);
      unflag(b, epic);
      expect(failing(grade(b))).not.toContain("S10");
    });
    test("CONTROL — beside a container, an untagged old-client ticket the detector misses still fails S10", () => {
      const b = buildPassingBundle(t, { oldClientWrites: 2 });
      const [task, epic] = createdKeys(oldSession(b)) as [string, string];
      makeContainer(b, epic);
      unflag(b, epic);
      unflag(b, task);
      expect(grade(b).scenarios.S10?.outcome).toBe("fail");
      expect(grade(b).scenarios.S10?.reason).toContain(`does not flag ${task}`);
    });
    test("old-client-stopped never skips recall: a detector missing the intruder's item fails S10", () => {
      const b = buildPassingBundle(t, { oldClientWrites: 0 });
      const det = sessionsOf(b, "S10").find((s) => s.client === "tree")!.calls[0]!;
      det.result.text = det.result.text.split("\n").filter((l) => !/intruder untagged item/.test(l)).join("\n");
      expect(failing(grade(b))).toContain("S10");
    });
    test("a detector that flags a TAGGED item fails S10", () => {
      const b = buildPassingBundle(t);
      const s1a = createdKeys(session(b, "S1"))[0]!;
      const det = sessionsOf(b, "S10").find((s) => s.client === "tree")!.calls[0]!;
      det.result.text = `warning unowned-container-ticket: ${s1a} "${title("S1 same title")}" (creator unknown) carries no repository tag; any repository sharing this container may claim it.\n${det.result.text}`;
      expect(failing(grade(b))).toContain("S10");
    });
    test("an old-client write answered by a hook refusal fails the run as isolation-broken", () => {
      const b = buildPassingBundle(t);
      const old = sessionsOf(b, "S10").find((s) => s.client === "old-client")!;
      const w = old.calls.find((c) => c.name !== "Bash")!;
      w.result = { isError: true, text: `PreToolUse:${w.name} hook error: [x]: Refusing: below the floor.\nRemedy: upgrade.\nContext: mode=hook, ticket=unbound, skill=none, hook=pre-tracker-write-gate`, exitCode: null, items: null, lastPage: null };
      const v = grade(b);
      expect(v.outcome).toBe("fail");
      expect(findingsOf(v, "isolation-broken").some((f) => f.session === old.sessionId)).toBe(true);
    });
    test("an intruder write answered by a hook refusal fails the run as isolation-broken", () => {
      const b = buildPassingBundle(t);
      const intr = session(b, "intruder");
      const w = intr.calls[0]!;
      w.result = { isError: true, text: `PreToolUse:${w.name} hook error: [x]: Refusing: no receipt.\nRemedy: decide first.\nContext: mode=hook, ticket=unbound, skill=none, hook=pre-tracker-write-gate`, exitCode: null, items: null, lastPage: null };
      expect(findingsOf(grade(b), "isolation-broken").some((f) => f.session === intr.sessionId)).toBe(true);
    });
    test("an old-client write answered by a REWORDED hook refusal (no Refusing:, no hook=) is isolation-broken", () => {
      const b = buildPassingBundle(t);
      const old = sessionsOf(b, "S10").find((s) => s.client === "old-client")!;
      const w = old.calls.find((c) => c.name !== "Bash")!;
      w.result = { isError: true, text: `PreToolUse:${w.name} hook error: [x]: blocked by the gate — decide first.`, exitCode: null, items: null, lastPage: null };
      expect(findingsOf(grade(b), "isolation-broken").some((f) => f.session === old.sessionId)).toBe(true);
    });
    test("an intruder write answered by a REWORDED hook refusal is isolation-broken", () => {
      const b = buildPassingBundle(t);
      const intr = session(b, "intruder");
      const w = intr.calls[0]!;
      w.result = { isError: true, text: `PreToolUse:${w.name} hook error: [x]: blocked.`, exitCode: null, items: null, lastPage: null };
      expect(findingsOf(grade(b), "isolation-broken").some((f) => f.session === intr.sessionId)).toBe(true);
    });
    test("PERMIT TWIN — an old-client write answered by a tracker error that is not a hook error is never isolation-broken", () => {
      const b = buildPassingBundle(t);
      const old = sessionsOf(b, "S10").find((s) => s.client === "old-client")!;
      const w = old.calls.find((c) => c.name !== "Bash")!;
      w.result = { ...w.result, isError: true, text: "Error: 400 Bad Request — webhook delivery failed for this project" };
      expect(findingsOf(grade(b), "isolation-broken").some((f) => f.session === old.sessionId)).toBe(false);
    });
    test("PERMIT TWIN — a hook refusal in a TREE session (S7) is never isolation-broken", () => {
      const v = grade(buildPassingBundle(t));
      expect(session(buildPassingBundle(t), "S7").calls[0]!.result.text).toContain("hook error");
      expect(codes(v)).not.toContain("isolation-broken");
    });
    test("an intruder whose item is absent from the audit fails as isolation-broken (not an incomplete audit)", () => {
      const b = buildPassingBundle(t);
      const u = createdKeys(session(b, "intruder"))[0]!;
      dropFromAudit(b, u);
      const v = grade(b);
      expect(v.outcome).toBe("fail");
      expect(codes(v)).toContain("isolation-broken");
      expect(codes(v)).not.toContain("audit-incomplete");
    });
  });
}

// ===========================================================================
// AC.13 — every observed tracker tool is registered and classified
// ===========================================================================

describe("AC.13 — an unreadable registration or inventory is a named abort, never a crash", () => {
  for (const t of TRACKERS) {
    for (const [what, file, body] of [
      ["the tool inventory is missing", "inventoryPath", null],
      ["the tool inventory is not JSON", "inventoryPath", "{ not json"],
      ["hooks.json is missing", "hooksJsonPath", null],
      ["hooks.json is not JSON", "hooksJsonPath", "{ not json"],
    ] as const) {
      test(`${t}: ${what} → abort tool-registration-unreadable naming the file`, () => {
        withTmp("ste617-reg-", (d) => {
          const path = join(d, "input.json");
          if (body !== null) writeFs(path, body);
          const v = grade(buildPassingBundle(t), { [file]: path });
          expect(v.outcome).toBe("abort");
          expect(v.findings.filter((f) => f.code === "tool-registration-unreadable").map((f) => JSON.stringify(f).includes(path))).toEqual([true]);
        });
      });
    }
    test(`${t}: PERMIT TWIN — the shipped registration and inventory produce no tool-registration-unreadable`, () => {
      expect(grade(buildPassingBundle(t)).findings.some((f) => f.code === "tool-registration-unreadable")).toBe(false);
    });
  }
});

describe("AC.13 — tool registration and classification", () => {
  function hooksWithout(dir: string, tool: string): string {
    const j = JSON.parse(readFileSync(HOOKS_JSON, "utf-8"));
    for (const e of j.hooks.PreToolUse) if (typeof e.matcher === "string") e.matcher = e.matcher.replace(`${tool}|`, "").replace(`|${tool}`, "");
    const p = join(dir, "hooks.json");
    writeFileSync(p, JSON.stringify(j));
    return p;
  }
  for (const [t, tool] of [["jira", "transitionJiraIssue"], ["linear", "save_milestone"]] as const) {
    test(`${t}: an observed write tool (${tool}) the hooks.json matcher does not match fails unregistered-write-tool naming it`, () => {
      withTmp("ste617-hooks-", (d) => {
        const v = grade(buildPassingBundle(t), { hooksJsonPath: hooksWithout(d, tool) });
        expect(v.outcome).toBe("fail");
        expect(findingsOf(v, "unregistered-write-tool").some((f) => JSON.stringify(f).includes(tool))).toBe(true);
      });
    });
    test(`${t}: PERMIT TWIN — the shipped hooks.json matches every observed write tool`, () => {
      expect(codes(grade(buildPassingBundle(t), { hooksJsonPath: HOOKS_JSON }))).not.toContain("unregistered-write-tool");
    });
  }
  for (const [t, unknown, known] of [
    ["jira", "mcp__atlassian__archiveJiraIssue", "mcp__atlassian__getJiraIssue"],
    ["linear", "mcp__linear__archive_issue", "mcp__linear__get_issue"],
  ] as const) {
    function withCall(name: string): LiveBundle {
      const b = buildPassingBundle(t);
      const s = session(b, "S11");
      s.calls.push({ ...s.calls[0]!, ref: `${s.sessionId}:toolu_111`, at: new Date(Date.parse(s.calls[0]!.at) + 1000).toISOString(), name, input: { id: "X-1" }, result: { isError: false, text: "", exitCode: null, items: [], lastPage: null } });
      return b;
    }
    test(`${t}: a tracker tool absent from the STE-607 inventory (${unknown}) fails unclassified-tool naming it`, () => {
      const v = grade(withCall(unknown));
      expect(findingsOf(v, "unclassified-tool").some((f) => JSON.stringify(f).includes(unknown.split("__")[2]!))).toBe(true);
    });
    test(`${t}: PERMIT TWIN — an inventoried read tool (${known}) is not unclassified`, () => {
      expect(codes(grade(withCall(known)))).not.toContain("unclassified-tool");
    });
  }
});

// ===========================================================================
// AC.14 — Linear's free plan
// ===========================================================================

describe("AC.14 — Linear's issue budget", () => {
  test("a create answered by the free-issue-limit 400 aborts as linear-free-issue-limit, naming the budget spent", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S2", 1);
    const create = s.calls.find((c) => /__save_issue$/.test(c.name) && !c.input.id)!;
    create.result = { isError: true, text: LINEAR_CAP_TEXT, exitCode: null, items: null, lastPage: null };
    const spent = b.sessions
      .filter((x) => x.marker !== "audit")
      .flatMap((x) => x.calls)
      .filter((c) => /__save_issue$/.test(c.name) && !c.input.id && !c.result.isError).length;
    expect(spent, "control: the capped create is not counted as spent").toBe(6);
    const v = grade(b);
    expect(v.outcome).toBe("abort");
    const f = findingsOf(v, "linear-free-issue-limit");
    expect(f.length).toBe(1);
    expect(JSON.stringify(f[0]), `the finding names the budget spent (${spent})`).toMatch(new RegExp(`\\b${spent}\\b`));
    expect(v.linearBudget?.spent).toBe(spent);
  });
  test("PERMIT TWIN — a create answered by a different 400 is not the free-issue limit", () => {
    const b = buildPassingBundle("linear");
    const create = session(b, "S2", 1).calls.find((c) => /__save_issue$/.test(c.name) && !c.input.id)!;
    create.result = { isError: true, text: "Error: 400 invalid_request — title is required", exitCode: null, items: null, lastPage: null };
    expect(codes(grade(b))).not.toContain("linear-free-issue-limit");
  });
  test("a run that created more issues than the registry's worst case fails linear-budget-exceeded", () => {
    const b = buildPassingBundle("linear", { intruderItems: 5 });
    const v = grade(b);
    expect(v.linearBudget?.spent).toBe(worstCase() + 1);
    expect({ outcome: v.outcome, has: codes(v).includes("linear-budget-exceeded") }).toEqual({ outcome: "fail", has: true });
  });
  test("PERMIT TWIN — exactly the worst case is within budget", () => {
    const v = grade(buildPassingBundle("linear", { intruderItems: 4 }));
    expect(v.linearBudget?.spent).toBe(worstCase());
    expect({ outcome: v.outcome, codes: codes(v) }).toEqual({ outcome: "pass", codes: [] });
  });
  test("Jira has no issue budget: the same extra items grade pass", () => {
    expect(grade(buildPassingBundle("jira", { intruderItems: 5 })).outcome).toBe("pass");
  });
});

// ===========================================================================
// AC.15 — teardown
// ===========================================================================

describe("AC.15 — teardown is graded from the second audit", () => {
  test("jira: a nonce item the second audit still reads as open fails teardown-incomplete naming it", () => {
    const b = buildPassingBundle("jira");
    const key = createdKeys(session(b, "S1"))[0]!;
    for (const c of audits(b)[1]!.calls) for (const i of c.result.items ?? []) if (i.key === key) i.status = "To Do";
    const v = grade(b);
    expect(v.outcome).toBe("fail");
    expect(findingsOf(v, "teardown-incomplete").some((f) => JSON.stringify(f).includes(key))).toBe(true);
  });
  test("jira: PERMIT TWIN — every nonce item Done, Epics included, passes", () => {
    expect(codes(grade(buildPassingBundle("jira")))).not.toContain("teardown-incomplete");
  });
  test("jira: the repoint-from space's items are in scope when it was given", () => {
    const b = buildPassingBundle("jira");
    const legacy = createdKeys(session(b, "S8"))[0]!;
    for (const c of audits(b)[1]!.calls) for (const i of c.result.items ?? []) if (i.key === legacy) i.status = "In Progress";
    expect(findingsOf(grade(b), "teardown-incomplete").some((f) => JSON.stringify(f).includes(legacy))).toBe(true);
  });
  test("linear: a throwaway project the second audit reads as not completed fails teardown-incomplete naming it", () => {
    const b = buildPassingBundle("linear");
    const pre = b.run.repointFrom!;
    for (const c of audits(b)[1]!.calls) for (const i of c.result.items ?? []) if (i.kind === "project" && i.summary === pre) i.status = "In Progress";
    const v = grade(b);
    expect(v.outcome).toBe("fail");
    expect(findingsOf(v, "teardown-incomplete").some((f) => JSON.stringify(f).includes(pre))).toBe(true);
  });
  test("linear: a second audit that never reads one of the two projects fails teardown-incomplete naming it", () => {
    const b = buildPassingBundle("linear");
    const a2 = audits(b)[1]!;
    a2.calls = a2.calls.filter((c) => !(c.result.items ?? []).some((i) => i.kind === "project" && i.summary === b.run.container));
    expect(findingsOf(grade(b), "teardown-incomplete").some((f) => JSON.stringify(f).includes(b.run.container))).toBe(true);
  });
  test("linear: PERMIT TWIN — both projects completed passes", () => {
    expect(codes(grade(buildPassingBundle("linear")))).not.toContain("teardown-incomplete");
  });

  /** The run's successful tracker creates, counted over every session (the condition that makes teardown owed). */
  const runCreates = (b: LiveBundle): string[] => b.sessions.flatMap(createdKeys);
  const missingSecondAudit = (b: LiveBundle): Finding[] => findingsOf(grade(b), "teardown-incomplete").filter((f) => /no second audit/.test(f.detail ?? ""));

  for (const t of TRACKERS) {
    test(`${t}: once the run has created tracker items, a bundle with NO second audit fails teardown-incomplete naming the missing second audit`, () => {
      const b = buildPassingBundle(t);
      removeSessions(b, [audits(b)[1]!.sessionId]);
      expect(audits(b).length, "CONTROL — only the first audit is left").toBe(1);
      expect(runCreates(b).length, "CONTROL — the run's tracker writes exist").toBeGreaterThan(0);
      const v = grade(b);
      expect(v.outcome).toBe("fail");
      expect(missingSecondAudit(b).length).toBe(1);
    });
    test(`${t}: PERMIT TWIN — the same bundle WITH its second audit is not teardown-incomplete`, () => {
      const b = buildPassingBundle(t);
      expect(audits(b).length, "CONTROL — both audits are present").toBe(2);
      expect(codes(grade(b))).not.toContain("teardown-incomplete");
    });
    test(`${t}: PERMIT TWIN — no second audit and no successful create (teardown never owed) is not flagged for the missing audit`, () => {
      const b = buildPassingBundle(t);
      removeSessions(b, [audits(b)[1]!.sessionId]);
      for (const s of b.sessions) for (const c of s.calls) if (isCreateCall(c)) c.result.isError = true;
      expect(runCreates(b), "CONTROL — no successful create is left").toEqual([]);
      expect(missingSecondAudit(b)).toEqual([]);
    });
  }
});

// ===========================================================================
// AC.16 — the evidence bundle never carries personal data
// ===========================================================================

const PRIVACY: Array<{ pattern: string; leak: string; twin: string }> = [
  { pattern: "email address", leak: "reported by ops@acme-sandbox.io", twin: "installed @anthropic-ai/sdk" },
  { pattern: "Atlassian account id (24 hex)", leak: "accountId=5b10ac8d82e05b22cc7d4ef5", twin: "commit 9f1c2e3d4b5a69788796a5b4c3d2e1f0a9b8c7d6" },
  { pattern: "Atlassian account id (prefixed)", leak: "assignee 557058:f58131cb-b67d-43c7-b30d-6b58d40bd077", twin: "session f58131cb-b67d-43c7-b30d-6b58d40bd077" },
  { pattern: "*.atlassian.net site host", leak: "https://acme-sandbox.atlassian.net/browse/DST-101", twin: "https://mcp.atlassian.com/v1/mcp" },
  { pattern: "linear.app/<workspace>", leak: "https://linear.app/acme-ws/issue/STE-901", twin: "hosted at linear.app" },
  { pattern: "/Users/<name>", leak: "/Users/alice/workspace/dpt-shared-jira-a", twin: "see /UsersGuide/index.md" },
  { pattern: "/home/<name>", leak: "/home/alice/dpt-shared-jira-a", twin: "see /homepage/index.md" },
];

function withText(b: LiveBundle, s: string): LiveBundle {
  const c = clone(b);
  const call = session(c, "S4").calls[0]!;
  call.result.text = `${call.result.text}\n${s}`;
  return c;
}

// The first live Jira leg (2026-09-23) refused its bundle on 41 matches: the
// site host, account ids, emails and /Users/<name> paths, all in ORDINARY child
// records — a Write's content, a Bash command, a tool result. The refusal is
// right; what has to change is the PROJECTION, which kept those fields verbatim.
// It now rewrites each class to an identity token, exactly as it already
// rewrites the roots, the config dirs and the toolkit path. privacyViolations
// is untouched: it stays the fail-closed check over whatever remains.
// The first live Jira leg: a child rooted in B ran `for R in $B $A; do perl
// -0pi -e … done`, editing A's CLAUDE.md, to satisfy a repoint refusal whose
// reason named the peer. A child writing FILES into the sibling repository is
// this programme's own harm class, and nothing graded it: the tracker-write
// hook gates tracker writes, and the commit and PR predicates grade git. This
// predicate grades the file write itself.
describe("a child writing files into the sibling repository is graded", () => {
  /**
   * Append one call to a session, and hand back that session's OWN root token
   * and the OTHER one. The rows below never spell `<A>`/`<B>` themselves: the
   * first draft did, against a session it had not checked the root of, and the
   * harm row and the permit row silently swapped meanings.
   */
  const addCall = (b: LiveBundle, marker: string, name: string, input: (t: { own: string; other: string }) => Record<string, unknown>) => {
    const s = session(b, marker);
    const t = { own: `<${s.root}>`, other: s.root === "A" ? "<B>" : "<A>" };
    const last = s.calls.at(-1)!;
    s.calls.push({ ref: `${s.sessionId}:toolu_sib${s.calls.length}`, at: new Date(Date.parse(last.at) + 1000).toISOString(), name, input: input(t), result: { isError: false, text: "", exitCode: 0, items: null, lastPage: null }, sidechain: false });
    return { s, ...t };
  };
  const siblingWrites = (b: LiveBundle) => findingsOf(grade(b), "sibling-file-write");
  const bash = (command: string) => ({ command, description: "x" });

  test("HARM — the live shape: a `perl -0pi` loop over both roots, its target a loop variable", () => {
    const b = buildPassingBundle("jira");
    const { s, own, other } = addCall(b, "S1", "Bash", (t) => bash(`for R in ${t.own} ${t.other}; do perl -0pi -e 's/x/y/' "$R/CLAUDE.md"; done`));
    const f = siblingWrites(b);
    expect(f.map((x) => x.session)).toContain(s.sessionId);
    expect(f.find((x) => x.session === s.sessionId)!.detail).toContain(other);
    expect(own).not.toBe(other);
  });
  test("HARM — a Write tool call whose file_path is under the other root", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S1", "Write", (t) => ({ file_path: `${t.other}/CLAUDE.md`, content: "jira_issue_type: Task\n" }));
    expect(siblingWrites(b).map((x) => x.session)).toContain(s.sessionId);
  });
  test("HARM — an in-place sed, a redirect, a tee, a cp and an rm, each into the other root", () => {
    for (const make of [
      (o: string) => `sed -i '' 's/a/b/' ${o}/.mcp.json`,
      (o: string) => `echo x > ${o}/notes.txt`,
      (o: string) => `echo x | tee ${o}/notes.txt`,
      (o: string) => `cp /tmp/x ${o}/CLAUDE.md`,
      (o: string) => `rm -rf ${o}/specs`,
      (o: string) => `mkdir -p ${o}/.dpt/locks`,
    ]) {
      const b = buildPassingBundle("jira");
      let cmd = "";
      addCall(b, "S1", "Bash", (t) => bash((cmd = make(t.other))));
      expect(siblingWrites(b).length, cmd).toBeGreaterThan(0);
    }
  });
  test("PERMIT — the same six verbs, aimed at the session's OWN root, are never flagged", () => {
    for (const make of [
      (o: string) => `sed -i '' 's/a/b/' ${o}/CLAUDE.md`,
      (o: string) => `echo x > ${o}/notes.txt`,
      (o: string) => `echo x | tee ${o}/notes.txt`,
      (o: string) => `cp /tmp/x ${o}/CLAUDE.md`,
      (o: string) => `rm -rf ${o}/.dpt`,
      (o: string) => `mkdir -p ${o}/specs/frs`,
    ]) {
      const b = buildPassingBundle("jira");
      let cmd = "";
      addCall(b, "S1", "Bash", (t) => bash((cmd = make(t.own))));
      addCall(b, "S1", "Write", (t) => ({ file_path: `${t.own}/specs/frs/x.md`, content: "body" }));
      expect(siblingWrites(b), cmd).toEqual([]);
    }
  });
  test("PERMIT — READING the sibling is not a write (cat, ls, git status, git diff, a tool run named against it)", () => {
    const b = buildPassingBundle("jira");
    for (const make of [
      (o: string) => `cat ${o}/CLAUDE.md`,
      (o: string) => `ls -la ${o}`,
      (o: string) => `git -C ${o} status --porcelain`,
      (o: string) => `git -C ${o} diff CLAUDE.md`,
      (o: string) => `grep -rn "team:" ${o}/CLAUDE.md`,
      (o: string) => `bun run "$P/adapters/_shared/src/gate_receipt.ts" gate-check ${o} > /tmp/out.json 2>&1`,
    ]) addCall(b, "S1", "Bash", (t) => bash(make(t.other)));
    expect(siblingWrites(b)).toEqual([]);
  });
  test("PERMIT — the scenarios that cross roots BY DESIGN still pass (S12's commit into B, S17's aliased subcommands), on both trackers", () => {
    expect(siblingWrites(buildPassingBundle("jira"))).toEqual([]);
    expect(siblingWrites(buildPassingBundle("linear"))).toEqual([]);
  });

  // Audit round 2, the HIGH mirror: AC.20(a) named S9 and S11 alongside S12 and
  // S17 as "crossing roots by design", which reads as though all four need an
  // entry in BY_DESIGN_SIBLING_WRITES. Measured, they do not — S9 and S11 cross
  // roots in the TRACKER and RELOCATED-CHECKOUT senses, which this predicate does
  // not grade, and neither makes a cross-root FILE write at all. This row states
  // that as a measurement rather than leaving it implied by a green whole-bundle
  // assertion, so a fixture that later gives either of them such a write reds
  // here — which is the point at which the permit question genuinely arises.
  test("MEASURED — S9 and S11 make no cross-root file write, which is why the permit list holds only S12 and S17", () => {
    for (const tracker of ["jira", "linear"] as const) {
      const b = buildPassingBundle(tracker);
      for (const marker of ["S9", "S11"] as const) {
        const sessions = b.sessions.filter((x) => x.marker === marker);
        expect(sessions.length, `${tracker}: the fixture has ${marker}`).toBeGreaterThan(0);
        for (const s of sessions) {
          const other = s.root === "A" ? "<B>" : "<A>";
          const naming = s.calls.filter((c) => c.name === "Bash" && String(c.input.command ?? "").includes(other));
          expect(naming.map((c) => String(c.input.command)), `${tracker} ${marker} names ${other}`).toEqual([]);
        }
      }
      // CONTROL — the same measurement over S12 and S17 is non-empty, so the row
      // above is a property of those two scenarios and not of the walk.
      const crossing = b.sessions
        .filter((x) => x.marker === "S12" || x.marker === "S17")
        .flatMap((s) => s.calls.filter((c) => c.name === "Bash" && String(c.input.command ?? "").includes(s.root === "A" ? "<B>" : "<A>")));
      expect(crossing.length, `${tracker}: S12 and S17 do name the other root`).toBeGreaterThan(0);
    }
  });
  test("PERMIT — the ungated clients are graded by the isolation check, not this one", () => {
    const b = buildPassingBundle("jira");
    const intruder = session(b, "intruder");
    const last = intruder.calls.at(-1)!;
    const other = intruder.root === "A" ? "<B>" : "<A>";
    intruder.calls.push({ ref: `${intruder.sessionId}:toolu_sib2`, at: new Date(Date.parse(last.at) + 1000).toISOString(), name: "Write", input: { file_path: `${other}/CLAUDE.md`, content: "x" }, result: { isError: false, text: "", exitCode: 0, items: null, lastPage: null }, sidechain: false });
    expect(siblingWrites(b).map((x) => x.session)).not.toContain(intruder.sessionId);
  });
  // ---- audit round 1: the three findings in this predicate -----------------

  test("H1 — a Bash write that FAILS is still graded: the founding case wrote, then exited non-zero", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S1", "Bash", (t) => bash(`for R in ${t.own} ${t.other}; do perl -0pi -e 's/x/y/' "$R/CLAUDE.md"; done`));
    // The loop edited both roots and then failed on its last iteration. A
    // transcript cannot show that a failed command wrote nothing, and this one
    // demonstrably wrote: skipping it is the fail-open that defeats the guard
    // on the very shape it was built for.
    const call = s.calls.at(-1)!;
    (call.result as { isError: boolean }).isError = true;
    (call.result as { exitCode: number | null }).exitCode = 2;
    const f = siblingWrites(b);
    expect(f.map((x) => x.session)).toContain(s.sessionId);
    expect(f.find((x) => x.session === s.sessionId)!.detail, "the detail records that it failed").toMatch(/exit 2|failed/);
  });

  test("H1 ASYMMETRY — a FAILED Write tool call is still skipped: that one proves nothing was written", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S1", "Write", (t) => ({ file_path: `${t.other}/CLAUDE.md`, content: "x" }));
    (s.calls.at(-1)!.result as { isError: boolean }).isError = true;
    expect(siblingWrites(b).map((x) => x.session)).not.toContain(s.sessionId);
  });

  test("H2 — `cd <sibling> && <relative write>` is graded, in each of the four verbs", () => {
    for (const make of [
      (o: string) => `cd ${o} && echo x > notes.txt`,
      (o: string) => `cd ${o}/specs && cp /tmp/x y.md`,
      (o: string) => `cd ${o} && mkdir -p .dpt/tmp`,
      (o: string) => `cd ${o} && printf x | tee notes.txt`,
    ]) {
      const b = buildPassingBundle("jira");
      let cmd = "";
      const { s } = addCall(b, "S1", "Bash", (t) => bash((cmd = make(t.other))));
      expect(siblingWrites(b).map((x) => x.session), cmd).toContain(s.sessionId);
    }
  });

  test("H2 PERMIT — cd into its OWN root, and a cd into the sibling that only READS, are not flagged", () => {
    const b = buildPassingBundle("jira");
    for (const make of [
      (t: { own: string; other: string }) => `cd ${t.own} && echo x > notes.txt`,
      (t: { own: string; other: string }) => `cd ${t.other} && cat CLAUDE.md`,
      (t: { own: string; other: string }) => `cd ${t.other} && git status --porcelain`,
      // Step 23's own prompt: the run primes its children on this shape.
      (t: { own: string; other: string }) => `cd ${t.other} && gh pr create --title s12 --body s12`,
      // cd back out before writing: the write lands in its own root.
      (t: { own: string; other: string }) => `cd ${t.other} && cat CLAUDE.md; cd ${t.own} && echo x > notes.txt`,
    ]) addCall(b, "S1", "Bash", (t) => bash(make(t)));
    expect(siblingWrites(b)).toEqual([]);
  });

  test("H3 PERMIT — the sibling write S12 and S17 PROMPTS require (B's own gate evidence) is permitted, by path and by scenario", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S12", "Bash", (t) => bash(`mkdir -p ${t.other}/.dpt/ledger/receipts && cp /tmp/r.json ${t.other}/.dpt/ledger/receipts/r.json`));
    expect(siblingWrites(b).map((x) => x.session), "the step prompt orders this write").not.toContain(s.sessionId);
  });

  test("H3 REFUSAL TWIN — the same receipts write from a scenario whose prompt does NOT order it is flagged", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S1", "Bash", (t) => bash(`mkdir -p ${t.other}/.dpt/ledger/receipts && cp /tmp/r.json ${t.other}/.dpt/ledger/receipts/r.json`));
    expect(siblingWrites(b).map((x) => x.session)).toContain(s.sessionId);
  });

  test("H3 REFUSAL TWIN — an S12 session writing anything ELSE in the sibling is still flagged", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S12", "Bash", (t) => bash(`cp /tmp/x ${t.other}/CLAUDE.md`));
    expect(siblingWrites(b).map((x) => x.session)).toContain(s.sessionId);
  });

  test("LOW (audit round 2) — a subshell and a traversal out of its own root are both graded", () => {
    for (const make of [
      // `(cd <other> && …)`: the leading paren used to hide the verb from the walk.
      (t: { own: string; other: string }) => `(cd ${t.other} && echo x > notes.txt)`,
      // A traversal that never names the other root's token, only its directory name.
      (t: { own: string; other: string }) => `cp /tmp/x ${t.own}/../dpt-shared-jira-a/CLAUDE.md`,
      (t: { own: string; other: string }) => `cd ${t.own}/.. && cp /tmp/x dpt-shared-jira-a/CLAUDE.md`,
    ]) {
      const b = buildPassingBundle("jira");
      let cmd = "";
      const { s } = addCall(b, "S1", "Bash", (t) => bash((cmd = make(t))));
      // The rows are written from B, whose sibling directory is `dpt-shared-jira-a`.
      if (s.root !== "B") continue;
      expect(siblingWrites(b).map((x) => x.session), cmd).toContain(s.sessionId);
    }
  });

  test("PERMIT — the by-design crossings use the root TOKEN, not the sibling's directory name, so the traversal rule does not touch them", () => {
    expect(siblingWrites(buildPassingBundle("jira"))).toEqual([]);
    expect(siblingWrites(buildPassingBundle("linear"))).toEqual([]);
  });

  // NAMED, NOT FIXED (measured 2026-09-23, audit round 2):
  //   `D=<other>; cd $D && echo x > f` — variable indirection. Catching it needs
  //   assignment tracking, which is a shell interpreter's job; the live shape
  //   (a loop variable) is already covered by the in-place arm, which is why
  //   that one was worth the looseness and this is not.
  //   `bun run <module> <other>/path` — a toolkit module run whose path argument
  //   is in the sibling. Catching it needs to know which modules write, and the
  //   by-design `gate_receipt.ts gate-check <B>` names the sibling in exactly
  //   the same shape — so a rule here would fail correct behaviour, which is the
  //   thing this predicate's own H3 finding says not to do.
  test("NAMED LIMIT — variable indirection and toolkit-module runs are NOT caught, and the suite says so rather than implying coverage", () => {
    for (const make of [
      (t: { own: string; other: string }) => `D=${t.other}; cd $D && echo x > notes.txt`,
      (t: { own: string; other: string }) => `bun run "$P/adapters/_shared/src/archive_fr.ts" ${t.other}/specs/frs/x.md`,
    ]) {
      const b = buildPassingBundle("jira");
      const { s } = addCall(b, "S1", "Bash", (t) => bash(make(t)));
      expect(siblingWrites(b).map((x) => x.session), "documented as uncaught; if this reds, the limit has been closed and the comment is stale").not.toContain(s.sessionId);
    }
  });

  test("NAMED LIMIT — an in-place edit of its own root that merely NAMES the other is flagged, and the grader says so in its comment", () => {
    const b = buildPassingBundle("jira");
    const { s } = addCall(b, "S1", "Bash", (t) => bash(`sed -i '' "s|${t.other}|x|" ${t.own}/CLAUDE.md`));
    expect(siblingWrites(b).map((x) => x.session)).toContain(s.sessionId);
  });
});

// M_2306b6 audit round 1 (M3) — the projection rewrites EVERY string it emits.
//
// `rw` reached the strings the projection composes and not the ones it merely
// forwards: a Node error message (`EACCES: … scandir '/Users/<name>/…'`) went
// into `repos.<X>.receipts.error` verbatim, and `privacyViolations` then refused
// the whole bundle at Phase 6 — the throw-away-the-leg mode F7 existed to
// remove, reintroduced one field over.
describe("M3 — the ITEMS of a tracker answer are projected too", () => {
  test("a tracker answer whose item title carries a site host and a home path is rewritten before it reaches the bundle", () => {
    withTmp("ste617-m3-items-", (dir) => {
      const d = realpathSync(dir);
      const m = materialize(buildPassingBundle("jira"), d);
      const sid = m.ledger[0]!;
      const file = join(m.configDir, "projects", slugOf(m.roots.B), `${sid}.jsonl`);
      const at = "2026-09-23T10:00:00.000Z";
      const answer = {
        issues: [{ key: "DST-900", fields: { summary: "see https://acme-corp.atlassian.net/browse/DST-900 and /Users/someone/notes.md", labels: ["shr-live-b"], description: null, creator: { displayName: "Pat" }, issuetype: { name: "Task" }, project: { key: "DST" } } }],
        isLast: true,
      };
      appendFileSync(file, [
        { type: "assistant", sessionId: sid, timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_items", name: "mcp__atlassian__searchJiraIssuesUsingJql", input: { jql: "summary ~ x" } }] } },
        { type: "user", sessionId: sid, timestamp: at, message: { role: "user", content: [{ tool_use_id: "toolu_items", type: "tool_result", content: JSON.stringify(answer) }] } },
      ].map((r) => JSON.stringify(r)).join("\n") + "\n");

      const b = extractedBundle(extractFor(m));
      const call = b.sessions.flatMap((x) => x.calls).find((c) => c.ref.endsWith("toolu_items"));
      expect(call, "the injected tracker read is in the bundle").toBeDefined();
      const json = JSON.stringify(call!.result.items ?? []);
      expect(json, "the item was read at all (the row is not passing on an empty projection)").toContain("DST-900");
      expect(json).not.toContain("acme-corp.atlassian.net");
      expect(json).not.toContain("/Users/someone");
      expect(json).toContain("<site>");
      expect(json).toContain("<home>");
      expect(grader().privacyViolations(b), "and the whole bundle still passes the refusal").toEqual([]);
    });
  });
});

describe("M3 — a forwarded error message is projected, not passed through", () => {
  test("an unreadable receipts directory is reported through the ROOT TOKEN, never its absolute path", () => {
    withTmp("ste617-m3-", (dir) => {
      // realpath, so the macOS `/var` -> `/private/var` symlink cannot make a
      // rewritten string look unrewritten (or the reverse).
      const d = realpathSync(dir);
      const m = materialize(buildPassingBundle("jira"), d);
      const receipts = join(m.roots.B, ".dpt", "ledger", "receipts");
      mkdirSync(receipts, { recursive: true });
      chmodSync(receipts, 0o000);
      let b: LiveBundle;
      try {
        b = extractedBundle(extractFor(m));
      } finally {
        chmodSync(receipts, 0o755);
      }
      const error = (b.repos as Record<string, { receipts: { readable: boolean; error?: string } }>).B.receipts.error ?? "";
      expect(error, "the directory is still reported as unreadable").toMatch(/receipts/);
      expect(error, "through the root token").toContain("<B>");
      expect(error, "and never the absolute path, which in a live run sits under the operator's home").not.toContain(m.roots.B);
    });
  });
});

describe("AC.16 — the projection redacts the classes the live run leaked, and the refusal stays as it is", () => {
  const LEAKS = [
    { name: "the tracker site host", text: "see https://acme-corp.atlassian.net/browse/DST-1", token: "<site>" },
    { name: "an email address", text: "reporter: someone@acme-corp.example", token: "<email>" },
    { name: "a prefixed Atlassian account id", text: "accountId=712020:61cb7d97-7533-40a6-ac49-3a4c68b6f88e", token: "<account-id>" },
    { name: "a bare 24-hex Atlassian account id", text: "creator 5b10a2844c20165700ede21g".replace("g", "f"), token: "<account-id>" },
    { name: "a home-directory path outside the run's roots", text: "cat /Users/someone/notes/private.md", token: "<home>" },
  ];

  /** Append one Bash call and one Write call carrying `text` to a materialized session's transcript. */
  function injectLeak(m: Materialized, text: string): void {
    const sid = m.ledger[0]!;
    const file = join(m.configDir, "projects", slugOf(m.roots.B), `${sid}.jsonl`);
    const at = "2026-09-23T09:00:00.000Z";
    const rows = [
      { type: "assistant", sessionId: sid, timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_leak1", name: "Bash", input: { command: `echo ${text}`, description: "leak" } }] } },
      { type: "user", sessionId: sid, timestamp: at, message: { role: "user", content: [{ tool_use_id: "toolu_leak1", type: "tool_result", content: `out: ${text}` }] } },
      { type: "assistant", sessionId: sid, timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_leak2", name: "Write", input: { file_path: `${m.roots.B}/notes.md`, content: `body ${text}` } }] } },
      { type: "user", sessionId: sid, timestamp: at, message: { role: "user", content: [{ tool_use_id: "toolu_leak2", type: "tool_result", content: "ok" }] } },
    ];
    appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }

  for (const leak of LEAKS) {
    test(`${leak.name}: the projection rewrites it to ${leak.token}, and the bundle passes the refusal`, () => {
      withTmp("ste617-redact-", (d) => {
        const m = materialize(buildPassingBundle("jira"), d);
        injectLeak(m, leak.text);
        const b = extractedBundle(extractFor(m));
        const blob = JSON.stringify(b);
        expect(grader().privacyViolations(b)).toEqual([]);
        expect(blob).toContain(leak.token);
        const out = join(d, `jira-2026-09-23-${NONCE}`);
        expect(grader().writeEvidenceBundle(b, out).ok).toBe(true);
      });
    });
  }

  test("CONTROL — the same records without a leak are projected verbatim (the rewrite is not a blanket scrub)", () => {
    withTmp("ste617-redact-ctl-", (d) => {
      const m = materialize(buildPassingBundle("jira"), d);
      injectLeak(m, "a plain note about DST-1 and its labels");
      const blob = JSON.stringify(extractedBundle(extractFor(m)));
      expect(blob).toContain("a plain note about DST-1 and its labels");
      for (const t of ["<site>", "<email>", "<account-id>", "<home>"]) expect(blob).not.toContain(t);
    });
  });

  test("the run's OWN roots keep their own tokens: a path under B is <B>, never <home>", () => {
    withTmp("ste617-redact-roots-", (d) => {
      const m = materialize(buildPassingBundle("jira"), d);
      injectLeak(m, `${m.roots.B}/specs/frs/x.md`);
      const blob = JSON.stringify(extractedBundle(extractFor(m)));
      expect(blob).toContain("<B>/specs/frs/x.md");
      expect(blob).not.toContain("<home>/specs/frs/x.md");
    });
  });
});

describe("AC.16 — the grader refuses to write a bundle holding personal data", () => {
  test("CONTROL — the passing bundles trip no pattern (session ids, sha256 digests and git shas are not account ids)", () => {
    for (const t of TRACKERS) expect(grader().privacyViolations(buildPassingBundle(t))).toEqual([]);
  });
  for (const p of PRIVACY) {
    test(`${p.pattern}: a record carrying it is refused, nothing written`, () => {
      withTmp("ste617-priv-", (d) => {
        const b = withText(buildPassingBundle("jira"), p.leak);
        expect(grader().privacyViolations(b).length).toBeGreaterThan(0);
        const out = join(d, `jira-2026-09-21-${NONCE}`);
        const w = grader().writeEvidenceBundle(b, out);
        expect(w.ok).toBe(false);
        expect(existsSync(join(out, "bundle.json"))).toBe(false);
      });
    });
    test(`${p.pattern}: PERMIT TWIN — a near-miss string is not a leak, and the bundle is written`, () => {
      withTmp("ste617-priv-ok-", (d) => {
        const b = withText(buildPassingBundle("jira"), p.twin);
        expect(grader().privacyViolations(b)).toEqual([]);
        const out = join(d, `jira-2026-09-21-${NONCE}`);
        const w = grader().writeEvidenceBundle(b, out);
        expect(w.ok).toBe(true);
        expect(JSON.parse(readFileSync(join(out, "bundle.json"), "utf-8"))).toEqual(b);
      });
    });
  }
  test("a leak anywhere is found — in a tool input, a receipt field, a commit subject", () => {
    const leak = "ops@acme-sandbox.io";
    const a = buildPassingBundle("linear");
    session(a, "S7").calls[0]!.input.description = leak;
    const r = buildPassingBundle("linear");
    if (r.repos.A.receipts.readable) r.repos.A.receipts.records[0]!.subject = leak;
    const c = buildPassingBundle("linear");
    c.repos.B.commits.push({ subject: `from ${leak}`, at: "2026-09-21T11:00:00.000Z" });
    for (const b of [a, r, c]) expect(grader().privacyViolations(b).length).toBeGreaterThan(0);
  });
});

describe("AC.16 — committed evidence bundles are scanned, and zero is reported as no-bundles-yet", () => {
  const ROOT = join(pluginRoot, "tests", "fixtures", "shared-tracker-live");
  test("every committed bundle under tests/fixtures/shared-tracker-live/ is clean (count printed; zero reported as no-bundles-yet, never as a pass)", () => {
    const r = grader().scanCommittedBundles(ROOT);
    console.log(`[shared-tracker-live] scanned=${r.scanned} status=${r.status}`);
    expect(r.status).toBe(r.scanned === 0 ? "no-bundles-yet" : "scanned");
    expect(r.violations).toEqual([]);
  });
  test("CONTROL — the scanner counts bundles, reports a leak naming its file, and says no-bundles-yet for an empty or absent root", () => {
    withTmp("ste617-scan-", (d) => {
      expect(grader().scanCommittedBundles(join(d, "absent")).status).toBe("no-bundles-yet");
      expect(grader().scanCommittedBundles(d)).toEqual({ scanned: 0, status: "no-bundles-yet", violations: [] });
      const ok = grader().writeEvidenceBundle(buildPassingBundle("jira"), join(d, `jira-2026-09-21-${NONCE}`));
      expect(ok.ok).toBe(true);
      expect(grader().scanCommittedBundles(d)).toEqual({ scanned: 1, status: "scanned", violations: [] });
      const dirty = join(d, `linear-2026-09-21-${NONCE}`);
      mkdirSync(dirty);
      writeFileSync(join(dirty, "bundle.json"), JSON.stringify(withText(buildPassingBundle("linear"), "ops@acme-sandbox.io")));
      const r = grader().scanCommittedBundles(d);
      expect(r.scanned).toBe(2);
      expect(r.violations.some((v) => v.where.includes(`linear-2026-09-21-${NONCE}`))).toBe(true);
    });
  });
});

describe("AUDIT 8 — verdict.json sits in the committed bundle directory, so the privacy refusal and scan read it too", () => {
  type VerdictWriter = (v: unknown, path: string) => { ok: boolean; violations?: PrivacyViolation[] };
  function writeVerdictFile(): VerdictWriter {
    const f = (grader() as unknown as { writeVerdictFile?: VerdictWriter }).writeVerdictFile;
    if (typeof f !== "function") throw new Error("the grader exports no writeVerdictFile(v, path) — verdict.json has no privacy refusal");
    return f;
  }
  const verdictWith = (text: string) => ({ outcome: "abort", findings: [{ code: "bundle-missing", detail: text }], scenarios: {} });

  test("a verdict carrying an email is refused, nothing written", () => {
    withTmp("ste618-verdict-priv-", (d) => {
      const path = join(d, `jira-2026-09-21-${NONCE}`, "verdict.json");
      const w = writeVerdictFile()(verdictWith("mailed ops@acme-sandbox.io"), path);
      expect(w.ok).toBe(false);
      expect(existsSync(path)).toBe(false);
    });
  });

  test("PERMIT TWIN — the same verdict without the email is written", () => {
    withTmp("ste618-verdict-ok-", (d) => {
      const path = join(d, `jira-2026-09-21-${NONCE}`, "verdict.json");
      const w = writeVerdictFile()(verdictWith("mailed ops at acme-sandbox"), path);
      expect(w.ok).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf-8")).findings[0].detail).toBe("mailed ops at acme-sandbox");
    });
  });

  test("grade writes its verdict through the same refusal: a verdict carrying an email (from the extract's abort record) is not written (exit 1, stderr names it); a clean abort record is its twin", () => {
    withTmp("ste618-verdict-cli-", (d) => {
      const run = (dir: string) => Bun.spawnSync([process.execPath, GRADER_PATH, "grade", "--bundle", dir], { cwd: d });
      // No bundle.json, so grade copies the extract's abort record into the verdict.
      const abortRecord = (detail: string) => JSON.stringify({ outcome: "abort", findings: [{ code: "transcript-missing", detail }] });
      const leaky = join(d, "leaky");
      mkdirSync(leaky, { recursive: true });
      writeFileSync(join(leaky, "extract-abort.json"), abortRecord("session owned by ops@acme-sandbox.io has no transcript"));
      const r = run(leaky);
      expect(r.exitCode).toBe(1);
      expect(existsSync(join(leaky, "verdict.json")), r.stdout.toString()).toBe(false);
      expect(r.stderr.toString()).toMatch(/refused to write the verdict/);
      const clean = join(d, "clean");
      mkdirSync(clean, { recursive: true });
      writeFileSync(join(clean, "extract-abort.json"), abortRecord("session owned by the operator has no transcript"));
      const t = run(clean);
      expect(t.exitCode).toBe(1);
      expect(existsSync(join(clean, "verdict.json")), `twin: ${t.stderr.toString()}`).toBe(true);
    });
  });

  test("scanCommittedBundles reports an email in a committed verdict.json, naming that file; a clean verdict.json is its twin", () => {
    withTmp("ste618-verdict-scan-", (d) => {
      const dir = join(d, `jira-2026-09-21-${NONCE}`);
      expect(grader().writeEvidenceBundle(buildPassingBundle("jira"), dir).ok).toBe(true);
      writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdictWith("mailed ops at acme-sandbox")));
      expect(grader().scanCommittedBundles(d).violations, "twin: a clean verdict.json reports nothing").toEqual([]);
      writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdictWith("mailed ops@acme-sandbox.io")));
      const r = grader().scanCommittedBundles(d);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.every((v) => v.where.includes(`jira-2026-09-21-${NONCE}/verdict.json`)), JSON.stringify(r.violations)).toBe(true);
    });
  });
});

// ===========================================================================
// AC.18 — the Jira repoint scenario is required or a named skip, never silent
// ===========================================================================

describe("AC.18 — S8 on Jira: required with the flag, a named skip without it", () => {
  test("given --jira-repoint-from, S8 not-observed fails the run naming S8", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, sessionsOf(b, "S8").map((s) => s.sessionId));
    const v = grade(b);
    expect({ outcome: v.outcome, failing: failing(v), s8: v.scenarios.S8?.outcome }).toEqual({ outcome: "fail", failing: ["S8"], s8: "not-observed" });
  });
  test("given --jira-repoint-from, S8 failing fails the run naming S8", () => {
    const b = buildPassingBundle("jira");
    breakScenario(b, "S8");
    expect(failing(grade(b))).toEqual(["S8"]);
  });
  test("without the flag, S8 is recorded as skipped with reason repoint-space-not-given, and the run passes on the rest", () => {
    const v = grade(buildPassingBundle("jira", { jiraRepointFrom: null }));
    expect({ outcome: v.outcome, s8: v.scenarios.S8 && { outcome: v.scenarios.S8.outcome, reason: v.scenarios.S8.reason } }).toEqual({
      outcome: "pass",
      s8: { outcome: "skipped", reason: "repoint-space-not-given" },
    });
  });
  test("CONTROL — without the flag AND without the skip record, S8 is neither an outcome nor a skip: fail naming S8", () => {
    const b = buildPassingBundle("jira", { jiraRepointFrom: null });
    b.run.skips = [];
    expect(failing(grade(b))).toEqual(["S8"]);
  });
  test("a skip record on a run that WAS given the flag is not honoured: fail naming S8", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, sessionsOf(b, "S8").map((s) => s.sessionId));
    b.run.skips = [{ id: "S8", reason: "repoint-space-not-given" }];
    expect(failing(grade(b))).toEqual(["S8"]);
  });
  test("Linear never records this skip: a Linear run carrying it with no S8 session fails naming S8", () => {
    const b = buildPassingBundle("linear");
    removeSessions(b, sessionsOf(b, "S8").map((s) => s.sessionId));
    b.run.skips = [{ id: "S8", reason: "repoint-space-not-given" }];
    expect(failing(grade(b))).toEqual(["S8"]);
  });
  test("PERMIT TWIN — the passing Linear run grades S8 pass, never skipped", () => {
    expect(grade(buildPassingBundle("linear")).scenarios.S8?.outcome).toBe("pass");
  });
});

// ===========================================================================
// behaviourDigest (AC.8, STE-618)
// ===========================================================================

const GIT_ENV = (home: string) => ({
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "d",
  GIT_AUTHOR_EMAIL: "d@localhost",
  GIT_COMMITTER_NAME: "d",
  GIT_COMMITTER_EMAIL: "d@localhost",
});
function git(cwd: string, home: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, env: GIT_ENV(home) });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A repository whose plugin lives at plugins/p, beside a tracked file outside it. */
function makePluginRepo(dir: string): { repo: string; plugin: string } {
  const repo = join(dir, "repo");
  const plugin = join(repo, "plugins", "p");
  const put = (rel: string, body: string) => {
    mkdirSync(dirname(join(plugin, rel)), { recursive: true });
    writeFileSync(join(plugin, rel), body);
  };
  mkdirSync(plugin, { recursive: true });
  git(repo, dir, "init", "-q");
  writeFileSync(join(repo, "README.md"), "outside the plugin root\n");
  put(".claude-plugin/plugin.json", `${JSON.stringify({ name: "p", version: "1.2.3", description: "a plugin" }, null, 2)}\n`);
  put("adapters/_shared/src/a.ts", "export const a = 1;\n");
  put("adapters/_shared/src/a.test.ts", "// colocated test\n");
  put("tests/t.test.ts", "// suite\n");
  put("hooks/hooks.json", "{}\n");
  put(".gitignore", "ignored.log\n");
  git(repo, dir, "add", "-A");
  git(repo, dir, "commit", "-qm", "init");
  return { repo, plugin };
}

function digestOk(r: DigestResult): { digest: string; files: Record<string, string> } {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as { digest: string; files: Record<string, string> };
}

describe("behaviourDigest — what the digest covers", () => {
  test("SHA-256 per tracked file under the plugin root, except tests/ and colocated *.test.ts; files outside the root never count", () => {
    withTmp("ste617-dg-", (d) => {
      const { plugin } = makePluginRepo(d);
      const r = digestOk(grader().behaviourDigest(plugin));
      expect(Object.keys(r.files).sort()).toEqual([".claude-plugin/plugin.json", ".gitignore", "adapters/_shared/src/a.ts", "hooks/hooks.json"]);
      expect(r.files["adapters/_shared/src/a.ts"]).toBe(sha256("export const a = 1;\n"));
      expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    });
  });
  test("a version-only edit of plugin.json leaves the digest unchanged; any other manifest edit changes it", () => {
    withTmp("ste617-dg-v-", (d) => {
      const { plugin } = makePluginRepo(d);
      const base = digestOk(grader().behaviourDigest(plugin)).digest;
      const mf = join(plugin, ".claude-plugin", "plugin.json");
      writeFileSync(mf, readFileSync(mf, "utf-8").replace('"1.2.3"', '"9.9.9"'));
      expect(digestOk(grader().behaviourDigest(plugin)).digest, "version-only edit").toBe(base);
      writeFileSync(mf, readFileSync(mf, "utf-8").replace('"a plugin"', '"a changed plugin"'));
      expect(digestOk(grader().behaviourDigest(plugin)).digest, "description edit").not.toBe(base);
    });
  });
  test("the working copy is read: an uncommitted edit of a tracked source file changes the digest", () => {
    withTmp("ste617-dg-w-", (d) => {
      const { plugin } = makePluginRepo(d);
      const base = digestOk(grader().behaviourDigest(plugin)).digest;
      writeFileSync(join(plugin, "adapters", "_shared", "src", "a.ts"), "export const a = 2;\n");
      expect(digestOk(grader().behaviourDigest(plugin)).digest).not.toBe(base);
    });
  });
  test("untracked and ignored files never count; edits under tests/ and to colocated *.test.ts never count", () => {
    withTmp("ste617-dg-u-", (d) => {
      const { plugin } = makePluginRepo(d);
      const base = digestOk(grader().behaviourDigest(plugin)).digest;
      writeFileSync(join(plugin, "adapters", "_shared", "src", "new.ts"), "untracked\n");
      writeFileSync(join(plugin, "ignored.log"), "ignored\n");
      writeFileSync(join(plugin, "tests", "t.test.ts"), "// changed suite\n");
      writeFileSync(join(plugin, "adapters", "_shared", "src", "a.test.ts"), "// changed colocated test\n");
      expect(digestOk(grader().behaviourDigest(plugin)).digest).toBe(base);
    });
  });
  test("a second worktree of the same commit agrees (created alongside the repository, outside any temp dir, removed after)", () => {
    withTmp("ste617-dg-wt-", (d) => {
      const { repo, plugin } = makePluginRepo(d);
      const wt = join(dirname(repoRoot), `.ste617-digest-wt-${randomBytes(4).toString("hex")}`);
      expect(wt.startsWith(realpathSync(tmpdir())), "the worktree is not under the temp dir").toBe(false);
      try {
        git(repo, d, "worktree", "add", "-q", "--detach", wt, "HEAD");
        const a = digestOk(grader().behaviourDigest(plugin));
        const b = digestOk(grader().behaviourDigest(join(wt, "plugins", "p")));
        expect(b).toEqual(a);
      } finally {
        Bun.spawnSync(["git", "worktree", "remove", "--force", wt], { cwd: repo, env: GIT_ENV(d) });
        rmSync(wt, { recursive: true, force: true });
      }
    });
  });
  test("a root that is neither a git checkout nor given a tracked-file list refuses as digest-unavailable", () => {
    withTmp("ste617-dg-n-", (d) => {
      const { plugin } = makePluginRepo(d);
      const copy = join(d, "copy");
      cpSync(plugin, copy, { recursive: true });
      const r = grader().behaviourDigest(copy);
      expect({ ok: r.ok, reason: !r.ok ? r.reason : null }).toEqual({ ok: false, reason: "digest-unavailable" });
    });
  });
  test("a non-git copy given the source checkout's tracked list equals the source digest; a changed copy does not", () => {
    withTmp("ste617-dg-c-", (d) => {
      const { plugin } = makePluginRepo(d);
      const list = git(plugin, d, "ls-files").split("\n").filter(Boolean);
      const src = digestOk(grader().behaviourDigest(plugin));
      const copy = join(d, "copy");
      cpSync(plugin, copy, { recursive: true });
      const mf = join(copy, ".claude-plugin", "plugin.json");
      writeFileSync(mf, readFileSync(mf, "utf-8").replace('"1.2.3"', '"0.0.1"'));
      expect(digestOk(grader().behaviourDigest(copy, { trackedFiles: list })), "a below-floor copy differs only in its version").toEqual(src);
      writeFileSync(join(copy, "adapters", "_shared", "src", "a.ts"), "export const a = 3;\n");
      expect(digestOk(grader().behaviourDigest(copy, { trackedFiles: list })).digest).not.toBe(src.digest);
    });
  });
  test("the tree under test's own digest computes (read-only)", () => {
    const r = digestOk(grader().behaviourDigest(pluginRoot));
    expect(Object.keys(r.files)).toContain("adapters/_shared/src/shared_tracker_live_grader.ts");
    expect(Object.keys(r.files).some((f) => f.startsWith("tests/"))).toBe(false);
  });
});

describe("behaviourDigest — the command-line front door", () => {
  function cli(args: string[], cwd: string) {
    const r = Bun.spawnSync([process.execPath, GRADER_PATH, ...args], { cwd });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }
  test("`digest <pluginRoot>` prints the digest JSON and exits 0", () => {
    withTmp("ste617-cli-", (d) => {
      const { plugin } = makePluginRepo(d);
      const r = cli(["digest", plugin], d);
      expect(r.code, r.err).toBe(0);
      expect(JSON.parse(r.out).digest).toBe(digestOk(grader().behaviourDigest(plugin)).digest);
    });
  });
  test("`digest` on a non-git root with no list exits non-zero naming digest-unavailable; with `--tracked-list <file>` it computes", () => {
    withTmp("ste617-cli-n-", (d) => {
      const { plugin } = makePluginRepo(d);
      const copy = join(d, "copy");
      cpSync(plugin, copy, { recursive: true });
      const bad = cli(["digest", copy], d);
      expect(bad.code).not.toBe(0);
      expect(bad.err).toContain("digest-unavailable");
      const listFile = join(d, "tracked.txt");
      writeFileSync(listFile, git(plugin, d, "ls-files"));
      const ok = cli(["digest", copy, "--tracked-list", listFile], d);
      expect(ok.code, ok.err).toBe(0);
      expect(JSON.parse(ok.out).digest).toBe(digestOk(grader().behaviourDigest(plugin)).digest);
    });
  });
});

// ===========================================================================
// HARDENING — an adversarial audit's findings, each shown red on the grader
// before its fix. Every refusal below has a permit twin differing in the one
// variable the refusal keys on.
// ===========================================================================

/** The receipt a Bash call's announcement names, in its repository. */
function announcedReceipt(b: LiveBundle, c: ToolCall) {
  const path = c.result.text.match(/dpt-receipt: (\S+)/)?.[1];
  if (!path) throw new Error(`fixture: ${c.ref} announces nothing`);
  const root = path.startsWith("<A>/") ? "A" : "B";
  const set = b.repos[root].receipts;
  const r = set.readable ? set.records.find((x) => x.path === path) : undefined;
  if (!r) throw new Error(`fixture: ${path} is not in <${root}>`);
  return r;
}

/** Drop a call from its session and every receipt it announced from its repository. */
function dropCallAndReceipt(b: LiveBundle, s: BundleSession, c: ToolCall): void {
  const path = c.result.text.match(/dpt-receipt: (\S+)/)?.[1];
  s.calls = s.calls.filter((x) => x !== c);
  for (const r of ["A", "B"] as const) {
    const set = b.repos[r].receipts;
    if (set.readable && path) set.records = set.records.filter((x) => x.path !== path);
  }
}

/** The first call of `s` whose Bash command names `re`. */
function bashCall(s: BundleSession, re: RegExp): ToolCall {
  const c = s.calls.find((x) => x.name === "Bash" && re.test(String(x.input.command ?? "")));
  if (!c) throw new Error(`fixture: no Bash call in ${s.sessionId} matches ${re}`);
  return c;
}

/** Append a call to `s`, one second after its last. */
function appendCall(s: BundleSession, name: string, input: Record<string, unknown>, result: ToolCall["result"], tag: string): ToolCall {
  const c: ToolCall = { ref: `${s.sessionId}:toolu_h_${tag}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}

/** A tracker receipt of `kind` in `s`'s repository, with the Bash run of `command` that announces it appended to `s`. */
function appendAnnounced(b: LiveBundle, s: BundleSession, kind: string, command: string, fields: { subject: string; decision?: string; evidence?: Record<string, unknown> }, tag: string): string {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/${kind}-h-${tag}.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({ path, sessionId: s.sessionId, sha256: sha256(path), kind, adapter: b.run.tracker, container: b.run.container, subject: fields.subject, decision: fields.decision ?? kind, evidence: fields.evidence ?? {} });
  appendCall(s, "Bash", { command, description: "run" }, { isError: false, text: `decided\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null }, `ann_${tag}`);
  return path;
}

/** A successful ticket write on `key` appended to `s` (a transition on Jira, a state change on Linear). */
function appendTicketWrite(b: LiveBundle, s: BundleSession, key: string, tag: string, op: "transition" | "edit" = "transition"): ToolCall {
  const t = b.run.tracker;
  const name = serverPrefix(t, s.root) + (t === "jira" ? (op === "transition" ? "transitionJiraIssue" : "editJiraIssue") : "save_issue");
  const input =
    t === "jira"
      ? op === "transition"
        ? { cloudId: "cloud-dst", issueIdOrKey: key, transition: { id: "31" } }
        : { cloudId: "cloud-dst", issueIdOrKey: key, fields: { labels: [TAG_B] } }
      : op === "transition"
        ? { id: key, state: "In Progress" }
        : { id: key, labels: [TAG_B] };
  return appendCall(s, name, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null }, `w_${tag}`);
}

const ungatedAt = (v: LiveVerdict, ref: string): boolean => findingsOf(v, "ungated-write").some((f) => (f.detail ?? "").startsWith(`${ref}:`));
const ungatedIn = (v: LiveVerdict, sessionId: string): boolean => findingsOf(v, "ungated-write").some((f) => f.session === sessionId);

/** The create call of an FR-create session (decide, attach, create). */
const createCallOf = (s: BundleSession): ToolCall => s.calls.find((c) => isCreateCall(c))!;
const oldClientKey = (b: LiveBundle): string => createdKeys(sessionsOf(b, "S10").find((s) => s.client === "old-client")!)[0]!;

describe("HARDENING 1 — ungated-write covers every write the tracker-write hook gates by receipt", () => {
  for (const t of TRACKERS) {
    test(`${t}: ORDER — a container create (${t === "jira" ? "Epic" : "save_milestone"}) BEFORE its milestone decision fails ungated-write naming the S3 session; AFTER it (the passing bundle) does not`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S3");
      const decide = s.calls.findIndex((c) => /resolve_milestone_identity\.ts/.test(String(c.input.command ?? "")));
      expect(decide, "CONTROL — the decision run is followed by the container create").toBe(1);
      // STE-644: the re-list sits between the decision and the create, so the swap names the create.
      swapCalls(s, decide, s.calls.indexOf(createCallOf(s)));
      expect(ungatedIn(grade(b), s.sessionId)).toBe(true);
      expect(codes(grade(buildPassingBundle(t)))).not.toContain("ungated-write");
    });
    test(`${t}: a milestone decision for ANOTHER title, a JOIN decision, or a decision for ANOTHER project does not gate the container create (ungated-write)`, () => {
      const mutations: Array<[string, (r: ReturnType<typeof announcedReceipt>) => void]> = [
        ["another title", (r) => (r.evidence.title = title("another span"))],
        ["a join", (r) => Object.assign(r.evidence, { act: "join", via: "key", key: "X-1" })],
        ["another project", (r) => (r.container = "OTHER")],
      ];
      for (const [name, mutate] of mutations) {
        const b = buildPassingBundle(t);
        const s = session(b, "S3");
        mutate(announcedReceipt(b, bashCall(s, /resolve_milestone_identity\.ts/)));
        expect({ name, ungated: ungatedAt(grade(b), createCallOf(s).ref) }).toEqual({ name, ungated: true });
      }
    });
    test(`${t}: an import sync with NO import receipt (the consent run removed) fails ungated-write naming S13; PERMIT TWIN — with it, the sync is gated`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S13");
      const sync = s.calls.at(-1)!;
      expect(isCreateCall(sync) || sync.result.isError, "CONTROL — the last S13 call is a successful non-create write").toBe(false);
      dropCallAndReceipt(b, s, bashCall(s, /container_ownership\.ts" consent/));
      expect(ungatedAt(grade(b), sync.ref)).toBe(true);
      expect(ungatedAt(grade(buildPassingBundle(t)), sync.ref)).toBe(false);
    });
    test(`${t}: an import receipt naming ANOTHER key, or one whose question was answered Skip, does not gate the import sync (ungated-write)`, () => {
      const other = buildPassingBundle(t);
      const s1 = session(other, "S13");
      announcedReceipt(other, bashCall(s1, /container_ownership\.ts" consent/)).subject = t === "jira" ? "DST-999" : "STE-999";
      expect(ungatedAt(grade(other), s1.calls.at(-1)!.ref), "another key").toBe(true);
      const skip = buildPassingBundle(t);
      const s2 = session(skip, "S13");
      const ask = s2.calls.find((c) => c.name === "AskUserQuestion")!;
      ask.result.text = ask.result.text.replace(/="Import /, '="Skip ');
      expect(ungatedAt(grade(skip), s2.calls.at(-1)!.ref), "answered Skip").toBe(true);
    });
    test(`${t}: a claim transition under a binding receipt (ticket_ownership.ts confirm) is gated; the SAME transition without the confirm run fails ungated-write`, () => {
      const withReceipt = buildPassingBundle(t);
      const s = session(withReceipt, "S13");
      const key = oldClientKey(withReceipt);
      appendAnnounced(withReceipt, s, "binding", moduleCommand("ticket_ownership.ts", "confirm", `<B> ${key} <B>/.dpt/tmp/ticket.json`), { subject: key, decision: "confirm" }, "bind");
      const w = appendTicketWrite(withReceipt, s, key, "claim");
      expect(ungatedAt(grade(withReceipt), w.ref), "PERMIT TWIN — the binding receipt gates the claim").toBe(false);
      const without = buildPassingBundle(t);
      const w2 = appendTicketWrite(without, session(without, "S13"), oldClientKey(without), "claim");
      expect(ungatedAt(grade(without), w2.ref)).toBe(true);
    });
    test(`${t}: an ADOPT binding gates the write only after an answered \`Adopt <KEY>\`; without the answer it fails ungated-write`, () => {
      const build = (answered: boolean) => {
        const b = buildPassingBundle(t);
        const s = session(b, "S13");
        const key = oldClientKey(b);
        if (answered) appendCall(s, "AskUserQuestion", { questions: [{ question: `Adopt ${key}?`, options: [{ label: `Adopt ${key}` }] }] }, { isError: false, text: `User has answered your questions: "Adopt ${key}?"="Adopt ${key}". You can now continue.`, exitCode: null, items: null, lastPage: null }, "ask");
        appendAnnounced(b, s, "binding", moduleCommand("ticket_ownership.ts", "confirm", `<B> ${key} <B>/.dpt/tmp/ticket.json --adopt`), { subject: key, decision: "adopt" }, "adopt");
        return { b, w: appendTicketWrite(b, s, key, "adopt") };
      };
      const yes = build(true);
      expect(ungatedAt(grade(yes.b), yes.w.ref), "PERMIT TWIN — answered").toBe(false);
      const no = build(false);
      expect(ungatedAt(grade(no.b), no.w.ref)).toBe(true);
    });
    test(`${t}: a ticket write under a REUSE receipt naming its key is gated; a reuse receipt naming ANOTHER key fails ungated-write`, () => {
      const build = (named: (key: string) => string) => {
        const b = buildPassingBundle(t);
        const s = session(b, "S1");
        const key = oldClientKey(b);
        appendAnnounced(b, s, "reuse", moduleCommand("create_idempotency_probe.ts", "decide", "<A> --title-file <A>/.dpt/tmp/t.txt"), { subject: title("reused"), decision: "reuse", evidence: { key: named(key) } }, "reuse");
        return { b, w: appendTicketWrite(b, s, key, "reuse", "edit") };
      };
      const own = build((k) => k);
      expect(ungatedAt(grade(own.b), own.w.ref), "PERMIT TWIN — the reuse names the key").toBe(false);
      const other = build(() => (t === "jira" ? "DST-998" : "STE-998"));
      expect(ungatedAt(grade(other.b), other.w.ref)).toBe(true);
    });
    test(`${t}: a ticket write on a key the session CREATED earlier is gated; the same write on a sibling's key it neither created nor holds a receipt for fails ungated-write`, () => {
      const own = buildPassingBundle(t);
      const s = session(own, "S1");
      const w = appendTicketWrite(own, s, createdKeys(s)[0]!, "own");
      expect(ungatedAt(grade(own), w.ref), "PERMIT TWIN — created in this session").toBe(false);
      const sib = buildPassingBundle(t);
      const w2 = appendTicketWrite(sib, session(sib, "S1"), createdKeys(session(sib, "S1", 1))[0]!, "sib");
      expect(ungatedAt(grade(sib), w2.ref)).toBe(true);
    });
    test(`${t}: an FR create whose attach-target run is removed fails ungated-write naming it; PERMIT TWIN — with the attach run it is gated`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S2");
      const create = createCallOf(s);
      dropCallAndReceipt(b, s, bashCall(s, /attach_project_milestone\.ts/));
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
      expect(ungatedAt(grade(buildPassingBundle(t)), create.ref)).toBe(false);
    });
    test(`${t}: an attach-target receipt resolving ANOTHER milestone, or ANOTHER project, than the create binds does not gate it (ungated-write)`, () => {
      const mutations: Array<[string, (r: ReturnType<typeof announcedReceipt>) => void]> = [
        ["another milestone", (r) => (t === "jira" ? (r.evidence.key = "DST-150") : (r.evidence.id = "5f3a9cee-7d2e-4f00-9a00-0000000000ee"))],
        ["another project", (r) => (r.container = "OTHER")],
      ];
      for (const [name, mutate] of mutations) {
        const b = buildPassingBundle(t);
        const s = session(b, "S2");
        mutate(announcedReceipt(b, bashCall(s, /attach_project_milestone\.ts/)));
        expect({ name, ungated: ungatedAt(grade(b), createCallOf(s).ref) }).toEqual({ name, ungated: true });
      }
    });
    test(`${t}: a create receipt recording ANOTHER ${t === "jira" ? "parent" : "milestone"} or ANOTHER project (same title) does not gate the create (ungated-write)`, () => {
      const field = t === "jira" ? "parent" : "milestone";
      for (const [name, key, value] of [["container", field, t === "jira" ? "DST-150" : "5f3a9cee-7d2e-4f00-9a00-0000000000ee"], ["project", "project", "OTHER"]] as const) {
        const b = buildPassingBundle(t);
        const s = session(b, "S2", 1);
        ((announcedReceipt(b, s.calls[0]!).evidence.createPayload as Record<string, unknown>)[key] = value);
        expect({ name, ungated: ungatedAt(grade(b), createCallOf(s).ref) }).toEqual({ name, ungated: true });
      }
    });
    test(`${t}: a create carrying NO repository tag in its labels is not decided for any repository (ungated-write)`, () => {
      const b = buildPassingBundle(t);
      const c = createCallOf(session(b, "S2"));
      if (t === "jira") (c.input.additional_fields as { labels: string[] }).labels = [];
      else c.input.labels = [];
      expect(ungatedAt(grade(b), c.ref)).toBe(true);
    });
    test(`${t}: one create receipt authorises ONE create — a second create after the same decision fails ungated-write naming the second; PERMIT TWIN — a second decision before it gates it`, () => {
      const build = (secondDecision: boolean) => {
        const b = buildPassingBundle(t);
        const s = session(b, "S2");
        const first = createCallOf(s);
        const decide = s.calls[0]!;
        // STE-650 AC.5 PIN MOVE: a same-title create after a SETTLED create is
        // refused whatever its receipt (the hook's STE-642 rule), so the permit
        // twin creates a DIFFERENT ticket under its own, second decision.
        const secondTitle = title("second ticket");
        const secondInput = clone(first.input) as Record<string, unknown>;
        if (secondDecision) {
          const r = announcedReceipt(b, decide);
          const path = r.path.replace(/\.json$/, "-2.json");
          const set = b.repos.A.receipts;
          const rec = { ...clone(r), path, sha256: sha256(path) };
          (rec.evidence.createPayload as Record<string, unknown>)[t === "jira" ? "summary" : "title"] = secondTitle;
          rec.subject = secondTitle;
          if (set.readable) set.records.push(rec);
          appendCall(s, "Bash", { ...decide.input }, { ...decide.result, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}` }, "decide2");
          secondInput[t === "jira" ? "summary" : "title"] = secondTitle;
        }
        const item = { ...first.result.items![0]!, key: t === "jira" ? "DST-170" : "STE-970" };
        const second = appendCall(s, first.name, secondInput, { isError: false, text: "", exitCode: null, items: [item], lastPage: null }, "create2");
        addToAudit(b, item);
        for (const c of audits(b)[1]!.calls) if (c.result.items && c.result.lastPage === true) c.result.items.push({ ...item, status: t === "jira" ? "Done" : item.status });
        return { b, second };
      };
      const spent = build(false);
      expect(ungatedAt(grade(spent.b), spent.second.ref)).toBe(true);
      const fresh = build(true);
      expect(ungatedAt(grade(fresh.b), fresh.second.ref)).toBe(false);
    });
  }
});

describe("HARDENING 2 — receipts-unreadable covers an absent directory and every gated kind; receiptsOf is never a silent []", () => {
  for (const t of TRACKERS) {
    test(`${t}: an ABSENT receipts directory in a repository whose sessions made gated writes aborts receipts-unreadable (extracted from disk)`, () => {
      withTmp("ste617-h2-", (d) => {
        const m = materialize(buildPassingBundle(t), d);
        rmSync(join(m.roots.A, ".dpt", "ledger", "receipts"), { recursive: true, force: true });
        const r = gradeExtracted(extractFor(m));
        expect({ outcome: r.outcome, has: codes(r).includes("receipts-unreadable") }).toEqual({ outcome: "abort", has: true });
      });
    });
  }
  test("PERMIT TWIN — the same absent directory in a repository whose sessions made NO gated write is not receipts-unreadable", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, b.sessions.filter((s) => s.root === "A" && s.client !== "intruder" && s.client !== "old-client" && s.calls.some((c) => /^mcp__/.test(c.name) && !c.result.isError && /create|edit|transition|save_/.test(c.name))).map((s) => s.sessionId));
    b.repos.A.receipts = { readable: false, error: "the receipts directory <A>/.dpt/ledger/receipts is absent" };
    expect(codes(grade(b))).not.toContain("receipts-unreadable");
  });
  test("an unreadable receipts directory where the repository's ONLY gated write is an import sync (no create) aborts receipts-unreadable", () => {
    const b = buildPassingBundle("linear");
    for (const s of b.sessions) if (s.root === "B") for (const c of s.calls) if (isCreateCall(c)) c.result = { isError: true, text: "Error: 400 invalid_request — title is required", exitCode: null, items: null, lastPage: null };
    expect(b.sessions.filter((s) => s.root === "B").flatMap(createdKeys), "CONTROL — B made no successful create").toEqual([]);
    b.repos.B.receipts = { readable: false, error: "EACCES: permission denied" };
    const v = grade(b);
    expect({ outcome: v.outcome, has: codes(v).includes("receipts-unreadable") }).toEqual({ outcome: "abort", has: true });
  });
  test("receiptsOf is not a silent []: with B's receipts unreadable and no B gated write, S12 is not-observed naming the unreadable receipts; PERMIT TWIN — readable, S12 passes", () => {
    const b = buildPassingBundle("jira");
    removeSessions(b, b.sessions.filter((s) => s.root === "B" && s.calls.some((c) => /^mcp__/.test(c.name) && !c.result.isError && !/get|search|list/.test(c.name))).map((s) => s.sessionId));
    b.repos.B.receipts = { readable: false, error: "EACCES: permission denied" };
    const v = grade(b);
    expect(codes(v), "CONTROL — no B session made a gated write, so the run is not aborted for it").not.toContain("receipts-unreadable");
    expect({ outcome: v.scenarios.S12?.outcome, unreadable: /cannot be read/.test(v.scenarios.S12?.reason ?? "") }).toEqual({ outcome: "not-observed", unreadable: true });
    expect(grade(buildPassingBundle("jira")).scenarios.S12?.outcome).toBe("pass");
  });
});

describe("HARDENING 3 — the second audit is held to the audit rules, and on Jira must read back every created item", () => {
  test("jira: a second audit that reads NONE of the run's created items fails teardown-incomplete naming each; PERMIT TWIN — the passing bundle", () => {
    const b = buildPassingBundle("jira");
    for (const c of audits(b)[1]!.calls) if (c.result.items) c.result.items = [];
    const v = grade(b);
    const created = b.sessions.flatMap(createdKeys);
    expect(created.length, "CONTROL — the run created items").toBeGreaterThan(0);
    for (const k of created) expect({ k, named: findingsOf(v, "teardown-incomplete").some((f) => f.item === k) }).toEqual({ k, named: true });
    expect(codes(grade(buildPassingBundle("jira")))).not.toContain("teardown-incomplete");
  });
  test("jira: a second audit missing ONE created key fails teardown-incomplete naming exactly it", () => {
    const b = buildPassingBundle("jira");
    const key = createdKeys(session(b, "S1"))[0]!;
    for (const c of audits(b)[1]!.calls) if (c.result.items) c.result.items = c.result.items.filter((i) => i.key !== key);
    expect(findingsOf(grade(b), "teardown-incomplete").map((f) => f.item)).toEqual([key]);
  });
  for (const t of TRACKERS) {
    test(`${t}: a second audit whose query differs from the fence's by one byte fails teardown-incomplete`, () => {
      const b = buildPassingBundle(t);
      const c = audits(b)[1]!.calls.find((x) => /__(searchJiraIssuesUsingJql|list_issues)$/.test(x.name))!;
      if (t === "jira") c.input.jql = `${c.input.jql} `;
      else c.input.query = `${c.input.query} `;
      expect(codes(grade(b))).toContain("teardown-incomplete");
    });
    test(`${t}: a second audit that stops short of its last page fails teardown-incomplete`, () => {
      const b = buildPassingBundle(t);
      for (const c of audits(b)[1]!.calls) if (/__(searchJiraIssuesUsingJql|list_issues)$/.test(c.name)) c.result.lastPage = false;
      expect(codes(grade(b))).toContain("teardown-incomplete");
    });
  }
});

describe("HARDENING 4 — predicates with nothing to grade are not-observed, never pass", () => {
  for (const t of TRACKERS) {
    for (const id of ["S1", "S2"]) {
      test(`${t}: ${id} sessions that made calls but NO successful create are not-observed; PERMIT TWIN — the passing bundle passes ${id}`, () => {
        const b = buildPassingBundle(t);
        for (const s of sessionsOf(b, id)) for (const c of s.calls) if (isCreateCall(c)) c.result = { isError: true, text: "Error: 400 invalid_request — rejected", exitCode: null, items: null, lastPage: null };
        expect(grade(b).scenarios[id]?.outcome).toBe("not-observed");
        expect(grade(buildPassingBundle(t)).scenarios[id]?.outcome).toBe("pass");
      });
    }
    test(`${t}: S8 with NO successful legacy create is not-observed (the legacy-key check has nothing to check)`, () => {
      const b = buildPassingBundle(t);
      for (const c of session(b, "S8").calls) if (isCreateCall(c)) c.result = { isError: true, text: "Error: 400 invalid_request — rejected", exitCode: null, items: null, lastPage: null };
      expect(grade(b).scenarios.S8?.outcome).toBe("not-observed");
    });
    test(`${t}: a below-floor session whose refused write is NOT a titled create is not-observed (the audit-side count has no title to count by); PERMIT TWIN — the titled create passes S6`, () => {
      const b = buildPassingBundle(t);
      const c = session(b, "S6").calls[0]!;
      c.name = serverPrefix(t, "B") + (t === "jira" ? "editJiraIssue" : "save_issue");
      c.input = t === "jira" ? { cloudId: "cloud-dst", issueIdOrKey: createdKeys(session(b, "S1", 1))[0]!, fields: { labels: [TAG_B] } } : { id: createdKeys(session(b, "S1", 1))[0]!, labels: [TAG_B] };
      expect(grade(b).scenarios.S6?.outcome).toBe("not-observed");
      expect(grade(buildPassingBundle(t)).scenarios.S6?.outcome).toBe("pass");
    });
  }
});

describe("HARDENING 5 — S13 needs EACH of the claim and the import sync; S17 needs a merge --no-ff AND an aliased commit on each side", () => {
  for (const t of TRACKERS) {
    const claimTool = t === "jira" ? /__transitionJiraIssue$/ : /__save_issue$/;
    const isClaim = (c: ToolCall) => claimTool.test(c.name) && (t === "jira" || c.input.state !== undefined);
    const isSync = (c: ToolCall) => (t === "jira" ? /__editJiraIssue$/.test(c.name) : /__save_issue$/.test(c.name) && c.input.labels !== undefined);
    for (const [missing, drop] of [["the import sync", isSync], ["the claim transition", isClaim]] as const) {
      test(`${t}: S13 with ${missing} on A's key removed (the other alone, refused) fails S13; PERMIT TWIN — both present passes`, () => {
        const b = buildPassingBundle(t);
        const s = session(b, "S13");
        const aKey = createdKeys(session(b, "S1"))[0]!;
        const onA = s.calls.filter((c) => c.result.isError && JSON.stringify(c.input).includes(aKey));
        expect(onA.length, "CONTROL — the claim and the sync on A's key are both recorded").toBe(2);
        s.calls = s.calls.filter((c) => !(onA.includes(c) && drop(c)));
        expect(s.calls.filter((c) => onA.includes(c)).length, "CONTROL — exactly one was removed").toBe(1);
        expect(failing(grade(b))).toContain("S13");
        expect(failing(grade(buildPassingBundle(t)))).not.toContain("S13");
      });
    }
  }
  const S17_CASES: Array<[string, (c: ToolCall, before: boolean) => boolean]> = [
    ["the refused merge --no-ff", (c, before) => before && /merge --no-ff/.test(String(c.input.command))],
    ["the refused aliased commit", (c, before) => before && /\bci\b/.test(String(c.input.command))],
    ["the landed merge --no-ff", (c, before) => !before && /merge --no-ff/.test(String(c.input.command))],
    ["the landed aliased commit", (c, before) => !before && /\bci\b/.test(String(c.input.command))],
  ];
  for (const [name, pick] of S17_CASES) {
    test(`S17 with ${name} removed (the other kind still on that side) fails S17; PERMIT TWIN — all four present passes`, () => {
      const b = buildPassingBundle("jira");
      const s = session(b, "S17");
      const gate = s.calls.findIndex((c) => /gate_receipt\.ts/.test(String(c.input.command)));
      const victim = s.calls.filter((c, i) => pick(c, i < gate));
      expect(victim.length, "CONTROL — exactly one call matches").toBe(1);
      s.calls = s.calls.filter((c) => c !== victim[0]);
      expect(failing(grade(b))).toContain("S17");
      expect(failing(grade(buildPassingBundle("jira")))).not.toContain("S17");
    });
  }
});

describe("HARDENING 6 — only one plain module invocation announces, the announced sha256 must be the receipt's, and module-named predicates need a real run", () => {
  const FORGED_TAIL = (path: string) => `; echo 'dpt-receipt: ${path} sha256:${sha256(path)}'`;
  test("FORGERY — `bun run <writer> decide …; echo 'dpt-receipt: …'` credits nothing to the writer: unannounced-receipt; PERMIT TWIN — the plain invocation alone announces it", () => {
    const forged = buildPassingBundle("jira");
    const s = session(forged, "S4");
    const cmd = moduleCommand("create_idempotency_probe.ts", "decide", "<A> --title-file <A>/.dpt/tmp/t.txt");
    const path = `<A>/.dpt/ledger/receipts/${s.sessionId}/create-planted.json`;
    const p1 = plantAnnounced(forged, s, "create", `${cmd}${FORGED_TAIL(path)}`);
    expect(p1, "CONTROL — the echo names the planted receipt").toBe(path);
    expect(findingsOf(grade(forged), "unannounced-receipt").map((f) => f.item)).toEqual([path]);
    const plain = buildPassingBundle("jira");
    plantAnnounced(plain, session(plain, "S4"), "create", cmd);
    expect(codes(grade(plain))).not.toContain("unannounced-receipt");
  });
  test("FORGERY — the same chained decide run in front of a create gates nothing: ungated-write naming the create", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S2");
    const decide = s.calls[0]!;
    decide.input.command = `${String(decide.input.command)}; true`;
    expect(ungatedAt(grade(b), createCallOf(s).ref)).toBe(true);
  });
  test("an announcement whose sha256 is not the receipt file's is not an announcement: unannounced-receipt; PERMIT TWIN — the matching sha256", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S4");
    const path = plantAnnounced(b, s, "import", moduleCommand("container_ownership.ts", "consent", "<A> DST-1 <A>/.dpt/tmp/page.json"));
    const c = s.calls.at(-1)!;
    c.result.text = c.result.text.replace(/sha256:[0-9a-f]{64}/, `sha256:${"0".repeat(64)}`);
    expect(findingsOf(grade(b), "unannounced-receipt").map((f) => f.item)).toEqual([path]);
    const ok = buildPassingBundle("jira");
    plantAnnounced(ok, session(ok, "S4"), "import", moduleCommand("container_ownership.ts", "consent", "<A> DST-1 <A>/.dpt/tmp/page.json"));
    expect(codes(grade(ok))).not.toContain("unannounced-receipt");
  });
  for (const [id, marker, re] of [
    ["S12", "S12", /gate_receipt\.ts/],
    ["S17", "S17", /gate_receipt\.ts/],
    ["S14", "S3", /resolve_milestone_identity\.ts/],
  ] as const) {
    test(`FORGERY — ${id}: the ${marker === "S3" ? "join decision" : "gate evidence"} announcement printed by a model-written \`echo\` (same output) is no announcement, so ${id} does not pass; PERMIT TWIN — the module run passes ${id}`, () => {
      const b = buildPassingBundle("jira");
      const c = sessionsOf(b, marker).flatMap((s) => s.calls).find((x) => x.name === "Bash" && re.test(String(x.input.command)) && /dpt-receipt:/.test(x.result.text) && (marker !== "S3" || /act=join/.test(x.result.text)))!;
      expect(String(c.input.command), "CONTROL — no single quote to reproduce").not.toContain("'");
      c.input.command = `echo '${String(c.input.command)}'`;
      expect(grade(b).scenarios[id]?.outcome).not.toBe("pass");
      expect(grade(buildPassingBundle("jira")).scenarios[id]?.outcome).toBe("pass");
    });
  }
  const MODULE_OF: Record<string, RegExp> = {
    S4: /container_ownership\.ts/,
    S5: /sibling_release\.ts/,
    S14: /(attach_project_milestone|sibling_release)\.ts/,
    S16: /(next_free_milestone_number|plan_identity_mode_conditional)\.ts/,
  };
  for (const [id, re] of Object.entries(MODULE_OF)) {
    test(`FORGERY — ${id}: every run of its module rewritten to a model-written \`echo …; exit <code>\` with the same output does not pass ${id}; PERMIT TWIN — the real runs pass`, () => {
      const b = buildPassingBundle("jira");
      let n = 0;
      for (const s of sessionsOf(b, id)) {
        for (const c of s.calls) {
          if (c.name !== "Bash" || !re.test(String(c.input.command))) continue;
          expect(String(c.input.command), "CONTROL — the command carries no single quote, so the echo reproduces it byte for byte").not.toContain("'");
          c.input.command = `echo '${String(c.input.command)}'; exit ${c.result.exitCode ?? 0}`;
          n++;
        }
      }
      expect(n, "CONTROL — the scenario ran the module").toBeGreaterThan(0);
      expect(grade(b).scenarios[id]?.outcome).not.toBe("pass");
      expect(grade(buildPassingBundle("jira")).scenarios[id]?.outcome).toBe("pass");
    });
  }
});

/** Rewrite a materialized transcript's JSONL records; `f` returns the record, or null to drop it. */
function editTranscript(file: string, f: (rec: Record<string, any>) => Record<string, any> | null): void {
  const out: string[] = [];
  for (const l of readFileSync(file, "utf-8").split("\n")) {
    if (!l.trim()) continue;
    const r = f(JSON.parse(l));
    if (r !== null) out.push(JSON.stringify(r));
  }
  writeFileSync(file, out.join("\n") + "\n");
}

describe("HARDENING 7 — missing records abort or fail, never read as fine", () => {
  const b = buildPassingBundle("jira");
  const s16 = session(b, "S16");
  test("a tool_use with NO tool_result aborts tool-result-missing naming the session; PERMIT TWIN — the intact transcript grades pass", () => {
    withTmp("ste617-h7a-", (d) => {
      const m = materialize(b, d);
      const id = s16.calls[1]!.ref.split(":")[1]!;
      editTranscript(m.transcripts[s16.sessionId]!, (r) => (Array.isArray(r.message?.content) && r.message.content.some((x: any) => x.type === "tool_result" && x.tool_use_id === id) ? null : r));
      const r = gradeExtracted(extractFor(m));
      expect({ outcome: r.outcome, code: findingsOf(r, "tool-result-missing").some((f) => f.session === s16.sessionId) }).toEqual({ outcome: "abort", code: true });
    });
    withTmp("ste617-h7a-ok-", (d) => expect(gradeExtracted(extractFor(materialize(b, d))).outcome).toBe("pass"));
  });
  test("an UNREADABLE sidechain file aborts naming the session and the file; PERMIT TWIN — readable, it grades pass", () => {
    const det = sessionsOf(b, "S10").find((s) => s.calls.some((c) => c.sidechain))!;
    withTmp("ste617-h7b-", (d) => {
      const m = materialize(b, d);
      const side = join(dirname(m.transcripts[det.sessionId]!), det.sessionId, "subagents", "agent-a1b2c3d4e5f6a7b8c.jsonl");
      expect(existsSync(side), "CONTROL — the sidechain file exists").toBe(true);
      chmodSync(side, 0o000);
      try {
        const r = gradeExtracted(extractFor(m));
        expect(r.outcome).toBe("abort");
        const f = r.findings.find((x) => x.session === det.sessionId);
        expect(f?.detail ?? "", JSON.stringify(r.findings)).toContain("agent-a1b2c3d4e5f6a7b8c.jsonl");
      } finally {
        chmodSync(side, 0o644);
      }
    });
    withTmp("ste617-h7b-ok-", (d) => expect(gradeExtracted(extractFor(materialize(b, d))).outcome).toBe("pass"));
  });
  test("a TORN JSONL line aborts naming the session and the file; PERMIT TWIN — the same transcript untorn grades pass", () => {
    withTmp("ste617-h7c-", (d) => {
      const m = materialize(b, d);
      const file = m.transcripts[s16.sessionId]!;
      writeFileSync(file, `${readFileSync(file, "utf-8")}{"type":"user","message":{"content":[{"type":"tool_res\n`);
      const r = gradeExtracted(extractFor(m));
      expect(r.outcome).toBe("abort");
      const f = r.findings.find((x) => x.session === s16.sessionId);
      expect(f?.detail ?? "", JSON.stringify(r.findings)).toContain(`${s16.sessionId}.jsonl`);
    });
    withTmp("ste617-h7c-ok-", (d) => expect(gradeExtracted(extractFor(materialize(b, d))).outcome).toBe("pass"));
  });
  for (const t of TRACKERS) {
    test(`${t}: a successful create whose answer names NO key aborts create-key-unreadable naming the call (never vanishes from audit completeness or the budget); PERMIT TWIN — the passing bundle`, () => {
      const x = buildPassingBundle(t);
      const c = createCallOf(session(x, "S1"));
      c.result = { isError: false, text: "Created the issue.", exitCode: null, items: null, lastPage: null };
      const v = grade(x);
      expect(v.outcome).toBe("abort");
      expect(findingsOf(v, "create-key-unreadable").some((f) => (f.detail ?? "").startsWith(`${c.ref}:`))).toBe(true);
      const blank = buildPassingBundle(t);
      const c2 = createCallOf(session(blank, "S1"));
      c2.result.items = [{ ...c2.result.items![0]!, key: "" }];
      expect(codes(grade(blank)), "an answer whose key is empty").toContain("create-key-unreadable");
      expect(codes(grade(buildPassingBundle(t)))).not.toContain("create-key-unreadable");
    });
    test(`${t}: a listing page with NO paging fields is not proven last — the audit aborts audit-incomplete; PERMIT TWIN — the same page with its paging fields grades pass`, () => {
      const bb = buildPassingBundle(t);
      const a1 = audits(bb)[0]!;
      const last = a1.calls.find((c) => c.result.lastPage === true && /__(searchJiraIssuesUsingJql|list_issues)$/.test(c.name))!;
      const id = last.ref.split(":")[1]!;
      withTmp("ste617-h7e-", (d) => {
        const m = materialize(bb, d);
        editTranscript(m.transcripts[a1.sessionId]!, (r) => {
          for (const blk of Array.isArray(r.message?.content) ? r.message.content : []) {
            if (blk.type !== "tool_result" || blk.tool_use_id !== id) continue;
            const ans = JSON.parse(blk.content[0].text);
            for (const k of ["isLast", "hasNextPage", "nextPageToken", "cursor", "pageInfo"]) delete ans[k];
            blk.content[0].text = JSON.stringify(ans);
          }
          return r;
        });
        const r = gradeExtracted(extractFor(m));
        expect({ outcome: r.outcome, has: codes(r).includes("audit-incomplete") }).toEqual({ outcome: "abort", has: true });
      });
      withTmp("ste617-h7e-ok-", (d) => expect(gradeExtracted(extractFor(materialize(bb, d))).outcome).toBe("pass"));
    });
  }
  test("a Linear page carrying `pageInfo` is a shape the server was never observed to send: unreadable, so the audit aborts audit-incomplete whatever it says; PERMIT TWIN — the measured top-level `hasNextPage` page passes", () => {
    const bb = buildPassingBundle("linear");
    const a1 = audits(bb)[0]!;
    const last = a1.calls.find((c) => c.result.lastPage === true && /__list_issues$/.test(c.name))!;
    const id = last.ref.split(":")[1]!;
    const edits: Array<[string, (ans: Record<string, unknown>) => void]> = [
      ["paging moved under pageInfo.hasNextPage: false", (ans) => {
        for (const k of ["hasNextPage", "cursor"]) delete ans[k];
        ans.pageInfo = { hasNextPage: false, endCursor: null };
      }],
      ["pageInfo beside a top-level hasNextPage: false", (ans) => {
        ans.pageInfo = { hasNextPage: false, endCursor: null };
      }],
    ];
    for (const [why, edit] of edits) {
      withTmp("ste617-h7f-", (d) => {
        const m = materialize(bb, d);
        editTranscript(m.transcripts[a1.sessionId]!, (r) => {
          for (const blk of Array.isArray(r.message?.content) ? r.message.content : []) {
            if (blk.type !== "tool_result" || blk.tool_use_id !== id) continue;
            const ans = JSON.parse(blk.content[0].text);
            edit(ans);
            blk.content[0].text = JSON.stringify(ans);
          }
          return r;
        });
        const r = gradeExtracted(extractFor(m));
        expect({ why, outcome: r.outcome, has: codes(r).includes("audit-incomplete") }).toEqual({ why, outcome: "abort", has: true });
      });
    }
    withTmp("ste617-h7f-ok-", (d) => expect(gradeExtracted(extractFor(materialize(bb, d))).outcome).toBe("pass"));
  });
  for (const [t, tool] of [["jira", "getJiraIssue"], ["linear", "get_issue"]] as const) {
    test(`${t}: an inventoried tool (${tool}) with NO classification is unclassified-tool, never a read; PERMIT TWIN — the shipped inventory classifies it`, () => {
      withTmp("ste617-h7g-", (d) => {
        const inv = JSON.parse(readFileSync(join(pluginRoot, "adapters", "_shared", "data", "tracker-tool-inventory.json"), "utf-8"));
        const family = t === "jira" ? "atlassian" : "linear";
        expect(inv.servers[family].tools, "CONTROL — the tool is inventoried").toContain(tool);
        delete inv.servers[family].classification[tool];
        const p = join(d, "inventory.json");
        writeFileSync(p, JSON.stringify(inv));
        expect(findingsOf(grade(buildPassingBundle(t), { inventoryPath: p }), "unclassified-tool").some((f) => (f.tool ?? "").endsWith(`__${tool}`))).toBe(true);
        expect(codes(grade(buildPassingBundle(t)))).not.toContain("unclassified-tool");
      });
    });
  }
});

/** Tools one list names that the other does not. */
function toolSetDrift(grader: readonly string[], hook: readonly string[]): string[] {
  const g = new Set(grader);
  const h = new Set(hook);
  return [...[...h].filter((x) => !g.has(x)).map((x) => `the hook gates ${x}; the grader does not treat it as a write`), ...[...g].filter((x) => !h.has(x)).map((x) => `the grader treats ${x} as a write; the hook does not gate it`)];
}


// ===========================================================================
// MEASURED SHAPES — every tracker answer is read through tracker_answer.ts,
// the one reader of the shapes measured live (tests/fixtures/live-shapes/):
// Linear pages top-level `hasNextPage` + `cursor`, Linear list_milestones with
// no paging field (fewer than LINEAR_MILESTONE_WINDOW rows is complete), Jira
// plain and wrapped. An answer in no observed shape is recorded unreadable.
// ===========================================================================

/** Rewrite the answer of call `ref` in a materialized transcript. */
function editAnswer(m: Materialized, sessionId: string, ref: string, f: (ans: any) => unknown): void {
  const id = ref.split(":")[1]!;
  let hit = 0;
  editTranscript(m.transcripts[sessionId]!, (r) => {
    for (const blk of Array.isArray(r.message?.content) ? r.message.content : []) {
      if (blk.type !== "tool_result" || blk.tool_use_id !== id) continue;
      blk.content[0].text = JSON.stringify(f(JSON.parse(blk.content[0].text)));
      hit++;
    }
    return r;
  });
  if (hit !== 1) throw new Error(`fixture: ${ref} answered ${hit} times in its transcript`);
}

/** Pad S3 B's milestone listing (and its decision receipt's rowKeys) to `rows` rows. */
function padS3Listing(b: LiveBundle, rows: number): ToolCall {
  const s3b = sessionsOf(b, "S3").find((s) => s.root === "B")!;
  const listing = s3b.calls.find((c) => /__list_milestones$/.test(c.name))!;
  const set = b.repos.B.receipts;
  if (!set.readable) throw new Error("fixture: B's receipts unreadable");
  const receipt = set.records.find((r) => r.kind === "milestone-decision" && r.sessionId === s3b.sessionId)!;
  const rowKeys = (receipt.evidence.listing as { rowKeys: string[] }).rowKeys;
  for (let n = listing.result.items!.length; n < rows; n++) {
    const key = `0ad0ad${n.toString(16).padStart(2, "0")}-7d2e-4f00-9a00-${n.toString(16).padStart(12, "0")}`;
    listing.result.items!.push({ key, summary: `older milestone ${n}`, labels: [], status: "", parent: null, milestone: null, issueType: null, kind: "milestone", container: "" });
    rowKeys.push(key);
  }
  return listing;
}

describe("MEASURED SHAPES — the grader reads tracker answers only through tracker_answer.ts", () => {
  test("HIGH-B, PERMIT — a Linear list_milestones answer carries no paging field; with fewer than LINEAR_MILESTONE_WINDOW rows it is the whole list, so both S3 decisions are listed (no unlisted-decision)", () => {
    withTmp("ste617-ms-", (d) => {
      const b = buildPassingBundle("linear");
      const m = materialize(b, d);
      const listings = sessionsOf(b, "S3").flatMap((x) => x.calls.filter((c) => /__list_milestones$/.test(c.name)).map((c) => ({ file: m.transcripts[x.sessionId]!, id: c.ref.split(":")[1]! })));
      const keysOf = ({ file, id }: { file: string; id: string }): string[] => {
        for (const l of readFileSync(file, "utf-8").split("\n").filter((x) => x.trim())) {
          for (const blk of JSON.parse(l).message?.content ?? []) if (blk.type === "tool_result" && blk.tool_use_id === id) return Object.keys(JSON.parse(blk.content[0].text));
        }
        return [];
      };
      // STE-644: three listings — A's decision listing, A's re-list before its create, B's decision listing.
      expect(listings.map(keysOf), "CONTROL — each recorded milestone listing carries no paging field").toEqual([["milestones"], ["milestones"], ["milestones"]]);
      const r = gradeExtracted(extractFor(m));
      expect({ outcome: r.outcome, unlisted: findingsOf(r, "unlisted-decision") }).toEqual({ outcome: "pass", unlisted: [] });
      const listed = extractedBundle(extractFor(m)).sessions.filter((s) => s.marker === "S3").flatMap((s) => s.calls.filter((c) => /__list_milestones$/.test(c.name)));
      expect(listed.map((c) => c.result.lastPage)).toEqual([true, true, true]);
    });
  });
  test("HIGH-B, REFUSAL TWIN — a listing of exactly LINEAR_MILESTONE_WINDOW rows is not proven complete, so B's join decision is unlisted-decision; one row fewer is listed", () => {
    for (const [rows, unlisted] of [[LINEAR_MILESTONE_WINDOW, true], [LINEAR_MILESTONE_WINDOW - 1, false]] as const) {
      withTmp("ste617-ms-win-", (d) => {
        const b = buildPassingBundle("linear");
        padS3Listing(b, rows);
        const r = gradeExtracted(extractFor(materialize(b, d)));
        const s3b = sessionsOf(b, "S3").find((s) => s.root === "B")!.sessionId;
        expect({ rows, unlisted: findingsOf(r, "unlisted-decision").some((f) => f.session === s3b) }).toEqual({ rows, unlisted });
      });
    }
  });
  for (const t of TRACKERS) {
    test(`${t}: an answer in NO observed shape (a create answered as a bare array) is recorded unreadable — no items, its text naming why — so the create aborts create-key-unreadable; PERMIT TWIN — the measured create answer`, () => {
      withTmp("ste617-unshaped-", (d) => {
        const b = buildPassingBundle(t);
        const s1 = session(b, "S1");
        const c = createCallOf(s1);
        const m = materialize(b, d);
        editAnswer(m, s1.sessionId, c.ref, (ans) => [ans]);
        const x = extractFor(m);
        const bundle = extractedBundle(x);
        const got = session(bundle, "S1").calls.find((y) => y.ref === c.ref)!;
        expect({ items: got.result.items, lastPage: got.result.lastPage, isError: got.result.isError }).toEqual({ items: null, lastPage: null, isError: false });
        expect(got.result.text).toMatch(/^unreadable tracker answer: /);
        expect(grader().privacyViolations(bundle), "the unreadable answer's raw text never reaches the bundle").toEqual([]);
        const r = gradeExtracted(x);
        expect(r.outcome).toBe("abort");
        expect(findingsOf(r, "create-key-unreadable").some((f) => (f.detail ?? "").startsWith(`${c.ref}:`))).toBe(true);
      });
      withTmp("ste617-unshaped-ok-", (d) => expect(gradeExtracted(extractFor(materialize(buildPassingBundle(t), d))).outcome).toBe("pass"));
    });
  }
  test("linear: a listing whose rows sit under `nodes` (no observed Linear shape) is unreadable, so the audit's last page is unproven: audit-incomplete", () => {
    withTmp("ste617-nodes-", (d) => {
      const b = buildPassingBundle("linear");
      const a1 = audits(b)[0]!;
      const last = a1.calls.find((c) => c.result.lastPage === true && /__list_issues$/.test(c.name))!;
      const m = materialize(b, d);
      editAnswer(m, a1.sessionId, last.ref, (ans) => ({ nodes: ans.issues, hasNextPage: false }));
      const r = gradeExtracted(extractFor(m));
      expect({ outcome: r.outcome, has: codes(r).includes("audit-incomplete") }).toEqual({ outcome: "abort", has: true });
    });
  });
  test("jira (wrapped): a wrapped search page whose issues.pageInfo says hasNextPage is not the last page: audit-incomplete; PERMIT TWIN — the same page saying false passes", () => {
    const b = buildPassingBundle("jira");
    const a1 = audits(b)[0]!;
    const last = a1.calls.find((c) => c.result.lastPage === true && /__searchJiraIssuesUsingJql$/.test(c.name))!;
    for (const [more, outcome] of [[true, "abort"], [false, "pass"]] as const) {
      withTmp("ste617-wrapped-", (d) => {
        const m = materialize(b, d, { jiraShape: "wrapped" });
        editAnswer(m, a1.sessionId, last.ref, (ans) => {
          expect(Object.keys(ans).sort(), "CONTROL — the recorded page is wrapped").toEqual(["context", "issues"]);
          ans.issues.pageInfo = { hasNextPage: more, endCursor: more ? "page-3" : null };
          return ans;
        });
        expect({ more, outcome: gradeExtracted(extractFor(m)).outcome }).toEqual({ more, outcome });
      });
    }
  });
});

describe("HARDENING 8 — the grader's tracker-write tool set is the hook's", () => {
  test("DRIFT GUARD — TRACKER_WRITE_TOOL_NAMES equals the hook's TRACKER_WRITE_TOOLS", () => {
    const names = grader().TRACKER_WRITE_TOOL_NAMES;
    expect(Array.isArray(names), "the grader exports TRACKER_WRITE_TOOL_NAMES").toBe(true);
    expect(toolSetDrift(names ?? [], TRACKER_WRITE_TOOLS)).toEqual([]);
  });
  test("CONTROL — the drift comparator names a tool the grader lacks and one it adds", () => {
    expect(toolSetDrift(TRACKER_WRITE_TOOLS, TRACKER_WRITE_TOOLS)).toEqual([]);
    expect(toolSetDrift(TRACKER_WRITE_TOOLS.filter((x) => x !== "save_document"), TRACKER_WRITE_TOOLS)).toEqual(["the hook gates save_document; the grader does not treat it as a write"]);
    expect(toolSetDrift([...TRACKER_WRITE_TOOLS, "archive_issue"], TRACKER_WRITE_TOOLS)).toEqual(["the grader treats archive_issue as a write; the hook does not gate it"]);
  });
});

// STE-649 (AC-STE-649.7) — the grader mirrors the hook: addTeamworkGraphContext
// is a write, and a link's Jira-item sides resolve per side — a key or a
// /browse/<KEY> URL — so a numeric id, an ARI or another URL beside an owned
// side is ungraded no longer. Atlas project/goal and remote-link targets are
// no ticket subjects. Rows repoint S13's SUCCESSFUL edit of its own DST-101.
describe("AC-STE-649.7 — the grader's write set and link rule are the hook's", () => {
  test("AC-STE-649.7 — TRACKER_WRITE_TOOL_NAMES carries addTeamworkGraphContext, as the hook's TRACKER_WRITE_TOOLS does, with no drift", () => {
    const names = grader().TRACKER_WRITE_TOOL_NAMES ?? [];
    expect(names).toContain("addTeamworkGraphContext");
    expect(TRACKER_WRITE_TOOLS).toContain("addTeamworkGraphContext");
    expect(toolSetDrift(names, TRACKER_WRITE_TOOLS)).toEqual([]);
  });

  const TW = (object: string, target: string, relationshipType: string) => ({ cloudId: "c", relationshipType, objectIdentifier: object, targetObjectIdentifier: target });
  /** S13's successful edit of DST-101 (owned in its session), rewritten as `tool` with `input`. */
  const asWrite = (tool: string, input: Record<string, unknown>) => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S13");
    const call = s.calls.find((c) => /editJiraIssue$/.test(c.name) && !c.result.isError)!;
    expect(call, "the fixture has a successful ticket edit to repoint").toBeDefined();
    call.name = call.name.replace(/editJiraIssue$/, tool);
    call.input = input;
    return { b, s };
  };
  const flagged = (tool: string, input: Record<string, unknown>): string[] => {
    const { b, s } = asWrite(tool, input);
    return findingsOf(grade(b), "ungated-write").filter((f) => f.session === s.sessionId).map((f) => f.detail ?? "");
  };

  test("CONTROL — S13's edit of DST-101 is owned: the same call on DST-101 is no finding", () => {
    expect(flagged("editJiraIssue", { cloudId: "c", issueIdOrKey: "DST-101", fields: { summary: "x" } })).toEqual([]);
  });

  test("AC-STE-649.7 — a successful createIssueLink with a numeric, ARI or non-/browse/ URL side beside owned DST-101 is ungated-write (HEAD: one owned side sufficed)", () => {
    for (const side of ["10101", "ari:cloud:jira:9f3c0000:issue/10101", "https://x.atlassian.net/rest/api/3/issue/10101"]) {
      const f = flagged("createIssueLink", { cloudId: "c", inwardIssue: side, outwardIssue: "DST-101", type: "Relates" });
      expect({ side, flagged: f.length > 0 }).toEqual({ side, flagged: true });
    }
    // PERMIT TWINS — both sides resolved (a key, a /browse/ URL), one owned.
    expect(flagged("createIssueLink", { cloudId: "c", inwardIssue: "DST-9001", outwardIssue: "DST-101", type: "Relates" })).toEqual([]);
    expect(flagged("createIssueLink", { cloudId: "c", inwardIssue: "https://x.atlassian.net/browse/DST-9001", outwardIssue: "DST-101", type: "Relates" })).toEqual([]);
  });

  test("AC-STE-649.7 — a successful addTeamworkGraphContext is graded like the hook: all resolved sides unowned, or an unresolvable Jira-item side, is ungated-write; an owned object with an Atlas or remote target is not", () => {
    expect(flagged("addTeamworkGraphContext", TW("DST-9001", "DST-9002", "jira-work-item-blocks-jira-work-item")).length).toBeGreaterThan(0);
    expect(flagged("addTeamworkGraphContext", TW("ari:cloud:jira:9f3c0000:issue/10101", "DST-101", "jira-work-item-links-jira-work-item")).length).toBeGreaterThan(0);
    // An Atlas goal target shaped like the owned key is no ticket subject.
    expect(flagged("addTeamworkGraphContext", TW("DST-9001", "DST-101", "jira-work-item-contributes-to-atlassian-goal")).length).toBeGreaterThan(0);
    // PERMIT TWINS
    expect(flagged("addTeamworkGraphContext", TW("DST-9001", "DST-101", "jira-work-item-links-jira-work-item"))).toEqual([]);
    expect(flagged("addTeamworkGraphContext", TW("DST-101", "ATLAS-20426", "jira-work-item-tracks-atlassian-project"))).toEqual([]);
    expect(flagged("addTeamworkGraphContext", TW("DST-101", "https://example.invalid/runbook", "jira-work-item-links-jira-work-item-remote-link"))).toEqual([]);
  });
});

describe("HARDENING 9 — S11 grades B's relocated checkout: a worktree inside B, hook refusals, one naming the unreadable CLAUDE.md, nothing created", () => {
  for (const t of TRACKERS) {
    test(`${t}: PERMIT TWIN — the relocated worktree with both refusals and no created item passes S11`, () => {
      const b = buildPassingBundle(t);
      expect(session(b, "S11").cwd, "CONTROL — the fixture runs S11 in a worktree inside B").toBe("<B>/.s11/relocated");
      expect(grade(b).scenarios.S11?.outcome).toBe("pass");
    });
    for (const [where, root, cwd] of [["B's MAIN root", "B", "<B>"], ["a worktree inside A", "A", "<A>/.s11/relocated"]] as const) {
      test(`${t}: the same S11 records run from ${where} (not a worktree of B) fail S11`, () => {
        const b = buildPassingBundle(t);
        const s = session(b, "S11");
        s.root = root;
        s.cwd = cwd;
        expect(failing(grade(b))).toContain("S11");
      });
    }
    test(`${t}: refusals none of which names CLAUDE.md as unreadable fail S11`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S11");
      const unreadable = s.calls.filter((c) => /CLAUDE\.md/.test(c.result.text) && c.name !== "Bash");
      expect(unreadable.length, "CONTROL — exactly one refusal names CLAUDE.md").toBe(1);
      unreadable[0]!.result.text = unreadable[0]!.result.text.replace(/the declaration in .*$/m, `${createdKeys(session(b, "S1"))[0]}: the ticket is not owned by the declared target <B>/.s11/relocated.`);
      expect(failing(grade(b))).toContain("S11");
    });
    test(`${t}: a refusal that names CLAUDE.md but NOT as unreadable fails S11`, () => {
      const b = buildPassingBundle(t);
      const c = session(b, "S11").calls.find((x) => /CLAUDE\.md/.test(x.result.text) && x.name !== "Bash")!;
      c.result.text = c.result.text.replace(/the declaration in \S+ cannot be read: [^\n]*/, "the declaration in <B>/.s11/relocated/CLAUDE.md binds another project");
      expect(failing(grade(b))).toContain("S11");
    });
    test(`${t}: an S11 session that made NO tracker write is not-observed`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S11");
      s.calls = s.calls.filter((c) => c.name === "Bash");
      expect(grade(b).scenarios.S11?.outcome).toBe("not-observed");
    });
    test(`${t}: an item the audit reads under the title of an S11 create attempt fails S11 (counted from the audit, not only from tool_results)`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S11");
      const summary = title("S11 relocated write");
      const input = t === "jira" ? { cloudId: "cloud-dst", projectKey: b.run.container, issueTypeName: "Task", summary, additional_fields: { labels: [TAG_B] } } : { team: "STE", project: b.run.container, title: summary, labels: [TAG_B] };
      appendCall(s, `${serverPrefix(t, "B")}${t === "jira" ? "createJiraIssue" : "save_issue"}`, input, { isError: true, text: `PreToolUse:x hook error: [x]: Refusing: no create receipt.\nRemedy: decide.\nContext: mode=hook, ticket=unbound, skill=none, hook=pre-tracker-write-gate`, exitCode: null, items: null, lastPage: null }, "s11create");
      expect(failing(grade(b)), "CONTROL — the refused create alone is fine").not.toContain("S11");
      addToAudit(b, { key: t === "jira" ? "DST-182" : "STE-982", summary, labels: [TAG_B], status: "To Do", parent: null, milestone: null, issueType: t === "jira" ? "Task" : null, kind: "issue", container: b.run.container });
      expect(failing(grade(b))).toContain("S11");
    });
  }
  test("extraction records each session's working directory relative to its root: S11's is <B>/.s11/relocated, the others their root", () => {
    withTmp("ste617-h9-", (d) => {
      const b = buildPassingBundle("linear");
      const bundle = extractedBundle(extractFor(materialize(b, d)));
      expect(bundle.sessions.map((s) => [s.marker, s.cwd])).toEqual(b.sessions.map((s) => [s.marker, s.cwd]));
      expect(bundle.sessions.find((s) => s.marker === "S11")?.cwd).toBe("<B>/.s11/relocated");
    });
  });
});

// ===========================================================================
// AC.8 — what the artifact carries, graded on bundles that VARY each field.
// The equality tests above compare every field with the passing bundle's own
// values, which a grader that hard-codes the fixture's constants would also
// satisfy. Here each field is varied on its own, the verdict must carry the
// varied value, and a copy of the grader that hard-codes or omits that one
// field is loaded and shown to be caught by the same comparison.
// ===========================================================================

type CarriedField = "runId" | "nonce" | "tracker" | "pluginVersion" | "behaviourDigest" | "graderDigest" | "linearBudget.declared" | "linearBudget.spent" | "linearBudget.created" | "scenario.outcome" | "scenario.refs";

interface CarriedExpectation {
  runId: string;
  nonce: string;
  tracker: string;
  pluginVersion: string;
  behaviourDigest: { digest: string; files: Record<string, string> };
  graderDigest: string;
  linearBudget: { declared: number; spent: number; created: string[] } | null;
  scenarios: Record<string, { outcome: string; refs: string[] }>;
}

/** The AC.8 fields of `v` that differ from what the bundle (and the grader file that graded it) says they are. */
function carriedMismatches(v: LiveVerdict, e: CarriedExpectation): CarriedField[] {
  const out: CarriedField[] = [];
  if (v.runId !== e.runId) out.push("runId");
  if (v.nonce !== e.nonce) out.push("nonce");
  if (v.tracker !== e.tracker) out.push("tracker");
  if (v.pluginVersion !== e.pluginVersion) out.push("pluginVersion");
  if (JSON.stringify(v.behaviourDigest) !== JSON.stringify(e.behaviourDigest)) out.push("behaviourDigest");
  if (v.graderDigest !== e.graderDigest) out.push("graderDigest");
  if (e.linearBudget === null ? v.linearBudget !== null : v.linearBudget?.declared !== e.linearBudget.declared) out.push("linearBudget.declared");
  if (e.linearBudget !== null && v.linearBudget?.spent !== e.linearBudget.spent) out.push("linearBudget.spent");
  if (e.linearBudget !== null && JSON.stringify([...(v.linearBudget?.created ?? [])].sort()) !== JSON.stringify([...e.linearBudget.created].sort())) out.push("linearBudget.created");
  for (const [id, s] of Object.entries(e.scenarios)) {
    if (v.scenarios[id]?.outcome !== s.outcome) out.push("scenario.outcome");
    if (JSON.stringify(v.scenarios[id]?.refs ?? null) !== JSON.stringify(s.refs)) out.push("scenario.refs");
  }
  return [...new Set(out)];
}

/** The Linear issues the bundle's non-audit sessions created, read from the bundle itself. */
function bundleCreatedIssues(b: LiveBundle): string[] {
  return b.sessions
    .filter((s) => s.marker !== "audit")
    .flatMap((s) => s.calls.filter((c) => /__save_issue$/.test(c.name) && !c.input.id && !c.result.isError).flatMap((c) => (c.result.items ?? []).map((i) => i.key)));
}

/** What the artifact must carry for `b`, graded by the grader file at `graderFile`, under a registry whose worst case is `declared`. */
function expectationFor(b: LiveBundle, graderFile: string, declared: number, scenarioIds: readonly string[], outcomes: Record<string, string> = {}): CarriedExpectation {
  return {
    runId: b.run.runId,
    nonce: b.run.nonce,
    tracker: b.run.tracker,
    pluginVersion: b.run.pluginVersion,
    behaviourDigest: b.run.behaviourDigest,
    graderDigest: sha256(readFileSync(graderFile)),
    linearBudget: b.run.tracker === "linear" ? { declared, spent: bundleCreatedIssues(b).length, created: bundleCreatedIssues(b) } : null,
    scenarios: Object.fromEntries(scenarioIds.map((id) => [id, { outcome: outcomes[id] ?? "pass", refs: sessionsOf(b, id).flatMap((s) => s.calls.map((c) => c.ref)) }])),
  };
}

const SRC_DIR = dirname(GRADER_PATH);
const INVENTORY_PATH = join(pluginRoot, "adapters", "_shared", "data", "tracker-tool-inventory.json");

async function withTmpAsync(prefix: string, f: (dir: string) => Promise<void>): Promise<void> {
  const d = tmp(prefix);
  try {
    await f(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/**
 * A copy of the grader module, loaded from a scratch directory: its relative
 * imports point back at the shipped sources, `edit` is applied to its text
 * (the edit must change it — an unapplied mutation would read as a pass), and
 * when `worstCase` is given its registry import is a shim whose
 * `linearWorstCase()` returns that number.
 */
async function graderCopy(dir: string, name: string, edit: (src: string) => string, worstCaseOverride?: number): Promise<{ g: GraderModule; file: string }> {
  const original = readFileSync(GRADER_PATH, "utf-8");
  let src = edit(original);
  if (edit !== unchanged) expect(src === original, `the ${name} edit changes the grader's text`).toBe(false);
  src = src.replace(/from "\.\/([^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(join(SRC_DIR, p))}`);
  if (worstCaseOverride !== undefined) {
    const shim = join(dir, `${name}-registry.ts`);
    writeFileSync(shim, `export * from ${JSON.stringify(REGISTRY_PATH.replace(/\.ts$/, ""))};\nexport function linearWorstCase(): number {\n  return ${worstCaseOverride};\n}\n`);
    src = src.replace(`from ${JSON.stringify(join(SRC_DIR, "shared_tracker_scenarios"))}`, `from ${JSON.stringify(shim.replace(/\.ts$/, ""))}`);
    expect(src.includes(shim.replace(/\.ts$/, "")), "the copy imports the registry shim").toBe(true);
  }
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, `${src}\n// graderCopy ${name} ${randomBytes(4).toString("hex")}\n`);
  return { g: (await import(file)) as GraderModule, file };
}

function unchanged(src: string): string {
  return src;
}

/** Replace exactly one occurrence of `from` in the grader's text; fails the test when it is not there once. */
function once(from: string, to: string): (src: string) => string {
  return (src: string) => {
    expect(src.split(from).length - 1, `the grader holds exactly one \`${from}\``).toBe(1);
    return src.replace(from, to);
  };
}

const VARIED = {
  runId: "0f9e8d7c-varied-4b3a-9c2d-1e0f9a8b7c6d",
  nonce: "v3x8r1",
  pluginVersion: "2.97.4",
  behaviourDigest: { digest: sha256("varied behaviour digest"), files: { "hooks/hooks.json": sha256("varied hooks"), "adapters/_shared/src/gate_receipt.ts": sha256("varied receipt module") } },
};

/** The one scenario whose outcome and references the per-scenario siblings vary. */
const VARIED_SCENARIO = "S5";

/** The passing bundle with exactly one AC.8 field varied, and the scenario ids whose outcome/refs the expectation checks. */
function variedBundle(t: Tracker, field: CarriedField): { b: LiveBundle; outcomes: Record<string, string>; digestNow?: string } {
  if (field === "linearBudget.spent" || field === "linearBudget.created") return { b: buildPassingBundle(t, { intruderItems: 3 }), outcomes: {} };
  const b = buildPassingBundle(t);
  switch (field) {
    case "runId":
      b.run.runId = VARIED.runId;
      return { b, outcomes: {} };
    case "nonce":
      b.run.nonce = VARIED.nonce;
      return { b, outcomes: {} };
    case "pluginVersion":
      b.run.pluginVersion = VARIED.pluginVersion;
      return { b, outcomes: {} };
    case "behaviourDigest":
      b.run.behaviourDigest = clone(VARIED.behaviourDigest);
      return { b, outcomes: {}, digestNow: VARIED.behaviourDigest.digest };
    case "scenario.outcome":
      breakScenario(b, VARIED_SCENARIO);
      return { b, outcomes: { [VARIED_SCENARIO]: "fail" } };
    case "scenario.refs":
      for (const s of sessionsOf(b, VARIED_SCENARIO)) for (const c of s.calls) c.ref = `varied-${c.ref}`;
      return { b, outcomes: {} };
    default:
      return { b, outcomes: {} };
  }
}

/** The value the varied bundle's field has, read from the bundle, for the equality asserts. */
function variedValue(b: LiveBundle, field: CarriedField): unknown {
  switch (field) {
    case "runId":
      return b.run.runId;
    case "nonce":
      return b.run.nonce;
    case "pluginVersion":
      return b.run.pluginVersion;
    case "behaviourDigest":
      return b.run.behaviourDigest;
    case "linearBudget.spent":
      return bundleCreatedIssues(b).length;
    case "linearBudget.created":
      return [...bundleCreatedIssues(b)].sort();
    case "scenario.refs":
      return sessionsOf(b, VARIED_SCENARIO).flatMap((s) => s.calls.map((c) => c.ref));
    default:
      return null;
  }
}

function carriedValue(v: LiveVerdict, field: CarriedField): unknown {
  switch (field) {
    case "runId":
      return v.runId;
    case "nonce":
      return v.nonce;
    case "pluginVersion":
      return v.pluginVersion;
    case "behaviourDigest":
      return v.behaviourDigest;
    case "linearBudget.spent":
      return v.linearBudget?.spent;
    case "linearBudget.created":
      return [...(v.linearBudget?.created ?? [])].sort();
    case "scenario.refs":
      return v.scenarios[VARIED_SCENARIO]?.refs;
    default:
      return null;
  }
}

/** Per field: the one-field grader edit that hard-codes (or omits) it, the way a grader could pass the equality tests above and still carry nothing. */
const CARRIED_MUTANTS: ReadonlyArray<{ field: CarriedField; how: string; edit: (src: string) => string; trackers: readonly Tracker[] }> = [
  { field: "runId", how: "hard-codes the fixture's run id", edit: once("runId: b.run.runId,", `runId: "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",`), trackers: TRACKERS },
  { field: "runId", how: "omits the run id", edit: once("runId: b.run.runId,", ""), trackers: TRACKERS },
  { field: "nonce", how: "hard-codes the fixture's nonce", edit: once("nonce: b.run.nonce,", `nonce: ${JSON.stringify(NONCE)},`), trackers: TRACKERS },
  { field: "tracker", how: "hard-codes jira", edit: once("tracker: b.run.tracker,", `tracker: "jira",`), trackers: ["linear"] },
  { field: "pluginVersion", how: "hard-codes the fixture's plugin version", edit: once("pluginVersion: b.run.pluginVersion,", `pluginVersion: "2.90.0",`), trackers: TRACKERS },
  { field: "behaviourDigest", how: "keeps the digest but drops the per-file hashes", edit: once("behaviourDigest: b.run.behaviourDigest,", "behaviourDigest: { digest: b.run.behaviourDigest.digest, files: {} },"), trackers: TRACKERS },
  { field: "graderDigest", how: "hard-codes the shipped grader's digest", edit: once("graderDigest: graderDigest(),", `graderDigest: ${JSON.stringify(sha256(readFileSync(GRADER_PATH)))},`), trackers: TRACKERS },
  { field: "linearBudget.declared", how: "hard-codes the registry's worst case of today", edit: once("return { declared: linearWorstCase(), spent: created.length, created };", `return { declared: ${worstCase()}, spent: created.length, created };`), trackers: ["linear"] },
  { field: "linearBudget.spent", how: "hard-codes the fixture's seven issues spent", edit: once("return { declared: linearWorstCase(), spent: created.length, created };", "return { declared: linearWorstCase(), spent: 7, created };"), trackers: ["linear"] },
  { field: "linearBudget.created", how: "omits the created issues", edit: once("return { declared: linearWorstCase(), spent: created.length, created };", "return { declared: linearWorstCase(), spent: created.length, created: [] };"), trackers: ["linear"] },
  {
    field: "scenario.outcome",
    how: "hard-codes every live outcome to pass",
    edit: once("out[s.id] = r.reason === undefined ? { outcome: r.outcome, refs } : { outcome: r.outcome, reason: r.reason, refs };", `out[s.id] = { outcome: "pass", refs };`),
    trackers: TRACKERS,
  },
  { field: "scenario.refs", how: "omits the record references", edit: once("const refs = own.flatMap((x) => x.calls.map((c) => c.ref));", "const refs: string[] = [];"), trackers: TRACKERS },
];

const WORST_CASE_VARIED = () => worstCase() + 3;

/** The varied bundle a mutant is graded on: the declared budget is varied through the registry shim, the grader digest through the copy's own bytes. */
function mutantInput(t: Tracker, field: CarriedField): { b: LiveBundle; outcomes: Record<string, string>; digestNow?: string } {
  if (field === "tracker" || field === "graderDigest" || field === "linearBudget.declared") return { b: buildPassingBundle(t), outcomes: {} };
  return variedBundle(t, field);
}

describe("AC.8 VARIED — the artifact carries each field's varied value, and a grader that hard-codes or omits one is caught", () => {
  const OWN_FIELDS: CarriedField[] = ["runId", "nonce", "pluginVersion", "behaviourDigest", "scenario.refs"];
  for (const t of TRACKERS) {
    for (const field of OWN_FIELDS) {
      test(`${t}: AC.8 VARIED — ${field}: a bundle varying only it yields an artifact carrying the varied value`, () => {
        const base = buildPassingBundle(t);
        const { b, digestNow } = variedBundle(t, field);
        expect(variedValue(b, field), `control: the sibling varies ${field}`).not.toEqual(variedValue(base, field));
        const v = grade(b, digestNow ? { behaviourDigestNow: digestNow } : {});
        expect(carriedValue(v, field)).toEqual(variedValue(b, field));
        expect(carriedMismatches(v, expectationFor(b, GRADER_PATH, worstCase(), [VARIED_SCENARIO]))).toEqual([]);
      });
    }
    test(`${t}: AC.8 VARIED — scenario.outcome: ${VARIED_SCENARIO} broken alone is carried as fail, with the references it was decided on`, () => {
      const { b, outcomes } = variedBundle(t, "scenario.outcome");
      const v = grade(b);
      expect(v.scenarios[VARIED_SCENARIO]?.outcome).toBe("fail");
      expect(grade(buildPassingBundle(t)).scenarios[VARIED_SCENARIO]?.outcome, "control: unbroken it passes").toBe("pass");
      expect(carriedMismatches(v, expectationFor(b, GRADER_PATH, worstCase(), [VARIED_SCENARIO], outcomes))).toEqual([]);
    });
  }
  test("AC.8 VARIED — tracker: the jira and linear bundles each carry their own tracker", () => {
    expect([grade(buildPassingBundle("jira")).tracker, grade(buildPassingBundle("linear")).tracker]).toEqual(["jira", "linear"]);
  });
  for (const field of ["linearBudget.spent", "linearBudget.created"] as const) {
    test(`linear: AC.8 VARIED — ${field}: a bundle creating three more issues carries the varied value`, () => {
      const { b } = variedBundle("linear", field);
      expect(variedValue(b, field), "control: the sibling varies the issues created").not.toEqual(variedValue(buildPassingBundle("linear"), field));
      const v = grade(b);
      expect(carriedValue(v, field)).toEqual(variedValue(b, field));
    });
  }
  test("linear: AC.8 VARIED — linearBudget.declared: under a registry whose worst case is three more, the artifact declares that number", async () => {
    await withTmpAsync("ste617-ac8-decl-", async (d) => {
      const { g, file } = await graderCopy(d, "declared", unchanged, WORST_CASE_VARIED());
      const b = buildPassingBundle("linear");
      const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest, hooksJsonPath: HOOKS_JSON, inventoryPath: INVENTORY_PATH });
      expect(v.linearBudget?.declared).toBe(WORST_CASE_VARIED());
      expect(carriedMismatches(v, expectationFor(b, file, WORST_CASE_VARIED(), [VARIED_SCENARIO]))).toEqual([]);
    });
  });
  test("AC.8 VARIED — graderDigest: a grader copy with other bytes carries its own digest, not the shipped grader's", async () => {
    await withTmpAsync("ste617-ac8-gd-", async (d) => {
      const { g, file } = await graderCopy(d, "digest", unchanged);
      const b = buildPassingBundle("jira");
      const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest, hooksJsonPath: HOOKS_JSON, inventoryPath: INVENTORY_PATH });
      expect(v.graderDigest).toBe(sha256(readFileSync(file)));
      expect(v.graderDigest, "control: the copy's bytes differ from the shipped grader's").not.toBe(sha256(readFileSync(GRADER_PATH)));
    });
  });

  for (const m of CARRIED_MUTANTS) {
    for (const t of m.trackers) {
      test(`${t}: AC.8 MUTATION — a grader copy that ${m.how} is caught on the bundle varying ${m.field}; PERMIT TWIN — the unmutated copy is not`, async () => {
        await withTmpAsync("ste617-ac8-mut-", async (d) => {
          const declared = m.field === "linearBudget.declared" ? WORST_CASE_VARIED() : undefined;
          const { b, outcomes, digestNow } = mutantInput(t, m.field);
          const gradeWith = (g: GraderModule) => g.gradeBundle(b, { behaviourDigestNow: digestNow ?? b.run.behaviourDigest.digest, hooksJsonPath: HOOKS_JSON, inventoryPath: INVENTORY_PATH });
          const twin = await graderCopy(d, "twin", unchanged, declared);
          expect(carriedMismatches(gradeWith(twin.g), expectationFor(b, twin.file, declared ?? worstCase(), [VARIED_SCENARIO], outcomes)), "PERMIT TWIN").toEqual([]);
          const mutant = await graderCopy(d, "mutant", m.edit, declared);
          expect(carriedMismatches(gradeWith(mutant.g), expectationFor(b, mutant.file, declared ?? worstCase(), [VARIED_SCENARIO], outcomes))).toEqual([m.field]);
        });
      });
    }
  }
});

// ===========================================================================
// STE-618 follow-ups — the command line prints what the live-proof gate reads.
// `extract` prints the bundle's hash through the ONE `bundleHash(dir)`, and
// `grade` writes its verdict to `<bundle dir>/verdict.json`, the file
// live_proof_gate.ts reads the recorded outcome and scenario set from.
// ===========================================================================

describe("STE-618 follow-ups — the grader CLI's extract and grade", () => {
  const SMOKE_VERDICT_PATH = join(pluginRoot, "adapters", "_shared", "src", "smoke_verdict.ts");
  function cli(args: string[], cwd: string) {
    const r = Bun.spawnSync([process.execPath, GRADER_PATH, ...args], { cwd });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }
  function bundleHashOf(dir: string): string {
    const f = (grader() as unknown as { bundleHash?: (d: string) => string }).bundleHash;
    if (typeof f !== "function") throw new Error("the grader exports no bundleHash(dir)");
    return f(dir);
  }
  /** A materialized synthetic run laid out the way `extract` reads it: a project root with a plugin manifest and the run ledger. */
  function extractArgs(d: string, t: Tracker): { args: string[]; out: string } {
    const m = materialize(buildPassingBundle(t), d);
    const project = join(d, "project");
    mkdirSync(join(project, "plugins", "dev-process-toolkit", ".claude-plugin"), { recursive: true });
    writeFileSync(join(project, "plugins", "dev-process-toolkit", ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "dev-process-toolkit", version: m.run.pluginVersion })}\n`);
    const ledger = join(project, ".dpt", "ledger", `smoke-run-${m.run.runId}.jsonl`);
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(ledger, m.ledger.map((s) => JSON.stringify({ run: m.run.runId, leg: `shared-${t}`, session_id: s, parent: null, spawned_at: m.run.startedAt })).join("\n") + "\n");
    const tracked = join(d, "tracked.txt");
    writeFileSync(tracked, "");
    const out = join(d, "bundle-out");
    const args = [
      "extract",
      "--project-root", project, "--run", m.run.runId, "--leg", `shared-${t}`, "--tracker", t, "--nonce", m.run.nonce,
      "--root-a", m.roots.A, "--root-b", m.roots.B, "--config-dir", m.configDir,
      "--digest-at-start", m.run.behaviourDigest.digest, "--out", out,
      "--container", m.run.container, ...(m.run.repointFrom ? ["--repoint-from", m.run.repointFrom] : []),
      ...(m.run.linearTeam ? ["--linear-team", m.run.linearTeam] : []),
      "--below-floor", join(project, "plugins", "dev-process-toolkit"), "--tracked-list", tracked,
    ];
    return { args, out };
  }

  // MEDIUM-C (fifth audit): the grader must not depend on the skill having
  // refused first. A Linear extract with no --linear-team would leave the run's
  // team null, and the team-conjunct check would degrade to a shape check.
  test("REFUSE — a Linear extract with no --linear-team exits non-zero, naming the flag, and writes no bundle", () => {
    withTmp("ste617-no-team-", (d) => {
      const { args, out } = extractArgs(d, "linear");
      const i = args.indexOf("--linear-team");
      expect(i, "control: the permit form carries --linear-team").toBeGreaterThan(-1);
      args.splice(i, 2);
      const r = cli(args, d);
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(/--linear-team/);
      expect(existsSync(join(out, "bundle.json"))).toBe(false);
    });
  });
  test("REFUSE — a Linear bundle whose run records no team fails team-conjunct-inert, never a shape-only pass", () => {
    const b = buildPassingBundle("linear");
    b.run.linearTeam = null;
    expect(findingsOf(grade(b), "team-conjunct-inert").some((f) => /no team/.test(f.detail))).toBe(true);
  });

  for (const t of TRACKERS) {
    test(`${t}: extract prints NO bundle-hash — the plan row's hash is taken after grade writes verdict.json into the same directory`, () => {
      withTmp("ste618-cli-x-", (d) => {
        const { args, out } = extractArgs(d, t);
        const r = cli(args, d);
        expect(r.code, r.err).toBe(0);
        expect(existsSync(join(out, "bundle.json")), "control: extract wrote the bundle").toBe(true);
        expect(r.out, "a hash printed before verdict.json exists can never match the plan row").not.toMatch(/bundle-hash=/);
      });
    });
    test(`${t}: grade prints bundle-hash=<64 hex> AFTER writing verdict.json — the hash the plan row records and the gate recomputes, covering the verdict`, () => {
      withTmp("ste618-cli-xg-", (d) => {
        const { args, out } = extractArgs(d, t);
        expect(cli(args, d).code).toBe(0);
        const before = bundleHashOf(out);
        const g = cli(["grade", "--bundle", out], d);
        expect([0, 1], g.err).toContain(g.code);
        expect(existsSync(join(out, "verdict.json")), "control: grade wrote the verdict").toBe(true);
        const lines = g.out.split("\n").filter((l) => l.startsWith("bundle-hash="));
        expect(lines, g.out).toHaveLength(1);
        expect(lines[0]).toBe(`bundle-hash=${bundleHashOf(out)}`);
        expect(lines[0], "the printed hash must cover verdict.json, so a hand-edited recorded verdict reads bundle-altered").not.toBe(`bundle-hash=${before}`);
      });
    });
  }

  test("an extract that aborts prints no bundle-hash line (no bundle, no hash)", () => {
    withTmp("ste618-cli-xa-", (d) => {
      const { args } = extractArgs(d, "jira");
      const i = args.indexOf("--config-dir");
      const broken = [...args];
      broken[i + 1] = join(d, "no-such-config-dir");
      const r = cli(broken, d);
      expect(r.code).not.toBe(0);
      expect(r.out).not.toMatch(/bundle-hash=/);
    });
  });

  test("grade with no --verdict writes <bundle dir>/verdict.json carrying the outcome and scenario set the gate reads; smoke_verdict reads its outcome", () => {
    withTmp("ste618-cli-g-", (d) => {
      const b = buildPassingBundle("linear");
      const dir = join(d, "bundle");
      const w = grader().writeEvidenceBundle(b, dir);
      expect(w.ok).toBe(true);
      expect(existsSync(join(dir, "verdict.json")), "control: no verdict before grade").toBe(false);
      const r = cli(["grade", "--bundle", dir], d);
      expect([0, 1], r.err).toContain(r.code);
      const file = join(dir, "verdict.json");
      expect(existsSync(file), `${r.out}\n${r.err}`).toBe(true);
      const v = JSON.parse(readFileSync(file, "utf-8")) as LiveVerdict;
      const now = grader().behaviourDigest(pluginRoot);
      const expected = grader().gradeBundle(b, { behaviourDigestNow: now.ok ? now.digest : "" });
      expect((SMOKE_OUTCOMES as readonly string[]).includes(v.outcome)).toBe(true);
      expect(v.outcome).toBe(expected.outcome);
      expect(Object.keys(v.scenarios).sort()).toEqual(Object.keys(expected.scenarios).sort());
      expect(Object.keys(v.scenarios).length).toBeGreaterThan(0);
      const read = Bun.spawnSync([process.execPath, SMOKE_VERDICT_PATH, "outcome", "--artifact", file], { cwd: d });
      expect(read.stdout.toString().trim(), read.stderr.toString()).toBe(v.outcome);
    });
  });

  test("REGRESSION PIN — the bundle and verdict writers leave no temp file behind, on a write and on a refused write (the atomicity itself is not test-observable: it shows only under a crash mid-write)", () => {
    withTmp("ste618-atomic-", (d) => {
      const dir = join(d, "bundle");
      expect(grader().writeEvidenceBundle(buildPassingBundle("jira"), dir).ok).toBe(true);
      expect(grader().writeVerdictFile({ outcome: "pass", findings: [], scenarios: {} }, join(dir, "verdict.json")).ok).toBe(true);
      expect(grader().writeVerdictFile({ outcome: "abort", findings: [{ code: "x", detail: "ops@acme-sandbox.io" }] }, join(dir, "verdict.json")).ok).toBe(false);
      expect(readdirSync(dir).sort()).toEqual(["bundle.json", "verdict.json"]);
    });
  });

  test("an ABORT verdict is still written when the bundle directory sits under a home path: bundle-missing names only the directory's own name, never an absolute path", () => {
    withTmp("ste618-cli-ab-", (d) => {
      // A bundle directory under a /home/<name>-shaped path, holding no bundle.json.
      const dir = join(d, "home", "alice", "jira-2026-09-21-n7k2q9");
      mkdirSync(dir, { recursive: true });
      const r = cli(["grade", "--bundle", dir], d);
      expect(r.code, r.err).toBe(1);
      const file = join(dir, "verdict.json");
      expect(existsSync(file), `the abort verdict was not written:\n${r.err}`).toBe(true);
      const v = JSON.parse(readFileSync(file, "utf-8")) as LiveVerdict;
      expect(v.outcome).toBe("abort");
      const f = v.findings.find((x) => x.code === "bundle-missing");
      expect(f, JSON.stringify(v.findings)).toBeDefined();
      expect(JSON.stringify(f)).toContain("jira-2026-09-21-n7k2q9");
      expect(JSON.stringify(v)).not.toContain(d);
    });
  });

  test("PERMIT TWIN — grade given --verdict <file> still writes exactly there", () => {
    withTmp("ste618-cli-g2-", (d) => {
      const dir = join(d, "bundle");
      expect(grader().writeEvidenceBundle(buildPassingBundle("jira"), dir).ok).toBe(true);
      const elsewhere = join(d, "elsewhere", "v.json");
      const r = cli(["grade", "--bundle", dir, "--verdict", elsewhere], d);
      expect([0, 1], r.err).toContain(r.code);
      expect(existsSync(elsewhere)).toBe(true);
      expect(typeof JSON.parse(readFileSync(elsewhere, "utf-8")).outcome).toBe("string");
    });
  });
});

// ===========================================================================
// LIVE FIDELITY — a correct live run grades correctly (the second audit of the
// grader against the live answer shapes and the `claude -p` child's routes).
// Live shapes measured read-only on 2026-09-21: Linear list_issues →
// `{ issues, hasNextPage, cursor }` whose issue `id` IS the identifier
// (`STE-618`, no `identifier` field); Linear get_project → `status: { id,
// name, type }`; Jira search → `{ issues, nextPageToken, isLast }` or, on the
// same server days apart, wrapped `{ context, issues: { nodes, pageInfo } }`.
// The pinned answers live under tests/fixtures/live-shapes/ and are read only
// through tracker_answer.ts (see MEASURED SHAPES above).
// ===========================================================================

interface GraderExtras {
  projectItem(tracker: Tracker, tool: string, raw: Record<string, unknown>): TrackerItem;
  AUDIT_REQUEST_FIELDS: Readonly<Record<Tracker, { issue: readonly string[]; milestone: { list: string; get: string } | null }>>;
  AUDIT_ALWAYS_RETURNED: Readonly<Record<Tracker, { issue: readonly string[]; milestone: readonly string[] | null }>>;
  keysOutsideSpaces(b: LiveBundle, spaces: readonly string[] | null): string[];
}
const extras = (g: unknown = grader()): GraderExtras => g as GraderExtras;

/** The intruder's untagged item, the one S13 imports. */
const intruderKey = (b: LiveBundle): string => sessionsOf(b, "intruder").flatMap(createdKeys)[0]!;

/** The S13 import write on the intruder's item (the label sync that follows the consent). */
function importWrite(b: LiveBundle): ToolCall {
  const u = intruderKey(b);
  const c = session(b, "S13").calls.find((x) => !x.result.isError && x.name !== "Bash" && String(x.input.issueIdOrKey ?? x.input.id) === u);
  if (!c) throw new Error("fixture: S13 has no import write on the intruder's item");
  return c;
}

describe("HIGH 1 — S13 consent through the sanctioned answers block (the route a claude -p child has)", () => {
  const blockBundle = (t: Tracker, f?: (s: BundleSession, u: string) => void): LiveBundle => {
    const b = buildPassingBundle(t, { importConsent: "answers-block" });
    f?.(session(b, "S13"), intruderKey(b));
    return b;
  };

  for (const t of TRACKERS) {
    test(`${t}: CONTROL — the answers-block S13 session records no AskUserQuestion, and carries tracker_orphan_import: Import <KEY>`, () => {
      const b = blockBundle(t);
      const s = session(b, "S13");
      expect(s.calls.some((c) => c.name === "AskUserQuestion")).toBe(false);
      expect(s.answers).toEqual({ tracker_orphan_import: `Import ${intruderKey(b)}` });
    });
    test(`${t}: PERMIT — the block's value \`Import <KEY>\`, given before the import, passes S13 and gates the import (no ungated-write)`, () => {
      const v = grade(blockBundle(t));
      expect({ outcome: v.outcome, findings: v.findings, s13: v.scenarios.S13?.outcome }).toEqual({ outcome: "pass", findings: [], s13: "pass" });
    });
    test(`${t}: REFUSE — the block's value \`Skip <KEY>\` is no consent: S13 fails and the import is ungated-write`, () => {
      // v2.89.0's tracker-write hook accepted ANY block value that merely named
      // the key (namesKey), so `Skip <KEY>` read there as consent (D-8, fixed in
      // this milestone). The grade requires the value to EQUAL `Import <KEY>`.
      const b = blockBundle(t, (s, u) => (s.answers = { tracker_orphan_import: `Skip ${u}` }));
      const v = grade(b);
      expect(failing(v)).toContain("S13");
      expect(findingsOf(v, "ungated-write").some((f) => f.session === session(b, "S13").sessionId)).toBe(true);
    });
  }
  test("REFUSE — the block names ANOTHER ticket (`Import <OTHER>`): S13 fails", () => {
    const b = blockBundle("jira", (s) => (s.answers = { tracker_orphan_import: "Import DST-999" }));
    expect(failing(grade(b))).toContain("S13");
  });
  test("REFUSE — the right label under a DIFFERENT answers key is no consent: S13 fails", () => {
    const b = blockBundle("jira", (s, u) => (s.answers = { tracker_orphan_adopt: `Import ${u}` }));
    expect(failing(grade(b))).toContain("S13");
  });
  test("ORDER — a block given only AFTER the import write fails S13; BEFORE it (the permit row) passes", () => {
    const b = blockBundle("linear");
    const s = session(b, "S13");
    s.answersAt = new Date(Date.parse(importWrite(b).at) + 1000).toISOString();
    expect(failing(grade(b))).toContain("S13");
    expect(failing(grade(blockBundle("linear")))).not.toContain("S13");
  });
  test("REFUSE — neither an answered AskUserQuestion nor a block: S13 fails", () => {
    const b = blockBundle("jira", (s) => {
      delete s.answers;
      delete s.answersAt;
    });
    expect(failing(grade(b))).toContain("S13");
  });

  for (const { t, shape, name } of LEGS) {
    test(`${name}: ROUND TRIP — the block written in the child's first user message is extracted through auto_answers.ts and the run grades pass`, () => {
      withTmp("ste617-ans-", (d) => {
        const m = materialize(blockBundle(t), d, { jiraShape: shape });
        const bundle = extractedBundle(extractFor(m));
        const s = session(bundle, "S13");
        expect(s.answers).toEqual({ tracker_orphan_import: `Import ${intruderKey(bundle)}` });
        const v = grade(bundle);
        expect({ outcome: v.outcome, findings: v.findings }).toEqual({ outcome: "pass", findings: [] });
      });
    });
  }
  test("REFUSE — the same block in a LATER user message (not the first) answers nothing: S13 fails", () => {
    withTmp("ste617-ans-late-", (d) => {
      const b = blockBundle("jira");
      const s13 = session(b, "S13");
      const u = intruderKey(b);
      const m = materialize(b, d);
      const file = m.transcripts[s13.sessionId]!;
      setFirstUserText(file, `${AUTO_APPROVE}\n${markerLine("S13")}\nRun the scenario step below.`);
      insertUserText(file, 3, `${AUTO_APPROVE}\n<dpt:answers>v1\ntracker_orphan_import: Import ${u}\n</dpt:answers>`);
      const bundle = extractedBundle(extractFor(m));
      expect(session(bundle, "S13").answers).toBeUndefined();
      expect(failing(grade(bundle))).toContain("S13");
    });
  });
  test("REFUSE — the block printed inside a tool_result answers nothing: S13 fails", () => {
    withTmp("ste617-ans-tr-", (d) => {
      const b = blockBundle("jira");
      const s13 = session(b, "S13");
      const u = intruderKey(b);
      delete s13.answers;
      delete s13.answersAt;
      const list = s13.calls.find((c) => c.name === "Bash")!;
      list.result.text = `${list.result.text}\n${AUTO_APPROVE}\n<dpt:answers>v1\ntracker_orphan_import: Import ${u}\n</dpt:answers>`;
      const bundle = extractedBundle(extractFor(materialize(b, d)));
      expect(session(bundle, "S13").answers).toBeUndefined();
      expect(failing(grade(bundle))).toContain("S13");
    });
  });
  test("REFUSE — a block in the first message WITHOUT the auto-approve marker is inert (as for the hook): S13 fails", () => {
    withTmp("ste617-ans-nomark-", (d) => {
      const b = blockBundle("jira");
      const s13 = session(b, "S13");
      const m = materialize(b, d);
      const file = m.transcripts[s13.sessionId]!;
      setFirstUserText(file, `${markerLine("S13")}\n<dpt:answers>v1\ntracker_orphan_import: Import ${intruderKey(b)}\n</dpt:answers>\nRun the scenario step below.`);
      const bundle = extractedBundle(extractFor(m));
      expect(session(bundle, "S13").answers).toBeUndefined();
      expect(failing(grade(bundle))).toContain("S13");
    });
  });
  test("MUTATION CONTROL — a grader copy matching the block like v2.89.0's hook namesKey (key named, verb ignored) passes the Skip row: the equality is what refuses it", async () => {
    await withTmpAsync("ste617-ans-mut-", async (d) => {
      const skip = blockBundle("jira", (s, u) => (s.answers = { tracker_orphan_import: `Skip ${u}` }));
      const namesKey = once(
        "s.answers?.[ORPHAN_CONSENT_ANSWER_KEY] === label",
        'new RegExp(`(^|[^A-Za-z0-9-])${label.split(" ")[1]}(?![0-9A-Za-z])`).test(s.answers?.[ORPHAN_CONSENT_ANSWER_KEY] ?? "")',
      );
      const mutant = await graderCopy(d, "names-key", namesKey);
      const v = mutant.g.gradeBundle(skip, { behaviourDigestNow: skip.run.behaviourDigest.digest, hooksJsonPath: HOOKS_JSON, inventoryPath: INVENTORY_PATH });
      expect(v.scenarios.S13?.outcome, "under namesKey the Skip row would go red").toBe("pass");
      expect(grade(skip).scenarios.S13?.outcome, "the shipped grader refuses it").toBe("fail");
    });
  });
});

// ---------------------------------------------------------------------------
// HIGH 2 + item 7 — the audit field contract, derived and graded
// ---------------------------------------------------------------------------

type AuditKind = "issue" | "milestone";
const AUDIT_KINDS: readonly AuditKind[] = ["issue", "milestone"];
/** The audit tools whose answers each kind's field contract governs (Jira reads its Epic milestones as issues: no milestone read). */
const AUDIT_TOOL: Record<AuditKind, Record<Tracker, RegExp | null>> = {
  issue: { jira: /__(searchJiraIssuesUsingJql|getJiraIssue)$/, linear: /__(list_issues|get_issue)$/ },
  milestone: { jira: null, linear: /__(list_milestones|get_milestone)$/ },
};
const PROJECTION_TOOL: Record<AuditKind, Record<Tracker, string | null>> = {
  issue: { jira: "mcp__atlassian__searchJiraIssuesUsingJql", linear: "mcp__linear__list_issues" },
  milestone: { jira: null, linear: "mcp__linear__list_milestones" },
};
/** The (tracker, kind) pairs the audit reads: every issue kind, and Linear's milestones. */
const AUDITED: ReadonlyArray<[Tracker, AuditKind]> = TRACKERS.flatMap((t) => AUDIT_KINDS.filter((k) => AUDIT_TOOL[k][t] !== null).map((k) => [t, k] as [Tracker, AuditKind]));

/**
 * Every TrackerItem field the grade READS on an audit item of `kind`, measured by
 * grading the passing bundle with each such item wrapped in a recording Proxy.
 */
function fieldsReadOnAuditItems(g: GraderModule, t: Tracker, kind: AuditKind = "issue"): Set<string> {
  const b = buildPassingBundle(t);
  const read = new Set<string>();
  const tool = AUDIT_TOOL[kind][t]!;
  for (const a of audits(b)) {
    for (const c of a.calls) {
      if (!tool.test(c.name) || !c.result.items) continue;
      c.result.items = c.result.items.map(
        (i) =>
          new Proxy(i, {
            get(target, k, r) {
              if (typeof k === "string") read.add(k);
              return Reflect.get(target, k, r);
            },
          }),
      );
    }
  }
  const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest, hooksJsonPath: HOOKS_JSON, inventoryPath: INVENTORY_PATH });
  if (v.outcome !== "pass") throw new Error(`derivation: the passing ${t} bundle graded ${v.outcome} under the recording proxies`);
  return read;
}

const RAW_VALUE: Record<string, unknown> = {
  key: "DST-1",
  id: "STE-1",
  labels: ["a-label"],
  status: { name: "A Status", type: "a-type" },
  project: { key: "PRJ", name: "A Project" },
  parent: { key: "DST-2" },
  issuetype: { name: "Task" },
  projectMilestone: { id: "m-1" },
};

/**
 * A raw tracker answer object that holds EVERY field it is asked for (so the
 * projection's reads are not limited to a hand-written field list), records
 * each one asked for in `seen`, and answers as absent for each in `drop`.
 */
function rawAnswer(t: Tracker, drop: ReadonlySet<string>, seen: Set<string>, nested = false): Record<string, unknown> {
  const value = (k: string): unknown => {
    if (t === "jira" && !nested && k === "fields") return rawAnswer(t, drop, seen, true);
    seen.add(k);
    return drop.has(k) ? undefined : (RAW_VALUE[k] ?? `v-${k}`);
  };
  return new Proxy({} as Record<string, unknown>, {
    get: (_x, k) => (typeof k === "string" ? value(k) : undefined),
    has: (_x, k) => typeof k === "string" && value(k) !== undefined,
    getOwnPropertyDescriptor: (_x, k) => {
      if (typeof k !== "string") return undefined;
      const v = value(k);
      return v === undefined ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
    },
  });
}

/** For each answer field the projection asks for: the TrackerItem fields that change when it is absent. */
function projectionSources(g: unknown, t: Tracker, kind: AuditKind = "issue"): Map<string, Set<string>> {
  const project = extras(g).projectItem;
  const tool = PROJECTION_TOOL[kind][t]!;
  const seen = new Set<string>();
  const full = project(t, tool, rawAnswer(t, new Set(), seen)) as unknown as Record<string, unknown>;
  const byItemField = new Map<string, Set<string>>();
  for (const raw of seen) {
    const without = project(t, tool, rawAnswer(t, new Set([raw]), new Set())) as unknown as Record<string, unknown>;
    for (const f of Object.keys(full)) {
      if (f === "absent" || JSON.stringify(full[f]) === JSON.stringify(without[f])) continue;
      byItemField.set(f, new Set([...(byItemField.get(f) ?? []), raw]));
    }
  }
  return byItemField;
}

interface FieldContract {
  /** Answer fields some predicate needs (the sources of every item field read). */
  required: string[];
  /** `<item field> ← <answer field>` pairs whose answer field the audit never asks for. */
  uncovered: string[];
}

/** The answer fields the audit's reads of `kind` hold: those it requests, and those always returned. */
function askedFields(g: GraderModule, t: Tracker, kind: AuditKind): Set<string> {
  const req = extras(g).AUDIT_REQUEST_FIELDS[t];
  const always = extras(g).AUDIT_ALWAYS_RETURNED[t];
  // A milestone read (list_milestones / get_milestone) takes no field list: it holds exactly the fields always returned.
  return kind === "issue" ? new Set([...req.issue, ...always.issue]) : new Set(req.milestone === null ? [] : (always.milestone ?? []));
}

function fieldContract(g: GraderModule, t: Tracker, kind: AuditKind = "issue"): FieldContract {
  const read = fieldsReadOnAuditItems(g, t, kind);
  const sources = projectionSources(g, t, kind);
  const asked = askedFields(g, t, kind);
  const required = new Set<string>();
  const uncovered: string[] = [];
  for (const f of read) {
    for (const raw of sources.get(f) ?? []) {
      required.add(raw);
      if (!asked.has(raw)) uncovered.push(`${f} ← ${raw}`);
    }
  }
  return { required: [...required].sort(), uncovered: uncovered.sort() };
}

/** The required answer fields per audited (tracker, kind), derived once (empty when the grader cannot load: the CONTROL test then fails). */
const REQUIRED_BY: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [t, k] of AUDITED) {
    try {
      out[`${t}:${k}`] = fieldContract(grader(), t, k).required;
    } catch {
      out[`${t}:${k}`] = [];
    }
  }
  return out;
})();

/** The measured key set of a pinned live answer's rows (tests/fixtures/live-shapes/<tracker>/<file>). */
function pinnedKeys(tracker: Tracker, file: string, rows?: string): string[] {
  const a = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "live-shapes", tracker, file), "utf-8")).answer;
  return Object.keys(rows ? a[rows][0] : a).sort();
}

describe("ITEM 7 — AUDIT_REQUEST_FIELDS covers every answer field a predicate reads (derived from the projection and the predicates, never listed by hand)", () => {
  test("the contract is exported exactly as the skill's audit fence passes it: issue fields per tracker, and Linear's milestone reads", () => {
    expect(extras().AUDIT_REQUEST_FIELDS).toEqual({
      jira: { issue: ["summary", "labels", "status", "parent", "issuetype", "project"], milestone: null },
      linear: { issue: ["id", "title", "labels", "status", "project", "projectMilestone"], milestone: { list: "list_milestones", get: "get_milestone" } },
    });
  });
  test("the fixtures' audit inputs request exactly the contract's issue fields", () => {
    for (const t of TRACKERS) expect({ t, fields: [...AUDIT_FIELDS[t]] }).toEqual({ t, fields: [...extras().AUDIT_REQUEST_FIELDS[t].issue] });
  });
  test("Linear's milestone fields always returned are measured: every one is a key of the pinned list_milestones row AND of the pinned get_milestone answer", () => {
    const always = extras().AUDIT_ALWAYS_RETURNED.linear.milestone ?? [];
    expect(always.length).toBeGreaterThan(0);
    for (const [file, rows] of [["list_milestones.json", "milestones"], ["get_milestone.json", undefined]] as const) {
      const keys = pinnedKeys("linear", file, rows);
      expect({ file, missing: always.filter((f) => !keys.includes(f)) }).toEqual({ file, missing: [] });
    }
    expect(extras().AUDIT_ALWAYS_RETURNED.jira.milestone, "Jira reads its Epic milestones as issues").toBeNull();
  });
  for (const [t, k] of AUDITED) {
    test(`${t} ${k}: CONTROL — the derivation measures real reads: the predicates read ${k === "issue" ? "summary, labels and container" : "summary and key"}, which come from answer fields`, () => {
      const read = fieldsReadOnAuditItems(grader(), t, k);
      for (const f of k === "issue" ? ["summary", "labels", "container"] : ["summary", "key"]) expect({ f, read: read.has(f) }).toEqual({ f, read: true });
      expect(REQUIRED_BY[`${t}:${k}`]!.length).toBeGreaterThan(k === "issue" ? 2 : 1);
    });
    test(`${t} ${k}: every answer field a predicate reads is one the audit asks for (or one always returned)`, () => {
      expect(fieldContract(grader(), t, k).uncovered).toEqual([]);
    });
    test(`${t} ${k}: every such field is fail-closed — an answer lacking it is recorded absent, so the audit aborts on it`, () => {
      const tool = PROJECTION_TOOL[k][t]!;
      const missed = REQUIRED_BY[`${t}:${k}`]!.filter((raw) => !(extras().projectItem(t, tool, rawAnswer(t, new Set([raw]), new Set())).absent ?? []).includes(raw));
      expect(missed).toEqual([]);
    });
  }
  test("MUTATION — a grader copy whose Linear predicates read one more answer field (issueType from `type`) fails, naming it", async () => {
    await withTmpAsync("ste617-fields-mut-", async (d) => {
      const mutant = await graderCopy(d, "reads-type", once('      issueType: null,\n      kind: "issue",', '      issueType: strOrNull(o.type),\n      kind: "issue",'));
      expect(fieldContract(mutant.g, "linear").uncovered).toEqual(["issueType ← type"]);
      expect(fieldContract(grader(), "linear").uncovered, "PERMIT TWIN — the shipped grader").toEqual([]);
    });
  });
  test("MUTATION — a grader copy whose AUDIT_REQUEST_FIELDS omits labels fails, naming labels", async () => {
    await withTmpAsync("ste617-fields-mut2-", async (d) => {
      const mutant = await graderCopy(d, "no-labels", once('jira: { issue: ["summary", "labels", "status",', 'jira: { issue: ["summary", "status",'));
      expect(fieldContract(mutant.g, "jira").uncovered).toEqual(["labels ← labels"]);
    });
  });
  test("MUTATION — a grader copy whose Linear milestones are always returned WITHOUT `name` fails the milestone contract, naming summary ← name", async () => {
    await withTmpAsync("ste617-fields-mut3-", async (d) => {
      const mutant = await graderCopy(d, "ms-no-name", once('milestone: ["id", "name", "description", "progress", "sortOrder"]', 'milestone: ["id", "description", "progress", "sortOrder"]'));
      expect(fieldContract(mutant.g, "linear", "milestone").uncovered).toEqual(["summary ← name"]);
      expect(fieldContract(grader(), "linear", "milestone").uncovered, "PERMIT TWIN — the shipped grader").toEqual([]);
    });
  });
});

/** Remove `field` from every issue of the first audit's nonce-search answers in a materialized transcript. */
function stripAuditField(m: Materialized, b: LiveBundle, field: string): number {
  const t = b.run.tracker;
  const file = m.transcripts[audits(b)[0]!.sessionId]!;
  let n = 0;
  const lines = readFileSync(file, "utf-8").split("\n").filter((l) => l.trim() !== "");
  const out = lines.map((l) => {
    const r = JSON.parse(l);
    if (r.type !== "user" || !Array.isArray(r.message?.content)) return l;
    for (const blk of r.message.content) {
      if (blk.type !== "tool_result" || !Array.isArray(blk.content)) continue;
      const text = blk.content[0]?.text;
      let v: { issues?: Array<Record<string, unknown>> };
      try {
        v = JSON.parse(text);
      } catch {
        continue;
      }
      if (!Array.isArray(v.issues)) continue;
      for (const i of v.issues) {
        const holder = t === "jira" && field !== "key" ? (i.fields as Record<string, unknown>) : i;
        if (field in holder) {
          delete holder[field];
          n++;
        }
      }
      blk.content[0].text = JSON.stringify(v);
    }
    return JSON.stringify(r);
  });
  writeFileSync(file, out.join("\n") + "\n");
  return n;
}

describe("HIGH 2 — an audit item missing a field a predicate needs is audit-incomplete, never skipped or read as empty", () => {
  for (const t of TRACKERS) {
    test(`${t}: CONTROL — the omission loop below is over the derived required fields and is not empty`, () => {
      expect((REQUIRED_BY[`${t}:issue`] ?? [])).toEqual(expect.arrayContaining(t === "jira" ? ["labels", "project", "summary"] : ["labels", "project", "title"]));
    });
    for (const field of (REQUIRED_BY[`${t}:issue`] ?? [])) {
      test(`${t}: an audit answer OMITTING ${field} aborts audit-incomplete naming the item and ${field}; PERMIT TWIN — the same answer carrying it passes`, () => {
        withTmp("ste617-omit-", (d) => {
          const b = buildPassingBundle(t);
          const m = materialize(b, d);
          const twin = gradeExtracted(extractFor(m));
          expect({ outcome: twin.outcome, findings: twin.findings }, "PERMIT TWIN").toEqual({ outcome: "pass", findings: [] });
          expect(stripAuditField(m, b, field), `control: the audit answers carried ${field}`).toBeGreaterThan(0);
          const r = gradeExtracted(extractFor(m));
          expect(r.outcome).toBe("abort");
          const named = r.findings.filter((f) => f.code === "audit-incomplete" && typeof f.item === "string" && new RegExp(`without its ${field} field`).test(f.detail ?? ""));
          expect(named.length, JSON.stringify(r.findings.slice(0, 3))).toBeGreaterThan(0);
        });
      });
    }
  }

  test("jira: teardown never skips a second-audit item read WITHOUT its project: it is teardown-incomplete (and audit-incomplete); PERMIT TWIN — read with its project and Done", () => {
    const b = buildPassingBundle("jira");
    const key = createdKeys(session(b, "S1"))[0]!;
    for (const c of audits(b)[1]!.calls) for (const i of c.result.items ?? []) if (i.key === key) Object.assign(i, { container: "", status: "To Do", absent: ["project"] });
    const v = grade(b);
    expect(findingsOf(v, "teardown-incomplete").some((f) => f.item === key)).toBe(true);
    expect(findingsOf(v, "audit-incomplete").some((f) => f.item === key && /project/.test(f.detail ?? ""))).toBe(true);
    const twin = buildPassingBundle("jira");
    expect(codes(grade(twin))).not.toContain("teardown-incomplete");
  });
  test("jira: S8's duplicate-title check counts an audit item read WITHOUT its project as in the shared space: S8 fails; PERMIT TWIN — the same item proven in another space passes S8", () => {
    const mk = (container: string, absent?: string[]) => {
      const b = buildPassingBundle("jira");
      const legacy = createdKeys(session(b, "S8"))[0]!;
      const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
      addToAudit(b, { ...orig, key: "DST-191", container, ...(absent ? { absent } : {}) });
      return b;
    };
    expect(failing(grade(mk("", ["project"])))).toContain("S8");
    expect(failing(grade(mk("OTHER")))).not.toContain("S8");
  });
  test("S1: an FR item read WITHOUT its labels is not counted as untagged: S1 is not-observed naming the labels, the run aborts audit-incomplete; PERMIT TWIN — labelled, S1 passes", () => {
    const b = buildPassingBundle("jira");
    const k = createdKeys(sessionsOf(b, "S1").find((s) => s.root === "B")!)[0]!;
    editAuditItem(b, k, (i) => Object.assign(i, { labels: [], absent: ["labels"] }));
    const v = grade(b);
    expect(v.scenarios.S1?.outcome).toBe("not-observed");
    expect(v.scenarios.S1?.reason ?? "").toMatch(/labels/);
    expect(v.outcome).toBe("abort");
    expect(grade(buildPassingBundle("jira")).scenarios.S1?.outcome).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// HIGH 3 — Linear teardown reads get_project answers
// ---------------------------------------------------------------------------

describe("HIGH 3 — Linear teardown: a get_project answer is a project item, read as completed by its status type", () => {
  test("ROUND TRIP — a passing Linear run whose second audit carries two get_project answers extracts both as completed project items and passes", () => {
    withTmp("ste617-proj-rt-", (d) => {
      const b = buildPassingBundle("linear");
      const m = materialize(b, d);
      const bundle = extractedBundle(extractFor(m));
      const projects = audits(bundle)[1]!.calls.filter((c) => /__get_project$/.test(c.name)).flatMap((c) => c.result.items ?? []);
      expect(projects.map((p) => ({ kind: p.kind, key: p.key, status: p.status }))).toEqual([
        { kind: "project", key: b.run.container, status: "completed" },
        { kind: "project", key: b.run.repointFrom!, status: "completed" },
      ]);
      expect(gradeExtracted({ ok: true, bundle }).outcome).toBe("pass");
    });
  });
  test("a completed project whose team RENAMED its completed state (name Shipped, type completed) is completed; PERMIT/REFUSE — type started is not", () => {
    const g = extras();
    const done = g.projectItem("linear", "mcp__linear__get_project", { id: "p1", name: "P", status: { id: "s", name: "Shipped", type: "completed" } });
    const open = g.projectItem("linear", "mcp__linear__get_project", { id: "p1", name: "P", status: { id: "s", name: "Completed", type: "started" } });
    expect({ done: done.status, open: open.status, kind: done.kind }).toEqual({ done: "completed", open: "started", kind: "project" });
    const b = buildPassingBundle("linear");
    for (const c of audits(b)[1]!.calls) for (const i of c.result.items ?? []) if (i.kind === "project" && i.key === b.run.container) i.status = open.status;
    expect(findingsOf(grade(b), "teardown-incomplete").some((f) => f.item === b.run.container)).toBe(true);
  });
  test("a project missing from the second audit still fails teardown-incomplete naming it; a project answer without its status is audit-incomplete", () => {
    const b = buildPassingBundle("linear");
    const a2 = audits(b)[1]!;
    a2.calls = a2.calls.filter((c) => !(c.result.items ?? []).some((i) => i.kind === "project" && i.key === b.run.repointFrom));
    expect(findingsOf(grade(b), "teardown-incomplete").some((f) => f.item === b.run.repointFrom)).toBe(true);
    const bare = extras().projectItem("linear", "mcp__linear__get_project", { id: "p1", name: "P" });
    expect(bare.absent).toEqual(["status"]);
  });
});

// ---------------------------------------------------------------------------
// HIGH 4 — recorded paths to the toolkit tree and the config dir are rewritten
// ---------------------------------------------------------------------------

describe("HIGH 4 — <toolkit> and <config> path tokens, anchored like the root rewrite", () => {
  const TOOLKIT = "/Users/alice/workspace/dev-process-toolkit";
  const CONFIG = "/Users/alice/.claude-st";
  function extractWithText(text: string): { bundle: LiveBundle | null; violations: PrivacyViolation[] } {
    return withTmp("ste617-tok-", (d) => {
      const b = buildPassingBundle("jira");
      const c = session(b, "S4").calls[0]!;
      c.result.text = `${c.result.text}\n${text}`;
      const m = materialize(b, d);
      const x = (grader().extractBundle as unknown as (o: Record<string, unknown>) => Extracted)({
        configDirs: [m.configDir, CONFIG],
        toolkitRoot: TOOLKIT,
        ledgerSessionIds: m.ledger,
        roots: { A: { path: m.roots.A, tag: TAG_A }, B: { path: m.roots.B, tag: TAG_B } },
        run: m.run,
        synthetic: true,
      });
      const bundle = extractedBundle(x);
      return { bundle, violations: grader().privacyViolations(bundle) };
    });
  }
  test("PERMIT — a recorded path under the toolkit root and one under a config dir are rewritten, and the bundle is clean", () => {
    const r = extractWithText(`read ${TOOLKIT}/plugins/dev-process-toolkit/adapters/_shared/src/x.ts\nlog ${CONFIG}/projects/p/s.jsonl`);
    expect(r.violations).toEqual([]);
    const text = JSON.stringify(r.bundle);
    expect(text).toContain("<toolkit>/plugins/dev-process-toolkit/adapters/_shared/src/x.ts");
    expect(text).toContain("<config>/projects/p/s.jsonl");
  });
  // These two asserted a REFUSAL until the first live run showed that ordinary
  // child records carry such paths, so refusing them threw every bundle away.
  // The path is now redacted to <home> — it still never becomes a known root's
  // token, which is what these rows exist to protect.
  test("a path under /Users/<name> outside every known root becomes <home>, and trips no refusal", () => {
    const r = extractWithText(`read /Users/alice/Documents/secret.txt`);
    expect(r.violations).toEqual([]);
    const text = JSON.stringify(r.bundle);
    expect(text).toContain("<home>/Documents/secret.txt");
    expect(text).not.toContain("/Users/alice");
  });
  test("a sibling path only SHARING the toolkit root's prefix never takes the toolkit token; it is redacted instead", () => {
    const r = extractWithText(`read ${TOOLKIT}-scratch/notes.txt`);
    const text = JSON.stringify(r.bundle);
    expect(text).not.toContain("<toolkit>-scratch");
    expect(text).toContain("<home>");
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MEDIUM 5 — S17's read-only git runs
// ---------------------------------------------------------------------------

describe("MEDIUM 5 — S17: read-only git runs into B are not commit-writing runs; writing ones still are", () => {
  /** The passing bundle with one successful, unrefused git run into B recorded BEFORE B's evidence. */
  function withRunBefore(command: string): LiveBundle {
    const b = buildPassingBundle("jira");
    const s = session(b, "S17");
    const first = s.calls[0]!;
    s.calls.unshift({
      ref: `${s.sessionId}:toolu_900`,
      at: new Date(Date.parse(first.at) - 1000).toISOString(),
      name: "Bash",
      input: { command, description: "run" },
      result: { isError: false, text: "", exitCode: 0, items: null, lastPage: null },
      sidechain: false,
    });
    return b;
  }
  const READS = [
    "git -C <B> ls-files",
    "git -C <B> worktree list",
    "git -C <B> show-ref",
    "git -C <B> merge-base HEAD feature-s17",
    "git -C <B> cat-file -t HEAD",
    "git -C <B> rev-parse HEAD",
    "git -C <B> log -1 --format=%s",
    "git -C <B> status --porcelain",
    "git -C <B> diff --stat",
    "git -C <B> branch --list",
    "git -C <B> config --get alias.ci",
  ];
  const WRITES = [
    "git -C <B> cherry-pick 1a2b3c4",
    "git -C <B> revert --no-edit HEAD",
    "git -C <B> reset --hard HEAD~1",
    "git -C <B> checkout -b s17-other",
    "git -C <B> branch -D feature-s17",
    "git -C <B> branch s17-new",
    "git -C <B> tag v9",
    "git -C <B> config alias.co commit",
    "git -C <B> update-ref refs/heads/x HEAD",
    "git -C <B> worktree add ../wt",
    "git -C <B> status; git -C <B> commit --allow-empty -m x",
  ];
  for (const cmd of READS) {
    test(`PERMIT — \`${cmd}\` before B's evidence, unrefused, leaves S17 passing`, () => {
      expect(failing(grade(withRunBefore(cmd)))).not.toContain("S17");
    });
  }
  for (const cmd of WRITES) {
    test(`REFUSE — \`${cmd}\` before B's evidence, unrefused, fails S17`, () => {
      expect(failing(grade(withRunBefore(cmd)))).toContain("S17");
    });
  }
});

// ---------------------------------------------------------------------------
// ITEM 6 — the grade and the live-proof gate agree on unkeyed and non-issue items
// ---------------------------------------------------------------------------

describe("ITEM 6 — a read of a team, a user or a site projects to no item, so it cannot pass the grade and fail the gate", () => {
  const READS: Record<Tracker, { name: string; answer: Record<string, unknown> }> = {
    jira: { name: "mcp__atlassian__atlassianUserInfo", answer: { account_id: "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077", email: "ops@acme-sandbox.io", name: "Ops" } },
    linear: { name: "mcp__linear__get_team", answer: { id: "e1181251-2fe2-42b2-9a69-288a28732554", name: "Sandbox", key: "STE" } },
  };
  for (const t of TRACKERS) {
    test(`${t}: ROUND TRIP — ${READS[t].name} in a scenario session extracts to no item; the run passes and no key sits outside the run's spaces`, () => {
      withTmp("ste617-nonitem-", (d) => {
        const b = buildPassingBundle(t);
        const s = session(b, "S4");
        const first = s.calls[0]!;
        s.calls.unshift({ ref: `${s.sessionId}:toolu_901`, at: new Date(Date.parse(first.at) - 1000).toISOString(), name: READS[t].name, input: {}, result: { isError: false, text: JSON.stringify(READS[t].answer), exitCode: null, items: null, lastPage: null }, sidechain: false });
        const bundle = extractedBundle(extractFor(materialize(b, d)));
        const call = session(bundle, "S4").calls.find((c) => c.name === READS[t].name)!;
        expect(call.result.items).toEqual([]);
        expect(grader().privacyViolations(bundle)).toEqual([]);
        expect(extras().keysOutsideSpaces(bundle, t === "jira" ? ["DST", "DST2"] : ["STE"])).toEqual([]);
        expect(grade(bundle).outcome).toBe("pass");
      });
    });
  }
  test("linear: an issue item with no readable key fails the grade as item-outside-spaces (the gate calls it not-live); PERMIT TWIN — projects and milestones read by name are never space-keyed", () => {
    const b = buildPassingBundle("linear");
    expect(b.sessions.flatMap((s) => s.calls).flatMap((c) => c.result.items ?? []).some((i) => i.kind === "project"), "control: the bundle holds project items").toBe(true);
    expect(b.sessions.flatMap((s) => s.calls).flatMap((c) => c.result.items ?? []).some((i) => i.kind === "milestone"), "control: the bundle holds milestone items").toBe(true);
    expect(extras().keysOutsideSpaces(b, ["STE"])).toEqual([]);
    expect(codes(grade(b))).not.toContain("item-outside-spaces");
    const s = session(b, "S4");
    s.calls[0]!.result.items = [{ key: "", summary: "", labels: [], status: "", parent: null, milestone: null, issueType: null, kind: "issue", container: "" }];
    expect(extras().keysOutsideSpaces(b, ["STE"])).toEqual(["(no key)"]);
    expect(findingsOf(grade(b), "item-outside-spaces").map((f) => f.item)).toEqual(["(no key)"]);
  });
  test("jira: an item key outside the run's spaces fails item-outside-spaces; PERMIT TWIN — the repoint-from space is the run's", () => {
    const b = buildPassingBundle("jira");
    expect(codes(grade(b)), "the passing bundle holds DST2 items and passes").not.toContain("item-outside-spaces");
    session(b, "S4").calls[0]!.result.items = [{ key: "OPS-7", summary: "x", labels: [], status: "To Do", parent: null, milestone: null, issueType: "Task", kind: "issue", container: "OPS" }];
    expect(findingsOf(grade(b), "item-outside-spaces").map((f) => f.item)).toEqual(["OPS-7"]);
  });
});

describe("no skipped, todo or conditional test forms in this suite", () => {
  test("the suite's own source carries none", () => {
    const src = readFileSync(import.meta.path, "utf-8");
    const forms = ["test" + ".skip(", "test" + ".todo(", "test" + ".if(", "describe" + ".skip(", "it" + ".skip("];
    for (const f of forms) expect(src.includes(f), f).toBe(false);
  });
});

// M_2306b6 / STE-616 — display names are personal data too.
//
// Jira answers carry `displayName` under creator / reporter / assignee, and the
// toolkit's own modules echo it: `container_ownership.ts list` prints an Owner
// column, the reconciliation probe writes `(class unowned, owner <name>)`, and a
// child's own `jq` projection re-keys it. Measured on the five committed bundles
// and leg 8's: one person's name, 3 to 293 times per bundle, a minority of them
// under the `displayName` key itself. So the rule is STRUCTURAL at the source
// and HARVESTED downstream: every value the run's own transcripts carried under
// a `displayName` key is redacted wherever it is echoed — never a regex for a
// particular name.
describe("STE-616 — display names are redacted wherever a run echoes them", () => {
  const NAME = "Ada Q. Tester";

  function inject(m: Materialized, rows: Array<{ id: string; tool: string; input: Record<string, unknown>; out: string }>): void {
    const sid = m.ledger[0]!;
    const file = join(m.configDir, "projects", slugOf(m.roots.B), `${sid}.jsonl`);
    const at = "2026-09-23T09:00:00.000Z";
    const recs = rows.flatMap((r) => [
      { type: "assistant", sessionId: sid, timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: r.id, name: r.tool, input: r.input }] } },
      { type: "user", sessionId: sid, timestamp: at, message: { role: "user", content: [{ tool_use_id: r.id, type: "tool_result", content: r.out }] } },
    ]);
    appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }

  const answer = JSON.stringify({ issues: [{ key: "DST-900", fields: { summary: "x", labels: [], creator: { accountId: "<account-id>", displayName: NAME }, reporter: { displayName: NAME } } }], isLast: true });
  const listing = `| Key | Class | Owner | Toolkit-written | Title |\n|---|---|---|---|---|\n| DST-900 | unowned | ${NAME} | no | x |`;

  test("the name is gone from the bundle — under the key, in the Owner column, and in prose — and the bundle passes the refusal", () => {
    withTmp("ste616-names-", (d) => {
      const m = materialize(buildPassingBundle("jira"), d);
      inject(m, [
        { id: "toolu_dn1", tool: "mcp__atlassian__searchJiraIssuesUsingJql", input: { jql: "project = DST" }, out: answer },
        { id: "toolu_dn2", tool: "Bash", input: { command: "bun x.ts list", description: "x" }, out: listing },
        { id: "toolu_dn3", tool: "Bash", input: { command: "bun y.ts", description: "x" }, out: `warning tracker-orphan DST-900 (class unowned, owner ${NAME})` },
      ]);
      const b = extractedBundle(extractFor(m));
      const blob = JSON.stringify(b);
      expect(blob, "the injected rows reached the bundle").toContain("DST-900");
      expect(blob).not.toContain(NAME);
      expect(blob).toContain("<display-name>");
      expect(grader().privacyViolations(b)).toEqual([]);
    });
  });

  test("CONTROL — a name the tracker never returned as a displayName is not rewritten (the rule is harvested, not a word list)", () => {
    withTmp("ste616-names-ctl-", (d) => {
      const m = materialize(buildPassingBundle("jira"), d);
      inject(m, [{ id: "toolu_dn4", tool: "Bash", input: { command: "echo x", description: "x" }, out: `a note mentioning ${NAME}` }]);
      const blob = JSON.stringify(extractedBundle(extractFor(m)));
      expect(blob).toContain(NAME);
      expect(blob).not.toContain("<display-name>");
    });
  });

  test("the key-structural rule redacts a displayName value in plain and escaped JSON", () => {
    const g = grader() as unknown as { redactPersonalData: (s: string) => string };
    for (const s of [`{"displayName":"${NAME}"}`, `{"displayName": "${NAME}"}`, JSON.stringify({ t: `{"displayName":"${NAME}"}` })]) {
      const out = g.redactPersonalData(s);
      expect(out, s).not.toContain(NAME);
      expect(out, s).toContain("<display-name>");
    }
  });

  test("the refusal flags an unredacted displayName value, and does not flag the token", () => {
    const g = grader();
    expect(g.privacyViolations({ t: `{"displayName":"${NAME}"}` }).map((v) => v.pattern)).toContain("displayName value");
    expect(g.privacyViolations({ t: JSON.stringify({ t: `{"displayName":"${NAME}"}` }) }).map((v) => v.pattern)).toContain("displayName value");
    expect(g.privacyViolations({ t: `{"displayName":"<display-name>"}` })).toEqual([]);
  });

  test("S4 stays gradeable with the Owner column redacted: its predicate reads Key and Class only", () => {
    const b = buildPassingBundle("jira");
    let rewritten = 0;
    for (const s of b.sessions) for (const c of s.calls) {
      if (typeof c.result.text === "string" && c.result.text.includes("| Key | Class | Owner |")) {
        c.result.text = c.result.text.replace(/^(\|[^|]+\|[^|]+\|)\s*unknown\s*\|/gm, "$1 <display-name> |");
        rewritten++;
      }
    }
    expect(rewritten, "the fixture carries listings to rewrite").toBeGreaterThan(0);
    expect(grade(b).scenarios.S4?.outcome).toBe("pass");
  });
});

// M_2306b6 / STE-616 — Linear's people are harvested too.
//
// The Linear MCP flattens a user to a STRING under `createdBy` / `assignee`
// (measured: tests/fixtures/live-shapes/linear/{get_issue,list_issues,save_issue}),
// and a project `lead` is an object — never under Jira's `displayName` key. A
// Linear leg's bundle would have carried the operator's name past a refusal that
// only reads `displayName`. Two-sided: a string that was never a user field is
// left alone, and the literal `me` a save_issue input may carry is never
// harvested, or every "me" in the bundle would be rewritten.
describe("STE-616 — Linear user fields are redacted wherever a run echoes them", () => {
  const NAME = "Grace B. Hopper";

  function injectLinear(m: Materialized, rows: Array<{ id: string; tool: string; input: Record<string, unknown>; out: string }>): void {
    const sid = m.ledger[0]!;
    const file = join(m.configDir, "projects", slugOf(m.roots.B), `${sid}.jsonl`);
    const at = "2026-09-23T09:00:00.000Z";
    const recs = rows.flatMap((r) => [
      { type: "assistant", sessionId: sid, timestamp: at, message: { role: "assistant", content: [{ type: "tool_use", id: r.id, name: r.tool, input: r.input }] } },
      { type: "user", sessionId: sid, timestamp: at, message: { role: "user", content: [{ tool_use_id: r.id, type: "tool_result", content: r.out }] } },
    ]);
    appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }

  test("createdBy / assignee strings and a lead object are gone from the bundle, echoes included, and the bundle passes the refusal", () => {
    withTmp("ste616-linear-", (d) => {
      const m = materialize(buildPassingBundle("linear"), d);
      injectLinear(m, [
        { id: "toolu_ln1", tool: "mcp__linear__list_issues", input: { project: "p" }, out: JSON.stringify({ issues: [{ id: "STE-900", title: "x", labels: [], createdBy: NAME, createdById: "2d5a2118-0000-4000-8000-00000000000f", assignee: NAME }], hasNextPage: false }) },
        { id: "toolu_ln2", tool: "mcp__linear__get_project", input: { query: "p" }, out: JSON.stringify({ id: "p", name: "Shared", lead: { name: NAME, email: "grace@acme-sandbox.io" } }) },
        { id: "toolu_ln3", tool: "Bash", input: { command: "bun x.ts list", description: "x" }, out: `| Key | Class | Owner | Toolkit-written | Title |\n|---|---|---|---|---|\n| STE-900 | unowned | ${NAME} | no | x |` },
      ]);
      const b = extractedBundle(extractFor(m));
      const blob = JSON.stringify(b);
      expect(blob, "the injected rows reached the bundle").toContain("STE-900");
      expect(blob).not.toContain(NAME);
      expect(blob, "the lead's email is caught by the email class").not.toContain("grace@acme-sandbox.io");
      expect(blob).toContain("<display-name>");
      expect(grader().privacyViolations(b)).toEqual([]);
    });
  });

  test("CONTROL — `me`, a placeholder and a title are never harvested, and a short name never rewrites a longer word", () => {
    const g = grader() as unknown as { harvestDisplayNames: (s: string) => string[]; redactDisplayNames: (s: string, n: readonly string[]) => string };
    const text = JSON.stringify({ assignee: "me", createdBy: "<person>", title: "Grace notes", lead: { name: "Ann" } });
    expect(g.harvestDisplayNames(text).sort()).toEqual(["Ann"]);
    expect(g.redactDisplayNames("Annual report by Ann, Ann's draft", ["Ann"])).toBe("Annual report by <display-name>, <display-name>'s draft");
    expect(g.redactDisplayNames("some message for me", g.harvestDisplayNames(JSON.stringify({ assignee: "me" })))).toBe("some message for me");
  });

  test("the key-structural rule and the refusal cover Linear's user strings; `me` and the token pass", () => {
    const g = grader() as unknown as { redactPersonalData: (s: string) => string; privacyViolations: (b: unknown) => Array<{ pattern: string }> };
    for (const k of ["createdBy", "assignee"]) {
      const s = `{"${k}":"${NAME}"}`;
      expect(g.redactPersonalData(s), s).not.toContain(NAME);
      expect(g.privacyViolations({ t: s }).map((v) => v.pattern), s).toContain("user name value");
      expect(g.privacyViolations({ t: JSON.stringify({ t: s }) }).map((v) => v.pattern), `${s} escaped`).toContain("user name value");
    }
    expect(g.privacyViolations({ t: `{"assignee":"me","createdBy":"<display-name>"}` })).toEqual([]);
  });
});

// M_2306b6 / STE-616 — the in-place arm resolves its target PER SEGMENT.
//
// Leg 8's one `sibling-file-write` finding was a `sed -i '' … /tmp/dst-106.json`
// that wrote /tmp: `<B>` appeared only as an argument to a LATER command on
// another line of the same Bash call, and the arm matched "an in-place editor"
// and "names the sibling" against the whole command. Chaining made the guard
// attribute one command's target to another's.
describe("STE-616 — an in-place edit is attributed to its own segment's target", () => {
  const addBash = (b: LiveBundle, make: (t: { own: string; other: string }) => string) => {
    const s = session(b, "S1");
    const t = { own: `<${s.root}>`, other: s.root === "A" ? "<B>" : "<A>" };
    const last = s.calls.at(-1)!;
    s.calls.push({ ref: `${s.sessionId}:toolu_seg${s.calls.length}`, at: new Date(Date.parse(last.at) + 1000).toISOString(), name: "Bash", input: { command: make(t), description: "x" }, result: { isError: false, text: "", exitCode: 0, items: null, lastPage: null }, sidechain: false });
    return s;
  };
  const flagged = (b: LiveBundle, sid: string) => findingsOf(grade(b), "sibling-file-write").some((f) => f.session === sid);

  test("PERMIT — the leg-8 shape: sed -i on a /tmp file, the sibling named only by a later line", () => {
    for (const make of [
      (t: { other: string }) => `sed -i '' 's/"reporter"/"creator"/' /tmp/dst-106.json\ncat ${t.other}/CLAUDE.md`,
      (t: { other: string }) => `sed -i '' 's/a/b/' /tmp/x.json; git -C ${t.other} status`,
      (t: { other: string }) => `perl -0pi -e 's/x/y/' /tmp/x.json && ls ${t.other}`,
    ]) {
      const b = buildPassingBundle("jira");
      const s = addBash(b, make);
      expect(flagged(b, s.sessionId), make({ other: "<X>" })).toBe(false);
    }
  });
  test("HARM — the same editors aimed INTO the sibling are still flagged, chained or not", () => {
    for (const make of [
      (t: { other: string }) => `sed -i '' 's/a/b/' ${t.other}/CLAUDE.md`,
      (t: { other: string }) => `cat /tmp/x\nsed -i '' 's/a/b/' ${t.other}/CLAUDE.md`,
      (t: { other: string }) => `ls /tmp; perl -0pi -e 's/x/y/' ${t.other}/.mcp.json`,
    ]) {
      const b = buildPassingBundle("jira");
      const s = addBash(b, make);
      expect(flagged(b, s.sessionId), make({ other: "<X>" })).toBe(true);
    }
  });
  test("HARM — an INDIRECT target still counts the sibling named elsewhere in the command (the founding loop)", () => {
    const b = buildPassingBundle("jira");
    const s = addBash(b, (t) => `for R in ${t.own} ${t.other}; do perl -0pi -e 's/x/y/' "$R/CLAUDE.md"; done`);
    expect(flagged(b, s.sessionId)).toBe(true);
  });
});

// ===========================================================================
// STE-643 (M_101065) AC-STE-643.8 — the live grader mirrors the hook: a
// labels-only write, or a milestone-container create, that relied on a
// decision printed `default=forbidden` is `ungated-write` unless an
// AskUserQuestion asked after that decision's announcement, naming its key or
// title, was answered EXACTLY "Join `<KEY>`" / "Create `<title>`". Each fixture
// pair differs only in that answer. RED at abfe236d: the grader accepts any
// join (or create) decision whatever its default.
// ===========================================================================

/** A harness-recorded AskUserQuestion answer, in the shape the bundle records one. */
function consentAsk(question: string, labels: string[], answer: string): { input: Record<string, unknown>; result: ToolCall["result"] } {
  return {
    input: { questions: [{ question, header: "Milestone", multiSelect: false, options: labels.map((label) => ({ label })) }] },
    result: { isError: false, text: `User has answered your questions: "${question}"="${answer}". You can now continue with the user's answers in mind.`, exitCode: null, items: null, lastPage: null },
  };
}

/**
 * STE-650 — the labels a joined Epic was listed with, and the read-merge a
 * labels write must send: every listed label plus the milestone label of the
 * join's milestone id (the hook's gateJoinedLabels rule, AC-STE-608.10 (d)).
 * Every join fixture below records both on its decision, as the real
 * `resolve_milestone_identity.ts` does, and writes the read-merge unless a
 * leg says otherwise — a fixture that lacks them is one the hook refuses.
 */
const JOIN_LISTED_LABELS = ["team-x"];
const joinMilestoneId = (epic: string): string => milestoneIdFromEpicKey(epic);
const readMerge = (listed: readonly string[], milestone: string): string[] => [...listed, milestone];

interface LabelsJoinOptions {
  /** Makes S13's repository own the Epic by one route, before the join is announced. */
  arrange?: (b: LiveBundle, s: BundleSession, epic: string) => void;
  /** The labels value the write sends, from the listed labels and the milestone label (default: the read-merge). */
  write?: (listed: readonly string[], milestone: string) => string[];
  /** Replaces the single-question consent ask (STE-650 AC.8's multi-question legs). */
  ask?: (epic: string, spanTitle: string, labels: string[]) => { input: Record<string, unknown>; result: ToolCall["result"] };
}

/** A Jira labels-only write in `inSession` on S3's Epic, relying on a join decision of it announced there. */
function labelsJoinFixture(via: "title" | "key", answer: string | null, inSession = "S13", o: LabelsJoinOptions = {}) {
  const b = buildPassingBundle("jira");
  const s = session(b, inSession);
  const epic = createdKeys(session(b, "S3"))[0]!;
  const labels = [`Join \`${epic}\``, `Skip \`${epic}\``];
  const forbidden = via === "title";
  const spanTitle = title("S3 span milestone");
  o.arrange?.(b, s, epic);
  appendAnnounced(
    b,
    s,
    "milestone-decision",
    moduleCommand("resolve_milestone_identity.ts", null, via === "title" ? `<B> jira DST <B>/.dpt/tmp/listing.json --title "${spanTitle}" --sibling <A>` : `<B> jira DST <B>/.dpt/tmp/listing.json --join-key ${epic} --sibling <A>`),
    {
      subject: via === "title" ? spanTitle : epic,
      decision: "join",
      evidence: {
        act: "join",
        via,
        key: epic,
        milestoneId: joinMilestoneId(epic),
        ...(via === "title" ? { title: spanTitle } : { joinKey: epic }),
        name: spanTitle,
        labels: JOIN_LISTED_LABELS,
        shared: true,
        default: forbidden ? "forbidden" : "allowed",
        ...(forbidden ? { options: labels } : {}),
      },
    },
    `join_${via}`,
  );
  if (o.ask !== undefined) {
    const ask = o.ask(epic, spanTitle, labels);
    appendCall(s, "AskUserQuestion", ask.input, ask.result, "ask_643");
  } else if (answer !== null) {
    const ask = consentAsk(`Join the existing Epic ${epic} "${spanTitle}" as this repository's milestone?`, labels, answer);
    appendCall(s, "AskUserQuestion", ask.input, ask.result, "ask_643");
  }
  const w = appendTicketWrite(b, s, epic, "labels_643", "edit");
  w.input.fields = { labels: (o.write ?? readMerge)(JOIN_LISTED_LABELS, milestoneLabel(joinMilestoneId(epic))) };
  return { b, w, labels, epic, spanTitle };
}

/**
 * Two join decisions of S3's Epic in S13, in the given order, then the
 * labels-only write (the read-merge) — the grader mirrors the hook's rule that
 * the LATEST join for the key governs (hook suite "(d) … (twin)" and HIR P4).
 */
function twoJoinsFixture(order: Array<"title" | "key">) {
  const b = buildPassingBundle("jira");
  const s = session(b, "S13");
  const epic = createdKeys(session(b, "S3"))[0]!;
  const labels = [`Join \`${epic}\``, `Skip \`${epic}\``];
  const spanTitle = title("S3 span milestone");
  order.forEach((via, n) => {
    const forbidden = via === "title";
    appendAnnounced(
      b,
      s,
      "milestone-decision",
      moduleCommand("resolve_milestone_identity.ts", null, via === "title" ? `<B> jira DST <B>/.dpt/tmp/listing.json --title "${spanTitle}" --sibling <A>` : `<B> jira DST <B>/.dpt/tmp/listing.json --join-key ${epic} --sibling <A>`),
      {
        subject: via === "title" ? spanTitle : epic,
        decision: "join",
        evidence: {
          act: "join",
          via,
          key: epic,
          milestoneId: joinMilestoneId(epic),
          ...(via === "title" ? { title: spanTitle } : { joinKey: epic }),
          name: spanTitle,
          labels: JOIN_LISTED_LABELS,
          shared: true,
          default: forbidden ? "forbidden" : "allowed",
          ...(forbidden ? { options: labels } : {}),
        },
      },
      `join_${via}_${n}`,
    );
  });
  const w = appendTicketWrite(b, s, epic, "labels_643_two", "edit");
  w.input.fields = { labels: readMerge(JOIN_LISTED_LABELS, milestoneLabel(joinMilestoneId(epic))) };
  return { b, w };
}

describe("AC-STE-643.8 — the live grader grades a write that relied on an unanswered forbidden decision as ungated-write", () => {
  for (const t of TRACKERS) {
    /**
     * S3's span mint, with its create decision printed and recorded as
     * `default=forbidden` (a possibly capped create), optionally answered
     * between the decision's announcement and the container create.
     */
    const forbiddenMint = (answer: string | null) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S3");
      const decide = bashCall(s, /resolve_milestone_identity\.ts/);
      const r = announcedReceipt(b, decide);
      const name = String(r.evidence.title);
      const labels = [`Create \`${name}\``, `Skip \`${name}\``];
      Object.assign(r.evidence, { default: "forbidden", options: labels, possiblyCapped: true });
      decide.result.text = decide.result.text.replace("default=allowed", `default=forbidden\noptions=${JSON.stringify(labels)}`);
      const create = createCallOf(s);
      if (answer !== null) {
        const i = s.calls.indexOf(create);
        const at = new Date((Date.parse(decide.at) + Date.parse(create.at)) / 2).toISOString();
        const ask = consentAsk(`Create the milestone "${name}" in ${b.run.container}?`, labels, answer);
        s.calls.splice(i, 0, { ref: `${s.sessionId}:toolu_643_ask`, at, name: "AskUserQuestion", input: ask.input, result: ask.result, sidechain: false });
      }
      return { b, create, labels };
    };

    test(`${t}: a milestone create after a default=forbidden create decision with NO answer is ungated-write`, () => {
      const { b, create } = forbiddenMint(null);
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: PERMIT TWIN — the same create after an answered \`Create <title>\` is not ungated-write`, () => {
      const yes = forbiddenMint(forbiddenMint(null).labels[0]!);
      expect(ungatedAt(grade(yes.b), yes.create.ref)).toBe(false);
    });
    test(`${t}: an answered \`Skip <title>\` authorises nothing (ungated-write)`, () => {
      const probe = forbiddenMint(null);
      const skip = forbiddenMint(probe.labels[1]!);
      expect(ungatedAt(grade(skip.b), skip.create.ref)).toBe(true);
    });
    test(`${t}: CONTROL — the passing bundle's default=allowed create decision gates the create with no answer`, () => {
      const b = buildPassingBundle(t);
      expect(ungatedAt(grade(b), createCallOf(session(b, "S3")).ref)).toBe(false);
    });
  }

  const labelsJoin = labelsJoinFixture;
  const twoJoins = twoJoinsFixture;

  test("jira: a labels-only write after a default=forbidden title join with NO answer is ungated-write", () => {
    const { b, w } = labelsJoin("title", null);
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("jira: PERMIT TWIN — the same write after an answered `Join <KEY>` is not ungated-write", () => {
    const epic = createdKeys(session(buildPassingBundle("jira"), "S3"))[0]!;
    const { b, w } = labelsJoin("title", `Join \`${epic}\``);
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("jira: an answered `Skip <KEY>` authorises nothing (ungated-write)", () => {
    const epic = createdKeys(session(buildPassingBundle("jira"), "S3"))[0]!;
    const { b, w } = labelsJoin("title", `Skip \`${epic}\``);
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("jira: the right `Join <KEY>` label offered under a question naming neither the key nor the title does not consent (ungated-write)", () => {
    const b = buildPassingBundle("jira");
    const epic = createdKeys(session(b, "S3"))[0]!;
    const { b: bundle, w } = labelsJoin("title", `Join \`${epic}\``);
    const s = session(bundle, "S13");
    const ask = s.calls.find((c) => c.name === "AskUserQuestion" && c.ref.endsWith("ask_643"));
    if (!ask) throw new Error("fixture: the consent question is missing");
    const q = (ask.input.questions as Array<{ question: string }>)[0]!;
    q.question = "Shall I tidy the labels on this board?";
    ask.result.text = `User has answered your questions: "${q.question}"="Join \`${epic}\`". You can now continue with the user's answers in mind.`;
    expect(ungatedAt(grade(bundle), w.ref)).toBe(true);
  });
  test("jira: an answered `Join <KEY>` asked only in a subagent's sidechain does not consent for a main-chain write (ungated-write)", () => {
    const b = buildPassingBundle("jira");
    const epic = createdKeys(session(b, "S3"))[0]!;
    const { b: bundle, w } = labelsJoin("title", `Join \`${epic}\``);
    const s = session(bundle, "S13");
    const ask = s.calls.find((c) => c.name === "AskUserQuestion" && c.ref.endsWith("ask_643"));
    if (!ask) throw new Error("fixture: the consent question is missing");
    ask.sidechain = true;
    expect(w.sidechain, "CONTROL — the write itself is in the main chain").toBe(false);
    expect(ungatedAt(grade(bundle), w.ref)).toBe(true);
  });
  test("review TWR-4 — ownership first, as the hook: in S3, the session that CREATED the Epic, a labels write after an unanswered forbidden title join is not ungated-write", () => {
    const { b, w } = labelsJoin("title", null, "S3");
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("jira: CONTROL — a default=allowed key join gates the same labels-only write with no answer", () => {
    const { b, w } = labelsJoin("key", null);
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });


  test("jira: a key join, then a LATER unanswered forbidden title join of the same key, then the labels write → ungated-write (the latest join governs)", () => {
    const { b, w } = twoJoins(["key", "title"]);
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("jira: CONTROL (HIR P4) — a forbidden title join, then a LATER allowed key join, then the labels write → not ungated-write", () => {
    const { b, w } = twoJoins(["title", "key"]);
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
});

// ===========================================================================
// STE-644 (M_101065) — the live grader mirrors the hook's re-list rule: a
// milestone-container create is gated only when, after its create decision,
// the session recorded a canonical, complete re-list of the project's
// containers whose last result is within 120 s of the create, holding no open
// same-title container. The passing bundle's S3 mint re-lists; each fixture
// below differs from it in that re-list alone. RED at d7ae0187: the grader
// accepts the decision alone.
// ===========================================================================

describe("STE-644 — the live grader grades a milestone create without a qualifying re-list as ungated-write", () => {
  for (const t of TRACKERS) {
    /** S3 A's mint and its re-list (the call just before the create). */
    const mint = (b: LiveBundle) => {
      const s = session(b, "S3");
      const create = createCallOf(s);
      const relist = s.calls[s.calls.indexOf(create) - 1]!;
      const decide = bashCall(s, /resolve_milestone_identity\.ts/);
      return { s, create, relist, decide };
    };

    test(`${t}: CONTROL — the passing bundle's S3 mint re-lists after its decision and the create is not ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { s, create, relist, decide } = mint(b);
      expect(relist.name.endsWith(t === "jira" ? "searchJiraIssuesUsingJql" : "list_milestones"), "CONTROL — the call before the create is the re-list").toBe(true);
      expect(s.calls.indexOf(decide)).toBeLessThan(s.calls.indexOf(relist));
      expect(ungatedAt(grade(b), create.ref)).toBe(false);
    });
    test(`${t}: AC-STE-644.1 — the same create with the re-list removed is ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { s, create, relist } = mint(b);
      s.calls.splice(s.calls.indexOf(relist), 1);
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: review F1 — a bundle recording the PRESENT (unlisted) hook's hash is held to the re-list; a listed pre-STE-644 hash is not`, () => {
      const current = createHash("sha256").update(readFileSync(join(pluginRoot, F1().HOOK_SOURCE))).digest("hex");
      const held = buildPassingBundle(t);
      held.run.behaviourDigest.files[F1().HOOK_SOURCE] = current;
      const m1 = mint(held);
      m1.s.calls.splice(m1.s.calls.indexOf(m1.relist), 1);
      expect(ungatedAt(grade(held), m1.create.ref), "the present hook is held to the rule").toBe(true);
      const exempt = buildPassingBundle(t);
      exempt.run.behaviourDigest.files[F1().HOOK_SOURCE] = [...F1().PRE_RELIST_HOOK_SOURCES][0]!;
      sealDigest(exempt);
      const m2 = mint(exempt);
      m2.s.calls.splice(m2.s.calls.indexOf(m2.relist), 1);
      expect(ungatedAt(grade(exempt), m2.create.ref), "a listed pre-STE-644 hook is exempt").toBe(false);
    });
    test(`${t}: AC-STE-644.1 — a re-list recorded BEFORE the decision does not gate the create (ungated-write)`, () => {
      const b = buildPassingBundle(t);
      const { s, create, relist, decide } = mint(b);
      swapCalls(s, s.calls.indexOf(decide), s.calls.indexOf(relist));
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: AC-STE-644.2 — a create sent 121 s after the re-list's result is ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { create, relist } = mint(b);
      create.at = new Date(Date.parse(relist.at) + 121_000).toISOString();
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: AC-STE-644.5 — a re-list holding an open container of the create's title is ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { create, relist } = mint(b);
      const name = String(t === "jira" ? create.input.summary : create.input.name);
      const dup: TrackerItem = {
        key: t === "jira" ? `${b.run.container}-190` : "5f3a9cff-7d2e-4f00-9a00-0000000000fe",
        summary: name,
        labels: [],
        status: t === "jira" ? "To Do" : "",
        parent: null,
        milestone: null,
        issueType: t === "jira" ? "Epic" : null,
        kind: t === "jira" ? "issue" : "milestone",
        container: t === "jira" ? b.run.container : "",
      };
      relist.result.items = [dup];
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: AC-STE-644.4 — a re-list whose last page is not proven last is ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { create, relist } = mint(b);
      relist.result.lastPage = false;
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
  }

  test("jira: AC-STE-644.3 — a re-list narrowed by summary (the decision listing's own JQL) is ungated-write", () => {
    const b = buildPassingBundle("jira");
    const { create, relist } = (() => {
      const s = session(b, "S3");
      const c = createCallOf(s);
      return { create: c, relist: s.calls[s.calls.indexOf(c) - 1]! };
    })();
    relist.input.jql = `project = ${b.run.container} AND issuetype = Epic AND summary ~ "${NONCE}"`;
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
  test("linear: AC-STE-644.3 — a list_milestones of another project is ungated-write", () => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S3");
    const create = createCallOf(s);
    s.calls[s.calls.indexOf(create) - 1]!.input.project = "Some Other Project";
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
});

// ===========================================================================
// Review F1 (M_101065 re-cut) — PRE_RELIST_HOOK_SOURCES is frozen at the 18
// pre-STE-644 hook sources and never holds the present hook's hash, so no edit
// can quietly exempt runs recorded under a hook that demands the re-list.
// ===========================================================================

describe("review F1 — the frozen pre-STE-644 hook-source set", () => {
  test("holds exactly 18 SHA-256 values, none of them the present hook's", () => {
    expect(F1().PRE_RELIST_HOOK_SOURCES.size).toBe(18);
    for (const h of F1().PRE_RELIST_HOOK_SOURCES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    const current = createHash("sha256").update(readFileSync(join(pluginRoot, F1().HOOK_SOURCE))).digest("hex");
    expect(F1().PRE_RELIST_HOOK_SOURCES.has(current)).toBe(false);
  });
  test("review R2-F1-LITERAL — the set is exactly this sorted literal, and excludes the hook source of the round-1 re-cut (43fd0265…)", () => {
    expect([...F1().PRE_RELIST_HOOK_SOURCES].sort()).toEqual([
      "05b8d4178d99f3abf4b55f05f6a473637be041c4e6b02c442cfc42e798b1df82",
      "0810dc547cd2a88e68bc1128224e493c73f7eaa87dbf156fd9b6395561186858",
      "15f5604b4f3ae2ca6e76e1318dedd57451605ab2a04600fb20fac125df6eb1d3",
      "2b13d187b0b7159a72b4fb0f6a644e4912e1c0c7377d5df4b0710f5eaeb129d6",
      "3002d20cff4ba04fed21f1c24e2ffbf5a85ac3c344d08e5d1964b5e16ef836c0",
      "4caf51055a375f7e9c8a0a9eaa9549937ac339417c09527401a2b8975857fc6b",
      "60a29002e226872671c8227bc1955128491d0b2906b022eff8573dad609f273a",
      "638244fff68817e844f9b8b6b2d0747651d1660174b8ac2dedbbd2cb1206cd3f",
      "735a4f598291a8dd516ba9b6cf185b3b11415e600fc5afc722df015bf11dc56b",
      "80094c0e8d16489be1f0c2804602a60dfcc958d3cadc5525caad848de3d5fd47",
      "a8093ce74e86ece5f5c9dd10ddf76b13d5408b8d5e401d5e22a606de7da22da7",
      "b76b0d8db8a9c27261becaaf6d637737f947a7c9597a54f18b2c5a3e3a29c475",
      "b7c814864606b3a25f659a93bd30c2526d44fdafbd2a1199a116750c17b6fcb7",
      "c50945b9b6fab9df69f8908e925dd9b239f584aa9c03d41a02d1ae334a201482",
      "dc411cd9df2243b2f6e9a12fb5807c9ebf8312d785b52b881af0a9c8e4c984f5",
      "f2c066df5d58915e82b15f8468cd88e5b2d3fa777a4d052412b4df997b17c248",
      "f63cdb01cfba9f48a6aa3fc2f62d3b80bdbfaaa907d663205e4aeb68e94c1000",
      "ff4702900225bad2d87032f3df7b6f30e798ce7a3c1a64f2429dfa6369047258",
    ]);
    expect([...F1().PRE_RELIST_HOOK_SOURCES].some((h) => h.startsWith("43fd0265"))).toBe(false);
  });
  test("hookDemandsRelist: no recorded hook source, or an unlisted one, is held; a listed one is not", () => {
    const b = buildPassingBundle("jira");
    const { HOOK_SOURCE, PRE_RELIST_HOOK_SOURCES, hookDemandsRelist } = F1();
    delete b.run.behaviourDigest.files[HOOK_SOURCE];
    expect(hookDemandsRelist(b)).toBe(true);
    b.run.behaviourDigest.files[HOOK_SOURCE] = "0".repeat(64);
    expect(hookDemandsRelist(b)).toBe(true);
    b.run.behaviourDigest.files[HOOK_SOURCE] = [...PRE_RELIST_HOOK_SOURCES][5]!;
    sealDigest(b);
    expect(hookDemandsRelist(b)).toBe(false);
  });
});


// ===========================================================================
// STE-650 (M_163656) — the grader mirrors the hook.
//
// M_101065 left the live grader laxer than the hook it grades. Each leg below
// is RED at HEAD for the reason its AC states, or a labelled CONTROL / keep-
// behaviour leg that shows the opposite break. The hook-side twins live in
// tests/hook-modules-pre-tracker-write-gate.test.ts ("STE-650 …").
// ===========================================================================

/** Insert `call` at `index` of `s`, stamped midway between its neighbours. */
function insertCall(s: BundleSession, index: number, call: Omit<ToolCall, "at">): ToolCall {
  const before = s.calls[index - 1]?.at ?? s.calls[index]!.at;
  const after = s.calls[index]?.at ?? before;
  const at = new Date((Date.parse(before) + Date.parse(after)) / 2).toISOString();
  const c: ToolCall = { ...call, at };
  s.calls.splice(index, 0, c);
  return c;
}

/** A tracker receipt of `kind` in `s`'s repository, announced by a Bash run of `command` inserted at `index`. Returns its path. */
function insertAnnounced(b: LiveBundle, s: BundleSession, index: number, kind: string, command: string, fields: { subject: string; decision?: string; evidence?: Record<string, unknown> }, tag: string): string {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/${kind}-650-${tag}.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({ path, sessionId: s.sessionId, sha256: sha256(path), kind, adapter: b.run.tracker, container: b.run.container, subject: fields.subject, decision: fields.decision ?? kind, evidence: fields.evidence ?? {} });
  insertCall(s, index, { ref: `${s.sessionId}:toolu_650_${tag}`, name: "Bash", input: { command, description: "run" }, result: { isError: false, text: `decided\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null }, sidechain: false });
  return path;
}

/** One AskUserQuestion carrying several questions, answered per question, as the bundle records it. */
function consentAskMany(qs: Array<{ question: string; labels: string[]; answer: string }>): { input: Record<string, unknown>; result: ToolCall["result"] } {
  return {
    input: { questions: qs.map((q, i) => ({ question: q.question, header: `Q${i + 1}`, multiSelect: false, options: q.labels.map((label) => ({ label })) })) },
    result: {
      isError: false,
      text: `User has answered your questions: ${qs.map((q) => `"${q.question}"="${q.answer}"`).join(", ")}. You can now continue with the user's answers in mind.`,
      exitCode: null,
      items: null,
      lastPage: null,
    },
  };
}

const HOOK_PATH_650 = join(pluginRoot, "templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts");
/** STE-650 AC.1 — the ONE ownership predicate's home, imported by the hook and the grader alike. */
const OWNERSHIP_MODULE_650 = join(pluginRoot, "adapters", "_shared", "src", "join_consent_ownership.ts");

/** The body of the top-level `function <name>(` in `src`, up to the next top-level declaration. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n(?:export )?(?:function |const |let |interface |type |\/\*\*)/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("STE-650 AC-STE-650.1 — one exported ownership predicate, called by the hook and the grader", () => {
  const ROUTES = ["created", "fr-binding", "reuse-receipt", "binding-receipt", "import-receipt"] as const;

  test("AC-STE-650.1 — join_consent_ownership.ts exports exemptsJoinConsent(route): only a key this session created is exempt from the join consent", async () => {
    expect(existsSync(OWNERSHIP_MODULE_650), `${OWNERSHIP_MODULE_650} ships the shared predicate`).toBe(true);
    const m = (await import(OWNERSHIP_MODULE_650)) as { exemptsJoinConsent?: (route: string) => boolean };
    expect(typeof m.exemptsJoinConsent).toBe("function");
    expect(Object.fromEntries(ROUTES.map((r) => [r, m.exemptsJoinConsent!(r)]))).toEqual({
      created: true,
      "fr-binding": false,
      "reuse-receipt": false,
      "binding-receipt": false,
      "import-receipt": false,
    });
  });

  test("AC-STE-650.1 — source pin: the hook's created-key exemption (gateJoinedLabels) and the grader's ownership test (gatedWrites) both import and call it; neither declares its own", () => {
    const hook = readFileSync(HOOK_PATH_650, "utf-8");
    const graderSrc = readFileSync(GRADER_PATH, "utf-8");
    const importsIt = (src: string, from: RegExp) =>
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].some((m) => /\bexemptsJoinConsent\b/.test(m[1]!) && from.test(m[2]!));
    const declaresIt = (src: string) => /(?:function\s+exemptsJoinConsent\b|(?:const|let|var)\s+exemptsJoinConsent\s*=)/.test(src);
    expect({
      hookImports: importsIt(hook, /adapters\/_shared\/src\/join_consent_ownership(?:\.ts)?$/),
      hookCallsInGateJoinedLabels: functionBody(hook, "gateJoinedLabels").includes("exemptsJoinConsent("),
      hookDeclares: declaresIt(hook),
      graderImports: importsIt(graderSrc, /^\.\/join_consent_ownership(?:\.ts)?$/),
      graderCallsInGatedWrites: functionBody(graderSrc, "gatedWrites").includes("exemptsJoinConsent"),
      graderDeclares: declaresIt(graderSrc),
    }).toEqual({
      hookImports: true,
      hookCallsInGateJoinedLabels: true,
      hookDeclares: false,
      graderImports: true,
      graderCallsInGatedWrites: true,
      graderDeclares: false,
    });
  });

  test("CONTROL — functionBody reads the named function: gateJoinedLabels holds its TWR-4 exemption, gatedWrites its owned() test", () => {
    expect(functionBody(readFileSync(HOOK_PATH_650, "utf-8"), "gateJoinedLabels")).toContain("unconsented");
    expect(functionBody(readFileSync(GRADER_PATH, "utf-8"), "gatedWrites")).toContain("const owned =");
  });
});

describe("STE-650 AC-STE-650.2 — grader: a key owned only through an FR binding or a reuse, binding or import receipt still needs the join consent", () => {
  type Route = "fr-binding" | "reuse-receipt" | "binding-receipt" | "import-receipt";
  const ROUTES: readonly Route[] = ["fr-binding", "reuse-receipt", "binding-receipt", "import-receipt"];
  /** Make S13's repository (B) own `epic` by one route, before anything else is appended. */
  const ownVia = (route: Route) => (b: LiveBundle, s: BundleSession, epic: string): void => {
    switch (route) {
      case "fr-binding":
        b.repos[s.root].frBindings.push({ path: "specs/frs/fr-650-epic.md", title: "fr 650 epic", key: epic, milestone: null });
        return;
      case "reuse-receipt":
        appendAnnounced(b, s, "reuse", moduleCommand("create_idempotency_probe.ts", "decide", "<B> --title-file <B>/.dpt/tmp/t.txt"), { subject: title("S3 span milestone"), decision: "reused", evidence: { key: epic } }, "reuse_650");
        return;
      case "binding-receipt":
        appendAnnounced(b, s, "binding", moduleCommand("ticket_ownership.ts", "confirm", `<B> ${epic} <B>/.dpt/tmp/ticket.json`), { subject: epic, decision: "owned", evidence: { verdict: "owned", tracked: 1 } }, "bind_650");
        return;
      case "import-receipt": {
        const ask = consentAsk(`Import ${epic} into this repository?`, [`Import ${epic}`, `Skip ${epic}`], `Import ${epic}`);
        appendCall(s, "AskUserQuestion", ask.input, ask.result, "imp_ask_650");
        appendAnnounced(b, s, "import", moduleCommand("container_ownership.ts", "consent", `<B> ${epic} <B>/.dpt/tmp/page.json`), { subject: epic, decision: "import", evidence: { key: epic } }, "imp_650");
        return;
      }
    }
  };
  /** A transition on S3's Epic from S13, after `arrange`. */
  const transitionOn = (arrange: (b: LiveBundle, s: BundleSession, epic: string) => void) => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S13");
    const epic = createdKeys(session(b, "S3"))[0]!;
    arrange(b, s, epic);
    return { b, w: appendTicketWrite(b, s, epic, "tr_650") };
  };

  test("CONTROL — with no route, S13 does not own S3's Epic: a transition on it is ungated-write", () => {
    const { b, w } = transitionOn(() => {});
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });

  for (const route of ROUTES) {
    test(`CONTROL (${route}) — the route really owns the Epic: a transition on it is not ungated-write`, () => {
      const { b, w } = transitionOn(ownVia(route));
      expect(ungatedAt(grade(b), w.ref)).toBe(false);
    });
    test(`AC-STE-650.2 (${route}) — a labels write after an unanswered forbidden title join is ungated-write, as the hook refuses it (HEAD: owned() short-circuits → no finding)`, () => {
      const { b, w } = labelsJoinFixture("title", null, "S13", { arrange: ownVia(route) });
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
  }

  test("AC-STE-650.2 (created) — in S3, the session that created the Epic, the read-merge labels write after an unanswered forbidden title join is not ungated-write, as the hook permits it", () => {
    const { b, w } = labelsJoinFixture("title", null, "S3");
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
});

describe("STE-650 AC-STE-650.3 — grader: a re-list stamped more than 5 s after the create does not permit it", () => {
  for (const t of TRACKERS) {
    const mint = (b: LiveBundle) => {
      const s = session(b, "S3");
      const create = createCallOf(s);
      return { create, relist: s.calls[s.calls.indexOf(create) - 1]! };
    };
    test(`${t}: AC-STE-650.3 — a re-list stamped 10 s after the create is ungated-write (HEAD: a negative gap passes)`, () => {
      const b = buildPassingBundle(t);
      const { create, relist } = mint(b);
      relist.at = new Date(Date.parse(create.at) + 10_000).toISOString();
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
    test(`${t}: AC-STE-650.3 CONTROL — a re-list stamped 3 s after the create (within the 5 s skew) is not ungated-write`, () => {
      const b = buildPassingBundle(t);
      const { create, relist } = mint(b);
      relist.at = new Date(Date.parse(create.at) + 3_000).toISOString();
      expect(ungatedAt(grade(b), create.ref)).toBe(false);
    });
  }
});

describe("STE-650 AC-STE-650.4 — grader: a joined Epic's labels write is the read-merge the join printed", () => {
  test("AC-STE-650.4 CONTROL — the read-merge (every listed label plus the milestone label) after an allowed key join is not ungated-write", () => {
    const { b, w } = labelsJoinFixture("key", null);
    expect(w.input.fields).toEqual({ labels: [...JOIN_LISTED_LABELS, milestoneLabel(joinMilestoneId(String(w.input.issueIdOrKey)))] });
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("AC-STE-650.4 — a labels write dropping a listed label (the SET that clobbers a sibling's labels) is ungated-write (HEAD: no labels check)", () => {
    const { b, w } = labelsJoinFixture("key", null, "S13", { write: (_listed, m) => [m] });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("AC-STE-650.4 — a labels write dropping the milestone label is ungated-write (HEAD: no labels check)", () => {
    const { b, w } = labelsJoinFixture("key", null, "S13", { write: (listed) => [...listed] });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("AC-STE-650.4 — on an Epic the session created (the TWR-4 exemption covers the consent only), a clobbering labels write is ungated-write (HEAD: created short-circuits)", () => {
    const { b, w } = labelsJoinFixture("title", null, "S3", { write: (_listed, m) => [m] });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
});

describe("STE-650 AC-STE-650.5 — grader: the hook's ticket-create rules (settled, parallel duplicate, forbidden join)", () => {
  const retitle = (t: Tracker, o: Record<string, unknown>, to: string): void => {
    if (t === "jira") {
      if ("summary" in o) o.summary = to;
    } else if ("title" in o) o.title = to;
  };
  const otherKey = (b: LiveBundle): string => (b.run.tracker === "jira" ? `${b.run.container}-191` : "STE-991");

  for (const t of TRACKERS) {
    /** S2 A's FR create, then a second decide and a second create; `distinct` retitles both. */
    const secondCreate = (distinct: boolean) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S2", 0);
      const decide = bashCall(s, /create_idempotency_probe\.ts/);
      const r1 = announcedReceipt(b, decide);
      const create = createCallOf(s);
      const evidence = clone(r1.evidence) as Record<string, unknown>;
      const input = clone(create.input) as Record<string, unknown>;
      if (distinct) {
        const to = title("S2 a genuinely second ticket");
        retitle(t, evidence.createPayload as Record<string, unknown>, to);
        retitle(t, input, to);
      }
      appendAnnounced(b, s, "create", String(decide.input.command), { subject: r1.subject, decision: "create", evidence }, "settle_650");
      const item = { ...create.result.items![0]!, key: otherKey(b) };
      const dup = appendCall(s, create.name, input, { isError: false, text: "", exitCode: null, items: [item], lastPage: null }, "dup_650");
      return { b, create, dup };
    };
    test(`${t}: AC-STE-650.5 — a second create of the same ticket after a settled create of it (fresh receipt and all) is ungated-write (HEAD: the fresh receipt permits it)`, () => {
      const { b, dup } = secondCreate(false);
      expect(ungatedAt(grade(b), dup.ref)).toBe(true);
    });
    test(`${t}: AC-STE-650.5 CONTROL — a second create of a DIFFERENT title with its own receipt is not ungated-write, and neither is the first`, () => {
      const { b, create, dup } = secondCreate(true);
      const v = grade(b);
      expect({ first: ungatedAt(v, create.ref), second: ungatedAt(v, dup.ref) }).toEqual({ first: false, second: false });
    });

    /** Two creates in one message: the first's outcome unknown (timed out), the second succeeding. `distinct` retitles the first. */
    const parallel = (distinct: boolean) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S2", 0);
      const create = createCallOf(s);
      const second: ToolCall = { ...clone(create), ref: `${create.ref}_parallel_650` };
      create.result = { isError: true, text: "Error: the request to the tracker timed out after 60 s", exitCode: null, items: null, lastPage: null };
      if (distinct) retitle(t, create.input, title("S2 some other ticket"));
      s.calls.splice(s.calls.indexOf(create) + 1, 0, second);
      return { b, second };
    };
    test(`${t}: AC-STE-650.5 — a parallel duplicate create (same message, the first's outcome unknown) is ungated-write (HEAD: the unspent receipt permits it)`, () => {
      const { b, second } = parallel(false);
      expect(ungatedAt(grade(b), second.ref)).toBe(true);
    });
    test(`${t}: AC-STE-650.5 CONTROL — the same message whose errored create was of ANOTHER ticket leaves the create clean`, () => {
      const { b, second } = parallel(true);
      expect(ungatedAt(grade(b), second.ref)).toBe(false);
    });
  }

  /** S2 A's FR create attached (by provenance) through a join decision of S3's container announced before the attach. */
  const attachedThroughJoin = (via: "title" | "key", answered: boolean, t: Tracker = "jira") => {
    const b = buildPassingBundle(t);
    const s = session(b, "S2", 0);
    const epic = createdKeys(session(b, "S3"))[0]!;
    const spanTitle = title("S3 span milestone");
    const labels = [`Join \`${epic}\``, `Skip \`${epic}\``];
    const attach = bashCall(s, /attach_project_milestone\.ts/);
    const forbidden = via === "title";
    const joinPath = insertAnnounced(
      b,
      s,
      s.calls.indexOf(attach),
      "milestone-decision",
      moduleCommand("resolve_milestone_identity.ts", null, via === "title" ? `<A> ${t} DST <A>/.dpt/tmp/listing.json --title "${spanTitle}" --sibling <B>` : `<A> ${t} DST <A>/.dpt/tmp/listing.json --join-key ${epic} --sibling <B>`),
      {
        subject: via === "title" ? spanTitle : epic,
        decision: "join",
        evidence: { act: "join", via, key: epic, ...(t === "jira" ? { milestoneId: joinMilestoneId(epic) } : {}), ...(via === "title" ? { title: spanTitle } : { joinKey: epic }), name: spanTitle, labels: [], shared: true, default: forbidden ? "forbidden" : "allowed", ...(forbidden ? { options: labels } : {}) },
      },
      `join_${via}`,
    );
    if (answered) {
      const ask = consentAsk(`Join the existing Epic ${epic} "${spanTitle}" as this repository's milestone?`, labels, labels[0]!);
      insertCall(s, s.calls.indexOf(attach), { ref: `${s.sessionId}:toolu_650_ask`, name: "AskUserQuestion", input: ask.input, result: ask.result, sidechain: false });
    }
    announcedReceipt(b, attach).evidence.provenance = { kind: "decided", receipt: joinPath, sha256: sha256(joinPath) };
    return { b, create: createCallOf(s) };
  };
  test("jira: AC-STE-650.5 — an FR create whose attach target rests on an unanswered forbidden title join is ungated-write (HEAD: provenance unread)", () => {
    const { b, create } = attachedThroughJoin("title", false);
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
  test("jira: AC-STE-650.5 CONTROL — the same after an answered `Join <KEY>` is not ungated-write", () => {
    const { b, create } = attachedThroughJoin("title", true);
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
  test("jira: AC-STE-650.5 CONTROL — an attach target resting on an allowed key join is not ungated-write", () => {
    const { b, create } = attachedThroughJoin("key", false);
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
  // Review F5 — the Linear twin: the rule reads the decision, not the tracker.
  test("linear: AC-STE-650.5 — an FR create whose attach target rests on an unanswered forbidden title join is ungated-write", () => {
    const { b, create } = attachedThroughJoin("title", false, "linear");
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
  test("linear: AC-STE-650.5 CONTROL — the same after an answered `Join <KEY>` is not ungated-write", () => {
    const { b, create } = attachedThroughJoin("title", true, "linear");
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
  test("linear: AC-STE-650.5 CONTROL — an attach target resting on an allowed key join is not ungated-write", () => {
    const { b, create } = attachedThroughJoin("key", false, "linear");
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
});

describe("STE-650 AC-STE-650.6 — grader: of several unspent matching decisions, the one the hook permits governs", () => {
  for (const t of TRACKERS) {
    /** S3 A's mint with a default=forbidden create decision of the same title inserted BEFORE its allowed one. */
    const twoDecisions = (secondForbidden: boolean) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S3");
      const decide = bashCall(s, /resolve_milestone_identity\.ts/);
      const r2 = announcedReceipt(b, decide);
      const name = String(r2.evidence.title);
      const options = [`Create \`${name}\``, `Skip \`${name}\``];
      insertAnnounced(b, s, s.calls.indexOf(decide), "milestone-decision", String(decide.input.command), {
        subject: name,
        decision: "create",
        evidence: { ...clone(r2.evidence), default: "forbidden", options, possiblyCapped: true },
      }, "d1_forbidden");
      if (secondForbidden) Object.assign(r2.evidence, { default: "forbidden", options, possiblyCapped: true });
      return { b, create: createCallOf(s) };
    };
    test(`${t}: AC-STE-650.6 — an unanswered forbidden decision, then an allowed one, then the re-list and the create → not ungated-write (HEAD: grades against the first unspent, the forbidden one)`, () => {
      const { b, create } = twoDecisions(false);
      expect(ungatedAt(grade(b), create.ref)).toBe(false);
    });
    test(`${t}: AC-STE-650.6 CONTROL — both decisions forbidden and unanswered → ungated-write`, () => {
      const { b, create } = twoDecisions(true);
      expect(ungatedAt(grade(b), create.ref)).toBe(true);
    });
  }
});

describe("STE-650 AC-STE-650.13 — grader: an allowed Linear decision the operator answered accepts a capped re-list, as the hook does", () => {
  /** S3's Linear mint with its post-decision re-list made a capped (not last) page, optionally answered `Create <title>`. */
  const cappedMint = (answer: "create" | "skip" | null) => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S3");
    const decide = bashCall(s, /resolve_milestone_identity\.ts/);
    const name = String(announcedReceipt(b, decide).evidence.title);
    const create = createCallOf(s);
    const from = s.calls.indexOf(decide);
    const relists = s.calls.filter((c, j) => j > from && j < s.calls.indexOf(create) && c.name.endsWith("list_milestones"));
    expect(relists.length, "fixture: S3 re-lists between its decision and its create").toBeGreaterThan(0);
    for (const c of relists) c.result.lastPage = false;
    if (answer !== null) {
      const labels = [`Create \`${name}\``, `Skip \`${name}\``];
      const i = s.calls.indexOf(create);
      const at = new Date((Date.parse(decide.at) + Date.parse(create.at)) / 2).toISOString();
      const ask = consentAsk(`Create the milestone "${name}" in ${b.run.container}?`, labels, labels[answer === "create" ? 0 : 1]!);
      s.calls.splice(i, 0, { ref: `${s.sessionId}:toolu_650_13_ask`, at, name: "AskUserQuestion", input: ask.input, result: ask.result, sidechain: false });
    }
    return { b, create };
  };
  test("AC-STE-650.13 — allowed decision + answered `Create <title>` + a capped re-list → not ungated-write (HEAD: consent read from default=forbidden only)", () => {
    const { b, create } = cappedMint("create");
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
  test("AC-STE-650.13 CONTROL — the same capped re-list with NO answer → ungated-write", () => {
    const { b, create } = cappedMint(null);
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
  test("AC-STE-650.13 CONTROL — answered `Skip <title>` consents to nothing → ungated-write", () => {
    const { b, create } = cappedMint("skip");
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
});

describe("STE-650 AC-STE-650.7 — hookDemandsRelist re-derives the digest before trusting the recorded hook source", () => {
  const listed = (): string => [...F1().PRE_RELIST_HOOK_SOURCES][0]!;

  test("AC-STE-650.7 — a listed pre-STE-644 hook hash under a recorded digest that disagrees with the files it lists is held to the re-list (HEAD: trusted, exempt)", () => {
    const b = buildPassingBundle("jira");
    b.run.behaviourDigest.files[F1().HOOK_SOURCE] = listed();
    expect(digestOfFiles(b.run.behaviourDigest.files), "CONTROL — the fixture's recorded digest is not derived from its files").not.toBe(b.run.behaviourDigest.digest);
    expect(F1().hookDemandsRelist(b)).toBe(true);
  });
  test("AC-STE-650.7 CONTROL — the same hash under a digest re-derived from the files is trusted: not held", () => {
    const b = sealDigest((() => {
      const x = buildPassingBundle("jira");
      x.run.behaviourDigest.files[F1().HOOK_SOURCE] = listed();
      return x;
    })());
    expect(F1().hookDemandsRelist(b)).toBe(false);
  });
  test("AC-STE-650.7 — through the grade: the forged exemption no longer excuses a create with no re-list (ungated-write); the sealed one still does", () => {
    for (const [seal, want] of [[false, true], [true, false]] as const) {
      const b = buildPassingBundle("jira");
      b.run.behaviourDigest.files[F1().HOOK_SOURCE] = listed();
      if (seal) sealDigest(b);
      const s = session(b, "S3");
      const create = createCallOf(s);
      s.calls.splice(s.calls.indexOf(create) - 1, 1);
      expect(ungatedAt(grade(b), create.ref), seal ? "sealed" : "forged").toBe(want);
    }
  });
  // Review F4 — the residual v2.92.0 discloses under Known defects, pinned so
  // a future fix (hook bytes in the bundle, or a signed digest) must flip this
  // leg on purpose rather than by accident.
  test("AC-STE-650.7 KNOWN RESIDUAL — a forger who rewrites the hook-source entry AND recomputes the digest over the rewritten map is trusted as pre-relist, and its create with no re-list grades clean", () => {
    const b = buildPassingBundle("jira");
    expect(F1().hookDemandsRelist(b), "CONTROL — the honest bundle is held to the re-list").toBe(true);
    b.run.behaviourDigest.files[F1().HOOK_SOURCE] = listed();
    sealDigest(b);
    expect(digestOfFiles(b.run.behaviourDigest.files)).toBe(b.run.behaviourDigest.digest);
    expect(F1().hookDemandsRelist(b)).toBe(false);
    const s = session(b, "S3");
    const create = createCallOf(s);
    s.calls.splice(s.calls.indexOf(create) - 1, 1);
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
  test("CONTROL (STE-618 regrade) — every committed live bundle's recorded digest is re-derivable from the files it lists", () => {
    const dir = join(import.meta.dir, "fixtures", "shared-tracker-live");
    const bundles = readdirSync(dir).map((d) => join(dir, d, "bundle.json")).filter((p) => existsSync(p));
    expect(bundles.length).toBeGreaterThan(0);
    const inconsistent = bundles.filter((p) => {
      const b = JSON.parse(readFileSync(p, "utf-8")) as LiveBundle;
      return digestOfFiles(b.run.behaviourDigest.files) !== b.run.behaviourDigest.digest;
    });
    expect(inconsistent).toEqual([]);
  });
});

describe("STE-650 AC-STE-650.8 — grader: consent is read per question", () => {
  const joinQ = (epic: string, spanTitle: string) => `Join the existing Epic ${epic} "${spanTitle}" as this repository's milestone?`;

  test("AC-STE-650.8 (join) — the question naming the Epic answered exactly `Join <KEY>`, another answered \"No\" → not ungated-write (HEAD: every answer must equal the label)", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      ask: (epic, spanTitle, labels) => consentAskMany([
        { question: joinQ(epic, spanTitle), labels, answer: labels[0]! },
        { question: "Also post a note to the team channel?", labels: ["Yes", "No"], answer: "No" },
      ]),
    });
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("AC-STE-650.8 (join) CONTROL — the question naming the Epic answered `Skip <KEY>`, an unrelated one offering and answered `Join <KEY>` → ungated-write (guards a per-answer .some)", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      ask: (epic, spanTitle, labels) => consentAskMany([
        { question: joinQ(epic, spanTitle), labels, answer: labels[1]! },
        { question: "Proceed with the milestone?", labels: [labels[0]!, "Cancel"], answer: labels[0]! },
      ]),
    });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });

  for (const order of ["skip first", "join first"] as const) {
    test(`AC-STE-650.8 (review FO-2, ${order}) — two questions both naming the Epic and offering \`Join <KEY>\`, one answered Join and one Skip → ungated-write: a no is never overridden by a yes`, () => {
      const { b, w } = labelsJoinFixture("title", null, "S13", {
        ask: (epic, spanTitle, labels) => {
          const skip = { question: joinQ(epic, spanTitle), labels, answer: labels[1]! };
          const join = { question: `Confirm: ${joinQ(epic, spanTitle)}`, labels, answer: labels[0]! };
          return consentAskMany(order === "skip first" ? [skip, join] : [join, skip]);
        },
      });
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
  }

  /** S13's import consent ask replaced by a two-question ask. */
  const importMany = (t: Tracker, subjectAnswer: "import" | "skip", other: { question: string; labels: (u: string) => string[]; answer: (u: string) => string }) => {
    const b = buildPassingBundle(t);
    const s = session(b, "S13");
    const u = intruderKey(b);
    const ask = s.calls.find((c) => c.name === "AskUserQuestion");
    if (!ask) throw new Error("fixture: S13 has no consent ask");
    const q1 = String((ask.input.questions as Array<{ question: string }>)[0]!.question);
    const many = consentAskMany([
      { question: q1, labels: [`Import ${u}`, `Skip ${u}`], answer: subjectAnswer === "import" ? `Import ${u}` : `Skip ${u}` },
      { question: other.question, labels: other.labels(u), answer: other.answer(u) },
    ]);
    ask.input = many.input;
    ask.result = many.result;
    return { b, s };
  };
  for (const t of TRACKERS) {
    test(`${t}: AC-STE-650.8 (import) — the question naming the key answered \`Skip <KEY>\`, an unrelated one offering and answered \`Import <KEY>\` → the import write is ungated-write (HEAD: any \`="Import <KEY>"\` consents)`, () => {
      const { b } = importMany(t, "skip", { question: "Confirm before I continue?", labels: (u) => [`Import ${u}`, "Cancel"], answer: (u) => `Import ${u}` });
      expect(ungatedAt(grade(b), importWrite(b).ref)).toBe(true);
    });
    test(`${t}: AC-STE-650.8 (import) CONTROL — the question naming the key answered exactly \`Import <KEY>\`, another answered "No" → the import write is not ungated-write (guards a per-answer .every)`, () => {
      const { b } = importMany(t, "import", { question: "Also tidy its labels?", labels: () => ["Yes", "No"], answer: () => "No" });
      expect(ungatedAt(grade(b), importWrite(b).ref)).toBe(false);
    });
  }
});

// ===========================================================================
// STE-655 (M_a85e46) — the grader reads the hook's labels envelope and the
// latest answer, mirrors the container prior-create rule, and grades every
// side a link or relation writes.
//
// Each leg is RED at HEAD for the reason its AC states, or a labelled CONTROL
// (keep-behaviour) that shows the opposite break. The hook-side twins live in
// tests/hook-modules-pre-tracker-write-gate.test.ts ("STE-655 …").
// ===========================================================================

const OWNERSHIP_SRC_655 = join(pluginRoot, "adapters", "_shared", "src", "join_consent_ownership.ts");
const ENVELOPE_DECL_655 = "export function labelsEnvelope(";

/** Make S13's repository (B) own `key` by an FR binding (the AC-STE-650.2 fr-binding route). */
const frBound = (key: string) => (b: LiveBundle, s: BundleSession): void => {
  b.repos[s.root].frBindings.push({ path: `specs/frs/fr-655-${key.toLowerCase()}.md`, title: `fr 655 ${key}`, key, milestone: null });
};
const joinQ655 = (epic: string, spanTitle: string) => `Join the existing Epic ${epic} "${spanTitle}" as this repository's milestone?`;
/** Insert an answered AskUserQuestion into `s` just before call `before`. */
function askBefore(s: BundleSession, before: ToolCall, question: string, labels: string[], answer: string, tag: string): void {
  const ask = consentAsk(question, labels, answer);
  insertCall(s, s.calls.indexOf(before), { ref: `${s.sessionId}:toolu_655_${tag}`, name: "AskUserQuestion", input: ask.input, result: ask.result, sidechain: false });
}

describe("STE-655 AC-STE-655.8 — one exported labels-envelope predicate, called by the hook and the grader", () => {
  test("AC-STE-655.8 — source pin: the hook's joined-labels gate and the grader's labels-only test both import and call labelsEnvelope; neither declares its own or keeps its inline key test", () => {
    const hook = readFileSync(HOOK_PATH_650, "utf-8");
    const graderSrc = readFileSync(GRADER_PATH, "utf-8");
    const importsIt = (src: string, from: RegExp) =>
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].some((m) => /\blabelsEnvelope\b/.test(m[1]!) && from.test(m[2]!));
    const declaresIt = (src: string) => /(?:function\s+labelsEnvelope\b|(?:const|let|var)\s+labelsEnvelope\s*=)/.test(src);
    const gate = functionBody(hook, "gateJoinedLabels");
    const writes = functionBody(graderSrc, "gatedWrites");
    expect({
      shared: readFileSync(OWNERSHIP_SRC_655, "utf-8").split(ENVELOPE_DECL_655).length - 1,
      hookImports: importsIt(hook, /adapters\/_shared\/src\/join_consent_ownership(?:\.ts)?$/),
      hookCallsInGateJoinedLabels: gate.includes("labelsEnvelope("),
      hookKeepsInlineKeyTest: gate.includes('k !== "cloudId"'),
      hookDeclares: declaresIt(hook),
      graderImports: importsIt(graderSrc, /^\.\/join_consent_ownership(?:\.ts)?$/),
      graderCallsInGatedWrites: writes.includes("labelsEnvelope("),
      graderKeepsInlineKeyTest: /\.every\(\(k\) => k === "labels"\)/.test(writes),
      graderDeclares: declaresIt(graderSrc),
    }).toEqual({
      shared: 1,
      hookImports: true,
      hookCallsInGateJoinedLabels: true,
      hookKeepsInlineKeyTest: false,
      hookDeclares: false,
      graderImports: true,
      graderCallsInGatedWrites: true,
      graderKeepsInlineKeyTest: false,
      graderDeclares: false,
    });
  });
});

describe("STE-655 AC-STE-655.9 — grader: a top-level format key changes nothing about a joined Epic's labels write", () => {
  for (const k of ["contentFormat", "responseContentFormat"] as const) {
    test(`CONTROL (AC-STE-655.9, ${k}) — unanswered forbidden join → ungated-write`, () => {
      const { b, w } = labelsJoinFixture("title", null);
      w.input[k] = "markdown";
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
    test(`CONTROL (AC-STE-655.9, ${k}) — allowed key join, labels that drop the listed label → ungated-write`, () => {
      const { b, w } = labelsJoinFixture("key", null, "S13", { write: (_listed, m) => [m] });
      w.input[k] = "markdown";
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
    test(`CONTROL (AC-STE-655.9, ${k}) — answered Join and the exact read-merge → not ungated-write`, () => {
      const { b, w } = labelsJoinFixture("title", null, "S13", { ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!) });
      w.input[k] = "markdown";
      expect(ungatedAt(grade(b), w.ref)).toBe(false);
    });
  }
});

describe("STE-655 AC-STE-655.10 — grader: another key under `fields` beside labels on a joined Epic is ungated-write", () => {
  test("AC-STE-655.10 — answered Join, the exact read-merge plus fields.summary, B owning the Epic by an FR binding → ungated-write (HEAD: not labels-only → owned by the binding → clean)", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      arrange: (bb, s, epic) => frBound(epic)(bb, s),
      ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!),
    });
    (w.input.fields as Record<string, unknown>).summary = "Renamed by B";
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("CONTROL (AC-STE-655.10) — the same write without fields.summary → not ungated-write", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      arrange: (bb, s, epic) => frBound(epic)(bb, s),
      ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!),
    });
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
});

describe("STE-655 AC-STE-655.10 hardening (review r0) — grader: a top-level `update` block beside labels on a joined Epic is ungated-write, as the hook refuses it", () => {
  test("AC-STE-655.10 — answered Join, the exact read-merge plus a top-level update block → ungated-write (the hook and grader read ONE envelope)", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      arrange: (bb, s, epic) => frBound(epic)(bb, s),
      ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!),
    });
    (w.input as Record<string, unknown>).update = { summary: [{ set: "Renamed by B" }] };
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
});

describe("STE-655 AC-STE-655.10 hardening (review r0) — grader: an update-only labels write on a joined Epic is ungated-write", () => {
  test("AC-STE-655.10 — answered Join, B owning the Epic, the write carries update.labels and no fields → ungated-write", () => {
    const { b, w } = labelsJoinFixture("title", null, "S13", {
      arrange: (bb, s, epic) => frBound(epic)(bb, s),
      ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!),
    });
    const input = w.input as Record<string, unknown>;
    const labels = (input.fields as { labels: unknown }).labels;
    delete input.fields;
    input.update = { labels: [{ set: labels }] };
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
});

describe("STE-655 AC-STE-655.11 — grader: labels plus other fields on an owned key no join names grades as at HEAD", () => {
  for (const t of TRACKERS) {
    test(`CONTROL (AC-STE-655.11, ${t}) — labels + a title/summary on the key S13 imported → not ungated-write; on a key it does not own → ungated-write`, () => {
      const b = buildPassingBundle(t);
      const s = session(b, "S13");
      const owned = intruderKey(b);
      const foreign = createdKeys(session(b, "S3"))[0]!;
      const edit = (key: string, tag: string) => {
        const w = appendTicketWrite(b, s, key, tag, "edit");
        if (t === "jira") w.input.fields = { labels: [TAG_B], summary: "renamed by B" };
        else Object.assign(w.input, { title: "renamed by B" });
        return w;
      };
      const mine = edit(owned, "655_11_owned");
      const theirs = t === "jira" ? edit(foreign, "655_11_foreign") : edit("STE-903", "655_11_foreign");
      const v = grade(b);
      expect({ owned: ungatedAt(v, mine.ref), foreign: ungatedAt(v, theirs.ref) }).toEqual({ owned: false, foreign: true });
    });
  }
});

describe("STE-655 AC-STE-655.12 — grader: across asks, the latest answer to the join governs", () => {
  const twoAsks = (first: 0 | 1, later: { question?: string; answer: 0 | 1 }) => {
    const { b, w } = labelsJoinFixture("title", null, "S13", { ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[first]!) });
    const s = session(b, "S13");
    const epic = String(w.input.issueIdOrKey);
    const labels = [`Join \`${epic}\``, `Skip \`${epic}\``];
    askBefore(s, w, later.question ?? joinQ655(epic, title("S3 span milestone")), labels, labels[later.answer]!, "12_later");
    return { b, w };
  };
  test("AC-STE-655.12 — Join in one ask, Skip in a later ask, both before the labels write → ungated-write (HEAD: any consenting ask → clean)", () => {
    const { b, w } = twoAsks(0, { answer: 1 });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("CONTROL (AC-STE-655.12) — Skip then Join → not ungated-write", () => {
    const { b, w } = twoAsks(1, { answer: 0 });
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("CONTROL (AC-STE-655.12) — Join, then a later ask whose question does not name the Epic (offering and answered Skip) → not ungated-write", () => {
    const { b, w } = twoAsks(0, { question: "Proceed with the milestone?", answer: 1 });
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("AC-STE-655.17 — mutant `first-consent-wins` (decisionAnswered) is killed by the AC-STE-655.12 leg: Join then Skip before the labels write → the mutant grades it clean", async () => {
    const { b, w } = twoAsks(0, { answer: 1 });
    expect(ungatedAt(grade(b), w.ref), "the shipped grader flags it (the AC-STE-655.12 leg)").toBe(true);
    await withGraderMutant655("first-wins", "if (verdict !== null) latest = verdict;", "if (verdict === true) return true;", "function decisionAnswered(", (g) => {
      expect(ungatedAt(gradeWith655(g, b), w.ref), "the mutant must grade it clean — the leg sees the mutation").toBe(false);
    });
  });
});

describe("STE-655 AC-STE-655.13 — grader: the latest answer governs Import / Adopt and container Create consent", () => {
  for (const t of TRACKERS) {
    /** S13's import consent re-asked: `answers` in order (each Import or Skip), then optionally an unrelated later ask, all before the consent run. */
    const importAsks = (answers: Array<"Import" | "Skip">, unrelated = false) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S13");
      const u = intruderKey(b);
      const ask = s.calls.find((c) => c.name === "AskUserQuestion")!;
      const q1 = String((ask.input.questions as Array<{ question: string }>)[0]!.question);
      const labels = [`Import ${u}`, `Skip ${u}`];
      const first = consentAsk(q1, labels, `${answers[0]} ${u}`);
      ask.input = first.input;
      ask.result = first.result;
      const announce = s.calls[s.calls.indexOf(ask) + 1]!;
      answers.slice(1).forEach((a, n) => askBefore(s, announce, q1, labels, `${a} ${u}`, `13_imp_${n}`));
      if (unrelated) askBefore(s, announce, "Proceed with the sync?", labels, `Skip ${u}`, "13_imp_unrelated");
      return b;
    };
    test(`${t}: AC-STE-655.13 (Import) — Import in one ask, Skip in a later ask → the import write is ungated-write (HEAD: any earlier consent)`, () => {
      const b = importAsks(["Import", "Skip"]);
      expect(ungatedAt(grade(b), importWrite(b).ref)).toBe(true);
    });
    test(`${t}: CONTROL (AC-STE-655.13, Import) — Skip then Import → not ungated-write; Import then an unrelated ask answered Skip → not ungated-write`, () => {
      const a = importAsks(["Skip", "Import"]);
      const c = importAsks(["Import"], true);
      expect({ skipThenImport: ungatedAt(grade(a), importWrite(a).ref), unrelated: ungatedAt(grade(c), importWrite(c).ref) }).toEqual({ skipThenImport: false, unrelated: false });
    });

    test(`${t}: AC-STE-655.13 hardening (review r0, Import) — Import, the consent receipt, THEN Skip before the write → the import write is ungated-write`, () => {
      const b = importAsks(["Import"]);
      const s = session(b, "S13");
      const u = intruderKey(b);
      const w = importWrite(b);
      const ask = s.calls.find((c) => c.name === "AskUserQuestion")!;
      const q1 = String((ask.input.questions as Array<{ question: string }>)[0]!.question);
      askBefore(s, w, q1, [`Import ${u}`, `Skip ${u}`], `Skip ${u}`, "13_imp_after_receipt");
      expect(ungatedAt(grade(b), importWrite(b).ref)).toBe(true);
    });

    const adoptAsks = (answers: Array<"Adopt" | "Skip">) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S13");
      const key = oldClientKey(b);
      const labels = [`Adopt ${key}`, `Skip ${key}`];
      answers.forEach((a, n) => {
        const ask = consentAsk(`Adopt ${key} into this repository?`, labels, `${a} ${key}`);
        appendCall(s, "AskUserQuestion", ask.input, ask.result, `655_adopt_${n}`);
      });
      appendAnnounced(b, s, "binding", moduleCommand("ticket_ownership.ts", "confirm", `<B> ${key} <B>/.dpt/tmp/ticket.json --adopt`), { subject: key, decision: "adopt" }, "655_adopt");
      return { b, w: appendTicketWrite(b, s, key, "655_adopt") };
    };
    test(`${t}: AC-STE-655.13 (Adopt) — Adopt in one ask, Skip in a later ask, then the adopt binding → the write is ungated-write (HEAD: any earlier consent)`, () => {
      const { b, w } = adoptAsks(["Adopt", "Skip"]);
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
    test(`${t}: CONTROL (AC-STE-655.13, Adopt) — Skip then Adopt → not ungated-write`, () => {
      const { b, w } = adoptAsks(["Skip", "Adopt"]);
      expect(ungatedAt(grade(b), w.ref)).toBe(false);
    });
  }

  /** S3's Linear mint with a capped re-list, and its Create consent asked `answers` in order before the create (AC-STE-650.13's shape). */
  const createAsks = (answers: Array<"Create" | "Skip">) => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S3");
    const decide = bashCall(s, /resolve_milestone_identity\.ts/);
    const name = String(announcedReceipt(b, decide).evidence.title);
    const create = createCallOf(s);
    for (const c of s.calls.filter((c, j) => j > s.calls.indexOf(decide) && j < s.calls.indexOf(create) && c.name.endsWith("list_milestones"))) c.result.lastPage = false;
    const labels = [`Create \`${name}\``, `Skip \`${name}\``];
    answers.forEach((a, n) => askBefore(s, create, `Create the milestone "${name}" in ${b.run.container}?`, labels, labels[a === "Create" ? 0 : 1]!, `13_create_${n}`));
    return { b, create };
  };
  test("linear: AC-STE-655.13 (container create) — Create in one ask, Skip in a later ask, a capped re-list → the create is ungated-write (HEAD: any answered ask)", () => {
    const { b, create } = createAsks(["Create", "Skip"]);
    expect(ungatedAt(grade(b), create.ref)).toBe(true);
  });
  test("linear: CONTROL (AC-STE-655.13, container create) — Skip then Create → not ungated-write", () => {
    const { b, create } = createAsks(["Skip", "Create"]);
    expect(ungatedAt(grade(b), create.ref)).toBe(false);
  });
});

describe("STE-655 AC-STE-655.14 — grader: a container create after a settled, lost or parallel create of it is a finding, as the hook refuses it", () => {
  const TIMEOUT: ToolCall["result"] = { isError: true, text: "Error: the request to the tracker timed out after 60 s", exitCode: null, items: null, lastPage: null };
  for (const t of TRACKERS) {
    const nameKey = t === "jira" ? "summary" : "name";
    /**
     * S3's container mint (decide, re-list, create) followed by a SECOND create,
     * backed by its own decision and a fresh complete re-list: of the same
     * container (`same`), or of another one. `mode` sets what the first create
     * became: settled (it returned its key), lost (it timed out) or parallel
     * (it timed out, and the second create shares its message).
     */
    const recreate = (mode: "settled" | "lost" | "parallel", same: boolean) => {
      const b = buildPassingBundle(t);
      const s = session(b, "S3");
      const decide = bashCall(s, /resolve_milestone_identity\.ts/);
      const r1 = announcedReceipt(b, decide);
      const create = createCallOf(s);
      const relist = s.calls[s.calls.indexOf(create) - 1]!;
      const name = String(r1.evidence.title);
      const second = same ? name : title("S3 a second span milestone");
      const command = String(decide.input.command).replace(name, second);
      /** A second decision for `second`, a clone of S3's own receipt, announced by a Bash call inserted at `index`. */
      const decideAgain = (index: number, tag: string): void => {
        const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/milestone-decision-655-${tag}.json`;
        const set = b.repos[s.root].receipts;
        if (!set.readable) throw new Error("fixture: receipts unreadable");
        set.records.push({ ...clone(r1), path, sha256: sha256(path), subject: second, evidence: { ...clone(r1.evidence), title: second } });
        insertCall(s, index, { ref: `${s.sessionId}:toolu_655_${tag}`, name: "Bash", input: { command, description: "run" }, result: { isError: false, text: `act=create\ndefault=allowed\ndpt-receipt: ${path} sha256:${sha256(path)}`, exitCode: 0, items: null, lastPage: null }, sidechain: false });
      };
      const item = { ...clone(create.result.items![0]!), key: t === "jira" ? `${b.run.container}-197` : "5f3a9c01-7d2e-4f00-9a00-000000000097", summary: second };
      const ok: ToolCall["result"] = { isError: false, text: "", exitCode: null, items: [item], lastPage: null };
      const input = { ...clone(create.input), [nameKey]: second };
      if (mode !== "settled") create.result = clone(TIMEOUT);
      if (mode === "parallel") {
        decideAgain(s.calls.indexOf(relist), "par");
        const dup: ToolCall = { ...clone(create), ref: `${create.ref}_parallel_655`, input, result: ok };
        s.calls.splice(s.calls.indexOf(create) + 1, 0, dup);
        return { b, dup };
      }
      // A later round: decide again, re-list again (complete, before the create), create again.
      decideAgain(s.calls.length, "again");
      s.calls.at(-1)!.at = new Date(Date.parse(s.calls.at(-2)!.at) + 1000).toISOString();
      appendCall(s, relist.name, clone(relist.input), clone(relist.result), "655_relist");
      const dup = appendCall(s, create.name, input, ok, "655_dup");
      return { b, dup };
    };
    for (const mode of ["settled", "lost", "parallel"] as const) {
      test(`${t}: AC-STE-655.14 (${mode}) — a second create of the same container, backed by its own decision and re-list → ungated-write (HEAD: the fresh decision permits it)`, () => {
        const { b, dup } = recreate(mode, true);
        expect(ungatedAt(grade(b), dup.ref)).toBe(true);
      });
      test(`${t}: CONTROL (AC-STE-655.14, ${mode}) — the same shape creating a DIFFERENT container → not ungated-write`, () => {
        const { b, dup } = recreate(mode, false);
        expect(ungatedAt(grade(b), dup.ref)).toBe(false);
      });
    }
    test(`${t}: AC-STE-655.17 — mutant \`no-container-prior-create\` (gatedWrites milestone-create) is killed by the AC-STE-655.14 leg (settled): a second create of the same container → the mutant grades it clean`, async () => {
      const { b, dup } = recreate("settled", true);
      expect(ungatedAt(grade(b), dup.ref), "the shipped grader flags it (the AC-STE-655.14 leg)").toBe(true);
      await withGraderMutant655("no-container-prior", "if (prior) why = `milestone-container create of", "if (false) why = `milestone-container create of", undefined, (g) => {
        expect(ungatedAt(gradeWith655(g, b), dup.ref), "the mutant must grade it clean — the leg sees the mutation").toBe(false);
      });
    });
  }
});

describe("STE-655 AC-STE-655.15 — grader: a createIssueLink carrying a comment needs every side owned", () => {
  const linkIn = (withComment: boolean, otherSide: "foreign" | "owned") => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S13");
    const mine = intruderKey(b);
    const other = otherSide === "foreign" ? createdKeys(session(b, "S3"))[0]! : `${b.run.container}-198`;
    if (otherSide === "owned") frBound(other)(b, s);
    const input = { cloudId: "cloud-dst", inwardIssue: mine, outwardIssue: other, type: "Relates", ...(withComment ? { comment: "Linked while splitting the payout export." } : {}) };
    const w = appendCall(s, `${serverPrefix("jira", s.root)}createIssueLink`, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null }, `655_link_${withComment}_${otherSide}`);
    return { b, w };
  };
  test("AC-STE-655.15 — a comment, one side S13's own, the other S3's Epic → ungated-write (HEAD: one owned side → clean)", () => {
    const { b, w } = linkIn(true, "foreign");
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("CONTROL (AC-STE-655.15) — the same link without the comment → not ungated-write; with the comment and both sides owned → not ungated-write", () => {
    const plain = linkIn(false, "foreign");
    const both = linkIn(true, "owned");
    expect({ plain: ungatedAt(grade(plain.b), plain.w.ref), bothOwned: ungatedAt(grade(both.b), both.w.ref) }).toEqual({ plain: false, bothOwned: false });
  });
  test("AC-STE-655.17 — mutant `link-needs-one-side` (linkNeedsEverySide → false) is killed by the AC-STE-655.15 leg: a comment, one side owned → the mutant grades it clean", async () => {
    const { b, w } = linkIn(true, "foreign");
    expect(ungatedAt(grade(b), w.ref), "the shipped grader flags it (the AC-STE-655.15 leg)").toBe(true);
    const decl = "export function linkNeedsEverySide(input: unknown): boolean {";
    await withOwnershipMutant655("link-one-side", decl, `${decl}\n  return false;`, (g) => {
      expect(ungatedAt(gradeWith655(g, b), w.ref), "the mutant must grade it clean — the leg sees the mutation").toBe(false);
    });
  });
});

describe("STE-655 AC-STE-655.16 — grader: Linear save_issue relation fields are link sides, and never stand in for the issue", () => {
  const update = (input: Record<string, unknown>, own: string[] = []) => {
    const b = buildPassingBundle("linear");
    const s = session(b, "S13");
    for (const k of own) frBound(k)(b, s);
    const w = appendCall(s, `${serverPrefix("linear", s.root)}save_issue`, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null }, `655_rel_${Object.keys(input).join("_")}`);
    return { b, w, mine: intruderKey(b) };
  };
  test("CONTROL (AC-STE-655.16) — an update of a sibling's issue whose every relation target is S13's own → ungated-write", () => {
    const probe = buildPassingBundle("linear");
    const mine = intruderKey(probe);
    const { b, w } = update({ id: "STE-903", relatedTo: [mine], blockedBy: [mine], blocks: [mine], duplicateOf: mine });
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  for (const [field, value] of [["relatedTo", ["OPS-5"]], ["blockedBy", ["OPS-5"]], ["blocks", ["OPS-5"]], ["duplicateOf", "OPS-5"]] as const) {
    test(`AC-STE-655.16 (${field}) — an update of S13's own issue whose ${field} target OPS-5 lies outside the bound team → ungated-write (HEAD: relation fields unread → clean)`, () => {
      const probe = buildPassingBundle("linear");
      const { b, w } = update({ id: intruderKey(probe), [field]: value });
      expect(ungatedAt(grade(b), w.ref)).toBe(true);
    });
  }
  test("AC-STE-655.16 hardening (review r0) — with no Linear team recorded for the run, a relation target cannot be shown in-team, so the update is ungated-write (fail closed, as the hook)", () => {
    const probe = buildPassingBundle("linear");
    const { b, w } = update({ id: intruderKey(probe), relatedTo: ["STE-904"] }, ["STE-904"]);
    delete (b.run as { linearTeam?: string }).linearTeam;
    expect(ungatedAt(grade(b), w.ref)).toBe(true);
  });
  test("CONTROL (AC-STE-655.16) — an update of S13's own issue relating only to another key it owns → not ungated-write", () => {
    const probe = buildPassingBundle("linear");
    const { b, w } = update({ id: intruderKey(probe), relatedTo: ["STE-904"] }, ["STE-904"]);
    expect(ungatedAt(grade(b), w.ref)).toBe(false);
  });
  test("AC-STE-655.17 — mutant `relation-targets-unread` (gatedWrites) is killed by the AC-STE-655.16 leg: S13's own issue relatedTo OPS-5 → the mutant grades it clean", async () => {
    const probe = buildPassingBundle("linear");
    const { b, w } = update({ id: intruderKey(probe), relatedTo: ["OPS-5"] });
    expect(ungatedAt(grade(b), w.ref), "the shipped grader flags it (the AC-STE-655.16 leg)").toBe(true);
    await withGraderMutant655("relations-unread", "const outsideTargets = relationTargets(bareTool(c.name), c.input)", "const outsideTargets = ([] as unknown[])", undefined, (g) => {
      expect(ungatedAt(gradeWith655(g, b), w.ref), "the mutant must grade it clean — the leg sees the mutation").toBe(false);
    });
  });
});

/**
 * STE-655 AC.17 — the [from, to) span of the declaration `decl` in `doc`, up to
 * its closing `\n}\n`; the whole document when `decl` is absent. Throws unless
 * `decl` occurs exactly once: an undetermined region must never read as a kill.
 */
function declRegion655(doc: string, decl?: string): [number, number] {
  if (decl === undefined) return [0, doc.length];
  const from = doc.indexOf(decl);
  if (from < 0 || doc.indexOf(decl, from + 1) >= 0) throw new Error(`mutation: \`${decl}\` does not occur exactly once`);
  const end = doc.indexOf("\n}\n", from);
  if (end < 0) throw new Error(`mutation: \`${decl}\` has no closing brace`);
  return [from, end + 3];
}

/** STE-655 AC.17 — run `f` with a grader copy whose own text has `find` → `repl`, sited inside `within`'s body when given. */
async function withGraderMutant655(name: string, find: string, repl: string, within: string | undefined, f: (g: GraderModule) => void): Promise<void> {
  await withTmpAsync(`ste655-${name}-`, async (dir) => {
    const { g } = await graderCopy(dir, name, (src) => {
      const [from, to] = declRegion655(src, within);
      return mutateInRegion(src, from, to, find, repl, { label: `shared_tracker_live_grader.ts${within ? ` · ${within}` : ""}` });
    });
    f(g);
  });
}

/** STE-655 AC.17 — run `f` with a grader copy importing a join_consent_ownership.ts in which `find` → `repl`. */
async function withOwnershipMutant655(name: string, find: string, repl: string, f: (g: GraderModule) => void): Promise<void> {
  await withTmpAsync(`ste655-${name}-`, async (dir) => {
    const doc = readFileSync(OWNERSHIP_SRC_655, "utf-8");
    const mutantFile = join(dir, "join_consent_ownership_mutant.ts");
    writeFileSync(mutantFile, mutateInRegion(doc, 0, doc.length, find, repl, { label: "join_consent_ownership.ts" }));
    const { g } = await graderCopy(dir, name, (src) => src.replace(/from "\.\/join_consent_ownership"/, `from ${JSON.stringify(mutantFile.replace(/\.ts$/, ""))}`));
    f(g);
  });
}

/** The mutant's verdict on `b`. */
const gradeWith655 = (g: GraderModule, b: LiveBundle): LiveVerdict => g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });

describe("STE-655 AC-STE-655.17 — the grader's labels-envelope test, mutated, is killed by a named leg", () => {
  test("AC-STE-655.17 — a labelsEnvelope that drops every extra field key turns the AC-STE-655.10 leg clean (killed)", async () => {
    await withTmpAsync("ste655-envelope-", async (dir) => {
      const doc = readFileSync(OWNERSHIP_SRC_655, "utf-8");
      const renamed = mutateInRegion(doc, 0, doc.length, ENVELOPE_DECL_655, "function labelsEnvelope__unmutated(", { label: "join_consent_ownership.ts" });
      const mutantFile = join(dir, "join_consent_ownership_mutant.ts");
      writeFileSync(
        mutantFile,
        `${renamed}\n// STE-655 mutant drops-extra-keys\nexport function labelsEnvelope(input: unknown): { extraKeys: string[] } | null {\n  const f = (input as { fields?: unknown } | null)?.fields;\n  return f !== null && typeof f === "object" && "labels" in (f as object) ? { extraKeys: [] } : null;\n}\n`,
      );
      const { g } = await graderCopy(dir, "envelope-mutant", (src) => src.replace(/from "\.\/join_consent_ownership"/, `from ${JSON.stringify(mutantFile.replace(/\.ts$/, ""))}`));
      const { b, w } = labelsJoinFixture("title", null, "S13", {
        arrange: (bb, s, epic) => frBound(epic)(bb, s),
        ask: (epic, spanTitle, labels) => consentAsk(joinQ655(epic, spanTitle), labels, labels[0]!),
      });
      (w.input.fields as Record<string, unknown>).summary = "Renamed by B";
      expect(ungatedAt(grade(b), w.ref), "the shipped grader flags it (the AC-STE-655.10 leg)").toBe(true);
      const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
      expect(ungatedAt(v, w.ref), "the mutant must grade it clean — the leg sees the mutation").toBe(false);
    });
  });
});

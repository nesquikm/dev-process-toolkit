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
// The hook's own lists, imported only to pin the grader's copies to them: the
// writer map (the drift guard in "a receipt counts as announced only by its
// writer") and the tracker-write tool set (the drift guard in "HARDENING 8").
import { RECEIPT_ANNOUNCING_MODULES, RECEIPT_WRITING_SUBCOMMANDS, TRACKER_WRITE_TOOLS } from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";
import {
  addToAudit,
  audits,
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
  materialize,
  type Materialized,
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
    // Bun 1.3.14's rmSync fails silently on a git-created .git; the system rm is reliable.
    spawnSyncCleanup("rm", ["-rf", d]);
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

for (const t of TRACKERS) {
  describe(`${t} — extraction from transcripts, receipts and git (round trip)`, () => {
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

  function copyTranscript(m: Materialized, from: string, newSid: string, cwd: string): void {
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
  test("S5 — a /ship-milestone that stopped at an earlier refusal, never running sibling_release.ts, is not-observed", () => {
    const b = buildPassingBundle("jira");
    const s = session(b, "S5");
    s.calls = s.calls.filter((c) => !/sibling_release\.ts/.test(String(c.input.command ?? "")));
    s.calls.push({ ...s.calls[0]!, ref: `${s.sessionId}:toolu_333`, name: "Bash", input: { command: "git -C <A> status --porcelain" }, result: { isError: true, text: "/ship-milestone: Refusing: the working tree is dirty.", exitCode: 1, items: null, lastPage: null } });
    const v = grade(b);
    expect(v.scenarios.S5?.outcome).toBe("not-observed");
    expect(v.outcome).toBe("fail");
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
      swapCalls(s, decide, decide + 1);
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
        if (secondDecision) {
          const r = announcedReceipt(b, decide);
          const path = r.path.replace(/\.json$/, "-2.json");
          const set = b.repos.A.receipts;
          if (set.readable) set.records.push({ ...clone(r), path, sha256: sha256(path) });
          appendCall(s, "Bash", { ...decide.input }, { ...decide.result, text: `decision=create\ndpt-receipt: ${path} sha256:${sha256(path)}` }, "decide2");
        }
        const item = { ...first.result.items![0]!, key: t === "jira" ? "DST-170" : "STE-970" };
        const second = appendCall(s, first.name, clone(first.input), { isError: false, text: "", exitCode: null, items: [item], lastPage: null }, "create2");
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
  test("a page whose paging is under pageInfo.hasNextPage is read: false is the last page, true is not", () => {
    const bb = buildPassingBundle("linear");
    const a1 = audits(bb)[0]!;
    const last = a1.calls.find((c) => c.result.lastPage === true && /__list_issues$/.test(c.name))!;
    const id = last.ref.split(":")[1]!;
    for (const [hasNext, outcome] of [[false, "pass"], [true, "abort"]] as const) {
      withTmp("ste617-h7f-", (d) => {
        const m = materialize(bb, d);
        editTranscript(m.transcripts[a1.sessionId]!, (r) => {
          for (const blk of Array.isArray(r.message?.content) ? r.message.content : []) {
            if (blk.type !== "tool_result" || blk.tool_use_id !== id) continue;
            const ans = JSON.parse(blk.content[0].text);
            for (const k of ["isLast", "hasNextPage", "nextPageToken", "cursor"]) delete ans[k];
            ans.pageInfo = { hasNextPage: hasNext };
            blk.content[0].text = JSON.stringify(ans);
          }
          return r;
        });
        expect({ hasNext, outcome: gradeExtracted(extractFor(m)).outcome }).toEqual({ hasNext, outcome });
      });
    }
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

describe("no skipped, todo or conditional test forms in this suite", () => {
  test("the suite's own source carries none", () => {
    const src = readFileSync(import.meta.path, "utf-8");
    const forms = ["test" + ".skip(", "test" + ".todo(", "test" + ".if(", "describe" + ".skip(", "it" + ".skip("];
    for (const f of forms) expect(src.includes(f), f).toBe(false);
  });
});

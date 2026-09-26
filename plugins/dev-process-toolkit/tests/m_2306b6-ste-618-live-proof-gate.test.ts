// STE-618 (M_2306b6) — the live-proof gate, SYNTHETIC suite.
//
// This suite grades synthetic plans and synthetic (unstamped) bundles through
// `adapters/_shared/src/live_proof_gate.ts`. The REAL-plan suite does not exist
// yet: it lands in one commit with the two live bundles, after the operator's
// live runs (STE-618 § What gets built item 5). Until then the real plan's
// Live proof rows read `pending`, the front door over it exits 1 naming
// `pending`, and the closing guard below stays quiet.
//
// THE CONTRACT THIS SUITE DEFINES (the implementer builds to it):
//
//   gradeLiveProof({ repoRoot, planPath }) → {
//     verdict: "pass" | "fail",
//     mode: "pre-release" | "post-release" | "stamp-without-release" | null,
//     reason?: string | null,          // plan-level code, e.g. plan-not-found
//     trackers: { jira: TrackerResult, linear: TrackerResult },
//   }
//   TrackerResult = { outcome: "pass" | "fail", reason: <bare code>, detail?: string }
//
//   `planPath` is repo-relative and spelled at the ACTIVE path
//   (`specs/plan/<M>.md`); the gate resolves it at that path or at
//   `specs/plan/archive/<M>.md`.
//
//   realPlanSuiteGuard({ repoRoot, fr, planPath, suitePath }) →
//     { ok: boolean, reason: "real-plan-suite-missing" | null, detail: string }
//
//   The bundle directory holds `bundle.json` (the grader's
//   `writeEvidenceBundle`) and `verdict.json` (the grader's verdict artifact —
//   the RECORDED outcome, and the recorded scenario id set as its `scenarios`
//   keys). The bundle is exactly those two files: the plan row's hash is the
//   grader's ONE exported `bundleHash(dir)` over them, and any other file in
//   the directory is ignored. A row's `Spaces` cell lists the keys the
//   bundle's items must carry: the Jira project keys every Jira item key
//   carries, or the Linear team key every Linear issue key carries.
//
//   Siblings (AC.10): for each property P the gate source carries exactly one
//   `@property-begin P` and one `@property-end P` marker, and between them
//   exactly one `= true;` — the switch. The sibling is the module with that
//   switch flipped to `= false;` (tests/_sited-mutation.ts), loaded from a
//   scratch copy whose relative imports point at the real source directory.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { behaviourDigest, gradeBundle, writeEvidenceBundle, type LiveBundle, type LiveVerdict } from "../adapters/_shared/src/shared_tracker_live_grader";
import { measurePlanSubsections, PLAN_NARRATIVE_WORD_CAP, scanPlanNarrativeAltitude } from "../adapters/_shared/src/scan_plan_narrative_altitude";
import { buildPassingBundle, breakScenario, NONCE, PLUGIN_VERSION, removeSessions, sessionsOf, type BuildOptions } from "./_live_bundle_fixtures";
import { mutateInRegion } from "./_sited-mutation";

// ---------------------------------------------------------------------------
// fixed places
// ---------------------------------------------------------------------------

const PLUGIN = realpathSync(join(import.meta.dir, ".."));
const REPO = realpathSync(join(PLUGIN, "..", ".."));
const SRC = join(PLUGIN, "adapters", "_shared", "src");
const GATE_PATH = join(SRC, "live_proof_gate.ts");
const GRADER_PATH = join(SRC, "shared_tracker_live_grader.ts");
const PLUGIN_REL = "plugins/dev-process-toolkit";
const BUNDLE_BASE = `${PLUGIN_REL}/tests/fixtures/shared-tracker-live`;
const VERDICT_FILE = "verdict.json";
const RUN_DATE = "2026-09-21";
const KICKOFF = "230148c9";
const REAL_PLAN = "specs/plan/M_2306b6.md";
const REAL_PLAN_SUITE = `${PLUGIN_REL}/tests/m_2306b6-ste-618-live-proof-real-plan.test.ts`;
const RELEASED = "2.99.0"; // the base repo's CHANGELOG carries this heading
const UNRELEASED = "2.98.0"; // ...and not this one
const RUN_VERSION = PLUGIN_VERSION; // the plugin version every synthetic bundle records at its run; the base CHANGELOG carries it too
const NEXT_RELEASE = "2.91.0"; // one release newer than RUN_VERSION; the base CHANGELOG carries it
const TRACKERS = ["jira", "linear"] as const;
type Tracker = (typeof TRACKERS)[number];

const PROPERTIES = [
  "regrade",
  "freshness",
  "tracked-only",
  "bundle-hash",
  "registry-set",
  "row-required",
  "stamp-release",
  "live-only",
  "jira-repoint",
] as const;

// ---------------------------------------------------------------------------
// scratch bookkeeping
// ---------------------------------------------------------------------------

const SCRATCH = mkdtempSync(join(realpathSync(tmpdir()), "ste618-gate-"));
afterAll(() => {
  spawnSync("rm", ["-rf", SCRATCH]);
});

let seq = 0;
const uniq = (p: string) => `${p}${(++seq).toString(36)}${randomBytes(3).toString("hex")}`;

function sh(cwd: string, cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} in ${cwd} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function git(cwd: string, args: string[]): string {
  return sh(cwd, "git", [
    "-c", "user.name=ste618",
    "-c", "user.email=ste618@example.invalid",
    "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false",
    ...args,
  ]);
}

/** rm -rf a directory Bun's rmSync may fail to remove (a git-created .git), and prove it is gone. */
function removeTree(p: string): void {
  spawnSync("rm", ["-rf", p]);
  if (existsSync(p)) throw new Error(`cleanup: ${p} survived rm -rf`);
}

// ---------------------------------------------------------------------------
// the base repository: the plugin tree (tests/ excluded) at HEAD, committed
// ---------------------------------------------------------------------------

interface Base {
  root: string;
  plugin: string;
  digest: { digest: string; files: Record<string, string> };
}

let baseMemo: Base | null = null;
function base(): Base {
  if (baseMemo) return baseMemo;
  const root = join(SCRATCH, "base");
  mkdirSync(root, { recursive: true });
  const tar = spawnSync("sh", ["-c", `git -C "${REPO}" archive HEAD -- ${PLUGIN_REL} ':(exclude)${PLUGIN_REL}/tests' | tar -x -C "${root}"`], { encoding: "utf-8" });
  if (tar.status !== 0) throw new Error(`base: archive failed: ${tar.stderr}`);
  writeFileSync(join(root, ".gitignore"), "node_modules/\n*.local-ignored\n");
  writeFileSync(
    join(root, "CHANGELOG.md"),
    `# Changelog\n\n${[RELEASED, NEXT_RELEASE, RUN_VERSION].map((v) => `## [${v}] — ${RUN_DATE} — "Synthetic"\n\n### Added\n\n- a synthetic release\n`).join("\n")}`,
  );
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "plan", "archive", ".keep"), "");
  writeFileSync(join(root, "specs", "frs", "archive", ".keep"), "");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: synthetic base"]);
  const plugin = join(root, PLUGIN_REL);
  const d = behaviourDigest(plugin);
  if (!d.ok) throw new Error(`base: digest unavailable: ${d.message}`);
  baseMemo = { root, plugin, digest: { digest: d.digest, files: d.files } };
  return baseMemo;
}

/** A full copy of the base repository (its .git included) in a unique scratch directory. */
function copyOfBase(): string {
  const b = base();
  const dir = join(SCRATCH, uniq("copy-"));
  cpSync(b.root, dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// the grader's ONE bundle-hash definition
// ---------------------------------------------------------------------------

async function bundleHashOf(dir: string): Promise<string> {
  const mod = (await import(GRADER_PATH)) as Record<string, unknown>;
  const f = mod.bundleHash;
  if (typeof f !== "function") {
    throw new Error("shared_tracker_live_grader.ts exports no bundleHash(dir) — the plan row's hash has no single definition");
  }
  return String((f as (d: string) => unknown)(dir));
}

// ---------------------------------------------------------------------------
// synthetic bundles and plans
// ---------------------------------------------------------------------------

function digestOver(files: Record<string, string>): string {
  const paths = Object.keys(files).sort();
  return createHash("sha256").update(paths.map((p) => `${files[p]}  ${p}\n`).join("")).digest("hex");
}

function recordedVerdictOf(b: LiveBundle): LiveVerdict {
  return gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
}

/** The registry ids that apply to a tracker now, as the grader grades them. */
function currentIds(t: Tracker): string[] {
  return Object.keys(recordedVerdictOf(buildPassingBundle(t) as unknown as LiveBundle).scenarios).sort();
}

interface Side {
  build?: BuildOptions;
  /** Applied to the bundle BEFORE the recorded verdict is taken. */
  before?: (b: LiveBundle) => void;
  /** Applied to the bundle AFTER the recorded verdict is taken (tampering). */
  after?: (b: LiveBundle) => void;
  verdict?: (v: LiveVerdict) => void;
  synthetic?: boolean;
  recordedDigest?: { digest: string; files: Record<string, string> };
  /** Applied to the bundle directory after its hash was taken. */
  afterHash?: (absDir: string) => void;
  row?: Partial<Row> | "pending" | "absent";
  /** Write no bundle directory at all. */
  noBundle?: boolean;
  /** Raw bundle.json bytes instead of a built bundle. */
  rawBundle?: string;
}

interface Row {
  tracker: string;
  bundle: string;
  date: string;
  nonce: string;
  spaces: string;
  hash: string;
}

interface Scenario {
  m: string;
  planPath: string;
  dirs: Record<Tracker, string>;
  rows: Record<Tracker, Row | null>;
}

interface SetupOptions {
  jira?: Side;
  linear?: Side;
  shippedIn?: string;
  where?: "active" | "archive" | "both" | "neither";
  section?: boolean;
  extraRows?: Row[];
}

function renderPlan(m: string, rows: Row[], o: { shippedIn?: string; section?: boolean }): string {
  const lines = [
    "---",
    `milestone: ${m}`,
    "status: active",
    "archived_at: null",
    `shipped_in: ${o.shippedIn ?? "null"}`,
    "---",
    "",
    "# Implementation Plan",
    "",
    `## ${m} — Synthetic {#${m}}`,
    "",
    "**Goal:** a synthetic plan for the live-proof gate suite.",
    "",
  ];
  if (o.section !== false) {
    lines.push(
      "### Live proof",
      "",
      "| Tracker | Bundle | Run date | Nonce | Spaces | Bundle hash |",
      "|---------|--------|----------|-------|--------|-------------|",
      ...rows.map((r) => `| ${r.tracker} | ${r.bundle} | ${r.date} | ${r.nonce} | ${r.spaces} | ${r.hash} |`),
      "",
    );
  }
  lines.push("### Out of scope", "", "Nothing.", "");
  return lines.join("\n");
}

async function setup(repoRoot: string, o: SetupOptions = {}): Promise<Scenario> {
  const m = uniq("M_s");
  const dirs = {} as Record<Tracker, string>;
  const rows = {} as Record<Tracker, Row | null>;
  const digest = base().digest;
  for (const t of TRACKERS) {
    const side: Side = o[t] ?? {};
    const rel = `${BUNDLE_BASE}/${t}-${RUN_DATE}-${NONCE}-${m.toLowerCase()}`;
    dirs[t] = rel;
    const abs = join(repoRoot, rel);
    if (!side.noBundle) {
      if (side.rawBundle !== undefined) {
        mkdirSync(abs, { recursive: true });
        writeFileSync(join(abs, "bundle.json"), side.rawBundle);
        writeFileSync(join(abs, VERDICT_FILE), "{}\n");
      } else {
        const b = buildPassingBundle(t, side.build ?? {}) as unknown as LiveBundle;
        b.synthetic = side.synthetic ?? false;
        const rd = side.recordedDigest ?? digest;
        b.run.behaviourDigest = { digest: rd.digest, files: { ...rd.files } };
        b.run.belowFloorDigest = rd.digest; // S6: the below-floor copy ran the tree under test
        side.before?.(b);
        const v = recordedVerdictOf(b);
        side.verdict?.(v);
        side.after?.(b);
        const w = writeEvidenceBundle(b, abs);
        if (!w.ok) throw new Error(`fixture: the synthetic bundle was refused for privacy: ${JSON.stringify(w.violations.slice(0, 3))}`);
        writeFileSync(join(abs, VERDICT_FILE), `${JSON.stringify(v, null, 2)}\n`);
      }
    }
    const hash = side.noBundle ? "a".repeat(64) : await bundleHashOf(abs);
    side.afterHash?.(abs);
    if (side.row === "absent") {
      rows[t] = null;
    } else if (side.row === "pending") {
      rows[t] = { tracker: t, bundle: "pending", date: "pending", nonce: "pending", spaces: "pending", hash: "pending" };
    } else {
      rows[t] = {
        tracker: t,
        bundle: rel,
        date: RUN_DATE,
        nonce: NONCE,
        spaces: t === "jira" ? "DST, DST2" : "STE",
        hash,
        ...(side.row ?? {}),
      };
    }
  }
  const text = renderPlan(m, [...TRACKERS.map((t) => rows[t]).filter((r): r is Row => r !== null), ...(o.extraRows ?? [])], o);
  const where = o.where ?? "active";
  if (where === "active" || where === "both") writeFileSync(join(repoRoot, "specs", "plan", `${m}.md`), text);
  if (where === "archive" || where === "both") writeFileSync(join(repoRoot, "specs", "plan", "archive", `${m}.md`), text);
  return { m, planPath: `specs/plan/${m}.md`, dirs, rows };
}

// ---------------------------------------------------------------------------
// loading the gate (shipped, control copy, siblings)
// ---------------------------------------------------------------------------

// biome-ignore lint: the result shape is the contract under test
type AnyResult = any;
interface Gate {
  gradeLiveProof: (o: { repoRoot: string; planPath?: string }) => AnyResult;
  realPlanSuiteGuard: (o: { repoRoot: string; fr: string; planPath: string; suitePath: string }) => AnyResult;
}

async function shippedGate(): Promise<Gate> {
  return (await import(GATE_PATH)) as Gate;
}

/** A copy of the gate module with `property`'s switch flipped (null = the unmutated control copy). */
async function siblingGate(property: string | null): Promise<Gate> {
  const src = readFileSync(GATE_PATH, "utf-8");
  let out = src;
  if (property !== null) {
    const open = `@property-begin ${property}`;
    const close = `@property-end ${property}`;
    const opens = src.split(open).length - 1;
    const closes = src.split(close).length - 1;
    if (opens !== 1 || closes !== 1) {
      throw new Error(`sibling ${property}: the gate carries ${opens} "${open}" and ${closes} "${close}" markers, not exactly one each`);
    }
    const from = src.indexOf(open);
    const to = src.indexOf(close);
    if (to <= from) throw new Error(`sibling ${property}: its end marker precedes its begin marker`);
    out = mutateInRegion(src, from, to, "= true;", "= false;", { label: `the ${property} property region` });
  }
  out = out.replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (_m, pre: string, q: string, spec: string) => `${pre}${q}${resolve(SRC, spec)}${q}`);
  const dir = join(SCRATCH, uniq(`sibling-${property ?? "control"}-`));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "live_proof_gate.ts");
  writeFileSync(file, out);
  return (await import(file)) as Gate;
}

async function grade(gate: Gate, repoRoot: string, planPath: string): Promise<AnyResult> {
  return await gate.gradeLiveProof({ repoRoot, planPath });
}

function codes(r: AnyResult): string[] {
  return [r?.reason, r?.trackers?.jira?.reason, r?.trackers?.linear?.reason].filter((x): x is string => typeof x === "string");
}

function frontDoor(repoRoot: string, planPath: string) {
  const r = spawnSync("bun", ["run", GATE_PATH, repoRoot, planPath], { cwd: PLUGIN, encoding: "utf-8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Does `text` name plugin path `p` (plugin-relative or repo-relative), as a whole path? */
function mentions(text: string, p: string): boolean {
  return new RegExp(`(?<![\\w./-])(?:${esc(PLUGIN_REL)}/)?${esc(p)}(?![\\w./-])`).test(text);
}

function trackedPluginFiles(repoRoot: string): string[] {
  return git(join(repoRoot, PLUGIN_REL), ["ls-files"]).split("\n").filter(Boolean);
}

function liveProofRows(planText: string): string[][] {
  const lines = planText.split("\n");
  const at = lines.findIndex((l) => /^###\s+Live proof\s*$/.test(l));
  if (at < 0) throw new Error("the plan has no ### Live proof section");
  const out: string[][] = [];
  for (let i = at + 1; i < lines.length && !/^#{1,3}\s/.test(lines[i]!); i++) {
    const l = lines[i]!.trim();
    if (!l.startsWith("|") || /^\|[\s|:-]+\|$/.test(l)) continue;
    out.push(l.slice(1, -1).split("|").map((c) => c.trim()));
  }
  return out; // header first
}

const T = 60_000;

/**
 * AC-STE-618.1's cap check: the plan's Live proof section is measured, and the
 * shipped narrative-cap scan (probe #67's) reports no `word_cap` row for it.
 * The scan, not a re-derivation from the measurement: a structural body is
 * graded per line there, so a table carrying one long prose line is a breach
 * that `kind === "structural"` alone would wave through.
 */
function liveProofCapBreaches(root: string, planRel: string): string[] {
  const measured = measurePlanSubsections(root).find((x) => x.file === planRel && x.section === "Live proof");
  if (measured === undefined) return [`${planRel}: no Live proof section was measured`];
  return scanPlanNarrativeAltitude(root)
    .filter((v) => v.file === planRel && v.section === "Live proof")
    .map((v) => `${v.file}:${v.line} ${v.rule} (${v.section})`);
}

// ===========================================================================
// AC-STE-618.1 — the table's shape (synthetic plan)
// ===========================================================================

describe("AC-STE-618.1 — the Live proof table", () => {
  test("a well-formed table at the ACTIVE path grades both trackers pass", async () => {
    const s = await setup(base().root);
    for (const t of TRACKERS) {
      const recorded = JSON.parse(readFileSync(join(base().root, s.dirs[t], VERDICT_FILE), "utf-8"));
      expect(recorded.outcome, `control: the ${t} fixture's recorded verdict is pass`).toBe("pass");
    }
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.outcome).toBe("pass");
    expect(r.trackers.linear.outcome).toBe("pass");
    expect(r.verdict).toBe("pass");
  }, T);

  test("the same plan found only at the ARCHIVE path is read there and grades pass", async () => {
    const s = await setup(base().root, { where: "archive" });
    expect(existsSync(join(base().root, s.planPath))).toBe(false);
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.verdict).toBe("pass");
    expect(r.trackers.jira.outcome).toBe("pass");
  }, T);

  const shapeBreaks: Array<[string, Partial<Row>]> = [
    ["a bundle path outside tests/fixtures/shared-tracker-live/", { bundle: `${PLUGIN_REL}/tests/elsewhere/jira-bundle` }],
    ["a run date not shaped 20YY-MM-DD", { date: "21-09-2026" }],
    ["a bundle hash that is not 64 hex", { hash: "b".repeat(63) }],
  ];
  for (const [what, row] of shapeBreaks) {
    test(`${what} fails that tracker; the other tracker stays pass`, async () => {
      const root = base().root;
      const s = await setup(root, { jira: { row } });
      if (row.bundle) {
        // the same bundle, copied to the out-of-place path, so only the location differs
        cpSync(join(root, s.dirs.jira), join(root, row.bundle), { recursive: true });
      }
      const r = await grade(await shippedGate(), root, s.planPath);
      expect(r.trackers.jira.outcome).toBe("fail");
      expect(r.trackers.linear.outcome).toBe("pass");
      expect(r.verdict).toBe("fail");
    }, T);
  }

  test("a second jira row is not exactly one row per tracker, and fails jira", async () => {
    const root = base().root;
    const probe = await setup(root);
    const s = await setup(root, { extraRows: [probe.rows.jira!] });
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.trackers.jira.outcome).toBe("fail");
    expect(r.verdict).toBe("fail");
  }, T);

  test("the section passes the plan narrative cap (synthetic and real plan)", async () => {
    const root = base().root;
    const s = await setup(root);
    expect(liveProofCapBreaches(root, s.planPath)).toEqual([]);
    expect(liveProofCapBreaches(REPO, REAL_PLAN)).toEqual([]);
  }, T);

  test("NEGATIVE CONTROL — a Live proof section that breaches the plan narrative cap fails the same check", async () => {
    const root = base().root;
    const prose = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    const s = await setup(root);
    const text = readFileSync(join(root, s.planPath), "utf-8");
    const at = text.indexOf("### Out of scope");
    expect(at, "control: the synthetic plan has a section after Live proof").toBeGreaterThan(0);
    // (a) the table plus one long prose line: the body still reads structural by share of items
    const smuggled = `${text.slice(0, at - 1)}${prose(PLAN_NARRATIVE_WORD_CAP + 40)}\n\n${text.slice(at)}`;
    // (b) prose paragraphs outnumbering the table's rows: a narrative body over the cap
    const narrative = `${text.slice(0, at - 1)}${[1, 2, 3, 4, 5].map(() => prose(40)).join("\n\n")}\n\n${text.slice(at)}`;
    for (const [what, body] of [["smuggled", smuggled], ["narrative", narrative]] as const) {
      const rel = `specs/plan/${uniq("M_cap")}.md`;
      writeFileSync(join(root, rel), body);
      expect(liveProofCapBreaches(root, rel), `${what}: the over-cap section is reported`).not.toEqual([]);
    }
  }, T);
});

// ===========================================================================
// AC-STE-618.2 — pass only on a passing re-grade; the front door
// ===========================================================================

describe("AC-STE-618.2 — re-grade and the front door", () => {
  test("a bundle that re-grades fail (recorded fail too) is not pass", async () => {
    const s = await setup(base().root, { jira: { before: (b) => void breakScenario(b as never, "S3") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.outcome).toBe("fail");
    expect(r.trackers.linear.outcome).toBe("pass");
    expect(r.verdict).toBe("fail");
  }, T);

  test("the front door exits 0 when both pass, one stdout line per tracker, naming the mode", async () => {
    const s = await setup(base().root);
    const out = frontDoor(base().root, s.planPath);
    expect(out.code, out.stderr).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines.filter((l) => /^jira\b/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^linear\b/.test(l))).toHaveLength(1);
    expect(lines.find((l) => /^jira\b/.test(l))).toMatch(/\bpass\b/);
    expect(lines.find((l) => /^linear\b/.test(l))).toMatch(/\bpass\b/);
    expect(out.stdout).toContain("mode=pre-release");
  }, T);

  test("the front door exits 1 when one tracker fails, refusing on stderr in the three-line NFR-10 shape", async () => {
    const s = await setup(base().root, { linear: { row: "pending" } });
    const out = frontDoor(base().root, s.planPath);
    expect(out.code).toBe(1);
    const lines = out.stdout.split("\n");
    expect(lines.filter((l) => /^jira\b/.test(l))).toHaveLength(1);
    expect(lines.find((l) => /^linear\b/.test(l))).toMatch(/\bpending\b/);
    const err = out.stderr.trim().split("\n");
    expect(err).toHaveLength(3);
    expect(err[1]).toMatch(/^Remedy: \S/);
    expect(err[2]).toMatch(/^Context: /);
  }, T);
});

// ===========================================================================
// AC-STE-618.3 — tampering and drift, each with its permit twin
// ===========================================================================

describe("AC-STE-618.3 — tampering and drift are named", () => {
  test("recorded pass, re-grade fail → recorded-verdict-disagrees", async () => {
    const s = await setup(base().root, { jira: { after: (b) => void breakScenario(b as never, "S3") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.outcome).toBe("fail");
    expect(r.trackers.jira.reason).toBe("recorded-verdict-disagrees");
    expect(r.trackers.linear.outcome).toBe("pass");
  }, T);

  test("a row nonce that differs from the bundle's → nonce-mismatch; the matching nonce is its twin", async () => {
    const bad = await setup(base().root, { linear: { row: { nonce: "zz9zz9" } } });
    const rb = await grade(await shippedGate(), base().root, bad.planPath);
    expect(rb.trackers.linear.reason).toBe("nonce-mismatch");
    expect(rb.trackers.linear.outcome).toBe("fail");
    const good = await setup(base().root, { linear: { row: { nonce: NONCE } } });
    expect((await grade(await shippedGate(), base().root, good.planPath)).trackers.linear.outcome).toBe("pass");
  }, T);

  test("one byte changed in a committed record → bundle-altered, naming the bundle", async () => {
    const alter = (abs: string) => {
      const p = join(abs, "bundle.json");
      const bytes = readFileSync(p, "utf-8");
      if (!bytes.endsWith("\n")) throw new Error("fixture: bundle.json does not end in a newline");
      writeFileSync(p, `${bytes.slice(0, -1)} `); // same length, one byte different, same JSON
    };
    const s = await setup(base().root, { jira: { afterHash: alter } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("bundle-altered");
    expect(JSON.stringify(r.trackers.jira)).toContain(s.dirs.jira.split("/").pop()!);
    expect(r.trackers.linear.outcome).toBe("pass");
  }, T);

  test("pre-release: a recorded id set unlike the registry's → registry-changed, naming the ids added and removed", async () => {
    const edit = (v: LiveVerdict) => {
      delete v.scenarios.S16;
      v.scenarios.S99 = { outcome: "pass", refs: [] };
    };
    const s = await setup(base().root, { linear: { verdict: edit } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("pre-release");
    expect(r.trackers.linear.reason).toBe("registry-changed");
    const named = JSON.stringify(r.trackers.linear);
    expect(named).toMatch(/\bS16\b/);
    expect(named).toMatch(/\bS99\b/);
    expect(r.trackers.jira.outcome).toBe("pass");
  }, T);

  test("post-release: the same drift is graded on its recorded set and stays green", async () => {
    // S16 is "a scenario added after the run": the bundle has no S16 sessions and its recorded set lacks S16.
    const dropS16 = (b: LiveBundle) => removeSessions(b as never, sessionsOf(b as never, "S16").map((x) => x.sessionId));
    const noS16 = (v: LiveVerdict) => {
      delete v.scenarios.S16;
      v.outcome = "pass";
    };
    const pre = await setup(base().root, { jira: { before: dropS16, verdict: noS16 } });
    const rp = await grade(await shippedGate(), base().root, pre.planPath);
    expect(rp.trackers.jira.reason).toBe("registry-changed");
    const post = await setup(base().root, { shippedIn: `v${RELEASED}`, jira: { before: dropS16, verdict: noS16 } });
    const r = await grade(await shippedGate(), base().root, post.planPath);
    expect(r.mode).toBe("post-release");
    expect(r.trackers.jira.outcome).toBe("pass");
    expect(r.verdict).toBe("pass");
  }, T);

  test("a synthetic-stamped bundle → not-live; the unstamped twin passes", async () => {
    const s = await setup(base().root, { linear: { synthetic: true } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("not-live");
    const twin = await setup(base().root, { linear: { synthetic: false } });
    expect((await grade(await shippedGate(), base().root, twin.planPath)).trackers.linear.outcome).toBe("pass");
  }, T);

  test("a Jira item key outside the row's spaces → not-live; the row naming both spaces is the twin", async () => {
    const s = await setup(base().root, { jira: { row: { spaces: "DST" } } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("not-live");
    const twin = await setup(base().root, { jira: { row: { spaces: "DST, DST2" } } });
    expect((await grade(await shippedGate(), base().root, twin.planPath)).trackers.jira.outcome).toBe("pass");
  }, T);
});

// ===========================================================================
// AC-STE-618.4 — the Jira repoint is proven
// ===========================================================================

describe("AC-STE-618.4 — the Jira repoint", () => {
  test("S8 recorded as the repoint-space-not-given skip → jira-repoint-not-proven, though the recorded verdict is pass", async () => {
    const s = await setup(base().root, { jira: { build: { jiraRepointFrom: null } } });
    const recorded = JSON.parse(readFileSync(join(base().root, s.dirs.jira, VERDICT_FILE), "utf-8"));
    expect(recorded.outcome, "control: every other scenario passes and the recorded verdict is pass").toBe("pass");
    expect(recorded.scenarios.S8.reason).toBe("repoint-space-not-given");
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("jira-repoint-not-proven");
    expect(r.trackers.linear.outcome).toBe("pass");
  }, T);

  test("a Jira bundle carrying no S8 record → jira-repoint-not-proven (post-release, graded on its recorded set)", async () => {
    const noS8 = (b: LiveBundle) => {
      b.run.skips = [];
    };
    const drop = (v: LiveVerdict) => {
      delete v.scenarios.S8;
      v.outcome = "pass";
    };
    const s = await setup(base().root, { shippedIn: `v${RELEASED}`, jira: { build: { jiraRepointFrom: null }, before: noS8, verdict: drop } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("post-release");
    expect(r.trackers.jira.reason).toBe("jira-repoint-not-proven");
  }, T);

  test("the same Jira bundle with S8 passing is the permit twin", async () => {
    const s = await setup(base().root, { jira: { build: { jiraRepointFrom: "DST2" } } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.outcome).toBe("pass");
  }, T);

  test("a Linear bundle is never asked for S8", async () => {
    const drop = (v: LiveVerdict) => {
      delete v.scenarios.S8;
    };
    const s = await setup(base().root, { shippedIn: `v${RELEASED}`, linear: { verdict: drop } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.outcome).toBe("pass");
  }, T);
});

// ===========================================================================
// AC-STE-618.5 — freshness
// ===========================================================================

describe("AC-STE-618.5 — freshness", () => {
  const CHANGED = "adapters/_shared/src/dpt_paths.ts";
  const ADDED = "adapters/_shared/src/smoke_verdict.ts";
  const REMOVED = "adapters/_shared/src/zz-removed-since-the-run.ts";

  function staleRecord(): { digest: string; files: Record<string, string> } {
    const files = { ...base().digest.files };
    if (!(CHANGED in files) || !(ADDED in files)) throw new Error("fixture: the named tracked files are not in the digest");
    files[CHANGED] = "0".repeat(64);
    delete files[ADDED];
    files[REMOVED] = "1".repeat(64);
    return { digest: digestOver(files), files };
  }

  test("a recorded digest unlike the tree's → stale-proof naming each added, removed and changed path, and no other", async () => {
    const rec = staleRecord();
    const s = await setup(base().root, { jira: { recordedDigest: rec }, linear: { recordedDigest: rec } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("pre-release");
    const tracked = trackedPluginFiles(base().root);
    for (const t of TRACKERS) {
      expect(r.trackers[t].reason).toBe("stale-proof");
      const text = JSON.stringify(r.trackers[t]);
      expect(mentions(text, CHANGED)).toBe(true);
      expect(mentions(text, ADDED)).toBe(true);
      expect(mentions(text, REMOVED)).toBe(true);
      expect(tracked.filter((p) => p !== CHANGED && p !== ADDED && mentions(text, p))).toEqual([]);
    }
  }, T);

  test("editing one tracked file under adapters/ turns a passing gate red naming exactly that file", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    expect((await grade(await shippedGate(), root, s.planPath)).verdict, "control: green before the edit").toBe("pass");
    const p = join(root, PLUGIN_REL, CHANGED);
    writeFileSync(p, `${readFileSync(p, "utf-8")}\n// edited after the run\n`);
    const r = await grade(await shippedGate(), root, s.planPath);
    const tracked = trackedPluginFiles(root);
    for (const t of TRACKERS) {
      expect(r.trackers[t].reason).toBe("stale-proof");
      const text = JSON.stringify(r.trackers[t]);
      expect(mentions(text, CHANGED)).toBe(true);
      expect(tracked.filter((x) => x !== CHANGED && mentions(text, x))).toEqual([]);
    }
    removeTree(root);
  }, T);

  test("editing the tool inventory the grader classifies tools by turns it red naming that file (measured)", async () => {
    const INV = "adapters/_shared/data/tracker-tool-inventory.json";
    const root = copyOfBase();
    const s = await setup(root);
    expect((await grade(await shippedGate(), root, s.planPath)).verdict, "control: green before the edit").toBe("pass");
    const p = join(root, PLUGIN_REL, INV);
    writeFileSync(p, `${readFileSync(p, "utf-8")}\n`); // whitespace only: the classification is unchanged, the bytes are not
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.trackers.jira.reason).toBe("stale-proof");
    expect(mentions(JSON.stringify(r.trackers.jira), INV)).toBe(true);
    removeTree(root);
  }, T);

  test("editing only plugin.json's version stays green; editing any other plugin.json field turns it red", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    const p = join(root, PLUGIN_REL, ".claude-plugin", "plugin.json");
    const orig = readFileSync(p, "utf-8");
    const bumped = orig.replace(/("version"\s*:\s*)"[^"]*"/, '$1"9.9.9"');
    expect(bumped, "control: the version edit applied").not.toBe(orig);
    writeFileSync(p, bumped);
    expect((await grade(await shippedGate(), root, s.planPath)).verdict).toBe("pass");
    const described = orig.replace(/("description"\s*:\s*")/, "$1Edited. ");
    expect(described, "control: the description edit applied").not.toBe(orig);
    writeFileSync(p, described);
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.trackers.linear.reason).toBe("stale-proof");
    expect(mentions(JSON.stringify(r.trackers.linear), ".claude-plugin/plugin.json")).toBe(true);
    removeTree(root);
  }, T);

  test("an untracked file and an ignored file leave it green", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    const plugin = join(root, PLUGIN_REL);
    writeFileSync(join(plugin, "adapters", "_shared", "src", "zz-untracked.ts"), "export const x = 1;\n");
    writeFileSync(join(plugin, "adapters", "zz.local-ignored"), "ignored\n");
    expect(git(root, ["status", "--porcelain", "--untracked-files=all"]), "control: the file is untracked").toContain("zz-untracked.ts");
    expect(git(root, ["check-ignore", `${PLUGIN_REL}/adapters/zz.local-ignored`]).trim(), "control: the file is ignored").toBe(`${PLUGIN_REL}/adapters/zz.local-ignored`);
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.verdict).toBe("pass");
    removeTree(root);
  }, T);

  test("a second worktree of the same commit computes the same digest and passes there too", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "test: the plan and its bundles"]);
    const beside = join(dirname(REPO), uniq("dpt-ste618-worktree-"));
    try {
      git(root, ["worktree", "add", "-q", "--detach", beside, "HEAD"]);
      const here = behaviourDigest(join(root, PLUGIN_REL));
      const there = behaviourDigest(join(beside, PLUGIN_REL));
      expect(here.ok && there.ok).toBe(true);
      expect(there.ok ? there.digest : "").toBe(here.ok ? here.digest : "x");
      const r = await grade(await shippedGate(), realpathSync(beside), s.planPath);
      expect(r.verdict).toBe("pass");
      expect(r.mode).toBe("pre-release");
    } finally {
      spawnSync("git", ["-C", root, "worktree", "remove", "--force", beside]);
      removeTree(beside);
    }
    expect(existsSync(beside)).toBe(false);
    removeTree(root);
  }, T);

  test("NEGATIVE CONTROL — a second worktree of a DIFFERENT commit computes a different digest and reds stale-proof there", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "test: the plan and its bundles"]);
    const beside = join(dirname(REPO), uniq("dpt-ste618-worktree-other-"));
    try {
      git(root, ["worktree", "add", "-q", "--detach", beside, "HEAD"]);
      const p = join(beside, PLUGIN_REL, CHANGED);
      writeFileSync(p, `${readFileSync(p, "utf-8")}\n// a later commit\n`);
      git(beside, ["commit", "-q", "-am", "test: a later commit"]);
      expect(git(beside, ["rev-parse", "HEAD"]), "control: the worktree sits on another commit").not.toBe(git(root, ["rev-parse", "HEAD"]));
      const here = behaviourDigest(join(root, PLUGIN_REL));
      const there = behaviourDigest(join(beside, PLUGIN_REL));
      expect(here.ok && there.ok).toBe(true);
      expect(there.ok ? there.digest : "").not.toBe(here.ok ? here.digest : "");
      expect((await grade(await shippedGate(), root, s.planPath)).verdict, "the positive case stays: the run's own commit passes").toBe("pass");
      const r = await grade(await shippedGate(), realpathSync(beside), s.planPath);
      const tracked = trackedPluginFiles(beside);
      for (const t of TRACKERS) {
        expect(r.trackers[t].reason).toBe("stale-proof");
        const text = JSON.stringify(r.trackers[t]);
        expect(mentions(text, CHANGED)).toBe(true);
        expect(tracked.filter((x) => x !== CHANGED && mentions(text, x))).toEqual([]);
      }
    } finally {
      spawnSync("git", ["-C", root, "worktree", "remove", "--force", beside]);
      removeTree(beside);
    }
    expect(existsSync(beside)).toBe(false);
    removeTree(root);
  }, T);

  test("a root that is not a git checkout reds digest-unavailable, never a pass", async () => {
    const root = copyOfBase();
    const s = await setup(root);
    removeTree(join(root, ".git"));
    expect(existsSync(join(root, ".git"))).toBe(false);
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("digest-unavailable");
    removeTree(root);
  }, T);

  test("post-release (shipped_in stamped, CHANGELOG heading present) does not assert freshness, and prints its name", async () => {
    const rec = staleRecord();
    const s = await setup(base().root, { shippedIn: `v${RELEASED}`, jira: { recordedDigest: rec }, linear: { recordedDigest: rec } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("post-release");
    expect(r.verdict).toBe("pass");
    const out = frontDoor(base().root, s.planPath);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("mode=post-release");
  }, T);

  test("a stamp with no CHANGELOG release heading reds stamp-without-release", async () => {
    const rec = staleRecord();
    const s = await setup(base().root, { shippedIn: `v${UNRELEASED}`, jira: { recordedDigest: rec }, linear: { recordedDigest: rec } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("stamp-without-release");
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("stamp-without-release");
  }, T);
});

// ===========================================================================
// AC-STE-618.6 — every failure is named, none skipped
// ===========================================================================

describe("AC-STE-618.6 — named failures", () => {
  test("no section → no-live-proof-section", async () => {
    const s = await setup(base().root, { section: false });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("no-live-proof-section");
  }, T);

  test("a tracker without a row → missing-tracker:<tracker>", async () => {
    const s = await setup(base().root, { linear: { row: "absent" } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("missing-tracker:linear");
    expect(r.trackers.jira.outcome).toBe("pass");
    expect(r.verdict).toBe("fail");
  }, T);

  test("a row reading pending → pending", async () => {
    const s = await setup(base().root, { jira: { row: "pending" } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("pending");
    expect(r.trackers.jira.outcome).toBe("fail");
  }, T);

  test("an absent bundle path → bundle-unreadable naming the path", async () => {
    const s = await setup(base().root, { linear: { noBundle: true } });
    expect(existsSync(join(base().root, s.dirs.linear))).toBe(false);
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("bundle-unreadable");
    expect(JSON.stringify(r.trackers.linear)).toContain(s.dirs.linear.split("/").pop()!);
  }, T);

  test("an unparseable bundle → bundle-malformed", async () => {
    const s = await setup(base().root, { jira: { rawBundle: "{ this is not json\n" } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("bundle-malformed");
  }, T);

  test("a bundle holding zero scenario records → bundle-empty", async () => {
    const empty = (b: LiveBundle) => {
      b.sessions = [];
      b.ledger = [];
    };
    const none = (v: LiveVerdict) => {
      v.scenarios = {};
    };
    const s = await setup(base().root, { jira: { before: empty, verdict: none } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("bundle-empty");
  }, T);

  test("a plan at neither path → plan-not-found naming both", async () => {
    const s = await setup(base().root, { where: "neither" });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("plan-not-found");
    const text = JSON.stringify(r);
    expect(text).toContain(`specs/plan/${s.m}.md`);
    expect(text).toContain(`specs/plan/archive/${s.m}.md`);
  }, T);

  test("a plan at both paths → plan-ambiguous naming both, never picks one", async () => {
    const s = await setup(base().root, { where: "both" });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("plan-ambiguous");
    expect(r.trackers?.jira?.outcome).not.toBe("pass");
    expect(r.trackers?.linear?.outcome).not.toBe("pass");
    const text = JSON.stringify(r);
    expect(text).toContain(`specs/plan/${s.m}.md`);
    expect(text).toContain(`specs/plan/archive/${s.m}.md`);
  }, T);

  test("this suite carries no skip, todo, conditional test or early return", () => {
    expect(bannedTestForms(readFileSync(import.meta.path, "utf-8"))).toEqual([]);
  });

  test("NEGATIVE CONTROL — a scratch copy of this suite with a planted skip, conditional test or early return is caught by the same scan", () => {
    const own = readFileSync(import.meta.path, "utf-8");
    const anchor = "describe(\"AC-STE-618.6 — named failures\", () => {\n";
    expect(own.includes(anchor), "control: the plant's anchor is found").toBe(true);
    const plants: Array<[string, string]> = [
      ["a skipped test", `  test.sk${"ip"}("planted", () => {});\n`],
      ["a conditional test", `  test${".if"}(false)("planted", () => {});\n`],
      ["an early return", `  test("planted", () => {\n    if (existsSync("/")) ret${"urn"};\n  });\n`],
    ];
    for (const [what, plant] of plants) {
      const copy = join(SCRATCH, `${uniq("suite-copy-")}.test.ts`);
      writeFileSync(copy, own.replace(anchor, `${anchor}${plant}`));
      expect(bannedTestForms(readFileSync(copy, "utf-8")), `${what} is caught`).not.toEqual([]);
    }
  });
});

// ===========================================================================
// AC-STE-618.7 — one behaviourDigest (and one bundleHash)
// ===========================================================================

/** AC-STE-618.6: every skip, todo, conditional test form and early return in a suite's text. */
function bannedTestForms(text: string): string[] {
  const banned = [".sk" + "ip(", ".to" + "do(", "test" + ".if(", "skip" + "If(", "todo" + "If(", "describe" + ".if("];
  const hits = banned.filter((b) => text.includes(b));
  if (new RegExp("\\)\\s*ret" + "urn\\s*;").test(text)) hits.push("early return");
  return hits;
}

function definitionsOf(dir: string, name: string): string[] {
  const re = new RegExp(`(?:\\bfunction\\s*\\*?\\s*${name}\\s*[(<]|\\b(?:const|let|var)\\s+${name}\\s*[:=])`);
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) {
        readFileSync(p, "utf-8").split("\n").forEach((l, i) => {
          if (re.test(l)) hits.push(`${relative(dir, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(dir);
  return hits;
}

function expectOneDefinitionInGrader(dir: string, name: string): void {
  const hits = definitionsOf(dir, name);
  if (hits.length !== 1 || !hits[0]!.startsWith("shared_tracker_live_grader.ts:")) {
    throw new Error(`${name} must have exactly one definition, in shared_tracker_live_grader.ts; found ${JSON.stringify(hits)}`);
  }
}

describe("AC-STE-618.7 — one definition each", () => {
  test("behaviourDigest is defined once across adapters/_shared/src, in the grader, and the gate imports it", () => {
    expectOneDefinitionInGrader(SRC, "behaviourDigest");
    const gate = readFileSync(GATE_PATH, "utf-8");
    expect(gate).toMatch(/import\s*\{[^}]*\bbehaviourDigest\b[^}]*\}\s*from\s*["']\.\/shared_tracker_live_grader(?:\.ts)?["']/);
  });

  test("the gate re-grades through the grader's gradeBundle and hashes through its one bundleHash", () => {
    expectOneDefinitionInGrader(SRC, "bundleHash");
    const gate = readFileSync(GATE_PATH, "utf-8");
    expect(gate).toMatch(/import\s*\{[^}]*\bgradeBundle\b[^}]*\}\s*from\s*["']\.\/shared_tracker_live_grader(?:\.ts)?["']/);
    expect(gate).toMatch(/import\s*\{[^}]*\bbundleHash\b[^}]*\}\s*from\s*["']\.\/shared_tracker_live_grader(?:\.ts)?["']/);
  });

  test("a planted second behaviourDigest fails the meta-test", () => {
    const copy = join(SCRATCH, uniq("src-copy-"));
    cpSync(SRC, copy, { recursive: true });
    expect(() => expectOneDefinitionInGrader(copy, "behaviourDigest"), "control: the unplanted copy holds one").not.toThrow();
    writeFileSync(join(copy, "zz_planted.ts"), "export function behaviourDigest(root: string) {\n  return root;\n}\n");
    expect(definitionsOf(copy, "behaviourDigest")).toHaveLength(2);
    expect(() => expectOneDefinitionInGrader(copy, "behaviourDigest")).toThrow(/exactly one definition/);
    removeTree(copy);
  });

  test("bundleHash is 64 hex, independent of file creation order, and moves on one changed byte", async () => {
    const a = join(SCRATCH, uniq("hash-a-"));
    const b = join(SCRATCH, uniq("hash-b-"));
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "bundle.json"), "{\"x\":1}\n");
    writeFileSync(join(a, VERDICT_FILE), "{\"y\":2}\n");
    writeFileSync(join(b, VERDICT_FILE), "{\"y\":2}\n");
    writeFileSync(join(b, "bundle.json"), "{\"x\":1}\n");
    const ha = await bundleHashOf(a);
    expect(ha).toMatch(/^[0-9a-f]{64}$/);
    expect(await bundleHashOf(b)).toBe(ha);
    writeFileSync(join(b, "bundle.json"), "{\"x\":2}\n");
    expect(await bundleHashOf(b)).not.toBe(ha);
  });
});

// ===========================================================================
// AC-STE-618.8 — the closing guard and byte-identity
// ===========================================================================

describe("AC-STE-618.8 — the closing guard", () => {
  async function arrangement(o: { archived: boolean; filled: boolean; suite: boolean }) {
    const root = base().root;
    const fr = uniq("STE-9");
    const frText = `---\ntitle: synthetic\nstatus: active\n---\n\n# synthetic\n`;
    writeFileSync(join(root, "specs", "frs", o.archived ? "archive" : "", `${fr}.md`), frText);
    const s = await setup(root, o.filled ? { linear: { row: "pending" } } : { jira: { row: "pending" }, linear: { row: "pending" } });
    const suite = `${PLUGIN_REL}/tests/${uniq("real-plan-")}.test.ts`;
    if (o.suite) {
      mkdirSync(dirname(join(root, suite)), { recursive: true });
      writeFileSync(join(root, suite), "// the real-plan suite\n");
    }
    const gate = await shippedGate();
    return await gate.realPlanSuiteGuard({ repoRoot: root, fr, planPath: s.planPath, suitePath: suite });
  }

  test("FR active, both rows pending, no real-plan suite → quiet", async () => {
    const r = await arrangement({ archived: false, filled: false, suite: false });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  }, T);

  test("FR archived, no real-plan suite → real-plan-suite-missing; with the suite → quiet", async () => {
    const miss = await arrangement({ archived: true, filled: false, suite: false });
    expect(miss.ok).toBe(false);
    expect(miss.reason).toBe("real-plan-suite-missing");
    const ok = await arrangement({ archived: true, filled: false, suite: true });
    expect(ok.ok).toBe(true);
  }, T);

  test("a row reading other than pending, no real-plan suite → real-plan-suite-missing; with the suite → quiet", async () => {
    const miss = await arrangement({ archived: false, filled: true, suite: false });
    expect(miss.ok).toBe(false);
    expect(miss.reason).toBe("real-plan-suite-missing");
    const ok = await arrangement({ archived: false, filled: true, suite: true });
    expect(ok.ok).toBe(true);
  }, T);

  // Until the second leg's evidence commit this test pinned the pre-proof state
  // ("the rows read pending, the guard is quiet"). That commit filled both rows
  // and landed the real-plan suite together, so the guard's trigger has fired
  // and it is satisfied by the suite existing — the state this now pins.
  test("AFTER THE LIVE PROOF: the real plan's rows are filled, the guard's trigger has fired, and the real-plan suite satisfies it", async () => {
    const rows = liveProofRows(readFileSync(join(REPO, REAL_PLAN), "utf-8"));
    const [header, ...body] = rows;
    expect(header![0]).toBe("Tracker");
    expect(body.map((r) => r[0]).sort()).toEqual(["jira", "linear"]);
    for (const r of body) expect(r.slice(1).some((c) => c === "pending"), `row ${r[0]} reads no pending cell`).toBe(false);
    expect(existsSync(join(REPO, REAL_PLAN_SUITE)), "the real-plan suite exists").toBe(true);
    const gate = await shippedGate();
    const g = await gate.realPlanSuiteGuard({ repoRoot: REPO, fr: "STE-618", planPath: REAL_PLAN, suitePath: REAL_PLAN_SUITE });
    expect(g.ok).toBe(true);
    expect(g.reason).toBeNull();
    expect(g.detail).toMatch(/reads other than pending/);
    const missing = await gate.realPlanSuiteGuard({ repoRoot: REPO, fr: "STE-618", planPath: REAL_PLAN, suitePath: `${PLUGIN_REL}/tests/no-such-real-plan-suite.test.ts` });
    expect(missing.ok, "CONTROL: the same guard without the suite refuses").toBe(false);
    expect(missing.reason).toBe("real-plan-suite-missing");
  }, T);
});

describe("AC-STE-618.8 — byte-identity with the kickoff", () => {
  const kickoff = (rel: string) => sh(REPO, "git", ["show", `${KICKOFF}:${rel}`]);
  const SHIP = `${PLUGIN_REL}/skills/ship-milestone/SKILL.md`;
  const GATE_CHECK = `${PLUGIN_REL}/skills/gate-check/SKILL.md`;
  const PERMITTED_LINE = 128;

  /** The guard: same line count, and every differing line is a permitted one. */
  function driftBeyond(before: string, after: string, permitted: readonly number[]): string[] {
    const a = before.split("\n");
    const b = after.split("\n");
    if (a.length !== b.length) return [`line count ${a.length} → ${b.length}`];
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !permitted.includes(i + 1)) out.push(`line ${i + 1}`);
    return out;
  }

  /** The byte-identity guard: nothing differs; a difference names its lines. */
  function byteDrift(before: string, after: string): string[] {
    if (before === after) return [];
    const lines = driftBeyond(before, after, []);
    return lines.length > 0 ? lines : ["bytes differ"];
  }

  // The ship-milestone SKILL's ONE permitted line: a CLOSED, ENUMERATED entry,
  // never a criterion. Line 91 told a model to chain Linear listing pages with
  // `endCursor` until `hasNextPage` — Linear has never sent `endCursor` (measured
  // 2026-09-21: list_issues answers `{issues, hasNextPage, cursor?}`, pinned in
  // tests/fixtures/live-shapes/linear/list_issues.more.json), so a child
  // following it records a cursor from a field that does not exist and the
  // sibling check refuses the chain. It was false before this milestone; this
  // milestone found it. Correcting a paging field adds no probe and no refusal
  // to the ceremony. A third permitted line anywhere needs a fresh ruling.
  const SHIP_PERMITTED_LINE = 91;

  test("skills/ship-milestone/SKILL.md differs from the kickoff only on line 91, the sibling listing's paging instruction, rewritten in place", () => {
    const now = readFileSync(join(REPO, SHIP), "utf-8");
    const then = kickoff(SHIP);
    expect(driftBeyond(then, now, [SHIP_PERMITTED_LINE])).toEqual([]);
    const line = now.split("\n")[SHIP_PERMITTED_LINE - 1]!;
    expect(line).toMatch(/^4\. \*\*Sibling not provably idle\*\*/);
    expect(then.split("\n")[SHIP_PERMITTED_LINE - 1]).toMatch(/^4\. \*\*Sibling not provably idle\*\*/);
    expect(line, "the corrected line names Linear's measured cursor field").toContain("top-level `cursor`");
    expect(line, "and no longer tells a Linear child to follow `endCursor` at top level").not.toMatch(/previous page's `endCursor`/);
  });

  test("NEGATIVE CONTROL — a THIRD changed line in ship-milestone (any line but 91), or an added line, fails the guard", () => {
    const now = readFileSync(join(REPO, SHIP), "utf-8");
    const then = kickoff(SHIP);
    const lines = now.split("\n");
    const third = [...lines];
    third[39] = `${third[39]} (edited)`;
    expect(driftBeyond(then, third.join("\n"), [SHIP_PERMITTED_LINE])).toEqual(["line 40"]);
    const added = [...lines.slice(0, 50), "an added line", ...lines.slice(50)];
    expect(driftBeyond(then, added.join("\n"), [SHIP_PERMITTED_LINE])).toHaveLength(1);
  });

  test("NEGATIVE CONTROL — a ship-milestone sibling with one changed line fails the byte-identity guard", () => {
    const then = kickoff(SHIP);
    const lines = then.split("\n");
    expect(lines.length, "control: the kickoff file has a line 40").toBeGreaterThan(40);
    const sibling = [...lines];
    sibling[39] = `${sibling[39]} (edited)`;
    expect(byteDrift(then, sibling.join("\n"))).toEqual(["line 40"]);
    expect(byteDrift(then, `${then}\n`), "a trailing byte is a difference too").not.toEqual([]);
  });

  test("skills/gate-check/SKILL.md differs from the kickoff only on line 128, probe #49's entry, rewritten in place", () => {
    const now = readFileSync(join(REPO, GATE_CHECK), "utf-8");
    const then = kickoff(GATE_CHECK);
    expect(driftBeyond(then, now, [PERMITTED_LINE])).toEqual([]);
    expect(now.split("\n")[PERMITTED_LINE - 1]).toMatch(/^49\. \*\*`tracker_local_reconciliation_drift`\*\*/);
    expect(then.split("\n")[PERMITTED_LINE - 1]).toMatch(/^49\. \*\*`tracker_local_reconciliation_drift`\*\*/);
  });

  test("negative controls: a second changed line, or an added line, fails the guard", () => {
    const now = readFileSync(join(REPO, GATE_CHECK), "utf-8");
    const then = kickoff(GATE_CHECK);
    const lines = now.split("\n");
    const second = [...lines];
    second[199] = `${second[199]} (edited)`;
    expect(driftBeyond(then, second.join("\n"), [PERMITTED_LINE])).toEqual(["line 200"]);
    const added = [...lines.slice(0, 50), "an added line", ...lines.slice(50)];
    expect(driftBeyond(then, added.join("\n"), [PERMITTED_LINE])).toHaveLength(1);
  });
});

// ===========================================================================
// AC-STE-618.9 — the milestone acceptance row, and the real plan today
// ===========================================================================

describe("AC-STE-618.9 — the real plan", () => {
  test("the milestone-level acceptance table carries the front-door command with expected exit 0", () => {
    const text = readFileSync(join(REPO, REAL_PLAN), "utf-8");
    const row = text.split("\n").find((l) => l.startsWith("|") && l.includes("live_proof_gate.ts"));
    expect(row, "a milestone-level acceptance row runs the gate").not.toBeUndefined();
    const cells = row!.slice(1, -1).split("|").map((c) => c.trim());
    expect(cells[1]).toContain(`live_proof_gate.ts . ${REAL_PLAN}`);
    expect(cells[2]).toMatch(/^exit 0\b/);
  });

  // Pinned "exits 1 naming pending" until the evidence commit filled the table.
  // Now it pins the plan's own milestone-acceptance row: exit 0, both trackers
  // pass, and a mode line (pre-release until /ship-milestone stamps shipped_in).
  test("AFTER THE LIVE PROOF the front door over the real plan exits 0 with jira pass and linear pass", () => {
    const out = frontDoor(REPO, REAL_PLAN);
    expect(out.code, `${out.stdout}\n${out.stderr}`).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines[0]).toMatch(/^mode=(pre-release|post-release)$/);
    expect(lines.find((l) => /^jira\b/.test(l))).toBe("jira pass");
    expect(lines.find((l) => /^linear\b/.test(l))).toBe("linear pass");
  }, T);
});

// ===========================================================================
// Audit fixes (STE-618 § Falsifiability, "audit" rows) — each refusal with its
// permit twin, differing in one variable
// ===========================================================================

describe("AUDIT 1 — tracker identity: a row is graded only against its own tracker's bundle", () => {
  test("a linear row pointed at the Jira bundle (same nonce, the Jira bundle's hash) → tracker-mismatch naming both", async () => {
    const root = base().root;
    const own = await setup(root);
    const s = await setup(root, { linear: { row: { bundle: own.dirs.jira, hash: own.rows.jira!.hash } } });
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.trackers.linear.reason).toBe("tracker-mismatch");
    const named = JSON.stringify(r.trackers.linear);
    expect(named).toMatch(/\bjira\b/);
    expect(named).toMatch(/\blinear\b/);
    expect(r.trackers.jira.outcome).toBe("pass");
  }, T);

  test("a jira row pointed at the Linear bundle → tracker-mismatch (not a Jira-only reason)", async () => {
    const root = base().root;
    const own = await setup(root);
    const s = await setup(root, { jira: { row: { bundle: own.dirs.linear, hash: own.rows.linear!.hash } } });
    const r = await grade(await shippedGate(), root, s.planPath);
    expect(r.trackers.jira.reason).toBe("tracker-mismatch");
  }, T);

  test("a Jira bundle whose recorded verdict names tracker linear → tracker-mismatch", async () => {
    const s = await setup(base().root, { jira: { verdict: (v) => void (v.tracker = "linear") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("tracker-mismatch");
    expect(r.trackers.linear.outcome).toBe("pass");
  }, T);

  test("PERMIT TWIN — each row pointing at its own tracker's bundle passes both", async () => {
    const s = await setup(base().root);
    const r = await grade(await shippedGate(), base().root, s.planPath);
    for (const t of TRACKERS) {
      const b = JSON.parse(readFileSync(join(base().root, s.dirs[t], "bundle.json"), "utf-8"));
      expect(b.run.tracker, `control: the ${t} bundle records its tracker`).toBe(t);
      expect(r.trackers[t].outcome).toBe("pass");
    }
  }, T);
});

describe("AUDIT 2 — the recorded outcome is compared with the re-grade, in both directions", () => {
  test("recorded fail, re-grade pass → recorded-verdict-disagrees", async () => {
    const s = await setup(base().root, { linear: { verdict: (v) => void (v.outcome = "fail") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("recorded-verdict-disagrees");
    expect(JSON.stringify(r.trackers.linear)).toMatch(/fail.*pass|pass.*fail/);
    expect(r.trackers.jira.outcome).toBe("pass");
  }, T);

  test("recorded abort, re-grade pass → recorded-verdict-disagrees", async () => {
    const s = await setup(base().root, { jira: { verdict: (v) => void (v.outcome = "abort") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("recorded-verdict-disagrees");
  }, T);

  test("recorded fail, re-grade fail → regrade-not-pass (they agree, and neither is pass)", async () => {
    const s = await setup(base().root, { jira: { before: (b) => void breakScenario(b as never, "S3") } });
    const recorded = JSON.parse(readFileSync(join(base().root, s.dirs.jira, VERDICT_FILE), "utf-8"));
    expect(recorded.outcome, "control: the recorded verdict is fail").toBe("fail");
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("regrade-not-pass");
  }, T);

  test("PERMIT TWIN — recorded pass, re-grade pass → pass", async () => {
    const s = await setup(base().root, { linear: { verdict: (v) => void (v.outcome = "pass") } });
    expect((await grade(await shippedGate(), base().root, s.planPath)).trackers.linear.outcome).toBe("pass");
  }, T);
});

describe("AUDIT 3 — the stamp must be newer than the version every bundle recorded", () => {
  test("hand-stamping the run's own pre-bump version (CHANGELOG heading present) → stamp-without-release", async () => {
    const s = await setup(base().root, { shippedIn: `v${RUN_VERSION}` });
    const b = JSON.parse(readFileSync(join(base().root, s.dirs.jira, "bundle.json"), "utf-8"));
    expect(b.run.pluginVersion, "control: the bundle recorded the stamped version").toBe(RUN_VERSION);
    expect(readFileSync(join(base().root, "CHANGELOG.md"), "utf-8"), "control: the CHANGELOG carries its heading").toContain(`## [${RUN_VERSION}]`);
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("stamp-without-release");
    expect(r.verdict).toBe("fail");
    expect(codes(r)).toContain("stamp-without-release");
    expect(JSON.stringify(r)).toContain(RUN_VERSION);
  }, T);

  test("a stamp OLDER than the version one bundle recorded → stamp-without-release", async () => {
    const s = await setup(base().root, { shippedIn: `v${NEXT_RELEASE}`, linear: { before: (b) => void (b.run.pluginVersion = RELEASED) } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("stamp-without-release");
    expect(codes(r)).toContain("stamp-without-release");
  }, T);

  test("PERMIT TWIN — a stamp one release newer than the recorded version, with its CHANGELOG heading, enters post-release", async () => {
    const s = await setup(base().root, { shippedIn: `v${NEXT_RELEASE}` });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.mode).toBe("post-release");
    expect(r.verdict).toBe("pass");
  }, T);
});

describe("AUDIT 4 — bundle-empty counts bundle.json's sessions too", () => {
  test("bundle.json holding zero sessions under a full verdict.json → bundle-empty", async () => {
    const s = await setup(base().root, { jira: { after: (b) => void (b.sessions = []) } });
    const v = JSON.parse(readFileSync(join(base().root, s.dirs.jira, VERDICT_FILE), "utf-8"));
    expect(Object.keys(v.scenarios).length, "control: verdict.json is full").toBeGreaterThan(0);
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.reason).toBe("bundle-empty");
  }, T);

  test("bundle.json with no sessions field under a full verdict.json → bundle-empty", async () => {
    const s = await setup(base().root, { linear: { after: (b) => void delete (b as Partial<LiveBundle>).sessions } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("bundle-empty");
  }, T);

  test("PERMIT TWIN — the same bundle with its sessions intact passes", async () => {
    const s = await setup(base().root, { jira: { after: () => {} } });
    expect((await grade(await shippedGate(), base().root, s.planPath)).trackers.jira.outcome).toBe("pass");
  }, T);
});

describe("AUDIT 5 — the closing guard fails closed when it cannot read the rows", () => {
  async function guard(o: { plan: "neither" | "both" | "no-section" | "no-table" | "no-linear-row" | "pending"; fr?: "active" | "neither"; suite: boolean }) {
    const root = base().root;
    const fr = uniq("STE-9");
    if ((o.fr ?? "active") === "active") writeFileSync(join(root, "specs", "frs", `${fr}.md`), `---\ntitle: synthetic\nstatus: active\n---\n\n# synthetic\n`);
    const pending = { row: "pending" as const };
    let planPath: string;
    if (o.plan === "no-table") {
      const m = uniq("M_g");
      writeFileSync(join(root, "specs", "plan", `${m}.md`), `---\nmilestone: ${m}\nshipped_in: null\n---\n\n# Plan\n\n### Live proof\n\nNo table yet.\n\n### Out of scope\n\nNothing.\n`);
      planPath = `specs/plan/${m}.md`;
    } else {
      const s = await setup(root, {
        jira: pending,
        linear: o.plan === "no-linear-row" ? { row: "absent" } : pending,
        where: o.plan === "neither" ? "neither" : o.plan === "both" ? "both" : "active",
        section: o.plan !== "no-section",
      });
      planPath = s.planPath;
    }
    const suite = `${PLUGIN_REL}/tests/${uniq("real-plan-")}.test.ts`;
    if (o.suite) {
      mkdirSync(dirname(join(root, suite)), { recursive: true });
      writeFileSync(join(root, suite), "// the real-plan suite\n");
    }
    return await (await shippedGate()).realPlanSuiteGuard({ repoRoot: root, fr, planPath, suitePath: suite });
  }

  const unreadable = [
    ["the plan found at neither path", { plan: "neither" }],
    ["the plan found at both paths", { plan: "both" }],
    ["a plan with no Live proof section", { plan: "no-section" }],
    ["a Live proof section holding no table", { plan: "no-table" }],
    ["a table with no linear row", { plan: "no-linear-row" }],
    ["an FR found at neither specs/frs/ nor specs/frs/archive/", { plan: "pending", fr: "neither" }],
  ] as const;
  for (const [what, o] of unreadable) {
    test(`${what}, no real-plan suite → real-plan-suite-missing; with the suite → quiet`, async () => {
      const miss = await guard({ ...o, suite: false });
      expect(miss.ok, miss.detail).toBe(false);
      expect(miss.reason).toBe("real-plan-suite-missing");
      const ok = await guard({ ...o, suite: true });
      expect(ok.ok, ok.detail).toBe(true);
    }, T);
  }

  test("PERMIT TWIN — the FR plainly active and a readable plan with every row pending stays quiet without the suite", async () => {
    const r = await guard({ plan: "pending", suite: false });
    expect(r.ok, r.detail).toBe(true);
    expect(r.reason).toBeNull();
  }, T);
});

describe("AUDIT 6 — the bundle is exactly bundle.json and verdict.json", () => {
  function pair(): string {
    const d = join(SCRATCH, uniq("hash-pair-"));
    mkdirSync(d);
    writeFileSync(join(d, "bundle.json"), "{\"x\":1}\n");
    writeFileSync(join(d, VERDICT_FILE), "{\"y\":2}\n");
    return d;
  }

  test("a stray .DS_Store (and any other file or subdirectory) leaves the hash unchanged", async () => {
    const d = pair();
    const h = await bundleHashOf(d);
    writeFileSync(join(d, ".DS_Store"), "\u0000\u0001finder\n");
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "notes.txt"), "stray\n");
    expect(await bundleHashOf(d)).toBe(h);
  });

  test("editing bundle.json moves the hash; editing verdict.json moves it too", async () => {
    const d = pair();
    const h = await bundleHashOf(d);
    writeFileSync(join(d, "bundle.json"), "{\"x\":2}\n");
    const h2 = await bundleHashOf(d);
    expect(h2).not.toBe(h);
    writeFileSync(join(d, VERDICT_FILE), "{\"y\":3}\n");
    expect(await bundleHashOf(d)).not.toBe(h2);
  });

  test("a missing verdict.json hashes as absent: different from any present one, and not a crash", async () => {
    const d = pair();
    const h = await bundleHashOf(d);
    spawnSync("rm", [join(d, VERDICT_FILE)]);
    const absent = await bundleHashOf(d);
    expect(absent).toMatch(/^[0-9a-f]{64}$/);
    expect(absent).not.toBe(h);
    writeFileSync(join(d, VERDICT_FILE), "");
    expect(await bundleHashOf(d), "an empty verdict.json is not the same as an absent one").not.toBe(absent);
  });

  test("the gate: a .DS_Store dropped into a bundle after hashing still passes", async () => {
    const s = await setup(base().root, { jira: { afterHash: (abs) => writeFileSync(join(abs, ".DS_Store"), "finder\n") } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.jira.outcome, JSON.stringify(r.trackers.jira)).toBe("pass");
  }, T);
});

describe("AUDIT 7 — the Spaces cell is validated on both trackers", () => {
  test("a Linear issue key whose team prefix is not in the row's Spaces → not-live; the row naming STE is the twin", async () => {
    const s = await setup(base().root, { linear: { row: { spaces: "OPS" } } });
    const r = await grade(await shippedGate(), base().root, s.planPath);
    expect(r.trackers.linear.reason).toBe("not-live");
    expect(JSON.stringify(r.trackers.linear)).toMatch(/\bSTE-9\d\d\b/);
    const twin = await setup(base().root, { linear: { row: { spaces: "STE" } } });
    expect((await grade(await shippedGate(), base().root, twin.planPath)).trackers.linear.outcome).toBe("pass");
  }, T);

  for (const t of TRACKERS) {
    test(`an empty Spaces cell on ${t} → row-malformed`, async () => {
      const s = await setup(base().root, { [t]: { row: { spaces: "" } } });
      const r = await grade(await shippedGate(), base().root, s.planPath);
      expect(r.trackers[t].reason).toBe("row-malformed");
    }, T);

    test(`a Spaces cell reading pending on ${t} (every other cell filled) → pending`, async () => {
      const s = await setup(base().root, { [t]: { row: { spaces: "pending" } } });
      const r = await grade(await shippedGate(), base().root, s.planPath);
      expect(r.trackers[t].reason).toBe("pending");
    }, T);
  }
});

describe("AUDIT 8 — the grade and the gate agree on Linear items that carry no issue key", () => {
  // One definition (the grader's keysOutsideSpaces) decides which items are
  // space-keyed for both: projects and milestones read by name never are; an
  // issue with no readable key always is, and is outside every space. So a
  // bundle the grade passes cannot then fail the gate's not-live key check —
  // a disagreement found only after the live run, whose fix would stale the proof.
  const unkeyedIssue = (b: LiveBundle) => {
    const s = b.sessions.find((x) => x.marker === "S4")!;
    s.calls[0]!.result.items = [{ key: "", summary: "", labels: [], status: "", parent: null, milestone: null, issueType: null, kind: "issue", container: "" }];
  };
  const cases: Array<{ what: string; before?: (b: LiveBundle) => void; pass: boolean }> = [
    { what: "the passing bundle, holding project and milestone items read by name", pass: true },
    { what: "the same bundle plus one issue item with no readable key", before: unkeyedIssue, pass: false },
  ];
  for (const c of cases) {
    test(`linear: ${c.what} — grade ${c.pass ? "pass" : "refuses"}, and the gate agrees`, async () => {
      const b = buildPassingBundle("linear") as unknown as LiveBundle;
      const items = b.sessions.flatMap((s) => s.calls).flatMap((x) => x.result.items ?? []);
      expect(items.some((i) => i.kind === "project") && items.some((i) => i.kind === "milestone"), "control: project and milestone items are present").toBe(true);
      c.before?.(b);
      const graded = gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest }).outcome;
      const s = await setup(base().root, c.before ? { linear: { before: c.before } } : {});
      const gate = (await grade(await shippedGate(), base().root, s.planPath)).trackers.linear;
      expect({ grade: graded === "pass", gate: gate.outcome === "pass" }).toEqual({ grade: c.pass, gate: c.pass });
    }, T);
  }
});

// ===========================================================================
// AC-STE-618.10 — every property fails on the sibling that lacks it
// ===========================================================================

interface SiblingCase {
  property: (typeof PROPERTIES)[number];
  what: string;
  /** Builds the input; returns the repo root, plan path and a cleanup. */
  input: () => Promise<{ root: string; planPath: string; done: () => void }>;
  /** The shipped gate on this input. */
  shipped: (r: AnyResult) => void;
  /** The sibling on the same input: the opposite verdict. */
  sibling: (r: AnyResult) => void;
}

const inBase = async (o: SetupOptions) => {
  const s = await setup(base().root, o);
  return { root: base().root, planPath: s.planPath, done: () => {} };
};

const SIBLING_CASES: SiblingCase[] = [
  {
    property: "regrade",
    what: "trusts the recorded outcome",
    input: () => inBase({ jira: { after: (b) => void breakScenario(b as never, "S3") } }),
    shipped: (r) => expect(r.trackers.jira.reason).toBe("recorded-verdict-disagrees"),
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  {
    property: "freshness",
    what: "skips freshness",
    input: () => {
      const files = { ...base().digest.files, "adapters/_shared/src/dpt_paths.ts": "0".repeat(64) };
      const rec = { digest: digestOver(files), files };
      return inBase({ jira: { recordedDigest: rec }, linear: { recordedDigest: rec } });
    },
    shipped: (r) => expect(r.trackers.jira.reason).toBe("stale-proof"),
    sibling: (r) => expect(r.verdict).toBe("pass"),
  },
  {
    property: "tracked-only",
    what: "hashes ignored files",
    input: async () => {
      const root = copyOfBase();
      const s = await setup(root);
      writeFileSync(join(root, PLUGIN_REL, "adapters", "zz.local-ignored"), "ignored\n");
      writeFileSync(join(root, PLUGIN_REL, "adapters", "_shared", "src", "zz-untracked.ts"), "export const y = 2;\n");
      return { root, planPath: s.planPath, done: () => removeTree(root) };
    },
    shipped: (r) => expect(r.verdict).toBe("pass"),
    sibling: (r) => expect(r.verdict).toBe("fail"),
  },
  {
    property: "bundle-hash",
    what: "skips the bundle hash",
    input: () =>
      inBase({
        linear: {
          afterHash: (abs) => {
            const p = join(abs, "bundle.json");
            const t = readFileSync(p, "utf-8");
            writeFileSync(p, `${t.slice(0, -1)} `);
          },
        },
      }),
    shipped: (r) => expect(r.trackers.linear.reason).toBe("bundle-altered"),
    sibling: (r) => expect(r.trackers.linear.outcome).toBe("pass"),
  },
  {
    property: "registry-set",
    what: "grades on the recorded id set in pre-release mode",
    input: () => inBase({ jira: { verdict: (v) => void delete v.scenarios.S16 } }),
    shipped: (r) => expect(r.trackers.jira.reason).toBe("registry-changed"),
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  {
    property: "row-required",
    what: "reads a pending row as a pass",
    input: () => inBase({ jira: { row: "pending" } }),
    shipped: (r) => expect(r.trackers.jira.reason).toBe("pending"),
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  {
    property: "row-required",
    what: "reads a missing tracker as a pass",
    input: () => inBase({ linear: { row: "absent" } }),
    shipped: (r) => expect(r.trackers.linear.reason).toBe("missing-tracker:linear"),
    sibling: (r) => expect(r.trackers.linear.outcome).toBe("pass"),
  },
  {
    property: "stamp-release",
    what: "accepts an unmatched stamp",
    input: () => inBase({ shippedIn: `v${UNRELEASED}` }),
    shipped: (r) => expect(codes(r)).toContain("stamp-without-release"),
    sibling: (r) => {
      expect(r.mode).toBe("post-release");
      expect(r.verdict).toBe("pass");
    },
  },
  {
    property: "live-only",
    what: "accepts a synthetic bundle",
    input: () => inBase({ linear: { synthetic: true } }),
    shipped: (r) => expect(r.trackers.linear.reason).toBe("not-live"),
    sibling: (r) => expect(r.trackers.linear.outcome).toBe("pass"),
  },
  {
    property: "jira-repoint",
    what: "accepts a Jira bundle whose repoint scenario was skipped",
    input: () => inBase({ jira: { build: { jiraRepointFrom: null } } }),
    shipped: (r) => expect(r.trackers.jira.reason).toBe("jira-repoint-not-proven"),
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  // --- the sibling cases first measured only in a scratch copy (STE-618 § Falsifiability) ---
  {
    property: "bundle-hash",
    what: "skips the bundle hash, and with it the nonce check under the same switch,",
    input: () => inBase({ linear: { row: { nonce: "zz9zz9" } } }),
    shipped: (r) => expect(r.trackers.linear.reason).toBe("nonce-mismatch"),
    sibling: (r) => expect(r.trackers.linear.outcome).toBe("pass"),
  },
  {
    property: "live-only",
    what: "accepts a Jira item key outside the row's spaces",
    input: () => inBase({ jira: { row: { spaces: "DST" } } }),
    shipped: (r) => expect(r.trackers.jira.reason).toBe("not-live"),
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  {
    property: "jira-repoint",
    what: "accepts a Jira bundle carrying no S8 record (post-release)",
    input: () =>
      inBase({
        shippedIn: `v${RELEASED}`,
        jira: {
          build: { jiraRepointFrom: null },
          before: (b) => {
            b.run.skips = [];
          },
          verdict: (v) => {
            delete v.scenarios.S8;
            v.outcome = "pass";
          },
        },
      }),
    shipped: (r) => {
      expect(r.mode).toBe("post-release");
      expect(r.trackers.jira.reason).toBe("jira-repoint-not-proven");
    },
    sibling: (r) => expect(r.trackers.jira.outcome).toBe("pass"),
  },
  {
    property: "freshness",
    what: "skips freshness, so a root with no .git (digest-unavailable) is not refused,",
    input: async () => {
      const root = copyOfBase();
      const s = await setup(root);
      removeTree(join(root, ".git"));
      expect(existsSync(join(root, ".git")), "control: the .git is gone").toBe(false);
      return { root, planPath: s.planPath, done: () => removeTree(root) };
    },
    shipped: (r) => {
      expect(r.verdict).toBe("fail");
      expect(codes(r)).toContain("digest-unavailable");
    },
    sibling: (r) => expect(r.verdict).toBe("pass"),
  },
  {
    property: "freshness",
    what: "skips freshness, so an edited tool inventory (stale-proof) is not refused,",
    input: async () => {
      const root = copyOfBase();
      const s = await setup(root);
      const p = join(root, PLUGIN_REL, "adapters/_shared/data/tracker-tool-inventory.json");
      writeFileSync(p, `${readFileSync(p, "utf-8")}\n`);
      return { root, planPath: s.planPath, done: () => removeTree(root) };
    },
    shipped: (r) => {
      expect(r.trackers.jira.reason).toBe("stale-proof");
      expect(mentions(JSON.stringify(r.trackers.jira), "adapters/_shared/data/tracker-tool-inventory.json")).toBe(true);
    },
    sibling: (r) => expect(r.verdict).toBe("pass"),
  },
  {
    property: "freshness",
    what: "skips freshness, so one edited tracked adapters/ file (stale-proof) is not refused,",
    input: async () => {
      const root = copyOfBase();
      const s = await setup(root);
      const p = join(root, PLUGIN_REL, "adapters/_shared/src/dpt_paths.ts");
      writeFileSync(p, `${readFileSync(p, "utf-8")}\n// edited after the run\n`);
      return { root, planPath: s.planPath, done: () => removeTree(root) };
    },
    shipped: (r) => {
      for (const t of TRACKERS) {
        expect(r.trackers[t].reason).toBe("stale-proof");
        expect(mentions(JSON.stringify(r.trackers[t]), "adapters/_shared/src/dpt_paths.ts")).toBe(true);
      }
    },
    sibling: (r) => expect(r.verdict).toBe("pass"),
  },  // --- the audit's sibling cases (STE-618 § Falsifiability, audit rows) ---
  {
    property: "live-only",
    what: "accepts a Linear issue key outside the row's spaces",
    input: () => inBase({ linear: { row: { spaces: "OPS" } } }),
    shipped: (r) => expect(r.trackers.linear.reason).toBe("not-live"),
    sibling: (r) => expect(r.trackers.linear.outcome).toBe("pass"),
  },
  {
    property: "stamp-release",
    what: "accepts a stamp no newer than the version the run recorded",
    input: () => inBase({ shippedIn: `v${RUN_VERSION}` }),
    shipped: (r) => expect(codes(r)).toContain("stamp-without-release"),
    sibling: (r) => {
      expect(r.mode).toBe("post-release");
      expect(r.verdict).toBe("pass");
    },
  },
];

describe("AC-STE-618.10 — sibling gates", () => {
  test("every listed property has a case", () => {
    expect([...new Set(SIBLING_CASES.map((c) => c.property))].sort()).toEqual([...PROPERTIES].sort());
  });

  for (const c of SIBLING_CASES) {
    test(`${c.property}: a gate that ${c.what} gives the opposite verdict to the shipped gate`, async () => {
      const x = await c.input();
      try {
        const shipped = await grade(await shippedGate(), x.root, x.planPath);
        c.shipped(shipped);
        // control: the unmutated copy, loaded the same way, agrees with the shipped gate
        const control = await grade(await siblingGate(null), x.root, x.planPath);
        c.shipped(control);
        // the sibling LOADS and GRADES (a module-absent failure is not evidence) ...
        const sib = await grade(await siblingGate(c.property), x.root, x.planPath);
        expect(["pass", "fail"]).toContain(sib.verdict);
        // ... and lacks exactly the property this clause asserts
        c.sibling(sib);
      } finally {
        x.done();
      }
    }, T);
  }
});

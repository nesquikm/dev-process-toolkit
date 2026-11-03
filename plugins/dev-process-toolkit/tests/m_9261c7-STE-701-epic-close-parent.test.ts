// STE-701 (M_9261c7) — the Epic close checks that every listed child belongs
// to the Epic.
//
// Check (d) of adapters/_shared/src/epic_close.ts must accept a child row only
// when `fields.parent.key` is a string equal to the Epic key (case-blind). A
// row whose parent is missing, `null`, an object without a string `key`, or a
// bare string proves nothing and is refused, naming the row and that its parent
// is missing. Beside it: the /ship-milestone children query (AC.4), the
// status-only predicate's two presence conjuncts (AC.5), hook/grader parity on
// a receipt rooted in the session's other root (AC.6), and the STE-699.2
// amendment (AC.7).
//
// AC-STE-701.8 — mutation controls (which named test reds for each mutation):
//   * drop the parent requirement in check (d) (back to "only a string foreign
//     parent is refused") → `a child row with no parent proves nothing` and
//     every `AC-STE-701.2 — <shape> (<answer shape>)` row-shape case red;
//   * drop the `typeof issueIdOrKey === "string"` conjunct of
//     isStatusOnlyTransition → `AC-STE-701.5 — issueIdOrKey not a string` and
//     `AC-STE-701.5 — {cloudId, transition} (no issue key)` red (`{cloudId}`
//     stays false through the transition conjunct, so it does NOT red);
//   * drop the `transition present` conjunct → `AC-STE-701.5 — {cloudId, issueIdOrKey}`
//     and the AC-STE-701.6 twin (no `transition`) red.
//
// Synthetic keys only (GK-*); every repository is a temporary git repo.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { isStatusOnlyTransition } from "../adapters/_shared/src/join_consent_ownership";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX } from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, commitAll, git, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, materialize, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const ADAPTERS_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const EPIC_CLOSE = "epic_close.ts";
const EPIC_CLOSE_PATH = join(ADAPTERS_SRC, EPIC_CLOSE);
const HOOK = "pre-tracker-write-gate";
const GRADER_PATH = join(ADAPTERS_SRC, "shared_tracker_live_grader.ts");
const SH_ENTRY_REL = join("templates", "hooks", "process", `${HOOK}.sh`);
const SKILL_MD = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

const SESSION = "s-701-main";
/** At the declared `min_dpt_version` (2.87.0) of every fixture repository. */
const MANIFEST_VERSION = "2.87.0";
const EPIC = "GK-85";
const FOREIGN_EPIC = "GK-99";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const BE_NAME = BE_TAG;
const FE_NAME = FE_TAG;
const BE_FR = "GK-111";
const FE_FR = "GK-101";

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-701-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let NEUTRAL_CWD = "";
let SH_ROOT = "";
beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  SH_ROOT = tempDir("sh-root");
  pluginManifest(SH_ROOT, MANIFEST_VERSION);
  symlinkSync(join(PLUGIN_ROOT, "templates"), join(SH_ROOT, "templates"));
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(SH_ROOT, "adapters"));
});

// ------------------------------------------------------------------- worlds

interface World {
  be: string;
  fe: string;
  scratch: string;
}

const CHANGELOG_SHIPPED = [
  "# Changelog",
  "",
  `## [${VERSION}] — 2026-11-01 — "Close Out"`,
  "",
  "### Fixed",
  "",
  "- The milestone shipped.",
  "",
].join("\n");

/**
 * The STE-699 two-repo world: BE planned M_GK_85 (archived plan stamped
 * v1.2.0, spanning FE, CHANGELOG heading), FE holds its idle half. Checks
 * (a)-(c) hold, so only the children listing decides.
 */
function makeWorld(): World {
  const parent = tempDir("world");
  const be = join(parent, BE_NAME);
  const fe = join(parent, FE_NAME);
  mkdirSync(be, { recursive: true });
  mkdirSync(fe, { recursive: true });
  declareJira(be, BE_TAG);
  declareJira(fe, FE_TAG);
  writePlan(be, "archive", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: `v${VERSION}` });
  writeFr(be, BE_FR, MILESTONE, "archived");
  writeFileSync(join(be, "CHANGELOG.md"), CHANGELOG_SHIPPED);
  writePlan(fe, "archive", MILESTONE, { [BE_NAME]: `../${BE_NAME}`, [FE_NAME]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, FE_FR, MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  return { be, fe, scratch: tempDir("scratch") };
}

// ----------------------------------------------------------- child listings

/** A done child row of the shape a Jira search returns; `parent` is set verbatim, or removed when `NO_PARENT`. */
const NO_PARENT = Symbol("no parent");
function child(key: string, labels: string[], parent: unknown = { key: EPIC }): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary: `Child ${key}`,
    status: { name: "Done", statusCategory: { key: "done" } },
    issuetype: { name: "Task" },
    project: { key: "GK" },
    labels,
  };
  if (parent !== NO_PARENT) fields.parent = parent;
  return { key, fields };
}

/** The two answer shapes the Jira listing reader accepts; in both a row's parent sits at `fields.parent.key`. */
type AnswerShape = "plain" | "wrapped";
function listingOf(shape: AnswerShape, rows: Record<string, unknown>[]): Record<string, unknown> {
  if (shape === "plain") return { issues: rows, isLast: true };
  return {
    context: { cloudId: CLOUD, toolName: "searchJiraIssuesUsingJql" },
    issues: { nodes: rows, pageInfo: { hasNextPage: false, endCursor: null } },
  };
}

let listingSeq = 0;
function saveListing(w: World, listing: unknown): string {
  listingSeq += 1;
  const p = join(w.scratch, `children-${listingSeq}.json`);
  writeFileSync(p, JSON.stringify(listing));
  return p;
}

// ------------------------------------------------------------ module runs

interface ModuleRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) if (val !== undefined) env[k] = val;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  return env;
}

/** Spawn the REAL epic_close.ts through its shipped front door. */
function closeEpic(w: World, listing: unknown, key = EPIC): ModuleRun {
  const args = [w.be, key, "--children", saveListing(w, listing)];
  const p = Bun.spawnSync(["bun", "run", EPIC_CLOSE_PATH, ...args], { cwd: NEUTRAL_CWD, env: childEnv(), stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: p.exitCode ?? -1,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
    command: `bun run "${EPIC_CLOSE_PATH}" ${args.join(" ")}`,
  };
}

function show(r: { exitCode: number; stdout: string; stderr: string }): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

const announcementLines = (out: string): string[] => out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));

function receiptFiles(root: string): string[] {
  const dir = receiptsDir(root, SESSION);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => join(dir, n));
}

function expectClosed(r: ModuleRun, w: World): void {
  if (r.exitCode !== 0) throw new Error(`expected epic_close.ts to permit (exit 0), got:\n${show(r)}`);
  const lines = announcementLines(r.stdout);
  expect(lines.length, "exactly one receipt announced").toBe(1);
  const files = receiptFiles(w.be);
  expect(files.length, "one receipt file written").toBe(1);
  const receipt = JSON.parse(readFileSync(files[0]!, "utf-8")) as Record<string, unknown>;
  expect({ kind: receipt.kind, subject: receipt.subject }).toEqual({ kind: "epic-close", subject: EPIC });
}

/** Refused in the NFR-10 shape (verdict, Remedy:, Context:), non-zero, no receipt, naming every needle. */
function expectRefused(r: ModuleRun, w: World, ...needles: RegExp[]): void {
  if (r.exitCode === 0) throw new Error(`expected epic_close.ts to refuse (non-zero exit), got:\n${show(r)}`);
  expect(announcementLines(r.stdout), "a refusal announces no receipt").toEqual([]);
  expect(receiptFiles(w.be), "a refusal writes no receipt").toEqual([]);
  const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
  expect(lines.length, `NFR-10 shape needs at least three lines:\n${show(r)}`).toBeGreaterThanOrEqual(3);
  expect(/^(Remedy|Context): /.test(lines[0]!), `the first line is the verdict:\n${show(r)}`).toBe(false);
  expect(lines.some((l) => l.startsWith("Remedy: ")), `a Remedy: line:\n${show(r)}`).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: ")), `a Context: line:\n${show(r)}`).toBe(true);
  for (const n of needles) expect(r.stderr, `the refusal names ${n}:\n${show(r)}`).toMatch(n);
}

/** The refusal says the row's parent is missing (not that it names another Epic). */
const PARENT_MISSING = /\bparent\b[^\n]*\bmissing\b|\bmissing\b[^\n]*\bparent\b|\bno parent\b/i;

// ===========================================================================
// AC-STE-701.1 — the regression, by its exact name
// ===========================================================================

test("a child row with no parent proves nothing", () => {
  const w = makeWorld();
  const listing = listingOf("plain", [child(FE_FR, [FE_TAG], NO_PARENT), child(BE_FR, [BE_TAG], NO_PARENT)]);
  expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), new RegExp(BE_FR), PARENT_MISSING);
});

// ===========================================================================
// AC-STE-701.2 — the four parentless row shapes, in both answer shapes
// ===========================================================================

describe("AC-STE-701.2 — a row is accepted only when fields.parent.key is a string equal to the Epic key", () => {
  const shapes: Array<[string, unknown]> = [
    ["no fields.parent", NO_PARENT],
    ["parent: null", null],
    ["parent: {} (no string key)", {}],
    ['parent: "GK-99" (a bare string)', FOREIGN_EPIC],
    ['parent: "GK-85" (a bare string equal to the Epic key)', EPIC],
  ];
  for (const answer of ["plain", "wrapped"] as const) {
    for (const [name, parent] of shapes) {
      test(`AC-STE-701.2 — ${name} (${answer}) → refused naming the row and that its parent is missing, no receipt`, () => {
        const w = makeWorld();
        // One parentless row beside one proven row: the proven row cannot carry it.
        const listing = listingOf(answer, [child(FE_FR, [FE_TAG], parent), child(BE_FR, [BE_TAG])]);
        expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), PARENT_MISSING);
      });
    }
  }

  test("AC-STE-701.2 — parent: { key: 85 } (a non-string key) → refused naming the row, no receipt", () => {
    const w = makeWorld();
    const listing = listingOf("plain", [child(FE_FR, [FE_TAG], { key: 85 }), child(BE_FR, [BE_TAG])]);
    expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), PARENT_MISSING);
  });

  test("AC-STE-701.2 — the parent key is compared without case: parent gk-85 → closed, one receipt", () => {
    const w = makeWorld();
    const listing = listingOf("plain", [child(FE_FR, [FE_TAG], { key: EPIC.toLowerCase() }), child(BE_FR, [BE_TAG])]);
    expectClosed(closeEpic(w, listing), w);
  });

  test("AC-STE-701.2 — a missing parent and a foreign parent in one listing are named apart", () => {
    const w = makeWorld();
    const listing = listingOf("plain", [child(FE_FR, [FE_TAG], NO_PARENT), child(BE_FR, [BE_TAG], { key: FOREIGN_EPIC })]);
    expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), new RegExp(BE_FR), PARENT_MISSING, new RegExp(FOREIGN_EPIC));
  });
});

// ===========================================================================
// AC-STE-701.3 — the foreign-parent refusal is unchanged; own children close
// ===========================================================================

describe("AC-STE-701.3 — a row naming another Epic is refused as before, and a listing of the Epic's own children closes", () => {
  test("AC-STE-701.3 — a row whose fields.parent.key is GK-99 → refused with the unchanged foreign-parent verdict", () => {
    const w = makeWorld();
    const listing = listingOf("plain", [child(FE_FR, [FE_TAG], { key: FOREIGN_EPIC }), child(BE_FR, [BE_TAG])]);
    const r = closeEpic(w, listing);
    expectRefused(r, w, new RegExp(FE_FR));
    expect(r.stderr).toContain(`1 row(s) of the --children listing name another parent than ${EPIC}: ${FE_FR} (parent ${FOREIGN_EPIC})`);
    expect(r.stderr).toContain(`foreign=${FE_FR} (parent ${FOREIGN_EPIC})`);
    expect(r.stderr, "a foreign parent is not reported as missing").not.toMatch(PARENT_MISSING);
  });

  for (const answer of ["plain", "wrapped"] as const) {
    test(`AC-STE-701.3 — every row names ${EPIC} (${answer}) → closed, one epic-close receipt`, () => {
      const w = makeWorld();
      expectClosed(closeEpic(w, listingOf(answer, [child(FE_FR, [FE_TAG]), child(BE_FR, [BE_TAG])])), w);
    });
  }
});

// ===========================================================================
// AC-STE-701.4 — /ship-milestone post-ship step 3 names the children query
// ===========================================================================

describe("AC-STE-701.4 — /ship-milestone post-ship step 3 names the children query", () => {
  const body = readFileSync(SKILL_MD, "utf-8");
  const start = body.indexOf("### 9. Post-ship checklist");
  const end = body.indexOf("### 9b.", start);
  const section = start >= 0 && end > start ? body.slice(start, end) : "";
  const step3 = section.split("\n").find((l) => /^\s*3\.\s/.test(l)) ?? "";

  test("CONTROL — post-ship step 3 is the Epic close step", () => {
    expect(step3).toContain(EPIC_CLOSE);
  });

  test("AC-STE-701.4 — step 3 names the JQL `parent = <P>-<N>`", () => {
    expect(step3).toMatch(/JQL[^\n]*`parent = <P>-<N>`/);
  });

  test("AC-STE-701.4 — step 3 requests `parent` among the listing's fields", () => {
    const rest = step3.replace("parent = <P>-<N>", "");
    expect(rest).toMatch(/\bfields\b[^\n]{0,160}\bparent\b/i);
  });
});

// ===========================================================================
// AC-STE-701.5 — isStatusOnlyTransition's presence conjuncts
// ===========================================================================

describe("AC-STE-701.5 — isStatusOnlyTransition needs a string issueIdOrKey and a transition, and nothing else", () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ["{cloudId}", { cloudId: CLOUD }, false],
    ["{cloudId, issueIdOrKey}", { cloudId: CLOUD, issueIdOrKey: EPIC }, false],
    ["{cloudId, transition} (no issue key)", { cloudId: CLOUD, transition: { id: "41" } }, false],
    ["issueIdOrKey not a string", { cloudId: CLOUD, issueIdOrKey: 63184, transition: { id: "41" } }, false],
    ["{cloudId, issueIdOrKey, transition}", { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } }, true],
    ["{issueIdOrKey, transition}", { issueIdOrKey: EPIC, transition: { id: "41" } }, true],
    ["a key outside the allowed set (fields)", { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" }, fields: {} }, false],
    ["{} (empty input)", {}, false],
  ];
  for (const [name, input, want] of cases) {
    test(`AC-STE-701.5 — ${name} → ${want}`, () => {
      expect({ name, statusOnly: isStatusOnlyTransition(input) }).toEqual({ name, statusOnly: want });
    });
  }
});

// ===========================================================================
// AC-STE-701.6 — hook and grader agree on ONE session whose epic-close
// receipt sits in the session's OTHER root
// ===========================================================================

interface Finding {
  code: string;
  detail?: string;
}
interface Extracted {
  ok: boolean;
  bundle?: LiveBundle;
  verdict?: { findings: Finding[] };
}
interface GraderModule {
  extractBundle: (o: {
    configDirs: string[];
    ledgerSessionIds: string[];
    roots: { A: { path: string; tag: string }; B: { path: string; tag: string } };
    run: LiveBundle["run"];
    synthetic?: boolean;
  }) => Extracted;
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Finding[] };
}
const grader = async (): Promise<GraderModule> => (await import(GRADER_PATH)) as GraderModule;

const sha256Hex = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");

function appendCall(s: BundleSession, name: string, input: Record<string, unknown>, result: ToolCall["result"], tag: string): ToolCall {
  const c: ToolCall = { ref: `${s.sessionId}:toolu_701_${tag}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}

interface Verdicts {
  hook: boolean;
  grader: boolean;
}

/**
 * ONE session, read by both: the passing Jira bundle's S13 session gains a
 * run of epic_close.ts on the bundle root that is NOT its own, whose
 * `epic-close` receipt for a fresh key sits in that other root, then one
 * successful `transitionJiraIssue` carrying `input(key)`. The bundle is
 * materialized to disk (two git roots, receipts with their real digests, one
 * transcript file per session) and both roots declare the run's Jira
 * container shared. Then:
 *   - the grader extracts that transcript and those roots and grades it;
 *   - pre-tracker-write-gate runs through its SHIPPED `.sh` wrapper on the
 *     SAME transcript file, gating that same tool_use id from the session's cwd.
 * Each side reports whether it permits the transition.
 */
async function oneSessionVerdicts(input: (key: string) => Record<string, unknown>): Promise<Verdicts> {
  const g = await grader();
  const b = buildPassingBundle("jira");
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const other = s.root === "A" ? "B" : "A";
  const key = `${b.run.container}-850`;
  const path = `<${other}>/.dpt/ledger/receipts/${s.sessionId}/epic-close-701.json`;
  const set = b.repos[other].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({
    path,
    sessionId: s.sessionId,
    sha256: sha256Hex(path),
    kind: "epic-close",
    adapter: b.run.tracker,
    container: b.run.container,
    subject: key,
    decision: "close",
    evidence: { key, milestone: milestoneIdFromEpicKey(key) },
  });
  const command = `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${EPIC_CLOSE}" <${other}> ${key} --children <${other}>/.dpt/tmp/children.json`;
  appendCall(s, "Bash", { command, description: "run" }, { isError: false, text: `closed\ndpt-receipt: ${path} sha256:${sha256Hex(path)}`, exitCode: 0, items: null, lastPage: null }, "ann");
  const w = appendCall(s, serverPrefix("jira", s.root) + "transitionJiraIssue", input(key), { isError: false, text: "", exitCode: null, items: [], lastPage: null }, "w");

  const m = materialize(b, tempDir("one-session"));
  for (const r of ["A", "B"] as const) {
    const tag = b.roots[r].tag;
    claudeMd(m.roots[r], { mode: "jira", project: b.run.container, defaultLabels: [tag], repoTag: tag, minDptVersion: MANIFEST_VERSION });
  }
  const transcript = m.transcripts[s.sessionId]!;
  const toolUseId = w.ref.split(":")[1]!;
  expect(readFileSync(transcript, "utf-8"), "CONTROL — the session's transcript holds the gated transition").toContain(`"id":"${toolUseId}"`);
  expect(existsSync(path.replace(`<${other}>`, m.roots[other])), "CONTROL — the receipt sits in the session's other root").toBe(true);

  // The grader, on the extracted session.
  const x = g.extractBundle({
    configDirs: [m.configDir],
    ledgerSessionIds: m.ledger,
    roots: { A: { path: m.roots.A, tag: b.roots.A.tag }, B: { path: m.roots.B, tag: b.roots.B.tag } },
    run: m.run,
    synthetic: true,
  });
  if (!x.ok || !x.bundle) throw new Error(`extractBundle aborted: ${JSON.stringify(x.verdict?.findings ?? [])}`);
  const xs = x.bundle.sessions.find((y) => y.sessionId === s.sessionId)!;
  expect(xs.calls.some((c) => c.ref === w.ref), "CONTROL — the extracted session holds the same transition").toBe(true);
  const v = g.gradeBundle(x.bundle, { behaviourDigestNow: x.bundle.run.behaviourDigest.digest });
  const graderPermit = !v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${w.ref}:`));

  // The hook, on the same transcript file and tool_use id.
  const payload = JSON.stringify({
    session_id: s.sessionId,
    transcript_path: transcript,
    cwd: m.roots[s.root],
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: w.name,
    tool_input: w.input,
    tool_use_id: toolUseId,
  });
  const env = childEnv();
  env.CLAUDE_PLUGIN_ROOT = SH_ROOT;
  env.CLAUDE_CODE_SESSION_ID = s.sessionId;
  const proc = Bun.spawn(["bash", join(SH_ROOT, SH_ENTRY_REL)], { cwd: NEUTRAL_CWD, env, stdin: new Response(payload).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0 && exitCode !== 2) throw new Error(`the gate neither permitted nor refused:\n${show({ exitCode, stdout, stderr })}`);
  if (exitCode === 2) expect(stderr, `a refusal names the hook:\n${stderr}`).toContain(`hook=${HOOK}`);
  return { hook: exitCode === 0, grader: graderPermit };
}

describe("AC-STE-701.6 — pre-tracker-write-gate and the live grader, on ONE session with the epic-close receipt in its other root, give the same verdict on the Epic transition", () => {
  test("AC-STE-701.6 — a status-only transition: the hook and the grader both permit", async () => {
    expect(await oneSessionVerdicts((k) => ({ cloudId: CLOUD, issueIdOrKey: k, transition: { id: "41" } }))).toEqual({ hook: true, grader: true });
  });

  test("AC-STE-701.6 — the twin with no `transition`: the hook and the grader both refuse", async () => {
    expect(await oneSessionVerdicts((k) => ({ cloudId: CLOUD, issueIdOrKey: k }))).toEqual({ hook: false, grader: false });
  });
});

// ===========================================================================
// AC-STE-701.7 — the archived AC-STE-699.2 gains exactly one appended clause
// ===========================================================================

describe("AC-STE-701.7 — specs/frs/archive/STE-699.md: AC-STE-699.2 amended, no other byte changed", () => {
  const REL = "specs/frs/archive/STE-699.md";
  const BASE_REF = "f915fc54";
  const CLAUSE = / \*\(Amended by STE-701 \(v\d+\.\d+\.\d+\): check \(b\) refuses a plan still at specs\/plan\/<M>\.md, so only an archived plan closes\.\)\*$/;

  const now = readFileSync(join(REPO_ROOT, REL), "utf-8");
  const base = git(REPO_ROOT, "show", `${BASE_REF}:${REL}`);
  const lineNow = now.split("\n").find((l) => l.startsWith("- AC-STE-699.2:")) ?? "";
  const lineBase = base.split("\n").find((l) => l.startsWith("- AC-STE-699.2:")) ?? "";

  test("CONTROL — the base blob carries AC-STE-699.2 without the amendment", () => {
    expect(lineBase.length).toBeGreaterThan(0);
    expect(lineBase).not.toContain("Amended by STE-701");
  });

  test("AC-STE-701.7 — the AC-STE-699.2 line ends with the amendment clause, its version a semver", () => {
    expect(lineNow).toMatch(CLAUSE);
  });

  test("AC-STE-701.7 — with the clause removed, the file is byte-identical to its content at f915fc54", () => {
    const m = CLAUSE.exec(lineNow);
    expect(m, "the clause is present").not.toBeNull();
    const restored = now.replace(lineNow, lineNow.slice(0, lineNow.length - m![0].length));
    expect(restored === base, "no other byte of the file changes").toBe(true);
  });
});

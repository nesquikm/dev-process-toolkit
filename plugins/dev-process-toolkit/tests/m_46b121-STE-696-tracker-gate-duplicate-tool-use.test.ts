// STE-696 (M_46b121) — the tracker write gate reads a call written twice as one call.
//
// Claude Code can write one tool call (or one tool result) twice in the session
// log — one copy stamped, one not — under the SAME id. STE-695 taught the commit
// gates' `scanSkillCalls` to read such copies as one call, with the rule inline.
// The tracker write gate has its own readers (`scanAnnouncements`,
// `createsBefore`, `priorCreates`) and counted every copy: one decide result
// written twice authorised two creates, one create written twice spent two
// receipts, and `priorCreates` kept the LAST copy's position.
//
// ---------------------------------------------------------------------------
// CONTRACT this suite reads (the implementer satisfies it)
// ---------------------------------------------------------------------------
//   templates/hooks/_lib/session.ts exports
//
//     export function firstCopies(records: ReadonlyArray<unknown>): Array<{
//       block: Record<string, unknown>;   // the FIRST copy's content block
//       record: Record<string, unknown>;  // the record that first copy sits in
//       line: number;                     // that record's index in `records`
//       at: number | null;                // epoch ms — see below
//     }>
//
//   `records[i]` is transcript line i, already JSON-parsed (anything that is not
//   a plain object — `null` for an unparseable line — carries no blocks but
//   still occupies its index). The view yields each record's `message.content`
//   object blocks in transcript order (line, then position), except:
//     - a `tool_use` whose non-empty string `id` an earlier yielded `tool_use`
//       carries is a copy and is NOT yielded; the yielded one's `at` is the
//       timestamp of the first copy (in line order) whose record carries a
//       parseable `timestamp`, else null;
//     - a `tool_use` with no id, or an empty one, is never merged;
//     - a `tool_result` whose `tool_use_id` an earlier yielded `tool_result`
//       carries is a copy and is NOT yielded — the first copy decides.
//   Entries for other block types (and, if the helper chooses, a bare top-level
//   block record) are not graded here: every assertion filters to tool_use /
//   tool_result blocks. Readers rely on these four fields only.
//
//   `scanSkillCalls` (session.ts) and the gate's `scanAnnouncements`,
//   `createsBefore` and `priorCreates` each call `firstCopies(` exactly once in
//   their own body, and none of those three gate walks reads `.blocks` or
//   `contentBlocks(` itself (AC-STE-696.9). The gate imports `firstCopies` from
//   "../session.ts".
//
// Instruments:
//   §A  the SHIPPED hook entry point (`bun run pre-tracker-write-gate.ts`) over
//       real transcript files, real receipts (writeReceipt) and a real
//       attach-target receipt minted by the attach front door itself;
//   §B  the exported `scanAnnouncements` and `firstCopies`, and the Skill
//       scanner through a spy `receiptLeg` handed to `requireSkillToolUse`
//       (the STE-695 §B pattern);
//   §C  AC-STE-696.8 mutation controls: gate mutants run in a temp copy of
//       `templates/` (adapters/ symlinked), session mutants are imported from a
//       temp copy of session.ts. Session mutations reuse the STE-695 anchors
//       (region `\nfunction recordTimestamp(` .. `\nexport function
//       findSkillToolUse(`); gate mutations swap the one `firstCopies(` call in
//       a named function for an `everyCopy(` passthrough appended to the copy.
//       A mutant is killed only by a scenario GREEN on the unmutated source.
//
// Every id, path and session id here is synthetic. The STE-695 suite
// (tests/m_b1c081-ste-695-duplicate-tool-use.test.ts) is not touched.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import { makeSpanFixture, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, boundFr, declareJira } from "./_orphan_pages";
import { RECEIPT_ANNOUNCEMENT_PREFIX, announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { TRACKER_WRITE_GATE_ENV } from "../adapters/_shared/src/tracker_write_gate_setting";
import { announcesGateReceipt } from "../adapters/_shared/src/gate_receipt";
import * as sessionLib from "../templates/hooks/_lib/session";
import { requireSkillToolUse, type EvidenceTarget, type HookPayload } from "../templates/hooks/_lib/session";
import { scanAnnouncements } from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";

setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ADAPTERS_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const GATE_REL = join("templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts");
const SESSION_REL = join("templates", "hooks", "_lib", "session.ts");
const GATE_TS = join(PLUGIN_ROOT, GATE_REL);
const SESSION_TS = join(PLUGIN_ROOT, SESSION_REL);
const SESSION = "syn-session-696";
const MANIFEST_VERSION = "2.87.0";
const DECIDE = "create_idempotency_probe.ts";
const ATTACH = "attach_project_milestone.ts";
const CLOUD = "dpt-smoke.atlassian.net";
const JIRA_CREATE = "mcp__atlassian__createJiraIssue";

const temps: string[] = [];
const cleanups: Array<() => void> = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-696-${label}-`)));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

let seq = 0;

// =========================================================================
// World: a two-repository Jira world sharing project GK (as the STE-607 suite
// builds it), BE's milestone plan committed, and one attach-target receipt
// minted by the REAL attach front door.
// =========================================================================

function git(root: string, ...args: string[]): void {
  const p = Bun.spawnSync(
    ["git", "-c", "user.name=dpt-696", "-c", "user.email=dpt-696@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} in ${root} failed: ${p.stderr.toString()}`);
}

function gitInit(root: string): void {
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "fixture");
}

interface World {
  be: string;
  scratch: string;
  attach: { command: string; out: string };
}

let NEUTRAL_CWD = "";
let MANIFEST_DIR = "";
let W: World;

const epicRow = (key: string, summary: string) => ({
  key,
  fields: {
    summary,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    labels: [],
    issuetype: { name: "Epic" },
    project: { key: "GK" },
  },
});

function makeWorld(): World {
  const span = makeSpanFixture("M_GK_85", { repositories: false });
  cleanups.push(() => span.cleanup());
  const fe = realpathSync(span.a);
  const be = realpathSync(span.b);
  declareJira(fe, FE_TAG);
  declareJira(be, BE_TAG);
  boundFr(fe, "GK-101");
  boundFr(be, "GK-111");
  gitInit(fe);
  gitInit(be);
  // BE's milestone plan, committed, so the attach front door resolves GK-85.
  mkdirSync(join(be, "specs", "plan"), { recursive: true });
  writeFileSync(
    join(be, "specs", "plan", "M_GK_85.md"),
    "---\nmilestone: M_GK_85\nstatus: active\narchived_at: null\n---\n\n## M_GK_85 — Payouts {#M_GK_85}\n\nBody.\n",
  );
  git(be, "add", "-A");
  git(be, "commit", "-q", "-m", "plan M_GK_85");
  const scratch = tempDir("scratch");
  const listingPath = join(scratch, "attach-listing.json");
  writeFileSync(listingPath, JSON.stringify({ issues: [epicRow("GK-85", "Payouts")], isLast: true }));
  const argv = [be, "jira", "GK", join(be, "specs", "plan", "M_GK_85.md"), listingPath];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const p = Bun.spawnSync(["bun", "run", join(ADAPTERS_SRC, ATTACH), ...argv], { env, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString().trimEnd();
  if (p.exitCode !== 0 || !out.split("\n").some((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))) {
    throw new Error(`fixture: the attach front door did not resolve (exit ${p.exitCode}):\n${out}\n${p.stderr.toString()}`);
  }
  const command = `bun run "${join(ADAPTERS_SRC, ATTACH)}" ${argv.map((a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `"${a}"`)).join(" ")}`;
  return { be, scratch, attach: { command, out } };
}

beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  MANIFEST_DIR = tempDir("manifest");
  pluginManifest(MANIFEST_DIR, MANIFEST_VERSION);
  W = makeWorld();
});

// ----------------------------------------------------------------- receipts

function receiptIn(root: string, input: ReceiptInput): string {
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  try {
    return resolve(writeReceipt(root, input));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  }
}

const TITLE = "BE payout export";

/** A `create` receipt shaped exactly as `decide` writes one (STE-604). */
function createReceipt(root: string): string {
  return receiptIn(root, {
    kind: "create",
    adapter: "jira",
    container: "GK-85",
    subject: TITLE,
    decision: "create",
    evidence: { createPayload: { project: "GK", summary: TITLE, labels: [BE_TAG], parent: "GK-85" } },
  });
}

const decideCommand = (root: string): string =>
  `bun run "${join(ADAPTERS_SRC, DECIDE)}" decide "${root}" /tmp/page.json --title "${TITLE}" --parent GK-85 --attempt fast`;

const decideOutput = (receipt: string): string => `{"outcome":"create","reason":"proven-absent"}\n${announceReceipt(receipt)}`;

function jiraCreate(): Record<string, unknown> {
  return {
    cloudId: CLOUD,
    projectKey: "GK",
    issueTypeName: "Task",
    summary: TITLE,
    description: "Some body.\n\nSource: specs/frs/GK-NEW.md",
    parent: "GK-85",
    additional_fields: { labels: [BE_TAG] },
  };
}

// --------------------------------------------------------------- transcript

/** `null` writes the untimed copy; a string is the record's ISO stamp. */
type Stamp = string | null;
const NOW = (): string => new Date().toISOString();

class Transcript {
  readonly lines: string[] = [];

  use(id: string, name: string, input: unknown, at: Stamp = NOW(), messageId?: string): this {
    const record: Record<string, unknown> = {
      type: "assistant",
      sessionId: SESSION,
      message: { ...(messageId ? { id: messageId } : {}), role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    };
    if (at !== null) record.timestamp = at;
    this.lines.push(JSON.stringify(record));
    return this;
  }

  result(id: string, content: unknown, at: Stamp = NOW(), isError = false): this {
    const record: Record<string, unknown> = {
      type: "user",
      sessionId: SESSION,
      message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : {}) }] },
    };
    if (at !== null) record.timestamp = at;
    this.lines.push(JSON.stringify(record));
    return this;
  }

  /** The attach front door's real run, as the session recorded it. */
  attach(w: World): this {
    return this.use("toolu_syn_attach_01", "Bash", { command: w.attach.command, description: "run" }).result("toolu_syn_attach_01", w.attach.out);
  }

  save(dir: string): string {
    seq += 1;
    const p = join(dir, `transcript-${seq}.jsonl`);
    writeFileSync(p, this.lines.map((l) => `${l}\n`).join(""));
    return p;
  }
}

// ------------------------------------------------------------------ running

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Spawn the gate entry point exactly as the harness does: `bun run <module>`, the payload on stdin. */
async function runGate(module: string, transcript: string, toolUseId: string | null): Promise<Run> {
  const stdin = JSON.stringify({
    session_id: SESSION,
    transcript_path: transcript,
    cwd: W.be,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: JIRA_CREATE,
    tool_input: jiraCreate(),
    ...(toolUseId === null ? {} : { tool_use_id: toolUseId }),
  });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  delete env[TRACKER_WRITE_GATE_ENV];
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const proc = Bun.spawn(["bun", "run", module], { cwd: NEUTRAL_CWD, env, stdin: new Response(stdin).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const show = (r: Run): string => `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

/** What a scenario requires of the gate's verdict. */
type Verdict = { permit: true } | { permit: false; needle: RegExp };
const PERMIT: Verdict = { permit: true };
/** The spent-receipt refusal (gateCreate: "its create receipt (…) is spent"). */
const SPENT: Verdict = { permit: false, needle: /create receipt \(.*\) is spent/ };
/** The prior-create refusal (gateCreate: "an earlier create of … may have made the ticket"). */
const PRIOR = (id: string): Verdict => ({ permit: false, needle: new RegExp(`an earlier create of "${TITLE}" \\(${id}\\) may have made the ticket`) });

/** Null when `r` is the verdict `v`; otherwise why not. */
function verdictMiss(r: Run, v: Verdict): string | null {
  if (v.permit) return r.exitCode === 0 && r.stdout === "" ? null : `expected exit 0 (permit), got:\n${show(r)}`;
  if (r.exitCode !== 2 || !r.stderr.includes("Refusing:")) return `expected exit 2 (refusal), got:\n${show(r)}`;
  return v.needle.test(r.stderr) ? null : `expected the refusal to match ${v.needle}, got:\n${show(r)}`;
}

/** A verdict that is neither a permit nor an NFR-10 refusal: the module crashed. */
const crashed = (r: Run): boolean => !(r.exitCode === 0 || (r.exitCode === 2 && r.stderr.includes("Refusing:")));

// =========================================================================
// §A — the transcripts
// =========================================================================

type Order = "timed-first" | "untimed-first";
const ORDERS: readonly Order[] = ["timed-first", "untimed-first"];
const stamps = (o: Order): [Stamp, Stamp] => (o === "timed-first" ? [NOW(), null] : [null, NOW()]);

interface Built {
  transcript: string;
  toolUseId: string | null;
  verdict: Verdict;
}

/**
 * AC-STE-696.1 — the FR's reproduction: one decide call, its result written
 * twice (the second copy untimed), one create of the decided ticket that has
 * no result yet, and the gated second create of the same ticket shape.
 */
function decideResultTwice(order: Order = "timed-first"): Built {
  const receipt = createReceipt(W.be);
  const [a, b] = stamps(order);
  const t = new Transcript()
    .attach(W)
    .use("toolu_syn_decide_01", "Bash", { command: decideCommand(W.be), description: "run" })
    .result("toolu_syn_decide_01", decideOutput(receipt), a)
    .result("toolu_syn_decide_01", decideOutput(receipt), b)
    .use("toolu_syn_create_01", JIRA_CREATE, jiraCreate(), NOW(), "msg_syn_create_01");
  return { transcript: t.save(W.scratch), toolUseId: null, verdict: SPENT };
}

/**
 * AC-STE-696.5 / .7 — a deciding call AND its result each written twice
 * (`secondId === "toolu_syn_decide_01"`, the defect), or a second deciding run
 * under a DISTINCT id printing the same announcement (the twin): two calls,
 * two announcements, so the one earlier create spends one and the gated
 * create is permitted.
 */
function decideCallTwice(order: Order, secondId: string): Built {
  const receipt = createReceipt(W.be);
  const [a, b] = stamps(order);
  const t = new Transcript()
    .attach(W)
    .use("toolu_syn_decide_01", "Bash", { command: decideCommand(W.be), description: "run" }, a)
    .use(secondId, "Bash", { command: decideCommand(W.be), description: "run" }, b)
    .result("toolu_syn_decide_01", decideOutput(receipt), a)
    .result(secondId, decideOutput(receipt), b)
    .use("toolu_syn_create_01", JIRA_CREATE, jiraCreate(), NOW(), "msg_syn_create_01");
  return { transcript: t.save(W.scratch), toolUseId: null, verdict: secondId === "toolu_syn_decide_01" ? SPENT : PERMIT };
}

/**
 * AC-STE-696.6 / .7 — two decided receipts for the ticket, then ONE create
 * written twice (`secondId === "toolu_syn_create_01"`, the defect): one create
 * spends one receipt, so the gated create is permitted. The twin writes the
 * second record under a DISTINCT id: two creates spend both receipts.
 */
function createTwice(order: Order, secondId: string): Built {
  const r1 = createReceipt(W.be);
  const r2 = createReceipt(W.be);
  const [a, b] = stamps(order);
  const t = new Transcript()
    .attach(W)
    .use("toolu_syn_decide_01", "Bash", { command: decideCommand(W.be), description: "run" })
    .result("toolu_syn_decide_01", decideOutput(r1))
    .use("toolu_syn_decide_02", "Bash", { command: decideCommand(W.be), description: "run" })
    .result("toolu_syn_decide_02", decideOutput(r2))
    .use("toolu_syn_create_01", JIRA_CREATE, jiraCreate(), a, "msg_syn_create_01")
    .use(secondId, JIRA_CREATE, jiraCreate(), b, "msg_syn_create_01");
  return { transcript: t.save(W.scratch), toolUseId: null, verdict: secondId === "toolu_syn_create_01" ? PERMIT : SPENT };
}

/**
 * AC-STE-696.6 / .7 — the prior-create grading orders a create by its FIRST
 * copy: create A's first copy sits BEFORE the gated call's own line, its second
 * copy AFTER it, and A has no result. A is a create ordered before the gated
 * call whose outcome is unknown, so the gated create is refused. The twin
 * writes the later record under a DISTINCT id — A is still before the gated
 * call, and is still the one named.
 */
const GATED = "toolu_syn_gated_01";
function priorCreateTwice(order: Order, secondId: string): Built {
  const r1 = createReceipt(W.be);
  const r2 = createReceipt(W.be);
  const [a, b] = stamps(order);
  const t = new Transcript()
    .attach(W)
    .use("toolu_syn_decide_01", "Bash", { command: decideCommand(W.be), description: "run" })
    .result("toolu_syn_decide_01", decideOutput(r1))
    .use("toolu_syn_decide_02", "Bash", { command: decideCommand(W.be), description: "run" })
    .result("toolu_syn_decide_02", decideOutput(r2))
    .use("toolu_syn_create_01", JIRA_CREATE, jiraCreate(), a, "msg_syn_create_01")
    .use(GATED, JIRA_CREATE, jiraCreate(), NOW(), "msg_syn_gated_01")
    .use(secondId, JIRA_CREATE, jiraCreate(), b, "msg_syn_create_01");
  return { transcript: t.save(W.scratch), toolUseId: GATED, verdict: PRIOR("toolu_syn_create_01") };
}

async function expectVerdict(built: Built, module = GATE_TS): Promise<void> {
  const r = await runGate(module, built.transcript, built.toolUseId);
  const miss = verdictMiss(r, built.verdict);
  if (miss !== null) throw new Error(miss);
}

// AC-STE-696.1 — the regression, verbatim title, at top level.
test("a decide result written twice authorises one create", async () => {
  await expectVerdict(decideResultTwice("timed-first"));
});

describe("AC-STE-696.5 / .7 — a deciding result or call written twice is one announcement (the shipped hook)", () => {
  for (const order of ORDERS) {
    test(`AC-STE-696.5 / .7 (${order}) — the decide result written twice: one create spends the one receipt → the next create is refused as spent`, async () => {
      await expectVerdict(decideResultTwice(order));
    });

    test(`AC-STE-696.5 / .7 (${order}) — the decide call AND its result written twice → one announcement, refused as spent`, async () => {
      await expectVerdict(decideCallTwice(order, "toolu_syn_decide_01"));
    });

    test(`AC-STE-696.7 (${order}) — twin: the second run carries a DISTINCT id → two announcements, the next create is permitted`, async () => {
      await expectVerdict(decideCallTwice(order, "toolu_syn_decide_02"));
    });
  }
});

describe("AC-STE-696.6 / .7 — a create written twice is one create (the shipped hook)", () => {
  for (const order of ORDERS) {
    test(`AC-STE-696.6 / .7 (${order}) — one create written twice spends ONE of two receipts → the next create is permitted`, async () => {
      await expectVerdict(createTwice(order, "toolu_syn_create_01"));
    });

    test(`AC-STE-696.7 (${order}) — twin: two creates under DISTINCT ids spend both receipts → refused as spent`, async () => {
      await expectVerdict(createTwice(order, "toolu_syn_create_02"));
    });

    test(`AC-STE-696.6 / .7 (${order}) — a create whose first copy precedes the gated call and whose second follows it is a prior create → refused naming it`, async () => {
      await expectVerdict(priorCreateTwice(order, "toolu_syn_create_01"));
    });

    test(`AC-STE-696.7 (${order}) — twin: the later record under a DISTINCT id → the earlier create is still prior → refused naming it`, async () => {
      await expectVerdict(priorCreateTwice(order, "toolu_syn_create_02"));
    });
  }
});

// =========================================================================
// §B — the exported readers
// =========================================================================

describe("AC-STE-696.5 — scanAnnouncements reads each deciding call and result once", () => {
  const call = (t: Transcript, id: string, at: Stamp = NOW(), command = decideCommand(W.be)) =>
    t.use(id, "Bash", { command, description: "run" }, at);
  const lines = (t: Transcript): string[] => t.lines;
  const lineOf = (s: ReturnType<typeof scanAnnouncements>) => s.announcements.map((a) => a.line);

  for (const order of ORDERS) {
    test(`AC-STE-696.5 (${order}) — a result written twice → ONE announcement, at the first copy's line`, () => {
      const r = createReceipt(W.be);
      const [a, b] = stamps(order);
      const t = call(new Transcript(), "toolu_syn_decide_01").result("toolu_syn_decide_01", decideOutput(r), a).result("toolu_syn_decide_01", decideOutput(r), b);
      expect(lineOf(scanAnnouncements(lines(t), SESSION))).toEqual([1]);
    });

    test(`AC-STE-696.5 (${order}) — a deciding call written twice, its result once → ONE announcement`, () => {
      const r = createReceipt(W.be);
      const [a, b] = stamps(order);
      const t = call(call(new Transcript(), "toolu_syn_decide_01", a), "toolu_syn_decide_01", b).result("toolu_syn_decide_01", decideOutput(r));
      expect(lineOf(scanAnnouncements(lines(t), SESSION))).toEqual([2]);
    });
  }

  test("AC-STE-696.5 — the FIRST result copy decides: an errored first copy is not overturned by a later announcing copy → no announcement", () => {
    const r = createReceipt(W.be);
    const t = call(new Transcript(), "toolu_syn_decide_01")
      .result("toolu_syn_decide_01", decideOutput(r), NOW(), true)
      .result("toolu_syn_decide_01", decideOutput(r), null, false);
    expect(lineOf(scanAnnouncements(lines(t), SESSION))).toEqual([]);
  });

  test("AC-STE-696.5 — a later errored copy of an announcing result takes nothing away → one announcement", () => {
    const r = createReceipt(W.be);
    const t = call(new Transcript(), "toolu_syn_decide_01")
      .result("toolu_syn_decide_01", decideOutput(r))
      .result("toolu_syn_decide_01", decideOutput(r), null, true);
    expect(lineOf(scanAnnouncements(lines(t), SESSION))).toEqual([1]);
  });

  test("AC-STE-696.7 — twin: two DISTINCT deciding calls announcing the same receipt → two announcements", () => {
    const r = createReceipt(W.be);
    const t = call(call(new Transcript(), "toolu_syn_decide_01"), "toolu_syn_decide_02")
      .result("toolu_syn_decide_01", decideOutput(r))
      .result("toolu_syn_decide_02", decideOutput(r));
    expect(lineOf(scanAnnouncements(lines(t), SESSION))).toEqual([2, 3]);
  });

  test("AC-STE-696.5 — a REJECTED deciding command written twice under one id is reported once; under two ids, twice", () => {
    const rejected = `cd "${W.be}" && ${decideCommand(W.be)}`;
    const one = call(call(new Transcript(), "toolu_syn_rejected_01", NOW(), rejected), "toolu_syn_rejected_01", null, rejected);
    const two = call(call(new Transcript(), "toolu_syn_rejected_01", NOW(), rejected), "toolu_syn_rejected_02", null, rejected);
    expect({
      once: scanAnnouncements(lines(one), SESSION).rejected.length,
      twice: scanAnnouncements(lines(two), SESSION).rejected.length,
    }).toEqual({ once: 1, twice: 2 });
  });
});

// ------------------------------------------------------------ firstCopies

interface FirstCopy {
  block: Record<string, unknown>;
  record: Record<string, unknown>;
  line: number;
  at: number | null;
}
type FirstCopiesFn = (records: ReadonlyArray<unknown>) => FirstCopy[];

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:10:00.000Z";
const T2 = "2026-01-01T00:20:00.000Z";
const ms = (iso: string): number => Date.parse(iso);

/** Records for the helper, one per line; `undefined` id writes an id-less block. */
const H = {
  use: (id: string | undefined, at: Stamp, command = "cmd"): Record<string, unknown> => {
    const block: Record<string, unknown> = { type: "tool_use", name: "Bash", input: { command } };
    if (id !== undefined) block.id = id;
    const r: Record<string, unknown> = { type: "assistant", message: { role: "assistant", content: [block] } };
    if (at !== null) r.timestamp = at;
    return r;
  },
  uses: (ids: string[], at: Stamp): Record<string, unknown> => {
    const r: Record<string, unknown> = {
      type: "assistant",
      message: { role: "assistant", content: ids.map((id) => ({ type: "tool_use", id, name: "Bash", input: { command: id } })) },
    };
    if (at !== null) r.timestamp = at;
    return r;
  },
  result: (id: string, isError: boolean, text: string, at: Stamp = T0): Record<string, unknown> => {
    const r: Record<string, unknown> = {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] },
    };
    if (at !== null) r.timestamp = at;
    return r;
  },
};

/** The helper's tool_use / tool_result entries, reduced to what the rule decides. */
function view(fc: FirstCopiesFn, records: ReadonlyArray<unknown>): unknown[] {
  return fc(records)
    .filter((e) => e.block.type === "tool_use" || e.block.type === "tool_result")
    .map((e) =>
      e.block.type === "tool_use"
        ? { use: (e.block.id as string | undefined) ?? null, line: e.line, at: e.at, command: (e.block.input as { command?: unknown } | undefined)?.command ?? null }
        : { result: e.block.tool_use_id, line: e.line, isError: e.block.is_error === true, text: e.block.content },
    );
}

interface HelperScenario {
  ac: string;
  name: string;
  records: ReadonlyArray<unknown>;
  expected: unknown[];
}

const use = (id: string | null, line: number, at: string | null, command = "cmd") => ({ use: id, line, at: at === null ? null : ms(at), command });

const HELPER_SCENARIOS: readonly HelperScenario[] = [
  {
    ac: "AC-STE-696.2",
    name: "timed copy then untimed copy (one id) → one call at the earliest line, the first copy's block and stamp",
    records: [H.use("toolu_syn_a", T0, "first"), H.use("toolu_syn_a", null, "second")],
    expected: [use("toolu_syn_a", 0, T0, "first")],
  },
  {
    ac: "AC-STE-696.2",
    name: "untimed copy then timed copy (one id) → one call at the EARLIEST line, stamped by the timed copy",
    records: [H.use("toolu_syn_a", null, "first"), H.use("toolu_syn_a", T1, "second")],
    expected: [use("toolu_syn_a", 0, T1, "first")],
  },
  {
    ac: "AC-STE-696.2",
    name: "an unparseable stamp on the first copy → the first PARSEABLE stamp",
    records: [H.use("toolu_syn_a", "not-a-date"), H.use("toolu_syn_a", T1)],
    expected: [use("toolu_syn_a", 0, T1)],
  },
  {
    ac: "AC-STE-696.2",
    name: "two timed copies, the first stamped LATER → the first copy's stamp",
    records: [H.use("toolu_syn_a", T2), H.use("toolu_syn_a", T1)],
    expected: [use("toolu_syn_a", 0, T2)],
  },
  {
    ac: "AC-STE-696.2",
    name: "three copies (untimed, untimed, timed) → one call at line 0 with the third copy's stamp",
    records: [H.use("toolu_syn_a", null), H.use("toolu_syn_a", null), H.use("toolu_syn_a", T2)],
    expected: [use("toolu_syn_a", 0, T2)],
  },
  {
    ac: "AC-STE-696.2",
    name: "two id-LESS calls are never merged",
    records: [H.use(undefined, T0), H.use(undefined, null)],
    expected: [use(null, 0, T0), use(null, 1, null)],
  },
  {
    ac: "AC-STE-696.2",
    name: "two calls with an EMPTY id are never merged",
    records: [H.use("", T0), H.use("", null)],
    expected: [use("", 0, T0), use("", 1, null)],
  },
  {
    ac: "AC-STE-696.7",
    name: "twin: two DISTINCT ids are two calls",
    records: [H.use("toolu_syn_a", T0), H.use("toolu_syn_b", null)],
    expected: [use("toolu_syn_a", 0, T0), use("toolu_syn_b", 1, null)],
  },
  {
    ac: "AC-STE-696.2",
    name: "a result written twice is graded once — the first copy (non-error) decides",
    records: [H.use("toolu_syn_a", T0), H.result("toolu_syn_a", false, "first"), H.result("toolu_syn_a", true, "second", null)],
    expected: [use("toolu_syn_a", 0, T0), { result: "toolu_syn_a", line: 1, isError: false, text: "first" }],
  },
  {
    ac: "AC-STE-696.2",
    name: "a result written twice is graded once — the first copy (errored) decides",
    records: [H.use("toolu_syn_a", T0), H.result("toolu_syn_a", true, "first", null), H.result("toolu_syn_a", false, "second")],
    expected: [use("toolu_syn_a", 0, T0), { result: "toolu_syn_a", line: 1, isError: true, text: "first" }],
  },
  {
    ac: "AC-STE-696.2",
    name: "results for DISTINCT ids are each graded",
    records: [H.result("toolu_syn_a", false, "a"), H.result("toolu_syn_b", true, "b")],
    expected: [
      { result: "toolu_syn_a", line: 0, isError: false, text: "a" },
      { result: "toolu_syn_b", line: 1, isError: true, text: "b" },
    ],
  },
  {
    ac: "AC-STE-696.2",
    name: "first copies come out in transcript order; a later copy holds no place of its own",
    records: [H.use("toolu_syn_a", T0), H.use("toolu_syn_b", T1), H.use("toolu_syn_a", null), H.result("toolu_syn_b", false, "b"), H.result("toolu_syn_a", false, "a")],
    expected: [
      use("toolu_syn_a", 0, T0),
      use("toolu_syn_b", 1, T1),
      { result: "toolu_syn_b", line: 3, isError: false, text: "b" },
      { result: "toolu_syn_a", line: 4, isError: false, text: "a" },
    ],
  },
  {
    ac: "AC-STE-696.2",
    name: "an unparseable line (null) and a non-object record keep their index; neither yields a block",
    records: [null, 42, H.use("toolu_syn_a", T0)],
    expected: [use("toolu_syn_a", 2, T0)],
  },
  {
    ac: "AC-STE-696.2",
    name: "two calls in one record, then a copy of the first → both at line 0, in position order",
    records: [H.uses(["toolu_syn_x", "toolu_syn_y"], T0), H.use("toolu_syn_x", null, "copy")],
    expected: [use("toolu_syn_x", 0, T0, "toolu_syn_x"), use("toolu_syn_y", 0, T0, "toolu_syn_y")],
  },
];

/** The shipped helper, or a thrower naming its absence (so every helper scenario reds before the fix). */
function helperOf(mod: Record<string, unknown>): FirstCopiesFn {
  const fc = mod.firstCopies;
  if (typeof fc !== "function") {
    return () => {
      throw new Error("session.ts exports no `firstCopies` function");
    };
  }
  return fc as FirstCopiesFn;
}

describe("AC-STE-696.2 — the session library exports ONE helper applying the STE-695 rule", () => {
  test("AC-STE-696.2 — session.ts exports `firstCopies` as a function", () => {
    expect(typeof (sessionLib as Record<string, unknown>).firstCopies).toBe("function");
  });

  for (const s of HELPER_SCENARIOS) {
    test(`${s.ac} — ${s.name}`, () => {
      expect(view(helperOf(sessionLib as Record<string, unknown>), s.records)).toEqual(s.expected);
    });
  }

  test("AC-STE-696.2 — each entry carries the record its first copy sits in", () => {
    const first = H.use("toolu_syn_a", null, "first");
    const second = H.use("toolu_syn_a", T1, "second");
    const entries = helperOf(sessionLib as Record<string, unknown>)([first, second]).filter((e) => e.block.type === "tool_use");
    expect(entries.length).toBe(1);
    expect(entries[0]!.record).toEqual(first);
  });
});

// ------------------------------------------------------- the Skill scanner

const SUBJECT = "dev-process-toolkit:tdd";
const INF = Number.POSITIVE_INFINITY;

const R = {
  skill: (id: string | undefined, at: Stamp): string => {
    const block: Record<string, unknown> = { type: "tool_use", name: "Skill", input: { skill: SUBJECT } };
    if (id !== undefined) block.id = id;
    const record: Record<string, unknown> = { type: "assistant", message: { content: [block] } };
    if (at !== null) record.timestamp = at;
    return JSON.stringify(record);
  },
  result: (id: string, isError: boolean, content = ""): string =>
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] } }),
};

type RequireFn = typeof requireSkillToolUse;

interface Observed {
  found: boolean;
  windows: unknown[] | null;
}

/** Run `req` over `records`; capture what the scanner handed the spy receipt leg (STE-695 §B). */
function observe(req: RequireFn, records: readonly string[]): Observed {
  const dir = spyDir();
  seq += 1;
  const file = join(dir, `spy-${seq}.jsonl`);
  writeFileSync(file, records.map((l) => `${l}\n`).join(""));
  const seen: unknown[][] = [];
  const target = {
    roots: ["/synthetic/ste696/root"],
    receiptLeg: (...args: unknown[]) => {
      seen.push(args);
      return null;
    },
    announcesReceipts: announcesGateReceipt,
  } as unknown as EvidenceTarget;
  const payload: HookPayload = { session_id: SESSION, transcript_path: file, cwd: dir, hook_event_name: "PreToolUse" };
  const { found } = req(SUBJECT, "ste696-probe", payload, target);
  const args = seen[0];
  return { found, windows: args === undefined ? null : Array.isArray(args[1]) ? (args[1] as unknown[]) : [] };
}

let SPY_DIR = "";
function spyDir(): string {
  if (SPY_DIR === "") SPY_DIR = tempDir("spy");
  return SPY_DIR;
}

const win = (start: string, end: string | null, startLine: number, endLine: number) => ({
  start: ms(start),
  end: end === null ? INF : ms(end),
  startLine,
  endLine,
});

interface SpyScenario {
  ac: string;
  name: string;
  run: (req: RequireFn) => { actual: unknown; expected: unknown };
}

const SPY_SCENARIOS: readonly SpyScenario[] = [
  {
    ac: "AC-STE-696.4",
    name: "an is_error copy AFTER a non-error result for the same id no longer retires the Skill call",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_syn_skill_01", T0), R.result("toolu_syn_skill_01", false), R.result("toolu_syn_skill_01", true)]).found,
      expected: true,
    }),
  },
  {
    ac: "AC-STE-696.4",
    name: "the same, with the Skill call itself written twice (untimed first) → still standing, one window",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_syn_skill_01", null),
        R.skill("toolu_syn_skill_01", T0),
        R.result("toolu_syn_skill_01", false),
        R.result("toolu_syn_skill_01", true),
      ]);
      return { actual: { found: o.found, windows: o.windows }, expected: { found: true, windows: [win(T0, null, 0, INF)] } };
    },
  },
  {
    ac: "AC-STE-696.4",
    name: "an is_error FIRST result still retires the call, whatever a later copy says",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_syn_skill_01", T0), R.result("toolu_syn_skill_01", true), R.result("toolu_syn_skill_01", false)]).found,
      expected: false,
    }),
  },
  {
    ac: "AC-STE-696.4",
    name: "a single is_error result still retires the call",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_syn_skill_01", T0), R.result("toolu_syn_skill_01", true)]).found,
      expected: false,
    }),
  },
  {
    ac: "AC-STE-696.3",
    name: "a Skill call written twice (timed first) is one call: one window, never closed by its own copy",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_syn_skill_01", T0), R.skill("toolu_syn_skill_01", null)]).windows,
      expected: [win(T0, null, 0, INF)],
    }),
  },
  {
    ac: "AC-STE-696.3",
    name: "two id-LESS Skill calls are never merged: the untimed one closes the window",
    run: (req) => ({
      actual: observe(req, [R.skill(undefined, T0), R.skill(undefined, null)]).windows,
      expected: [win(T0, null, 0, 1)],
    }),
  },
];

describe("AC-STE-696.3 / .4 — scanSkillCalls reads through the helper and grades a Skill result once per id", () => {
  for (const s of SPY_SCENARIOS) {
    test(`${s.ac} — ${s.name}`, () => {
      const { actual, expected } = s.run(requireSkillToolUse);
      expect(actual).toEqual(expected);
    });
  }
});

// =========================================================================
// AC-STE-696.3 / .9 — one rule, one home
// =========================================================================

/** The body of top-level function `name` in `src`: from its declaration to its closing `\n}\n`. */
function functionRegion(src: string, name: string): { from: number; to: number } {
  const m = new RegExp(`\\n(?:export\\s+)?function\\s+${name}\\s*[<(]`).exec(src);
  if (m === null) throw new Error(`no top-level function ${name} in the source`);
  const from = m.index;
  const close = src.indexOf("\n}\n", from);
  if (close < 0) throw new Error(`function ${name} has no closing \\n}\\n`);
  return { from, to: close + 2 };
}
const body = (src: string, name: string): string => {
  const { from, to } = functionRegion(src, name);
  return src.slice(from, to);
};
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

describe("AC-STE-696.3 / .9 — the tracker gate keeps no private copy of the rule", () => {
  test("AC-STE-696.3 — scanSkillCalls calls firstCopies( exactly once", () => {
    expect(count(body(readFileSync(SESSION_TS, "utf-8"), "scanSkillCalls"), /\bfirstCopies\(/g)).toBe(1);
  });

  test("AC-STE-696.9 — the gate imports firstCopies from the session library and defines no copy of its own", () => {
    const gate = readFileSync(GATE_TS, "utf-8");
    expect(gate).toMatch(/import\s*\{[^}]*\bfirstCopies\b[^}]*\}\s*from\s*"\.\.\/session\.ts"/);
    expect(gate).not.toMatch(/\b(?:function\s+(?:firstCopies|recordTimestamp)\b|(?:const|let)\s+(?:firstCopies|recordTimestamp)\s*=)/);
  });

  for (const fn of ["scanAnnouncements", "createsBefore", "priorCreates"]) {
    test(`AC-STE-696.9 — ${fn} iterates the helper's view: one firstCopies( call, no raw block walk of its own`, () => {
      const text = body(readFileSync(GATE_TS, "utf-8"), fn);
      expect({
        firstCopies: count(text, /\bfirstCopies\(/g),
        rawBlocks: count(text, /\.blocks\b/g),
        contentBlocks: count(text, /\bcontentBlocks\(/g),
      }).toEqual({ firstCopies: 1, rawBlocks: 0, contentBlocks: 0 });
    });
  }

  test("AC-STE-696.9 — the session library still reads the transcript file exactly once", () => {
    const src = readFileSync(SESSION_TS, "utf-8");
    expect(count(src, /readFileSync\(/g)).toBe(1);
    const helper = body(src, "firstCopies");
    expect(helper).not.toMatch(/\b(?:readFileSync|readFile|openSync|createReadStream|Bun\.file|readTranscriptLines)\s*\(/);
  });
});

// =========================================================================
// §C — AC-STE-696.8: every mutation of the fix reddens at least one named test
// =========================================================================

// ------------------------------------------------- session.ts mutations

/** STE-695's scanner region: `\nfunction recordTimestamp(` .. `\nexport function findSkillToolUse(`. */
function scanRegion(src: string): { from: number; to: number } {
  const from = src.indexOf("\nfunction recordTimestamp(");
  const to = src.indexOf("\nexport function findSkillToolUse(");
  if (from < 0 || to < 0 || to <= from) throw new Error("mutation: session.ts has no recordTimestamp … findSkillToolUse region");
  return { from, to };
}

const SESSION_MUTATIONS: Record<string, (src: string) => string> = {
  "merge id-less records (the id derivation `? block.id : null` → a shared key)": (src) => {
    const { from, to } = scanRegion(src);
    return mutateInRegion(src, from, to, "? block.id : null", '? block.id : "__idless__"', { label: "the id derivation" });
  },
  "keep the latest copy's line instead of the earliest": (src) => {
    const { from, to } = scanRegion(src);
    const decls = [...src.slice(from, to).matchAll(/(?:const|let)\s+(\w+)\s*=[^;\n]*\b\w+\.get\(id\)[^;\n]*;/g)];
    if (decls.length !== 1) throw new Error(`mutation: expected one single-line \`const|let <v> = … .get(id) …;\` in the region, found ${decls.length}`);
    const decl = decls[0]![0];
    const v = decls[0]![1]!;
    return mutateInRegion(src, from, to, decl, `${decl}\n        if (${v} !== undefined) ${v}.line = index;`, { label: "after the collapse lookup" });
  },
  "grade a second result for one id (the graded-ids guard → false)": (src) => {
    const { from, to } = scanRegion(src);
    const hits = [...src.slice(from, to).matchAll(/\b(\w+)\.has\(block\.tool_use_id\)/g)].filter((m) => m[1] !== "minting");
    if (hits.length !== 1) throw new Error(`mutation: expected exactly one non-\`minting\` \`<set>.has(block.tool_use_id)\` in the region, found ${hits.length}`);
    return mutateInRegion(src, from, to, hits[0]![0], "false", { label: "the graded-ids guard" });
  },
};

/** The named session-library scenarios `mod` fails (helper scenarios + Skill-scanner scenarios). */
function failingSession(mod: Record<string, unknown>): string[] {
  const out: string[] = [];
  const fc = helperOf(mod);
  for (const s of HELPER_SCENARIOS) {
    try {
      if (!Bun.deepEquals(view(fc, s.records), s.expected)) out.push(`${s.ac} — ${s.name}`);
    } catch {
      out.push(`${s.ac} — ${s.name}`);
    }
  }
  const req = mod.requireSkillToolUse as RequireFn;
  for (const s of SPY_SCENARIOS) {
    try {
      const { actual, expected } = s.run(req);
      if (!Bun.deepEquals(actual, expected)) out.push(`${s.ac} — ${s.name}`);
    } catch {
      out.push(`${s.ac} — ${s.name}`);
    }
  }
  return out;
}

describe("AC-STE-696.8 — each session-library mutation reddens at least one named test", () => {
  for (const [name, mutate] of Object.entries(SESSION_MUTATIONS)) {
    test(`AC-STE-696.8 — ${name}: killed by a scenario green on the shipped source`, async () => {
      const src = readFileSync(SESSION_TS, "utf-8");
      const mutated = mutate(src);
      expect(mutated).not.toBe(src);
      const dir = tempDir("session-mutant");
      seq += 1;
      const file = join(dir, `session-mutant-${seq}.ts`);
      writeFileSync(file, mutated);
      const mutant = (await import(file)) as Record<string, unknown>;
      const baseline = new Set(failingSession(sessionLib as Record<string, unknown>));
      const killedBy = failingSession(mutant).filter((n) => !baseline.has(n));
      if (killedBy.length === 0) {
        throw new Error(`${name} survived: no named scenario green on the shipped source goes red under it. Shipped-source failures: ${[...baseline].join(" | ") || "none"}`);
      }
      expect(killedBy.length).toBeGreaterThan(0);
    });
  }
});

// ------------------------------------------------------- gate mutations

/** The passthrough a gate mutant reads instead of the helper: every copy, its own line, its own stamp. */
const EVERY_COPY = `

// STE-696 mutation control: no collapse — every copy, at its own line, with its own stamp.
function everyCopy(records: ReadonlyArray<unknown>): Array<{ block: Record<string, unknown>; record: Record<string, unknown>; line: number; at: number | null }> {
  const out: Array<{ block: Record<string, unknown>; record: Record<string, unknown>; line: number; at: number | null }> = [];
  records.forEach((record, line) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return;
    const r = record as Record<string, unknown>;
    const stamp = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : Number.NaN;
    const at = Number.isFinite(stamp) ? stamp : null;
    const content = (r.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b !== null && typeof b === "object" && !Array.isArray(b)) out.push({ block: b as Record<string, unknown>, record: r, line, at });
    }
  });
  return out;
}
`;

function gateMutation(fn: string): (src: string) => string {
  return (src) => {
    const { from, to } = functionRegion(src, fn);
    return mutateInRegion(src, from, to, "firstCopies(", "everyCopy(", { label: `the collapse in ${fn}` }) + EVERY_COPY;
  };
}

const GATE_MUTATIONS: Record<string, (src: string) => string> = {
  "remove the collapse from the announcement scan (scanAnnouncements)": gateMutation("scanAnnouncements"),
  "remove the collapse from the spending create walk (createsBefore)": gateMutation("createsBefore"),
  "remove the collapse from the prior-create walk (priorCreates)": gateMutation("priorCreates"),
};

/** A copy of templates/ with adapters/ symlinked to the real tree; returns the copy's gate module path. */
function gateCopy(label: string, gateSource?: string): string {
  const root = join(tempDir(`gate-${label}`), "plugin");
  cpSync(join(PLUGIN_ROOT, "templates"), join(root, "templates"), { recursive: true });
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(root, "adapters"), "dir");
  const module = join(root, GATE_REL);
  if (gateSource !== undefined) writeFileSync(module, gateSource);
  return module;
}

interface GateScenario {
  name: string;
  build: () => Built;
}

const GATE_SCENARIOS: readonly GateScenario[] = [
  { name: "AC-STE-696.1 — a decide result written twice authorises one create", build: () => decideResultTwice("timed-first") },
  { name: "AC-STE-696.6 — one create written twice spends ONE of two receipts", build: () => createTwice("timed-first", "toolu_syn_create_01") },
  { name: "AC-STE-696.6 — a create is ordered by its first copy, not its last", build: () => priorCreateTwice("timed-first", "toolu_syn_create_01") },
];

/** Each gate scenario's outcome under `module`: null when green, the miss otherwise; a crash throws. */
async function gateOutcomes(module: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const s of GATE_SCENARIOS) {
    const built = s.build();
    const r = await runGate(module, built.transcript, built.toolUseId);
    if (crashed(r)) throw new Error(`load-error: ${s.name} — the module under test crashed rather than deciding:\n${show(r)}`);
    out.set(s.name, verdictMiss(r, built.verdict));
  }
  return out;
}

describe("AC-STE-696.8 — each gate-walk mutation reddens at least one named test", () => {
  let baseline: Map<string, string | null> | null = null;
  const unmutated = async (): Promise<Map<string, string | null>> => {
    if (baseline === null) baseline = await gateOutcomes(gateCopy("unmutated"));
    return baseline;
  };

  // The apparatus first: a copy that decided differently from the shipped
  // module would make every kill below a statement about the copy.
  test("AC-STE-696.8 — apparatus: the unmutated templates copy decides every gate scenario exactly as the shipped module does", async () => {
    const shipped = await gateOutcomes(GATE_TS);
    const copy = await unmutated();
    const verdicts = (m: Map<string, string | null>) => [...m].map(([n, miss]) => [n, miss === null ? "green" : miss.split("\n")[0]]);
    expect(verdicts(copy)).toEqual(verdicts(shipped));
  });

  for (const [name, mutate] of Object.entries(GATE_MUTATIONS)) {
    test(`AC-STE-696.8 — ${name}: killed by a scenario green on the unmutated copy`, async () => {
      const base = await unmutated();
      const src = readFileSync(GATE_TS, "utf-8");
      const mutated = mutate(src);
      expect(mutated).not.toBe(src);
      const greens = [...base].filter(([, miss]) => miss === null).map(([n]) => n);
      const mutant = await gateOutcomes(gateCopy("mutant", mutated));
      const killedBy = greens.filter((n) => mutant.get(n) !== null);
      if (killedBy.length === 0) {
        throw new Error(
          `${name} survived: no named scenario green on the unmutated copy goes red under it. ` +
            `Unmutated-copy failures: ${[...base].filter(([, m]) => m !== null).map(([n]) => n).join(" | ") || "none"}`,
        );
      }
      expect(killedBy.length).toBeGreaterThan(0);
    });
  }
});

// AC-STE-696.10 is the full-suite gate (`bun test` from plugins/dev-process-toolkit,
// 0 failures, skip identities equal to the trunk baseline by name); the
// orchestrator grades it.

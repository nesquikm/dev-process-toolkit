// STE-695 (M_b1c081) — one tool call written twice is read as one call.
//
// The field report: Claude Code wrote one Skill tool_use twice — once with a
// record timestamp, once without — under the SAME tool_use id. The session
// library's `scanSkillCalls` pushed one call per RECORD, so the untimed copy
// entered `lineBounds` and closed its own call's window before the receipt
// announcement; the commit was refused as `between-windows`. With the copies in
// the other order the same transcript was permitted.
//
// Two instruments, both reading the REAL scanner:
//
//   §A  the SHIPPED hook modules (all three command gates) over real transcript
//       files and real, front-door-minted receipts (`writeGateReceipt` spawns
//       the shipped front door — no receipt is hand-written);
//   §B  the scanner's derived shape, observed through a spy `receiptLeg` handed
//       to the exported `requireSkillToolUse` (the M_85e846 r3 pattern): the
//       windows / announcements / misreads / incomplete runs the scanner passes
//       the leg ARE its output, verbatim.
//
// §C — MUTATION CONTRACT (AC-STE-695.8). Each mutation is applied to a temp copy
// of `templates/hooks/_lib/session.ts`, inside the region from
// `\nfunction recordTimestamp(` to `\nexport function findSkillToolUse(` (the
// scanner and anything the fix adds beside it), and REFUSES when its anchor is
// not found exactly once there. The anchors the fix is expected to carry:
//
//   M1 no Skill-call collapse   the earlier copy is looked up with `<map>.get(id)`
//                               (exactly once in the region) → replaced by
//                               `undefined`, so no copy ever finds its twin.
//   M2 id-less calls merged     the id derivation `? block.id : null` (exactly
//                               once) → `? block.id : "__idless__"`, so every
//                               id-less call shares one key.
//   M3 latest line kept         after the single-line declaration
//                               `const|let <v> = … <map>.get(id) …;`, insert
//                               `if (<v> !== undefined) <v>.line = index;`.
//   M4 second mint result       the one `<set>.has(block.tool_use_id)` in the
//      graded                   region whose receiver is NOT `minting` (the
//                               graded-ids guard) → `false`.
//
// A mutant counts as killed only when it reddens a §B scenario that is GREEN
// on the shipped source — so before the fix (when the shipped source itself
// fails the scenarios) no mutation control can pass vacuously.
//
// Every spawn is SERIAL. Every id, path and session id here is synthetic.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import {
  FRONT_DOOR,
  PLUGIN_ROOT,
  forgetAnnouncements,
  mintedAnnouncements,
  writeGateReceipt,
  writeManagedClaudeMd,
} from "./_gate_receipt_fixture";
import { announcesGateReceipt } from "../adapters/_shared/src/gate_receipt";
import {
  requireSkillToolUse,
  type EvidenceTarget,
  type HookPayload,
} from "../templates/hooks/_lib/session";

const SID = "s695-dup-tool-use";
const HOOK_DIR = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks");
const SESSION_TS = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts");

let scratch = "";
let seq = 0;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ste695-dup-")));
});
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// =========================================================================
// §A — the shipped hook modules
// =========================================================================

interface Gate {
  name: string;
  module: string;
  skill: string;
  frontDoorSkill: string;
  command: (repo: string) => string;
  prepare?: (repo: string) => Promise<void>;
}

/** The staged set that raises the /tdd requirement (the STE-650 suite's). */
const TDD_STAGED: Record<string, string> = {
  "package.json": '{"name":"fixture","version":"0.0.0","private":true}\n',
  "specs/frs/STE-1.md": "---\ntitle: STE-1\nstatus: active\n---\n\n# STE-1\n",
  "src/x.ts": "export const x = 1;\n",
  "src/x.test.ts": "// test\n",
};

async function stageTddChange(repo: string): Promise<void> {
  for (const [rel, body] of Object.entries(TDD_STAGED)) {
    const full = join(repo, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", repo, "add", rel], { stdout: "pipe", stderr: "pipe" }).exited;
  }
}

const GATES: readonly Gate[] = [
  {
    name: "pre-commit-gate-check",
    module: join(HOOK_DIR, "pre-commit-gate-check.ts"),
    skill: "dev-process-toolkit:gate-check",
    frontDoorSkill: "gate-check",
    command: (repo) => `git -C ${repo} commit -m x`,
  },
  {
    name: "pre-commit-tdd-orchestrator",
    module: join(HOOK_DIR, "pre-commit-tdd-orchestrator.ts"),
    skill: "dev-process-toolkit:tdd",
    frontDoorSkill: "tdd",
    command: (repo) => `git -C ${repo} commit -m x`,
    prepare: stageTddChange,
  },
  {
    name: "pre-pr-spec-review",
    module: join(HOOK_DIR, "pre-pr-spec-review.ts"),
    skill: "dev-process-toolkit:spec-review",
    frontDoorSkill: "spec-review",
    command: () => "gh pr create --title foo --body bar",
  },
];
const TDD_GATE = GATES.find((g) => g.name === "pre-commit-tdd-orchestrator")!;

/** The `between-windows` sentence (gate_receipt.ts MISS_PROSE["between-windows"]). */
const BETWEEN_WINDOWS = /announced AFTER a \S+ Skill call and BEFORE the next one/;

async function managedRepo(label: string, gate: Gate): Promise<string> {
  seq += 1;
  const dir = join(scratch, `${label}-${seq}`);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd(dir);
  if (gate.prepare) await gate.prepare(dir);
  return dir;
}

/** Mint one receipt through the shipped front door; return its `dpt-receipt:` line. */
function mint(repo: string, gate: Gate): string {
  forgetAnnouncements();
  writeGateReceipt(repo, gate.frontDoorSkill, SID);
  const line = mintedAnnouncements().at(-1);
  if (!line) throw new Error("fixture: the front door announced nothing");
  return line;
}

const HOUR_AGO = (): string => new Date(Date.now() - 3_600_000).toISOString();
const MINT_COMMAND = (gate: Gate): string =>
  `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" ${gate.frontDoorSkill} .`;

/** A Skill tool_use record for `gate`; `at === null` writes the untimed copy. */
function hookSkillCall(gate: Gate, id: string, at: string | null): string {
  const record: Record<string, unknown> = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: gate.skill } }] },
  };
  if (at !== null) record.timestamp = at;
  return JSON.stringify(record);
}

function hookMintCall(gate: Gate, id: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(Date.now() - 1_000).toISOString(),
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: MINT_COMMAND(gate) } }] },
  });
}

function hookMintResult(id: string, announcement: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date().toISOString(),
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: `gate=green\n${announcement}` }] },
  });
}

function writeTranscript(lines: readonly string[]): string {
  seq += 1;
  const file = join(scratch, `t-${seq}.jsonl`);
  writeFileSync(file, lines.map((l) => `${l}\n`).join(""));
  return file;
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGate(gate: Gate, repo: string, transcript: string): Promise<Run> {
  const stdin = JSON.stringify({
    session_id: SID,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: gate.command(repo) },
    tool_use_id: "toolu_dup_gated_never_flushed",
  });
  const proc = Bun.spawn(["bun", "run", gate.module], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: SID },
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const show = (r: Run): string => `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

/**
 * The duplicated-call world, built for `gate`:
 *   copies    "timed-first" | "untimed-first" — the order of the two copies
 *   receipt   "after" (after both copies) | "between" (between them)
 *   secondId  the second record's id: the SAME id (the defect), or a different
 *             one (the refusal twin, AC-STE-695.4)
 */
async function dupWorld(
  gate: Gate,
  copies: "timed-first" | "untimed-first",
  receipt: "after" | "between",
  secondId = "toolu_dup_01",
): Promise<{ repo: string; transcript: string }> {
  const repo = await managedRepo(`${gate.frontDoorSkill}-${copies}-${receipt}`, gate);
  const stamp = HOUR_AGO();
  const first = hookSkillCall(gate, "toolu_dup_01", copies === "timed-first" ? stamp : null);
  const second = hookSkillCall(gate, secondId, copies === "timed-first" ? null : stamp);
  const announced = mint(repo, gate);
  const run = [hookMintCall(gate, "toolu_dup_mint_01"), hookMintResult("toolu_dup_mint_01", announced)];
  const lines = receipt === "after" ? [first, second, ...run] : [first, ...run, second];
  return { repo, transcript: writeTranscript(lines) };
}

// AC-STE-695.1 — the regression, through the gate the field report hit. Its
// title is the one the FR names, verbatim, at top level.
test("a timed call followed by its untimed copy keeps the window open past the receipt", async () => {
  const w = await dupWorld(TDD_GATE, "timed-first", "after");
  const r = await runGate(TDD_GATE, w.repo, w.transcript);
  if (r.exitCode !== 0) throw new Error(`AC-STE-695.1: expected the commit to be allowed (exit 0), got:\n${show(r)}`);
  expect(r.stderr, show(r)).not.toMatch(BETWEEN_WINDOWS);
}, 30_000);

for (const gate of GATES) {
  describe(`AC-STE-695.9 — ${gate.name} reads one call written twice as one call`, () => {
    test(`AC-STE-695.1 / .9 (${gate.name}) — timed copy then untimed copy, receipt after both → exit 0`, async () => {
      const w = await dupWorld(gate, "timed-first", "after");
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
    }, 30_000);

    test(`AC-STE-695.3 / .9 (${gate.name}) — untimed copy then timed copy, receipt after both → exit 0`, async () => {
      const w = await dupWorld(gate, "untimed-first", "after");
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
    }, 30_000);

    test(`AC-STE-695.3 / .9 (${gate.name}) — timed copy first, receipt announced BETWEEN the copies → exit 0`, async () => {
      const w = await dupWorld(gate, "timed-first", "between");
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
    }, 30_000);

    test(`AC-STE-695.3 / .9 (${gate.name}) — untimed copy first, receipt announced BETWEEN the copies → exit 0`, async () => {
      const w = await dupWorld(gate, "untimed-first", "between");
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
    }, 30_000);

    test(`AC-STE-695.4 / .9 (${gate.name}) — refusal twin: the second record carries a DIFFERENT id → exit 2, between-windows`, async () => {
      const w = await dupWorld(gate, "timed-first", "after", "toolu_dup_02");
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr).toContain("Refusing:");
      expect(r.stderr, show(r)).toMatch(BETWEEN_WINDOWS);
    }, 30_000);
  });
}

describe("AC-STE-695.9 — the session library keeps exactly one transcript file read", () => {
  test("AC-STE-695.9 — session.ts carries exactly one readFileSync( call site, and the scanner region reads through readTranscriptLines exactly once", () => {
    const src = readFileSync(SESSION_TS, "utf-8");
    expect((src.match(/readFileSync\(/g) ?? []).length).toBe(1);
    const { from, to } = scanRegion(src);
    const region = src.slice(from, to);
    expect((region.match(/readTranscriptLines\(/g) ?? []).length).toBe(1);
    expect(region).not.toMatch(/\b(?:readFile|openSync|createReadStream|Bun\.file)\s*\(/);
  });

  test("AC-STE-695.9 — each of the three command gates reads the scan through the shared library entry point", () => {
    const uses = Object.fromEntries(
      GATES.map((g) => [g.name, /\b(?:requireSkillToolUse|requireTddEvidence)\(/.test(readFileSync(g.module, "utf-8"))]),
    );
    expect(uses).toEqual({
      "pre-commit-gate-check": true,
      "pre-commit-tdd-orchestrator": true,
      "pre-pr-spec-review": true,
    });
  });
});

// =========================================================================
// §B — the scanner's derived shape, through a spy receipt leg
// =========================================================================

const SUBJECT = "dev-process-toolkit:tdd";
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:10:00.000Z";
const T2 = "2026-01-01T00:20:00.000Z";
const ms = (iso: string): number => Date.parse(iso);
const INF = Number.POSITIVE_INFINITY;
const MINT = `bun run "${FRONT_DOOR}" tdd .`;

/** A synthetic, well-formed announcement — the spy never reads the file. */
const ANNOUNCE = (n: number): string =>
  `dpt-receipt: /synthetic/ste695/receipt-${n}.json sha256:${String(n % 10).repeat(64)}`;

/** One JSONL record per transcript line, so a record's array index IS its line. */
const R = {
  skill: (id: string | undefined, at: string | null): string => {
    const block: Record<string, unknown> = { type: "tool_use", name: "Skill", input: { skill: SUBJECT } };
    if (id !== undefined) block.id = id;
    const record: Record<string, unknown> = { type: "assistant", message: { content: [block] } };
    if (at !== null) record.timestamp = at;
    return JSON.stringify(record);
  },
  result: (id: string, isError: boolean, content: string = ""): string =>
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] },
    }),
  mint: (id: string): string =>
    JSON.stringify({
      type: "assistant",
      timestamp: T1,
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: MINT } }] },
    }),
};

type RequireFn = typeof requireSkillToolUse;

interface Observed {
  found: boolean;
  /** `null` when the leg was never asked (no standing call). */
  windows: unknown[] | null;
  announcements: unknown[];
  misreads: unknown[];
  incomplete: unknown[];
}

/** Run `req` (the shipped or a mutant `requireSkillToolUse`) over `records`; capture what the scanner handed the leg. */
function observe(req: RequireFn, records: readonly string[]): Observed {
  seq += 1;
  const file = join(scratch, `spy-${seq}.jsonl`);
  writeFileSync(file, records.map((l) => `${l}\n`).join(""));
  const seen: unknown[][] = [];
  const target = {
    roots: ["/synthetic/ste695/root"],
    receiptLeg: (...args: unknown[]) => {
      seen.push(args);
      return null;
    },
    announcesReceipts: announcesGateReceipt,
  } as unknown as EvidenceTarget;
  const payload: HookPayload = {
    session_id: SID,
    transcript_path: file,
    cwd: scratch,
    hook_event_name: "PreToolUse",
  };
  const { found } = req(SUBJECT, "ste695-probe", payload, target);
  const args = seen[0];
  const at = (n: number): unknown[] => (args !== undefined && Array.isArray(args[n]) ? (args[n] as unknown[]) : []);
  return {
    found,
    windows: args === undefined ? null : at(1),
    announcements: at(2),
    misreads: at(3),
    incomplete: at(4),
  };
}

const win = (start: string, end: string | null, startLine: number, endLine: number) => ({
  start: ms(start),
  end: end === null ? INF : ms(end),
  startLine,
  endLine,
});

/** Whether announcement line `line` sits inside any window, by transcript line. */
const insideAny = (windows: unknown[] | null, line: number): boolean =>
  (windows ?? []).some((w) => {
    const v = w as { startLine: number; endLine: number };
    return line >= v.startLine && line < v.endLine;
  });

interface Scenario {
  ac: string;
  name: string;
  /** The observed value and the value the AC requires. */
  run: (req: RequireFn) => { actual: unknown; expected: unknown };
}

const SCENARIOS: readonly Scenario[] = [
  // ---------------------------------------------------------------- AC.2
  {
    ac: "AC-STE-695.2",
    name: "timed copy then untimed copy (one id) → ONE window, never closed by its own copy",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T0), R.skill("toolu_dup_01", null)]).windows,
      expected: [win(T0, null, 0, INF)],
    }),
  },
  {
    ac: "AC-STE-695.2",
    name: "untimed copy then timed copy (one id) → ONE window at the EARLIEST line, stamped by the timed copy",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", null), R.skill("toolu_dup_01", T0)]).windows,
      expected: [win(T0, null, 0, INF)],
    }),
  },
  {
    ac: "AC-STE-695.2",
    name: "two timed copies, the first stamped LATER → the first copy's stamp, and the second never bounds it by time",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T2), R.skill("toolu_dup_01", T1)]).windows,
      expected: [win(T2, null, 0, INF)],
    }),
  },
  {
    ac: "AC-STE-695.2",
    name: "an unparseable stamp on the first copy → the first PARSEABLE stamp, at the earliest line",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", "not-a-date"), R.skill("toolu_dup_01", T1)]).windows,
      expected: [win(T1, null, 0, INF)],
    }),
  },
  // ---------------------------------------------------------------- AC.3
  {
    ac: "AC-STE-695.3",
    name: "timed first, receipt announced between the copies → inside the window",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.skill("toolu_dup_01", null),
      ]);
      return { actual: { inside: insideAny(o.windows, 2), announcedAt: o.announcements.map((a) => (a as { line: number }).line) }, expected: { inside: true, announcedAt: [2] } };
    },
  },
  {
    ac: "AC-STE-695.3",
    name: "untimed first, receipt announced between the copies → inside the window",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", null),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.skill("toolu_dup_01", T0),
      ]);
      return { actual: { inside: insideAny(o.windows, 2), announcedAt: o.announcements.map((a) => (a as { line: number }).line) }, expected: { inside: true, announcedAt: [2] } };
    },
  },
  // ---------------------------------------------------------------- AC.4
  {
    ac: "AC-STE-695.4",
    name: "two DISTINCT ids, both timed → two windows, the first closed at the second's line",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T0), R.skill("toolu_dup_02", T1)]).windows,
      expected: [win(T0, T1, 0, 1), win(T1, null, 1, INF)],
    }),
  },
  {
    ac: "AC-STE-695.4",
    name: "a DISTINCT untimed id after a timed call → it still closes the window (the refusal twin's shape)",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T0), R.skill("toolu_dup_02", null)]).windows,
      expected: [win(T0, null, 0, 1)],
    }),
  },
  {
    ac: "AC-STE-695.4",
    name: "two id-LESS calls (timed, untimed) are never merged → the untimed one closes the window",
    run: (req) => ({
      actual: observe(req, [R.skill(undefined, T0), R.skill(undefined, null)]).windows,
      expected: [win(T0, null, 0, 1)],
    }),
  },
  {
    ac: "AC-STE-695.4",
    name: "two calls with an EMPTY id are never merged (only a non-empty id is one call)",
    run: (req) => ({
      actual: observe(req, [R.skill("", T0), R.skill("", null)]).windows,
      expected: [win(T0, null, 0, 1)],
    }),
  },
  // ---------------------------------------------------------------- AC.5
  {
    ac: "AC-STE-695.5",
    name: "an is_error result after the FIRST copy retires the merged call",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T0), R.result("toolu_dup_01", true), R.skill("toolu_dup_01", null)]).found,
      expected: false,
    }),
  },
  {
    ac: "AC-STE-695.5",
    name: "an is_error result after the SECOND copy retires the merged call",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", null), R.skill("toolu_dup_01", T0), R.result("toolu_dup_01", true)]).found,
      expected: false,
    }),
  },
  {
    ac: "AC-STE-695.5",
    name: "a retired duplicated call bounds the previous window ONCE, at its earliest line and by its first stamp",
    run: (req) => ({
      actual: observe(req, [
        R.skill("toolu_dup_00", T0),
        R.skill("toolu_dup_01", T2),
        R.result("toolu_dup_01", true),
        R.skill("toolu_dup_01", T1),
      ]).windows,
      expected: [win(T0, T2, 0, 1)],
    }),
  },
  {
    ac: "AC-STE-695.5",
    name: "a call whose copies are ALL untimed opens no window (and still stands)",
    run: (req) => {
      const o = observe(req, [R.skill("toolu_dup_01", null), R.skill("toolu_dup_01", null)]);
      return { actual: { found: o.found, windows: o.windows }, expected: { found: true, windows: [] } };
    },
  },
  // ---------------------------------------------------------------- AC.6
  {
    ac: "AC-STE-695.6",
    name: "an unresolved duplicated mint is reported ONCE, at its earliest line",
    run: (req) => ({
      actual: observe(req, [R.skill("toolu_dup_01", T0), R.mint("toolu_dup_mint_01"), R.mint("toolu_dup_mint_01")]).incomplete,
      expected: [{ outcome: "unresolved", line: 1, command: MINT }],
    }),
  },
  {
    ac: "AC-STE-695.6",
    name: "a duplicated mint that WAS answered is not reported as running",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
      ]);
      return { actual: { incomplete: o.incomplete, announcedAt: o.announcements.map((a) => (a as { line: number }).line) }, expected: { incomplete: [], announcedAt: [3] } };
    },
  },
  // ---------------------------------------------------------------- AC.7
  {
    ac: "AC-STE-695.7",
    name: "a mint result written twice adds ONE announcement",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
      ]);
      return {
        actual: { announcedAt: o.announcements.map((a) => (a as { line: number }).line), misreads: o.misreads, incomplete: o.incomplete },
        expected: { announcedAt: [2], misreads: [], incomplete: [] },
      };
    },
  },
  {
    ac: "AC-STE-695.7",
    name: "a later ERRORED copy of a decided result adds no incomplete run",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.result("toolu_dup_mint_01", true, ANNOUNCE(1)),
      ]);
      return {
        actual: { announcedAt: o.announcements.map((a) => (a as { line: number }).line), misreads: o.misreads, incomplete: o.incomplete },
        expected: { announcedAt: [2], misreads: [], incomplete: [] },
      };
    },
  },
  {
    ac: "AC-STE-695.7",
    name: "a later copy carrying no announcement adds no misread",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.result("toolu_dup_mint_01", false, "gate=green"),
      ]);
      return {
        actual: { announcedAt: o.announcements.map((a) => (a as { line: number }).line), misreads: o.misreads, incomplete: o.incomplete },
        expected: { announcedAt: [2], misreads: [], incomplete: [] },
      };
    },
  },
  {
    ac: "AC-STE-695.7",
    name: "the FIRST result decides: an errored first result is not overturned by a later announcing copy",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", true, ANNOUNCE(1)),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
      ]);
      return {
        actual: { announcements: o.announcements, misreads: o.misreads, incomplete: o.incomplete },
        expected: { announcements: [], misreads: [], incomplete: [{ outcome: "errored", line: 2 }] },
      };
    },
  },
  {
    ac: "AC-STE-695.7",
    name: "two DISTINCT mints are each graded (the once-per-id rule keys on the id)",
    run: (req) => {
      const o = observe(req, [
        R.skill("toolu_dup_01", T0),
        R.mint("toolu_dup_mint_01"),
        R.result("toolu_dup_mint_01", false, ANNOUNCE(1)),
        R.mint("toolu_dup_mint_02"),
        R.result("toolu_dup_mint_02", false, ANNOUNCE(2)),
      ]);
      return { actual: o.announcements.map((a) => (a as { line: number }).line), expected: [2, 4] };
    },
  },
];

/** The names of the scenarios `req` fails. */
function failing(req: RequireFn): string[] {
  const out: string[] = [];
  for (const s of SCENARIOS) {
    const { actual, expected } = s.run(req);
    if (!Bun.deepEquals(actual, expected)) out.push(`${s.ac} — ${s.name}`);
  }
  return out;
}

describe("STE-695 §B — the scanner reads one call written twice as one call", () => {
  for (const s of SCENARIOS) {
    test(`${s.ac} — ${s.name}`, () => {
      const { actual, expected } = s.run(requireSkillToolUse);
      expect(actual).toEqual(expected);
    });
  }
});

// =========================================================================
// §C — AC-STE-695.8: each mutation reddens at least one named test
// =========================================================================

/** The scanner region: from `function recordTimestamp(` to `export function findSkillToolUse(`. */
function scanRegion(src: string): { from: number; to: number } {
  const from = src.indexOf("\nfunction recordTimestamp(");
  const to = src.indexOf("\nexport function findSkillToolUse(");
  if (from < 0 || to < 0 || to <= from) throw new Error("mutation: session.ts has no recordTimestamp … findSkillToolUse scanner region");
  return { from, to };
}

/** The ONE `<receiver>.get(id)` in the region (M1/M3's site), or a throw. */
function collapseLookup(src: string): { receiver: string; text: string } {
  const { from, to } = scanRegion(src);
  const hits = [...src.slice(from, to).matchAll(/\b(\w+)\.get\(id\)/g)];
  if (hits.length !== 1) throw new Error(`mutation: expected exactly one \`<map>.get(id)\` (the Skill-call collapse lookup) in the scanner region, found ${hits.length}`);
  return { receiver: hits[0]![1]!, text: hits[0]![0] };
}

const MUTATIONS: Record<string, (src: string) => string> = {
  "M1 — remove the Skill-call collapse": (src) => {
    const { from, to } = scanRegion(src);
    const { text } = collapseLookup(src);
    return mutateInRegion(src, from, to, text, "undefined", { label: "M1 the collapse lookup" });
  },
  "M2 — merge id-less calls": (src) => {
    const { from, to } = scanRegion(src);
    return mutateInRegion(src, from, to, "? block.id : null", '? block.id : "__idless__"', { label: "M2 the id derivation" });
  },
  "M3 — keep the latest line instead of the earliest": (src) => {
    const { from, to } = scanRegion(src);
    collapseLookup(src);
    const decls = [...src.slice(from, to).matchAll(/(?:const|let)\s+(\w+)\s*=[^;\n]*\b\w+\.get\(id\)[^;\n]*;/g)];
    if (decls.length !== 1) throw new Error(`mutation: expected one single-line \`const|let <v> = … .get(id) …;\` in the scanner region, found ${decls.length}`);
    const decl = decls[0]![0];
    const v = decls[0]![1]!;
    return mutateInRegion(src, from, to, decl, `${decl}\n        if (${v} !== undefined) ${v}.line = index;`, { label: "M3 after the collapse lookup" });
  },
  "M4 — grade a second mint result": (src) => {
    const { from, to } = scanRegion(src);
    const hits = [...src.slice(from, to).matchAll(/\b(\w+)\.has\(block\.tool_use_id\)/g)].filter((m) => m[1] !== "minting");
    if (hits.length !== 1) throw new Error(`mutation: expected exactly one non-\`minting\` \`<set>.has(block.tool_use_id)\` (the graded-ids guard) in the scanner region, found ${hits.length}`);
    return mutateInRegion(src, from, to, hits[0]![0], "false", { label: "M4 the graded-ids guard" });
  },
};

/** Which named scenario each mutation is expected to redden (for the failure message). */
const EXPECTED_KILL: Record<string, string> = {
  "M1 — remove the Skill-call collapse": "AC-STE-695.2 timed copy then untimed copy",
  "M2 — merge id-less calls": "AC-STE-695.4 two id-LESS calls",
  "M3 — keep the latest line instead of the earliest": "AC-STE-695.2 untimed copy then timed copy / AC-STE-695.3 untimed first",
  "M4 — grade a second mint result": "AC-STE-695.7 a mint result written twice",
};

describe("AC-STE-695.8 — every mutation of the fix reddens at least one named test", () => {
  let dir = "";
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "ste695-mut-")));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    test(`AC-STE-695.8 — ${name}: sited in the shipped scanner and killed by a scenario that is green on the shipped source`, async () => {
      const src = readFileSync(SESSION_TS, "utf-8");
      const mutated = mutate(src);
      expect(mutated).not.toBe(src);
      seq += 1;
      const file = join(dir, `session-mutant-${seq}.ts`);
      writeFileSync(file, mutated);
      const mutant = (await import(file)) as { requireSkillToolUse: RequireFn };
      const baseline = new Set(failing(requireSkillToolUse));
      const killedBy = failing(mutant.requireSkillToolUse).filter((n) => !baseline.has(n));
      if (killedBy.length === 0) {
        throw new Error(
          `${name} survived: no named scenario green on the shipped source goes red under it ` +
            `(expected at least: ${EXPECTED_KILL[name]}). Shipped-source failures: ${[...baseline].join(" | ") || "none"}`,
        );
      }
      expect(killedBy.length).toBeGreaterThan(0);
    }, 30_000);
  }
});

// AC-STE-695.10 is the full-suite gate (`bun test` from plugins/dev-process-toolkit,
// 0 failures, skip identities equal to trunk by name); the orchestrator grades it.

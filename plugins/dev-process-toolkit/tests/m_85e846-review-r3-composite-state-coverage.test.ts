// M_85e846 review ROUND 3 — THE INSTRUMENT, not another sentence.
//
// This is the THIRD consecutive round in which a fix to this refusal surface
// introduced a NEW false-cause state. Rounds 1 and 2 each patched the sentence
// the previous round exposed, and each shipped a fresh one. That pattern is
// evidence about the MEASURING TOOL: the states of this leg are COMPOSITES —
// (what the store holds) × (what the transcript carries) × (what the scanner
// made of it) — and a suite that hand-assembles the third factor can only ever
// grade the sentences someone already thought to write.
//
// ---------------------------------------------------------------------------
// THE PRIMARY FINDING: THE COVERAGE GAP
// ---------------------------------------------------------------------------
//
// `tests/m_85e846-review-r2-announcement-drop-causes.test.ts` — the round-2
// suite, the one commissioned to close this — CANNOT CONSTRUCT any of the four
// states below. Measured in its bytes:
//
//   * it declares exactly TWO window shapes, `WIDE` and `LATE`
//     (r2:314-320), and BOTH carry `endLine: Number.POSITIVE_INFINITY`. A
//     window that never closes has no OUTSIDE in line-space, so no fixture in
//     that file can put an announcement past one;
//   * `dropVouch` (r2:335-372) hands exactly ONE announcement in every branch,
//     so no fixture in that file can produce a context holding two;
//   * §A-§C grade hand-built `VouchContext` literals and NEVER RUN
//     `scanSkillCalls` at all — the function that actually derives windows,
//     announcements and misreads from a transcript, and the function in which
//     HIGH-1's root cause lives.
//
// Its §D does drive the shipped wrapper, and that is why §D is where all eight
// of round 2's sub-states were found. But §D's eight transcripts hold ONE
// standing Skill call each and ONE Bash call each, so §D's window list is
// always `[{startLine: 0, endLine: Infinity}]` too. Every composite is out of
// reach of the whole file.
//
// Patching the four sentences below without fixing that would move the FIFTH
// instance out of reach again. So:
//
//   * EVERY state here is built as a REAL TRANSCRIPT FILE and driven through
//     the shipped `templates/hooks/process/pre-commit-gate-check.sh`;
//   * every fixture control reads its shape back out of the REAL
//     `scanSkillCalls`, by handing `requireSkillToolUse` a spy `receiptLeg` and
//     capturing the arguments the scanner passes it — never by restating the
//     shape the fixture was meant to have;
//   * the shapes constructed are exactly the ones round 2 could not build:
//     a FINITE `endLine`, MULTIPLE windows, a LINE-SPACE HOLE between them,
//     MULTIPLE announcements in one context, and results that ERRORED.
//
// ---------------------------------------------------------------------------
// THE FOUR STATES, and the ordinary operator path into each
// ---------------------------------------------------------------------------
//
// HIGH-1  `outside-window` claims ORDER, and the order claim is FALSE in a
//         line-space hole.
//         ROOT CAUSE, in session.ts:
//             lineBounds = calls.map(call => call.line)          // EVERY call
//             windows    = calls.filter(call => standing(call) && call.at !== null)
//         A non-standing or untimed call contributes a LINE BOUNDARY but opens
//         NO WINDOW. It therefore CLOSES the previous window without opening a
//         replacement, and every announcement between that boundary and the
//         next standing call falls in a hole. `gate_receipt.ts` reads
//         `windows.length !== 0` and refuses with "it was written before the
//         first gate-check Skill call in this session" — about an announcement
//         that came AFTER it.
//         PATH: a second /gate-check that gets interrupted.
//
// HIGH-2  An ERRORED or RESULTLESS front-door run leaves NO VALUE BEHIND.
//         `scanSkillCalls` records a result only on the `is_error !== true`
//         branch, so an interrupted mint contributes neither an announcement
//         nor a misread, and the leg falls through to `nothing-announced`:
//         "no command in this session was read as a run of the … front door" —
//         false of a session in which the operator watched the command run.
//         PATH: ESC during the mint; the receipt is on disk and the
//         announcement is IN the errored result's own text, or the result has
//         not been written to the transcript yet.
//
// HIGH-3  A DETECTED TAMPER is silently DISCARDED when a genuine in-window
//         announcement for the same root also exists. `gateReceiptEvidence`
//         returns `vouched` from inside the window loop and never looks at
//         `reading.dropped`. PERMITTING IS CORRECT there — the gate genuinely
//         ran — but throwing away a detected forgery signal is not.
//         PATH: two gate runs in one session, one receipt rewritten after it
//         was announced.
//
// MEDIUM  Two QUANTITY CLAIMS that nothing establishes:
//           gate_receipt.ts:796  "the only gate receipt this session holds…"
//           gate_receipt.ts:860  "the only receipt a run in this session
//                                 announced…"
//         `readGateStore` sets `otherSubject ??= r.subject` — the FIRST of
//         however many — and `announcedRoots` pushes one `dropped` entry PER
//         announcement. Both sentences say "the only" about a set the code
//         never counted.
//
// OUT OF SCOPE, deliberately: HIGH-4 (`no-window`). Zero of 4,303 real
// transcript records lack a timestamp, so that state is near-unreachable
// outside a forged transcript. It is not graded here.
//
// ---------------------------------------------------------------------------
// FALSIFIABILITY — the instrument must not repeat its own failure
// ---------------------------------------------------------------------------
//
// Round 1 failed because every row expected the same verdict. So:
//
//   * §0 is the CONTROL SECTION. Every control is GREEN TODAY, reads a
//     POSITIVE value out of a SHIPPED reader, and would go red if the fixture
//     stopped having the shape the clause below it claims. No control asserts
//     a zero on its own.
//   * §3 grades the PERMIT direction: HIGH-3's commit must still EXIT 0, and
//     the clean two-announcement permit must stay SILENT. A "fix" that refused
//     the tamper is red; a "fix" that warned on every permit is red.
//   * HIGH-2 is graded in BOTH directions too: the errored run must keep
//     REFUSING (exit 2) — an errored call is not evidence — while no longer
//     claiming nothing was read.
//
// Every receipt is written by SPAWNING the shipped front door. Every spawn is
// SERIAL: no Promise.all over processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import {
  FRONT_DOOR,
  PLUGIN_ROOT,
  clearReceipts,
  forgetAnnouncements,
  mintedAnnouncements,
  receiptsDirOf,
  writeGateReceipt,
} from "./_gate_receipt_fixture";
import {
  announcesGateReceipt,
  gateReceiptEvidence,
  type GateEvidenceReason,
  type ReceiptAnnouncement,
  type VouchWindow,
} from "../adapters/_shared/src/gate_receipt";
import { parseReceiptAnnouncement } from "../adapters/_shared/src/tracker_receipts";
// THE POINT OF THIS SUITE. `scanSkillCalls` is module-private, but the shape it
// derives is handed to `EvidenceTarget.receiptLeg` verbatim — so a spy leg is a
// read of the REAL scanner over a REAL transcript file, which is the one thing
// the round-2 suite never did.
import {
  requireSkillToolUse,
  type EvidenceTarget,
  type HookPayload,
} from "../templates/hooks/_lib/session";

const WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh");
const SUBJECT = "dev-process-toolkit:gate-check";
const T = 300_000;

/**
 * ONE SESSION ID PER STATE. Each is its own receipt store directory, so no
 * state can inherit another's files — the round-2 suite shared one store across
 * eight sub-states and had to restore a tampered file in a `finally` to keep
 * them apart.
 */
const SID = {
  hole: "s85e846-r3-hole",
  errored: "s85e846-r3-errored",
  resultless: "s85e846-r3-resultless",
  tamper: "s85e846-r3-tamper",
  subjects2: "s85e846-r3-subjects2",
  subjects1: "s85e846-r3-subjects1",
  foreign2: "s85e846-r3-foreign2",
  foreign1: "s85e846-r3-foreign1",
} as const;

/** The OTHER sessions whose stores the foreign-store announcements point into. */
const FOREIGN_STORE = ["s85e846-r3-elsewhere-a", "s85e846-r3-elsewhere-b"] as const;

const T0 = new Date(Date.now() - 3_600_000).toISOString();
const T1 = new Date(Date.now() - 3_500_000).toISOString();
const T2 = new Date(Date.now() - 3_400_000).toISOString();

let fx: SpanFixture;
let FE = "";
let BE = "";
let scratch = "";

/** Front-door announcement lines, one per mint, keyed by what they are for. */
const LINE = {
  hole: "",
  errored: "",
  resultless: "",
  tamperFirst: "",
  tamperSecond: "",
  foreignA: "",
  foreignB: "",
};

/** The tampered-state receipt files on disk, and their pristine bytes. */
let tamperFirstPath = "";
let tamperFirstBytes: Buffer = Buffer.alloc(0);

// --------------------------------------------------------------- transcripts

/**
 * A Skill `tool_use` for the subject plus its paired `tool_result`.
 *
 * `errored: true` writes `is_error: true` on the result — the call is RETIRED
 * (`standing()` is false) so it opens no window, yet `calls` still holds it and
 * `lineBounds` still takes its line. That asymmetry IS HIGH-1.
 */
function skillCall(id: string, ts: string | null, errored = false): string[] {
  const record: Record<string, unknown> = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: SUBJECT } }] },
  };
  if (ts !== null) record.timestamp = ts;
  return [
    JSON.stringify(record),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: errored }] },
    }),
  ];
}

/** A Bash `tool_use` with NO result at all — the interrupted / unflushed state. */
function bashCallNoResult(id: string, command: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    }),
  ];
}

/**
 * A Bash `tool_use` and its `tool_result`.
 *
 * ONE ANNOUNCEMENT LINE PER RESULT (the `_gate_receipt_fixture` rule): the
 * front door prints exactly one, so several announcements in one session means
 * several Bash PAIRS, never one result carrying several lines.
 */
function bashCall(id: string, command: string, text: string, errored = false): string[] {
  return [
    ...bashCallNoResult(id, command),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: id, is_error: errored, content: text },
        ],
      },
    }),
  ];
}

let seq = 0;
function transcript(records: readonly string[]): string {
  const file = join(scratch, `t-${seq++}.jsonl`);
  writeFileSync(file, records.join("\n") + "\n");
  return file;
}

// ------------------------------------------------------------------- driver

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Drive the SHIPPED wrapper with a real transcript file and a real payload. */
async function runGate(command: string, transcriptPath: string, sessionId: string): Promise<Run> {
  const payload = {
    transcript_path: transcriptPath,
    cwd: FE,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    session_id: sessionId,
  };
  const proc = Bun.spawn(["/bin/bash", WRAPPER], {
    cwd: FE,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(JSON.stringify(payload)).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const commitBe = (): string => `git -C ${BE} commit -m x`;
const genuineRun = (root: string): string => `bun run "${FRONT_DOOR}" gate-check "${root}"`;

// ------------------------------------------------- the REAL scanner, observed

/** What `scanSkillCalls` derived from one transcript, as the leg receives it. */
interface Scanned {
  /** Every argument the leg was handed, so a new channel cannot hide from us. */
  args: unknown[];
  windows: VouchWindow[];
  announcements: ReceiptAnnouncement[];
  /**
   * Every ARRAY argument after `announcements` — `misreadRuns` today, and any
   * further record channel a fix adds tomorrow. Read as a set rather than by
   * name so the clause grades "a value was left behind", not "a value was left
   * behind in this one field".
   */
  tailRecords: Array<{ line?: unknown }>;
}

/**
 * Run the REAL `scanSkillCalls` over `transcriptPath` and capture what it
 * derived. The spy leg returns `null` (never a miss), so `requireSkillToolUse`
 * writes nothing to stderr and this is a pure read.
 */
function scan(transcriptPath: string, root: string, sessionId: string): Scanned {
  const seen: unknown[][] = [];
  const target = {
    roots: [root],
    receiptLeg: (...args: unknown[]) => {
      seen.push(args);
      return null;
    },
    announcesReceipts: announcesGateReceipt,
  } as unknown as EvidenceTarget;
  const payload: HookPayload = {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: "PreToolUse",
  };
  requireSkillToolUse(SUBJECT, "m_85e846-r3-probe", payload, target);
  const args = seen[0] ?? [];
  const arrayAt = (n: number): unknown[] => (Array.isArray(args[n]) ? (args[n] as unknown[]) : []);
  return {
    args,
    windows: arrayAt(1) as VouchWindow[],
    announcements: arrayAt(2) as ReceiptAnnouncement[],
    tailRecords: args
      .slice(3)
      .flatMap((a) => (Array.isArray(a) ? a : []))
      .filter((r): r is { line?: unknown } => r !== null && typeof r === "object"),
  };
}

// ------------------------------------------------------------------ fixture

function announcementOf(line: string, at: number): ReceiptAnnouncement {
  const parsed = parseReceiptAnnouncement(line);
  if (parsed === null || parsed.digest === null) {
    throw new Error(`front door printed an unparseable announcement: ${line}`);
  }
  return { path: parsed.path, digest: parsed.digest, line: at };
}

const pathOf = (line: string): string => announcementOf(line, 0).path;

/** Mint one receipt through the front door and return the line it printed. */
function mint(root: string, skill: string, sessionId: string): string {
  writeGateReceipt(root, skill, sessionId);
  return mintedAnnouncements().at(-1)!;
}

beforeAll(() => {
  fx = makeSpanFixture("M_85e846r3");
  FE = fx.a;
  BE = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "m85e846-r3-"));

  for (const root of [FE, BE]) {
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture: stack marker");
    writeFileSync(join(root, "README.md"), `# ${root}\n`);
    git(root, "add", "README.md");
  }

  forgetAnnouncements();
  for (const sid of [...Object.values(SID), ...FOREIGN_STORE]) {
    clearReceipts(FE, sid);
    clearReceipts(BE, sid);
  }

  // HIGH-1 / HIGH-2 — one valid, front-door-written gate receipt for BE in each
  // state's own store. Valid on disk in every case: every clause here is about
  // why a VALID receipt went unvouched, and a malformed one refuses with
  // `no-receipt` long before vouching runs.
  LINE.hole = mint(BE, "gate-check", SID.hole);
  LINE.errored = mint(BE, "gate-check", SID.errored);
  LINE.resultless = mint(BE, "gate-check", SID.resultless);

  // HIGH-3 — TWO receipts for BE in one session. The first is announced and
  // then REWRITTEN (the tamper); the second is announced and left intact.
  LINE.tamperFirst = mint(BE, "gate-check", SID.tamper);
  LINE.tamperSecond = mint(BE, "gate-check", SID.tamper);
  tamperFirstPath = pathOf(LINE.tamperFirst);
  tamperFirstBytes = readFileSync(tamperFirstPath);

  // MEDIUM :796 — TWO gate receipts for BE under OTHER subjects and NONE for
  // gate-check: the operator ran /tdd and /spec-review, then tried to commit.
  mint(BE, "tdd", SID.subjects2);
  mint(BE, "spec-review", SID.subjects2);
  // ...and the one-receipt control, where a singular claim is TRUE.
  mint(BE, "tdd", SID.subjects1);

  // MEDIUM :860 — a valid gate receipt for BE in THIS session's store, plus two
  // real receipts filed under OTHER sessions' stores for the transcript to
  // announce (a subagent, a stale CLAUDE_CODE_SESSION_ID export).
  mint(BE, "gate-check", SID.foreign2);
  mint(BE, "gate-check", SID.foreign1);
  LINE.foreignA = mint(BE, "gate-check", FOREIGN_STORE[0]);
  LINE.foreignB = mint(BE, "gate-check", FOREIGN_STORE[1]);
});

afterAll(() => {
  fx?.cleanup();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// =========================================================================
// THE TRANSCRIPTS — each state, as a real session would write it.
// =========================================================================

/**
 * HIGH-1, THE LINE-SPACE HOLE. Line indices matter and are pinned in §0:
 *
 *   0  Skill tu1   standing, timed      → window A, startLine 0
 *   1  result tu1  is_error false
 *   2  Skill tu2   timed, ERRORED       → NO window, but lineBounds takes 2,
 *   3  result tu2  is_error TRUE           which CLOSES window A at line 2
 *   4  Bash b1     the front door for BE
 *   5  result b1   the announcement     → line 5: past A's end, before B's start
 *   6  Skill tu3   standing, timed      → window B, startLine 6
 *   7  result tu3  is_error false
 *
 * The operator ran /gate-check, hit ESC on a second one, minted, then ran a
 * third. Two windows, one of them FINITE, and the announcement in the hole
 * between them — none of which the round-2 suite can build.
 */
const holeRecords = (): string[] => [
  ...skillCall("tu1", T0),
  ...skillCall("tu2", T1, true),
  ...bashCall("b1", genuineRun(BE), LINE.hole),
  ...skillCall("tu3", T2),
];

/** HIGH-2a — the mint ran, printed its line, and the call came back ERRORED. */
const erroredRecords = (): string[] => [
  ...skillCall("tu1", T0),
  ...bashCall("b1", genuineRun(BE), LINE.errored, true),
];

/** HIGH-2b — the mint ran and no result has reached the transcript at all. */
const resultlessRecords = (): string[] => [
  ...skillCall("tu1", T0),
  ...bashCallNoResult("b1", genuineRun(BE)),
];

/** HIGH-3 — two announcements for BE in ONE window; the first file rewritten. */
const twoAnnouncementRecords = (): string[] => [
  ...skillCall("tu1", T0),
  ...bashCall("b1", genuineRun(BE), LINE.tamperFirst),
  ...bashCall("b2", genuineRun(BE), LINE.tamperSecond),
];

/** The MEDIUM rows need only door one satisfied; the store decides the rest. */
const plainSkillRecords = (): string[] => [...skillCall("tu1", T0)];

/** MEDIUM :860 — two announcements, both filed under another session's store. */
const foreignRecords = (lines: readonly string[]): string[] => [
  ...skillCall("tu1", T0),
  ...lines.flatMap((line, n) => bashCall(`b${n}`, genuineRun(BE), line)),
];

/** Run one state through the wrapper, tampering the first receipt if asked. */
async function drive(
  records: readonly string[],
  sessionId: string,
  tamper = false,
): Promise<Run> {
  if (!tamper) return runGate(commitBe(), transcript(records), sessionId);
  try {
    // The rewrite: append a byte, so the file no longer hashes to the digest
    // its own announcement carries. Restored in `finally`, always.
    writeFileSync(tamperFirstPath, Buffer.concat([tamperFirstBytes, Buffer.from("\n")]));
    return await runGate(commitBe(), transcript(records), sessionId);
  } finally {
    writeFileSync(tamperFirstPath, tamperFirstBytes);
  }
}

// ----------------------------------------------------------------- needles

/** The FALSE order claim `outside-window` makes. */
const PREDATES = /written before the first/i;
/** The FALSE command claim `nothing-announced` makes. */
const NOTHING_READ = /no command in this session was read as a run/i;
/** A detected rewrite, named. Alternation so no one wording is load-bearing. */
const TAMPER =
  /rewritten|no longer matches|no longer hashes|changed after|changed since|does not match the announced|tamper/i;
/** A singularity claim, in the shipped wording and its obvious rewordings. */
const CLAIMS_SINGULAR = /\bthe (only|single|sole)\b/i;
/** An honest acknowledgement that there is more than one. */
const SAYS_SEVERAL = /\b(2|two|several|both|multiple)\b/i;

// =========================================================================
// §0 — THE CONTROLS. All GREEN TODAY.
//
// Each one reads a POSITIVE value back out of a SHIPPED reader — the real
// `scanSkillCalls`, or `gateReceiptEvidence`, or the store's own directory —
// and pins the shape the clause below it depends on. None asserts a bare zero.
// If any of these goes red, the sections below are grading something other
// than what they claim, which is exactly how round 1 passed a broken subject.
// =========================================================================

describe("M_85e846 r3 §0 — fixture controls: each state really has the shape claimed", () => {
  test("GREEN TODAY — the HOLE fixture really produces a hole (real scanSkillCalls)", () => {
    const s = scan(transcript(holeRecords()), BE, SID.hole);
    const windows = s.windows;
    const finite = windows.filter((w) => Number.isFinite(w.endLine));
    const a = s.announcements[0];
    expect({
      // TWO windows — the round-2 suite's fixtures produce exactly one.
      windows: windows.length,
      // A FINITE endLine — the shape neither `WIDE` nor `LATE` can express.
      finiteEnds: finite.length,
      firstStart: windows[0]?.startLine,
      firstEnd: windows[0]?.endLine,
      secondStart: windows[1]?.startLine,
      announcements: s.announcements.length,
      announcedAt: a?.line,
      // THE HOLE: past the first window's close, before the second's open.
      inTheHole: a !== undefined && a.line >= windows[0]!.endLine && a.line < windows[1]!.startLine,
      // ...and therefore AFTER the first Skill call, which is the fact that
      // makes `outside-window`'s "written before the first" sentence false.
      afterFirstCall: a !== undefined && a.line > windows[0]!.startLine,
      inAnyWindow: windows.some((w) => a !== undefined && a.line >= w.startLine && a.line < w.endLine),
    }).toEqual({
      windows: 2,
      finiteEnds: 1,
      firstStart: 0,
      firstEnd: 2,
      secondStart: 6,
      announcements: 1,
      announcedAt: 5,
      inTheHole: true,
      afterFirstCall: true,
      inAnyWindow: false,
    });
  });

  test("GREEN TODAY — the ERRORED fixture really is a front-door run that printed its line", () => {
    const file = transcript(erroredRecords());
    const lines = readFileSync(file, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const bash = lines.flatMap((l) => l.message?.content ?? []).find((b: { name?: string }) => b.name === "Bash");
    const result = lines
      .flatMap((l) => l.message?.content ?? [])
      .find((b: { tool_use_id?: string }) => b.tool_use_id === "b1");
    expect({
      // The SHIPPED tokeniser reads the command as a run of the front door.
      readAsFrontDoorRun: announcesGateReceipt(String(bash?.input?.command)),
      // The result IS errored...
      errored: result?.is_error,
      // ...and the genuine announcement is sitting right there in its text.
      carriesAnAnnouncement: parseReceiptAnnouncement(String(result?.content)) !== null,
    }).toEqual({ readAsFrontDoorRun: true, errored: true, carriesAnAnnouncement: true });
  });

  test("GREEN TODAY — the RESULTLESS fixture really has the call and no result for it", () => {
    const file = transcript(resultlessRecords());
    const blocks = readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .flatMap((l) => l.message?.content ?? []);
    expect({
      // Positive half: the front-door call IS in the transcript.
      frontDoorCalls: blocks.filter(
        (b: { name?: string; input?: { command?: string } }) =>
          b.name === "Bash" && announcesGateReceipt(String(b.input?.command)),
      ).length,
      // Paired with it: nothing retired or resolved it.
      resultsForIt: blocks.filter((b: { tool_use_id?: string }) => b.tool_use_id === "b1").length,
    }).toEqual({ frontDoorCalls: 1, resultsForIt: 0 });
  });

  test("GREEN TODAY — the TAMPER fixture hands TWO announcements in ONE window (real scanSkillCalls)", () => {
    const s = scan(transcript(twoAnnouncementRecords()), BE, SID.tamper);
    const w = s.windows[0];
    expect({
      // MULTIPLE ANNOUNCEMENTS in one context — the shape `dropVouch` cannot build.
      announcements: s.announcements.length,
      windows: s.windows.length,
      bothInsideTheWindow:
        w !== undefined && s.announcements.every((a) => a.line >= w.startLine && a.line < w.endLine),
      distinctPaths: new Set(s.announcements.map((a) => a.path)).size,
    }).toEqual({ announcements: 2, windows: 1, bothInsideTheWindow: true, distinctPaths: 2 });
  });

  test("GREEN TODAY — the tamper is REAL and DETECTED, and the second receipt is intact", () => {
    // Read through the SHIPPED verdict, not through a hand-rolled digest: the
    // composite HIGH-3 grades is "a detected forgery AND a genuine vouch", and
    // this proves both halves are what they claim, one at a time.
    const wide: VouchWindow[] = [
      { start: 0, end: Number.POSITIVE_INFINITY, startLine: 0, endLine: Number.POSITIVE_INFINITY },
    ];
    const only = (line: string, at: number): GateEvidenceReason =>
      gateReceiptEvidence(SUBJECT, BE, SID.tamper, {
        windows: wide,
        announcements: [announcementOf(line, at)],
        peerRoots: [FE],
      }).reason;
    try {
      writeFileSync(tamperFirstPath, Buffer.concat([tamperFirstBytes, Buffer.from("\n")]));
      expect({
        rewrittenAlone: only(LINE.tamperFirst, 3),
        intactAlone: only(LINE.tamperSecond, 5),
      }).toEqual({ rewrittenAlone: "announcement-tampered", intactAlone: "receipt-found" });
    } finally {
      writeFileSync(tamperFirstPath, tamperFirstBytes);
    }
  });

  test("GREEN TODAY — the :796 store really holds TWO other-subject receipts and no gate-check one", () => {
    const dir = receiptsDirOf(BE, SID.subjects2);
    const held = readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(join(dir, n), "utf-8")))
      .filter((r) => r.kind === "gate");
    expect({
      otherSubjects: held.filter((r) => r.subject !== SUBJECT).length,
      ownSubject: held.filter((r) => r.subject === SUBJECT).length,
      distinctOthers: new Set(held.filter((r) => r.subject !== SUBJECT).map((r) => r.subject)).size,
      // The control's own control: the one-receipt store really holds one.
      singleStoreOthers: readdirSync(receiptsDirOf(BE, SID.subjects1))
        .filter((n) => n.endsWith(".json"))
        .map((n) => JSON.parse(readFileSync(join(receiptsDirOf(BE, SID.subjects1), n), "utf-8")))
        .filter((r) => r.kind === "gate" && r.subject !== SUBJECT).length,
    }).toEqual({ otherSubjects: 2, ownSubject: 0, distinctOthers: 2, singleStoreOthers: 1 });
  });

  test("GREEN TODAY — the :860 fixture announces TWO receipts, each of another session's store", () => {
    const s = scan(
      transcript(foreignRecords([LINE.foreignA, LINE.foreignB])),
      BE,
      SID.foreign2,
    );
    const one = (line: string): GateEvidenceReason =>
      gateReceiptEvidence(SUBJECT, BE, SID.foreign2, {
        windows: [{ start: 0, end: Number.POSITIVE_INFINITY, startLine: 0, endLine: Number.POSITIVE_INFINITY }],
        announcements: [announcementOf(line, 3)],
        peerRoots: [FE],
      }).reason;
    expect({
      // MULTIPLE ANNOUNCEMENTS, again from the real scanner.
      announcements: s.announcements.length,
      distinctPaths: new Set(s.announcements.map((a) => a.path)).size,
      // Each one is INDIVIDUALLY a foreign-store announcement, by the shipped
      // reader — so the plural state really is two of the singular one.
      aAlone: one(LINE.foreignA),
      bAlone: one(LINE.foreignB),
    }).toEqual({
      announcements: 2,
      distinctPaths: 2,
      aAlone: "announcement-foreign-store",
      bAlone: "announcement-foreign-store",
    });
  });
});

// =========================================================================
// §1 — HIGH-1. `outside-window` states an ORDER it did not measure.
//
// With a hole in line-space, `windows.length !== 0` is true and the
// announcement is in none of them — but it came AFTER the first Skill call,
// not before it. §0 measured that: `afterFirstCall: true`.
// =========================================================================

describe("M_85e846 r3 §1 — HIGH-1: the order claim is false in a line-space hole", () => {
  test("the refusal does NOT say the announcement predates a call it came after", async () => {
    const r = await drive(holeRecords(), SID.hole);
    expect({
      refused: r.exitCode,
      claimsItCameFirst: PREDATES.test(r.stderr),
    }).toEqual({ refused: 2, claimsItCameFirst: false });
  }, T);

  test("the hole gets a DIFFERENT refusal from a genuine predates — two states, two sentences", async () => {
    // The predating fixture: the announcement really is before the only Skill
    // call, where the shipped sentence is TRUE. Both must refuse, and the two
    // refusals must differ — a "fix" that gave both one new shared sentence is
    // red here, which is round 1's failure mode stated as a clause.
    const predates = await drive(
      [...bashCall("b1", genuineRun(BE), LINE.hole), ...skillCall("tu1", T2)],
      SID.hole,
    );
    const hole = await drive(holeRecords(), SID.hole);
    expect({
      predatesRefused: predates.exitCode,
      holeRefused: hole.exitCode,
      // GREEN TODAY half: the true sentence stays true where it was measured.
      predatesKeepsItsClaim: PREDATES.test(predates.stderr),
      sameSentence: predates.stderr === hole.stderr,
    }).toEqual({
      predatesRefused: 2,
      holeRefused: 2,
      predatesKeepsItsClaim: true,
      sameSentence: false,
    });
  }, T);

  test("the hole's refusal does not borrow `nothing-announced`'s claim either", async () => {
    // The other direction a wrong fix could go: re-route the hole onto the
    // runless sentence, which is equally false — a command WAS read as a run
    // and an announcement DID survive.
    const r = await drive(holeRecords(), SID.hole);
    expect(NOTHING_READ.test(r.stderr)).toBe(false);
  }, T);
});

// =========================================================================
// §2 — HIGH-2. An interrupted mint leaves no value behind, so the leg says
// "no command … was read as a run" about a command it read as a run.
// =========================================================================

describe("M_85e846 r3 §2 — HIGH-2: an errored or resultless run is not an absent one", () => {
  test("ERRORED: the refusal does not claim nothing was read as a front-door run", async () => {
    const r = await drive(erroredRecords(), SID.errored);
    expect({
      refused: r.exitCode,
      claimsNothingWasRead: NOTHING_READ.test(r.stderr),
    }).toEqual({ refused: 2, claimsNothingWasRead: false });
  }, T);

  test("RESULTLESS: the refusal does not claim nothing was read as a front-door run", async () => {
    const r = await drive(resultlessRecords(), SID.resultless);
    expect({
      refused: r.exitCode,
      claimsNothingWasRead: NOTHING_READ.test(r.stderr),
    }).toEqual({ refused: 2, claimsNothingWasRead: false });
  }, T);

  test("the ERRORED run still REFUSES — an errored call is not evidence", async () => {
    // The permit direction, stated as a bound. A "fix" that started honouring
    // the announcement inside an errored result would wave this commit through
    // and be red here, even though it would pass the two clauses above.
    const r = await drive(erroredRecords(), SID.errored);
    expect(r.exitCode).toBe(2);
  }, T);

  test("the scanner leaves a RECORD of the errored run behind for the leg to read", () => {
    // The mechanism the two clauses above need: today `scanSkillCalls` records
    // a result ONLY on its `is_error !== true` branch, so the leg is handed
    // nothing at all and cannot tell this session from one where the operator
    // never ran the gate. Read as "some array argument after `announcements`
    // carries a record", so a fix is free to add a channel of its own rather
    // than being pinned to `misreadRuns`.
    const s = scan(transcript(erroredRecords()), BE, SID.errored);
    expect({
      announcementsKept: s.announcements.length,
      recordsLeftBehind: s.tailRecords.length > 0,
    }).toEqual({ announcementsKept: 0, recordsLeftBehind: true });
  });

  test("the RESULTLESS run leaves a record behind too", () => {
    const s = scan(transcript(resultlessRecords()), BE, SID.resultless);
    expect(s.tailRecords.length > 0).toBe(true);
  });

  test("GREEN TODAY — a run that genuinely was NOT read keeps the sentence it is true of", async () => {
    // The truth control. `2>&1 | tail -1` is not a plain front-door invocation,
    // so `announcesGateReceipt` reads it as no run at all — and there the
    // shipped sentence is correct. Without this row, deleting the sentence
    // outright would satisfy §2.
    const piped = `${genuineRun(BE)} 2>&1 | tail -1`;
    expect(announcesGateReceipt(piped)).toBe(false);
    const r = await drive(
      [...skillCall("tu1", T0), ...bashCall("b1", piped, LINE.errored)],
      SID.errored,
    );
    expect({ refused: r.exitCode, keepsItsClaim: NOTHING_READ.test(r.stderr) }).toEqual({
      refused: 2,
      keepsItsClaim: true,
    });
  }, T);

  test("the three runless sub-states render THREE DISTINCT refusals", async () => {
    // Bijection, in miniature: unread / errored / resultless are three things
    // to fix, and one shared sentence for all three is the defect this whole
    // milestone has now shipped three times.
    const piped = `${genuineRun(BE)} 2>&1 | tail -1`;
    const unread = await drive(
      [...skillCall("tu1", T0), ...bashCall("b1", piped, LINE.errored)],
      SID.errored,
    );
    const errored = await drive(erroredRecords(), SID.errored);
    const resultless = await drive(resultlessRecords(), SID.resultless);
    // The resultless run is graded in its OWN store, so its refusal names a
    // different directory; compare the `Refusing:` sentence with the store path
    // removed, or two rows would differ for a reason that is not the cause.
    const shape = (r: Run): string =>
      r.stderr.replace(/\/\S*\.dpt\/\S*/g, "<store>").replace(/\/\S*m_85e846r3\S*/g, "<root>");
    expect({
      distinct: new Set([shape(unread), shape(errored), shape(resultless)]).size,
    }).toEqual({ distinct: 3 });
  }, T);
});

// =========================================================================
// §3 — HIGH-3. A detected forgery, thrown away because the gate also ran.
//
// PERMITTING IS CORRECT: a genuine in-window announcement for this checkout
// exists, so the gate really did run against it. What is not correct is
// discarding `reading.dropped` — a receipt of this session was rewritten
// after it was announced, and nobody is told.
//
// Both directions are graded: the commit must STILL EXIT 0, and the clean
// two-announcement permit must stay SILENT.
// =========================================================================

describe("M_85e846 r3 §3 — HIGH-3: a detected tamper is reported, and the commit still permits", () => {
  test("PERMIT SURVIVES — a rewritten receipt alongside a genuine one does not refuse", async () => {
    const r = await drive(twoAnnouncementRecords(), SID.tamper, true);
    // GREEN TODAY. Turning this into a refusal would be a false positive: the
    // gate ran, and this clause is the bound that says so.
    expect(r.exitCode).toBe(0);
  }, T);

  test("the detected tamper is REPORTED rather than discarded", async () => {
    const r = await drive(twoAnnouncementRecords(), SID.tamper, true);
    expect({
      permitted: r.exitCode,
      reportsTheRewrite: TAMPER.test(r.stderr + r.stdout),
    }).toEqual({ permitted: 0, reportsTheRewrite: true });
  }, T);

  test("the report names the receipt that was rewritten", async () => {
    // A warning that does not say WHICH file changed sends the operator to a
    // directory with two receipts in it and no way to tell them apart.
    const r = await drive(twoAnnouncementRecords(), SID.tamper, true);
    const text = r.stderr + r.stdout;
    expect({
      namesTheRewritten: text.includes(tamperFirstPath),
      namesTheIntactOneInstead: text.includes(pathOf(LINE.tamperSecond)) && !text.includes(tamperFirstPath),
    }).toEqual({ namesTheRewritten: true, namesTheIntactOneInstead: false });
  }, T);

  test("GREEN TODAY — the CLEAN two-announcement permit exits 0 and says NOTHING", async () => {
    // The other direction, and the reason §3 is falsifiable at all: a "fix"
    // that warned on every permit, or that printed the tamper text
    // unconditionally, is red here. Same transcript, same two announcements —
    // only the bytes on disk differ.
    const r = await drive(twoAnnouncementRecords(), SID.tamper, false);
    expect({ code: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  }, T);

  test("GREEN TODAY — a tamper with NO genuine announcement still REFUSES by its own name", async () => {
    // The state round 2 already closed, re-pinned: without a surviving
    // announcement there is nothing vouching for the checkout, so the tamper is
    // a refusal and not a warning. A fix that demoted every tamper to a warning
    // would open a hole here.
    const r = await drive(
      [...skillCall("tu1", T0), ...bashCall("b1", genuineRun(BE), LINE.tamperFirst)],
      SID.tamper,
      true,
    );
    expect({ refused: r.exitCode, namesTheTamper: TAMPER.test(r.stderr) }).toEqual({
      refused: 2,
      namesTheTamper: true,
    });
  }, T);
});

// =========================================================================
// §4 — THE MEDIUMs. Two sentences that count to one without counting.
// =========================================================================

describe("M_85e846 r3 §4 — gate_receipt.ts:796: `the only gate receipt this session holds`", () => {
  test("with TWO other-subject receipts, the refusal does not claim there is only one", async () => {
    const r = await drive(plainSkillRecords(), SID.subjects2);
    expect({
      refused: r.exitCode,
      claimsSingular: CLAIMS_SINGULAR.test(r.stderr),
      acknowledgesSeveral: SAYS_SEVERAL.test(r.stderr) || countsBothSubjects(r.stderr),
    }).toEqual({ refused: 2, claimsSingular: false, acknowledgesSeveral: true });
  }, T);

  test("GREEN TODAY — with ONE, it still refuses and still names the gate that IS there", async () => {
    // The truth control: deleting the sentence, or emptying it into a generic
    // "no receipt", is red here. `wrong-subject` exists so the operator is not
    // sent looking for a file that is sitting right there.
    const r = await drive(plainSkillRecords(), SID.subjects1);
    expect({
      refused: r.exitCode,
      namesTheOtherGate: /dev-process-toolkit:tdd/.test(r.stderr),
      // ...and it is NOT reported as an empty store.
      claimsNoReceipt: /holds no dev-process-toolkit:gate-check gate receipt/.test(r.stderr),
    }).toEqual({ refused: 2, namesTheOtherGate: true, claimsNoReceipt: false });
  }, T);
});

/** Does the refusal account for BOTH misfiled gates by name? */
function countsBothSubjects(text: string): boolean {
  return /dev-process-toolkit:tdd/.test(text) && /dev-process-toolkit:spec-review/.test(text);
}

describe("M_85e846 r3 §4 — gate_receipt.ts:860: `the only receipt a run in this session announced`", () => {
  test("with TWO foreign-store announcements, the refusal does not claim there is only one", async () => {
    const r = await drive(foreignRecords([LINE.foreignA, LINE.foreignB]), SID.foreign2);
    expect({
      refused: r.exitCode,
      claimsSingular: CLAIMS_SINGULAR.test(r.stderr),
      acknowledgesSeveral: SAYS_SEVERAL.test(r.stderr),
    }).toEqual({ refused: 2, claimsSingular: false, acknowledgesSeveral: true });
  }, T);

  test("GREEN TODAY — with ONE, it still refuses and still says the store belongs elsewhere", async () => {
    const r = await drive(foreignRecords([LINE.foreignA]), SID.foreign1);
    expect({
      refused: r.exitCode,
      saysAnotherSession: /another session|a different session/i.test(r.stderr),
    }).toEqual({ refused: 2, saysAnotherSession: true });
  }, T);

  test("the two-announcement refusal is not byte-identical to the one-announcement one", async () => {
    // Without this, "stop saying `the only`" satisfies the clause above by
    // making both sentences equally uninformative. One announcement and two are
    // different facts about the session and the sentence has to move.
    const two = await drive(foreignRecords([LINE.foreignA, LINE.foreignB]), SID.foreign2);
    const one = await drive(foreignRecords([LINE.foreignA]), SID.foreign1);
    const shape = (r: Run): string => r.stderr.replace(/\/\S*\.dpt\/\S*/g, "<store>");
    expect(shape(two) === shape(one)).toBe(false);
  }, T);
});

// =========================================================================
// §5 — THE COVERAGE GAP ITSELF, pinned so it cannot reopen.
//
// The finding is not four sentences; it is that the suite that was supposed to
// catch them could not construct their states. These rows pin the constructive
// power this file adds, measured through the REAL scanner, so a later
// simplification that collapses these fixtures back to one-window/one-
// announcement shapes goes red HERE rather than silently three rounds later.
// =========================================================================

describe("M_85e846 r3 §5 — the window shapes round 2 could not build (GREEN TODAY)", () => {
  test("GREEN TODAY — this file constructs a finite endLine, several windows, a hole, and several announcements", () => {
    const hole = scan(transcript(holeRecords()), BE, SID.hole);
    const many = scan(transcript(twoAnnouncementRecords()), BE, SID.tamper);
    expect({
      finiteEndLine: hole.windows.some((w) => Number.isFinite(w.endLine)),
      severalWindows: hole.windows.length > 1,
      aHole: hole.windows.some(
        (w, i) => i + 1 < hole.windows.length && hole.windows[i + 1]!.startLine > w.endLine,
      ),
      severalAnnouncements: many.announcements.length > 1,
      // And the one shape that must NOT have changed: a window still closes at
      // the NEXT call's line, whatever became of that call.
      closedByTheRetiredCall: hole.windows[0]?.endLine === 2,
    }).toEqual({
      finiteEndLine: true,
      severalWindows: true,
      aHole: true,
      severalAnnouncements: true,
      closedByTheRetiredCall: true,
    });
  });

  test("GREEN TODAY — the round-2 suite still declares only unbounded windows (the gap, measured)", () => {
    // Read from the sibling suite's own bytes. This is the finding's evidence,
    // kept executable: if a later round teaches that file to build a bounded
    // window, this row goes red and is the right place to notice.
    const r2 = readFileSync(
      join(PLUGIN_ROOT, "tests", "m_85e846-review-r2-announcement-drop-causes.test.ts"),
      "utf-8",
    );
    const declared = [...r2.matchAll(/endLine:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
    expect({
      // Positive control: the shapes ARE declared there, so a rename does not
      // make this row vacuously green.
      declarations: declared.length > 0,
      bounded: declared.filter((v) => v !== "Number.POSITIVE_INFINITY"),
    }).toEqual({ declarations: true, bounded: [] });
  });
});

// M_85e846 review ROUND 2 — the refusal still reads its cause off a COUNT.
//
// THE FOURTH OCCURRENCE of this milestone's subject, and the third one is in
// b1d5052 — the commit written to remove the second.
//
// b1d5052 replaced a branch on `claimant === null` with a branch on
// `announced.length === 0` (gate_receipt.ts:604):
//
//     const reason = announced.length === 0 ? "nothing-announced" : "outside-window";
//
// That is the SAME defect in a new spelling. `announced` is the OUTPUT of
// `announcedRoots` (gate_receipt.ts:401-419), a FILTER, and a post-filter count
// cannot say why the filter emptied. Reading a cause off a count is the same
// mistake as reconstructing one from a string; only the summary changed.
//
// ---------------------------------------------------------------------------
// THE REAL DROP-REASON SET, derived from the bytes at b1d5052
// ---------------------------------------------------------------------------
//
// `announcedRoots` silently drops a line for THREE independent reasons, each a
// `continue` with no record of itself:
//
//   :409  announcedRoot(a.path, sessionId) === null   the announced path is not
//                                                     a receipt of THIS session's
//                                                     store
//   :413  readFileSync(resolve(a.path)) threw         the file is gone or
//                                                     unreadable
//   :416  receiptDigest(bytes) !== a.digest           THE FILE WAS REWRITTEN
//                                                     AFTER ITS ANNOUNCEMENT —
//                                                     the tamper the whole
//                                                     announcement binding
//                                                     exists to catch
//
// And UPSTREAM, in `templates/hooks/_lib/session.ts`, a Bash call that WAS read
// as a front-door run contributes nothing to `announcements` at all when
// (:560-561) `found.length !== 1` — i.e. its result carried ZERO parseable
// `dpt-receipt:` lines, or TWO or more.
//
// So `announced.length === 0` is true in at least FIVE situations, and the
// sentence it selects —
//
//     "no command in this session was read as a run of the … front door"
//
// — is a positive claim about COMMANDS that is true of exactly ONE of them. In
// the other four a command WAS read as a front-door run; what failed came after.
//
// MEASURED at b1d5052, through the shipped `pre-commit-gate-check.sh`, all five
// render a BYTE-IDENTICAL refusal:
//
//   sub-state                                       reason             sentence
//   ----------------------------------------------  -----------------  --------------------------
//   nothing was read as a front-door run (piped)    nothing-announced  "no command … was read …"
//   a read run whose result carried TWO lines       nothing-announced  "no command … was read …"
//   a read run whose result carried NO line         nothing-announced  "no command … was read …"
//   a read run whose receipt was REWRITTEN after    nothing-announced  "no command … was read …"
//   an announced path outside this session's store  nothing-announced  "no command … was read …"
//
// The tamper row is the worst of the five: the one state the digest check exists
// to detect is reported as "nothing ran", which sends the operator to re-run the
// gate instead of telling them their receipt was rewritten underneath them.
//
// `outside-window` HAS THE SAME SHAPE. A Skill call the transcript gives no
// parseable timestamp to opens NO window (session.ts:577-587 — the state
// AC-STE-614.16 specifies), so with `windows: []` and a non-empty announcement
// list every announcement falls outside every window, and the refusal renders
//
//     "it was written before the first … Skill call in this session"
//
// word for word the false sentence b1d5052 existed to delete — about an
// announcement made AFTER that call. Resurrected in a new state.
//
// ---------------------------------------------------------------------------
// WHY THE ROUND-1 SUITE PASSED ALL OF THIS
// ---------------------------------------------------------------------------
//
// `vouchFor("nothing-ran")` in `m_85e846-review-vouch-cause-diagnostics.test.ts`
// builds the state with `announcements: []` — the single sub-state the sentence
// is TRUE of. The suite never constructs a list that is NON-EMPTY and FILTERS TO
// EMPTY. Every row expects the same verdict AND the same sentence, so nothing in
// it can tell a true sentence from a false one: a one-sided instrument, which is
// the very failure that suite was commissioned to close.
//
// That absence is graded here by name (§C), and every clause below is built so
// the instrument can fail in both directions.
//
// ---------------------------------------------------------------------------
// WHAT IS GRADED, AND HOW
// ---------------------------------------------------------------------------
//
//   §A  Each drop reason is its OWN VALUE on `GateEvidenceReason`, so a caller
//       branches on a value instead of inferring a cause from a count. Graded
//       without reading any prose.
//   §B  `outside-window` splits too: "the announcement predates every window" is
//       not "no call could be placed in time, so there are no windows".
//   §C  THE MISSING CONTROL, by name: a non-empty announcement list that filters
//       to empty is not the same state as an empty one.
//   §D  Each sub-state, at the SHIPPED INJECTION SITE, refuses with its OWN
//       cause and NOT another's — the bijection matrix. This is §4 of the
//       round-1 suite extended so a subject that lies about a sub-state cannot
//       pass: today five states share one sentence and two more share another,
//       so the matrix is red on five rows and green on three.
//   §E  PERMIT + truth controls. The states whose sentences are already TRUE
//       must keep them, and the vouched path must still exit 0. A "fix" that
//       refused everything, or that gave every state one new shared sentence,
//       is red here.
//   §F  Two ungraded surfaces, pinned. BOTH ARE GREEN TODAY and are labelled as
//       such: they close coverage gaps, they do not report defects.
//
// NEEDLES. Each sub-state owns exactly one signature regex, and the matrix
// asserts a BIJECTION: every refusal matches its own and NO other's. The needles
// for the states that ship today are the shipped words verbatim; the needles for
// the states that do not yet exist are alternations of plausible spellings, so a
// correct fix is not held hostage to one wording. The load-bearing half is the
// ABSENCE matrix, which is wording-independent: a state may not borrow a needle
// that belongs to a different state.
//
// Receipts are written by SPAWNING the front door, never hand-rolled. Every
// spawn is SERIAL: no Promise.all over processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  gateReceiptEvidence,
  gateReceiptMiss,
  MISS_PROSE_FOR_TEST,
  type GateEvidenceReason,
  type ReceiptAnnouncement,
  type VouchContext,
  type VouchWindow,
} from "../adapters/_shared/src/gate_receipt";
import { parseReceiptAnnouncement } from "../adapters/_shared/src/tracker_receipts";
import { resolvePrTargetFromPayload } from "../adapters/_shared/src/pr_target_repo";

const WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh");
const SUBJECT = "dev-process-toolkit:gate-check";
const SID = "s85e846-r2";
/** A SECOND session id, so an announcement can name a store that is not ours. */
const SID_OTHER = "s85e846-r2-other";
const T = 300_000;
const PAST = new Date(Date.now() - 3_600_000).toISOString();

let fx: SpanFixture;
let FE = "";
let BE = "";
let scratch = "";

/** The `dpt-receipt:` line the front door printed for each checkout. */
let feLine = "";
let beLine = "";
/** A REAL announcement for a receipt in BE that belongs to ANOTHER session. */
let otherSessionLine = "";

let beAnnouncement: ReceiptAnnouncement;
/** BE's receipt file on disk, and the bytes it was announced with. */
let bePath = "";
let beDigest = "";

// --------------------------------------------------------------- transcripts

/**
 * A Skill `tool_use` for the subject and its non-error result.
 *
 * `ts === null` writes the record with NO `timestamp` key at all — the state
 * `recordTimestamp` (session.ts:423) answers `null` for, which makes the call
 * STANDING (door one is satisfied) but WINDOWLESS (session.ts:582 filters it
 * out of `windows`). That pair is not reachable any other way, and it is the
 * whole of §B's `untimed` row.
 */
function skillCall(id: string, ts: string | null): string[] {
  const record: Record<string, unknown> = {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: SUBJECT } }] },
  };
  if (ts !== null) record.timestamp = ts;
  return [
    JSON.stringify(record),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false }] },
    }),
  ];
}

/** A Bash `tool_use` and the non-error `tool_result` it printed `lines` into. */
function bashCall(id: string, command: string, lines: readonly string[]): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: id, is_error: false, content: lines.join("\n") },
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

async function runGate(command: string, transcriptPath: string): Promise<Run> {
  const payload = {
    transcript_path: transcriptPath,
    cwd: FE,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    session_id: SID,
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
const pipedRun = (root: string): string => `${genuineRun(root)} 2>&1 | tail -1`;

// ------------------------------------------------------------------ fixture

function announcementOf(line: string, at: number): ReceiptAnnouncement {
  const parsed = parseReceiptAnnouncement(line);
  if (parsed === null || parsed.digest === null) {
    throw new Error(`front door printed an unparseable announcement: ${line}`);
  }
  return { path: parsed.path, digest: parsed.digest, line: at };
}

beforeAll(() => {
  fx = makeSpanFixture("M_85e846r2");
  FE = fx.a;
  BE = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "hs1-r2-"));

  for (const root of [FE, BE]) {
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture: stack marker");
    writeFileSync(join(root, "README.md"), `# ${root}\n`);
    git(root, "add", "README.md");
  }

  forgetAnnouncements();
  clearReceipts(FE, SID);
  clearReceipts(BE, SID);
  clearReceipts(BE, SID_OTHER);

  // One front-door-written receipt per checkout, both REAL and VALID on disk:
  // every clause here is about why a VALID receipt went unvouched, so a receipt
  // that failed to parse would grade a different leg entirely.
  writeGateReceipt(FE, "gate-check", SID);
  feLine = mintedAnnouncements().at(-1)!;
  writeGateReceipt(BE, "gate-check", SID);
  beLine = mintedAnnouncements().at(-1)!;

  // A THIRD receipt, minted into BE under a DIFFERENT session id. Its
  // announcement is genuine — the front door printed it — but its path is not a
  // receipt of THIS session's store, so `announcedRoot` answers null for it.
  // Reachable in the field whenever CLAUDE_CODE_SESSION_ID and the hook
  // payload's `session_id` disagree (a subagent, a stale export).
  writeGateReceipt(BE, "gate-check", SID_OTHER);
  otherSessionLine = mintedAnnouncements().at(-1)!;

  beAnnouncement = announcementOf(beLine, 2);
  bePath = beAnnouncement.path;
  beDigest = beAnnouncement.digest;
});

afterAll(() => {
  fx?.cleanup();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ===========================================================================
// §A — every way an announcement is DROPPED is its own VALUE.
//
// Graded on `GateEvidenceReason` alone: no prose is read here. A caller that
// has to read the sentence to learn which drop happened is a caller inferring a
// cause from a string, and a caller that can only read `announced.length` is
// inferring one from a count. Both are the defect.
//
// The three rows below are the three `continue`s in `announcedRoots`, each
// constructed as the filter sees it, plus the one state the empty list really
// means.
// ===========================================================================

/** A window wide enough that placement never decides these rows. */
const WIDE: readonly VouchWindow[] = [
  { start: 0, end: Number.POSITIVE_INFINITY, startLine: 0, endLine: Number.POSITIVE_INFINITY },
];
/** A window that opens AFTER the announcement, so the announcement predates it. */
const LATE: readonly VouchWindow[] = [
  { start: 0, end: Number.POSITIVE_INFINITY, startLine: 10, endLine: Number.POSITIVE_INFINITY },
];

/** The unit-level sub-states: every one reaches `announced.length === 0`… differently. */
type DropCase = "nothing-announced" | "digest-mismatch" | "file-unreadable" | "foreign-store";

const DROPS: readonly DropCase[] = [
  "nothing-announced",
  "digest-mismatch",
  "file-unreadable",
  "foreign-store",
];

function dropVouch(drop: DropCase): VouchContext {
  switch (drop) {
    // The ONLY sub-state the shipped sentence is true of: nothing announced.
    case "nothing-announced":
      return { windows: WIDE, announcements: [], peerRoots: [FE] };
    // :416 — the file is the one that was announced, and its bytes have since
    // changed. THE TAMPER. Non-empty in, empty out.
    case "digest-mismatch":
      return {
        windows: WIDE,
        announcements: [{ path: bePath, digest: "0".repeat(64), line: 2 }],
        peerRoots: [FE],
      };
    // :413 — the announced path IS under this session's store, and the file is
    // not there to read.
    case "file-unreadable":
      return {
        windows: WIDE,
        announcements: [
          { path: join(receiptsDirOf(BE, SID), "vanished-receipt.json"), digest: beDigest, line: 2 },
        ],
        peerRoots: [FE],
      };
    // :409 — a real, front-door-written receipt, announced in this session, but
    // filed under ANOTHER session's store.
    case "foreign-store":
      return {
        windows: WIDE,
        announcements: [announcementOf(otherSessionLine, 2)],
        peerRoots: [FE],
      };
  }
}

const dropReason = (drop: DropCase): GateEvidenceReason =>
  gateReceiptEvidence(SUBJECT, BE, SID, dropVouch(drop)).reason;

function dropWhy(drop: DropCase): string {
  const miss = gateReceiptMiss(SUBJECT, BE, SID, dropVouch(drop));
  if (miss === null) throw new Error(`${drop} was expected to refuse, and did not`);
  return miss.why;
}

describe("M_85e846 r2 §A — each announcement DROP is its own reason, not one count", () => {
  test("ANCHOR — all four sub-states start from a receipt that is valid on disk", () => {
    // Without this, a row could be green for the wrong leg entirely: a missing
    // or malformed receipt refuses with `no-receipt` long before vouching runs.
    const withGoodAnnouncement = gateReceiptEvidence(SUBJECT, BE, SID, {
      windows: WIDE,
      announcements: [beAnnouncement],
      peerRoots: [FE],
    });
    expect({ ok: withGoodAnnouncement.ok, reason: withGoodAnnouncement.reason }).toEqual({
      ok: true,
      reason: "receipt-found",
    });
  });

  test("the four sub-states produce four PAIRWISE DISTINCT reasons", () => {
    const measured = Object.fromEntries(DROPS.map((d) => [d, dropReason(d)]));
    expect({ distinct: new Set(Object.values(measured)).size, measured }).toEqual({
      distinct: DROPS.length,
      measured,
    });
  });

  test("every one of the four still REFUSES — splitting the reason opens no hole", () => {
    for (const drop of DROPS) {
      const evidence = gateReceiptEvidence(SUBJECT, BE, SID, dropVouch(drop));
      expect({ drop, ok: evidence.ok, applies: evidence.applies }).toEqual({
        drop,
        ok: false,
        applies: true,
      });
    }
  });

  test("`nothing-announced` keeps naming the ONE state its wording is true of", () => {
    expect(dropReason("nothing-announced")).toBe("nothing-announced");
  });

  test("no reason ships wordless: each of the four has its OWN prose entry", () => {
    const prose = MISS_PROSE_FOR_TEST() as unknown as Record<string, unknown>;
    const wordless = DROPS.filter((d) => typeof prose[dropReason(d)] !== "function");
    expect({ wordless, entries: new Set(DROPS.map(dropReason)).size }).toEqual({
      wordless: [],
      entries: DROPS.length,
    });
  });

  test("GREEN TODAY — `claimant` stays null for every drop: none of them is a claimed window", () => {
    for (const drop of DROPS) {
      expect({ drop, claimant: gateReceiptEvidence(SUBJECT, BE, SID, dropVouch(drop)).claimant }).toEqual({
        drop,
        claimant: null,
      });
    }
  });
});

// ===========================================================================
// §B — `outside-window` splits for the same reason `nothing-announced` does.
//
// A Skill call with no parseable timestamp opens NO window. With `windows: []`
// every announcement is "outside every window", and today that renders "it was
// written before the first … Skill call in this session" — a claim about ORDER
// about an announcement that came AFTER the call. The list being empty is not
// evidence of order; it is the absence of any order to compare against.
// ===========================================================================

type WindowCase = "predates" | "untimed";

const WINDOW_CASES: readonly WindowCase[] = ["predates", "untimed"];

function windowVouch(which: WindowCase): VouchContext {
  // The SAME announcement in both, so the only thing that varies is the windows.
  const announcements = [beAnnouncement];
  return which === "predates"
    ? { windows: LATE, announcements, peerRoots: [FE] }
    : // Every standing call was untimed, so there are no windows at all.
      { windows: [], announcements, peerRoots: [FE] };
}

const windowReason = (which: WindowCase): GateEvidenceReason =>
  gateReceiptEvidence(SUBJECT, BE, SID, windowVouch(which)).reason;

function windowWhy(which: WindowCase): string {
  const miss = gateReceiptMiss(SUBJECT, BE, SID, windowVouch(which));
  if (miss === null) throw new Error(`${which} was expected to refuse, and did not`);
  return miss.why;
}

/** The order claim: true ONLY when a window exists and the announcement precedes it. */
const PREDATES = /written before the first/i;

describe("M_85e846 r2 §B — no windows is not the same fact as the announcement coming first", () => {
  test("`predates` and `untimed` produce DISTINCT reasons", () => {
    const measured = Object.fromEntries(WINDOW_CASES.map((w) => [w, windowReason(w)]));
    expect({ distinct: new Set(Object.values(measured)).size, measured }).toEqual({
      distinct: WINDOW_CASES.length,
      measured,
    });
  });

  test("UNTIMED does NOT claim the announcement predates a call it came after", () => {
    const why = windowWhy("untimed");
    expect({ claimsOrder: PREDATES.test(why) }).toEqual({ claimsOrder: false });
  });

  test("GREEN TODAY — PREDATES keeps its sentence: there, the order claim is true", () => {
    expect(PREDATES.test(windowWhy("predates"))).toBe(true);
  });

  test("both still refuse, and both are worded", () => {
    const prose = MISS_PROSE_FOR_TEST() as unknown as Record<string, unknown>;
    for (const which of WINDOW_CASES) {
      const evidence = gateReceiptEvidence(SUBJECT, BE, SID, windowVouch(which));
      expect({
        which,
        ok: evidence.ok,
        worded: typeof prose[evidence.reason] === "function",
      }).toEqual({ which, ok: false, worded: true });
    }
  });
});

// ===========================================================================
// §C — THE CONTROL THE ROUND-1 SUITE DID NOT HAVE, by name.
//
// The round-1 suite built its "nothing ran" row as `announcements: []` and never
// once built a list that was NON-EMPTY and filtered to EMPTY. Every row expected
// the same verdict and the same sentence, so the suite could not tell a true
// sentence from a false one. This section is that missing half, written so it
// cannot go missing again.
// ===========================================================================

describe("M_85e846 r2 §C — a list that FILTERS to empty is not a list that WAS empty", () => {
  test("the three filtered sub-states hand `announcedRoots` a NON-EMPTY list (fixture control)", () => {
    // If this ever reads 0, the rows below are grading the empty case three
    // times over and the section proves nothing — exactly the round-1 failure.
    const sizes = (["digest-mismatch", "file-unreadable", "foreign-store"] as const).map((d) => ({
      drop: d,
      announced: dropVouch(d).announcements?.length ?? 0,
    }));
    expect(sizes).toEqual([
      { drop: "digest-mismatch", announced: 1 },
      { drop: "file-unreadable", announced: 1 },
      { drop: "foreign-store", announced: 1 },
    ]);
  });

  test("none of the three filtered states reports the reason that means the list WAS empty", () => {
    const borrowed = (["digest-mismatch", "file-unreadable", "foreign-store"] as const)
      .map((d) => ({ drop: d, reason: dropReason(d) }))
      .filter((row) => row.reason === dropReason("nothing-announced"));
    expect(borrowed).toEqual([]);
  });

  test("THE TAMPER IS SURFACED, not folded into `nothing ran`", () => {
    // A receipt rewritten after its announcement is the one attack the digest
    // binding exists to detect. Reporting it as "no run announced a receipt"
    // hides a detected forgery behind a housekeeping message.
    const why = dropWhy("digest-mismatch");
    expect({
      saysNothingWasRead: /no command in this session was read as a run/i.test(why),
      namesTheTamper:
        /rewritten|no longer matches|no longer hashes|changed after|changed since|does not match the announced|tamper/i.test(
          why,
        ),
    }).toEqual({ saysNothingWasRead: false, namesTheTamper: true });
  });
});

// ===========================================================================
// §D — THE BIJECTION MATRIX, at the shipped injection site.
//
// §A-§C grade values and pure functions. These rows prove an OPERATOR receives
// the distinction, through the real `pre-commit-gate-check.sh`, on a real
// transcript, for every sub-state at once.
//
// The matrix asserts that each refusal matches its OWN signature and NO other
// state's. That is what makes a subject that lies about a sub-state unable to
// pass: today five states borrow `nothing-read`'s signature and one borrows
// `predates`'s, and each borrow is a row of its own in the failure.
// ===========================================================================

type Site =
  | "claimed"
  | "predates"
  | "nothing-read"
  | "two-lines"
  | "zero-lines"
  | "digest-tamper"
  | "foreign-store"
  | "untimed";

const SITES: readonly Site[] = [
  "claimed",
  "predates",
  "nothing-read",
  "two-lines",
  "zero-lines",
  "digest-tamper",
  "foreign-store",
  "untimed",
];

/**
 * One signature per sub-state — a BIJECTION, asserted in both directions.
 *
 * The three that ship today carry the shipped words verbatim. The five that do
 * not yet exist carry alternations, so a correct fix is not hostage to one
 * wording; the load-bearing half is the absence matrix below, which asks only
 * that a state not borrow a signature belonging to another state.
 */
const SIGNATURE: Record<Site, RegExp> = {
  claimed: /already recorded/i,
  predates: PREDATES,
  "nothing-read": /no command in this session was read as a run/i,
  "two-lines": /more than one|not exactly one|two receipts|two announcements|several announcements/i,
  "zero-lines": /announced no|printed no|announced nothing|carried no announcement|without announcing/i,
  "digest-tamper":
    /rewritten|no longer matches|no longer hashes|changed after|changed since|does not match the announced|tamper/i,
  "foreign-store": /another session|a different session|outside this session|not (?:in|under) this session/i,
  untimed: /timestamp|opened no window|no window|could not be placed/i,
};

/** Drive one sub-state through the shipped wrapper. Serial; each is self-contained. */
async function siteRun(site: Site): Promise<Run> {
  switch (site) {
    // One read run, for FE, with the commit aimed at BE: FE took the window.
    case "claimed":
      return runGate(
        commitBe(),
        transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(FE), [feLine])]),
      );
    // BE's announcement sits BEFORE the only Skill call — the order claim holds.
    case "predates":
      return runGate(
        commitBe(),
        transcript([...bashCall("b1", genuineRun(BE), [beLine]), ...skillCall("tu1", PAST)]),
      );
    // The mint was PIPED, so no Bash call was read as a front-door run at all.
    case "nothing-read":
      return runGate(
        commitBe(),
        transcript([...skillCall("tu1", PAST), ...bashCall("b1", pipedRun(BE), [beLine])]),
      );
    // A run that WAS read, whose result carried TWO announcement lines.
    // session.ts:561 keeps a result only when it carries exactly one.
    case "two-lines":
      return runGate(
        commitBe(),
        transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(BE), [beLine, beLine])]),
      );
    // A run that WAS read, whose result carried NO announcement line.
    case "zero-lines":
      return runGate(
        commitBe(),
        transcript([
          ...skillCall("tu1", PAST),
          ...bashCall("b1", genuineRun(BE), ["gate-check ran; nothing printed"]),
        ]),
      );
    // A read run, a genuine announcement — and the receipt file REWRITTEN after
    // it was announced. Restored in `finally` so no later row inherits it.
    case "digest-tamper": {
      const original = readFileSync(bePath);
      try {
        writeFileSync(bePath, Buffer.concat([original, Buffer.from("\n")]));
        return await runGate(
          commitBe(),
          transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(BE), [beLine])]),
        );
      } finally {
        writeFileSync(bePath, original);
      }
    }
    // A read run announcing a REAL receipt that belongs to another session's store.
    case "foreign-store":
      return runGate(
        commitBe(),
        transcript([
          ...skillCall("tu1", PAST),
          ...bashCall("b1", genuineRun(BE), [otherSessionLine]),
        ]),
      );
    // A standing Skill call the transcript gives no timestamp, so it opens no
    // window — and the announcement comes AFTER it.
    case "untimed":
      return runGate(
        commitBe(),
        transcript([...skillCall("tu1", null), ...bashCall("b1", genuineRun(BE), [beLine])]),
      );
  }
}

/** Which signatures a message matches, in `SITES` order. */
const matched = (text: string): Site[] => SITES.filter((s) => SIGNATURE[s].test(text));

describe("M_85e846 r2 §D — the shipped wrapper tells all eight sub-states apart", () => {
  test("every sub-state still REFUSES the commit (exit 2) — no hole, and no fixture drift", async () => {
    const codes: Array<{ site: Site; code: number }> = [];
    for (const site of SITES) {
      const r = await siteRun(site);
      codes.push({ site, code: r.exitCode });
    }
    expect(codes).toEqual(SITES.map((site) => ({ site, code: 2 })));
  }, T);

  test("BIJECTION — each refusal matches its OWN signature and no other state's", async () => {
    const rows: Array<{ site: Site; matches: Site[] }> = [];
    for (const site of SITES) {
      const r = await siteRun(site);
      rows.push({ site, matches: matched(r.stderr) });
    }
    expect(rows).toEqual(SITES.map((site) => ({ site, matches: [site] })));
  }, T);

  test("the eight sub-states render EIGHT DISTINCT refusals", async () => {
    const messages: string[] = [];
    for (const site of SITES) {
      const r = await siteRun(site);
      messages.push(r.stderr);
    }
    expect({ sites: SITES.length, distinct: new Set(messages).size }).toEqual({
      sites: SITES.length,
      distinct: SITES.length,
    });
  }, T);

  test("every refusal names the checkout it is about, and none names the other one", async () => {
    // A negative control on the OTHER axis: a fix that started naming FE in
    // BE's refusals would be red here even if every signature landed.
    const beNames = [BE, realpathSync(BE)];
    const feNames = [FE, realpathSync(FE)];
    const rows: Array<{ site: Site; namesTarget: boolean; namesOther: boolean }> = [];
    for (const site of SITES) {
      const r = await siteRun(site);
      rows.push({
        site,
        namesTarget: beNames.some((n) => r.stderr.includes(n)),
        // `claimed` is the one state whose refusal SHOULD name FE: FE is the
        // checkout that took the window, and naming it is the point.
        namesOther: site === "claimed" ? false : feNames.some((n) => r.stderr.includes(n)),
      });
    }
    expect(rows).toEqual(SITES.map((site) => ({ site, namesTarget: true, namesOther: false })));
  }, T);
});

// ===========================================================================
// §E — the permit direction, and the truths that must survive.
//
// Without these, a "fix" that refused every command, or that replaced one
// shared sentence with a different shared sentence, would satisfy §D's absence
// half by saying nothing at all.
// ===========================================================================

describe("M_85e846 r2 §E — the gate still permits, and the true sentences stay true", () => {
  test("GREEN TODAY — PERMIT: a read front-door run for BE, inside the window, exits 0 silently", async () => {
    const r = await runGate(
      commitBe(),
      transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(BE), [beLine])]),
    );
    expect({ code: r.exitCode, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
  }, T);

  test("GREEN TODAY — PERMIT survives a SECOND session's receipt sitting in the same checkout", async () => {
    // `foreign-store` above puts a real receipt for SID_OTHER into BE. If the
    // fix read the store instead of the announcement, that file would start
    // vouching for things, and this row would go red.
    const r = await runGate(
      commitBe(),
      transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(BE), [beLine])]),
    );
    expect(r.exitCode).toBe(0);
  }, T);

  test("GREEN TODAY — `nothing-read` keeps the sentence it is the true state of", async () => {
    const r = await siteRun("nothing-read");
    expect(SIGNATURE["nothing-read"].test(r.stderr)).toBe(true);
  }, T);

  test("GREEN TODAY — `claimed` keeps naming the checkout that took the window", async () => {
    const r = await siteRun("claimed");
    expect({
      ownCause: SIGNATURE.claimed.test(r.stderr),
      namesTheClaimant: r.stderr.includes(FE) || r.stderr.includes(realpathSync(FE)),
    }).toEqual({ ownCause: true, namesTheClaimant: true });
  }, T);

  test("the remedy never hands over the minting front door, in any sub-state", async () => {
    // The one invariant the whole leg rests on: a remedy naming the mint command
    // would invite a receipt with no gate behind it. New reasons mean new prose,
    // and new prose is where this would slip.
    const rows: Array<{ site: Site; leaksFrontDoor: boolean }> = [];
    for (const site of SITES) {
      const r = await siteRun(site);
      rows.push({ site, leaksFrontDoor: r.stderr.includes(FRONT_DOOR) || /gate_receipt\.ts/.test(r.stderr) });
    }
    expect(rows).toEqual(SITES.map((site) => ({ site, leaksFrontDoor: false })));
  }, T);
});

// ===========================================================================
// §F — two ungraded surfaces, pinned.
//
// BOTH ARE GREEN TODAY. Measured at b1d5052 before they were written: neither
// reports a defect, both close a coverage gap where the code is right and
// nothing says so. They are here because an unwitnessed behaviour is one
// refactor away from being an unwitnessed regression.
// ===========================================================================

describe("M_85e846 r2 §F — coverage gaps closed (GREEN TODAY, both of them)", () => {
  const prTarget = (command: string, cwd: string) =>
    resolvePrTargetFromPayload({ cwd, tool_input: { command } });

  test("GREEN TODAY — an in-command `export GH_REPO=` is a slug source, exactly as `boundGhRepo` claims", () => {
    // `boundGhRepo` (pr_target_repo.ts:341-357) documents three binding shapes —
    // a prefix assignment, an `env` operand, and an in-command `export`. The
    // first two are graded in `pr-target-repo.test.ts`; `export` had ZERO
    // occurrences repo-wide, so the third leg of that claim rested on nothing.
    //
    // Graded against the SAME remote fixture the sibling suite uses, so the
    // rows are comparable: BE's slug from FE is known-foreign, FE's is not.
    git(FE, "remote", "add", "ste615fe", "git@github.com:org/fe.git");
    git(BE, "remote", "add", "ste615be", "https://github.com/org/be");
    try {
      expect([
        ["export GH_REPO=org/be && gh pr create", prTarget("export GH_REPO=org/be && gh pr create", FE).foreign],
        ["export GH_REPO=org/be; gh pr create", prTarget("export GH_REPO=org/be; gh pr create", FE).foreign],
        // A CONTROL in the other direction: a slug that DOES match a remote of
        // the checkout is not foreign. Without it, a reader that answered
        // "foreign" to everything would pass the two rows above.
        ["export GH_REPO=org/fe && gh pr create", prTarget("export GH_REPO=org/fe && gh pr create", FE).foreign],
      ]).toEqual([
        ["export GH_REPO=org/be && gh pr create", "org/be"],
        ["export GH_REPO=org/be; gh pr create", "org/be"],
        ["export GH_REPO=org/fe && gh pr create", null],
      ]);
    } finally {
      git(FE, "remote", "remove", "ste615fe");
      git(BE, "remote", "remove", "ste615be");
    }
  });

  test("GREEN TODAY — the PR reader's `nestingExceeded` leg has a clause of its own now", () => {
    // `pr_target_repo.ts:417` mirrors `commit_target_repo.ts:638`, and only the
    // commit side was graded (`commit-target-repo-ste601.test.ts:252`). A
    // nested string too deep to open was never parsed, so answering
    // `isPr: false` about text nobody read would be silent permission.
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    const nest = (depth: number): string => {
      let s = "gh pr create";
      for (let i = 0; i < depth; i++) s = `bash -c ${q(s)}`;
      return s;
    };
    const read = (depth: number) => {
      const t = prTarget(nest(depth), FE);
      return {
        depth,
        isPr: t.isPr,
        tooDeep: /nesting deeper than 8/.test(String(t.unresolved)),
      };
    };
    // CONTROLS at 3 and 8 — inside the bound the string IS opened, so the row
    // at 9 is about the bound and not about `bash -c` being unreadable at all.
    expect([read(3), read(8), read(9)]).toEqual([
      { depth: 3, isPr: true, tooDeep: false },
      { depth: 8, isPr: true, tooDeep: false },
      { depth: 9, isPr: true, tooDeep: true },
    ]);
  });
});

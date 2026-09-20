// M_85e846 review round — the `not-vouched` refusal ASSERTS A CAUSE IT DOES NOT KNOW.
//
// Found by the reviewer when this gate refused their own commit twice, at
// e4f8464 (v2.89.0 + the announcement-provenance fix).
//
// `MISS_PROSE["not-vouched"]` (adapters/_shared/src/gate_receipt.ts:658-665)
// branches on ONE bit — `claimant === null` — and on that bit alone states:
//
//     "it was written before the first <subject> Skill call in this session"
//
// That bit covers more than one state, and the sentence is true of only one of
// them. MEASURED at e4f8464, `gateReceiptEvidence` for BE with a real,
// front-door-written BE receipt on disk:
//
//   vouch input                                       reason        claimant  sentence
//   ------------------------------------------------  ------------  --------  -------------------
//   windows [0,∞), announcements [FE@1, BE@2]         not-vouched   FE        "already recorded FE"
//   windows [10,∞), announcements [BE@2]              not-vouched   null      "before the first …"
//   windows [0,∞), announcements []                   not-vouched   null      "before the first …"
//   windows [],    announcements [BE@2]               not-vouched   null      "before the first …"
//
// Rows 2-4 are three different situations wearing one reason and one sentence,
// and for rows 3-4 the sentence is FALSE. The reviewer's receipt was minted
// MINUTES AFTER gate-check Skill calls at transcript lines 2405, 3231, 3873 and
// 4693; the true cause was that the mint command was PIPED (`… 2>&1 | tail -1`),
// so `announcesGateReceipt` correctly refused to read it as a front-door run and
// NOTHING was announced — row 3. The gate then told them the opposite of what
// had happened, and the remedy they were handed was for a problem they did not
// have.
//
// THE REAL SET OF CAUSES, derived from the code rather than from the prose.
// Everything reaching the `not-vouched` return (:582) has passed the record
// legs, so a valid receipt for THIS checkout is on disk. Two values decide the
// rest — `claimant`, and whether `announcedRoots` (:389) produced anything at
// all — which partitions the outcome into exactly three:
//
//   (a) CLAIMED      claimant !== null: a window this receipt would fall in was
//                    taken by another checkout's announcement. Today's second
//                    branch, and the only one today's prose gets right.
//   (b) OUT OF WINDOW announcements exist, but none of them falls inside a
//                    window that would vouch for this receipt — including the
//                    case of no windows at all, which is the same fact told from
//                    the other side. Today's first branch, correctly worded.
//   (c) NOTHING RAN  `announcedRoots` produced nothing: no Bash call in this
//                    session was read as a run of the receipt front door. The
//                    reviewer's case, and the one today's prose lies about.
//
// Deliberately NOT split out: an announcement whose file no longer hashes to
// the announced digest is dropped inside `announcedRoots` and is indistinguishable
// from "never announced" at the decision point, so it folds into (c). Telling
// those apart needs `announcedRoots` to report why it dropped a line, which is a
// larger change than this defect; it is named here so the next reader knows it
// was considered rather than missed.
//
// HOW THESE CLAUSES ARE GRADED
//
//   - Each state is graded BY NAME twice: once on `GateEvidenceReason` (a value
//     the caller can branch on, so no refusal ever reconstructs a cause from a
//     string) and once on the sentence the operator actually reads.
//   - NEGATIVE CONTROLS in both directions. A suite whose every row expects
//     "refused" cannot tell a correct message from a wrong one — that is the
//     lesson of the reproduction this fix came from, which had four refusal rows
//     and no permit row and so could not distinguish "leak closed" from "gate
//     bricked". So each state's message must carry ITS OWN cause and must NOT
//     carry another state's, and the three must be pairwise distinct.
//   - The behavioural rows drive the SHIPPED bash wrapper, the real injection
//     site, exactly as the sibling provenance suite does. A message graded only
//     as a pure function is a message nobody proved an operator ever sees.
//   - The PERMIT direction ships with the forbid rows, so a "fix" that refused
//     everything, or that gave every state one new shared sentence, is red here.
//   - Receipts are written by SPAWNING the front door, never hand-rolled.
//
// Rows marked GREEN TODAY are pins, not claims about the fix: they record
// behaviour that is already right and must survive it. Every other row is RED at
// e4f8464.
//
// Every spawn is SERIAL: no Promise.all over processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import {
  FRONT_DOOR,
  PLUGIN_ROOT,
  clearReceipts,
  forgetAnnouncements,
  mintedAnnouncements,
  writeGateReceipt,
} from "./_gate_receipt_fixture";
import {
  announcesGateReceipt,
  gateReceiptEvidence,
  gateReceiptMiss,
  MISS_PROSE_FOR_TEST,
  type GateEvidenceReason,
  type ReceiptAnnouncement,
  type VouchContext,
  type VouchWindow,
} from "../adapters/_shared/src/gate_receipt";
import { parseReceiptAnnouncement } from "../adapters/_shared/src/tracker_receipts";

const WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh");
const SUBJECT = "dev-process-toolkit:gate-check";
const SID = "s85e846-diag";
const T = 300_000;
const PAST = new Date(Date.now() - 3_600_000).toISOString();

let fx: SpanFixture;
let FE = "";
let BE = "";
let scratch = "";
/** The `dpt-receipt:` line the front door printed for each checkout. */
let feLine = "";
let beLine = "";
let feAnnouncement: ReceiptAnnouncement;
let beAnnouncement: ReceiptAnnouncement;

// --------------------------------------------------------------- transcripts

function skillCall(id: string, ts: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: SUBJECT } }] },
    }),
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

const commit = (root: string): string => `git -C ${root} commit -m x`;

// ------------------------------------------------------------------ fixture

function announcementOf(line: string, at: number): ReceiptAnnouncement {
  const parsed = parseReceiptAnnouncement(line);
  if (parsed === null || parsed.digest === null) {
    throw new Error(`front door printed an unparseable announcement: ${line}`);
  }
  return { path: parsed.path, digest: parsed.digest, line: at };
}

beforeAll(() => {
  fx = makeSpanFixture("M_85e846diag");
  FE = fx.a;
  BE = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "hs1-diag-"));

  for (const root of [FE, BE]) {
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture: stack marker");
    writeFileSync(join(root, "README.md"), `# ${root}\n`);
    git(root, "add", "README.md");
  }

  // ONE front-door-written receipt per checkout. Both are REAL and VALID on
  // disk: every clause below is about WHY a valid receipt went unvouched, so a
  // receipt that failed to parse would grade a different leg entirely.
  forgetAnnouncements();
  clearReceipts(FE, SID);
  clearReceipts(BE, SID);
  writeGateReceipt(FE, "gate-check", SID);
  feLine = mintedAnnouncements().at(-1)!;
  writeGateReceipt(BE, "gate-check", SID);
  beLine = mintedAnnouncements().at(-1)!;
  feAnnouncement = announcementOf(feLine, 1);
  beAnnouncement = announcementOf(beLine, 2);
});

afterAll(() => {
  fx?.cleanup();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ===========================================================================
// §1 — the three causes are three VALUES, not one value and three readings.
//
// Graded on `GateEvidenceReason` alone. A caller that has to read the sentence
// to learn which of the three happened is a caller reconstructing a cause from
// a string, which is the shape this fix exists to remove.
// ===========================================================================

const WIDE: readonly VouchWindow[] = [
  { start: 0, end: Number.POSITIVE_INFINITY, startLine: 0, endLine: Number.POSITIVE_INFINITY },
];
/** A window that opens AFTER both announcements, so neither falls inside it. */
const LATE: readonly VouchWindow[] = [
  { start: 0, end: Number.POSITIVE_INFINITY, startLine: 10, endLine: Number.POSITIVE_INFINITY },
];

/** The three vouch inputs, one per cause, all against the same valid BE receipt. */
function vouchFor(cause: "claimed" | "out-of-window" | "nothing-ran"): VouchContext {
  switch (cause) {
    // Another checkout's announcement took the window this receipt falls in.
    case "claimed":
      return { windows: WIDE, announcements: [feAnnouncement, beAnnouncement], peerRoots: [FE] };
    // The announcement exists, but it sits outside every window.
    case "out-of-window":
      return { windows: LATE, announcements: [beAnnouncement], peerRoots: [FE] };
    // Nothing in this session was read as a run of the front door at all.
    case "nothing-ran":
      return { windows: WIDE, announcements: [], peerRoots: [FE] };
  }
}

const CAUSES = ["claimed", "out-of-window", "nothing-ran"] as const;

function reasonFor(cause: (typeof CAUSES)[number]): GateEvidenceReason {
  return gateReceiptEvidence(SUBJECT, BE, SID, vouchFor(cause)).reason;
}

function whyFor(cause: (typeof CAUSES)[number]): string {
  const miss = gateReceiptMiss(SUBJECT, BE, SID, vouchFor(cause));
  if (miss === null) throw new Error(`${cause} was expected to refuse, and did not`);
  return miss.why;
}

describe("M_85e846 review §1 — each way a receipt goes unvouched is its OWN reason", () => {
  test("the three causes produce three PAIRWISE DISTINCT reasons", () => {
    const measured = Object.fromEntries(CAUSES.map((c) => [c, reasonFor(c)]));
    expect(new Set(Object.values(measured)).size).toEqual(CAUSES.length);
  });

  test("every one of the three still REFUSES — the split does not open a hole", () => {
    for (const cause of CAUSES) {
      const evidence = gateReceiptEvidence(SUBJECT, BE, SID, vouchFor(cause));
      expect({ cause, ok: evidence.ok, applies: evidence.applies }).toEqual({
        cause,
        ok: false,
        applies: true,
      });
    }
  });

  test("`not-vouched` keeps naming the CLAIMED state — the one its wording is true of", () => {
    expect(reasonFor("claimed")).toBe("not-vouched");
  });

  test("a new reason cannot ship wordless: every reason returned has its OWN prose entry", () => {
    const prose = MISS_PROSE_FOR_TEST() as unknown as Record<string, unknown>;
    const missing = CAUSES.filter((c) => typeof prose[reasonFor(c)] !== "function");
    expect({ missing, keys: new Set(CAUSES.map(reasonFor)).size }).toEqual({
      missing: [],
      keys: CAUSES.length,
    });
  });

  test("GREEN TODAY — `claimant` is carried ONLY by the claimed state", () => {
    const real = realpathSync(FE);
    expect(gateReceiptEvidence(SUBJECT, BE, SID, vouchFor("claimed")).claimant).toBe(real);
    expect(gateReceiptEvidence(SUBJECT, BE, SID, vouchFor("out-of-window")).claimant).toBeNull();
    expect(gateReceiptEvidence(SUBJECT, BE, SID, vouchFor("nothing-ran")).claimant).toBeNull();
  });

  test("GREEN TODAY — PERMIT: this checkout's own announcement inside the window vouches for it", () => {
    const evidence = gateReceiptEvidence(SUBJECT, BE, SID, {
      windows: WIDE,
      announcements: [beAnnouncement],
      peerRoots: [FE],
    });
    expect({ ok: evidence.ok, reason: evidence.reason }).toEqual({
      ok: true,
      reason: "receipt-found",
    });
  });
});

// ===========================================================================
// §2 — each refusal names its OWN cause, and the three are not interchangeable.
//
// Positive needle per state, plus negative controls against the needles that
// belong to the OTHER states. The negative controls are the half that matters:
// today all three states render one sentence, so "it refused" is satisfied by a
// message that describes something that did not happen.
// ===========================================================================

/** The phrase that is true ONLY of the out-of-window state. */
const PREDATES = /written before the first/i;
/** The phrase that is true ONLY of the claimed state. */
const ALREADY_RECORDED = /already recorded/i;
/** The claimed state's other half: it NAMES the checkout that took the window. */
const namesFe = (text: string): boolean =>
  text.includes(FE) || text.includes(realpathSync(FE));

describe("M_85e846 review §2 — the three refusals are not interchangeable", () => {
  test("the three causes render three PAIRWISE DISTINCT sentences", () => {
    const rendered = CAUSES.map(whyFor);
    expect(new Set(rendered).size).toEqual(CAUSES.length);
  });

  test("CLAIMED names the checkout that took the window, and does not claim the receipt predates anything", () => {
    const why = whyFor("claimed");
    expect({
      ownCause: ALREADY_RECORDED.test(why),
      namesTheClaimant: namesFe(why),
      borrowsPredates: PREDATES.test(why),
    }).toEqual({ ownCause: true, namesTheClaimant: true, borrowsPredates: false });
  });

  test("OUT OF WINDOW says the receipt fell outside every window, names no other checkout, and claims no other run recorded it", () => {
    const why = whyFor("out-of-window");
    expect({
      ownCause: PREDATES.test(why),
      borrowsClaimant: ALREADY_RECORDED.test(why),
      namesAnotherCheckout: namesFe(why),
    }).toEqual({ ownCause: true, borrowsClaimant: false, namesAnotherCheckout: false });
  });

  test("NOTHING RAN says no front-door run was seen — NOT that the receipt predates the first Skill call", () => {
    const why = whyFor("nothing-ran");
    expect({
      // The lie measured at e4f8464: the reviewer's receipt was minted minutes
      // AFTER four gate-check Skill calls, and was told it came before them.
      claimsItPredates: PREDATES.test(why),
      borrowsClaimant: ALREADY_RECORDED.test(why),
      namesAnotherCheckout: namesFe(why),
      // Its own cause: nothing in this session announced a receipt.
      ownCause: /announc|front door/i.test(why),
    }).toEqual({
      claimsItPredates: false,
      borrowsClaimant: false,
      namesAnotherCheckout: false,
      ownCause: true,
    });
  });
});

// ===========================================================================
// §3 — the invocation shapes, pinned.
//
// The reviewer found these four by hand, against a live session, after the gate
// refused a commit they had gated. Nobody should have to do that again.
//
//   bare absolute `bun run "<abs>/gate_receipt.ts" gate-check "<root>"` → RUNS
//   the same + ` 2>&1 | tail -1`                                       → does not
//   bare RELATIVE path                                                 → does not
//   relative + pipe                                                    → does not
//
// The three refusals are CORRECT — a piped or relative command is not a read
// front-door run — so the boolean column is a pin of shipped behaviour. What is
// broken is what the operator is told afterwards, which is why each refused
// shape is also driven through the shipped wrapper and graded on its sentence.
// The accepted shape is driven too: without it, a fix that refused every shape
// would pass every row here.
// ===========================================================================

interface Shape {
  name: string;
  command: () => string;
  /** Whether this command is READ as a run of the front door. */
  runs: boolean;
}

function shapes(): Shape[] {
  const relative = "adapters/_shared/src/gate_receipt.ts";
  return [
    {
      name: "PERMIT — bare absolute `bun run \"<front door>\" gate-check <BE>`",
      command: () => `bun run "${FRONT_DOOR}" gate-check "${BE}"`,
      runs: true,
    },
    {
      name: "FORBID — the same command PIPED (`2>&1 | tail -1`), the reviewer's own mint",
      command: () => `bun run "${FRONT_DOOR}" gate-check "${BE}" 2>&1 | tail -1`,
      runs: false,
    },
    {
      name: "FORBID — a bare RELATIVE path to the front door",
      command: () => `bun run ${relative} gate-check "${BE}"`,
      runs: false,
    },
    {
      name: "FORBID — a relative path AND a pipe",
      command: () => `bun run ${relative} gate-check "${BE}" 2>&1 | tail -1`,
      runs: false,
    },
  ];
}

describe("M_85e846 review §3 — the four invocation shapes the reviewer measured by hand", () => {
  test("GREEN TODAY — ANCHOR: `announcesGateReceipt` reads each shape as the reviewer measured it", () => {
    const measured = shapes().map((s) => [s.name, announcesGateReceipt(s.command())]);
    const declared = shapes().map((s) => [s.name, s.runs]);
    expect(measured).toEqual(declared);
  });

  for (const shape of shapes()) {
    test(`${shape.name} → BE commit exits ${shape.runs ? 0 : 2}`, async () => {
      const tr = transcript([
        ...skillCall("tu1", PAST),
        ...bashCall("b1", shape.command(), [beLine]),
      ]);
      const r = await runGate(commit(BE), tr);
      expect({ shape: shape.name, code: r.exitCode }).toEqual({
        shape: shape.name,
        code: shape.runs ? 0 : 2,
      });
      if (shape.runs) {
        // GREEN TODAY. The permit direction: a read front-door run for this
        // checkout, inside the window, lets the commit through with no noise.
        expect(r.stderr).toBe("");
        return;
      }
      // Every refused shape lands in the SAME state — nothing in the session was
      // read as a front-door run — so every refused shape must be TOLD that, and
      // must not be told the receipt predates a Skill call that ran before it.
      expect({
        shape: shape.name,
        refuses: r.stderr.includes("Refusing:"),
        namesTheTarget: r.stderr.includes(BE) || r.stderr.includes(realpathSync(BE)),
        claimsItPredates: PREDATES.test(r.stderr),
        borrowsClaimant: ALREADY_RECORDED.test(r.stderr),
        namesAnotherCheckout: namesFe(r.stderr),
        ownCause: /announc|front door/i.test(r.stderr),
      }).toEqual({
        shape: shape.name,
        refuses: true,
        namesTheTarget: true,
        claimsItPredates: false,
        borrowsClaimant: false,
        namesAnotherCheckout: false,
        ownCause: true,
      });
    }, T);
  }
});

// ===========================================================================
// §4 — the same three states at the INJECTION SITE, told apart.
//
// §2 grades the sentences as a pure function. These rows prove an operator
// actually receives them, through the shipped `pre-commit-gate-check.sh`, and
// that the two states which share one sentence today stop sharing it.
// ===========================================================================

describe("M_85e846 review §4 — the shipped wrapper tells the three states apart", () => {
  const genuineRun = (root: string): string => `bun run "${FRONT_DOOR}" gate-check "${root}"`;
  const pipedRun = (root: string): string =>
    `bun run "${FRONT_DOOR}" gate-check "${root}" 2>&1 | tail -1`;

  /** CLAIMED: one read run, for FE, and the commit is aimed at BE. */
  async function claimedRun(): Promise<Run> {
    return runGate(
      commit(BE),
      transcript([...skillCall("tu1", PAST), ...bashCall("b1", genuineRun(FE), [feLine])]),
    );
  }

  /** OUT OF WINDOW: BE's announcement sits BEFORE the only Skill call. */
  async function outOfWindowRun(): Promise<Run> {
    return runGate(
      commit(BE),
      transcript([...bashCall("b1", genuineRun(BE), [beLine]), ...skillCall("tu1", PAST)]),
    );
  }

  /** NOTHING RAN: the mint was piped, so no Bash call was read as a run. */
  async function nothingRanRun(): Promise<Run> {
    return runGate(
      commit(BE),
      transcript([...skillCall("tu1", PAST), ...bashCall("b1", pipedRun(BE), [beLine])]),
    );
  }

  test("GREEN TODAY — CLAIMED: the refusal names FE as the run that already recorded a checkout", async () => {
    const r = await claimedRun();
    expect({
      code: r.exitCode,
      ownCause: ALREADY_RECORDED.test(r.stderr),
      namesTheClaimant: namesFe(r.stderr),
      borrowsPredates: PREDATES.test(r.stderr),
    }).toEqual({ code: 2, ownCause: true, namesTheClaimant: true, borrowsPredates: false });
  }, T);

  test("GREEN TODAY — OUT OF WINDOW: the refusal says the receipt came before the first Skill call, and names no other checkout", async () => {
    const r = await outOfWindowRun();
    expect({
      code: r.exitCode,
      ownCause: PREDATES.test(r.stderr),
      borrowsClaimant: ALREADY_RECORDED.test(r.stderr),
      namesAnotherCheckout: namesFe(r.stderr),
    }).toEqual({ code: 2, ownCause: true, borrowsClaimant: false, namesAnotherCheckout: false });
  }, T);

  test("NOTHING RAN: the refusal does NOT claim the receipt predates a Skill call that ran before it", async () => {
    const r = await nothingRanRun();
    expect({
      code: r.exitCode,
      claimsItPredates: PREDATES.test(r.stderr),
      borrowsClaimant: ALREADY_RECORDED.test(r.stderr),
      ownCause: /announc|front door/i.test(r.stderr),
    }).toEqual({ code: 2, claimsItPredates: false, borrowsClaimant: false, ownCause: true });
  }, T);

  test("NEGATIVE CONTROL — the two states that share one sentence today refuse with DIFFERENT text", async () => {
    // Serial, never Promise.all: these are spawned processes.
    const outOfWindow = await outOfWindowRun();
    const nothingRan = await nothingRanRun();
    const claimed = await claimedRun();
    expect([outOfWindow.exitCode, nothingRan.exitCode, claimed.exitCode]).toEqual([2, 2, 2]);
    expect(new Set([outOfWindow.stderr, nothingRan.stderr, claimed.stderr]).size).toBe(3);
  }, T);
});

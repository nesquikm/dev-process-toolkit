// M133 / STE-516 — "A stage cannot report a spawn it did not perform".
//
// THE DEFECT. `/deliver` renders a chain whose steps each name their own
// placement (`resume_classifier.ts` → `(inline)` / `(worker)`), and NOTHING
// anywhere checks that a step marked `(worker)` ever reached a worker. On the
// run that prompted this FR every ceremony step ran in the orchestrating
// session, the hand-off fence graded clean, and the discrepancy was invisible:
// `verifyDeliverStageCapture` grades `stage`, `milestone`, `status` and the
// three evidence sections, and grades `summary` NOT AT ALL.
//
// THE FIX, and the module the implementer writes:
//
//     adapters/_shared/src/spawn_receipt.ts        ← NEW (suggested path)
//     adapters/_shared/src/deliver_stage_capture.ts ← third, optional argument
//
// `spawn_receipt.ts` owns two halves that must not be conflated:
//
//   * THE EMISSION SIDE — `renderSpawnReceipt({ spawned, owned })`. Resolves
//     the handle through the spawning tool's ownership check (agent-toolkit's
//     `spawn-agent lib/owned.py`) via an INJECTED runner, and returns the one
//     receipt line ONLY on exit 0. Every other outcome throws a named halt.
//   * THE GRADING SIDE — `parseSpawnReceipt(lines)` plus a third argument to
//     `verifyDeliverStageCapture(path, evidence, spawn)`, so a capture whose
//     chain carried worker-placement steps is graded for the receipt.
//
// THE CONTRACT THESE TESTS PIN, stated once so the implementer does not guess:
//
//   Receipt line, verbatim shape (an INDENTED list item under `summary:`,
//   never a ninth section — `topLevelKeys` is anchored at column 0, so the
//   receipt is invisible to section detection and the fixed eight-section
//   order this repo repaired one milestone ago is not reopened):
//
//       "  - spawn: handle=<handle> ledger=<path> owned=0"
//
//   `SPAWN_RECEIPT_PREFIX` = "- spawn:"       (fixed prefix, AC.1)
//   `SPAWN_RECEIPT_FIELDS` = ["handle","ledger","owned"]  (fixed order, AC.1)
//
//   Halts carry the house NFR-10 envelope (`deliver_decision.ts` idiom):
//   `Refusing: ` / `Remedy: ` / `Context: `, the Context naming the halt
//   (`reason=<name>`). The named halts:
//
//       reason=no-terminal-host        the tool is installed, no host to
//                                      spawn into — its OWN remedy (AC.6)
//       reason=no-ledger-row           owned.py exit 2 — its OWN remedy (AC.5)
//       reason=no-ownership-sidecar    owned.py exit 5 — its OWN remedy (AC.5)
//       reason=ownership-unresolved    EVERY other non-zero, and the message
//                                      quotes `exit code <N>` (AC.5)
//       reason=handle-composed         the reported handle is not the one the
//                                      check resolved (AC.2)
//       reason=handle-unresolved       exit 0 that resolved no handle — exit
//                                      zero PERMITS emission, it does not
//                                      guarantee it (AC.4)
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31; house precedents
// `m129-ste-492-deliver-fence-producer.test.ts`, `m132-ste-510-fence-evidence`):
//
//   * FAIL-CLOSED IS THE WHOLE FR, so it is pinned code by code and NOT
//     collectively. A single catch-all halt would satisfy "every non-zero
//     halts" while erasing the two named remedies; AC.10's matrix therefore
//     asserts every guard's failure text is DISTINCT from every other's.
//     `feedback_fix_the_quiet_half`: a silent skip is worse than a loud
//     failure, and two guards shipped fail-open one milestone ago.
//
//   * NO SPAWN MECHANICS HERE. The ledger path and the worker name arrive from
//     what the spawning tool REPORTED. The runner query is asserted to equal
//     those bytes, so a module that derives a ledger path of its own — the
//     host-dependent contract the shipped criteria forbid re-implementing —
//     reddens rather than passing.
//
//   * A PERFECT PIN ON A WRONG SUBJECT IS WORTHLESS
//     (`feedback_falsifiability_limits`). AC.2's discriminator is not the
//     handle's SHAPE — a composed handle is well-formed by construction — it
//     is the comparison against what the ownership check resolved. So the
//     composed-handle fixture parses cleanly and is rejected anyway.
//
//   * AC.7 IS ASSERTED BYTE-IDENTICALLY, never assumed: the no-worker chain
//     verdict is compared by `JSON.stringify` against the shipped two-argument
//     call, so a receipt requirement that leaked into the inline path reddens.
//
//   * THE CAP IS READ, NEVER RETYPED (AC.8). `FENCE_LINE_CAP` is imported and
//     this file asserts its own source carries no literal copy of that number.
//
// ---------------------------------------------------------------------------
// STRUCTURAL RESIDUAL — NOT CLOSED, and deliberately so. Read this before
// concluding the receipt makes a spawn unforgeable end to end.
//
// CHAIN PROVENANCE IS ASSERTED BY THE CALLER AND CANNOT BE READ FROM THE
// CAPTURE. The eight fence sections carry `stage`, `milestone`, `status`,
// `summary`, `gate`, `drive`, `e2e` and `follow_ups` — and NOT the chain. So
// `chainRequiresSpawnReceipt` answers from `StageSpawnExpectation.chain`,
// which the CALLER supplies, and by construction:
//
//     verifyDeliverStageCapture(capture, evidence, { chain: [] })              ⇒ clean
//     verifyDeliverStageCapture(capture, evidence, { chain: allInlineSteps })  ⇒ clean
//
// for a capture that spawned a worker and reported nothing. No leg below can
// close that: nothing in the bytes being graded disagrees with either call.
//
// The caller is `/deliver`, which knows its own chain because it rendered it.
// THAT is the trust boundary, and it is irreducible without a fence change —
// closing it means the chain (or its worker-step count) riding IN the fence,
// which reopens the section contract this FR deliberately left alone. Booked
// here rather than mitigated so the next reader finds it instead of
// rediscovering it as a HIGH.
//
// ---------------------------------------------------------------------------
// AUDIT ROUND 2 (the second audit-raised round) — see the AUDIT 4 block at the
// end of this file. Its four items are all one shape: THE HEADLINE CLAIM IS
// FALSE ON THE PATH THAT SHIPS. The handle comparison is caller-OPTIONAL, the
// only surface that EXECUTES the verifier still spells it two-argument, the
// emission side has NO invoker at all, and the template teaches an
// unconditional receipt. Every leg there is written to fail against the code
// as it stood when the round opened.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FENCE_LINE_CAP } from "../adapters/_shared/src/deliver_stage_capture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

// The module STE-516 introduces, and the shipped one it extends. Absolute path
// + dynamic import on purpose: a static `import` of a not-yet-written module
// fails the WHOLE file at resolution time, collapsing ten ACs into one opaque
// red. Loading per test keeps each AC's RED attributable.
const RECEIPT_MODULE = join(SRC_DIR, "spawn_receipt.ts");
const CAPTURE_MODULE = join(SRC_DIR, "deliver_stage_capture.ts");

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "deliver-stage-capture");
const CAPTURE_GENUINE = join(FIXTURE_DIR, "worker-stage-report.txt");
const CAPTURE_NO_FENCE = join(FIXTURE_DIR, "worker-stage-report-no-fence.txt");
const CAPTURE_REORDERED = join(FIXTURE_DIR, "worker-stage-report-reordered.txt");

// ---------------------------------------------------------------------------
// Shapes, declared locally so this file compiles before the module exists.
// ---------------------------------------------------------------------------

type StepPlacement = "inline" | "worker";

interface ChainStep {
  readonly placement: StepPlacement;
}

/** What the SPAWNING TOOL reported. None of it is derived by the reporter. */
interface SpawnedWorker {
  readonly handle: string;
  readonly ledger: string;
  readonly name: string;
  /** The terminal host the tool spawned into; `null` when none exists. */
  readonly host: string | null;
}

interface OwnedCheckResult {
  readonly code: number;
  /** The handle the check RESOLVED — present only on a clean resolve. */
  readonly handle?: string;
}

interface OwnedCheckQuery {
  readonly ledger: string;
  readonly name: string;
}

type OwnedCheckRunner = (query: OwnedCheckQuery) => OwnedCheckResult;

interface SpawnReceipt {
  /** The one summary item, indented, no newline. */
  readonly line: string;
  /** The handle the ownership check RESOLVED. */
  readonly handle: string;
  readonly ledger: string;
}

interface ParsedSpawnReceipt {
  readonly handle: string;
  readonly ledger: string;
  readonly owned: number;
}

interface StageSpawnExpectation {
  readonly chain: readonly ChainStep[];
  /** The handle the ownership check resolved, when one was spawned. */
  readonly handle?: string;
}

interface DeliverStageCaptureVerdict {
  ok: boolean;
  reasons: readonly string[];
  graded: string;
}

interface ReceiptModule {
  SPAWN_RECEIPT_PREFIX: string;
  SPAWN_RECEIPT_FIELDS: readonly string[];
  /** Every halt the module can raise, named. The surface-parity legs read the
   *  `no-terminal-host` name from HERE rather than from a second literal. */
  SPAWN_RECEIPT_HALTS: readonly string[];
  renderSpawnReceipt(input: {
    spawned: SpawnedWorker;
    owned: OwnedCheckRunner;
  }): SpawnReceipt;
  parseSpawnReceipt(lines: readonly string[]): ParsedSpawnReceipt | null;
  chainRequiresSpawnReceipt(chain: readonly ChainStep[]): boolean;
}

interface CaptureModule {
  verifyDeliverStageCapture(
    capturePath: string,
    evidence?: unknown,
    spawn?: StageSpawnExpectation | null,
  ): DeliverStageCaptureVerdict;
  FENCE_LINE_CAP: number;
}

async function loadReceipt(): Promise<ReceiptModule> {
  expect({ module: RECEIPT_MODULE, exists: existsSync(RECEIPT_MODULE) }).toEqual({
    module: RECEIPT_MODULE,
    exists: true,
  });
  return (await import(RECEIPT_MODULE)) as unknown as ReceiptModule;
}

async function loadCapture(): Promise<CaptureModule> {
  return (await import(CAPTURE_MODULE)) as unknown as CaptureModule;
}

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// The spawn the tool reported. Fixed bytes so "the runner was asked exactly
// this" is a real assertion rather than a tautology.
// ---------------------------------------------------------------------------

const SPAWNED: SpawnedWorker = {
  handle: "m133-implement@01K5X7QW2M8ZC4",
  ledger: "/Users/ns/.agent-toolkit/spawn/ledger.json",
  name: "m133-implement",
  host: "cmux",
};

/** A handle the reporting stage could have COMPOSED: well-formed, not resolved. */
const COMPOSED_HANDLE = "m133-implement@01K5X7QW2M8ZC5";

/** An ownership runner that answers `result` and records what it was asked. */
function runner(
  result: OwnedCheckResult,
): OwnedCheckRunner & { queries: OwnedCheckQuery[] } {
  const queries: OwnedCheckQuery[] = [];
  const fn = (query: OwnedCheckQuery): OwnedCheckResult => {
    queries.push(query);
    return result;
  };
  return Object.assign(fn, { queries });
}

/** The clean resolve: exit 0, and the handle the tool returned. */
const resolvesOk = (): OwnedCheckRunner & { queries: OwnedCheckQuery[] } =>
  runner({ code: 0, handle: SPAWNED.handle });

function render(
  mod: ReceiptModule,
  overrides: Partial<SpawnedWorker>,
  owned: OwnedCheckRunner,
): SpawnReceipt {
  return mod.renderSpawnReceipt({ spawned: { ...SPAWNED, ...overrides }, owned });
}

/** Capture the halt text; fails loudly if the call returned instead of throwing. */
function haltText(call: () => unknown): string {
  let returned: unknown;
  try {
    returned = call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message.length).toBeGreaterThan(0);
    return message;
  }
  throw new Error(
    `expected a named halt, but the call RETURNED ${JSON.stringify(returned)} — ` +
      "a non-zero ownership outcome that reaches emission is exactly the " +
      "fail-open shape STE-516 exists to close",
  );
}

function envelopeLine(message: string, prefix: string): string {
  const line = message.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect({ prefix, present: line !== undefined, message }).toEqual({
    prefix,
    present: true,
    message,
  });
  return line!;
}

// ---------------------------------------------------------------------------
// Capture builders — the m132 idiom, one receipt option added.
// ---------------------------------------------------------------------------

const STAGE_SECTIONS = [
  "stage",
  "milestone",
  "status",
  "summary",
  "gate",
  "drive",
  "e2e",
  "follow_ups",
] as const;

const PROSE = [
  "/implement M133 — worker stage report",
  "",
  "Chain stage 1 of 3 (implement → ship-milestone → pr), milestone M133, effort",
  "ultracode. Spawned as a fresh visible worker by /deliver.",
  "",
  "Landed the M133 FR set; the operator approved the commit at the Phase 4 gate.",
  "",
].join("\n");

const DEFAULT_SUMMARY_ITEM = "  - STE-516 lands the spawn receipt";
const DEFAULT_RECEIPT_LINE =
  `  - spawn: handle=${SPAWNED.handle} ledger=${SPAWNED.ledger} owned=0`;

interface FenceOptions {
  /** Summary items. `undefined` ⇒ one prose item plus the canonical receipt. */
  summary?: readonly string[];
  order?: readonly string[];
}

function fenceBody(options: FenceOptions = {}): string[] {
  const blocks: Record<string, string[]> = {
    stage: ["stage: implement"],
    milestone: ["milestone: M133"],
    status: ["status: ok"],
    summary: [
      "summary:",
      ...(options.summary ?? [DEFAULT_SUMMARY_ITEM, DEFAULT_RECEIPT_LINE]),
    ],
    gate: ["gate:", "  - pass 9340, fail 0, skip 16, baseline 16, delta 0"],
    drive: ["drive:", "  - pass 12, fail 0, skip 0"],
    e2e: ["e2e:", "  - (none found)"],
    follow_ups: ["follow_ups:", "  - (none found)"],
  };
  const order = options.order ?? STAGE_SECTIONS;
  return order.flatMap((name) => blocks[name] ?? []);
}

function report(bodyLines: readonly string[]): string {
  return [PROSE, "```deliver-stage-result", ...bodyLines, "```", ""].join("\n");
}

function writeCapture(label: string, options: FenceOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), `ste516-${label}-`));
  const file = join(dir, "stage-report.txt");
  writeFileSync(file, report(fenceBody(options)), "utf-8");
  return file;
}

/** A chain with at least one `(worker)` step — the shipped ceremony chain. */
const WORKER_CHAIN: readonly ChainStep[] = [
  { placement: "inline" },
  { placement: "worker" },
  { placement: "worker" },
];

/** A chain that spawns nothing — every step ran in the orchestrating session. */
const INLINE_CHAIN: readonly ChainStep[] = [
  { placement: "inline" },
  { placement: "inline" },
];

/** The fence lines of a capture on disk, as the verifier counts them. */
function fenceLinesOf(capturePath: string): string[] {
  const body = readFileSync(capturePath, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const open = body.findIndex((line) => line.trim() === "```deliver-stage-result");
  expect(open).toBeGreaterThanOrEqual(0);
  const close = body.findIndex((line, i) => i > open && line.trim() === "```");
  expect(close).toBeGreaterThan(open);
  return body.slice(open + 1, close);
}

// ===========================================================================
// AC-STE-516.1 — the receipt line: fixed prefix, fixed field order, naming
// the spawned worker's handle.
// ===========================================================================

describe("AC-STE-516.1 — a fixed-prefix, fixed-field-order receipt line", () => {
  test("the prefix and the field order are EXPORTED constants, not prose", async () => {
    const mod = await loadReceipt();
    expect(mod.SPAWN_RECEIPT_PREFIX).toBe("- spawn:");
    expect([...mod.SPAWN_RECEIPT_FIELDS]).toEqual(["handle", "ledger", "owned"]);
  });

  test("a rendered receipt is ONE indented summary item naming the handle", async () => {
    const mod = await loadReceipt();
    const receipt = render(mod, {}, resolvesOk());

    expect(receipt.line).not.toContain("\n");
    expect(receipt.line.trimStart().startsWith(mod.SPAWN_RECEIPT_PREFIX)).toBe(true);
    // INDENTED, so `topLevelKeys` (anchored at column 0) cannot see it as a
    // ninth section — the structural reason the receipt rides `summary`.
    expect(/^[ \t]+-/.test(receipt.line)).toBe(true);
    expect(receipt.line).toContain(`handle=${SPAWNED.handle}`);
    expect(receipt.line).toContain(`ledger=${SPAWNED.ledger}`);
    expect(receipt.line).toContain("owned=0");
    expect(receipt.handle).toBe(SPAWNED.handle);
    expect(receipt.ledger).toBe(SPAWNED.ledger);
  });

  test("the fields appear in the exported order, left to right", async () => {
    const mod = await loadReceipt();
    const line = render(mod, {}, resolvesOk()).line;
    const positions = mod.SPAWN_RECEIPT_FIELDS.map((field) => line.indexOf(`${field}=`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual([...positions]);
  });

  test("the rendered line round-trips through the parser", async () => {
    const mod = await loadReceipt();
    const line = render(mod, {}, resolvesOk()).line;
    expect(mod.parseSpawnReceipt(["summary:", line])).toEqual({
      handle: SPAWNED.handle,
      ledger: SPAWNED.ledger,
      owned: 0,
    });
  });

  test("FIXED order is falsifiable: fields transposed ⇒ not a receipt", async () => {
    const mod = await loadReceipt();
    const transposed =
      `  - spawn: ledger=${SPAWNED.ledger} handle=${SPAWNED.handle} owned=0`;
    expect(mod.parseSpawnReceipt(["summary:", transposed])).toBeNull();
  });

  test("FIXED prefix is falsifiable: a different prefix ⇒ not a receipt", async () => {
    const mod = await loadReceipt();
    const reworded =
      `  - spawned: handle=${SPAWNED.handle} ledger=${SPAWNED.ledger} owned=0`;
    expect(mod.parseSpawnReceipt(["summary:", reworded])).toBeNull();
  });

  test("an empty handle is not a receipt — the field is the point of the line", async () => {
    const mod = await loadReceipt();
    expect(
      mod.parseSpawnReceipt([
        "summary:",
        `  - spawn: handle= ledger=${SPAWNED.ledger} owned=0`,
      ]),
    ).toBeNull();
  });

  test("both operative surfaces state the receipt, read from the constants", async () => {
    // PRODUCER/CONSUMER ASYMMETRY (STE-485 / STE-396), and the M131 sibling-
    // surface drift: a receipt the verifier REQUIRES but the kickoff contract
    // never tells the worker to emit would red every genuine capture. The
    // literals come from the module so the surfaces cannot drift from it.
    const mod = await loadReceipt();
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE]) {
      const text = mustRead(surface);
      expect({ surface, states: text.includes(mod.SPAWN_RECEIPT_PREFIX) }).toEqual({
        surface,
        states: true,
      });
      for (const field of mod.SPAWN_RECEIPT_FIELDS) {
        expect({ surface, field, states: text.includes(`${field}=`) }).toEqual({
          surface,
          field,
          states: true,
        });
      }
    }
  });
});

// ===========================================================================
// AC-STE-516.2 — the handle is RESOLVED, never composed.
// ===========================================================================

describe("AC-STE-516.2 — a composed handle is refused", () => {
  test("emission uses the handle the ownership check resolved", async () => {
    const mod = await loadReceipt();
    const owned = resolvesOk();
    const receipt = render(mod, {}, owned);
    expect(receipt.handle).toBe(SPAWNED.handle);
    // The runner is asked with the bytes the TOOL reported — this module
    // derives no ledger path and composes no row name of its own.
    expect(owned.queries).toEqual([
      { ledger: SPAWNED.ledger, name: SPAWNED.name },
    ]);
  });

  test("a reported handle the check did NOT resolve is a named halt", async () => {
    const mod = await loadReceipt();
    const message = haltText(() =>
      render(mod, { handle: COMPOSED_HANDLE }, resolvesOk()),
    );
    expect(message).toContain("Refusing: ");
    expect(message).toContain("reason=handle-composed");
    // Both handles are quoted, so the operator sees WHICH two disagreed.
    expect(message).toContain(COMPOSED_HANDLE);
    expect(message).toContain(SPAWNED.handle);
  });

  test("a WELL-FORMED but composed handle in a capture is rejected by the verifier", async () => {
    // The discriminator is not the handle's SHAPE. This fixture parses
    // cleanly as a receipt — a shape-only guard would pass it — and is
    // rejected solely because it is not what the ownership check resolved.
    const receipt = await loadReceipt();
    const capture = await loadCapture();
    const composedLine =
      `  - spawn: handle=${COMPOSED_HANDLE} ledger=${SPAWNED.ledger} owned=0`;
    expect(receipt.parseSpawnReceipt(["summary:", composedLine])).not.toBeNull();

    const path = writeCapture("composed", {
      summary: [DEFAULT_SUMMARY_ITEM, composedLine],
    });
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    const reasons = verdict.reasons.join("\n");
    expect(reasons).toContain(COMPOSED_HANDLE);
    expect(reasons).toContain(SPAWNED.handle);
  });

  test("the same capture with the RESOLVED handle is accepted — isolation is half the test", async () => {
    const capture = await loadCapture();
    const path = writeCapture("resolved");
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-516.3 — the verifier grades `summary` for the first time.
// ===========================================================================

describe("AC-STE-516.3 — a worker chain with no receipt is graded not-ok", () => {
  test("worker-placement steps + no receipt ⇒ not-ok, naming the receipt", async () => {
    const capture = await loadCapture();
    const path = writeCapture("no-receipt", { summary: [DEFAULT_SUMMARY_ITEM] });
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    const reasons = verdict.reasons.join("\n");
    expect(reasons).toContain("receipt");
    expect(reasons).toContain("summary");
    expect(reasons).toContain("- spawn:");
  });

  test("the `- (none found)` summary fallback is not a receipt either", async () => {
    const capture = await loadCapture();
    const path = writeCapture("none-found", { summary: ["  - (none found)"] });
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("receipt");
  });

  test("`summary` was ungraded before: the same capture passes with no spawn argument", async () => {
    // This is what "graded for the FIRST time" means, asserted rather than
    // narrated: the receipt-less capture is still a clean report to every
    // shipped caller, and ONLY the new argument makes it fail.
    const capture = await loadCapture();
    const path = writeCapture("no-receipt-shipped", { summary: [DEFAULT_SUMMARY_ITEM] });
    const verdict = capture.verifyDeliverStageCapture(path);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("`chainRequiresSpawnReceipt` answers the question the grading turns on", async () => {
    const mod = await loadReceipt();
    expect(mod.chainRequiresSpawnReceipt(WORKER_CHAIN)).toBe(true);
    expect(mod.chainRequiresSpawnReceipt(INLINE_CHAIN)).toBe(false);
    expect(mod.chainRequiresSpawnReceipt([])).toBe(false);
  });
});

// ===========================================================================
// AC-STE-516.4 — the handle is resolved BEFORE emission; exit zero is the only
// outcome that permits it.
// ===========================================================================

describe("AC-STE-516.4 — resolution precedes emission", () => {
  test("the ownership check runs before the receipt exists", async () => {
    const mod = await loadReceipt();
    const owned = resolvesOk();
    expect(owned.queries.length).toBe(0);
    const receipt = render(mod, {}, owned);
    expect(owned.queries.length).toBe(1);
    expect(receipt.line.length).toBeGreaterThan(0);
  });

  test("exit 0 PERMITS emission; it does not guarantee it — code 0 with no handle halts", async () => {
    const mod = await loadReceipt();
    const message = haltText(() => render(mod, {}, runner({ code: 0 })));
    expect(message).toContain("reason=handle-unresolved");
  });

  test("a runner that throws is a halt, never a guarded pass", async () => {
    const mod = await loadReceipt();
    const message = haltText(() =>
      mod.renderSpawnReceipt({
        spawned: SPAWNED,
        owned: () => {
          throw new Error("owned.py: command not found");
        },
      }),
    );
    expect(message).toContain("Refusing: ");
    expect(message).toContain("Remedy: ");
    expect(message).toContain("Context: ");
  });
});

// ===========================================================================
// AC-STE-516.5 — every non-zero outcome is a NAMED halt, per code.
// ===========================================================================

/** Every documented `owned.py` outcome, plus outcomes it never documented. */
const NON_ZERO_CODES = [1, 2, 3, 4, 5, 7, 127, 255] as const;

/** The two the design named, and the subject each remedy must reach. */
const NAMED_REMEDIES: Readonly<Record<number, { reason: string; subject: string }>> = {
  2: { reason: "no-ledger-row", subject: "ledger" },
  5: { reason: "no-ownership-sidecar", subject: ".owner" },
};

describe("AC-STE-516.5 — no exit code falls through to emission", () => {
  test.each(NON_ZERO_CODES)("exit %i halts rather than emitting", async (code) => {
    const mod = await loadReceipt();
    const message = haltText(() => render(mod, {}, runner({ code })));
    expect(message).toContain("Refusing: ");
    expect(message).toContain("Remedy: ");
    expect(message).toContain("Context: ");
  });

  test("exit 2 — no ledger row — carries its OWN remedy", async () => {
    const mod = await loadReceipt();
    const message = haltText(() => render(mod, {}, runner({ code: 2 })));
    expect(message).toContain(`reason=${NAMED_REMEDIES[2]!.reason}`);
    expect(envelopeLine(message, "Remedy: ")).toContain(NAMED_REMEDIES[2]!.subject);
  });

  test("exit 5 — no ownership sidecar — carries its OWN remedy", async () => {
    const mod = await loadReceipt();
    const message = haltText(() => render(mod, {}, runner({ code: 5 })));
    expect(message).toContain(`reason=${NAMED_REMEDIES[5]!.reason}`);
    expect(envelopeLine(message, "Remedy: ")).toContain(NAMED_REMEDIES[5]!.subject);
  });

  test("every OTHER non-zero outcome quotes its exit code in the message", async () => {
    const mod = await loadReceipt();
    for (const code of NON_ZERO_CODES) {
      if (NAMED_REMEDIES[code] !== undefined) continue;
      const message = haltText(() => render(mod, {}, runner({ code })));
      expect({ code, quoted: message.includes(`exit code ${code}`) }).toEqual({
        code,
        quoted: true,
      });
      expect({ code, named: message.includes("reason=ownership-unresolved") }).toEqual({
        code,
        named: true,
      });
    }
  });

  test("the two named remedies are not the generic one — a catch-all cannot satisfy all three", async () => {
    const mod = await loadReceipt();
    const remedyFor = (code: number): string =>
      envelopeLine(haltText(() => render(mod, {}, runner({ code }))), "Remedy: ");
    const remedies = [remedyFor(2), remedyFor(5), remedyFor(1)];
    expect(new Set(remedies).size).toBe(remedies.length);
  });

  // -------------------------------------------------------------------------
  // STRENGTHENING (M133 GREEN round). "Every non-zero outcome halts" was
  // satisfied without anyone asking whether the halt says the RIGHT thing.
  //
  // `agent-toolkit lib/owned.py` documents THREE of its codes as hard stops:
  //
  //     exit 3   HARD STOP, never retry — a live session holds this NAME but
  //              is not ours, or `.owner` names another session
  //     exit 4   ambiguous: more than one live session answers — HARD STOP
  //     exit 5   no `.owner` beside the ledger — unprovable, HARD STOP
  //
  // Exit 5 got its own remedy because the design named it. Exits 3 and 4 fell
  // into the GENERIC family, whose remedy ends `then re-run the stage` — which
  // for a code documented as never-retry is not merely vague, it is WRONG: it
  // instructs the operator to do the one thing the contract forbids. A remedy
  // that reads plausibly and advises the opposite of the contract is the same
  // class of defect as a guard that passes when it cannot run.
  //
  // These legs do NOT re-home 3 and 4 into `NAMED_REMEDIES`: the machine
  // reason stays `ownership-unresolved` and the exit code stays quoted, so the
  // two shipped legs above keep their full coverage. What changes is the
  // operator-facing halves — the refusal names the actual condition, and the
  // remedy states the never-retry contract instead of contradicting it.
  // -------------------------------------------------------------------------

  /**
   * The codes `owned.py` documents as never-retry hard stops, and the word
   * each refusal must use to say WHICH hard stop it is. Both tokens are the
   * tool's own vocabulary, quoted from its module docstring.
   */
  const HARD_STOP_CODES: Readonly<Record<number, string>> = {
    3: "not ours",
    4: "ambiguous",
  };

  /** The generic remedy's tail — the exact wrong advice for a never-retry code. */
  const GENERIC_RETRY_TAIL = "then re-run the stage";

  /** The never-retry contract, in `owned.py`'s own words. */
  const NEVER_RETRY = "never retry";

  const remedyForCode = async (code: number): Promise<string> => {
    const mod = await loadReceipt();
    return envelopeLine(haltText(() => render(mod, {}, runner({ code }))), "Remedy: ");
  };

  test.each([3, 4])(
    "exit %i is a documented HARD STOP: its remedy never instructs a re-run",
    async (code) => {
      const remedy = (await remedyForCode(code)).toLowerCase();
      expect({
        code,
        instructsRerun: remedy.includes(GENERIC_RETRY_TAIL),
        statesNeverRetry: remedy.includes(NEVER_RETRY),
      }).toEqual({ code, instructsRerun: false, statesNeverRetry: true });
    },
  );

  test.each([3, 4])(
    "exit %i names what it actually is, not a generic ownership failure",
    async (code) => {
      const mod = await loadReceipt();
      const refusing = envelopeLine(
        haltText(() => render(mod, {}, runner({ code }))),
        "Refusing: ",
      ).toLowerCase();
      expect({ code, names: refusing.includes(HARD_STOP_CODES[code]!) }).toEqual({
        code,
        names: true,
      });
    },
  );

  test("ISOLATION: the retryable outcomes still DO tell the operator to re-run", async () => {
    // Half the test. Without this, an implementer could strip `then re-run the
    // stage` from EVERY remedy and the legs above would go green while the
    // operator lost the correct advice on the codes that genuinely are
    // retryable. Exit 1 (nothing live), exit 2 (no ledger row) and exit 5 (no
    // sidecar — a hard stop for OWNERSHIP, but one the operator repairs and
    // then re-runs) all keep their re-run instruction and none of them claims
    // the never-retry contract.
    for (const code of [1, 2, 5]) {
      const remedy = (await remedyForCode(code)).toLowerCase();
      expect({
        code,
        instructsRerun: remedy.includes(GENERIC_RETRY_TAIL),
        statesNeverRetry: remedy.includes(NEVER_RETRY),
      }).toEqual({ code, instructsRerun: true, statesNeverRetry: false });
    }
  });

  test("the five per-code refusals stay pairwise distinct once 3 and 4 specialise", async () => {
    // AC.5's shipped distinctness leg covers {2, 5, 1}. Specialising 3 and 4
    // adds two more messages that must not collapse into each other or into
    // any of those three — a shared "hard stop" sentence for both would be the
    // catch-all shape one layer up.
    const mod = await loadReceipt();
    const pairs = [1, 2, 3, 4, 5].map((code) => {
      const message = haltText(() => render(mod, {}, runner({ code })));
      return `${envelopeLine(message, "Refusing: ")}\n${envelopeLine(message, "Remedy: ")}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

// ===========================================================================
// AC-STE-516.6 — installed tool, no terminal host: a named halt with its own
// remedy, never a guarded pass.
// ===========================================================================

describe("AC-STE-516.6 — no terminal host is a named halt", () => {
  test("host absent ⇒ halt, named, with its own remedy", async () => {
    const mod = await loadReceipt();
    const message = haltText(() => render(mod, { host: null }, resolvesOk()));
    expect(message).toContain("reason=no-terminal-host");
    expect(envelopeLine(message, "Remedy: ").toLowerCase()).toContain("host");
  });

  test("the host guard fires even when the ownership check would resolve cleanly", async () => {
    // THE FAIL-OPEN SHAPE THIS KILLS. If the host check merely rode the exit-2
    // path, a stale ledger row would let a hostless run emit a receipt. The
    // runner here answers a CLEAN RESOLVE and the halt fires anyway — and the
    // runner is never even consulted.
    const mod = await loadReceipt();
    const owned = resolvesOk();
    const message = haltText(() =>
      mod.renderSpawnReceipt({ spawned: { ...SPAWNED, host: null }, owned }),
    );
    expect(message).toContain("reason=no-terminal-host");
    expect(owned.queries).toEqual([]);
  });

  test("its remedy is distinct from every ownership remedy", async () => {
    const mod = await loadReceipt();
    const hostRemedy = envelopeLine(
      haltText(() => render(mod, { host: null }, resolvesOk())),
      "Remedy: ",
    );
    for (const code of [1, 2, 5]) {
      const other = envelopeLine(
        haltText(() => render(mod, {}, runner({ code }))),
        "Remedy: ",
      );
      expect({ code, same: other === hostRemedy }).toEqual({ code, same: false });
    }
  });

  // -------------------------------------------------------------------------
  // STRENGTHENING (M133 GREEN round). SURFACE PARITY for the one halt the
  // design wrote out in full.
  //
  // `no-terminal-host` is implemented and mutation-verified in the module, and
  // appears in NEITHER `skills/deliver/SKILL.md` NOR `docs/deliver-reference.md`.
  // AC.1's parity leg covers the receipt LINE on both surfaces; nothing covers
  // this halt, so the omission was structurally invisible.
  //
  // Why it is not tidiness. Every other halt here has a pre-flight that could
  // in principle catch it earlier — pre-flight probes the spawning TOOL. It
  // never probes the HOST, because a host is a property of the session the
  // operator is sitting in, not of the install. So the operative surfaces are
  // the ONLY place an operator learns this configuration exists at all, and a
  // halt that fires for a condition no document mentions reads as a bug in
  // `/deliver` rather than as the named refusal it is.
  //
  // The M131 sibling-surface shape, and the class memory records as still
  // unguarded: BOTH surfaces state it, and the two AGREE. The halt name is
  // read from the module's exported `SPAWN_RECEIPT_HALTS` rather than retyped,
  // which is AC.1's idiom — a rename in the module moves the surfaces with it.
  // -------------------------------------------------------------------------

  /** The halt whose parity is asserted. Membership in the export is checked. */
  const NO_HOST_HALT = "no-terminal-host";

  /** The two terminal hosts the module's own remedy names. */
  const HOST_KINDS = ["cmux", "herdr"] as const;

  /**
   * The line on `surface` that carries the halt name, or `null`.
   *
   * LINE-SCOPED on purpose. A whole-file `includes` for "cmux" would be a pin
   * on a wrong subject the moment either surface mentions cmux for any other
   * reason — the proximity-window shape that shipped four bad pins in M129. A
   * line carrying `no-terminal-host` cannot be pre-existing text: neither
   * surface contains that token today.
   */
  function haltClause(surfaceText: string, haltName: string): string | null {
    return (
      surfaceText
        .replace(/\r\n/g, "\n")
        .split("\n")
        .find((line) => line.includes(haltName)) ?? null
    );
  }

  test("the halt name comes from the module's exported halt list, not a literal", async () => {
    const mod = await loadReceipt();
    expect(mod.SPAWN_RECEIPT_HALTS).toContain(NO_HOST_HALT);
  });

  test("BOTH operative surfaces state the no-terminal-host halt", async () => {
    const mod = await loadReceipt();
    const halt = mod.SPAWN_RECEIPT_HALTS.find((name) => name === NO_HOST_HALT);
    expect(halt).toBe(NO_HOST_HALT);
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE]) {
      expect({
        surface,
        states: haltClause(mustRead(surface), halt!) !== null,
      }).toEqual({ surface, states: true });
    }
  });

  test("the two surfaces AGREE on what the halt is", async () => {
    // The parity half. Equal vectors alone would be satisfied by both surfaces
    // saying NOTHING, so the shared vector is asserted all-true as well —
    // vacuous agreement is the failure mode this shape exists to avoid.
    const mod = await loadReceipt();
    const halt = mod.SPAWN_RECEIPT_HALTS.find((name) => name === NO_HOST_HALT)!;

    const describeSurface = (surface: string): Record<string, boolean> => {
      const clause = (haltClause(mustRead(surface), halt) ?? "").toLowerCase();
      return {
        statesTheHalt: clause.length > 0,
        callsItAHalt: clause.includes("halt"),
        ...Object.fromEntries(HOST_KINDS.map((kind) => [kind, clause.includes(kind)])),
      };
    };

    const expected = {
      statesTheHalt: true,
      callsItAHalt: true,
      ...Object.fromEntries(HOST_KINDS.map((kind) => [kind, true])),
    };

    const skill = describeSurface(DELIVER_SKILL);
    const reference = describeSurface(DELIVER_REFERENCE);

    expect({ surface: "skills/deliver/SKILL.md", ...skill }).toEqual({
      surface: "skills/deliver/SKILL.md",
      ...expected,
    });
    expect({ surface: "docs/deliver-reference.md", ...reference }).toEqual({
      surface: "docs/deliver-reference.md",
      ...expected,
    });
    expect(skill).toEqual(reference);
  });
});

// ===========================================================================
// AC-STE-516.7 — a chain with no worker-placement steps is graded EXACTLY as
// today, asserted byte-identically.
// ===========================================================================

describe("AC-STE-516.7 — the inline chain is graded exactly as today", () => {
  test("inline-only chain: verdict is byte-identical to the shipped two-argument call", async () => {
    const capture = await loadCapture();
    const path = writeCapture("inline-chain", { summary: [DEFAULT_SUMMARY_ITEM] });
    const shipped = capture.verifyDeliverStageCapture(path);
    const withChain = capture.verifyDeliverStageCapture(path, null, {
      chain: INLINE_CHAIN,
    });
    expect(JSON.stringify(withChain)).toBe(JSON.stringify(shipped));
    expect(shipped.ok).toBe(true);
  });

  test("byte-identity holds on a FAILING capture too, so the pin is not `ok:true` twice", async () => {
    const capture = await loadCapture();
    const path = writeCapture("inline-chain-bad", {
      summary: [DEFAULT_SUMMARY_ITEM],
      order: ["stage", "milestone", "status", "summary", "drive", "e2e", "gate", "follow_ups"],
    });
    const shipped = capture.verifyDeliverStageCapture(path);
    const withChain = capture.verifyDeliverStageCapture(path, null, {
      chain: INLINE_CHAIN,
    });
    expect(shipped.ok).toBe(false);
    expect(JSON.stringify(withChain)).toBe(JSON.stringify(shipped));
  });

  test("an empty chain and an absent spawn argument agree", async () => {
    const capture = await loadCapture();
    const path = writeCapture("empty-chain", { summary: [DEFAULT_SUMMARY_ITEM] });
    expect(
      JSON.stringify(capture.verifyDeliverStageCapture(path, null, { chain: [] })),
    ).toBe(JSON.stringify(capture.verifyDeliverStageCapture(path, null, null)));
  });

  test("a receipt present on an inline chain is tolerated, not a new failure", async () => {
    // The inline path is graded EXACTLY as today, and today extra summary
    // content is tolerated. A guard that started refusing a stray receipt
    // would be a new failure mode this AC forbids.
    const capture = await loadCapture();
    const path = writeCapture("inline-with-receipt");
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: INLINE_CHAIN,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-516.8 — the receipt costs ONE line, and the block stays inside the
// cap READ FROM its exported constant.
// ===========================================================================

describe("AC-STE-516.8 — one line, inside the exported cap", () => {
  test("the receipt costs exactly one fence line", async () => {
    const withReceipt = fenceLinesOf(writeCapture("cost-with"));
    const without = fenceLinesOf(
      writeCapture("cost-without", { summary: [DEFAULT_SUMMARY_ITEM] }),
    );
    expect(withReceipt.length - without.length).toBe(1);
  });

  test("a receipted fence stays at or under FENCE_LINE_CAP", async () => {
    const capture = await loadCapture();
    expect(capture.FENCE_LINE_CAP).toBe(FENCE_LINE_CAP);
    expect(fenceLinesOf(writeCapture("cap")).length).toBeLessThanOrEqual(
      capture.FENCE_LINE_CAP,
    );
  });

  test("the SHIPPED genuine fixture, receipt and all, stays under the cap", () => {
    expect(fenceLinesOf(CAPTURE_GENUINE).length).toBeLessThanOrEqual(FENCE_LINE_CAP);
  });

  test("the cap has headroom for a receipt on a real multi-FR report", async () => {
    // Five summary items (a five-FR milestone) plus the receipt plus the three
    // evidence sections: the budget must hold a REAL report, not just this
    // file's minimal one, or the receipt is affordable only in a test.
    const capture = await loadCapture();
    const path = writeCapture("headroom", {
      summary: [
        "  - STE-513 lands the decision record",
        "  - STE-514 lands the routing table",
        "  - STE-515 lands the halt taxonomy",
        "  - STE-516 lands the spawn receipt",
        "  - STE-517 lands the surface parity guard",
        DEFAULT_RECEIPT_LINE,
      ],
    });
    expect(fenceLinesOf(path).length).toBeLessThanOrEqual(capture.FENCE_LINE_CAP);
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons).toEqual([]);
  });

  test("the cap is READ, never retyped — this file carries no literal copy of it", () => {
    // `feedback_falsifiability_limits` + the M132 finding that NFR-1's cap was
    // pinned at the wrong number for a whole milestone: a retyped bound stops
    // tracking the constant the moment the constant moves.
    const ownSource = mustRead(join(import.meta.dir, "m133-ste-516-spawn-receipt.test.ts"));
    const literal = new RegExp(`\\b${FENCE_LINE_CAP}\\b`);
    expect({ cap: FENCE_LINE_CAP, retyped: literal.test(ownSource) }).toEqual({
      cap: FENCE_LINE_CAP,
      retyped: false,
    });
  });
});

// ===========================================================================
// AC-STE-516.9 — the three shipped fixtures carry the receipt and still grade
// as they did.
// ===========================================================================

describe("AC-STE-516.9 — the shipped fixture group stays green AND discriminating", () => {
  test("all three shipped fixtures carry the receipt", async () => {
    const mod = await loadReceipt();
    for (const fixture of [CAPTURE_GENUINE, CAPTURE_NO_FENCE, CAPTURE_REORDERED]) {
      const text = mustRead(fixture);
      expect({ fixture, carries: text.includes(mod.SPAWN_RECEIPT_PREFIX) }).toEqual({
        fixture,
        carries: true,
      });
    }
  });

  test("the genuine fixture's receipt parses, and its handle is what grades it", async () => {
    const mod = await loadReceipt();
    const capture = await loadCapture();
    const parsed = mod.parseSpawnReceipt(fenceLinesOf(CAPTURE_GENUINE));
    expect(parsed).not.toBeNull();
    expect(parsed!.handle.length).toBeGreaterThan(0);
    expect(parsed!.owned).toBe(0);

    const verdict = capture.verifyDeliverStageCapture(CAPTURE_GENUINE, null, {
      chain: WORKER_CHAIN,
      handle: parsed!.handle,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("the genuine fixture still grades ok on the shipped two-argument call", async () => {
    const capture = await loadCapture();
    const verdict = capture.verifyDeliverStageCapture(CAPTURE_GENUINE);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("mutation 1 (fence removed) is still rejected, for the fence", async () => {
    const capture = await loadCapture();
    const verdict = capture.verifyDeliverStageCapture(CAPTURE_NO_FENCE, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("deliver-stage-result fence");
  });

  test("mutation 2 (sections reordered) is still rejected, for the order", async () => {
    const capture = await loadCapture();
    const verdict = capture.verifyDeliverStageCapture(CAPTURE_REORDERED, null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("out of order");
  });

  test("adding the receipt did not make the mutations pass on the shipped call", async () => {
    const capture = await loadCapture();
    for (const fixture of [CAPTURE_NO_FENCE, CAPTURE_REORDERED]) {
      const verdict = capture.verifyDeliverStageCapture(fixture);
      expect({ fixture, ok: verdict.ok }).toEqual({ fixture, ok: false });
    }
  });
});

// ===========================================================================
// AC-STE-516.10 — every guard is mutation-verified: each failure is DISTINCT,
// and none of them produces a pass.
// ===========================================================================

describe("AC-STE-516.10 — the guards are falsifiable, and distinctly so", () => {
  test("the control passes: nothing mutated ⇒ ok", async () => {
    const receipt = await loadReceipt();
    const capture = await loadCapture();
    expect(render(receipt, {}, resolvesOk()).line.length).toBeGreaterThan(0);
    const verdict = capture.verifyDeliverStageCapture(writeCapture("control"), null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons).toEqual([]);
  });

  test("every mutation fails, and no two fail the same way", async () => {
    const receipt = await loadReceipt();
    const capture = await loadCapture();

    const failures: { mutation: string; text: string }[] = [];

    const grade = (mutation: string, path: string): void => {
      const verdict = capture.verifyDeliverStageCapture(path, null, {
        chain: WORKER_CHAIN,
        handle: SPAWNED.handle,
      });
      expect({ mutation, ok: verdict.ok }).toEqual({ mutation, ok: false });
      failures.push({ mutation, text: verdict.reasons.join("\n") });
    };

    // Mutation 1 — the receipt removed.
    grade("receipt-removed", writeCapture("m-removed", { summary: [DEFAULT_SUMMARY_ITEM] }));

    // Mutation 2 — a well-formed but COMPOSED handle.
    grade(
      "handle-composed",
      writeCapture("m-composed", {
        summary: [
          DEFAULT_SUMMARY_ITEM,
          `  - spawn: handle=${COMPOSED_HANDLE} ledger=${SPAWNED.ledger} owned=0`,
        ],
      }),
    );

    // Mutation 3 — the fields transposed: a receipt-shaped line that is not one.
    grade(
      "fields-transposed",
      writeCapture("m-transposed", {
        summary: [
          DEFAULT_SUMMARY_ITEM,
          `  - spawn: ledger=${SPAWNED.ledger} handle=${SPAWNED.handle} owned=0`,
        ],
      }),
    );

    // Mutations 4..n — each ownership outcome in turn, plus the hostless case.
    for (const code of NON_ZERO_CODES) {
      failures.push({
        mutation: `owned-exit-${code}`,
        text: haltText(() => render(receipt, {}, runner({ code }))),
      });
    }
    failures.push({
      mutation: "no-terminal-host",
      text: haltText(() => render(receipt, { host: null }, resolvesOk())),
    });
    failures.push({
      mutation: "handle-unresolved",
      text: haltText(() => render(receipt, {}, runner({ code: 0 }))),
    });

    // NONE produced a pass, and every one of them is DISTINGUISHABLE. A single
    // catch-all halt would collapse this set and is refused here by name.
    expect(failures.every((entry) => entry.text.trim().length > 0)).toBe(true);
    const texts = failures.map((entry) => entry.text);
    const collisions = failures.filter(
      (entry, i) => texts.indexOf(entry.text) !== i,
    );
    expect({ collisions: collisions.map((entry) => entry.mutation) }).toEqual({
      collisions: [],
    });
    expect(failures.length).toBe(3 + NON_ZERO_CODES.length + 2);
  });
});

// ===========================================================================
// AUDIT ROUND — three findings the per-AC legs above structurally could not
// see. Each fails against the code as shipped at the moment it was written.
//
//   ITEM 1 (HIGH) — THE GRADING SIDE IGNORED `owned`. `parseSpawnReceipt`
//     parses the field into a number and NOTHING consumed it, so a capture
//     carrying `owned=3` — a FAILED ownership check, reported as a receipt —
//     came back `{ok: true, reasons: []}`. Emission is the half nothing
//     invokes; GRADING is the half a real capture travels, and a stage that
//     composes its fence by hand is the exact threat model this FR exists to
//     close. Both operative surfaces already state that only `0` is
//     emittable; the grader has to be the one that enforces it.
//
//   ITEM 2 (HIGH) — NEITHER HALF HAD AN INVOKER. Both operative surfaces
//     spelled the verifier call with TWO arguments, so on every path a real
//     `/deliver` run travels the receipt grading never fired at all. AC.1's
//     parity legs pin the receipt LINE on both surfaces; nothing pinned the
//     CALL. This is the M132 `captureSkipBaseline` shape — a headline feature
//     that could never have fired — and a file-wide `includes` cannot see it,
//     so the legs below are scoped to the call spelling itself.
//
//   ITEM 3 (MEDIUM) — `chainRequiresSpawnReceipt` asked `=== "worker"`, which
//     is fail-OPEN: a placement added upstream is graded as owing NO receipt.
//     The fail-CLOSED question is `!== "inline"` — anything that is not inline
//     owes evidence, so a new placement defaults to REQUIRING a receipt rather
//     than to being excused. The `StepPlacement` re-export comment claimed the
//     type import closed this hole; `import type` is erased at compile time,
//     so it never could, and a comment stating a guarantee the code does not
//     provide is worse than no comment — a reader stops looking.
// ===========================================================================

/** A receipt line with arbitrary field values — the GRADING side's input. */
function receiptLine(fields: {
  handle?: string;
  ledger?: string;
  owned: number | string;
}): string {
  return (
    `  - spawn: handle=${fields.handle ?? SPAWNED.handle}` +
    ` ledger=${fields.ledger ?? SPAWNED.ledger} owned=${fields.owned}`
  );
}

/** Grade a capture whose only non-default summary content is `line`. */
function gradeReceipt(
  capture: CaptureModule,
  label: string,
  line: string,
  spawn: StageSpawnExpectation,
): DeliverStageCaptureVerdict {
  return capture.verifyDeliverStageCapture(
    writeCapture(label, { summary: [DEFAULT_SUMMARY_ITEM, line] }),
    null,
    spawn,
  );
}

/**
 * Ownership exit codes a capture could CARRY. None may grade clean.
 *
 * The documented ones are here, and so are 42 and 4096 — values no plausible
 * implementation special-cases. A branch that enumerated only the codes the
 * design named would wave those two through, which is the fall-through shape
 * AC.5 closed on the emission side and this block closes on the grading side.
 */
const NON_ZERO_OWNED = [1, 2, 3, 4, 5, 7, 42, 127, 255, 4096] as const;

describe("AUDIT 1 — the GRADING side refuses a non-zero `owned`", () => {
  test("owned=0 is accepted — the control, so every refusal below is falsifiable", async () => {
    const capture = await loadCapture();
    const verdict = gradeReceipt(capture, "owned-zero", receiptLine({ owned: 0 }), {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test.each(NON_ZERO_OWNED)(
    "a receipt carrying owned=%i is graded not-ok",
    async (code) => {
      const capture = await loadCapture();
      const verdict = gradeReceipt(
        capture,
        `owned-${code}`,
        receiptLine({ owned: code }),
        { chain: WORKER_CHAIN, handle: SPAWNED.handle },
      );
      expect({ code, ok: verdict.ok }).toEqual({ code, ok: false });
      const reasons = verdict.reasons.join("\n");
      expect(reasons).toContain("owned");
      // The OBSERVED code is quoted — the AC.5 idiom. An operator told only
      // "owned must be 0" cannot see which ownership outcome was reported.
      expect(reasons).toContain(String(code));
    },
  );

  test("the refusal is the ONLY reason — it does not ride on some other violation", async () => {
    const capture = await loadCapture();
    const verdict = gradeReceipt(capture, "owned-alone", receiptLine({ owned: 3 }), {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons.length).toBe(1);
  });

  test("it fires with NO expected handle — fail-closed cannot depend on the caller", async () => {
    // The same shape AC.3 pins for absence: gating this on a known handle
    // would reopen the hole for every caller that omits the third field.
    const capture = await loadCapture();
    const verdict = gradeReceipt(capture, "owned-nohandle", receiptLine({ owned: 7 }), {
      chain: WORKER_CHAIN,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("7");
  });

  test("its reason is its OWN — distinct from ABSENT, MALFORMED and MISMATCHED", async () => {
    // Four operator situations, four remedies. A grader that answers a failed
    // ownership check with the absent sentence sends the operator off to add a
    // line that is already there — and a reader cannot tell from the texts
    // that four guards exist rather than one firing four times.
    const capture = await loadCapture();
    const spawn = { chain: WORKER_CHAIN, handle: SPAWNED.handle };

    const cases: Record<string, string> = {
      "owned-non-zero": gradeReceipt(
        capture,
        "d-nonzero",
        receiptLine({ owned: 3 }),
        spawn,
      ).reasons.join("\n"),
      malformed: gradeReceipt(
        capture,
        "d-malformed",
        `  - spawn: ledger=${SPAWNED.ledger} handle=${SPAWNED.handle} owned=0`,
        spawn,
      ).reasons.join("\n"),
      mismatched: gradeReceipt(
        capture,
        "d-mismatched",
        receiptLine({ handle: COMPOSED_HANDLE, owned: 0 }),
        spawn,
      ).reasons.join("\n"),
      absent: capture
        .verifyDeliverStageCapture(
          writeCapture("d-absent", { summary: [DEFAULT_SUMMARY_ITEM] }),
          null,
          spawn,
        )
        .reasons.join("\n"),
    };

    const empty = Object.entries(cases)
      .filter(([, text]) => text.trim().length === 0)
      .map(([name]) => name);
    expect({ gradedClean: empty }).toEqual({ gradedClean: [] });

    const texts = Object.values(cases);
    const collisions = Object.keys(cases).filter(
      (name, i) => texts.indexOf(cases[name]!) !== i,
    );
    expect({ collisions }).toEqual({ collisions: [] });
  });

  test("two different non-zero codes are distinguishable from each other", async () => {
    const capture = await loadCapture();
    const spawn = { chain: WORKER_CHAIN, handle: SPAWNED.handle };
    const three = gradeReceipt(capture, "p-3", receiptLine({ owned: 3 }), spawn);
    const other = gradeReceipt(capture, "p-127", receiptLine({ owned: 127 }), spawn);
    expect(three.reasons.join("\n")).not.toBe(other.reasons.join("\n"));
  });

  test("the inline path is untouched: a non-zero receipt on a no-worker chain still grades as today", async () => {
    // AC.7 is byte-identical or it is nothing. A guard that started refusing a
    // stray non-zero receipt on a chain that spawned nothing would be a new
    // failure mode on the one path this FR promised not to touch.
    const capture = await loadCapture();
    const path = writeCapture("owned-inline", {
      summary: [DEFAULT_SUMMARY_ITEM, receiptLine({ owned: 3 })],
    });
    const shipped = capture.verifyDeliverStageCapture(path);
    const withChain = capture.verifyDeliverStageCapture(path, null, {
      chain: INLINE_CHAIN,
    });
    expect(JSON.stringify(withChain)).toBe(JSON.stringify(shipped));
    expect(shipped.ok).toBe(true);
  });
});

// ===========================================================================
// AUDIT 2 — the operative surfaces spell the THREE-argument call.
// ===========================================================================

/** One `verifyDeliverStageCapture(...)` call spelling found in a surface. */
interface VerifierCall {
  readonly line: number;
  readonly raw: string;
  readonly args: readonly string[];
}

/**
 * Every call spelling in `text`, with the line it sits on.
 *
 * LINE-SCOPED on purpose. A whole-file `includes("spawn")` passes on any stray
 * mention anywhere in the document — including the receipt-line prose AC.1
 * already pins — and would therefore be green today, while the call it claims
 * to be about is still two-argument.
 */
function verifierCalls(text: string): VerifierCall[] {
  const calls: VerifierCall[] = [];
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      const re = /verifyDeliverStageCapture\(([^)]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        calls.push({
          line: index + 1,
          raw: match[0]!,
          args: match[1]!
            .split(",")
            .map((arg) => arg.trim())
            .filter((arg) => arg.length > 0),
        });
      }
    });
  return calls;
}

/** Does this spelling PASS the spawn expectation rather than omit it? */
function passesSpawn(call: VerifierCall): boolean {
  return call.args.length >= 3 && /spawn/i.test(call.args[2]!);
}

describe("AUDIT 2 — the grading has an invoker on the shipped surfaces", () => {
  test("the predicate DISCRIMINATES: two-argument is not three-argument", async () => {
    // The mutation, run in-process so it needs no file edit: the two-argument
    // spelling the surfaces carried is refused, the three-argument one is
    // accepted. A predicate that could not tell them apart would pass this
    // block forever, which is the defect being closed.
    const two = verifierCalls("verified with `verifyDeliverStageCapture(capturePath, evidence)` here");
    expect(two.length).toBe(1);
    expect(passesSpawn(two[0]!)).toBe(false);

    const three = verifierCalls("`verifyDeliverStageCapture(capturePath, evidence, spawn)`");
    expect(three.length).toBe(1);
    expect(passesSpawn(three[0]!)).toBe(true);

    // A third argument that is not the spawn expectation is not one either.
    const wrong = verifierCalls("verifyDeliverStageCapture(capturePath, evidence, null)");
    expect(passesSpawn(wrong[0]!)).toBe(false);
  });

  test("BOTH operative surfaces name the call at all", async () => {
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE]) {
      const calls = verifierCalls(mustRead(surface));
      expect({ surface, namesTheCall: calls.length > 0 }).toEqual({
        surface,
        namesTheCall: true,
      });
    }
  });

  test("EVERY spelling on both surfaces passes the spawn expectation", async () => {
    // Every one, not merely one: a surface that added a three-argument
    // sentence while leaving a stale two-argument sentence beside it tells the
    // worker two different things, and the stale half is the one a reader
    // reaches first. The failure names file:line so the stale spelling is
    // findable rather than merely reported.
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE]) {
      const omits = verifierCalls(mustRead(surface))
        .filter((call) => !passesSpawn(call))
        .map((call) => `${surface}:${call.line} ${call.raw}`);
      expect({ surface, spellingsOmittingTheSpawn: omits }).toEqual({
        surface,
        spellingsOmittingTheSpawn: [],
      });
    }
  });

  test("the two surfaces AGREE — no half-migrated surface", async () => {
    // Equal vectors alone would be satisfied by both surfaces saying NOTHING,
    // so the shared vector is asserted all-true as well. `namesTheCall` guards
    // `every` against passing vacuously on an empty call list.
    const describeSurface = (surface: string): Record<string, boolean> => {
      const calls = verifierCalls(mustRead(surface));
      return {
        namesTheCall: calls.length > 0,
        everySpellingPassesSpawn: calls.length > 0 && calls.every(passesSpawn),
      };
    };
    const expected = { namesTheCall: true, everySpellingPassesSpawn: true };

    const skill = describeSurface(DELIVER_SKILL);
    const reference = describeSurface(DELIVER_REFERENCE);

    expect({ surface: "skills/deliver/SKILL.md", ...skill }).toEqual({
      surface: "skills/deliver/SKILL.md",
      ...expected,
    });
    expect({ surface: "docs/deliver-reference.md", ...reference }).toEqual({
      surface: "docs/deliver-reference.md",
      ...expected,
    });
    expect(skill).toEqual(reference);
  });

  test("the third argument is the SPAWN EXPECTATION the verifier declares, not a placeholder", async () => {
    // The verifier's own parameter is named `spawn` and typed
    // `StageSpawnExpectation`. A surface that spelled a third argument the
    // module has no parameter for would be documenting a call that does not
    // exist, so the surfaces are checked against the module rather than
    // against a second literal.
    const source = mustRead(CAPTURE_MODULE);
    expect(source).toContain("spawn?: StageSpawnExpectation");
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE]) {
      const named = verifierCalls(mustRead(surface))
        .filter(passesSpawn)
        .map((call) => call.args[2]!);
      expect({ surface, thirdArguments: named.length > 0 }).toEqual({
        surface,
        thirdArguments: true,
      });
    }
  });
});

// ===========================================================================
// AUDIT 3 — `chainRequiresSpawnReceipt` is fail-CLOSED on an unknown
// placement, and the false rationale is gone.
// ===========================================================================

/**
 * Placements the vocabulary does not carry today. The re-export comment
 * claimed a type-only import protected against exactly these; types are
 * ERASED, so only the predicate can. `remote` is not hypothetical — the
 * spawning tool already has a remote mode.
 */
const UNKNOWN_PLACEMENTS = ["remote", "detached", "cloud"] as const;

/** A step carrying a placement the compile-time union does not know. */
function placedStep(placement: string): ChainStep {
  return { placement } as unknown as ChainStep;
}

describe("AUDIT 3 — an unknown placement owes a receipt, not an excuse", () => {
  test.each(UNKNOWN_PLACEMENTS)(
    "a `%s`-placement step is graded as owing a receipt",
    async (placement) => {
      const mod = await loadReceipt();
      expect({
        placement,
        requires: mod.chainRequiresSpawnReceipt([placedStep(placement)]),
      }).toEqual({ placement, requires: true });
    },
  );

  test("only `inline` is excused — the true half above is not vacuous", async () => {
    const mod = await loadReceipt();
    expect(mod.chainRequiresSpawnReceipt([placedStep("inline")])).toBe(false);
    expect(mod.chainRequiresSpawnReceipt(INLINE_CHAIN)).toBe(false);
    expect(mod.chainRequiresSpawnReceipt([])).toBe(false);
    expect(mod.chainRequiresSpawnReceipt(WORKER_CHAIN)).toBe(true);
  });

  test("a mixed chain whose only non-inline step is unknown still owes one", async () => {
    const mod = await loadReceipt();
    expect(
      mod.chainRequiresSpawnReceipt([
        placedStep("inline"),
        placedStep("inline"),
        placedStep("remote"),
      ]),
    ).toBe(true);
  });

  test("the consequence, end to end: such a chain with no receipt is graded not-ok", async () => {
    // The predicate is not the point on its own — this is. A chain that ran a
    // step somewhere other than the orchestrating session, reporting no
    // receipt, is exactly the run that prompted this FR.
    const capture = await loadCapture();
    const path = writeCapture("unknown-placement", { summary: [DEFAULT_SUMMARY_ITEM] });
    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: [placedStep("inline"), placedStep("remote")],
      handle: SPAWNED.handle,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("- spawn:");
  });

  test("the false rationale is GONE from the module source", async () => {
    // The REFACTOR pass wrote that the type-only re-export closes a fail-open
    // where "a third placement added upstream would leave the copy two-valued
    // and chainRequiresSpawnReceipt grade such a chain as owing NO receipt".
    // Inverted: `import type` is erased, so `=== "worker"` answered `false`
    // for a third placement whether the union was imported or copied — the
    // re-export made the hole QUIETER, since a private copy would at least
    // have given a caller a compile error.
    const source = mustRead(RECEIPT_MODULE).replace(/\s+/g, " ");
    for (const claim of [
      "two-valued",
      "reintroduced by a type",
      "is graded as owing no receipt",
      'whether any step is `"worker"`',
    ]) {
      expect({ claim, stillClaimed: source.includes(claim) }).toEqual({
        claim,
        stillClaimed: false,
      });
    }
  });
});

// ===========================================================================
// AUDIT 4 — the second audit-raised round. Four items, one shape: the FR's
// headline claim — "a stage cannot report a spawn it did not perform" — is
// FALSE on the path that ships.
//
//   ITEM 1 (HIGH) — THE HANDLE COMPARISON IS CALLER-OPTIONAL.
//     `deliver_stage_capture.ts` ends `checkSpawnReceipt` with
//     `const expected = spawn.handle; if (expected === undefined) return;`.
//     Probed against the SHIPPED genuine fixture with a composed handle
//     substituted, `verifyDeliverStageCapture(fixture, null, {chain:[{placement:
//     "worker"}]})` returned `{ok:true, reasons:[], graded:"shape-only"}`. A
//     worker chain whose fence carries a WHOLLY FABRICATED handle grades CLEAN
//     whenever the caller supplies the chain but not the handle.
//
//     The module comment defends `handle` being optional so ABSENCE cannot
//     depend on the caller. That reasoning is right FOR ABSENCE and does not
//     extend to MISMATCH: a receipt whose handle NOTHING CORROBORATES is
//     precisely the narrated evidence AC.2 exists to eliminate. Every existing
//     AC.2 and AC.10 leg passes `handle: SPAWNED.handle`, which is exactly why
//     none of them can see this — the legs below pass no handle at all.
//
//   ITEM 2 (HIGH) — THE ONLY SURFACE THAT ACTUALLY EXECUTES THE VERIFIER STILL
//     SPELLS IT TWO-ARGUMENT. `.claude/skills/smoke-test/SKILL.md` fixture
//     group 14 — rostered on ALL_LEGS in `smoke_fixture_groups.ts` — is the one
//     place in the repo that runs the verifier against a real captured worker
//     stage report, and it calls it with the capture alone. Probed: the shipped
//     genuine fixture with its receipt line DELETED grades `{ok:true,
//     reasons:[]}` on that call. AUDIT 2's parity legs iterate exactly
//     `[DELIVER_SKILL, DELIVER_REFERENCE]`, so this surface is structurally
//     invisible to them — the SAME scoping bug those legs were written to
//     close, one list over. The surface list below is therefore DERIVED from
//     the repository rather than hand-listed, so a fourth surface naming the
//     verifier cannot hide from it again.
//
//   ITEM 3 (HIGH) — THE EMISSION SIDE HAS NO INVOKER, AND THAT IS THIS
//     MILESTONE'S OWN SUBJECT. `renderSpawnReceipt` — carrying AC.4, AC.5 and
//     AC.6 — is referenced by ZERO files outside its own module and this test.
//     No skill, doc, fixture or roster names it or `spawn_receipt.ts`. What
//     `skills/deliver/SKILL.md` tells a worker is to TYPE
//     `- spawn: handle=<handle> ledger=<ledger-path> owned=0` into the fence —
//     i.e. to COMPOSE the values, the exact act AC.2 forbids. So AC.4/.5/.6's
//     halts are unreachable in production. This is the M132 `captureSkipBaseline`
//     shape and it is the defect THIS MILESTONE EXISTS TO CLOSE. The sibling FR
//     STE-513 shipped `deliver_decision.ts` with `import.meta.main` for exactly
//     this reason.
//
//   ITEM 4 (MEDIUM) — THE TEMPLATE TEACHES THE WRONG DEFAULT. The receipt line
//     is rendered in the SKILL's template fence UNCONDITIONALLY and with no `#`
//     annotation, unlike `stage:` and `status:` in that same fence which
//     annotate their alternations. The conditionality lives only in prose
//     elsewhere, so a worker reading the template alone emits a receipt on an
//     inline chain too.
// ===========================================================================

const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/** The one surface that EXECUTES the verifier at runtime (fixture group 14). */
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

/** The roster that puts fixture group 14 on every leg. */
const FIXTURE_GROUPS_MODULE = join(SRC_DIR, "smoke_fixture_groups.ts");

/** The shipped `import.meta.main` idiom, verbatim. STE-411 / STE-513's anchor. */
const MAIN_GUARD = "if (import.meta.main) {";

/** The two shipped modules that already carry it — the idiom's witnesses. */
const IDIOM_WITNESSES = [
  join(SRC_DIR, "active_plan_ship_ready.ts"),
  join(SRC_DIR, "deliver_decision.ts"),
];

// ---------------------------------------------------------------------------
// ITEM 1 — an ABSENT expected handle is itself a refusal.
// ---------------------------------------------------------------------------

/**
 * Grade `line` as the capture's receipt with an expectation carrying NO handle.
 *
 * The whole point of this helper is the field it does NOT set. Every leg in
 * AC.2 and AC.10 passes `handle: SPAWNED.handle`; this one passes the chain
 * alone, which is the call shape the auditor probed and the shape a caller
 * writes when it knows it spawned but has not been handed a resolved handle.
 */
function gradeWithoutExpectation(
  capture: CaptureModule,
  label: string,
  line: string,
): DeliverStageCaptureVerdict {
  return capture.verifyDeliverStageCapture(
    writeCapture(label, { summary: [DEFAULT_SUMMARY_ITEM, line] }),
    null,
    { chain: WORKER_CHAIN },
  );
}

describe("AUDIT 4 ITEM 1 — an absent expected handle is a refusal of its own", () => {
  test("CONTROL: with the expectation supplied, the canonical receipt still grades clean", async () => {
    // Isolation. Without this leg every refusal below could be satisfied by a
    // guard that refuses every worker chain outright, which would be a
    // strengthening that cannot pass rather than one that cannot fail.
    const capture = await loadCapture();
    const verdict = capture.verifyDeliverStageCapture(writeCapture("a4-control"), null, {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("a chain that OWES a receipt and no expected handle is graded not-ok", async () => {
    // The core. The receipt here is the CANONICAL one — same handle the
    // ownership check resolves — and it is refused anyway, because with no
    // expectation supplied NOTHING CORROBORATES IT. The discriminator is the
    // absence of the corroborating side, never the receipt's own value.
    const capture = await loadCapture();
    const verdict = gradeWithoutExpectation(capture, "a4-no-exp", DEFAULT_RECEIPT_LINE);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBe(1);
  });

  test("THE AUDITOR'S PROBE, verbatim: the shipped fixture with a composed handle, chain only", async () => {
    // Re-run against the SHIPPED genuine fixture rather than a synthetic
    // capture, because that is the artifact the probe used and the one a real
    // run travels. `{chain:[{placement:"worker"}]}` — the exact call that
    // returned `{ok:true, reasons:[], graded:"shape-only"}`.
    const capture = await loadCapture();
    const genuine = mustRead(CAPTURE_GENUINE);
    expect(genuine).toContain(`handle=${SPAWNED.handle}`);
    const forged = genuine.replace(SPAWNED.handle, COMPOSED_HANDLE);
    expect(forged).toContain(`handle=${COMPOSED_HANDLE}`);

    const dir = mkdtempSync(join(tmpdir(), "ste516-a4-forged-"));
    const path = join(dir, "worker-stage-report.txt");
    writeFileSync(path, forged, "utf-8");

    const verdict = capture.verifyDeliverStageCapture(path, null, {
      chain: [{ placement: "worker" }],
    });
    expect({ ok: verdict.ok, reasons: verdict.reasons.length > 0 }).toEqual({
      ok: false,
      reasons: true,
    });
  });

  test("the refusal names the handle and never leaks `undefined` at the operator", async () => {
    const capture = await loadCapture();
    const reason = gradeWithoutExpectation(capture, "a4-text", DEFAULT_RECEIPT_LINE)
      .reasons.join("\n");
    expect(reason).toContain("handle");
    // A guard that merely stringified the missing expectation would print the
    // word `undefined` at an operator, which names nothing and remedies less.
    expect(reason.includes("undefined")).toBe(false);
  });

  test("its reason is its OWN — distinct from ABSENT, MALFORMED, UNOWNED and MISMATCHED", async () => {
    // Five operator situations, five remedies. Collapsing this one into the
    // mismatch sentence would tell an operator two handles disagreed when the
    // truth is that the CALLER named none — a remedy pointed at the wrong half.
    const capture = await loadCapture();
    const spawn: StageSpawnExpectation = {
      chain: WORKER_CHAIN,
      handle: SPAWNED.handle,
    };
    const texts: { situation: string; text: string }[] = [
      {
        situation: "no-expectation",
        text: gradeWithoutExpectation(capture, "a4-d-noexp", DEFAULT_RECEIPT_LINE)
          .reasons.join("\n"),
      },
      {
        situation: "absent",
        text: capture
          .verifyDeliverStageCapture(
            writeCapture("a4-d-absent", { summary: [DEFAULT_SUMMARY_ITEM] }),
            null,
            spawn,
          )
          .reasons.join("\n"),
      },
      {
        situation: "malformed",
        text: gradeReceipt(
          capture,
          "a4-d-malformed",
          `  - spawn: ledger=${SPAWNED.ledger} handle=${SPAWNED.handle} owned=0`,
          spawn,
        ).reasons.join("\n"),
      },
      {
        situation: "unowned",
        text: gradeReceipt(capture, "a4-d-unowned", receiptLine({ owned: 3 }), spawn)
          .reasons.join("\n"),
      },
      {
        situation: "mismatched",
        text: gradeReceipt(
          capture,
          "a4-d-mismatch",
          receiptLine({ handle: COMPOSED_HANDLE, owned: 0 }),
          spawn,
        ).reasons.join("\n"),
      },
    ];
    expect(texts.every((entry) => entry.text.trim().length > 0)).toBe(true);
    const seen = texts.map((entry) => entry.text);
    const collisions = texts.filter((entry, i) => seen.indexOf(entry.text) !== i);
    expect({ collisions: collisions.map((entry) => entry.situation) }).toEqual({
      collisions: [],
    });
  });

  test("ORDER: a non-zero `owned` still wins over the missing expectation", async () => {
    // Pinned so the new guard cannot be inserted ahead of the ownership-outcome
    // branch, which would re-answer AUDIT 1's `owned=7` capture with a sentence
    // about the caller. The observed exit code stays the more actionable fact,
    // so it stays the reason.
    const capture = await loadCapture();
    const verdict = gradeWithoutExpectation(capture, "a4-order", receiptLine({ owned: 7 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("7");
  });

  test("ORDER: an ABSENT receipt still wins over the missing expectation", async () => {
    const capture = await loadCapture();
    const verdict = capture.verifyDeliverStageCapture(
      writeCapture("a4-order-absent", { summary: [DEFAULT_SUMMARY_ITEM] }),
      null,
      { chain: WORKER_CHAIN },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("- spawn:");
  });

  test("SCOPE: the inline path is untouched — byte-identical to the shipped call", async () => {
    // AC.7 is not weakened by this guard: a chain that spawned nothing owes
    // nothing, whether or not the caller named a handle.
    const capture = await loadCapture();
    const path = writeCapture("a4-inline");
    const shipped = capture.verifyDeliverStageCapture(path);
    const inline = capture.verifyDeliverStageCapture(path, null, {
      chain: INLINE_CHAIN,
    });
    expect(JSON.stringify(inline)).toBe(JSON.stringify(shipped));
    expect(shipped.ok).toBe(true);
  });

  test("SCOPE: an empty chain with no handle is still graded exactly as today", async () => {
    const capture = await loadCapture();
    const path = writeCapture("a4-empty-chain");
    expect(
      JSON.stringify(capture.verifyDeliverStageCapture(path, null, { chain: [] })),
    ).toBe(JSON.stringify(capture.verifyDeliverStageCapture(path, null, null)));
  });
});

// ---------------------------------------------------------------------------
// ITEM 2 — the surface list is DERIVED, and the executing surface is in it.
// ---------------------------------------------------------------------------

/**
 * Every operative markdown surface in the repository.
 *
 * DERIVED, never hand-listed, and that is the whole point of this item: AUDIT
 * 2's legs iterate a literal `[DELIVER_SKILL, DELIVER_REFERENCE]`, so the one
 * surface that actually EXECUTES the verifier was invisible to the guard
 * written to close exactly this class. A walker cannot omit a surface it does
 * not know about.
 *
 * `tests/` and `specs/` are excluded on purpose and for different reasons:
 * a test file is not a surface an operator or worker reads, and `specs/`
 * (including archived FRs) records what was decided rather than instructing
 * anyone. Everything else — plugin skills, plugin docs, and the repo-root
 * `.claude/skills/` tree that `pluginRoot`-scoped sweeps have historically
 * missed — is in scope.
 */
function operativeMarkdownSurfaces(root: string): string[] {
  const skip = new Set(["node_modules", ".git", "tests", "specs", "dist", ".dpt"]);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Surfaces that MENTION `token` at all — the population the guard must cover. */
function surfacesMentioning(token: string): string[] {
  return operativeMarkdownSurfaces(REPO_ROOT).filter((file) =>
    mustRead(file).includes(token),
  );
}

/** The two-field verdict every surface must satisfy. Reused by the mutations. */
function surfaceVerdict(text: string): Record<string, boolean> {
  const calls = verifierCalls(text);
  return {
    namesTheCall: calls.length > 0,
    everySpellingPassesSpawn: calls.length > 0 && calls.every(passesSpawn),
  };
}

const SURFACE_PASSES = { namesTheCall: true, everySpellingPassesSpawn: true };

describe("AUDIT 4 ITEM 2 — the executing surface passes the spawn expectation", () => {
  test("the derivation is not vacuous: it finds the three surfaces already known", async () => {
    // If this fails, the walker is broken and every leg below is a false
    // green. The two AUDIT 2 hand-listed it, the third is the one it missed.
    const found = surfacesMentioning("verifyDeliverStageCapture");
    for (const surface of [DELIVER_SKILL, DELIVER_REFERENCE, SMOKE_SKILL]) {
      expect({ surface, derived: found.includes(surface) }).toEqual({
        surface,
        derived: true,
      });
    }
  });

  test("the hand-listed pair was an INCOMPLETE subset — that is the bug", async () => {
    const found = surfacesMentioning("verifyDeliverStageCapture");
    const handListed = [DELIVER_SKILL, DELIVER_REFERENCE];
    const missedByTheHandList = found.filter((file) => !handListed.includes(file));
    expect(missedByTheHandList).toContain(SMOKE_SKILL);
  });

  test("the smoke surface is the one that EXECUTES the verifier, and is rostered on every leg", () => {
    // Named explicitly so the failure below is legible: this is not one more
    // document that mentions a function, it is fixture group 14's assertion,
    // registered on ALL_LEGS.
    const roster = mustRead(FIXTURE_GROUPS_MODULE);
    expect(roster).toContain("group: 14");
    expect(roster).toContain("verifyDeliverStageCapture");
    expect(mustRead(SMOKE_SKILL)).toContain("Fixture group 14");
  });

  test("the smoke surface spells a call, and it passes the spawn expectation", async () => {
    expect({ surface: SMOKE_SKILL, ...surfaceVerdict(mustRead(SMOKE_SKILL)) }).toEqual({
      surface: SMOKE_SKILL,
      ...SURFACE_PASSES,
    });
  });

  test("EVERY derived surface names a call, and EVERY spelling passes the spawn expectation", async () => {
    const offenders = surfacesMentioning("verifyDeliverStageCapture")
      .map((surface) => ({ surface, ...surfaceVerdict(mustRead(surface)) }))
      .filter(
        (row) => !(row.namesTheCall && row.everySpellingPassesSpawn),
      );
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test("MUTATION — reverting the smoke surface alone reddens", async () => {
    // In-process, so it needs no file edit: the shipped text is downgraded to
    // the two-argument spelling and the SAME predicate that passes above must
    // refuse it. Without this, a predicate that could not tell the spellings
    // apart would pass the block forever — the defect being closed.
    const shipped = mustRead(SMOKE_SKILL);
    const reverted = shipped.replace(
      /verifyDeliverStageCapture\(([^,)]*),([^,)]*),[^)]*\)/g,
      "verifyDeliverStageCapture($1,$2)",
    );
    expect(reverted).not.toBe(shipped);
    expect(surfaceVerdict(reverted)).not.toEqual(SURFACE_PASSES);
  });

  test("MUTATION — the surface is dropped entirely, and the walker still catches it", async () => {
    // The other half: a surface that mentions the verifier and spells NO call
    // at all — the state the smoke SKILL shipped in — is refused, not excused.
    const noCall = mustRead(SMOKE_SKILL).replace(
      /verifyDeliverStageCapture\([^)]*\)/g,
      "verifyDeliverStageCapture",
    );
    expect(surfaceVerdict(noCall)).toEqual({
      namesTheCall: false,
      everySpellingPassesSpawn: false,
    });
  });

  test("MUTATION — the WALKER itself is falsifiable: a synthetic fourth surface cannot hide", async () => {
    // The derivation, not the surfaces. A fourth document dropped anywhere in
    // the tree must be FOUND and JUDGED. Proven on a synthetic tree so it does
    // not depend on the repository ever growing one.
    const root = mkdtempSync(join(tmpdir(), "ste516-a4-walk-"));
    const nested = join(root, ".claude", "skills", "some-skill");
    writeFileSync(join(root, "unrelated.md"), "no mention here\n", "utf-8");
    mkdirSync(nested, { recursive: true });
    const stale = join(nested, "SKILL.md");
    writeFileSync(
      stale,
      "Call `verifyDeliverStageCapture(capturePath, evidence)` on the capture.\n",
      "utf-8",
    );

    const found = operativeMarkdownSurfaces(root).filter((file) =>
      readFileSync(file, "utf-8").includes("verifyDeliverStageCapture"),
    );
    expect(found).toEqual([stale]);
    expect(surfaceVerdict(readFileSync(stale, "utf-8"))).toEqual({
      namesTheCall: true,
      everySpellingPassesSpawn: false,
    });

    // ... and the three-argument spelling is accepted, so the walker is not
    // simply refusing everything it finds.
    writeFileSync(
      stale,
      "Call `verifyDeliverStageCapture(capturePath, evidence, spawn)` on the capture.\n",
      "utf-8",
    );
    expect(surfaceVerdict(readFileSync(stale, "utf-8"))).toEqual(SURFACE_PASSES);
  });
});

// ---------------------------------------------------------------------------
// ITEM 3 — the emission side gets a RUNNABLE invoker.
//
// THE CLI CONTRACT THESE LEGS PIN, stated once so the implementer does not
// guess (the same discipline this file's header applies to the receipt line):
//
//     bun run adapters/_shared/src/spawn_receipt.ts \
//         <handle> <ledger> <name> <host> [owned-check-command]
//
//   * `<handle> <ledger> <name> <host>` are what the SPAWNING TOOL reported.
//     `<host>` is the empty string when the tool reported no terminal host —
//     which is how AC.6's `no-terminal-host` halt is reachable from argv alone,
//     without a live install.
//   * `[owned-check-command]` is the ownership check, invoked as
//     `<owned-check-command> <ledger> <name>`. Its EXIT CODE is the `owned`
//     code; the first line of its stdout is the handle it RESOLVED. Omitted, it
//     defaults to the spawning tool's own check — which is why the legs below
//     supply a fake rather than assuming an agent-toolkit install.
//   * A clean resolve prints the ONE receipt line on stdout and exits 0.
//   * EVERY other outcome prints the module's NFR-10 envelope on STDERR, exits
//     non-zero, and prints NOTHING on stdout. The record channel stays empty on
//     a refusal — the `deliver_decision.ts` idiom, so a caller reading stdout
//     gets a whole receipt or nothing, never a partial.
//
// A command whose only outcome were a refusal would be a strengthening that
// cannot pass, so the fake ownership check gives the clean-resolve path a real
// green leg — and the same fake, answering a DIFFERENT handle, proves that
// green is not unconditional.
// ---------------------------------------------------------------------------

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: readonly string[]): CliResult {
  const proc = Bun.spawnSync(["bun", "run", RECEIPT_MODULE, ...args], {
    cwd: PLUGIN_ROOT,
    // Deliberately non-tty: a printer that refuses here is a printer no test,
    // driver or headless capture could ever run.
    stdin: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    code: proc.exitCode ?? -1,
  };
}

/**
 * A fake ownership check: records the argv it was asked, prints `handle`, exits
 * `code`. Values are BAKED INTO the script text rather than passed through the
 * environment, so the leg does not silently depend on the CLI forwarding env.
 */
function fakeOwnedCheck(options: {
  label: string;
  code: number;
  handle?: string;
}): { command: string; recordPath: string } {
  const dir = mkdtempSync(join(tmpdir(), `ste516-owned-${options.label}-`));
  const command = join(dir, "owned-check");
  const recordPath = join(dir, "asked.txt");
  writeFileSync(
    command,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n%s\\n' "$1" "$2" > ${JSON.stringify(recordPath)}`,
      ...(options.handle === undefined
        ? []
        : [`printf '%s\\n' ${JSON.stringify(options.handle)}`]),
      `exit ${options.code}`,
      "",
    ].join("\n"),
    "utf-8",
  );
  chmodSync(command, 0o755);
  return { command, recordPath };
}

/** The four reported positionals, in the contract's order. */
const CLI_REPORTED = [SPAWNED.handle, SPAWNED.ledger, SPAWNED.name, SPAWNED.host!];

/**
 * The FAIL-CLOSED invariant, asserted on every invocation: stdout carries a
 * parseable receipt IF AND ONLY IF the command exited 0. A CLI that printed the
 * composed line and then refused would satisfy neither half.
 */
async function assertFailClosed(result: CliResult, label: string): Promise<void> {
  const mod = await loadReceipt();
  const parsed = mod.parseSpawnReceipt(result.stdout.split("\n"));
  expect({ label, receiptOnStdout: parsed !== null }).toEqual({
    label,
    receiptOnStdout: result.code === 0,
  });
}

describe("AUDIT 4 ITEM 3 — the emission guard is runnable, not narrated", () => {
  test("the idiom this item points at is still the shipped one", () => {
    // If this fails the reference modules changed shape — fix the reference,
    // never weaken the pin below.
    for (const witness of IDIOM_WITNESSES) {
      expect({ witness, carries: mustRead(witness).includes(MAIN_GUARD) }).toEqual({
        witness,
        carries: true,
      });
    }
  });

  test("`spawn_receipt.ts` carries the same command-line guard", () => {
    expect(mustRead(RECEIPT_MODULE)).toContain(MAIN_GUARD);
  });

  test("import stays SIDE-EFFECT FREE — a module that ran on import is not a CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste516-a4-import-"));
    const importer = join(dir, "importer.ts");
    writeFileSync(
      importer,
      `import ${JSON.stringify(RECEIPT_MODULE)};\nconsole.log("IMPORT_MARKER");\n`,
      "utf-8",
    );
    const proc = Bun.spawnSync(["bun", "run", importer], {
      cwd: PLUGIN_ROOT,
      stdin: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toBe("IMPORT_MARKER\n");
  });

  test("THE COMMAND RUNS, and it runs the EMISSION GUARD: an empty host halts by name", async () => {
    // AC.6's halt is reachable from argv alone — the host check runs first and
    // never consults the ownership runner — which is what makes this leg proof
    // that the CLI drives `renderSpawnReceipt` rather than printing prose of
    // its own. The halt NAME is read from the module's exported list.
    const mod = await loadReceipt();
    expect(mod.SPAWN_RECEIPT_HALTS).toContain("no-terminal-host");
    const result = runCli([SPAWNED.handle, SPAWNED.ledger, SPAWNED.name, ""]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Refusing: ");
    expect(result.stderr).toContain("Remedy: ");
    expect(result.stderr).toContain("Context: reason=no-terminal-host");
    expect(result.stdout).toBe("");
    await assertFailClosed(result, "no-terminal-host");
  });

  test("A CLEAN RESOLVE PRINTS THE RECEIPT — the command has a green path", async () => {
    const mod = await loadReceipt();
    const fake = fakeOwnedCheck({ label: "ok", code: 0, handle: SPAWNED.handle });
    const result = runCli([...CLI_REPORTED, fake.command]);
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: "",
    });
    // Compared against what the MODULE renders, never against a retyped line.
    expect(result.stdout.replace(/\n$/, "")).toBe(render(mod, {}, resolvesOk()).line);
    expect(mod.parseSpawnReceipt(result.stdout.split("\n"))).toEqual({
      handle: SPAWNED.handle,
      ledger: SPAWNED.ledger,
      owned: 0,
    });
  });

  test("the ownership check is asked the REPORTED bytes — no ledger path is derived", async () => {
    const fake = fakeOwnedCheck({ label: "asked", code: 0, handle: SPAWNED.handle });
    const result = runCli([...CLI_REPORTED, fake.command]);
    expect(result.code).toBe(0);
    expect(readFileSync(fake.recordPath, "utf-8")).toBe(
      `${SPAWNED.ledger}\n${SPAWNED.name}\n`,
    );
  });

  test("a check that resolves a DIFFERENT handle refuses — the green above is not unconditional", async () => {
    const fake = fakeOwnedCheck({ label: "composed", code: 0, handle: COMPOSED_HANDLE });
    const result = runCli([...CLI_REPORTED, fake.command]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Context: reason=handle-composed");
    expect(result.stdout).toBe("");
    await assertFailClosed(result, "handle-composed");
  });

  test("exit 0 that resolves NO handle refuses — exit zero permits emission, never guarantees it", async () => {
    const fake = fakeOwnedCheck({ label: "nohandle", code: 0 });
    const result = runCli([...CLI_REPORTED, fake.command]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Context: reason=handle-unresolved");
    await assertFailClosed(result, "handle-unresolved");
  });

  test.each([2, 5, 3, 4, 42])(
    "ownership exit %i never reaches emission, and never prints a partial record",
    async (code) => {
      const fake = fakeOwnedCheck({
        label: `code${code}`,
        code,
        handle: SPAWNED.handle,
      });
      const result = runCli([...CLI_REPORTED, fake.command]);
      expect({ code, exited: result.code === 0 }).toEqual({ code, exited: false });
      expect({ code, stdout: result.stdout }).toEqual({ code, stdout: "" });
      expect(result.stderr).toContain("Refusing: ");
      expect(result.stderr).toContain("Context: reason=");
      await assertFailClosed(result, `owned-${code}`);
    },
  );

  test("the per-code refusals stay DISTINCT through the command boundary", async () => {
    // A CLI that collapsed every halt into one printed sentence would erase the
    // remedies AC.5 exists to preserve, and the module's own distinctness legs
    // could not see it — they never cross the process boundary.
    const texts = await Promise.all(
      [2, 5, 3, 4, 42].map((code) => {
        const fake = fakeOwnedCheck({
          label: `d${code}`,
          code,
          handle: SPAWNED.handle,
        });
        return { code, text: runCli([...CLI_REPORTED, fake.command]).stderr };
      }),
    );
    expect(texts.every((entry) => entry.text.trim().length > 0)).toBe(true);
    const seen = texts.map((entry) => entry.text);
    const collisions = texts.filter((entry, i) => seen.indexOf(entry.text) !== i);
    expect({ collisions: collisions.map((entry) => entry.code) }).toEqual({
      collisions: [],
    });
  });

  test("incomplete argv refuses in the envelope and prints no partial record", async () => {
    const result = runCli([SPAWNED.handle]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Refusing: ");
    expect(result.stderr).toContain("Remedy: ");
    await assertFailClosed(result, "incomplete-argv");
  });

  test("THE OPERATIVE SURFACE ORDERS THE COMMAND — it does not tell a worker to type the line", async () => {
    // The whole item: a guard nothing invokes is a guard that never fires.
    // `${CLAUDE_PLUGIN_ROOT}/` is required by the shipped path-portability
    // gate — the model's cwd is the consumer project, never the plugin root.
    const order = "bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/spawn_receipt.ts";
    expect(mustRead(DELIVER_SKILL)).toContain(order);
  });

  test("the module is no longer INVOKER-LESS: a shipped surface names it", async () => {
    // Derived, same walker as ITEM 2 — the defect was that `spawn_receipt.ts`
    // appeared in ZERO files outside its own module and this test.
    const naming = surfacesMentioning("spawn_receipt.ts");
    expect({ surfaces: naming.length > 0 }).toEqual({ surfaces: true });
    expect(naming).toContain(DELIVER_SKILL);
  });

  test("MUTATION — the walker is falsifiable on this token too", async () => {
    // Same shape as ITEM 2's walker mutation, on the token this leg reads: a
    // tree with no mention yields nothing, so the leg above is not passing on
    // a walker that returns everything it sees.
    const root = mkdtempSync(join(tmpdir(), "ste516-a4-inv-"));
    writeFileSync(join(root, "quiet.md"), "nothing about the module here\n", "utf-8");
    const found = operativeMarkdownSurfaces(root).filter((file) =>
      readFileSync(file, "utf-8").includes("spawn_receipt.ts"),
    );
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ITEM 4 — the template annotates the receipt as CONDITIONAL.
// ---------------------------------------------------------------------------

/** The lines inside `skills/deliver/SKILL.md`'s own template fence. */
function templateFenceLines(): string[] {
  const lines = mustRead(DELIVER_SKILL).replace(/\r\n/g, "\n").split("\n");
  const open = lines.findIndex((line) => line.trim() === "```deliver-stage-result");
  expect(open).toBeGreaterThanOrEqual(0);
  const close = lines.findIndex((line, i) => i > open && line.trim() === "```");
  expect(close).toBeGreaterThan(open);
  return lines.slice(open + 1, close);
}

/** The `#` annotation on a template line, or `null` when it carries none. */
function annotationOf(line: string): string | null {
  const at = line.indexOf("#");
  if (at < 0) return null;
  const text = line.slice(at + 1).trim();
  return text.length > 0 ? text : null;
}

/** The one template line that renders the receipt. */
function templateReceiptLine(): string {
  const found = templateFenceLines().filter((line) =>
    line.trimStart().startsWith(SPAWN_RECEIPT_PREFIX_LITERAL),
  );
  expect({ receiptLinesInTemplate: found.length }).toEqual({
    receiptLinesInTemplate: 1,
  });
  return found[0]!;
}

/**
 * The prefix, spelled once here because `templateReceiptLine` is called from
 * synchronous helpers. Asserted equal to the module's export below, so it
 * cannot drift into a second source of truth.
 */
const SPAWN_RECEIPT_PREFIX_LITERAL = "- spawn:";

describe("AUDIT 4 ITEM 4 — the template marks the receipt conditional", () => {
  test("the local prefix spelling is the module's, not a second literal", async () => {
    const mod = await loadReceipt();
    expect(SPAWN_RECEIPT_PREFIX_LITERAL).toBe(mod.SPAWN_RECEIPT_PREFIX);
  });

  test("CONTROL: the sibling scalars in the same fence DO annotate their alternations", () => {
    // The style exists and the extractor reads it. Without this, the pin below
    // could be satisfied by a repo that annotates nothing and a helper that
    // finds nothing — a green with no subject.
    const fence = templateFenceLines();
    for (const key of ["stage:", "status:"]) {
      const line = fence.find((candidate) => candidate.startsWith(key));
      expect({ key, present: line !== undefined }).toEqual({ key, present: true });
      expect({ key, annotated: annotationOf(line!) !== null }).toEqual({
        key,
        annotated: true,
      });
    }
  });

  test("the receipt line carries an annotation, in its siblings' style", () => {
    expect({ annotated: annotationOf(templateReceiptLine()) !== null }).toEqual({
      annotated: true,
    });
  });

  test("the annotation states the CONDITION — worker placement — not merely that it exists", () => {
    // A `#` that said "required" would teach the same wrong default the bare
    // line does. What a worker must read off the template alone is WHEN the
    // line applies.
    const annotation = annotationOf(templateReceiptLine()) ?? "";
    expect({ namesTheCondition: /worker/i.test(annotation), annotation }).toEqual({
      namesTheCondition: true,
      annotation,
    });
  });

  test("the extractor DISCRIMINATES — it is not answering true for every line", () => {
    const bare = `  ${SPAWN_RECEIPT_PREFIX_LITERAL} handle=<handle> ledger=<ledger-path> owned=0`;
    expect(annotationOf(bare)).toBeNull();

    const vague = `${bare}     # required`;
    expect(annotationOf(vague)).toBe("required");
    expect(/worker/i.test(annotationOf(vague)!)).toBe(false);

    const good = `${bare}     # only when the chain carried a (worker)-placement step`;
    expect(/worker/i.test(annotationOf(good)!)).toBe(true);
  });

  test("the prose statement of the condition is still there — the annotation ADDS, never replaces", () => {
    // The conditionality already lives in prose; this item is that the
    // TEMPLATE stops contradicting it. Pinned so the fix is not applied by
    // deleting the prose half.
    const skill = mustRead(DELIVER_SKILL);
    expect(skill).toContain("Spawn receipt");
    expect(/when the chain[^.]*worker/i.test(skill)).toBe(true);
  });
});

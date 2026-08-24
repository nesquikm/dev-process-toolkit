// M132 / STE-510 — "A stage cannot report ok without machine-read evidence".
//
// THE DEFECT THIS SUITE EXISTS TO KILL, stated before anything else, because
// every shaping decision below follows from it.
//
// The `deliver-stage-result` fence describes a `gate:` section carrying pass and
// skip counts, and NOTHING checks that the numbers in it came from anywhere. A
// worker that composes the fence from memory emits a block with the right
// sections, in the right order, under the line cap, carrying entirely plausible
// numbers — and it is evidentially worthless. The wrong implementation is
// INVISIBLE in a green run. That is AC.3, and the FR names it the highest-risk
// criterion in the milestone.
//
// M129's own record is the warning label: all EIGHTEEN shipped ACs of STE-464,
// the FR that introduced this fence, were greps of `/deliver`'s own SKILL.md
// prose — "which is precisely why a fence with no producer passed every one of
// them". A test that greps skill prose for the words `drive:` and `e2e:`
// satisfies the letter of AC.1 and proves nothing.
//
// SO: THE SUBJECT OF EVERY ASSERTION BELOW IS A CAPTURE ARTIFACT, NOT A
// DOCUMENT — with exactly one deliberate exception, the surface-drift guard at
// the bottom, which is legitimately about documents because its whole job is to
// catch a rule that landed on one surface and not its sibling (M131 recorded
// that failure THREE times in a single milestone). That guard does not, and is
// not allowed to, substitute for the capture-subject legs.
//
// LEG-BY-LEG RATIONALE
//
//   AC.1  Section ORDER, not presence. `DELIVER_STAGE_SECTIONS` is asserted
//         equal to the eight-name literal restated here (never derived from the
//         SUT, which would compare the source against itself), a real capture
//         carrying the new sections in canonical order is ACCEPTED, and two
//         wrong-POSITION captures — `drive`/`e2e` before `gate`, and after
//         `follow_ups` — are each REJECTED. A presence-only assertion passes on
//         both of those.
//
//   AC.2  `gate:` carries pass, fail AND skip plus the baseline delta. The skip
//         count is the one a silent-skip run omits, so a `gate:` line carrying
//         only pass and fail is asserted REJECTED. The delta is wired to the
//         SHIPPED STE-509 baseline (`evaluateSkipDelta`) and asserted against a
//         baseline this test really captures on disk, not against a literal.
//
//   AC.3  THE ROUND TRIP. Captured command output goes through the renderer to
//         fence lines, the numbers are read back OUT of those lines, and they
//         are asserted equal to counts this test derives INDEPENDENTLY from the
//         same capture via the shipped `parseTestOutput`. Plus a SENSITIVITY
//         leg: change the captured bytes, and every rendered number must move
//         with them. A worker-authored constant survives the first leg (if the
//         fixture merely restates it) and cannot survive the second.
//
//   AC.4  A counts disagreement is graded through the SAME channel as a shape
//         violation — one `{ ok:false, reasons }` verdict, no throw, no second
//         failure mode — so it inherits the shipped bounded-retry-then-halt
//         path instead of forking a new one.
//
//   AC.5  BOTH refusal grounds, separately, at both layers. Ground 1: a
//         required count ABSENT (no capture for a required section; no baseline
//         so no delta; a fence line omitting a count). Ground 2: a count
//         INDICATING FAILURE (failures in the capture; a positive skip delta; a
//         fence carrying `fail 3` beside `status: ok`). Different defects,
//         different causes, different tests.
//
//   AC.6  The cap is RAISED and still BINDS. A cap raised to infinity passes a
//         presence-only test, so: a realistic full fence FITS, a fence one line
//         over the cap is REJECTED, and the evidence stays INSIDE the fence —
//         asserted by the renderer writing no file at all, because a companion
//         artifact is the split-source-of-truth shape M129 recorded three times.
//
//   AC.7  TWO REAL EXECUTED MUTATIONS, each with a CONTROL. (a) a
//         worker-AUTHORED count that disagrees with the capture, (b) a fence
//         rendered with NO capture present. Isolation is half the test: each
//         mutation is asserted RED *and* the unmutated form asserted GREEN
//         through the same harness, which is what separates "the mutation
//         killed it" from "the harness always fails".
//
// CONTRACT NOTES FOR THE IMPLEMENTER — the shape these tests are written to.
//
//   NEW MODULE `adapters/_shared/src/deliver_stage_evidence.ts`:
//
//     export const EVIDENCE_SECTIONS = ["gate", "drive", "e2e"] as const;
//     export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];
//
//     export interface CapturedRun {
//       readonly command: string;   // what ran
//       readonly output: string;    // the bytes it emitted — the CAPTURE
//       readonly stack: Stack;      // from ./test_count_parser
//     }
//
//     export interface EvidenceCounts {
//       readonly pass: number;
//       readonly fail: number;      // failures + errors, folded
//       readonly skip: number;
//       readonly baseline: number | null;  // gate only; null elsewhere
//       readonly delta: number | null;     // gate only; null elsewhere
//     }
//
//     export interface StageEvidenceInput {
//       readonly gate?: CapturedRun | null;
//       readonly drive?: CapturedRun | null;
//       readonly e2e?: CapturedRun | null;
//       // Sections this stage must evidence. OMITTED MEANS ALL THREE — the
//       // fail-closed default. A reduced chain passes `[]` (or a subset).
//       readonly required?: readonly EvidenceSection[];
//       // STE-509 baseline lookup. Both present ⇒ the gate delta is measured.
//       readonly projectRoot?: string;
//       readonly branch?: string;
//     }
//
//     export interface RenderedStageEvidence {
//       readonly ok: boolean;                 // DERIVED, never asserted
//       readonly lines: readonly string[];    // gate: / drive: / e2e: blocks
//       readonly counts: Readonly<Record<EvidenceSection, EvidenceCounts | null>>;
//       readonly reasons: readonly string[];  // empty iff ok
//     }
//
//     export function renderStageEvidence(input: StageEvidenceInput): RenderedStageEvidence;
//     export function parseEvidenceLines(
//       fenceLines: readonly string[],
//     ): Readonly<Record<EvidenceSection, EvidenceCounts | null>>;
//
//   RENDERED LINE SHAPE (machine-readable both ways — the renderer writes it,
//   `parseEvidenceLines` and the cross-check read it back):
//
//     gate:
//       - pass 8123, fail 0, skip 16, baseline 16, delta 0
//     drive:
//       - pass 12, fail 0, skip 0
//     e2e:
//       - (none found)
//
//   A section with no capture keeps its heading and carries `- (none found)`;
//   sections are never dropped. An UNMEASURED baseline renders
//   `baseline unmeasured` and yields `baseline: null, delta: null`.
//
//   `renderStageEvidence` is `ok: true` only when every REQUIRED section has a
//   capture with derivable counts, the gate delta is MEASURED, and no count
//   indicates failure (`fail > 0` anywhere, or a `fail` skip-delta verdict).
//
//   COUNT DERIVATION is stack-correct, because the runners disagree about what
//   `total` includes: bun's `Ran N tests` COUNTS skipped tests, pytest's
//   `N passed` does not. So `pass` is `total - failures - errors - skipped` on
//   bun and `total - failures - errors` on pytest. This suite pins both, so a
//   single-stack formula that silently mis-derives on the other dies here.
//
//   `deliver_stage_capture.ts` CHANGES:
//     * `DELIVER_STAGE_SECTIONS` becomes the EIGHT names, `drive` and `e2e`
//       inserted after `gate`.
//     * `FENCE_LINE_CAP` is EXPORTED and RAISED above 20.
//     * `verifyDeliverStageCapture(capturePath, evidence?)` takes an optional
//       second argument. Without it: shape checks plus the fence-only AC.5
//       refusals. With it: the fence's counts are cross-checked against counts
//       re-derived from the captures, and any disagreement is a violation.

import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findFences } from "../adapters/_shared/src/markdown_fences";
import { captureSkipBaseline } from "../adapters/_shared/src/skip_baseline";
import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";

const PLUGIN_ROOT = join(import.meta.dir, "..");

const EVIDENCE_MODULE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "deliver_stage_evidence.ts",
);
const CAPTURE_MODULE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "deliver_stage_capture.ts",
);

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "deliver-stage-capture");
const CAPTURE_GENUINE = join(FIXTURE_DIR, "worker-stage-report.txt");
const CAPTURE_NO_FENCE = join(FIXTURE_DIR, "worker-stage-report-no-fence.txt");
const CAPTURE_REORDERED = join(FIXTURE_DIR, "worker-stage-report-reordered.txt");

// The EIGHT sections, in THE canonical order, restated byte-for-byte. NOT
// imported from the module under test: deriving the expectation from the SUT
// compares the source against itself and could never catch a rename that
// stranded the SKILL's and the reference's copies.
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

/** The three evidence sections, in their fixed order. */
const EVIDENCE_ORDER = ["gate", "drive", "e2e"] as const;

// ---------------------------------------------------------------------------
// Module loading. Dynamic + per-test on purpose: a static `import` of a
// not-yet-written module (or a not-yet-added named export) fails the WHOLE file
// at resolution time, collapsing seven ACs into one opaque red. Loading per
// test keeps each AC's RED attributable to its own criterion.
// ---------------------------------------------------------------------------

type EvidenceSection = (typeof EVIDENCE_ORDER)[number];

interface EvidenceCounts {
  pass: number;
  fail: number;
  skip: number;
  baseline: number | null;
  delta: number | null;
}

interface RenderedStageEvidence {
  ok: boolean;
  lines: readonly string[];
  counts: Record<EvidenceSection, EvidenceCounts | null>;
  reasons: readonly string[];
}

interface CapturedRun {
  command: string;
  output: string;
  stack: "bun" | "pytest" | "flutter" | "unknown";
}

interface StageEvidenceInput {
  gate?: CapturedRun | null;
  drive?: CapturedRun | null;
  e2e?: CapturedRun | null;
  required?: readonly EvidenceSection[];
  projectRoot?: string;
  branch?: string;
}

interface EvidenceModule {
  EVIDENCE_SECTIONS: readonly EvidenceSection[];
  renderStageEvidence(input: StageEvidenceInput): RenderedStageEvidence;
  parseEvidenceLines(
    lines: readonly string[],
  ): Record<EvidenceSection, EvidenceCounts | null>;
}

interface CaptureVerdict {
  ok: boolean;
  reasons: readonly string[];
}

interface CaptureModule {
  DELIVER_STAGE_SECTIONS: readonly string[];
  DELIVER_STAGE_FENCE_BANNER: string;
  FENCE_LINE_CAP: number;
  verifyDeliverStageCapture(
    capturePath: string,
    evidence?: StageEvidenceInput | null,
  ): CaptureVerdict;
}

async function loadEvidence(): Promise<EvidenceModule> {
  return (await import(EVIDENCE_MODULE)) as unknown as EvidenceModule;
}

async function loadCapture(): Promise<CaptureModule> {
  return (await import(CAPTURE_MODULE)) as unknown as CaptureModule;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// CAPTURES. These are the bytes a runner really emits — the SUBJECT of nearly
// every leg in this file. Each one is written to a real file on disk before it
// is used, so what the renderer reads is an artifact, not a string literal
// smuggled in through an argument.
// ---------------------------------------------------------------------------

/** A clean bun gate run: 8123 pass, 16 skip, 0 fail, out of 8139 total. */
const GATE_OUTPUT_CLEAN = [
  "bun test v1.1.29",
  "",
  "tests/a.test.ts:",
  "  120 pass",
  "  2 skip",
  "  0 fail",
  "",
  " 8123 pass",
  " 16 skip",
  " 0 fail",
  " 24519 expect() calls",
  "Ran 8139 tests across 214 files. [41.02s]",
].join("\n");

/** The same gate run with three real failures — AC.5 ground 2. */
const GATE_OUTPUT_FAILING = [
  "bun test v1.1.29",
  "",
  " 8100 pass",
  " 16 skip",
  " 3 fail",
  "Ran 8119 tests across 214 files. [40.11s]",
].join("\n");

/** The same gate run with FOUR MORE skips — a positive baseline delta. */
const GATE_OUTPUT_MORE_SKIPS = [
  "bun test v1.1.29",
  "",
  " 8119 pass",
  " 20 skip",
  " 0 fail",
  "Ran 8139 tests across 214 files. [41.44s]",
].join("\n");

/** A DIFFERENT clean gate run — the sensitivity leg's second capture. */
const GATE_OUTPUT_SHIFTED = [
  "bun test v1.1.29",
  "",
  " 7001 pass",
  " 9 skip",
  " 0 fail",
  "Ran 7010 tests across 190 files. [33.71s]",
].join("\n");

const DRIVE_OUTPUT = [
  "bun test v1.1.29",
  "",
  " 12 pass",
  " 0 skip",
  " 0 fail",
  "Ran 12 tests across 3 files. [1.20s]",
].join("\n");

const E2E_OUTPUT = [
  "bun test v1.1.29",
  "",
  " 3 pass",
  " 0 skip",
  " 0 fail",
  "Ran 3 tests across 1 files. [4.90s]",
].join("\n");

/** A pytest gate run — `N passed` EXCLUDES skips, unlike bun's `Ran N tests`. */
const PYTEST_OUTPUT = [
  "============================= test session starts =============================",
  "collected 20 items",
  "",
  "======================== 17 passed, 3 skipped in 2.41s ========================",
].join("\n");

const TEMP_ROOTS: string[] = [];

afterAll(() => {
  for (const dir of TEMP_ROOTS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste510-${label}-`));
  TEMP_ROOTS.push(dir);
  return dir;
}

/**
 * Write captured output to a real file and read it BACK before handing it to
 * the renderer. Round-tripping through disk is the point: "no count is authored
 * by the reporting worker" means the numbers trace to bytes something emitted,
 * and an in-memory literal never leaves the test's own hands.
 */
function capturedRun(
  label: string,
  command: string,
  output: string,
  stack: CapturedRun["stack"] = "bun",
): CapturedRun {
  const file = join(tempDir(`capture-${label}`), `${label}.txt`);
  writeFileSync(file, output, "utf-8");
  return { command, output: read(file), stack };
}

/**
 * Counts derived from a capture INDEPENDENTLY of the module under test, via the
 * shipped parser. The round-trip legs compare the renderer's numbers against
 * these — not against a fixture that merely restates them.
 */
function independentCounts(
  output: string,
  stack: CapturedRun["stack"],
): { pass: number; fail: number; skip: number } {
  const parsed = parseTestOutput(output, stack);
  if (!parsed.ok) throw new Error(`fixture capture is unparseable: ${parsed.reason}`);
  const { total, failures, errors, skipped } = parsed.count;
  const fail = failures + errors;
  // bun's `Ran N tests` counts skipped tests; pytest's `N passed` does not.
  const pass = stack === "bun" ? total - fail - skipped : total - fail;
  return { pass, fail, skip: skipped };
}

// ---------------------------------------------------------------------------
// Fence + capture builders.
// ---------------------------------------------------------------------------

const PROSE = [
  "/implement M132 — worker stage report",
  "",
  "Chain stage 1 of 3 (implement → ship-milestone → pr), milestone M132, effort",
  "ultracode. Spawned as a fresh visible worker by /deliver.",
  "",
  "Landed the M132 FR set; the operator approved the commit at the Phase 4 gate.",
  "",
].join("\n");

/** Wrap fence body lines in report prose + the banner. Returns whole capture. */
function report(bodyLines: readonly string[]): string {
  return [PROSE, "```deliver-stage-result", ...bodyLines, "```", ""].join("\n");
}

interface FenceOptions {
  status?: string;
  summary?: readonly string[];
  gate?: readonly string[];
  drive?: readonly string[];
  e2e?: readonly string[];
  followUps?: readonly string[];
  /** Override the whole section order — used by the wrong-POSITION legs. */
  order?: readonly string[];
}

const DEFAULT_GATE_LINE = "  - pass 8123, fail 0, skip 16, baseline 16, delta 0";
const DEFAULT_DRIVE_LINE = "  - pass 12, fail 0, skip 0";
const DEFAULT_E2E_LINE = "  - pass 3, fail 0, skip 0";

/** A canonical eight-section fence body, with any section overridable. */
function fenceBody(options: FenceOptions = {}): string[] {
  const blocks: Record<string, string[]> = {
    stage: ["stage: implement"],
    milestone: ["milestone: M132"],
    status: [`status: ${options.status ?? "ok"}`],
    summary: [
      "summary:",
      ...(options.summary ?? ["  - STE-510 lands machine-read fence evidence"]),
    ],
    gate: ["gate:", ...(options.gate ?? [DEFAULT_GATE_LINE])],
    drive: ["drive:", ...(options.drive ?? [DEFAULT_DRIVE_LINE])],
    e2e: ["e2e:", ...(options.e2e ?? [DEFAULT_E2E_LINE])],
    follow_ups: ["follow_ups:", ...(options.followUps ?? ["  - (none found)"])],
  };
  const order = options.order ?? STAGE_SECTIONS;
  return order.flatMap((name) => blocks[name] ?? []);
}

/** Write a capture to disk and return its path. */
function writeCapture(label: string, text: string): string {
  const file = join(tempDir(`report-${label}`), "stage-report.txt");
  writeFileSync(file, text, "utf-8");
  return file;
}

function writeFenceCapture(label: string, options: FenceOptions = {}): string {
  return writeCapture(label, report(fenceBody(options)));
}

/** A temp project root carrying a captured STE-509 skip baseline. */
function rootWithBaseline(label: string, branch: string, skipped: number): string {
  const root = tempDir(`root-${label}`);
  captureSkipBaseline(root, branch, skipped);
  return root;
}

/** The counts a renderer produced, read back out of its own rendered lines. */
async function roundTrip(
  input: StageEvidenceInput,
): Promise<{ rendered: RenderedStageEvidence; readBack: Record<EvidenceSection, EvidenceCounts | null> }> {
  const mod = await loadEvidence();
  const rendered = mod.renderStageEvidence(input);
  const readBack = mod.parseEvidenceLines(rendered.lines);
  return { rendered, readBack };
}

// ===========================================================================
// AC-STE-510.1 — `drive:` and `e2e:` in FIXED ORDER after `gate:`.
// Order, not presence. Every leg either names a position or rejects a wrong one.
// ===========================================================================

describe("AC-STE-510.1 — drive and e2e sit in fixed order after gate", () => {
  test("DELIVER_STAGE_SECTIONS is the eight names in the one canonical order", async () => {
    const { DELIVER_STAGE_SECTIONS } = await loadCapture();
    expect([...DELIVER_STAGE_SECTIONS]).toEqual([...STAGE_SECTIONS]);
  });

  test("gate, drive, e2e are CONTIGUOUS, in that order, between summary and follow_ups", async () => {
    const { DELIVER_STAGE_SECTIONS } = await loadCapture();
    const at = (name: string): number => DELIVER_STAGE_SECTIONS.indexOf(name);

    expect(at("drive")).toBe(at("gate") + 1);
    expect(at("e2e")).toBe(at("drive") + 1);
    expect(at("gate")).toBe(at("summary") + 1);
    expect(at("follow_ups")).toBe(at("e2e") + 1);
  });

  test("the evidence-section vocabulary is gate, drive, e2e in that order", async () => {
    const { EVIDENCE_SECTIONS } = await loadEvidence();
    expect([...EVIDENCE_SECTIONS]).toEqual([...EVIDENCE_ORDER]);
  });

  test("a real capture carrying the eight sections in canonical order is ACCEPTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(writeFenceCapture("canonical"));
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("WRONG POSITION: drive and e2e placed BEFORE gate is REJECTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const path = writeFenceCapture("before-gate", {
      order: ["stage", "milestone", "status", "summary", "drive", "e2e", "gate", "follow_ups"],
    });
    const verdict = verifyDeliverStageCapture(path);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/order/i);
  });

  test("WRONG POSITION: drive and e2e placed AFTER follow_ups is REJECTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const path = writeFenceCapture("after-follow-ups", {
      order: ["stage", "milestone", "status", "summary", "gate", "follow_ups", "drive", "e2e"],
    });
    const verdict = verifyDeliverStageCapture(path);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/order/i);
  });

  test("a capture that DROPS drive and e2e entirely is REJECTED by name", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const path = writeFenceCapture("dropped", {
      order: ["stage", "milestone", "status", "summary", "gate", "follow_ups"],
    });
    const verdict = verifyDeliverStageCapture(path);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("drive");
    expect(verdict.reasons.join("\n")).toContain("e2e");
  });

  test("the renderer emits the three section blocks in gate → drive → e2e order", async () => {
    const branch = "feat/m132-evidence-ledger";
    const root = rootWithBaseline("order", branch, 16);
    const { rendered } = await roundTrip({
      gate: capturedRun("gate-order", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-order", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-order", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    });

    const headings = rendered.lines
      .filter((line) => /^[a-z0-9_]+:\s*$/.test(line))
      .map((line) => line.replace(":", "").trim());
    expect(headings).toEqual([...EVIDENCE_ORDER]);
  });
});

// ===========================================================================
// AC-STE-510.2 — `gate:` carries pass, fail AND skip, plus the baseline delta.
// ===========================================================================

describe("AC-STE-510.2 — the gate section carries all three counts and the delta", () => {
  test("the rendered gate line carries pass, fail, skip AND the baseline delta", async () => {
    const branch = "feat/m132-evidence-ledger";
    const root = rootWithBaseline("gate-full", branch, 16);
    const { rendered, readBack } = await roundTrip({
      gate: capturedRun("gate-full", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-full", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-full", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    });

    const gate = readBack.gate;
    expect(gate).not.toBeNull();
    expect(gate!.pass).toBe(8123);
    expect(gate!.fail).toBe(0);
    expect(gate!.skip).toBe(16);
    expect(gate!.baseline).toBe(16);
    expect(gate!.delta).toBe(0);

    // And the three counts are literally on the gate line, not implied.
    const gateLine = rendered.lines[rendered.lines.indexOf("gate:") + 1]!;
    for (const token of ["pass", "fail", "skip", "delta"]) {
      expect(gateLine).toContain(token);
    }
  });

  test("SILENT-SKIP GUARD: a gate line carrying only pass and fail is REJECTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const path = writeFenceCapture("gate-no-skip", {
      gate: ["  - pass 8123, fail 0, baseline 16, delta 0"],
    });
    const verdict = verifyDeliverStageCapture(path);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/skip/i);
  });

  test("a gate line with no baseline delta at all is REJECTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const path = writeFenceCapture("gate-no-delta", {
      gate: ["  - pass 8123, fail 0, skip 16"],
    });
    const verdict = verifyDeliverStageCapture(path);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/baseline|delta/i);
  });

  test("the delta is WIRED to the shipped STE-509 baseline, not restated", async () => {
    const branch = "feat/m132-evidence-ledger";
    // Baseline captured at 12; the capture reports 16 ⇒ a genuine +4 delta.
    const root = rootWithBaseline("delta-wired", branch, 12);
    const { readBack } = await roundTrip({
      gate: capturedRun("gate-delta", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-delta", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-delta", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    });

    expect(readBack.gate!.baseline).toBe(12);
    expect(readBack.gate!.delta).toBe(4);
  });

  test("a DIFFERENT baseline moves the delta — the number is not a constant", async () => {
    const branch = "feat/m132-evidence-ledger";
    const gate = capturedRun("gate-two-baselines", "bun test", GATE_OUTPUT_CLEAN);
    const drive = capturedRun("drive-two-baselines", "bun run drive", DRIVE_OUTPUT);
    const e2e = capturedRun("e2e-two-baselines", "bun run e2e", E2E_OUTPUT);

    const a = await roundTrip({
      gate,
      drive,
      e2e,
      projectRoot: rootWithBaseline("base-a", branch, 16),
      branch,
    });
    const b = await roundTrip({
      gate,
      drive,
      e2e,
      projectRoot: rootWithBaseline("base-b", branch, 4),
      branch,
    });

    expect(a.readBack.gate!.delta).toBe(0);
    expect(b.readBack.gate!.delta).toBe(12);
  });

  test("drive and e2e sections carry pass, fail and skip counts too", async () => {
    const branch = "feat/m132-evidence-ledger";
    const { readBack } = await roundTrip({
      gate: capturedRun("gate-de", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-de", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-de", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("de", branch, 16),
      branch,
    });

    expect(readBack.drive).toMatchObject({ pass: 12, fail: 0, skip: 0 });
    expect(readBack.e2e).toMatchObject({ pass: 3, fail: 0, skip: 0 });
  });
});

// ===========================================================================
// AC-STE-510.3 — EVERY count is derived by code from captured output.
// THE ROUND TRIP plus THE SENSITIVITY LEG. This is the criterion the FR names
// as the one most likely to ship fail-open.
// ===========================================================================

describe("AC-STE-510.3 — counts are derived from the capture, never authored", () => {
  test("ROUND TRIP: rendered numbers equal counts parsed INDEPENDENTLY from the same capture", async () => {
    const branch = "feat/m132-evidence-ledger";
    const { readBack } = await roundTrip({
      gate: capturedRun("gate-rt", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-rt", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-rt", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("rt", branch, 16),
      branch,
    });

    for (const [section, output] of [
      ["gate", GATE_OUTPUT_CLEAN],
      ["drive", DRIVE_OUTPUT],
      ["e2e", E2E_OUTPUT],
    ] as const) {
      const want = independentCounts(output, "bun");
      const got = readBack[section];
      expect(got).not.toBeNull();
      expect({ pass: got!.pass, fail: got!.fail, skip: got!.skip }).toEqual(want);
    }
  });

  test("SENSITIVITY: change the captured bytes and EVERY rendered number moves with them", async () => {
    const branch = "feat/m132-evidence-ledger";
    const root = rootWithBaseline("sensitivity", branch, 16);
    const drive = capturedRun("drive-sens", "bun run drive", DRIVE_OUTPUT);
    const e2e = capturedRun("e2e-sens", "bun run e2e", E2E_OUTPUT);

    const first = await roundTrip({
      gate: capturedRun("gate-sens-a", "bun test", GATE_OUTPUT_CLEAN),
      drive,
      e2e,
      projectRoot: root,
      branch,
    });
    const second = await roundTrip({
      gate: capturedRun("gate-sens-b", "bun test", GATE_OUTPUT_SHIFTED),
      drive,
      e2e,
      projectRoot: root,
      branch,
    });

    // A worker-authored constant survives the round trip above; it cannot
    // survive this, because nothing about the fence changed except the bytes.
    expect(first.readBack.gate!.pass).toBe(8123);
    expect(second.readBack.gate!.pass).toBe(7001);
    expect(first.readBack.gate!.skip).toBe(16);
    expect(second.readBack.gate!.skip).toBe(9);
    expect(second.readBack.gate!.delta).toBe(-7);
    expect(second.rendered.lines).not.toEqual(first.rendered.lines);
  });

  test("STACK-CORRECT: pytest `N passed` excludes skips, bun's `Ran N tests` includes them", async () => {
    const branch = "feat/m132-evidence-ledger";
    const { readBack } = await roundTrip({
      gate: capturedRun("gate-pytest", "pytest", PYTEST_OUTPUT, "pytest"),
      drive: capturedRun("drive-pytest", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-pytest", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("pytest", branch, 3),
      branch,
    });

    expect({ ...independentCounts(PYTEST_OUTPUT, "pytest") }).toEqual({
      pass: 17,
      fail: 0,
      skip: 3,
    });
    expect(readBack.gate!.pass).toBe(17);
    expect(readBack.gate!.skip).toBe(3);
  });

  test("PROVENANCE: the renderer derives through the SHIPPED parser and baseline modules", () => {
    const source = read(EVIDENCE_MODULE);

    // Imported from the one home each, and CALLED by bare name so an override
    // of either is genuinely wired through (the STE-509 house idiom).
    expect(source).toContain('from "./test_count_parser"');
    expect(source).toContain('from "./skip_baseline"');
    expect(source).toContain("parseTestOutput(");
    expect(source).toContain("evaluateSkipDelta(");
  });
});

// ===========================================================================
// AC-STE-510.4 — a fence whose counts disagree with the capture is a contract
// violation, taking the EXISTING bounded-retry-then-halt path.
// ===========================================================================

describe("AC-STE-510.4 — counts disagreeing with the capture is a contract violation", () => {
  const branch = "feat/m132-evidence-ledger";

  function evidenceFor(label: string, root: string): StageEvidenceInput {
    return {
      gate: capturedRun(`gate-${label}`, "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun(`drive-${label}`, "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun(`e2e-${label}`, "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    };
  }

  test("CONTROL: a fence AGREEING with the capture cross-checks clean", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("agree", branch, 16);
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("agree"),
      evidenceFor("agree", root),
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("a fence whose gate counts disagree with the capture is REJECTED, naming both numbers", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("disagree", branch, 16);
    const path = writeFenceCapture("disagree", {
      // 8123 in the capture; 8500 in the fence.
      gate: ["  - pass 8500, fail 0, skip 16, baseline 16, delta 0"],
    });
    const verdict = verifyDeliverStageCapture(path, evidenceFor("disagree", root));

    expect(verdict.ok).toBe(false);
    const text = verdict.reasons.join("\n");
    expect(text).toContain("gate");
    expect(text).toContain("8500");
    expect(text).toContain("8123");
  });

  test("a disagreeing DRIVE count is rejected too — the cross-check is not gate-only", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("disagree-drive", branch, 16);
    const path = writeFenceCapture("disagree-drive", {
      drive: ["  - pass 99, fail 0, skip 0"],
    });
    const verdict = verifyDeliverStageCapture(path, evidenceFor("disagree-drive", root));

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("drive");
  });

  test("a disagreeing E2E count is rejected too", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("disagree-e2e", branch, 16);
    const path = writeFenceCapture("disagree-e2e", {
      e2e: ["  - pass 7, fail 0, skip 0"],
    });
    const verdict = verifyDeliverStageCapture(path, evidenceFor("disagree-e2e", root));

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("e2e");
  });

  test("ONE FAILURE MODE: a counts violation is graded like a shape violation — same verdict, no throw", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("one-channel", branch, 16);

    const shape = verifyDeliverStageCapture(
      writeFenceCapture("one-channel-shape", {
        order: ["stage", "milestone", "status", "summary", "drive", "e2e", "gate", "follow_ups"],
      }),
    );
    let counts!: CaptureVerdict;
    expect(() => {
      counts = verifyDeliverStageCapture(
        writeFenceCapture("one-channel-counts", {
          gate: ["  - pass 1, fail 0, skip 16, baseline 16, delta 0"],
        }),
        evidenceFor("one-channel", root),
      );
    }).not.toThrow();

    // Same shape of verdict, same keys, same ok:false — so a counts violation
    // routes into the shipped bounded-retry-then-halt path rather than forking
    // a second failure mode with its own recovery.
    expect(Object.keys(counts).sort()).toEqual(Object.keys(shape).sort());
    expect(counts.ok).toBe(false);
    expect(shape.ok).toBe(false);
    expect(Array.isArray(counts.reasons)).toBe(true);
    expect(counts.reasons.length).toBeGreaterThan(0);
  });

  test("the SKILL routes a counts disagreement into the same bounded-retry-then-halt clause", () => {
    const skill = read(DELIVER_SKILL);
    const at = skill.indexOf("Shape violations");
    expect(at).toBeGreaterThan(-1);
    const section = skill.slice(at, at + 1400);

    // The enumeration of what counts as a violation must reach the new ground,
    // or a worker emitting invented numbers is never re-prompted at all.
    expect(section).toMatch(/count|number/i);
    expect(section).toMatch(/captur/i);
  });
});

// ===========================================================================
// AC-STE-510.5 — `status: ok` is refused on TWO separate grounds.
// Ground 1: a required count ABSENT. Ground 2: a count INDICATING FAILURE.
// ===========================================================================

describe("AC-STE-510.5 ground 1 — a required count is ABSENT", () => {
  const branch = "feat/m132-evidence-ledger";

  test("no capture for a required section ⇒ not ok, and the section is NAMED", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-absent", "bun test", GATE_OUTPUT_CLEAN),
      // drive and e2e simply never ran.
      projectRoot: rootWithBaseline("absent", branch, 16),
      branch,
    });

    expect(rendered.ok).toBe(false);
    const text = rendered.reasons.join("\n");
    expect(text).toContain("drive");
    expect(text).toContain("e2e");
  });

  test("FAIL-CLOSED DEFAULT: omitting `required` means all three, not none", async () => {
    const mod = await loadEvidence();
    const bare = mod.renderStageEvidence({});
    expect(bare.ok).toBe(false);
    expect(bare.reasons.length).toBeGreaterThan(0);
  });

  test("an absent section still keeps its heading and carries `- (none found)`", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-nonefound", "bun test", GATE_OUTPUT_CLEAN),
      required: ["gate"],
      projectRoot: rootWithBaseline("nonefound", branch, 16),
      branch,
    });

    expect(rendered.lines).toContain("drive:");
    expect(rendered.lines).toContain("e2e:");
    expect(rendered.lines.join("\n")).toContain("- (none found)");
    // A section legitimately not required is not a refusal ground.
    expect(rendered.ok).toBe(true);
  });

  test("an UNMEASURED baseline is a missing count — never a silent zero", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-unmeasured", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-unmeasured", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-unmeasured", "bun run e2e", E2E_OUTPUT),
      // No baseline was ever captured for this root/branch.
      projectRoot: tempDir("no-baseline"),
      branch,
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toMatch(/baseline|unmeasured/i);
    expect(rendered.counts.gate!.delta).toBeNull();
    expect(rendered.counts.gate!.delta).not.toBe(0);
  });

  test("AT THE FENCE: `status: ok` beside a gate line missing the skip count is REFUSED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("ok-missing-count", {
        status: "ok",
        gate: ["  - pass 8123, fail 0, baseline 16, delta 0"],
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/skip/i);
  });

  // THE HEALTHY CASE THIS REFUSAL MUST NOT EAT. A REDUCED CHAIN — a milestone
  // whose work lands in a tree with no toolkit — has no gate, drive or e2e
  // command to run, so all three sections legally carry `- (none found)` and
  // the stage is still `ok`. M129 recorded the split-source-of-truth pattern
  // three times in one milestone, EVERY instance producing a grader that failed
  // healthy runs; a counts guard that cannot tell "no command exists" from "the
  // worker omitted the number" is the same defect in a new place.
  //
  // So the fence-layer rule is: a section that carries a COUNTS LINE must carry
  // every required count on it; the `- (none found)` fallback stays legal. The
  // stronger "this section MUST have run" obligation lives in
  // `renderStageEvidence`, where the route decides `required`.
  test("REDUCED CHAIN: `status: ok` with all three sections `- (none found)` is ACCEPTED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("reduced-chain", {
        status: "ok",
        gate: ["  - (none found)"],
        drive: ["  - (none found)"],
        e2e: ["  - (none found)"],
      }),
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("a reduced-chain stage declares no required sections and is ok", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({ required: [] });
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
    expect(rendered.lines.filter((line) => line.includes("(none found)")).length).toBe(3);
  });
});

describe("AC-STE-510.5 ground 2 — a count INDICATES FAILURE", () => {
  const branch = "feat/m132-evidence-ledger";

  test("failures in the captured gate output ⇒ not ok", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-failing", "bun test", GATE_OUTPUT_FAILING),
      drive: capturedRun("drive-failing", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-failing", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("failing", branch, 16),
      branch,
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toMatch(/fail/i);
    // And the number is still REPORTED — refusing is not hiding.
    expect(rendered.counts.gate!.fail).toBe(3);
  });

  test("a POSITIVE skip delta ⇒ not ok, even with zero failures", async () => {
    const mod = await loadEvidence();
    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-skipdelta", "bun test", GATE_OUTPUT_MORE_SKIPS),
      drive: capturedRun("drive-skipdelta", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-skipdelta", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("skipdelta", branch, 16),
      branch,
    });

    expect(rendered.counts.gate!.fail).toBe(0);
    expect(rendered.counts.gate!.delta).toBe(4);
    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toMatch(/skip/i);
  });

  test("a failing DRIVE or E2E capture is a refusal ground as well", async () => {
    const mod = await loadEvidence();
    const failingDrive = [
      "bun test v1.1.29",
      "",
      " 10 pass",
      " 0 skip",
      " 2 fail",
      "Ran 12 tests across 3 files. [1.31s]",
    ].join("\n");

    const rendered = mod.renderStageEvidence({
      gate: capturedRun("gate-drivefail", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("drive-drivefail", "bun run drive", failingDrive),
      e2e: capturedRun("e2e-drivefail", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("drivefail", branch, 16),
      branch,
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("drive");
  });

  test("AT THE FENCE: `status: ok` beside a non-zero fail count is REFUSED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("ok-with-failures", {
        status: "ok",
        gate: ["  - pass 8100, fail 3, skip 16, baseline 16, delta 0"],
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/fail/i);
  });

  test("AT THE FENCE: `status: ok` beside a POSITIVE skip delta is REFUSED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("ok-with-skip-delta", {
        status: "ok",
        gate: ["  - pass 8119, fail 0, skip 20, baseline 16, delta 4"],
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/skip|delta/i);
  });

  test("`status: failed` beside failing counts is NOT a refusal — honesty is legal", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("failed-honest", {
        status: "failed",
        gate: ["  - pass 8100, fail 3, skip 16, baseline 16, delta 0"],
      }),
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-510.6 — the cap is RAISED to fit, and it still BINDS. The sections
// stay INSIDE the fence; no companion artifact.
// ===========================================================================

describe("AC-STE-510.6 — the line cap is raised, still binds, and nothing moves out of the fence", () => {
  test("FENCE_LINE_CAP is exported and raised above the shipped 20", async () => {
    const { FENCE_LINE_CAP } = await loadCapture();
    expect(typeof FENCE_LINE_CAP).toBe("number");
    expect(FENCE_LINE_CAP).toBeGreaterThan(20);
  });

  test("a realistic full eight-section fence FITS under the raised cap", async () => {
    const { FENCE_LINE_CAP, verifyDeliverStageCapture } = await loadCapture();
    const body = fenceBody({
      summary: [
        "  - STE-508 skip parsing",
        "  - STE-509 skip baseline",
        "  - STE-510 fence evidence",
      ],
      followUps: ["  - conformance leg deferred to the next run"],
    });

    expect(body.length).toBeLessThanOrEqual(FENCE_LINE_CAP);

    const verdict = verifyDeliverStageCapture(writeCapture("fits", report(body)));
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("THE CAP STILL BINDS: a fence one line over is REJECTED", async () => {
    const { FENCE_LINE_CAP, verifyDeliverStageCapture } = await loadCapture();
    const base = fenceBody();
    const padding = Array.from(
      { length: FENCE_LINE_CAP + 1 - base.length },
      (_unused, i) => `  - padding item ${i + 1}`,
    );
    const body = fenceBody({
      summary: ["  - STE-510 fence evidence", ...padding],
    });

    expect(body.length).toBe(FENCE_LINE_CAP + 1);

    const verdict = verifyDeliverStageCapture(writeCapture("over-cap", report(body)));
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/cap/i);
  });

  test("the evidence lives INSIDE the fence — the renderer writes no companion artifact", () => {
    const source = read(EVIDENCE_MODULE);
    for (const forbidden of ["writeFileSync", "appendFileSync", "mkdirSync", "createWriteStream"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("gate, drive and e2e are TOP-LEVEL keys inside the fence, not a pointer to elsewhere", async () => {
    const { DELIVER_STAGE_FENCE_BANNER } = await loadCapture();
    const capture = report(fenceBody());
    const fences = findFences(
      capture,
      new RegExp(`^[ \\t]*${DELIVER_STAGE_FENCE_BANNER}[ \\t]*$`),
      /^[ \t]*```[ \t]*$/,
    );
    expect(fences.length).toBe(1);

    const keys = fences[0]!.lines
      .map((line) => /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined);
    expect(keys).toEqual([...STAGE_SECTIONS]);
  });
});

// ===========================================================================
// AC-STE-510.7 — MUTATION-VERIFIED. The two mutations the FR names by hand,
// each REALLY EXECUTED, each asserted RED, each paired with a control that is
// asserted GREEN through the SAME harness.
//
// Isolation alone proves nothing (M127: six vacuities found in the harness's
// own machinery). A mutation asserted red without a green sibling is
// indistinguishable from a harness that always fails.
// ===========================================================================

describe("AC-STE-510.7 — the guards are mutation-verified", () => {
  const branch = "feat/m132-evidence-ledger";

  /** The evidence the honest fence was rendered from. */
  function honestEvidence(label: string, root: string): StageEvidenceInput {
    return {
      gate: capturedRun(`m7-gate-${label}`, "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun(`m7-drive-${label}`, "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun(`m7-e2e-${label}`, "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    };
  }

  /**
   * Render an honest fence FROM the capture, then verify that capture-backed
   * report. This is the harness both mutations are run through, so a red
   * mutant is attributable to the mutation and not to the harness.
   */
  async function renderAndVerify(
    label: string,
    evidence: StageEvidenceInput,
    tamper?: (lines: string[]) => string[],
  ): Promise<{ rendered: RenderedStageEvidence; verdict: CaptureVerdict }> {
    const mod = await loadEvidence();
    const capture = await loadCapture();

    const rendered = mod.renderStageEvidence(evidence);
    const evidenceLines = tamper ? tamper([...rendered.lines]) : [...rendered.lines];

    const body = [
      "stage: implement",
      "milestone: M132",
      "status: ok",
      "summary:",
      "  - STE-510 lands machine-read fence evidence",
      ...evidenceLines,
      "follow_ups:",
      "  - (none found)",
    ];
    const path = writeCapture(`m7-${label}`, report(body));
    return { rendered, verdict: capture.verifyDeliverStageCapture(path, evidence) };
  }

  test("CONTROL: the honest capture-rendered fence is GREEN through this harness", async () => {
    const root = rootWithBaseline("m7-control", branch, 16);
    const { rendered, verdict } = await renderAndVerify("control", honestEvidence("control", root));

    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("MUTATION (a): a WORKER-AUTHORED count that disagrees with the capture goes RED", async () => {
    const root = rootWithBaseline("m7-authored", branch, 16);

    // The mutation, really applied: the worker overwrites the derived pass
    // count with a plausible number of its own. Shape, order and cap are all
    // untouched — this is exactly the block that passes every shipped check.
    let applied = false;
    const { verdict } = await renderAndVerify(
      "authored",
      honestEvidence("authored", root),
      (lines) =>
        lines.map((line) => {
          if (!line.includes("pass 8123")) return line;
          applied = true;
          return line.replace("pass 8123", "pass 8200");
        }),
    );

    // The mutation LANDED — measured, not assumed (M121 § 0k(m): a mutation
    // that silently misses manufactures evidence for an unexercised assertion).
    expect(applied).toBe(true);

    expect(verdict.ok).toBe(false);
    const text = verdict.reasons.join("\n");
    expect(text).toContain("8200");
    expect(text).toContain("8123");
  });

  test("MUTATION (b): a fence rendered with NO capture present goes RED", async () => {
    const mod = await loadEvidence();
    const root = rootWithBaseline("m7-nocapture", branch, 16);

    // Control half, through the same call: with the captures present, ok.
    const withCapture = mod.renderStageEvidence(honestEvidence("nocapture", root));
    expect(withCapture.ok).toBe(true);

    // The mutation: every capture removed, nothing else changed.
    const withoutCapture = mod.renderStageEvidence({
      gate: null,
      drive: null,
      e2e: null,
      projectRoot: root,
      branch,
    });

    expect(withoutCapture.ok).toBe(false);
    expect(withoutCapture.reasons.length).toBeGreaterThan(0);
    for (const section of EVIDENCE_ORDER) {
      expect(withoutCapture.counts[section]).toBeNull();
    }
    // And it does NOT invent numbers to fill the hole.
    expect(withoutCapture.lines.join("\n")).not.toMatch(/pass \d+/);
  });

  test("MUTATION (b) at the fence layer: counts claimed with no capture behind them go RED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("m7-fence-nocapture", branch, 16);

    // Same fence bytes both times; only the capture behind them changes.
    const path = writeFenceCapture("m7-fence-nocapture");

    const backed = verifyDeliverStageCapture(path, {
      gate: capturedRun("m7-backed-gate", "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun("m7-backed-drive", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("m7-backed-e2e", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    });
    expect(backed.ok).toBe(true);

    const unbacked = verifyDeliverStageCapture(path, {
      gate: null,
      drive: null,
      e2e: null,
      projectRoot: root,
      branch,
    });
    expect(unbacked.ok).toBe(false);
    expect(unbacked.reasons.join("\n")).toMatch(/captur/i);
  });

  test("the shipped fixture captures still grade as intended under the new contract", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();

    // The genuine model must be UPDATED to the eight-section contract, or it
    // silently becomes an invalid fixture that the M129 suite still calls good.
    const genuine = verifyDeliverStageCapture(CAPTURE_GENUINE);
    expect(genuine.reasons).toEqual([]);
    expect(genuine.ok).toBe(true);

    expect(verifyDeliverStageCapture(CAPTURE_NO_FENCE).ok).toBe(false);
    expect(verifyDeliverStageCapture(CAPTURE_REORDERED).ok).toBe(false);
  });

  test("WRONG-SUBJECT GUARD: /deliver's own SKILL is still not a valid capture", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(DELIVER_SKILL);
    expect(verdict.ok).toBe(false);
  });
});

// ===========================================================================
// SURFACE-DRIFT GUARD — the ONE place in this file whose subject is documents.
//
// AC.1 and AC.6 change a rule that is written down in twelve places. On M131 a
// rule landed on one surface and not its sibling THREE separate times in a
// single milestone, and the carve-out class still has no guard. This describe
// derives every expectation from the SHIPPED CONSTANTS, so a change that
// reaches the code and not the prose (or one document and not the other) goes
// red here.
//
// It is a drift guard and nothing more. It does NOT substitute for the
// capture-subject legs above — that substitution is precisely the mistake
// STE-464 made eighteen times.
// ===========================================================================

describe("surface drift — the eight sections and the raised cap agree everywhere", () => {
  const COUNT_WORDS: Record<number, string> = {
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
  };

  /**
   * Every section name appears, in canonical order, inside `region`.
   *
   * The assertion is phrased as a labelled string comparison so a failure names
   * WHICH section broke the order on WHICH surface — a bare
   * `toBeGreaterThan(cursor)` reports two integers and leaves the reader to
   * guess which of eight names and which of five enumerations it came from.
   */
  function expectOrdered(region: string, label: string): void {
    let cursor = -1;
    for (const name of STAGE_SECTIONS) {
      const at = region.indexOf(`\`${name}\``);
      expect(`${label}: \`${name}\` after the previous section: ${at > cursor}`).toBe(
        `${label}: \`${name}\` after the previous section: true`,
      );
      cursor = at;
    }
  }

  /** The single line containing `anchor`, or a loud failure. */
  function lineWith(doc: string, anchor: string, label: string): string {
    const hits = doc.split("\n").filter((line) => line.includes(anchor));
    if (hits.length !== 1) {
      throw new Error(
        `${label}: expected exactly one line containing ${JSON.stringify(anchor)}, found ${hits.length}`,
      );
    }
    return hits[0]!;
  }

  test("no surface still says SIX sections", () => {
    for (const [label, path] of [
      ["SKILL.md", DELIVER_SKILL],
      ["deliver-reference.md", DELIVER_REFERENCE],
    ] as const) {
      const doc = read(path).toLowerCase();
      expect(`${label}: ${doc.includes("six section")}`).toBe(`${label}: false`);
    }
  });

  test("every surface states the section count as the constant's length", async () => {
    const { DELIVER_STAGE_SECTIONS } = await loadCapture();
    const word = COUNT_WORDS[DELIVER_STAGE_SECTIONS.length];
    expect(word).toBeDefined();

    for (const [label, path] of [
      ["SKILL.md", DELIVER_SKILL],
      ["deliver-reference.md", DELIVER_REFERENCE],
    ] as const) {
      const doc = read(path).toLowerCase();
      expect(`${label}: ${doc.includes(`${word} section`)}`).toBe(`${label}: true`);
    }
  });

  test("SKILL kickoff bullet enumerates all eight sections in canonical order", () => {
    const line = lineWith(read(DELIVER_SKILL), "sections, fixed order**", "SKILL kickoff bullet");
    expectOrdered(line, "SKILL kickoff bullet");
  });

  test("SKILL `Required sections, in fixed section order` list carries all eight", () => {
    const line = lineWith(
      read(DELIVER_SKILL),
      "Required sections, in fixed section order",
      "SKILL required-sections list",
    );
    expectOrdered(line, "SKILL required-sections list");
  });

  test("the SKILL's own example fence carries the eight sections in canonical order", async () => {
    const { DELIVER_STAGE_FENCE_BANNER } = await loadCapture();
    const skill = read(DELIVER_SKILL);
    const fences = findFences(
      skill,
      new RegExp(`^[ \\t]*${DELIVER_STAGE_FENCE_BANNER}[ \\t]*$`),
      /^[ \t]*```[ \t]*$/,
    );
    expect(fences.length).toBe(1);

    const keys = fences[0]!.lines
      .map((line) => /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined);
    expect(keys).toEqual([...STAGE_SECTIONS]);
  });

  test("the SKILL example's gate item names pass, fail, skip AND the delta", async () => {
    const { DELIVER_STAGE_FENCE_BANNER } = await loadCapture();
    const skill = read(DELIVER_SKILL);
    const fences = findFences(
      skill,
      new RegExp(`^[ \\t]*${DELIVER_STAGE_FENCE_BANNER}[ \\t]*$`),
      /^[ \t]*```[ \t]*$/,
    );
    const lines = fences[0]!.lines;
    const gateAt = lines.findIndex((line) => line.startsWith("gate:"));
    expect(gateAt).toBeGreaterThan(-1);
    const gateItem = lines[gateAt + 1]!;

    for (const token of ["pass", "fail", "skip", "delta"]) {
      expect(`gate item contains ${token}: ${gateItem.includes(token)}`).toBe(
        `gate item contains ${token}: true`,
      );
    }
  });

  test("the list-section statements name drive and e2e as list sections", () => {
    const skillLine = lineWith(read(DELIVER_SKILL), "list sections", "SKILL list-sections sentence");
    expect(skillLine).toContain("`drive`");
    expect(skillLine).toContain("`e2e`");

    const refLine = lineWith(read(DELIVER_REFERENCE), "are **lists**", "reference lists sentence");
    expect(refLine).toContain("`drive`");
    expect(refLine).toContain("`e2e`");
  });

  test("the reference field table has a row per section at its canonical position", () => {
    const ref = read(DELIVER_REFERENCE);
    STAGE_SECTIONS.forEach((name, index) => {
      const row = new RegExp(`^\\|\\s*\`${name}\`\\s*\\|\\s*${index + 1}\\s*\\|`, "m");
      expect(`${name} row at position ${index + 1}: ${row.test(ref)}`).toBe(
        `${name} row at position ${index + 1}: true`,
      );
    });
  });

  test("the reference gate row names pass, fail, skip and the baseline", () => {
    const ref = read(DELIVER_REFERENCE);
    const row = ref.split("\n").find((line) => /^\|\s*`gate`\s*\|/.test(line));
    expect(row).toBeDefined();
    for (const token of ["pass", "fail", "skip", "baseline"]) {
      expect(`gate row names ${token}: ${row!.includes(token)}`).toBe(
        `gate row names ${token}: true`,
      );
    }
  });

  test("every line-cap statement on every surface states the constant's number", async () => {
    const { FENCE_LINE_CAP } = await loadCapture();

    // Scoped to statements about THIS cap. Both files also mention the NFR-1
    // skill-file line cap (a 351-line budget on the document itself), and
    // sweeping every `/line cap/i` line would drag that unrelated number in and
    // fail on it — a guard that false-REDs a healthy surface.
    for (const [label, path] of [
      ["SKILL.md", DELIVER_SKILL],
      ["deliver-reference.md", DELIVER_REFERENCE],
    ] as const) {
      const hits = read(path)
        .split("\n")
        .filter((line) => /line cap/i.test(line) && line.includes("inside the fence"));
      expect(`${label} line-cap statements: ${hits.length > 0}`).toBe(
        `${label} line-cap statements: true`,
      );
      for (const hit of hits) {
        expect(`${label} states ${FENCE_LINE_CAP}: ${hit.includes(String(FENCE_LINE_CAP))}`).toBe(
          `${label} states ${FENCE_LINE_CAP}: true`,
        );
        // And the stale 20 is gone from that same statement.
        expect(`${label} stale 20: ${/\b20\b/.test(hit)}`).toBe(`${label} stale 20: false`);
      }
    }
  });

  test("the capture module's own reasons text agrees with the constants", () => {
    const source = read(CAPTURE_MODULE);
    // The module restates the section list in its header prose; a rename that
    // reached the const but not the comment is exactly the M131 drift shape.
    for (const name of ["drive", "e2e"]) {
      expect(`capture module mentions ${name}: ${source.includes(name)}`).toBe(
        `capture module mentions ${name}: true`,
      );
    }
    expect(source).toContain("export const FENCE_LINE_CAP");
  });
});

// ===========================================================================
// HARDENING (scoped round, post-GREEN) — the REDUCED-CHAIN hole in the
// cross-check's `derived === null` branch.
//
// WHY THIS BLOCK EXISTS. AC.7's own two named mutations were re-run and both
// die honestly. An ADJACENT guard does not: silencing the `reasons.push` in
// `crossCheckEvidence`'s `derived === null` branch
// (`adapters/_shared/src/deliver_stage_capture.ts`) leaves all 59 shipped legs
// of this file GREEN. A guard that cannot fail is indistinguishable, in a green
// run, from a guard that works — the FR's own § Notes says so.
//
// WHY IT SURVIVED. On the DEFAULT path (`required` omitted ⇒ all three
// sections) the branch is genuinely redundant: with no capture for a required
// section, `renderStageEvidence` refuses first and its reason is spliced onto
// the same `reasons` array, so `ok` is already false before the branch runs.
// Every shipped cross-check leg — AC.4's, AC.5's, AC.7 mutation (b)'s — takes
// that path.
//
// WHERE IT IS THE ONLY GUARD. A REDUCED chain passes `required: []`, or a
// subset. There, a section with no capture is LEGAL at the evidence layer —
// `renderStageEvidence` returns `ok: true, reasons: []` — and yet the fence
// still STATES counts for it. Nothing else in the module refuses that block:
// the shape checks pass (right sections, right order, under the cap), the
// counts line carries every count it owes, and `status: ok` sits beside
// `fail 0`. The numbers are pure worker invention and the report grades clean.
// That is AC.3's defect — "no count is authored by the reporting worker" —
// reappearing on the one route no shipped test covers.
//
// THE ISOLATION HALF. Each hole leg asserts, through the same call, that
// `renderStageEvidence` does NOT refuse (`ok: true`, `reasons: []`) and that
// the verdict carries EXACTLY ONE reason. Both together are what make the leg
// attributable: if a default-path refusal were holding it up, the evidence
// layer would have spoken and the reason count would be higher.
//
// THE CONTROL HALF. The same reduced-chain configuration with the fence
// correctly carrying `- (none found)` for the uncaptured section must still be
// ACCEPTED. A "fix" that refused every reduced chain would be worse than the
// hole: `- (none found)` on `gate`/`drive`/`e2e` is exactly how a milestone
// landing in a tree with no toolkit reports honestly, and the capture module's
// own header names that as the case it must not fail.
// ===========================================================================

describe("HARDENING — a reduced chain cannot state counts for a section it never captured", () => {
  const branch = "feat/m132-evidence-ledger";

  /** The reduced chain's stage id — `work`, not one of the full ceremony's. */
  function reducedBody(sections: {
    gate: readonly string[];
    drive: readonly string[];
    e2e: readonly string[];
  }): string[] {
    return [
      "stage: work",
      "milestone: M132",
      "status: ok",
      "summary:",
      "  - reduced chain: work then pr, target tree carries no toolkit",
      "gate:",
      ...sections.gate,
      "drive:",
      ...sections.drive,
      "e2e:",
      ...sections.e2e,
      "follow_ups:",
      "  - (none found)",
    ];
  }

  const NONE = ["  - (none found)"] as const;

  // ---- Case A: `required: []` — the fully reduced chain. ------------------

  /** No captures at all, and none owed. The evidence layer has no complaint. */
  function noCaptureEvidence(root: string): StageEvidenceInput {
    return { required: [], projectRoot: root, branch };
  }

  test("ISOLATION: with `required: []` and no captures, the evidence layer does NOT refuse", async () => {
    const mod = await loadEvidence();
    const root = rootWithBaseline("hard-iso", branch, 16);
    const rendered = mod.renderStageEvidence(noCaptureEvidence(root));

    // This is the precondition the whole block rests on. If this ever starts
    // refusing, the hole legs below stop being about the `derived === null`
    // branch and start being about the evidence layer, and they must be
    // rewritten rather than left to pass for the wrong reason.
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
    for (const section of EVIDENCE_ORDER) expect(rendered.counts[section]).toBeNull();
  });

  test("THE HOLE: a reduced-chain fence stating gate counts with NO capture is REJECTED", async () => {
    const mod = await loadEvidence();
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-hole-gate", branch, 16);
    const evidence = noCaptureEvidence(root);

    // Isolation, asserted through the very same input the verdict is taken on.
    const rendered = mod.renderStageEvidence(evidence);
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);

    const path = writeCapture(
      "hard-hole-gate",
      report(
        reducedBody({
          // Entirely plausible, entirely invented: nothing ran.
          gate: [DEFAULT_GATE_LINE],
          drive: [...NONE],
          e2e: [...NONE],
        }),
      ),
    );
    const verdict = capture.verifyDeliverStageCapture(path, evidence);

    expect(verdict.ok).toBe(false);
    // EXACTLY one — so the refusal is attributable to the `derived === null`
    // branch and to nothing else in the module.
    expect(verdict.reasons.length).toBe(1);
    expect(verdict.reasons[0]).toContain("gate");
    expect(verdict.reasons[0]).toMatch(/captur/i);
    // It names the invented numbers, so the diagnostic is actionable.
    expect(verdict.reasons[0]).toContain("8123");
  });

  test("THE HOLE, drive: the same reduced chain stating drive counts is REJECTED", async () => {
    const mod = await loadEvidence();
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-hole-drive", branch, 16);
    const evidence = noCaptureEvidence(root);

    expect(mod.renderStageEvidence(evidence).ok).toBe(true);

    const path = writeCapture(
      "hard-hole-drive",
      report(
        reducedBody({ gate: [...NONE], drive: [DEFAULT_DRIVE_LINE], e2e: [...NONE] }),
      ),
    );
    const verdict = capture.verifyDeliverStageCapture(path, evidence);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBe(1);
    expect(verdict.reasons[0]).toContain("drive");
  });

  test("THE HOLE, e2e: the same reduced chain stating e2e counts is REJECTED", async () => {
    const mod = await loadEvidence();
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-hole-e2e", branch, 16);
    const evidence = noCaptureEvidence(root);

    expect(mod.renderStageEvidence(evidence).ok).toBe(true);

    const path = writeCapture(
      "hard-hole-e2e",
      report(reducedBody({ gate: [...NONE], drive: [...NONE], e2e: [DEFAULT_E2E_LINE] })),
    );
    const verdict = capture.verifyDeliverStageCapture(path, evidence);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBe(1);
    expect(verdict.reasons[0]).toContain("e2e");
  });

  test("CONTROL: the same reduced chain reporting `- (none found)` everywhere is ACCEPTED", async () => {
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-control", branch, 16);

    const path = writeCapture(
      "hard-control",
      report(reducedBody({ gate: [...NONE], drive: [...NONE], e2e: [...NONE] })),
    );
    const verdict = capture.verifyDeliverStageCapture(path, noCaptureEvidence(root));

    // A fix that rejected every reduced chain would be worse than the hole.
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  // ---- Case B: a SUBSET — `required: ["gate"]`, gate really captured. -----

  test("SUBSET: gate is captured and required, drive is neither — a stated drive count is still REJECTED", async () => {
    const mod = await loadEvidence();
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-subset", branch, 16);

    const evidence: StageEvidenceInput = {
      gate: capturedRun("hard-subset-gate", "bun test", GATE_OUTPUT_CLEAN),
      drive: null,
      e2e: null,
      required: ["gate"],
      projectRoot: root,
      branch,
    };

    // Isolation: the gate leg is fully evidenced and the two absent sections
    // are not owed, so the evidence layer is silent. Anything the verdict says
    // is the cross-check speaking.
    const rendered = mod.renderStageEvidence(evidence);
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);

    const path = writeCapture(
      "hard-subset",
      report(
        reducedBody({
          // Agrees with the capture to the number, so the disagreement leg of
          // the cross-check cannot be what refuses this.
          gate: [DEFAULT_GATE_LINE],
          drive: [DEFAULT_DRIVE_LINE],
          e2e: [...NONE],
        }),
      ),
    );
    const verdict = capture.verifyDeliverStageCapture(path, evidence);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBe(1);
    expect(verdict.reasons[0]).toContain("drive");
    expect(verdict.reasons[0]).toMatch(/captur/i);
  });

  test("SUBSET CONTROL: the same subset with drive reporting `- (none found)` is ACCEPTED", async () => {
    const capture = await loadCapture();
    const root = rootWithBaseline("hard-subset-control", branch, 16);

    const evidence: StageEvidenceInput = {
      gate: capturedRun("hard-subset-control-gate", "bun test", GATE_OUTPUT_CLEAN),
      drive: null,
      e2e: null,
      required: ["gate"],
      projectRoot: root,
      branch,
    };

    const path = writeCapture(
      "hard-subset-control",
      report(
        reducedBody({ gate: [DEFAULT_GATE_LINE], drive: [...NONE], e2e: [...NONE] }),
      ),
    );
    const verdict = capture.verifyDeliverStageCapture(path, evidence);

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("CONTRAST: on the DEFAULT path the evidence layer refuses first — which is why the branch looked redundant", async () => {
    const mod = await loadEvidence();
    const root = rootWithBaseline("hard-contrast", branch, 16);

    // `required` OMITTED ⇒ all three owed. Same absent captures as case A, and
    // now the evidence layer speaks for every one of them. This is the path
    // every shipped cross-check leg takes, and it is exactly why silencing the
    // `derived === null` branch changed nothing in the shipped 59.
    const rendered = mod.renderStageEvidence({ projectRoot: root, branch });
    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.length).toBeGreaterThanOrEqual(EVIDENCE_ORDER.length);
    for (const section of EVIDENCE_ORDER) {
      expect(rendered.reasons.join("\n")).toContain(`\`${section}\``);
    }
  });
});

// ===========================================================================
// HARDENING ROUND 2 (scoped, post-GREEN) — three gaps an independent audit
// found in a suite that was already 67/67 GREEN. Each block below is RED
// against the tree as it stands, and each names the subject it is about.
//
// GAP 1 — AC.3's PRODUCER obligation never reached the operative surface.
//   `skills/deliver/SKILL.md` is the file whose kickoff-contract text is copied
//   into the task the WORKER receives. Its bullets state the banner, the eight
//   sections in fixed order, the line cap and the `- (none found)` fallback.
//   They never state that the counts must be DERIVED FROM CAPTURED COMMAND
//   OUTPUT. That obligation lives only in `docs/deliver-reference.md` — which
//   the skill itself files under "consult the reference when debugging a halted
//   run", i.e. NOT required reading — and even there only the `drive` and `e2e`
//   rows carry it. The `gate` row, the count that matters most, omits it: an
//   asymmetry inside a single table.
//
//   This is the exact defect class the repo has already recorded: M129's
//   headline finding was a routing rule that landed only in the not-required
//   reading. AC.3 says "no count is authored by the reporting worker" — and the
//   worker is never told. A producer obligation on a surface the producer does
//   not read is not an obligation.
//
// GAP 2 — the grading ENTRY POINT is fail-open and nothing obliges the caller
//   to close it. `verifyDeliverStageCapture(capturePath)` called WITHOUT the
//   optional `evidence` argument grades SHAPE ONLY: a fence carrying entirely
//   worker-typed counts returns `ok: true`. That mode is deliberate and
//   documented — a caller with no captures to offer must not have a verdict
//   about numbers invented on its behalf — but NO surface obliges the
//   orchestrator to pass evidence when grading a FULL-CEREMONY stage, so the
//   fail-open path is reachable in a real run, and the resulting `ok: true` is
//   byte-identical to an evidence-backed one.
//
//   Both halves are pinned. (a) the OPERATIVE surface states that a
//   full-ceremony stage's fence is graded WITH its captures and that a
//   shape-only grade is not a substitute for evidence; (b) the VERDICT itself
//   carries which mode it ran in, so a caller cannot mistake the fail-open
//   grade for a full one.
//
//   THE CONTRACT IS NOT WEAKENED. `graded` is ADDITIVE. `ok` stays boolean,
//   `reasons` stays the one channel every violation lands in, nothing throws,
//   and there is no second failure mode — AC.4's bounded-retry-then-halt path
//   reads exactly what it read before. The discriminator answers a different
//   question ("how thoroughly was this graded?"), never "did it pass?".
//
// GAP 3 — AC.6's cap guard has NO UPPER BOUND. The shipped "cap still binds"
//   leg pads a fence to `FENCE_LINE_CAP + 1`, so it stays green at ANY cap
//   value. Verified by mutation: raising the cap to 1000 killed exactly one
//   test in this file (the surface-drift comparison, which is about prose
//   agreement) and NOT the cap-binds leg. Raise the constant and the prose
//   together and the whole suite stays green — the cap can be neutered with
//   nothing noticing. A fence is a SUMMARY of what ran, not a transcript of it.
//
// CONTRACT NOTES FOR THE IMPLEMENTER — the shape these tests are written to.
//
//   `deliver_stage_capture.ts`:
//     * `DeliverStageCaptureVerdict` gains ONE additive field:
//         graded: "shape-only" | "evidence-backed"
//       `"evidence-backed"` iff the `evidence` argument was supplied (and the
//       cross-check therefore ran); `"shape-only"` otherwise — on EVERY return
//       path, the unreadable-capture early return included.
//     * An evidence section (`gate`/`drive`/`e2e`) carries EXACTLY ONE item.
//       Today `parseEvidenceLines` stops at a section's FIRST counts line
//       (`current = null`), so every line after it is invisible to the status
//       check AND to the cross-check: a worker can print a clean line and bury
//       `fail 3` underneath it, and the report grades clean. One run, one
//       counts line — or the single `- (none found)` fallback.
//
//   `skills/deliver/SKILL.md`:
//     * A kickoff-contract bullet (inside the block copied into the worker's
//       task text) stating the counts are DERIVED from CAPTURED command output
//       and never authored/typed from the worker's memory.
//     * A statement that a FULL-CEREMONY stage's fence is graded WITH its
//       captures, and that a SHAPE-ONLY grade is NOT A SUBSTITUTE for evidence.
//
//   `docs/deliver-reference.md`:
//     * All THREE evidence rows — `gate` included — state that the counts are
//       derived from captured output.
// ===========================================================================

/** The verdict shape after the additive discriminator lands. */
interface GradedVerdict extends CaptureVerdict {
  graded?: string;
}

/** The two grading modes, restated here rather than imported from the SUT. */
const GRADE_SHAPE_ONLY = "shape-only";
const GRADE_EVIDENCE_BACKED = "evidence-backed";

describe("HARDENING 2 — the producer obligation reaches the surface the producer reads", () => {
  function skillLines(): string[] {
    return read(DELIVER_SKILL).split("\n");
  }

  /**
   * The kickoff-contract bullet block — the text `/deliver` copies into the
   * kickoff task of every spawned worker. Located by its two shipped anchors so
   * a leg that reds because the region moved is loud rather than silent.
   */
  function kickoffBullets(): string[] {
    const lines = skillLines();
    const start = lines.findIndex((line) => line.includes("Kickoff task text."));
    const end = lines.findIndex((line) =>
      line.includes("The same kickoff text also names the milestone"),
    );
    if (start < 0 || end <= start) {
      throw new Error(
        `SKILL kickoff-contract block not locatable (start ${start}, end ${end}) — ` +
          "this guard is about that block and cannot grade prose it did not find",
      );
    }
    return lines.slice(start, end).filter((line) => /^\s*-\s+\*\*/.test(line));
  }

  test("GAP 1a — a KICKOFF bullet tells the worker the counts are derived from captured output", () => {
    const bullets = kickoffBullets();

    // ISOLATION HALF, through the same locator: the region really is the
    // kickoff-contract block. Without this a mis-located region would red the
    // leg for a reason that has nothing to do with the obligation.
    expect(`kickoff bullets found: ${bullets.length >= 4}`).toBe("kickoff bullets found: true");
    expect(`the located block is the contract block: ${bullets.some((b) => /line cap/i.test(b))}`).toBe(
      "the located block is the contract block: true",
    );

    const derivation = bullets.filter((b) => /deriv/i.test(b) && /captur/i.test(b));
    expect(
      `kickoff bullet stating counts are DERIVED from CAPTURED output: ${derivation.length > 0}`,
    ).toBe("kickoff bullet stating counts are DERIVED from CAPTURED output: true");

    // ...and it names what it forbids. "Derived from captured output" read
    // alone is advice; naming the worker-authored number is the prohibition.
    const forbids = /author|memory|invent|typed|made up/i.test(derivation.join("\n"));
    expect(`the same bullet forbids a worker-authored count: ${forbids}`).toBe(
      "the same bullet forbids a worker-authored count: true",
    );
  });

  test("GAP 1b — the reference field table states the derivation for ALL THREE evidence rows", () => {
    const ref = read(DELIVER_REFERENCE).split("\n");

    for (const section of EVIDENCE_ORDER) {
      const row = ref.find((line) => new RegExp(`^\\|\\s*\`${section}\`\\s*\\|`).test(line));
      expect(`${section} row present: ${row !== undefined}`).toBe(`${section} row present: true`);
      // `gate` is the asymmetric one today: `drive` and `e2e` say "derived from
      // its captured output", `gate` says only what the counts are.
      expect(`${section} row states DERIVED: ${/deriv/i.test(row!)}`).toBe(
        `${section} row states DERIVED: true`,
      );
      expect(`${section} row states CAPTURED: ${/captur/i.test(row!)}`).toBe(
        `${section} row states CAPTURED: true`,
      );
    }
  });

  test("GAP 2a — the operative surface obliges grading a full-ceremony fence WITH its captures", () => {
    const lines = skillLines();

    const gradedWithCaptures = lines.filter(
      (line) => /full[- ]ceremony/i.test(line) && /captur/i.test(line),
    );
    expect(
      `SKILL states a full-ceremony stage is graded with its captures: ${gradedWithCaptures.length > 0}`,
    ).toBe("SKILL states a full-ceremony stage is graded with its captures: true");

    const notASubstitute = lines.filter(
      (line) => /shape[- ]only/i.test(line) && /not a substitute/i.test(line),
    );
    expect(
      `SKILL states a shape-only grade is not a substitute for evidence: ${notASubstitute.length > 0}`,
    ).toBe("SKILL states a shape-only grade is not a substitute for evidence: true");
  });
});

describe("HARDENING 2 — a shape-only verdict is DISTINGUISHABLE from an evidence-backed one", () => {
  const branch = "feat/m132-evidence-ledger";

  /** Real captures behind the canonical fence body's default numbers. */
  function realCaptures(label: string, root: string): StageEvidenceInput {
    return {
      gate: capturedRun(`h2-gate-${label}`, "bun test", GATE_OUTPUT_CLEAN),
      drive: capturedRun(`h2-drive-${label}`, "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun(`h2-e2e-${label}`, "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch,
    };
  }

  test("GAP 2b — the SAME honest capture grades ok both ways, and the verdict says which mode ran", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("h2-modes", branch, 16);
    const capture = writeFenceCapture("h2-modes");

    const shapeOnly: GradedVerdict = verifyDeliverStageCapture(capture);
    const backed: GradedVerdict = verifyDeliverStageCapture(capture, realCaptures("modes", root));

    // The `{ ok, reasons }` contract AC.4 depends on is UNTOUCHED on both
    // paths: one verdict, no throw, no second failure mode.
    expect(shapeOnly.reasons).toEqual([]);
    expect(shapeOnly.ok).toBe(true);
    expect(backed.reasons).toEqual([]);
    expect(backed.ok).toBe(true);
    expect([...Object.keys(backed)].sort()).toEqual(["graded", "ok", "reasons"]);

    // THE POINT. Both are `ok: true` over the same bytes. Only the additive
    // discriminator separates a grade that read captures from a grade that read
    // nothing but the fence's own numbers.
    expect(shapeOnly.graded).toBe(GRADE_SHAPE_ONLY);
    expect(backed.graded).toBe(GRADE_EVIDENCE_BACKED);
    expect(shapeOnly.ok).toBe(backed.ok);
    expect(shapeOnly.graded).not.toBe(backed.graded);
  });

  test("GAP 2b — a fence of PURE INVENTION grades ok shape-only, and the verdict admits it", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const root = rootWithBaseline("h2-invented", branch, 16);

    // Numbers no command ever emitted: right sections, right order, under the
    // cap, every count present, `status: ok` beside `fail 0`.
    const capture = writeFenceCapture("h2-invented", {
      gate: ["  - pass 4242, fail 0, skip 7, baseline 7, delta 0"],
      drive: ["  - pass 99, fail 0, skip 0"],
      e2e: ["  - pass 5, fail 0, skip 0"],
    });

    const failOpen: GradedVerdict = verifyDeliverStageCapture(capture);
    // The fail-open grade is DELIBERATE and stays — refusing it would fail
    // every healthy shape-only call. What must change is that it says so.
    expect(failOpen.ok).toBe(true);
    expect(failOpen.graded).toBe(GRADE_SHAPE_ONLY);

    // ISOLATION HALF: the evidence-backed grade over the very same file is RED,
    // so `shape-only` is a real weaker mode and not a label on an equal grade.
    const backed: GradedVerdict = verifyDeliverStageCapture(capture, realCaptures("invented", root));
    expect(backed.ok).toBe(false);
    expect(backed.graded).toBe(GRADE_EVIDENCE_BACKED);
    expect(backed.reasons.length).toBeGreaterThan(0);
  });

  test("GAP 2b — EVERY return path carries the discriminator, the unreadable-capture one included", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const missing = join(tempDir("h2-missing"), "no-such-stage-report.txt");

    const verdict: GradedVerdict = verifyDeliverStageCapture(missing);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    // A discriminator that is `undefined` on the early return is a third state
    // a caller must handle — exactly the second failure mode this must not be.
    expect([GRADE_SHAPE_ONLY, GRADE_EVIDENCE_BACKED]).toContain(verdict.graded);
    expect(verdict.graded).toBe(GRADE_SHAPE_ONLY);
  });
});

describe("HARDENING 2 — the fence is a SUMMARY, not a transcript", () => {
  test("GAP 3a — an evidence section states ONE run's counts; a buried second line is REFUSED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();

    // CONTROL, through the same harness: one counts line per section is the
    // canonical fence and stays accepted. Without it a red mutant below is
    // indistinguishable from a harness that always fails.
    const control = verifyDeliverStageCapture(writeFenceCapture("h2-one-line"));
    expect(control.reasons).toEqual([]);
    expect(control.ok).toBe(true);

    // THE HOLE. `parseEvidenceLines` stops at a section's FIRST counts line, so
    // everything below it is invisible to `checkStatusAgainstCounts` AND to the
    // cross-check. A worker prints the clean line and buries the real one under
    // it: `fail 3` is sitting in the fence, `status: ok` is sitting above it,
    // and the report grades clean.
    const buried = verifyDeliverStageCapture(
      writeFenceCapture("h2-buried", {
        gate: [DEFAULT_GATE_LINE, "  - pass 8100, fail 3, skip 16, baseline 16, delta 0"],
      }),
    );
    expect(buried.ok).toBe(false);
    expect(buried.reasons.join("\n")).toMatch(/gate/);
  });

  test("GAP 3b — the cap sits in the band a hand-off summary needs, and it is not the only bound", async () => {
    const { FENCE_LINE_CAP, verifyDeliverStageCapture } = await loadCapture();

    // LOWER bound, COMPUTED rather than guessed: the richest HONEST fence must
    // fit. Five summary items (a five-FR milestone), one counts line per
    // evidence section, three follow-ups — 19 lines. A cap below that would
    // refuse a truthful report, which is worse than a loose one.
    const richest = fenceBody({
      summary: [
        "  - STE-506 deliver stage capture",
        "  - STE-507 gate count parsing",
        "  - STE-508 skip parsing",
        "  - STE-509 skip baseline",
        "  - STE-510 fence evidence",
      ],
      followUps: [
        "  - conformance leg deferred to the next run",
        "  - probe count pinned in seven test files",
        "  - reference table row order re-checked",
      ],
    });
    expect(FENCE_LINE_CAP).toBeGreaterThanOrEqual(richest.length);

    // UPPER bound, and the justification for the number. The fence is a
    // SUMMARY: 13 lines minimum, 19 for the richest honest hand-off above. 30
    // leaves eleven lines of slack over that and still refuses anything
    // transcript-shaped — a single failing bun test file alone prints more than
    // thirty lines of output. The shipped value is 26 and sits inside the band.
    // Without this clause the cap can be raised to any number at all and no
    // test in this file dies (measured: at 1000 only the prose-agreement leg
    // reds, and raising the prose with it turns the suite green again).
    expect(FENCE_LINE_CAP).toBeLessThanOrEqual(30);

    // AND the total cap is not the only bound that matters: six counts lines
    // under `gate:` is 18 fence lines — under the shipped cap, and under any
    // runaway one. Only a per-section rule refuses a section that pastes a
    // sequence of runs where one run's summary belongs.
    const transcript = fenceBody({
      gate: Array.from(
        { length: 6 },
        (_unused, i) => `  - pass ${8100 + i}, fail 0, skip 16, baseline 16, delta 0`,
      ),
    });
    expect(transcript.length).toBeLessThanOrEqual(FENCE_LINE_CAP);

    const verdict = verifyDeliverStageCapture(
      writeCapture("h2-transcript", report(transcript)),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/gate/);
  });
});

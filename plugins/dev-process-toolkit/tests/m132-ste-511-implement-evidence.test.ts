// M132 / STE-511 — "/implement carries the same evidence in its own report".
//
// THE DEFECT THIS SUITE EXISTS TO KILL, stated first because every shaping
// decision below follows from it.
//
// STE-510 made the `deliver-stage-result` fence's numbers machine-read. But the
// fence ONLY EXISTS when a stage runs underneath the `/deliver` orchestrator.
// Run `/implement` on its own — every single-FR run, every `/implement M<N>` the
// operator types by hand, which is at least as common as the orchestrated path —
// and the whole guarantee evaporates. It is a property of ONE INVOCATION PATH,
// not of the work. `/implement`'s step-14 report is the surface a human reads
// before approving the commit, and today it reports gate results in prose with
// no skip count and no drive evidence at all.
//
// THE TWO WAYS THIS FR CAN BE "DELIVERED" AND STILL BE WORTHLESS
//
//   1. TWO RENDERERS. The report grows its own count-formatting code that
//      happens to agree with the fence's today. Every per-path test passes
//      forever while the two implementations drift, and the day they drift the
//      two invocation paths disagree about whether the same work was green.
//      That is AC.2, and the FR names the tempting weak test explicitly: each
//      path checked against its OWN fixture. This file never does that. The
//      single-renderer legs compare THE TWO PATHS TO EACH OTHER from ONE input,
//      and back that with a real MUTATION of the shared renderer plus a
//      repo-wide structural sweep — because a copy-paste that agrees today
//      satisfies an output-equality test and only the sweep and the mutation
//      can see it.
//
//   2. AC.3 INFERRED FROM AC.1. "The report carries the rows" and "a standalone
//      run not under the orchestrator carries the rows" are DIFFERENT CLAIMS,
//      and only the second is the guarantee the operator asked for. So the AC.3
//      legs construct the standalone case explicitly — a report text with no
//      orchestrator prose and no fence anywhere in it — and additionally prove
//      the fence-path predicate REFUSES that same text, so the rows there
//      cannot have been inherited from the orchestrated path.
//
// M129's warning label still applies: all EIGHTEEN shipped ACs of the FR that
// introduced the fence were prose-greps of a skill's own SKILL.md, "which is
// precisely why a fence with no producer passed every one of them". The two
// surface legs in this file (SKILL.md step 14, and its sibling reference doc)
// are drift guards ONLY — M131 recorded surface-parity drift THREE TIMES in a
// single milestone — and they are not allowed to substitute for the legs whose
// subject is a real capture artifact.
//
// LEG-BY-LEG RATIONALE
//
//   AC.1  The report's rows are compared BYTE-FOR-BYTE against the fence's from
//         the same input, read back through the shipped `parseEvidenceLines`,
//         and checked for the fixed gate → drive → e2e order. Sections never
//         vanish: an input with no drive capture still renders a `drive:`
//         heading, exactly as the fence does.
//
//   AC.2  (a) five different inputs — including the UNUSUAL rows a copy is most
//         likely to get wrong: an unmeasured baseline, a `(none found)`
//         section, a pytest stack, a failing count — each compared path-to-path
//         rather than to a fixture. (b) a live MUTATION: the shared renderer's
//         row literal is rewritten in a throwaway copy of the source tree and
//         the report path's rows must carry the mutation, which proves the
//         routing is real at RUNTIME rather than merely agreeing today. The
//         mutation's application is itself asserted, because a mutation that
//         never applied reads as a pass. (c) a structural sweep: exactly ONE
//         non-test source in `adapters/` builds a counts row, and exactly one
//         calls each of the two derivation helpers outside their own homes.
//
//   AC.3  Asserted on its OWN path: a standalone report text, no orchestrator,
//         no fence — `findFences` finds none, the banner literal is absent, and
//         `verifyDeliverStageCapture` REFUSES the text — yet the three rows are
//         there with counts that trace to the captures. Plus the fail-closed
//         half: a standalone run missing a capture reports `ok: false` with a
//         named reason rather than a confident nothing.
//
//   AC.4  Round trip from captured bytes → renderer → report rows → counts
//         parsed back out, compared against counts derived INDEPENDENTLY by the
//         shipped parser (never against a fixture restating them), plus a
//         SENSITIVITY leg where changing the captured bytes must move every
//         reported number, plus the STE-509 baseline delta and bun-vs-pytest
//         stack correctness carried through this path.
//
// MODULE LOADING is dynamic and per-test on purpose: a static `import` of a
// not-yet-written module fails the WHOLE file at resolution time, collapsing
// four ACs into one opaque red. Every test touches the new module, so every one
// of them is RED before the implementation exists — including the structural
// sweep, which would otherwise pass vacuously today.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { findFences } from "../adapters/_shared/src/markdown_fences";
import { captureSkipBaseline } from "../adapters/_shared/src/skip_baseline";
import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

/** The module this FR adds — the report path's ONE entry point. */
const REPORT_MODULE = join(SHARED_SRC, "implement_report_evidence.ts");
/** The ONE renderer, shipped by STE-510. Both paths must route through it. */
const EVIDENCE_MODULE = join(SHARED_SRC, "deliver_stage_evidence.ts");
/** The fence-side consumer, used here only to REFUSE the standalone report. */
const CAPTURE_MODULE = join(SHARED_SRC, "deliver_stage_capture.ts");

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs", "implement-reference.md");

/** The three evidence sections, in THE fixed order — restated, never imported. */
const EVIDENCE_ORDER = ["gate", "drive", "e2e"] as const;

/** The fence banner. Restated so the AC.3 legs do not import their own subject. */
const FENCE_BANNER = "```deliver-stage-result";

// ---------------------------------------------------------------------------
// Shapes. Declared locally so this file compiles before the module exists.
// ---------------------------------------------------------------------------

type EvidenceSection = (typeof EVIDENCE_ORDER)[number];
type Stack = "bun" | "pytest" | "flutter" | "unknown";

interface EvidenceCounts {
  pass: number;
  fail: number;
  skip: number;
  baseline: number | null;
  delta: number | null;
}

interface CapturedRun {
  command: string;
  output: string;
  stack: Stack;
}

interface StageEvidenceInput {
  gate?: CapturedRun | null;
  drive?: CapturedRun | null;
  e2e?: CapturedRun | null;
  required?: readonly EvidenceSection[];
  projectRoot?: string;
  branch?: string;
}

interface RenderedStageEvidence {
  ok: boolean;
  lines: readonly string[];
  counts: Record<EvidenceSection, EvidenceCounts | null>;
  reasons: readonly string[];
}

/**
 * What the report path returns.
 *
 * `rows` is the load-bearing field: the evidence rows, BYTE-IDENTICAL to what
 * the fence path renders from the same input, because they are the same
 * renderer's output. `lines` is the step-14 section — the heading plus those
 * rows — which is what step 14 drops into the report a human reads.
 */
interface ImplementReportEvidence {
  ok: boolean;
  rows: readonly string[];
  lines: readonly string[];
  counts: Record<EvidenceSection, EvidenceCounts | null>;
  reasons: readonly string[];
}

interface ReportModule {
  IMPLEMENT_EVIDENCE_HEADING: string;
  renderImplementReportEvidence(input: StageEvidenceInput): ImplementReportEvidence;
}

interface EvidenceModule {
  renderStageEvidence(input: StageEvidenceInput): RenderedStageEvidence;
  parseEvidenceLines(
    lines: readonly string[],
  ): Record<EvidenceSection, EvidenceCounts | null>;
}

interface CaptureModule {
  DELIVER_STAGE_FENCE_BANNER: string;
  verifyDeliverStageCapture(
    capturePath: string,
    evidence?: StageEvidenceInput | null,
  ): { ok: boolean; reasons: readonly string[] };
}

async function loadReport(path: string = REPORT_MODULE): Promise<ReportModule> {
  return (await import(path)) as unknown as ReportModule;
}

async function loadEvidence(path: string = EVIDENCE_MODULE): Promise<EvidenceModule> {
  return (await import(path)) as unknown as EvidenceModule;
}

async function loadCapture(): Promise<CaptureModule> {
  return (await import(CAPTURE_MODULE)) as unknown as CaptureModule;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// CAPTURES — the bytes a runner really emitted. Every count asserted anywhere
// below traces back to one of these, and each is written to a real file and
// read back before it reaches the renderer, so the subject is an artifact
// rather than a string literal the test smuggled in through an argument.
// ---------------------------------------------------------------------------

/** A clean bun gate run: 8123 pass, 16 skip, 0 fail, 8139 total. */
const GATE_CLEAN = [
  "bun test v1.1.29",
  "",
  " 8123 pass",
  " 16 skip",
  " 0 fail",
  " 24519 expect() calls",
  "Ran 8139 tests across 214 files. [41.02s]",
].join("\n");

/** A DIFFERENT clean gate run — the AC.4 sensitivity leg's second capture. */
const GATE_SHIFTED = [
  "bun test v1.1.29",
  "",
  " 7001 pass",
  " 9 skip",
  " 0 fail",
  "Ran 7010 tests across 190 files. [33.71s]",
].join("\n");

/** The same gate run with FOUR MORE skips than the baseline — delta 4. */
const GATE_MORE_SKIPS = [
  "bun test v1.1.29",
  "",
  " 8119 pass",
  " 20 skip",
  " 0 fail",
  "Ran 8139 tests across 214 files. [41.44s]",
].join("\n");

/** A gate run with three real failures. */
const GATE_FAILING = [
  "bun test v1.1.29",
  "",
  " 8100 pass",
  " 16 skip",
  " 3 fail",
  "Ran 8119 tests across 214 files. [40.11s]",
].join("\n");

const DRIVE_OUTPUT = [
  "bun test v1.1.29",
  "",
  " 12 pass",
  " 0 skip",
  " 0 fail",
  "Ran 12 tests across 3 files. [1.20s]",
].join("\n");

/** A SECOND drive run — the sensitivity leg needs every number to move. */
const DRIVE_SHIFTED = [
  "bun test v1.1.29",
  "",
  " 5 pass",
  " 0 skip",
  " 0 fail",
  "Ran 5 tests across 2 files. [0.80s]",
].join("\n");

const E2E_OUTPUT = [
  "bun test v1.1.29",
  "",
  " 3 pass",
  " 0 skip",
  " 0 fail",
  "Ran 3 tests across 1 files. [4.90s]",
].join("\n");

/** A SECOND e2e run. */
const E2E_SHIFTED = [
  "bun test v1.1.29",
  "",
  " 7 pass",
  " 0 skip",
  " 0 fail",
  "Ran 7 tests across 2 files. [6.10s]",
].join("\n");

/** pytest: `N passed` EXCLUDES skips, unlike bun's `Ran N tests`. */
const PYTEST_OUTPUT = [
  "============================= test session starts =============================",
  "collected 20 items",
  "",
  "======================== 17 passed, 3 skipped in 2.41s ========================",
].join("\n");

const BRANCH = "feat/m132-evidence-ledger";

const TEMP_ROOTS: string[] = [];

afterAll(() => {
  for (const dir of TEMP_ROOTS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste511-${label}-`));
  TEMP_ROOTS.push(dir);
  return dir;
}

/** Write captured output to a real file and read it BACK before using it. */
function capturedRun(
  label: string,
  command: string,
  output: string,
  stack: Stack = "bun",
): CapturedRun {
  const file = join(tempDir(`capture-${label}`), `${label}.txt`);
  writeFileSync(file, output, "utf-8");
  return { command, output: read(file), stack };
}

/**
 * Counts derived INDEPENDENTLY of anything under test, through the shipped
 * parser. The round-trip legs compare the report's numbers against these — not
 * against a fixture that merely restates them.
 */
function independentCounts(
  output: string,
  stack: Stack,
): { pass: number; fail: number; skip: number } {
  const parsed = parseTestOutput(output, stack);
  if (!parsed.ok) throw new Error(`fixture capture is unparseable: ${parsed.reason}`);
  const { total, failures, errors, skipped } = parsed.count;
  const fail = failures + errors;
  // bun's `Ran N tests` counts skipped tests; pytest's `N passed` does not.
  const pass = stack === "bun" ? total - fail - skipped : total - fail;
  return { pass, fail, skip: skipped };
}

/** A temp project root carrying a captured STE-509 skip baseline. */
function rootWithBaseline(label: string, skipped: number, branch = BRANCH): string {
  const root = tempDir(`root-${label}`);
  captureSkipBaseline(root, branch, skipped);
  return root;
}

/** The canonical healthy input: three real captures and a measured baseline. */
function healthyInput(label: string): StageEvidenceInput {
  return {
    gate: capturedRun(`gate-${label}`, "bun test", GATE_CLEAN),
    drive: capturedRun(`drive-${label}`, "bun run drive", DRIVE_OUTPUT),
    e2e: capturedRun(`e2e-${label}`, "bun run e2e", E2E_OUTPUT),
    projectRoot: rootWithBaseline(label, 16),
    branch: BRANCH,
  };
}

/** Every non-test TypeScript source under `adapters/` — the sweep's universe. */
function adapterSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      out.push(full);
    }
  };
  walk(join(PLUGIN_ROOT, "adapters"));
  return out;
}

/** Sources containing `needle`, as plugin-root-relative paths, sorted. */
function sourcesContaining(needle: string): string[] {
  return adapterSources()
    .filter((file) => read(file).includes(needle))
    .map((file) => relative(PLUGIN_ROOT, file))
    .sort();
}

/** The single line of `skills/implement/SKILL.md` that IS the step-14 report. */
function stepFourteenLine(): string {
  const hit = read(IMPLEMENT_SKILL)
    .split("\n")
    .find((line) => /^14\.\s+\*\*Report\*\*/.test(line));
  if (hit === undefined) throw new Error("skills/implement/SKILL.md has no step-14 report line");
  return hit;
}

// ===========================================================================
// AC-STE-511.1 — the step-14 report carries the same gate, drive and e2e rows
// as the fence.
// ===========================================================================

describe("AC-STE-511.1 — the report carries the same gate, drive and e2e rows as the fence", () => {
  test("the report's rows are BYTE-IDENTICAL to the fence's, from one input", async () => {
    const input = healthyInput("ac1-identical");
    const report = (await loadReport()).renderImplementReportEvidence(input);
    const fence = (await loadEvidence()).renderStageEvidence(input);

    // Compared to EACH OTHER, not each to its own fixture. Two renderers that
    // agree today pass a per-path fixture test forever; they cannot pass this
    // one the moment they drift by a single byte.
    expect([...report.rows]).toEqual([...fence.lines]);
  });

  test("all three sections are present, in THE fixed gate → drive → e2e order", async () => {
    const report = (await loadReport()).renderImplementReportEvidence(
      healthyInput("ac1-order"),
    );

    const headings = report.rows
      // `[a-z0-9_]`, not `[a-z_]`: the shipped `e2e:` heading carries a DIGIT,
      // so the narrower class could never see it and this leg could only ever
      // read two of the three headings it asserts. The shipped HEADING_RE
      // (`[A-Za-z_][A-Za-z0-9_]*`) allows digits; this local filter must agree.
      .filter((line) => /^[a-z0-9_]+:\s*$/.test(line))
      .map((line) => line.replace(":", "").trim());
    expect(headings).toEqual([...EVIDENCE_ORDER]);
  });

  test("the rows read back through the SHIPPED parser with counts in every section", async () => {
    const report = (await loadReport()).renderImplementReportEvidence(
      healthyInput("ac1-readback"),
    );
    const readBack = (await loadEvidence()).parseEvidenceLines(report.rows);

    for (const section of EVIDENCE_ORDER) {
      expect(readBack[section]).not.toBeNull();
    }
    expect(readBack.gate!.skip).toBe(16);
    expect(readBack.drive!.pass).toBe(12);
    expect(readBack.e2e!.pass).toBe(3);
  });

  test("the step-14 SECTION is the exported heading followed by exactly those rows", async () => {
    const mod = await loadReport();
    const report = mod.renderImplementReportEvidence(healthyInput("ac1-section"));

    expect(mod.IMPLEMENT_EVIDENCE_HEADING.startsWith("## ")).toBe(true);
    expect([...report.lines]).toEqual([mod.IMPLEMENT_EVIDENCE_HEADING, ...report.rows]);
  });

  test("SECTIONS NEVER VANISH: no drive capture still renders a drive row, same as the fence", async () => {
    const input: StageEvidenceInput = {
      gate: capturedRun("gate-ac1-novanish", "bun test", GATE_CLEAN),
      drive: null,
      e2e: capturedRun("e2e-ac1-novanish", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("ac1-novanish", 16),
      branch: BRANCH,
    };
    const report = (await loadReport()).renderImplementReportEvidence(input);
    const fence = (await loadEvidence()).renderStageEvidence(input);

    expect(report.rows).toContain("drive:");
    expect(report.rows.some((line) => line.includes("(none found)"))).toBe(true);
    expect([...report.rows]).toEqual([...fence.lines]);
  });

  test("SURFACE: step 14 names all three rows and the module that renders them", async () => {
    const mod = await loadReport();
    const step14 = stepFourteenLine();

    for (const section of EVIDENCE_ORDER) {
      expect(step14).toContain(section);
    }
    // Cited by MECHANISM — the module's filename, not a ticket id: the skills
    // tree's STE-token ceiling is at zero headroom.
    expect(step14).toContain("implement_report_evidence");
    expect(step14).toContain(mod.IMPLEMENT_EVIDENCE_HEADING);
  });
});

// ===========================================================================
// AC-STE-511.2 — ONE renderer. There is no second implementation of the same
// rendering. The whole risk is drift, so no leg here compares a path to its own
// fixture.
// ===========================================================================

describe("AC-STE-511.2 — both paths render from one renderer, compared to each other", () => {
  const cases: ReadonlyArray<readonly [string, (label: string) => StageEvidenceInput]> = [
    ["healthy", (label) => healthyInput(label)],
    [
      "unmeasured baseline — no project root, so the gate row says so in words",
      (label) => ({
        gate: capturedRun(`gate-${label}`, "bun test", GATE_CLEAN),
        drive: capturedRun(`drive-${label}`, "bun run drive", DRIVE_OUTPUT),
        e2e: capturedRun(`e2e-${label}`, "bun run e2e", E2E_OUTPUT),
      }),
    ],
    [
      "a (none found) section — the reduced-chain shape",
      (label) => ({
        gate: capturedRun(`gate-${label}`, "bun test", GATE_CLEAN),
        drive: null,
        e2e: null,
        required: ["gate"],
        projectRoot: rootWithBaseline(label, 16),
        branch: BRANCH,
      }),
    ],
    [
      "a pytest stack — a different count formula entirely",
      (label) => ({
        gate: capturedRun(`gate-${label}`, "pytest", PYTEST_OUTPUT, "pytest"),
        drive: capturedRun(`drive-${label}`, "bun run drive", DRIVE_OUTPUT),
        e2e: capturedRun(`e2e-${label}`, "bun run e2e", E2E_OUTPUT),
        projectRoot: rootWithBaseline(label, 3),
        branch: BRANCH,
      }),
    ],
    [
      "a failing gate — refusal grounds, not just counts",
      (label) => ({
        gate: capturedRun(`gate-${label}`, "bun test", GATE_FAILING),
        drive: capturedRun(`drive-${label}`, "bun run drive", DRIVE_OUTPUT),
        e2e: capturedRun(`e2e-${label}`, "bun run e2e", E2E_OUTPUT),
        projectRoot: rootWithBaseline(label, 16),
        branch: BRANCH,
      }),
    ],
  ];

  for (const [name, build] of cases) {
    test(`SAME INPUT, DIRECT COMPARISON — ${name}`, async () => {
      const input = build(`ac2-${name.slice(0, 12).replace(/\W+/g, "")}`);
      const report = (await loadReport()).renderImplementReportEvidence(input);
      const fence = (await loadEvidence()).renderStageEvidence(input);

      expect([...report.rows]).toEqual([...fence.lines]);
      expect(report.ok).toBe(fence.ok);
      expect([...report.reasons]).toEqual([...fence.reasons]);
      expect(report.counts).toEqual(fence.counts);
    });
  }

  test("MUTATION: rewrite the shared renderer's row literal and the REPORT path carries it", async () => {
    // A copy-paste renderer that agrees today survives every equality leg
    // above. It cannot survive this one: the mutation lands in ONE file, and
    // the report path must reproduce it because it genuinely calls that code.
    const copyRoot = tempDir("mutation");
    const copySrc = join(copyRoot, "src");
    cpSync(SHARED_SRC, copySrc, { recursive: true });

    const evidencePath = join(copySrc, "deliver_stage_evidence.ts");
    const original = read(evidencePath);
    const anchor = "  - pass ${counts.pass}";
    const marker = "MUT511";

    // A mutation that never applied reads as a pass. Assert the anchor is
    // present exactly once BEFORE relying on the rewrite.
    expect(original.split(anchor).length - 1).toBe(1);
    writeFileSync(evidencePath, original.replace(anchor, `  - ${marker} pass \${counts.pass}`), "utf-8");

    const input = healthyInput("ac2-mutation");

    // The mutation is LIVE: the fence path out of the copy carries it.
    const mutatedFence = await loadEvidence(evidencePath);
    expect(mutatedFence.renderStageEvidence(input).lines.join("\n")).toContain(marker);

    // And so does the report path out of the same copy — the claim under test.
    //
    // COUNTED, not joined. A `toContain` over the joined rows is satisfied by the
    // marker appearing ONCE, which a PARTIAL second renderer exploits: delegate
    // the `gate:` row so the marker still shows up, then rebuild `drive:` and
    // `e2e:` by hand. That impostor delegates enough to pass every structural
    // sweep and every direct-comparison leg, so this count is the only thing
    // standing between the shipped module and a renderer that has half drifted.
    // All three counts rows must carry the marker, or something else built them.
    const mutatedReport = await loadReport(join(copySrc, "implement_report_evidence.ts"));
    const mutatedRows = mutatedReport.renderImplementReportEvidence(input).rows;
    expect(mutatedRows.filter((line) => line.includes(marker)).length).toBe(3);

    // The real, unmutated tree is untouched — the marker is the copy's alone.
    expect(read(EVIDENCE_MODULE)).not.toContain(marker);
    expect((await loadReport()).renderImplementReportEvidence(input).rows.join("\n")).not.toContain(
      marker,
    );
  });

  test("STRUCTURAL: exactly ONE source builds a counts row, and it is not the report module", async () => {
    // Loading the report module first is deliberate: without it this sweep
    // would pass vacuously before the FR is implemented at all.
    await loadReport();

    expect(sourcesContaining("  - pass ${")).toEqual([
      "adapters/_shared/src/deliver_stage_evidence.ts",
    ]);
  });

  test("STRUCTURAL: the derivation helpers are called from ONE place outside their homes", async () => {
    await loadReport();

    const homes = new Set([
      "adapters/_shared/src/test_count_parser.ts",
      "adapters/_shared/src/skip_baseline.ts",
    ]);
    const callers = (needle: string): string[] =>
      sourcesContaining(needle).filter((file) => !homes.has(file));

    expect(callers("parseTestOutput(")).toEqual([
      "adapters/_shared/src/deliver_stage_evidence.ts",
    ]);
    expect(callers("evaluateSkipDelta(")).toEqual([
      "adapters/_shared/src/deliver_stage_evidence.ts",
    ]);
  });

  test("STRUCTURAL: the report module DELEGATES — it imports the renderer and re-derives nothing", async () => {
    await loadReport();
    const source = read(REPORT_MODULE);

    expect(source).toContain('from "./deliver_stage_evidence"');
    // Called by BARE NAME, so an override of the renderer is genuinely wired
    // through — the STE-509 house idiom the mutation leg above depends on.
    expect(source).toContain("renderStageEvidence(");

    // No second derivation, and no second row shape, anywhere in this module.
    expect(source).not.toContain("parseTestOutput(");
    expect(source).not.toContain("evaluateSkipDelta(");
    expect(source).not.toContain("  - pass ${");
  });
});

// ===========================================================================
// AC-STE-511.3 — a standalone run not under the orchestrator is covered by the
// same guarantee, ASSERTED DIRECTLY. Never inferred from AC.1.
// ===========================================================================

describe("AC-STE-511.3 — a standalone run, no orchestrator and no fence, still carries the rows", () => {
  /** A whole step-14 report for a hand-typed `/implement` run. No fence. */
  async function standaloneReport(label: string): Promise<{
    text: string;
    path: string;
    rendered: ImplementReportEvidence;
  }> {
    const mod = await loadReport();
    const rendered = mod.renderImplementReportEvidence(healthyInput(label));
    const text = [
      "/implement STE-511 — report",
      "",
      "## Acceptance criteria",
      "- AC-STE-511.1 — pass",
      "",
      ...rendered.lines,
      "",
      "## Advisory notes",
      "No advisory notes.",
      "",
    ].join("\n");
    const path = join(tempDir(`standalone-${label}`), "implement-report.txt");
    writeFileSync(path, text, "utf-8");
    return { text: read(path), path, rendered };
  }

  test("there is NO fence anywhere in the standalone report", async () => {
    const { text } = await standaloneReport("ac3-nofence");

    expect(text).not.toContain(FENCE_BANNER);
    expect(text).not.toContain("deliver-stage-result");
    expect(findFences(text, /^```deliver-stage-result\s*$/)).toEqual([]);
  });

  test("the FENCE-path predicate REFUSES the standalone report — the paths are distinct", async () => {
    // This is what makes the next leg a real claim rather than a restatement of
    // AC.1: the rows below cannot have been inherited from the orchestrated
    // path, because the orchestrated path's own checker rejects this text.
    const { path } = await standaloneReport("ac3-refused");
    const verdict = (await loadCapture()).verifyDeliverStageCapture(path);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  test("the three rows are present in the standalone report, with counts tracing to the captures", async () => {
    const { text, rendered } = await standaloneReport("ac3-rows");
    const lines = text.split("\n");

    for (const section of EVIDENCE_ORDER) {
      expect(lines).toContain(`${section}:`);
    }

    const readBack = (await loadEvidence()).parseEvidenceLines(lines);
    expect({ ...readBack.gate!, baseline: null, delta: null }).toEqual({
      ...independentCounts(GATE_CLEAN, "bun"),
      baseline: null,
      delta: null,
    });
    expect({ pass: readBack.drive!.pass, fail: readBack.drive!.fail, skip: readBack.drive!.skip }).toEqual(
      independentCounts(DRIVE_OUTPUT, "bun"),
    );
    expect({ pass: readBack.e2e!.pass, fail: readBack.e2e!.fail, skip: readBack.e2e!.skip }).toEqual(
      independentCounts(E2E_OUTPUT, "bun"),
    );
    expect(rendered.ok).toBe(true);
  });

  test("the renderer takes NO orchestrator context — one argument, and captures are all of it", async () => {
    const mod = await loadReport();

    // A second parameter carrying a stage, a milestone or a fence would make
    // the guarantee conditional on the orchestrated path all over again.
    expect(mod.renderImplementReportEvidence.length).toBe(1);
    expect(mod.renderImplementReportEvidence(healthyInput("ac3-arity")).ok).toBe(true);
  });

  test("FAIL-CLOSED: a standalone run missing a capture refuses, naming the section", async () => {
    const mod = await loadReport();
    // The required set is DECLARATION-derived (M132 HIGH 3): demanding a drive
    // capture from a project that never said it can be driven false-REDs a
    // healthy run. So the project here DECLARES both commands — which is
    // exactly when a missing capture is a real refusal, and the property this
    // leg has always been about. A project declaring `run_cmd: none` is a
    // different case, pinned in `m132-cross-fr-hardening.test.ts`.
    const root = rootWithBaseline("ac3-failclosed", 16);
    writeFileSync(
      join(root, "CLAUDE.md"),
      "# Temp Project\n\n## Verification\n\nrun_cmd: bun run drive\ne2e_cmd: bun run e2e\n",
      "utf-8",
    );
    const rendered = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac3-failclosed", "bun test", GATE_CLEAN),
      drive: null,
      e2e: null,
      projectRoot: root,
      branch: BRANCH,
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("drive");
    expect(rendered.reasons.join("\n")).toContain("e2e");
    // A confident nothing is the failure mode: the rows must still be there.
    expect(rendered.rows).toContain("drive:");
    expect(rendered.rows).toContain("e2e:");
  });

  test("SURFACE PARITY: the sibling reference doc carries the same step-14 obligation", async () => {
    // M131 recorded surface-parity drift THREE TIMES in one milestone, and the
    // reference doc already carries a step-14 counterpart for advisory notes.
    const mod = await loadReport();
    const reference = read(IMPLEMENT_REFERENCE);

    expect(reference).toContain("implement_report_evidence");
    expect(reference).toContain(mod.IMPLEMENT_EVIDENCE_HEADING);
    for (const section of EVIDENCE_ORDER) {
      expect(reference).toContain(section);
    }
  });
});

// ===========================================================================
// AC-STE-511.4 — counts are machine-derived on THIS path too, to the same
// standard the fence path is held to.
// ===========================================================================

describe("AC-STE-511.4 — the report's numbers are derived from the captures, never authored", () => {
  test("ROUND TRIP: report rows → parsed counts equal counts derived INDEPENDENTLY", async () => {
    const report = (await loadReport()).renderImplementReportEvidence(
      healthyInput("ac4-roundtrip"),
    );
    const readBack = (await loadEvidence()).parseEvidenceLines(report.rows);

    for (const [section, output] of [
      ["gate", GATE_CLEAN],
      ["drive", DRIVE_OUTPUT],
      ["e2e", E2E_OUTPUT],
    ] as const) {
      const got = readBack[section];
      expect(got).not.toBeNull();
      expect({ pass: got!.pass, fail: got!.fail, skip: got!.skip }).toEqual(
        independentCounts(output, "bun"),
      );
    }
  });

  test("SENSITIVITY: change the captured bytes and EVERY reported number moves", async () => {
    const mod = await loadReport();
    const evidence = await loadEvidence();
    const root = rootWithBaseline("ac4-sensitivity", 16);

    const first = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac4-a", "bun test", GATE_CLEAN),
      drive: capturedRun("drive-ac4-a", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-ac4-a", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch: BRANCH,
    });
    const second = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac4-b", "bun test", GATE_SHIFTED),
      drive: capturedRun("drive-ac4-b", "bun run drive", DRIVE_SHIFTED),
      e2e: capturedRun("e2e-ac4-b", "bun run e2e", E2E_SHIFTED),
      projectRoot: root,
      branch: BRANCH,
    });

    const a = evidence.parseEvidenceLines(first.rows);
    const b = evidence.parseEvidenceLines(second.rows);

    // Authored constants survive the round trip above. Nothing changed here
    // except the bytes, so every one of these must have moved with them.
    expect(a.gate!.pass).toBe(8123);
    expect(b.gate!.pass).toBe(7001);
    expect(a.gate!.skip).toBe(16);
    expect(b.gate!.skip).toBe(9);
    expect(a.gate!.delta).toBe(0);
    expect(b.gate!.delta).toBe(-7);
    expect(a.drive!.pass).toBe(12);
    expect(b.drive!.pass).toBe(5);
    expect(a.e2e!.pass).toBe(3);
    expect(b.e2e!.pass).toBe(7);
    expect([...second.rows]).not.toEqual([...first.rows]);
  });

  test("the STE-509 baseline delta reaches this path: 4 new skips is a reported refusal", async () => {
    const mod = await loadReport();
    const rendered = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac4-delta", "bun test", GATE_MORE_SKIPS),
      drive: capturedRun("drive-ac4-delta", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-ac4-delta", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("ac4-delta", 16),
      branch: BRANCH,
    });
    const readBack = (await loadEvidence()).parseEvidenceLines(rendered.rows);

    expect(readBack.gate!.baseline).toBe(16);
    expect(readBack.gate!.delta).toBe(4);
    expect(rendered.ok).toBe(false);
  });

  test("an UNMEASURED baseline says so in words on this path — never a silent zero", async () => {
    const mod = await loadReport();
    const rendered = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac4-unmeasured", "bun test", GATE_CLEAN),
      drive: capturedRun("drive-ac4-unmeasured", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-ac4-unmeasured", "bun run e2e", E2E_OUTPUT),
    });

    expect(rendered.rows.join("\n")).toContain("baseline unmeasured");
    expect(rendered.ok).toBe(false);
    const readBack = (await loadEvidence()).parseEvidenceLines(rendered.rows);
    expect(readBack.gate!.delta).toBeNull();
  });

  test("STACK-CORRECT on this path: pytest `N passed` excludes skips", async () => {
    const mod = await loadReport();
    const rendered = mod.renderImplementReportEvidence({
      gate: capturedRun("gate-ac4-pytest", "pytest", PYTEST_OUTPUT, "pytest"),
      drive: capturedRun("drive-ac4-pytest", "bun run drive", DRIVE_OUTPUT),
      e2e: capturedRun("e2e-ac4-pytest", "bun run e2e", E2E_OUTPUT),
      projectRoot: rootWithBaseline("ac4-pytest", 3),
      branch: BRANCH,
    });
    const readBack = (await loadEvidence()).parseEvidenceLines(rendered.rows);

    expect(independentCounts(PYTEST_OUTPUT, "pytest")).toEqual({ pass: 17, fail: 0, skip: 3 });
    expect(readBack.gate!.pass).toBe(17);
    expect(readBack.gate!.skip).toBe(3);
  });
});

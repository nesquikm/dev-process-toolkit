// M132 — cross-FR hardening round.
//
// WHY THIS FILE EXISTS, stated first because it shapes every leg below.
//
// Five per-FR `/tdd` audits ran against M132 and all five came back clean; the
// gate stands at 9304 pass / 15 skip / 0 fail. A cross-FR `/spec-review` then
// found three HIGH defects that NONE of the five could structurally have seen,
// because every one of them lives in the SEAM between two FRs' surfaces:
//
//   HIGH 1  STE-509 ships a write-once skip baseline that NOTHING ever writes.
//           `captureSkipBaseline` has zero callers outside test helpers, and no
//           shipped prose says when a baseline is captured. That is not inert:
//           STE-510's renderer makes an unmeasured baseline a REFUSAL GROUND,
//           so the ratchet is permanently unmeasured AND permanently refusing.
//
//   HIGH 2  STE-510's two newest guards — `checkEvidenceCounts` and
//           `checkEvidenceCardinality` — read their items through a regex
//           requiring LEADING WHITESPACE, while the sibling parser and the
//           sibling empty-item regex do not. A counts line at COLUMN 0 is
//           invisible to both. Every existing fixture indents, which is exactly
//           why the whole suite is green.
//
//   HIGH 3  STE-511's step-14 evidence defaults `required` to all three
//           sections. But `/implement`'s vacuity is DECLARATION-based: a
//           project that declares `run_cmd: none` and no `e2e_cmd` has
//           legitimately said those commands do not exist. On THIS repo, which
//           declares exactly that, a standalone step-14 block renders ok:FALSE
//           with drive and e2e refusals for commands the project told us it
//           does not have. A guard that false-REDs a healthy run.
//
// Plus two MEDIUMs, both documentation-integrity: `docs/layout-reference.md`
// carries a FALSE claim (not merely a stale one) about the `.dpt/` tree, and an
// NFR-1 citation was DELETED rather than satisfied.
//
// THE SUBJECT DISCIPLINE. Where a defect is behavioural, the subject of the
// assertion is the shipped module executed against a real artifact — never a
// document that describes it. Where a defect is that a rule landed on one
// surface and not its sibling (M131 recorded that failure THREE times in one
// milestone), the subject is legitimately the documents, because a document is
// what is wrong. Each block below says which it is and why.
//
// FALSIFIABILITY. Every negative leg is paired with a positive one on the same
// machinery: the column-0 legs are paired with indented forms that must STILL
// PASS, so an over-strict fix that rejects healthy fences dies here too; the
// declaration-vacuity legs are paired with a project that DOES declare its
// commands and must still refuse when their captures are missing. Half a test
// is a test that cannot fail in the direction that matters.
//
// NUMBERS ARE READ, NEVER RESTATED. The NFR-1 cap comes from
// `specs/requirements.md`; the gitignore rules come from `DPT_GITIGNORE_BODY`;
// the `.dpt` path composers come from `dpt_paths.ts`'s own exports. A literal
// restated here would drift from the requirement the moment the requirement
// moved, which is the MEDIUM-2 defect wearing a test's clothes.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repoWithBaseline } from "./_skip_baseline_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const CAPTURE_MODULE = join(SRC_DIR, "deliver_stage_capture.ts");
const EVIDENCE_MODULE = join(SRC_DIR, "deliver_stage_evidence.ts");
const REPORT_MODULE = join(SRC_DIR, "implement_report_evidence.ts");
const SKIP_BASELINE_MODULE = join(SRC_DIR, "skip_baseline.ts");
const DPT_PATHS_MODULE = join(SRC_DIR, "dpt_paths.ts");
const DPT_GITIGNORE_MODULE = join(SRC_DIR, "setup", "dpt_gitignore.ts");

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs", "implement-reference.md");
const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const LAYOUT_REFERENCE = join(PLUGIN_ROOT, "docs", "layout-reference.md");
const REQUIREMENTS = join(REPO_ROOT, "specs", "requirements.md");

const GENUINE_FIXTURE = join(
  import.meta.dir,
  "fixtures",
  "deliver-stage-capture",
  "worker-stage-report.txt",
);

// ---------------------------------------------------------------------------
// Shapes, declared locally so this file compiles before the new export exists.
// A static `import` of a not-yet-written module fails the WHOLE file at
// resolution time, collapsing five findings into one opaque red; every module
// below is therefore loaded dynamically, per test.
// ---------------------------------------------------------------------------

type EvidenceSection = "gate" | "drive" | "e2e";

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

interface RenderedStageEvidence {
  ok: boolean;
  lines: readonly string[];
  reasons: readonly string[];
}

interface ImplementReportEvidence {
  ok: boolean;
  rows: readonly string[];
  lines: readonly string[];
  reasons: readonly string[];
}

interface CaptureVerdict {
  ok: boolean;
  reasons: readonly string[];
}

async function loadCapture(): Promise<{
  verifyDeliverStageCapture(path: string, evidence?: StageEvidenceInput | null): CaptureVerdict;
}> {
  return (await import(CAPTURE_MODULE)) as never;
}

async function loadEvidence(): Promise<{
  renderStageEvidence(input: StageEvidenceInput): RenderedStageEvidence;
}> {
  return (await import(EVIDENCE_MODULE)) as never;
}

async function loadReport(): Promise<{
  renderImplementReportEvidence(input: StageEvidenceInput): ImplementReportEvidence;
}> {
  return (await import(REPORT_MODULE)) as never;
}

async function loadSkipBaseline(): Promise<{
  captureSkipBaseline(root: string, sha: string, skipped: number): { written: boolean };
}> {
  return (await import(SKIP_BASELINE_MODULE)) as never;
}

/**
 * Find the shipped module that exports `requiredEvidenceSections`, by SCANNING
 * rather than by pinning a path.
 *
 * The NAME is load-bearing — the legs below call the function — but the file it
 * lives in is an implementation decision, and a test that pinned the path would
 * fail on a legal refactor while proving nothing extra. Returns the absolute
 * path, or `null` when no module exports it at all (which is itself the RED
 * this discovery reports).
 */
function findRequiredSectionsModule(): string | null {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      if (/export\s+function\s+requiredEvidenceSections\b/.test(readFileSync(path, "utf-8"))) {
        hits.push(path);
      }
    }
  };
  walk(SRC_DIR);
  // More than one home is itself a defect — two composers of one rule agree
  // right up until one of them moves — so a second hit reports as no canonical
  // home rather than as an arbitrary pick.
  return hits.length === 1 ? hits[0]! : null;
}

async function loadRequiredSections(): Promise<{
  path: string;
  requiredEvidenceSections(claudeMdPath: string): readonly EvidenceSection[];
}> {
  const path = findRequiredSectionsModule();
  if (path === null) {
    throw new Error(
      "no shipped module under adapters/_shared/src exports exactly one " +
        "`requiredEvidenceSections` — the declaration-derived required set has no home",
    );
  }
  const mod = (await import(path)) as {
    requiredEvidenceSections(claudeMdPath: string): readonly EvidenceSection[];
  };
  return { path, requiredEvidenceSections: mod.requiredEvidenceSections };
}

// ---------------------------------------------------------------------------
// Temp roots + capture builders.
// ---------------------------------------------------------------------------

const TEMP_ROOTS: string[] = [];

afterAll(() => {
  for (const dir of TEMP_ROOTS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `m132x-${label}-`));
  TEMP_ROOTS.push(dir);
  return dir;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/** A clean bun gate run: 9289 pass, 15 skip, 0 fail — this repo's real shape. */
const GATE_CLEAN = [
  "bun test v1.1.29",
  "",
  " 9289 pass",
  " 15 skip",
  " 0 fail",
  " 27412 expect() calls",
  "Ran 9304 tests across 214 files. [41.02s]",
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

/**
 * Write captured output to a real file and read it BACK before handing it over.
 * The round trip through disk is the point: the numbers must trace to bytes
 * something emitted, and an in-memory literal never leaves the test's hands.
 */
function capturedRun(label: string, command: string, output: string): CapturedRun {
  const file = join(tempDir(`capture-${label}`), `${label}.txt`);
  writeFileSync(file, output, "utf-8");
  return { command, output: read(file), stack: "bun" };
}

const BRANCH = "feat/m132-evidence-ledger";

/**
 * A project root carrying a captured skip baseline.
 *
 * A real git repository since M136 / STE-527 re-keyed the store to the trunk
 * commit and gave capture its HEAD + clean-tree preconditions.
 */
async function rootWithBaseline(label: string, skipped: number): Promise<string> {
  const mod = await loadSkipBaseline();
  return repoWithBaseline(mod, `crossfr-${label}`, skipped, BRANCH).root;
}

/** A temp project root carrying a baseline AND a `## Verification` declaration. */
async function rootDeclaring(
  label: string,
  verificationBlock: string | null,
  skipped = 15,
): Promise<string> {
  const root = await rootWithBaseline(label, skipped);
  const body =
    verificationBlock === null
      ? "# Temp Project\n\nNo verification block at all.\n"
      : `# Temp Project\n\n## Verification\n\n${verificationBlock}\n`;
  writeFileSync(join(root, "CLAUDE.md"), body, "utf-8");
  return root;
}

const PROSE = [
  "/implement M132 — worker stage report",
  "",
  "Chain stage 1 of 3 (implement → ship-milestone → pr), milestone M132, effort",
  "ultracode. Spawned as a fresh visible worker by /deliver.",
  "",
].join("\n");

interface FenceOptions {
  gate?: readonly string[];
  drive?: readonly string[];
  e2e?: readonly string[];
}

/** A canonical eight-section fence, with the evidence sections overridable. */
function writeFenceCapture(label: string, options: FenceOptions = {}): string {
  const body = [
    "stage: implement",
    "milestone: M132",
    "status: ok",
    "summary:",
    "  - STE-510 lands machine-read fence evidence",
    "gate:",
    ...(options.gate ?? ["  - pass 9289, fail 0, skip 15, baseline 15, delta 0"]),
    "drive:",
    ...(options.drive ?? ["  - pass 12, fail 0, skip 0"]),
    "e2e:",
    ...(options.e2e ?? ["  - pass 3, fail 0, skip 0"]),
    "follow_ups:",
    "  - (none found)",
  ];
  const text = [PROSE, "```deliver-stage-result", ...body, "```", ""].join("\n");
  const file = join(tempDir(`report-${label}`), "stage-report.txt");
  writeFileSync(file, text, "utf-8");
  return file;
}

// ===========================================================================
// HIGH 1 — the ratchet is permanently unmeasured: nothing captures a baseline.
//
// SUBJECT: the shipped prose surfaces, DELIBERATELY. The write-once invariant
// itself is implemented and mutation-verified; what is missing is an OPERATIVE
// INSTRUCTION saying WHEN a baseline is written. That absence is a document
// defect, and only a document can carry the fix.
//
// The first leg establishes the defect is not academic by EXECUTING the shipped
// renderer against a project with no baseline — the refusal is real, and it is
// what a healthy run gets today.
// ===========================================================================

describe("HIGH 1 — an operative surface states when the skip baseline is captured", () => {
  test("WITNESS: with no baseline captured, the shipped renderer REFUSES a clean gate run", async () => {
    const root = tempDir("high1-witness");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("high1-witness", "bun test", GATE_CLEAN),
      drive: capturedRun("high1-witness-drive", "bun run app", DRIVE_OUTPUT),
      e2e: capturedRun("high1-witness-e2e", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch: BRANCH,
    });

    // Not inert: an unmeasured baseline is a refusal ground on a run whose
    // every count is clean. Nothing writes one, so this is the steady state.
    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("unmeasured");
    expect(rendered.rows.join("\n")).toContain("baseline unmeasured");
  });

  test("PAIRED POSITIVE: the same run with a captured baseline reports ok", async () => {
    const root = await rootWithBaseline("high1-measured", 15);
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("high1-measured", "bun test", GATE_CLEAN),
      drive: capturedRun("high1-measured-drive", "bun run app", DRIVE_OUTPUT),
      e2e: capturedRun("high1-measured-e2e", "bun run e2e", E2E_OUTPUT),
      projectRoot: root,
      branch: BRANCH,
    });

    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
    expect(rendered.rows.join("\n")).toContain("baseline 15, delta 0");
  });

  test("/implement's SKILL names the capture AND says when", () => {
    const lines = read(IMPLEMENT_SKILL).split("\n");
    const carriers = lines.filter(
      (line) => line.includes("captureSkipBaseline") || line.includes("capture_skip_baseline"),
    );

    // The instruction has to exist at all...
    expect(carriers.length).toBeGreaterThan(0);
    // ...and say WHEN. An instruction that names the capture but not the moment
    // is aspirational, not executable — that is this leg's whole subject, and
    // it is unchanged.
    //
    // The MOMENT changed under M136 / STE-527. This leg used to require the
    // word "branch", because STE-509 captured at branch creation. That moment
    // is now provably wrong: the baseline is keyed to the TRUNK COMMIT, and
    // capture refuses unless HEAD stands on it with a clean tree — so a branch
    // is the one place it cannot happen. Requiring "branch" here would force
    // the shipped skill to keep saying something false, which is the opposite
    // of what this leg exists to do.
    expect(
      carriers.some((line) => /trunk|clean tree|merge-base/i.test(line)),
      "the capture order names no moment — say WHEN it is captured, not just what to call",
    ).toBe(true);
    // ...and name the module, so a reader can reach the code that does it.
    expect(read(IMPLEMENT_SKILL)).toContain("skip_baseline");
  });

  test("SIBLING SURFACE: the reference doc carries the same obligation", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).toContain("captureSkipBaseline");

    // Same rule on both surfaces. A rule that lands on one and not its sibling
    // is the drift M131 recorded three times in a single milestone — that is
    // this leg's subject and it is unchanged.
    //
    // The SECTION changed under M136 / STE-528. This leg used to require the
    // obligation to sit inside `## Branch Proposal`, which is exactly the
    // conditioned scope AC-STE-528.1 and .2 move it OUT of. Pinning the old
    // location would have made the decondition impossible while claiming to
    // guard sibling parity. So the section is DISCOVERED — wherever the doc
    // states the capture order, that section must carry both tokens.
    const start = body.indexOf("Skip baseline capture");
    expect(
      start,
      "the reference doc states no capture order at all — the sibling surface has gone silent",
    ).toBeGreaterThan(-1);
    const nextHeading = body.indexOf("\n## ", start + 1);
    const section = body.slice(start, nextHeading === -1 ? body.length : nextHeading);
    expect(section).toContain("capture_skip_baseline");
    expect(section).toContain("skip_baseline");
  });

  test("the named function is the SHIPPED one — the surfaces cite a real export", async () => {
    // A prose surface naming a function that does not exist is worse than
    // silence: it reads as executable and is not.
    expect(typeof (await loadSkipBaseline()).captureSkipBaseline).toBe("function");
    expect(read(SKIP_BASELINE_MODULE)).toContain("export function captureSkipBaseline");
  });
});

// ===========================================================================
// HIGH 2 — an indentation hole bypasses two of this milestone's own guards.
//
// SUBJECT: `verifyDeliverStageCapture` executed against real capture files on
// disk. Not a regex read out of the source: the defect is that two regexes
// DISAGREE, and only running the verifier can show what the disagreement lets
// through.
//
// Three witnesses, all verified against the shipped module before this file was
// written. A and C currently return ok:TRUE with ZERO reasons.
// ===========================================================================

describe("HIGH 2 — a counts line at column 0 is refused, exactly as an indented one is", () => {
  test("WITNESS A: a partial counts line at COLUMN 0 is REFUSED, not skipped", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      // skip, baseline and delta all omitted — the silent-skip shape.
      writeFenceCapture("high2-a", { gate: ["- pass 100, fail 0"] }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("gate");
    // The counts rule is what must fire — this is an OMITTED COUNT, not a
    // cardinality problem — so the diagnostic names the missing words.
    expect(verdict.reasons.join("\n")).toContain("skip");
  });

  test("WITNESS B: the SAME line indented two spaces is refused — the pair must agree", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const indented = verifyDeliverStageCapture(
      writeFenceCapture("high2-b", { gate: ["  - pass 100, fail 0"] }),
    );
    const column0 = verifyDeliverStageCapture(
      writeFenceCapture("high2-b-col0", { gate: ["- pass 100, fail 0"] }),
    );

    // B already passes today. The point of asserting it beside A is that the
    // two must reach the SAME verdict: deleting two spaces is not a semantic
    // difference, and any fix that leaves them disagreeing has not landed.
    expect(indented.ok).toBe(false);
    expect(column0.ok).toBe(indented.ok);
    expect(column0.reasons.length).toBe(indented.reasons.length);
  });

  test("WITNESS C: a failing result BURIED at column 0 under a clean line is REFUSED", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("high2-c", {
        gate: [
          "  - pass 9289, fail 0, skip 15, baseline 15, delta 0",
          "- pass 0, fail 3, skip 0, baseline 0, delta 0",
        ],
      }),
    );

    // This is the exact defect `checkEvidenceCardinality`'s own docstring
    // names — "a real result buried under a clean one, which is how a failing
    // stage reports green" — dodged by deleting two spaces.
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("gate");
    expect(verdict.reasons.join("\n")).toContain("items");
  });

  test("WITNESS C, indented: the same burial WITH indentation is refused identically", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const indented = verifyDeliverStageCapture(
      writeFenceCapture("high2-c-indented", {
        gate: [
          "  - pass 9289, fail 0, skip 15, baseline 15, delta 0",
          "  - pass 0, fail 3, skip 0, baseline 0, delta 0",
        ],
      }),
    );
    const column0 = verifyDeliverStageCapture(
      writeFenceCapture("high2-c-col0", {
        gate: [
          "  - pass 9289, fail 0, skip 15, baseline 15, delta 0",
          "- pass 0, fail 3, skip 0, baseline 0, delta 0",
        ],
      }),
    );

    expect(indented.ok).toBe(false);
    expect(column0.ok).toBe(indented.ok);
    expect(column0.reasons.length).toBe(indented.reasons.length);
  });

  test("the hole is closed in EVERY evidence section, not only gate", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();

    const drive = verifyDeliverStageCapture(
      writeFenceCapture("high2-drive", { drive: ["- pass 12, fail 0"] }),
    );
    const e2e = verifyDeliverStageCapture(
      writeFenceCapture("high2-e2e", { e2e: ["- pass 3, fail 0"] }),
    );

    // A fix applied to one section's call site and not the others is the same
    // half-landed shape this milestone keeps producing.
    expect(drive.ok).toBe(false);
    expect(drive.reasons.join("\n")).toContain("drive");
    expect(e2e.ok).toBe(false);
    expect(e2e.reasons.join("\n")).toContain("e2e");
  });

  // -- PAIRED POSITIVES. An over-strict fix that rejects healthy fences dies
  // -- here. Every one of these is a shape that must STILL PASS.

  test("OVER-STRICT GUARD: the canonical indented fence still verifies clean", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(writeFenceCapture("high2-canonical"));

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("OVER-STRICT GUARD: the shipped genuine fixture still verifies clean", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(GENUINE_FIXTURE);

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("OVER-STRICT GUARD: `- (none found)` and deeper indentation stay legal", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("high2-empty", {
        drive: ["  - (none found)"],
        e2e: ["\t- pass 3, fail 0, skip 0"],
      }),
    );

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("OVER-STRICT GUARD: a column-0 `- (none found)` is the empty fallback, not a violation", async () => {
    const { verifyDeliverStageCapture } = await loadCapture();
    const verdict = verifyDeliverStageCapture(
      writeFenceCapture("high2-empty-col0", { drive: ["- (none found)"] }),
    );

    // The empty-item regex was ALREADY lenient about indentation. Tightening
    // the sibling must converge on the lenient form, never on refusing a shape
    // the other half has always accepted.
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

// ===========================================================================
// HIGH 3 — declaration-based vacuity: a guard that false-REDs a healthy run.
//
// SUBJECT: the shipped renderer executed against real CLAUDE.md files, plus
// THIS REPO'S OWN declaration, which is the live witness.
//
// The required set is DERIVED from the declaration through the shipped
// predicates — never a hand-inlined `=== "none"`, which is the precise defect
// `isRunCmdNone`'s own docstring says it exists to make impossible.
// ===========================================================================

describe("HIGH 3 — the required evidence set is derived from the project's declaration", () => {
  test("a shipped module exports requiredEvidenceSections, and exactly one does", async () => {
    const { path, requiredEvidenceSections } = await loadRequiredSections();
    expect(typeof requiredEvidenceSections).toBe("function");
    expect(path.startsWith(SRC_DIR)).toBe(true);
  });

  test("it asks the SHIPPED predicates, never a hand-inlined comparison", async () => {
    const { path } = await loadRequiredSections();
    const source = read(path);

    // Two layers already read `run_cmd` with two different consequences and are
    // held together by these predicates. A third reader that inlines the
    // comparison agrees with them right up until the sentinel's rules change.
    expect(source).toContain("verification_config");
    expect(source).toContain("isRunCmdNone");
    expect(source).toContain("isRunCmdAnswered");
    expect(source).toContain("readVerificationConfig");

    // No re-implementation of the sentinel test. `"none"` may appear only via
    // the predicates above, never in a comparison of its own.
    expect(/[=!]==\s*["'`]none["'`]/.test(source)).toBe(false);
    expect(/["'`]none["'`]\s*[=!]==/.test(source)).toBe(false);
  });

  test("`run_cmd: none` and an absent `e2e_cmd` require GATE ONLY", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();
    const root = await rootDeclaring("h3-none", "verify_mode: manual\nrun_cmd: none");

    expect([...requiredEvidenceSections(join(root, "CLAUDE.md"))]).toEqual(["gate"]);
  });

  test("an OMITTED run_cmd is the same answer as `none` for this question", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();
    const root = await rootDeclaring("h3-omitted", "verify_mode: advisory");

    expect([...requiredEvidenceSections(join(root, "CLAUDE.md"))]).toEqual(["gate"]);
  });

  test("a DECLARED run_cmd makes drive required; a declared e2e_cmd makes e2e required", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();

    const driveOnly = await rootDeclaring("h3-drive", "run_cmd: bun run app");
    expect([...requiredEvidenceSections(join(driveOnly, "CLAUDE.md"))]).toEqual(["gate", "drive"]);

    const both = await rootDeclaring("h3-both", "run_cmd: bun run app\ne2e_cmd: bun run e2e");
    expect([...requiredEvidenceSections(join(both, "CLAUDE.md"))]).toEqual([
      "gate",
      "drive",
      "e2e",
    ]);

    const e2eOnly = await rootDeclaring("h3-e2e", "run_cmd: none\ne2e_cmd: bun run e2e");
    expect([...requiredEvidenceSections(join(e2eOnly, "CLAUDE.md"))]).toEqual(["gate", "e2e"]);
  });

  test("`e2e_cmd: none` is an ANSWER — there is no suite — so e2e is not required", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();
    const root = await rootDeclaring("h3-e2e-none", "run_cmd: bun run app\ne2e_cmd: none");

    expect([...requiredEvidenceSections(join(root, "CLAUDE.md"))]).toEqual(["gate", "drive"]);
  });

  test("a BARE `run_cmd:` is an omission wearing an answer's hat, not a declaration", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();
    const root = await rootDeclaring("h3-bare", "run_cmd:\ne2e_cmd:");

    expect([...requiredEvidenceSections(join(root, "CLAUDE.md"))]).toEqual(["gate"]);
  });

  test("gate is required unconditionally — no declaration can narrow it away", async () => {
    const { requiredEvidenceSections } = await loadRequiredSections();
    const noBlock = await rootDeclaring("h3-noblock", null);
    const noFile = tempDir("h3-nofile");

    expect([...requiredEvidenceSections(join(noBlock, "CLAUDE.md"))]).toEqual(["gate"]);
    expect([...requiredEvidenceSections(join(noFile, "CLAUDE.md"))]).toEqual(["gate"]);
  });

  test("step 14 on a `run_cmd: none` project reports ok with `- (none found)` rows", async () => {
    const root = await rootDeclaring("h3-step14-ok", "verify_mode: manual\nrun_cmd: none");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("h3-step14-ok", "bun test", GATE_CLEAN),
      projectRoot: root,
      branch: BRANCH,
    });

    // The false-RED this finding is about: refusing to certify a healthy run
    // because two commands the project SAID it does not have produced no output.
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
    // Sections never vanish — the rows still carry the honest empty fallback.
    expect(rendered.rows).toContain("drive:");
    expect(rendered.rows).toContain("e2e:");
    expect(rendered.rows.filter((row) => row.includes("(none found)")).length).toBe(2);
  });

  test("PAIRED NEGATIVE: a project that DOES declare its commands still refuses on a missing capture", async () => {
    const root = await rootDeclaring("h3-step14-red", "run_cmd: bun run app\ne2e_cmd: bun run e2e");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("h3-step14-red", "bun test", GATE_CLEAN),
      drive: null,
      e2e: null,
      projectRoot: root,
      branch: BRANCH,
    });

    // Vacuity is DECLARED, never assumed. Narrowing that reached a declared
    // project would trade a false red for a false green.
    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("drive");
    expect(rendered.reasons.join("\n")).toContain("e2e");
  });

  test("PAIRED NEGATIVE: a declared project whose drive capture FAILS still refuses", async () => {
    const root = await rootDeclaring("h3-step14-fail", "run_cmd: bun run app");
    const failing = [
      "bun test v1.1.29",
      "",
      " 9 pass",
      " 0 skip",
      " 3 fail",
      "Ran 12 tests across 3 files. [1.30s]",
    ].join("\n");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("h3-step14-fail-gate", "bun test", GATE_CLEAN),
      drive: capturedRun("h3-step14-fail-drive", "bun run app", failing),
      projectRoot: root,
      branch: BRANCH,
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("drive");
  });

  test("an EXPLICIT `required` from the caller still wins over the declaration", async () => {
    const root = await rootDeclaring("h3-explicit", "run_cmd: bun run app\ne2e_cmd: bun run e2e");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("h3-explicit", "bun test", GATE_CLEAN),
      required: ["gate"],
      projectRoot: root,
      branch: BRANCH,
    });

    // The reduced-chain caller keeps its override. Derivation fills the gap
    // when nobody answered; it does not overrule someone who did.
    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
  });

  test("LIVE WITNESS: this repo's own declaration certifies a clean gate-only run", async () => {
    // THIS repo declares `run_cmd: none` and no `e2e_cmd`. Before the fix, a
    // standalone step-14 block rendered ok:FALSE here — a guard false-REDding
    // the very repo that ships it.
    const { requiredEvidenceSections } = await loadRequiredSections();
    expect([...requiredEvidenceSections(join(REPO_ROOT, "CLAUDE.md"))]).toEqual(["gate"]);

    const root = await rootWithBaseline("h3-live", 15);
    writeFileSync(join(root, "CLAUDE.md"), read(join(REPO_ROOT, "CLAUDE.md")), "utf-8");
    const rendered = (await loadReport()).renderImplementReportEvidence({
      gate: capturedRun("h3-live", "bun test", GATE_CLEAN),
      projectRoot: root,
      branch: BRANCH,
    });

    expect(rendered.reasons).toEqual([]);
    expect(rendered.ok).toBe(true);
  });

  test("REGRESSION GUARD: /deliver's fence renderer keeps its fail-closed all-three default", async () => {
    const root = await rootWithBaseline("h3-fence-default", 15);
    const rendered = (await loadEvidence()).renderStageEvidence({
      gate: capturedRun("h3-fence-default", "bun test", GATE_CLEAN),
      projectRoot: root,
      branch: BRANCH,
    });

    // The narrowing belongs to the declaration-reading caller. Leaking it into
    // the fence renderer's own default would silently un-arm every reduced
    // chain the orchestrator grades.
    expect(rendered.ok).toBe(false);
    expect(rendered.reasons.join("\n")).toContain("drive");
    expect(rendered.reasons.join("\n")).toContain("e2e");
  });

  test("SURFACE: the step-14 reference qualifies its fail-closed claim with the declaration", () => {
    const body = read(IMPLEMENT_REFERENCE);
    const start = body.indexOf("## Step 14 Verification Evidence");
    expect(start).toBeGreaterThan(-1);
    const nextHeading = body.indexOf("\n## ", start + 1);
    const section = body.slice(start, nextHeading === -1 ? body.length : nextHeading);

    // "A missing capture is a refusal, not a silent omission" is stated flatly
    // today, and is FALSE for a project that declared the command away.
    expect(section).toContain("run_cmd");
    expect(section).toContain("e2e_cmd");
    expect(/declar/i.test(section)).toBe(true);
    expect(section).toContain("requiredEvidenceSections");
  });

  test("SURFACE: /deliver's SKILL no longer claims EVERY full ceremony runs real commands", () => {
    const body = read(DELIVER_SKILL);

    // Flatly false for any repo declaring `run_cmd: none` — including this one.
    expect(body).not.toContain(
      "Every stage of a full ceremony runs real commands and therefore has captured output behind every number it prints",
    );
    // And the claim's replacement must actually name the qualification rather
    // than merely deleting the sentence.
    expect(body).toContain("run_cmd");
  });
});

// ===========================================================================
// MEDIUM 1 — docs/layout-reference.md carries a FALSE claim, not a stale one.
//
// SUBJECT: the document, checked against the CODE it claims to describe. Every
// expectation is READ from the shipped module — a restated literal here would
// drift the same way the doc did.
// ===========================================================================

describe("MEDIUM 1 — the layout reference agrees with the code it describes", () => {
  test("the exhaustive composer list names EVERY export of dpt_paths.ts", () => {
    const source = read(DPT_PATHS_MODULE);
    const exported = [...source.matchAll(/export\s+function\s+(\w+)/g)].map((hit) => hit[1]!);

    // Sanity: the module really does export the composer the doc omits.
    expect(exported).toContain("skipBaselinePath");
    expect(exported.length).toBeGreaterThan(1);

    const doc = read(LAYOUT_REFERENCE);
    const sentenceStart = doc.indexOf("is composed by");
    expect(sentenceStart).toBeGreaterThan(-1);
    const sentence = doc.slice(sentenceStart, doc.indexOf("\n", sentenceStart));

    // The sentence claims to be exhaustive. Omitting a composer ON THE VERY
    // SENTENCE that says "every path" is a false claim, not a stale one.
    for (const name of exported) {
      expect(sentence).toContain(`\`${name}\``);
    }
  });

  test("the `.dpt/` tree diagram shows the skip-baseline store", () => {
    const doc = read(LAYOUT_REFERENCE);
    const start = doc.indexOf("## The `.dpt/` tree");
    expect(start).toBeGreaterThan(-1);
    const fenceOpen = doc.indexOf("```", start);
    const fenceClose = doc.indexOf("```", fenceOpen + 3);
    expect(fenceOpen).toBeGreaterThan(-1);
    expect(fenceClose).toBeGreaterThan(fenceOpen);
    const tree = doc.slice(fenceOpen, fenceClose);

    expect(tree).toContain("skip-baseline.json");
    // The other three subtrees are still there — this is an addition, not a
    // rewrite that dropped what the diagram already documented.
    expect(tree).toContain("locks/");
    expect(tree).toContain("ledger/");
    expect(tree).toContain("scratch/");
  });

  test("the rule COUNT and the rule LITERALS both match DPT_GITIGNORE_BODY", async () => {
    const { DPT_GITIGNORE_BODY } = (await import(DPT_GITIGNORE_MODULE)) as {
      DPT_GITIGNORE_BODY: string;
    };
    const rules = DPT_GITIGNORE_BODY.split("\n").filter((line) => line.trim() !== "");

    // Read, never restated: the count comes from the shipped body.
    const words = ["zero", "one", "two", "three", "four", "five", "six"];
    const expectedWord = words[rules.length];
    expect(expectedWord).toBeDefined();

    const doc = read(LAYOUT_REFERENCE);
    expect(doc).toContain(`exactly ${expectedWord} relative rules`);
    // And no stale count survives beside the corrected one.
    for (const word of words.filter((w) => w !== expectedWord)) {
      expect(doc).not.toContain(`exactly ${word} relative rules`);
    }
    // Every rule the file actually ships is named in the doc.
    for (const rule of rules) {
      expect(doc).toContain(`\`${rule}\``);
    }
  });
});

// ===========================================================================
// MEDIUM 2 — an NFR-1 citation was DELETED rather than satisfied.
//
// SUBJECT: the reference doc, checked against `specs/requirements.md`. The cap
// is READ from the requirement. Restating `351` here would reproduce the exact
// failure mode: a citation that agrees with the requirement until it moves.
//
// OUT OF SCOPE, deliberately: whether `skills/implement/SKILL.md` is UNDER the
// cap. It is not (354 lines), that breach is pre-existing and unchanged by this
// milestone, and pinning it here would red the gate on something this round did
// not cause. The defect being closed is the DELETED NUMBER, not the overage.
// ===========================================================================

describe("MEDIUM 2 — the NFR-1 citation carries the requirement's actual number", () => {
  test("specs/requirements.md states a single, readable skill-line cap", () => {
    const hit = /No single skill file shall exceed (\d+) lines/.exec(read(REQUIREMENTS));
    expect(hit).not.toBeNull();
    expect(Number(hit![1])).toBeGreaterThan(0);
  });

  test("docs/implement-reference.md cites that number, not a capless paraphrase", () => {
    const cap = /No single skill file shall exceed (\d+) lines/.exec(read(REQUIREMENTS))![1]!;
    const doc = read(IMPLEMENT_REFERENCE);

    // The number is one of only two places a reader would notice a breach.
    // Deleting it removed half the signal without fixing anything.
    expect(doc).toContain(`NFR-1 ${cap}-line cap`);
  });

  test("NO shipped surface cites a DIFFERENT number for the same cap", () => {
    const cap = /No single skill file shall exceed (\d+) lines/.exec(read(REQUIREMENTS))![1]!;
    const surfaces = [IMPLEMENT_SKILL, IMPLEMENT_REFERENCE, DELIVER_SKILL, LAYOUT_REFERENCE];

    for (const path of surfaces) {
      for (const hit of read(path).matchAll(/NFR-1[^.\n]{0,20}?(\d+)-line/g)) {
        expect(`${path}:${hit[1]}`).toBe(`${path}:${cap}`);
      }
    }
  });
});

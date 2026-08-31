// M137 / STE-532 — "The stage report is a fenced status block with a hard line
// budget".
//
// THE DEFECT. Every stage ends by narrating what it did in paragraphs, and
// nothing anywhere constrains how long that narration runs. `/deliver`'s
// shipped grader — `verifyDeliverStageCapture` — measures a line cap INSIDE the
// fence (`FENCE_LINE_CAP`, 26) because its subject is a hand-off between
// machines. The surface a HUMAN reads is the whole report, prose lead-in
// included, and that span is measured by nothing: a report with a perfectly
// compliant 17-line fence and forty lines of narration bolted above it grades
// `ok: true` today. That is the exact case AC-STE-532.3 names, and this suite
// pins it as a FAILURE of the new whole-report validator while showing the
// shipped fence-only grader still accepts it — the disagreement between the two
// spans is the discriminating fact, not either verdict alone.
//
// THE SUBJECT THE IMPLEMENTER WRITES:
//
//     adapters/_shared/src/stage_status_block.ts       ← NEW
//
// THE CONTRACT THESE TESTS PIN, stated once so nothing has to be guessed:
//
//   export function verifyStageStatusBlock(
//     report: string,                              // the RENDERED report: the
//                                                  // full text a human sees —
//                                                  // prose lead-in PLUS fence
//     evidence?: StageEvidenceInput | null,        // omitted ⇒ shape only
//   ): { ok: boolean; reasons: readonly string[] }
//
//   export const STAGE_STATUS_SECTIONS   // THE fixed section order. NOT a copy
//                                        // — imported from
//                                        // `deliver_stage_capture.ts`, whose
//                                        // `DELIVER_STAGE_SECTIONS` is the one
//                                        // place the order is stated
//                                        // (AC-STE-532.2). A second literal
//                                        // listing of the eight names in this
//                                        // module IS the defect.
//   export const SCALAR_STATUS_SECTIONS  // ["stage", "milestone", "status"] —
//                                        // excluded from the empty-section
//                                        // fallback rule (AC-STE-532.4)
//   export const LIST_STATUS_SECTIONS    // the order MINUS the scalars, derived
//   export const EMPTY_SECTION_FALLBACK  // the literal "- (none found)"
//   export const STAGE_REPORT_LINE_CAP   // the WHOLE-REPORT line cap
//
//   The cap refusal names the word "cap" and the cap number, so a reader is told
//   which budget was blown and by what measure. Every other refusal names the
//   offending SECTION by name. There is one verdict shape and one channel:
//   `{ ok, reasons }`, `reasons` empty iff `ok` — a counts-without-capture
//   violation (AC-STE-532.5) lands in the same array as a structural one and
//   earns no second recovery path of its own.
//
// FIXTURES ARE THE SHIPPED ONES. `tests/fixtures/deliver-stage-capture/`
// already carries a well-formed model capture and two mutations of it; the FR's
// Testing section says to reuse them rather than mint parallel copies, so a
// drift in that contract surfaces here too.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DELIVER_STAGE_FENCE_BANNER,
  DELIVER_STAGE_SECTIONS,
  FENCE_LINE_CAP,
  verifyDeliverStageCapture,
} from "../adapters/_shared/src/deliver_stage_capture";
import type { CapturedRun } from "../adapters/_shared/src/deliver_stage_evidence";
import { findFences } from "../adapters/_shared/src/markdown_fences";
import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";
import {
  EMPTY_SECTION_FALLBACK,
  LIST_STATUS_SECTIONS,
  SCALAR_STATUS_SECTIONS,
  STAGE_BLOCK_FENCE_BANNER,
  STAGE_REPORT_LINE_CAP,
  STAGE_STATUS_SECTIONS,
  verifyStageStatusBlock,
} from "../adapters/_shared/src/stage_status_block";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "stage_status_block.ts",
);

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "deliver-stage-capture");

/**
 * Trailing newline stripped so every line count in this file means one thing,
 * and the fence REBANNERED onto the adopting stages' own opener.
 *
 * AC-STE-533.1a split one artifact into two contracts: `deliver-stage-result`
 * stays /deliver's MACHINE hand-off (graded by `verifyDeliverStageCapture`),
 * and `stage-status-block` is the HUMAN-facing closing summary this module
 * grades. The shipped fixtures are /deliver's, so only the banner is swapped —
 * every line count, section and count below still comes from the shipped model
 * report rather than from a hand-typed one.
 */
const fixture = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, name), "utf-8")
    .replace(/\n+$/, "")
    .replace(DELIVER_STAGE_FENCE_BANNER, STAGE_BLOCK_FENCE_BANNER);

/** The well-formed model capture — 29 lines, 12 of prose, a 17-line fence. */
const CLEAN = fixture("worker-stage-report.txt");
/** Shipped mutation 1: the fence removed, the token deliberately left in prose. */
const NO_FENCE = fixture("worker-stage-report-no-fence.txt");
/** Shipped mutation 2: all eight sections present, order broken. */
const REORDERED = fixture("worker-stage-report-reordered.txt");

const FENCE_OPEN_RE = new RegExp(
  `^[ \\t]*${STAGE_BLOCK_FENCE_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`,
);
const FENCE_CLOSE_RE = /^[ \t]*```[ \t]*$/;
const TOP_LEVEL_KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

const lineCount = (text: string): number => text.split("\n").length;

const fenceOpenIndex = (report: string): number =>
  report.split("\n").findIndex((line) => FENCE_OPEN_RE.test(line));

/** The fence's inner lines, read through the SHARED scanner, never a local walk. */
function fenceBody(report: string): string[] {
  const fences = findFences(report, FENCE_OPEN_RE, FENCE_CLOSE_RE);
  expect(fences.length).toBe(1);
  return fences[0]!.lines;
}

/** Rewrite the fence body in place, leaving prose and markers untouched. */
function rewriteFence(report: string, fn: (body: string[]) => string[]): string {
  const all = report.split("\n");
  const open = all.findIndex((line) => FENCE_OPEN_RE.test(line));
  expect(open).toBeGreaterThanOrEqual(0);
  const close = all.findIndex(
    (line, index) => index > open && FENCE_CLOSE_RE.test(line),
  );
  expect(close).toBeGreaterThan(open);
  return [
    ...all.slice(0, open + 1),
    ...fn(all.slice(open + 1, close)),
    ...all.slice(close),
  ].join("\n");
}

interface SectionBlock {
  name: string;
  lines: string[];
}

/** Split a fence body into its top-level section blocks, in order. */
function sectionBlocks(body: readonly string[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  for (const line of body) {
    const match = TOP_LEVEL_KEY_RE.exec(line);
    if (match !== null) {
      blocks.push({ name: match[1]!, lines: [line] });
      continue;
    }
    if (blocks.length > 0) blocks[blocks.length - 1]!.lines.push(line);
  }
  return blocks;
}

const sectionOrder = (report: string): string[] =>
  sectionBlocks(fenceBody(report)).map((block) => block.name);

const flatten = (blocks: readonly SectionBlock[]): string[] =>
  blocks.flatMap((block) => block.lines);

/** MUTATION: exchange the positions of two whole sections. */
function swapSections(report: string, a: string, b: string): string {
  return rewriteFence(report, (body) => {
    const blocks = sectionBlocks(body);
    const ia = blocks.findIndex((block) => block.name === a);
    const ib = blocks.findIndex((block) => block.name === b);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    const swapped = [...blocks];
    swapped[ia] = blocks[ib]!;
    swapped[ib] = blocks[ia]!;
    return flatten(swapped);
  });
}

/** MUTATION: remove a section entirely — heading and items both. */
function dropSection(report: string, name: string): string {
  return rewriteFence(report, (body) =>
    flatten(sectionBlocks(body).filter((block) => block.name !== name)),
  );
}

/** Replace a section's items with the empty-section fallback, heading kept. */
function emptySection(report: string, name: string): string {
  return rewriteFence(report, (body) =>
    flatten(
      sectionBlocks(body).map((block) =>
        block.name === name
          ? { name, lines: [`${name}:`, `  ${EMPTY_SECTION_FALLBACK}`] }
          : block,
      ),
    ),
  );
}

/**
 * MUTATION: reduce a section to a BARE HEADING — no items, and no fallback.
 *
 * The half of AC-STE-532.4 that `emptySection` above cannot reach: that helper
 * keeps the heading AND supplies the fallback, so it only ever produces the
 * accepted shape. This one produces the shape the AC's second clause forbids.
 */
function bareHeadingSection(report: string, name: string): string {
  return rewriteFence(report, (body) =>
    flatten(
      sectionBlocks(body).map((block) =>
        block.name === name ? { name, lines: [`${name}:`] } : block,
      ),
    ),
  );
}

/** MUTATION: bolt `count` lines of narration above the fence. */
function insertNarration(report: string, count: number): string {
  const all = report.split("\n");
  const open = fenceOpenIndex(report);
  expect(open).toBeGreaterThanOrEqual(0);
  const filler = Array.from(
    { length: count },
    (_, i) =>
      `Narration line ${i + 1}: what the stage did, at length, in prose the ` +
      "operator has to scroll past to reach the two numbers.",
  );
  return [...all.slice(0, open), ...filler, ...all.slice(open)].join("\n");
}

/** MUTATION: delete the prose lead-in, leaving only the fence in the span. */
function stripProse(report: string): string {
  const all = report.split("\n");
  const open = fenceOpenIndex(report);
  expect(open).toBeGreaterThan(0);
  return all.slice(open).join("\n");
}

/** The cap refusal: names the word "cap" AND the cap number. */
const isCapReason = (reason: string): boolean =>
  /\bcap\b/i.test(reason) && reason.includes(String(STAGE_REPORT_LINE_CAP));

const namesSection = (reasons: readonly string[], name: string): boolean =>
  reasons.some((reason) => reason.includes(name));

const MODULE_SOURCE = (): string => readFileSync(MODULE_PATH, "utf-8");

// ---------------------------------------------------------------------------

describe("AC-STE-532.1 — a validator over a rendered report, verdict `{ ok, reasons }`", () => {
  test("the clean report is accepted with an EMPTY reasons array", () => {
    const verdict = verifyStageStatusBlock(CLEAN);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("its subject is the RENDERED report — a string, not a path", () => {
    // The shipped grader reads a capture off disk. This one grades the text a
    // human is looking at, so it takes that text. Handing it a path would grade
    // the path — and the assertion that says so has to MEASURE that, not
    // restate the verdict shape the test above already pins.
    //
    // The discriminating pair: one real file on disk holding a report this
    // validator accepts, graded twice — once by its PATH, once by its BYTES.
    const dir = mkdtempSync(join(tmpdir(), "ste-532-path-"));
    const capturePath = join(dir, "worker-stage-report.txt");
    writeFileSync(capturePath, CLEAN);

    // The file really is a valid report: its contents are accepted.
    const contents = readFileSync(capturePath, "utf-8");
    expect(contents).toBe(CLEAN);
    const byContents = verifyStageStatusBlock(contents);
    expect(byContents.reasons).toEqual([]);
    expect(byContents.ok).toBe(true);

    // The PATH to that same file is not a report — it carries no fence at all,
    // so a validator that quietly read its argument off disk (the shipped
    // grader's contract) would agree with the line above instead of refusing.
    expect(capturePath).not.toContain(STAGE_BLOCK_FENCE_BANNER);
    const byPath = verifyStageStatusBlock(capturePath);
    expect(byPath.ok).toBe(false);
    expect(byPath.reasons.some((reason) => /fence/i.test(reason))).toBe(true);

    // Same file, two arguments, two verdicts — that difference is the claim.
    expect(byPath.ok).not.toBe(byContents.ok);
  });

  test("every rejection names its OWN reason rather than a bare false", () => {
    const broken: Record<string, string> = {
      "no fence": NO_FENCE,
      "dropped section": dropSection(CLEAN, "drive"),
      "over the report cap": insertNarration(CLEAN, 40),
    };
    const blobs: string[] = [];
    for (const [label, report] of Object.entries(broken)) {
      const verdict = verifyStageStatusBlock(report);
      expect(verdict.ok).toBe(false);
      expect(verdict.reasons.length).toBeGreaterThan(0);
      for (const reason of verdict.reasons) {
        expect(typeof reason).toBe("string");
        expect(reason.trim().length).toBeGreaterThan(0);
      }
      blobs.push(`${label}::${verdict.reasons.join("\n")}`);
    }
    // Three distinct violations must not collapse into one generic sentence.
    const texts = Object.values(broken).map((report) =>
      verifyStageStatusBlock(report).reasons.join("\n"),
    );
    expect(new Set(texts).size).toBe(3);
    expect(blobs.length).toBe(3);
  });

  test("`reasons` is empty if and only if `ok`", () => {
    for (const report of [CLEAN, NO_FENCE, REORDERED, dropSection(CLEAN, "e2e")]) {
      const verdict = verifyStageStatusBlock(report);
      expect(verdict.reasons.length === 0).toBe(verdict.ok);
    }
  });
});

describe("AC-STE-532.2 — one fixed section order, stated in exactly ONE place", () => {
  test("the order is the SHIPPED const, read from `deliver_stage_capture.ts`", () => {
    // Asserted against the IMPORTED const, never a hand-typed array here: a
    // second copy in the test would be the same defect one layer out.
    expect([...STAGE_STATUS_SECTIONS]).toEqual([...DELIVER_STAGE_SECTIONS]);
  });

  test("the module keeps NO second copy of the order", () => {
    const src = MODULE_SOURCE();
    expect(src.length).toBeGreaterThan(200);
    expect(src).toMatch(
      /import\s*\{[^}]*\bDELIVER_STAGE_SECTIONS\b[^}]*\}\s*from\s*["']\.\/deliver_stage_capture["']/s,
    );
    // `summary` and `follow_ups` appear in NO other shared list, so a quoted
    // literal of either is an ordered re-listing of the eight names.
    for (const name of ["summary", "follow_ups"]) {
      expect(src).not.toContain(`"${name}"`);
      expect(src).not.toContain(`'${name}'`);
    }
  });

  test("a reordered report FAILS, naming an offending section", () => {
    // The shipped mutation fixture: all eight present, order broken.
    expect(sectionOrder(REORDERED).slice().sort()).toEqual(
      sectionOrder(CLEAN).slice().sort(),
    );
    expect(sectionOrder(REORDERED)).not.toEqual(sectionOrder(CLEAN));
    const verdict = verifyStageStatusBlock(REORDERED);
    expect(verdict.ok).toBe(false);
    expect(
      namesSection(verdict.reasons, "gate") ||
        namesSection(verdict.reasons, "summary"),
    ).toBe(true);
  });

  test("a MISSING section FAILS, and the reason names that section", () => {
    const withoutDrive = verifyStageStatusBlock(dropSection(CLEAN, "drive"));
    const withoutE2e = verifyStageStatusBlock(dropSection(CLEAN, "e2e"));
    expect(withoutDrive.ok).toBe(false);
    expect(withoutE2e.ok).toBe(false);
    expect(namesSection(withoutDrive.reasons, "drive")).toBe(true);
    expect(namesSection(withoutE2e.reasons, "e2e")).toBe(true);
    // Not one generic sentence answering both: the offending section is named.
    expect(withoutDrive.reasons.join("\n")).not.toBe(
      withoutE2e.reasons.join("\n"),
    );
  });
});

describe("AC-STE-532.3 — the cap spans the WHOLE report, prose lead-in included", () => {
  const LONG = insertNarration(CLEAN, 40);
  /**
   * The SAME report on /deliver's banner. AC-STE-533.1a split one artifact into
   * two contracts, so the fence-only grader is measured on the copy it speaks
   * for: `verifyDeliverStageCapture` owns `deliver-stage-result`, this module
   * owns `stage-status-block`, and the banner is the only difference between
   * these two strings.
   */
  const LONG_DELIVER = LONG.replace(
    STAGE_BLOCK_FENCE_BANNER,
    DELIVER_STAGE_FENCE_BANNER,
  );
  const scratch = mkdtempSync(join(tmpdir(), "ste-532-"));

  test("a whole-report cap must exceed the fence-only cap to be one at all", () => {
    expect(Number.isInteger(STAGE_REPORT_LINE_CAP)).toBe(true);
    expect(STAGE_REPORT_LINE_CAP).toBeGreaterThan(FENCE_LINE_CAP);
    // The clean model report must fit under it, or AC-STE-532.1 is unreachable.
    expect(STAGE_REPORT_LINE_CAP).toBeGreaterThanOrEqual(lineCount(CLEAN));
    expect(lineCount(LONG)).toBeGreaterThan(STAGE_REPORT_LINE_CAP);
  });

  test("THE DISCRIMINATING SHAPE: compliant fence, non-compliant report", () => {
    // Half one: the fence inside this report is genuinely compliant.
    expect(fenceBody(LONG).length).toBeLessThanOrEqual(FENCE_LINE_CAP);
    const capturePath = join(scratch, "long-report.txt");
    writeFileSync(capturePath, LONG_DELIVER);
    expect(LONG_DELIVER.replace(DELIVER_STAGE_FENCE_BANNER, STAGE_BLOCK_FENCE_BANNER)).toBe(LONG);
    const fenceOnlyVerdict = verifyDeliverStageCapture(capturePath);
    expect(fenceOnlyVerdict.reasons).toEqual([]);
    expect(fenceOnlyVerdict.ok).toBe(true);

    // Half two: the same report, measured over its whole span, is refused.
    // A cap that measured only the fence would agree with the line above and
    // leave the surface it was written to shorten unconstrained.
    const verdict = verifyStageStatusBlock(LONG);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isCapReason)).toBe(true);
  });

  test("the forty narration lines are the ONLY difference from the clean report", () => {
    // The failure is the span, not some second thing the mutation broke.
    expect(fenceBody(LONG)).toEqual(fenceBody(CLEAN));
    expect(lineCount(LONG) - lineCount(CLEAN)).toBe(40);
    expect(verifyStageStatusBlock(CLEAN).reasons.some(isCapReason)).toBe(false);
  });
});

describe("AC-STE-532.4 — an empty section keeps its heading and the fallback", () => {
  test("the fallback literal is `- (none found)`", () => {
    expect(EMPTY_SECTION_FALLBACK).toBe("- (none found)");
  });

  test("the scalar sections are named, and excluded from the fallback rule", () => {
    expect([...SCALAR_STATUS_SECTIONS]).toEqual(["stage", "milestone", "status"]);
    // Scalars and list-bearing sections partition the order — no section is in
    // both, none is in neither.
    expect(
      [...SCALAR_STATUS_SECTIONS].filter((name) =>
        (LIST_STATUS_SECTIONS as readonly string[]).includes(name),
      ),
    ).toEqual([]);
    expect(
      [...SCALAR_STATUS_SECTIONS, ...LIST_STATUS_SECTIONS].slice().sort(),
    ).toEqual([...STAGE_STATUS_SECTIONS].slice().sort());
  });

  test("EVERY list-bearing section may be empty-with-fallback", () => {
    for (const name of LIST_STATUS_SECTIONS) {
      const report = emptySection(CLEAN, name);
      // Heading KEPT, items replaced by the one fallback item. `e2e` and
      // `follow_ups` are already empty in the model capture, so this is a
      // no-op there by construction — asserted on the SECTION rather than on
      // the whole report, which would be a difference that need not exist.
      const block = sectionBlocks(fenceBody(report)).find(
        (candidate) => candidate.name === name,
      );
      expect(block).toEqual({
        name,
        lines: [`${name}:`, `  ${EMPTY_SECTION_FALLBACK}`],
      });
      const verdict = verifyStageStatusBlock(report);
      expect({ name, reasons: verdict.reasons }).toEqual({ name, reasons: [] });
      expect(verdict.ok).toBe(true);
    }
  });

  test("a BARE HEADING — no items, no fallback — is a violation too", () => {
    // THE UNGRADED HALF. The rule has two clauses: a section with nothing to
    // report KEEPS ITS HEADING (graded by the dropped-section test below) and
    // CARRIES THE LITERAL fallback. Nothing until now graded the second: a
    // section reduced to a bare heading keeps its place in the order, is not
    // missing, is not a scalar carrying a list item — and so slips past every
    // other clause. That is the shape a worker actually emits when it has
    // nothing to say, which is precisely why the fallback exists.
    //
    // Driven off the IMPORTED `LIST_STATUS_SECTIONS`, never a hand-typed list,
    // so a section added to the order later is covered here by construction.
    expect(LIST_STATUS_SECTIONS.length).toBeGreaterThan(0);
    for (const name of LIST_STATUS_SECTIONS) {
      const bare = bareHeadingSection(CLEAN, name);

      // APPLIED? The heading survives, alone: no items, and no fallback under
      // it. Asserted on the SECTION, so `e2e` and `follow_ups` — already
      // fallback-only in the model capture — are measured the same way `gate`
      // and `drive` are.
      const block = sectionBlocks(fenceBody(bare)).find(
        (candidate) => candidate.name === name,
      );
      expect(block).toEqual({ name, lines: [`${name}:`] });
      expect(sectionOrder(bare)).toEqual(sectionOrder(CLEAN));

      // The refusal, naming the offending section.
      const verdict = verifyStageStatusBlock(bare);
      expect({ name, ok: verdict.ok }).toEqual({ name, ok: false });
      expect(namesSection(verdict.reasons, name)).toBe(true);

      // DISCRIMINATING: the same section, same report, with the fallback put
      // back is accepted. So the refusal above is about the ABSENT fallback,
      // not about the section or the mutation having touched the fence.
      const restored = verifyStageStatusBlock(emptySection(CLEAN, name));
      expect({ name, ok: restored.ok }).toEqual({ name, ok: true });
    }
  });

  test("a DROPPED section is a violation, not an empty one", () => {
    for (const name of LIST_STATUS_SECTIONS) {
      const dropped = dropSection(CLEAN, name);
      expect(dropped).not.toContain(`\n${name}:`);
      const verdict = verifyStageStatusBlock(dropped);
      expect({ name, ok: verdict.ok }).toEqual({ name, ok: false });
      expect(namesSection(verdict.reasons, name)).toBe(true);
    }
  });

  test("a SCALAR section cannot carry the list-item fallback", () => {
    for (const name of SCALAR_STATUS_SECTIONS) {
      const faked = emptySection(CLEAN, name);
      expect(faked).not.toBe(CLEAN);
      expect(faked).toContain(EMPTY_SECTION_FALLBACK);
      const verdict = verifyStageStatusBlock(faked);
      expect({ name, ok: verdict.ok }).toEqual({ name, ok: false });
      expect(namesSection(verdict.reasons, name)).toBe(true);
    }
  });
});

describe("AC-STE-532.5 — a count with no capture behind it takes the SAME path", () => {
  test("stated counts with nothing captured are refused, naming the section", () => {
    // The clean report states `gate: pass 8067 …` and `drive: pass 12 …`. With
    // an evidence input that captured NOTHING, those numbers trace to nothing.
    const verdict = verifyStageStatusBlock(CLEAN, { required: [] });
    expect(verdict.ok).toBe(false);
    expect(namesSection(verdict.reasons, "gate")).toBe(true);
    expect(verdict.reasons.some((reason) => /captur/i.test(reason))).toBe(true);
  });

  test("the same report with no evidence argument is graded on shape alone", () => {
    // Proof the refusal above comes from the ABSENT CAPTURE, not the report.
    expect(verifyStageStatusBlock(CLEAN).ok).toBe(true);
  });

  test("THE POSITIVE CONTROL: the same bytes, with REAL captures, are accepted", () => {
    // Every other assertion for this AC passes `{ required: [] }` — an evidence
    // input with nothing captured. On its own that cannot tell "counts unbacked
    // by a capture" from "an evidence argument was supplied at all": a
    // regression collapsing the branch to the latter stays green across all of
    // them. This is the sibling that discriminates.
    //
    // Genuine captures, in the shape `deliver_stage_evidence.ts` takes: real
    // runner bytes that parse to the counts the clean report states, so
    // "captured" here means bytes a runner really emitted, not a truthy stub.
    const gateRun: CapturedRun = {
      command: "bun test",
      output: [
        " 8067 pass",
        " 16 skip",
        " 0 fail",
        " Ran 8083 tests across 214 files. [12.40s]",
      ].join("\n"),
      stack: "bun",
    };
    const driveRun: CapturedRun = {
      command: "bun test tests/deliver/",
      output: [
        " 12 pass",
        " 0 fail",
        " Ran 12 tests across 3 files. [0.31s]",
      ].join("\n"),
      stack: "bun",
    };
    // The bytes are genuine: they parse, and to the numbers the report states.
    const gateParsed = parseTestOutput(gateRun.output, gateRun.stack);
    const driveParsed = parseTestOutput(driveRun.output, driveRun.stack);
    expect(gateParsed.ok).toBe(true);
    expect(driveParsed.ok).toBe(true);
    expect(gateParsed.ok && gateParsed.count.total - 0 - 16).toBe(8067);
    expect(driveParsed.ok && driveParsed.count.total).toBe(12);
    expect(CLEAN).toContain("pass 8067, fail 0, skip 16");
    expect(CLEAN).toContain("pass 12, fail 0, skip 0");

    // ONE report, graded twice. `e2e` states no counts in the model capture, so
    // nothing traces back to a run there and none is offered.
    const report = CLEAN;
    const withCaptures = verifyStageStatusBlock(report, {
      gate: gateRun,
      drive: driveRun,
      e2e: null,
      required: ["gate", "drive"],
    });
    const nothingCaptured = verifyStageStatusBlock(report, { required: [] });

    expect(withCaptures.reasons).toEqual([]);
    expect(withCaptures.ok).toBe(true);
    expect(nothingCaptured.ok).toBe(false);

    // THE DISCRIMINATING FACT: the same report bytes, the same evidence
    // ARGUMENT POSITION, opposite verdicts. Either verdict alone is satisfied
    // by a constant function; the disagreement is not.
    expect(withCaptures.ok).not.toBe(nothingCaptured.ok);
    expect(nothingCaptured.reasons.length).toBeGreaterThan(
      withCaptures.reasons.length,
    );
  });

  test("the verdict shape is identical to a structural violation's", () => {
    const structural = verifyStageStatusBlock(dropSection(CLEAN, "drive"));
    const invented = verifyStageStatusBlock(CLEAN, { required: [] });
    // Same keys, same types, same channel — no second severity, no second
    // budget, no throw. `/deliver`'s existing recovery path reads both.
    expect(Object.keys(invented).sort()).toEqual(Object.keys(structural).sort());
    expect(typeof invented.ok).toBe(typeof structural.ok);
    expect(Array.isArray(invented.reasons)).toBe(true);
    expect(() => verifyStageStatusBlock(CLEAN, { required: [] })).not.toThrow();
  });
});

describe("AC-STE-532.6 — the fence walk is DELEGATED, never re-implemented", () => {
  test("the module imports `findFences` from the shipped primitives", () => {
    const src = MODULE_SOURCE();
    expect(src).toMatch(
      /import\s*\{[^}]*\bfindFences\b[^}]*\}\s*from\s*["']\.\/markdown_fences["']/s,
    );
    expect(src).toContain("findFences(");
  });

  test("it declares no fence finder of its own", () => {
    const src = MODULE_SOURCE();
    expect(src).not.toMatch(/function\s+\w*[Ff]ind\w*[Ff]ence/);
    expect(src).not.toMatch(/\.(startsWith|endsWith|indexOf|includes)\(\s*["'`]```/);
  });

  test("no fence bytes are scanned outside a named marker constant", () => {
    // A behavioural-only assertion would pass against a copy-paste second
    // parser — the two-renderers defect this repo has already recorded. So the
    // SOURCE is the subject: any line touching a fence marker must be a comment
    // or a named `*FENCE*` constant handed to `findFences`, never inline
    // scanning code.
    for (const line of MODULE_SOURCE().split("\n")) {
      if (!line.includes("```")) continue;
      const trimmed = line.trim();
      const allowed =
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        /^(export\s+)?const\s+\w*FENCE\w*\s*(:[^=]+)?=/.test(trimmed) ||
        line.includes("findFences(");
      expect({ line, allowed }).toEqual({ line, allowed: true });
    }
  });
});

describe("AC-STE-532.7 — mutation-verified, each mutation asserted to have APPLIED", () => {
  test("MUTATION 1 (targets AC-STE-532.1's clean-report assertion): remove the fence", () => {
    // APPLIED? The clean report has exactly one fence; the mutant has none —
    // while still carrying the literal token in prose, so a token-grep
    // predicate could not tell them apart.
    expect(NO_FENCE).not.toBe(CLEAN);
    expect(findFences(CLEAN, FENCE_OPEN_RE, FENCE_CLOSE_RE).length).toBe(1);
    expect(findFences(NO_FENCE, FENCE_OPEN_RE, FENCE_CLOSE_RE).length).toBe(0);
    expect(NO_FENCE).toContain("deliver-stage-result");

    // EFFECT: AC-STE-532.1's `ok === true` on the clean report goes red here.
    expect(verifyStageStatusBlock(CLEAN).ok).toBe(true);
    expect(verifyStageStatusBlock(NO_FENCE).ok).toBe(false);
  });

  test("MUTATION 2 (targets AC-STE-532.2's fixed-order assertion): swap two sections", () => {
    const swapped = swapSections(CLEAN, "gate", "drive");

    // APPLIED? Different bytes, same section MULTISET — a reorder, not a drop,
    // so the order clause is the only thing that can refuse it.
    expect(swapped).not.toBe(CLEAN);
    expect(sectionOrder(swapped)).not.toEqual(sectionOrder(CLEAN));
    expect(sectionOrder(swapped).slice().sort()).toEqual(
      sectionOrder(CLEAN).slice().sort(),
    );
    expect(fenceBody(swapped).length).toBe(fenceBody(CLEAN).length);

    // EFFECT: AC-STE-532.2's order clause fires, naming a swapped section.
    expect(verifyStageStatusBlock(CLEAN).ok).toBe(true);
    const verdict = verifyStageStatusBlock(swapped);
    expect(verdict.ok).toBe(false);
    expect(
      namesSection(verdict.reasons, "gate") ||
        namesSection(verdict.reasons, "drive"),
    ).toBe(true);
  });

  test("MUTATION 3 (targets AC-STE-532.3's whole-span assertion): delete the prose lead-in", () => {
    const long = insertNarration(CLEAN, 40);
    const fenceOnly = stripProse(long);

    // APPLIED? The measured span shrank by exactly the prose that was deleted,
    // and the fence itself is byte-identical on both sides.
    expect(fenceOnly).not.toBe(long);
    expect(lineCount(long) - lineCount(fenceOnly)).toBe(fenceOpenIndex(long));
    expect(fenceOpenIndex(long)).toBeGreaterThan(40);
    expect(fenceBody(fenceOnly)).toEqual(fenceBody(long));

    // EFFECT: AC-STE-532.3's cap refusal — present while the prose is inside
    // the measured span — disappears once the prose is not measured. That is
    // precisely the fence-only measurement the AC exists to reject.
    expect(verifyStageStatusBlock(long).reasons.some(isCapReason)).toBe(true);
    expect(verifyStageStatusBlock(fenceOnly).reasons.some(isCapReason)).toBe(
      false,
    );
  });
});

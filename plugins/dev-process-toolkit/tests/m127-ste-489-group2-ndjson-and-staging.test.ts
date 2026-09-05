// M127 STE-489 — fixture group 2: NDJSON-safe matching and subject-isolating
// staging.
//
// ===========================================================================
// WHAT WAS MEASURED BEFORE A BYTE WAS EDITED
// ===========================================================================
//
// The three real 2026-08-16 `linear` captures
// (`/tmp/dpt-smoke-linear-ste221-{positive,control,alias}.log`) were run
// through the group's own shipped assertion and through `extractAssistantText`.
//
// RAW counts (`grep -Ec`, whole-file, the surface the shipped grep reads):
//
//                                        | 2a positive | 2b control | 2c alias
//   ADVISORY.*probe.*26|probe.*26.*ADV…  |      2      |     0      |    0
//   #26                                  |      2      |     2      |    2
//   probe 26                             |      0      |     0      |    0
//   ADVISORY                             |      2      |     0      |    0
//   GATE FAILED                          |     12      |    14      |   12
//   toolkit_bootstrap_committed          |      0      |    18      |    0
//   needs_technical_review_consistency   |      2      |    18      |    2
//
// THE DEFECT, IN ONE RUN. 2a matched TWICE while the word `probe` followed by
// `26` occurs ZERO times anywhere in the capture — the `.` ran straight through
// JSON-encoded newlines (in raw NDJSON `\` + `n` are two ordinary characters,
// and `.` matches both) and spanned unrelated paragraphs. 2c matched NOTHING
// even though its probe behaved correctly and saw the deprecated alias. One
// spurious pass and one false failure, same assertion, same run, opposite
// directions: the method is at fault, not the subject.
//
// ASSISTANT-SCOPED, the three sub-fixtures render probe #26 in THREE shapes
// inside ONE run:
//
//   2a: `- **#26 \`tracker-project-milestone-attached\` — 1 pass, 1 advisory.**`
//   2b: `**#26 \`tracker-project-milestone-attached\` — GATE FAILED**`
//   2c: `- **Probe #26 \`tracker-project-milestone-attached\` (capability-gap downgrade)**`
//
// So the two row-key shapes are `**#26 ` and `**Probe #26 `, and an `any-of`
// over BOTH is the only form that covers all three — either alone misses at
// least one sub-fixture. That is fixture 3c's and STE-488's shape, arrived at
// here from a SAME-RUN inversion rather than a cross-run one, which is the
// stronger evidence of the two. The runtime never writes the word `probe`
// followed by `26`: `#26` is the identifier form (AC-STE-489.2).
//
// 2c CARRIES NO `ADVISORY` AT ALL (assistant 0, raw 0). Its downgrade is
// rendered as `(capability-gap downgrade)` plus the alias key. So "swap the
// broken regex for the literal `ADVISORY`" is NOT the repair — it would leave
// 2c red for a second, different wrong reason.
//
// F12 — THE STAGING. Staging a minimal UNCOMMITTED FR under `specs/frs/`,
// carrying only a `## Notes` body, is what all three sub-fixtures prescribe,
// and it independently trips probe #22 `toolkit_bootstrap_committed` (an
// uncommitted toolkit-managed spec file) and probe #40
// `needs_technical_review_consistency` (no `## Technical Design`, no
// `## Testing`) — eighteen renderings of each in the 2b capture. 2b then
// asserted the AGGREGATE `GATE FAILED`, which is present in ALL THREE captures
// (12 / 14 / 12) — including the two where probe #26 did NOT fail. That
// assertion cannot go red for 2b's own subject and cannot stay green for it
// either; it passed only because probe #26's row happened to be independently
// readable, which is not a thing it checks.
//
// ===========================================================================
// THE CONTRACT THIS FILE PINS
// ===========================================================================
//
// Every group-2 assertion against an `ste221` capture runs through
// `capability_row_assert`, which parses the NDJSON and decides on the
// assistant-text projection — a surface on which an encoded newline is a real
// newline and a pattern structurally CANNOT span one. No `grep` survives on
// those logs.
//
// Per sub-fixture, two clauses, mirroring STE-488's 9a/9b shape:
//
//   · an IDENTIFIER clause — `any-of` over the two rendered row shapes, so
//     probe #26's own ROW surfaced. Delimited on the leading side (`**` /
//     `**Probe `), per the STE-488 lesson that a bare key is
//     substring-satisfiable by a sibling.
//   · a SUBJECT clause — the thing THIS sub-fixture is about, and nothing else:
//     2a the canonical capability key, 2c the deprecated alias, 2b probe #26's
//     own row carrying the failure (AC-STE-489.4) rather than the aggregate.
//
// CROSS-SUBJECT ISOLATION IS HALF THE TEST. The identifier clause is true in
// all three sub-fixtures by design — probe #26 fires in each. It is the SUBJECT
// clause that has to discriminate, so each one is executed against ALL THREE
// shipped captures and must exit 0 on its own and NON-ZERO on both siblings.
// 2b's is the decisive one: the retired aggregate form exits 0 on all three,
// and this test is what a re-key back onto it would fail.
//
// Three reduced captures ship beside the existing fixtures, preserving every
// count quoted above INCLUDING the zeros — the zeros are the evidence that the
// retired assertion was broken in both directions.
//
// The staging is checked by EXECUTING the two probe modules against a real
// throwaway git project: the retired staging trips both, the shipped staging
// trips neither. The staged FR's body is EXTRACTED from the SKILL's own fenced
// template rather than retyped here, for the reason STE-483 gives — a private
// copy keeps reporting green after the SKILL drifts away from it.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FALSIFIABILITY_FIXTURE_DIR,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  SMOKE_SKILL_RELATIVE_PATH,
  bindCapture,
  checkRepairClauses,
  harnessOutcomeFor,
  runAssertion,
  uncoveredRepairs,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";
import { extractAssistantText } from "../adapters/_shared/src/smoke_child_capture";
import { runToolkitBootstrapCommittedProbe } from "../adapters/_shared/src/toolkit_bootstrap_committed";
import { runNeedsTechnicalReviewConsistencyProbe } from "../adapters/_shared/src/needs_technical_review_consistency";
import { SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";

// ───────────────────────────── fixed anchors ──────────────────────────────

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL_PATH = join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH);

const read = (p: string): string => readFileSync(p, "utf8");
const smokeSkill = (): string => read(SMOKE_SKILL_PATH);

/** The three reduced `linear` captures this FR ships. */
const FIXTURES = {
  positive: join(FALSIFIABILITY_FIXTURE_DIR, "gate-check-ste221-positive-linear.ndjson"),
  control: join(FALSIFIABILITY_FIXTURE_DIR, "gate-check-ste221-control-linear.ndjson"),
  alias: join(FALSIFIABILITY_FIXTURE_DIR, "gate-check-ste221-alias-linear.ndjson"),
} as const;

/** The exact pattern the retired assertion carried, kept as a permanent record. */
const RETIRED_PATTERN = "ADVISORY.*probe.*26|probe.*26.*ADVISORY";

/** The two capability keys the group stages, and the deprecated one. */
const CANONICAL_KEY = "milestone_attach_skipped_adapter_limit";
const DEPRECATED_ALIAS = "milestone_attach_unavailable";
/**
 * Probe #26's own id, in the two spellings the runtime renders.
 *
 * STE-564 re-keyed every identifier clause in this group off the `**#26 ` /
 * `**Probe #26 ` row decorations and onto these — the decorations fell to ZERO
 * occurrences across five 2026-09-05 captures when STE-532/533 standardised
 * probe-row rendering, while probe #26 stayed healthy.
 */
const PROBE_26_NAMES = [
  "tracker-project-milestone-attached",
  "tracker_project_milestone_attached",
] as const;

/** The two probe ids the retired staging tripped. */
const STAGING_PROBE_KEYS = [
  "toolkit_bootstrap_committed",
  "needs_technical_review_consistency",
] as const;

// ───────────────────────── markdown structure helpers ─────────────────────

/** Blank fenced lines, preserving line count, so inline scanning cannot trip. */
function maskFences(body: string): string {
  const fence = /^[ \t]*(```|~~~)/;
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      const isFence = fence.test(line);
      const blank = isFence || inFence;
      if (isFence) inFence = !inFence;
      return blank ? "" : line;
    })
    .join("\n");
}

/**
 * Markdown section from the heading matching `pred` to the next equal-or-
 * shallower one, SKIPPING fenced blocks — a bash fence in this SKILL opens with
 * a `# …` comment and a naive stop regex truncates the slice (the STE-487
 * lesson).
 */
function sectionByHeading(body: string, pred: (line: string) => boolean): string {
  const lines = body.split("\n");
  const fence = /^\s*(```|~~~)/;
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && pred(l));
  if (start < 0) return "";
  const depth = (lines[start] as string).match(/^#+/)![0].length;
  const stop = new RegExp(`^#{1,${depth}} `);
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (fence.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && stop.test(line)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

const section = (heading: string): string => {
  const re = new RegExp(`^#{1,6} ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const body = sectionByHeading(smokeSkill(), (l) => re.test(l));
  expect(body.length).toBeGreaterThan(100); // the anchor still resolves
  return body;
};

const group2 = () => section("Fixture group 2");
const fixture2a = () => section("Sub-fixture 2a");
const fixture2b = () => section("Sub-fixture 2b");
const fixture2c = () => section("Sub-fixture 2c");

/**
 * Inline code spans, matching a run of N backticks with the next run of exactly
 * N — so a double-backtick span whose body carries single backticks (the shape
 * a row-scoped arm needs, since the rendered row contains the probe key in
 * backticks) survives intact.
 */
function inlineSpans(body: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== "`") {
      i += 1;
      continue;
    }
    let open = i;
    while (open < body.length && body[open] === "`") open += 1;
    const width = open - i;
    let j = open;
    let closed = -1;
    while (j < body.length) {
      if (body[j] !== "`") {
        j += 1;
        continue;
      }
      let run = j;
      while (run < body.length && body[run] === "`") run += 1;
      if (run - j === width) {
        closed = j;
        break;
      }
      j = run;
    }
    if (closed === -1) {
      i = open;
      continue;
    }
    spans.push(body.slice(open, closed).trim());
    i = closed + width;
  }
  return spans;
}

/** Fenced block BODIES inside a section. */
function fencedBlocks(body: string): string[] {
  const out: string[] = [];
  const fence = /^[ \t]*(```|~~~)/;
  let current: string[] | null = null;
  for (const line of body.split("\n")) {
    if (fence.test(line)) {
      if (current === null) current = [];
      else {
        out.push(current.join("\n"));
        current = null;
      }
      continue;
    }
    if (current !== null) current.push(line);
  }
  return out;
}

/** Every executable assertion span in a section that reads an `ste221` capture. */
const ste221Spans = (sectionBody: string): string[] =>
  inlineSpans(maskFences(sectionBody)).filter(
    (s) => s.includes("ste221-") && s.includes("CAP_ASSERT"),
  );

/** The one span in a sub-fixture that names `needle`. Zero or many is a defect. */
function spanNaming(sectionBody: string, needle: string): string {
  const hits = ste221Spans(sectionBody).filter((s) => s.includes(needle));
  expect(hits.length).toBe(1);
  return hits[0] as string;
}

/** A sub-fixture's IDENTIFIER clause: names probe #26, names no outcome subject. */
function identifierSpan(sectionBody: string): string {
  const hits = ste221Spans(sectionBody).filter(
    (s) =>
      s.includes(PROBE_26_NAMES[0]) &&
      !s.includes(CANONICAL_KEY) &&
      !s.includes(DEPRECATED_ALIAS),
  );
  expect(hits.length).toBe(1);
  return hits[0] as string;
}

/**
 * Each sub-fixture's SUBJECT clause — the one that has to discriminate.
 *
 * 2b's is located by the CANONICAL KEY like its siblings, because STE-564
 * turned it into an ABSENCE over both capability keys: the control is the
 * capture in which neither key was read back, which is exactly what separates
 * it from 2a (canonical key present) and 2c (alias present). It used to be
 * located by `GATE FAILED`, which the clause no longer carries.
 */
const subjectSpans = () => ({
  positive: spanNaming(fixture2a(), CANONICAL_KEY),
  control: spanNaming(fixture2b(), CANONICAL_KEY),
  alias: spanNaming(fixture2c(), DEPRECATED_ALIAS),
});

// ───────────────────────────── execution helpers ──────────────────────────

/** Run one extracted span against one shipped capture; return its exit code. */
function runSpanOn(shell: string, capturePath: string): number {
  return runAssertion(bindCapture(shell, capturePath)).exitCode;
}

/**
 * `grep -Ec` over the RAW capture bytes — the surface the retired form read.
 *
 * A MISSING file throws rather than counting 0: `grep … || true` on a
 * non-existent path prints nothing, and a silent 0 would let "the retired
 * pattern matched nothing on 2c" read as satisfied by an absent fixture — the
 * exact "mutation never applied" class STE-483 exists to rule out.
 */
function rawGrepCount(pattern: string, file: string): number {
  if (!existsSync(file)) throw new Error(`ste221 fixture missing: ${file}`);
  const proc = spawnSync("bash", ["-c", `grep -Ec ${JSON.stringify(pattern)} ${JSON.stringify(file)} || true`], {
    encoding: "utf8",
  });
  const n = Number.parseInt((proc.stdout ?? "").trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Occurrences of `needle` in a capture's assistant-text projection. */
function assistantHits(capturePath: string, needle: string): number {
  return extractAssistantText(read(capturePath)).split(needle).length - 1;
}

const tempDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** Commit everything in `dir`, hooks and signing off. */
function commitAll(dir: string, subject: string): void {
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--no-verify", "-m", subject]);
}

/**
 * A throwaway toolkit-MANAGED consumer project: a git repo carrying the setup
 * marker in `CLAUDE.md` and a `specs/` tree, everything committed and clean.
 * Both probes are vacuous without the marker, so it is load-bearing.
 */
function tempProject(): string {
  const dir = scratch("ste489-proj-");
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  for (const [k, v] of [
    ["user.email", "ste489@example.invalid"],
    ["user.name", "STE-489 harness"],
    ["commit.gpgsign", "false"],
  ]) {
    execFileSync("git", ["-C", dir, "config", k as string, v as string]);
  }
  writeFileSync(join(dir, "CLAUDE.md"), `# Project\n\n${SETUP_MARKER}\n`, "utf8");
  mkdirSync(join(dir, "specs", "frs"), { recursive: true });
  writeFileSync(join(dir, "specs", "requirements.md"), "# Requirements\n", "utf8");
  commitAll(dir, "chore: bootstrap");
  return dir;
}

/** Both staging probes' violation counts for one project root. */
async function stagingProbeViolations(
  projectRoot: string,
): Promise<{ bootstrap: number; needsTechnicalReview: number }> {
  const [bootstrap, ntr] = await Promise.all([
    runToolkitBootstrapCommittedProbe(projectRoot),
    runNeedsTechnicalReviewConsistencyProbe(projectRoot),
  ]);
  return {
    bootstrap: bootstrap.violations.length,
    needsTechnicalReview: ntr.violations.length,
  };
}

/**
 * The staged-FR body the SKILL itself prescribes, EXTRACTED rather than
 * retyped. A test-local copy would keep reporting green after the SKILL drifted
 * away from it — the failure mode STE-483's method exists to prevent.
 */
function stagedFrTemplate(): string {
  const blocks = fencedBlocks(group2()).filter(
    (b) => b.includes("## Notes") && b.includes("## Technical Design") && b.includes("## Testing"),
  );
  expect(blocks.length).toBe(1);
  return blocks[0] as string;
}

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-489.1 — the patterns cannot span encoded newlines. 2a stops matching
//                spuriously; 2c, whose probe was correct all along, matches.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-489.1 — group 2's matching is NDJSON-safe in both directions", () => {
  test("PERMANENT RECORD — the retired pattern was wrong in BOTH directions on one run", () => {
    // Kept so the next reader cannot re-derive the false conclusion that one of
    // the two sub-fixtures was simply flaky. On the 2a capture the pattern
    // matches while the word `probe` followed by 26 occurs nowhere in the file:
    // the `.` walked through JSON-encoded newlines. On the 2c capture, whose
    // probe behaved correctly, it matches nothing at all.
    expect(rawGrepCount(RETIRED_PATTERN, FIXTURES.positive)).toBeGreaterThanOrEqual(1);
    expect(rawGrepCount(RETIRED_PATTERN, FIXTURES.alias)).toBe(0);
    for (const f of Object.values(FIXTURES)) expect(rawGrepCount("probe 26", f)).toBe(0);
  });

  test("the retired pattern is gone from the SKILL", () => {
    const body = group2();
    expect(body).not.toContain(RETIRED_PATTERN);
    expect(body).not.toContain("ADVISORY.*probe");
    expect(body).not.toContain("probe.*26");
  });

  test("no group-2 assertion greps an ste221 capture — every one is assistant-scoped", () => {
    // `capability_row_assert` parses the NDJSON and decides on the assistant-text
    // projection, where an encoded newline IS a newline. A pattern there cannot
    // span one; a `grep` over raw bytes always can.
    const body = maskFences(group2());
    for (const span of inlineSpans(body)) {
      if (!span.includes("ste221-")) continue;
      if (!span.includes("exit") && !span.includes("CAP_ASSERT") && span.includes("claude -p")) {
        continue; // the invocation/capture spans, not assertions
      }
      if (span.includes("grep")) {
        throw new Error(`group 2 still greps a capture: ${span}`);
      }
    }
    expect(ste221Spans(fixture2a()).length).toBeGreaterThanOrEqual(2);
    expect(ste221Spans(fixture2c()).length).toBeGreaterThanOrEqual(2);
  });

  test("EXECUTION — 2a's clauses pass on 2a's capture (no longer for the wrong reason)", () => {
    expect(runSpanOn(identifierSpan(fixture2a()), FIXTURES.positive)).toBe(0);
    expect(runSpanOn(subjectSpans().positive, FIXTURES.positive)).toBe(0);
  });

  test("EXECUTION — 2c now matches, where the retired pattern gave a false RED", () => {
    // The half that was a FALSE FAILURE: probe #26 honoured the STE-198
    // deprecation window in this capture and the assertion said otherwise.
    expect(runSpanOn(identifierSpan(fixture2c()), FIXTURES.alias)).toBe(0);
    expect(runSpanOn(subjectSpans().alias, FIXTURES.alias)).toBe(0);
  });

  test("the alias capture carries NO `ADVISORY` — so keying 2c on it is not the repair", () => {
    // Measured 0 assistant-scoped AND 0 raw. Swapping the broken regex for the
    // literal `ADVISORY` would leave 2c red for a second, different wrong reason.
    expect(assistantHits(FIXTURES.alias, "ADVISORY")).toBe(0);
    expect(subjectSpans().alias).not.toContain("ADVISORY");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-489.2 — the assertions name the identifier the runtime RENDERS.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-489.2 — `#26`, not the word `probe` followed by 26", () => {
  test("both identifier clauses are an any-of over ≥ 2 rendered id spellings", () => {
    // Single-literal re-keying is how fixture 3c drifted three times: the SAME
    // jira leg rendered probe #37's id underscored 17 / hyphenated 0 in July and
    // underscored 0 / hyphenated 2 in August. The two-arm discipline survives
    // STE-564 unchanged; what changed is WHAT the arms name.
    for (const shell of [identifierSpan(fixture2a()), identifierSpan(fixture2c())]) {
      expect(shell).toContain("CAP_ASSERT");
      // TOKEN-BOUNDED, which is where the delimiter comes from now. STE-488
      // needed a LEADING delimiter against the substring hazard and the only
      // one available was the `**` row marker; borrowing a shape from the
      // runtime's prose is what made the arm a hostage to how that prose is
      // drawn. The matcher supplies the boundary instead.
      expect(shell).toContain("any-of-token");
      const arms = PROBE_26_NAMES.filter((name) => shell.includes(name));
      expect(arms.length).toBe(2);
      // No arm carries a row decoration — the subject, not the rendering.
      for (const arm of arms) {
        expect(arm.includes("**")).toBe(false);
        expect(/#\d/.test(arm)).toBe(false);
      }
    }
  });

  test("the two rendered shapes are the ones the captures actually carry", () => {
    expect(assistantHits(FIXTURES.positive, "**#26 ")).toBeGreaterThanOrEqual(1);
    expect(assistantHits(FIXTURES.control, "**#26 ")).toBeGreaterThanOrEqual(1);
    expect(assistantHits(FIXTURES.alias, "**Probe #26 ")).toBeGreaterThanOrEqual(1);
    // …and the shape 2c renders is NOT the shape 2a renders, which is why one
    // arm cannot cover the group.
    expect(assistantHits(FIXTURES.alias, "**#26 ")).toBe(0);
  });

  test("nothing in group 2 asks for the word `probe` followed by 26", () => {
    const body = group2();
    for (const span of inlineSpans(maskFences(body))) {
      expect(/probe[^#a-zA-Z]{0,4}26/i.test(span)).toBe(false);
    }
  });

  test("the shipped captures ship at all, and preserve the measured zeros", () => {
    for (const f of Object.values(FIXTURES)) expect(existsSync(f)).toBe(true);
    expect(assistantHits(FIXTURES.positive, CANONICAL_KEY)).toBeGreaterThanOrEqual(1);
    expect(assistantHits(FIXTURES.positive, DEPRECATED_ALIAS)).toBe(0);
    expect(assistantHits(FIXTURES.control, CANONICAL_KEY)).toBe(0);
    expect(assistantHits(FIXTURES.control, DEPRECATED_ALIAS)).toBe(0);
    expect(assistantHits(FIXTURES.alias, DEPRECATED_ALIAS)).toBeGreaterThanOrEqual(1);
    expect(assistantHits(FIXTURES.alias, CANONICAL_KEY)).toBe(0);
    // The aggregate is present in ALL THREE — that is why AC.4 exists.
    for (const f of Object.values(FIXTURES)) {
      expect(assistantHits(f, "GATE FAILED")).toBeGreaterThanOrEqual(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-489.3 — the staging no longer trips probes #22 and #40, so the
//                group's verdict is attributable to its own subject.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-489.3 — the staging isolates the subject", () => {
  test("group 2 names both probes it used to trip, and why the staging changed", () => {
    const body = group2();
    for (const key of STAGING_PROBE_KEYS) expect(body).toContain(key);
    expect(body).toContain("#22");
    expect(body).toContain("#40");
  });

  test("the staged FR is COMMITTED, and the SKILL carries the template it stages", () => {
    const body = group2();
    expect(body).toContain("git commit");
    const template = stagedFrTemplate();
    expect(template).toContain("## Technical Design");
    expect(template).toContain("## Testing");
    expect(template).toContain("## Notes");
    // One placeholder for the per-sub-fixture capability key, so all three
    // sub-fixtures stage the SAME canonical shape and differ only in subject.
    expect(template).toContain("<KEY>");
    expect(template).not.toContain("needs_technical_review: true");
  });

  test("EXECUTION — the SHIPPED staging trips neither probe", async () => {
    const project = tempProject();
    const fr = stagedFrTemplate().split("<KEY>").join(CANONICAL_KEY);
    writeFileSync(join(project, "specs", "frs", "STE-FIX-A.md"), `${fr}\n`, "utf8");
    commitAll(project, "chore(specs): stage the group-2 fixture FR");

    const counts = await stagingProbeViolations(project);
    expect(counts.bootstrap).toBe(0);
    expect(counts.needsTechnicalReview).toBe(0);
  });

  test("FALSIFIABILITY — the RETIRED staging trips both, exactly as measured", async () => {
    // The uncommitted minimal `## Notes`-only FR the three sub-fixtures used to
    // prescribe. Without this half, "the shipped staging is clean" carries no
    // information: a probe that never fires on anything would read the same.
    const project = tempProject();
    writeFileSync(
      join(project, "specs", "frs", "STE-FIX-A.md"),
      `# Fixture\n\n## Notes\n\n${CANONICAL_KEY}\n`,
      "utf8",
    );

    const counts = await stagingProbeViolations(project);
    expect(counts.bootstrap).toBeGreaterThanOrEqual(1); // uncommitted
    expect(counts.needsTechnicalReview).toBeGreaterThanOrEqual(1); // no canonical sections
  });

  test("FALSIFIABILITY — each half of the repair is independently load-bearing", async () => {
    // Committed but NOT canonical-shaped ⇒ #40 alone fires. Canonical-shaped but
    // NOT committed ⇒ #22 alone fires. Neither change on its own is the repair,
    // and a future simplification that drops one would be caught here.
    const shapeOnly = tempProject();
    writeFileSync(
      join(shapeOnly, "specs", "frs", "STE-FIX-A.md"),
      `# Fixture\n\n## Notes\n\n${CANONICAL_KEY}\n`,
      "utf8",
    );
    commitAll(shapeOnly, "chore(specs): stage a non-canonical FR");
    const shapeCounts = await stagingProbeViolations(shapeOnly);
    expect(shapeCounts.bootstrap).toBe(0);
    expect(shapeCounts.needsTechnicalReview).toBeGreaterThanOrEqual(1);

    const commitOnly = tempProject();
    const fr = stagedFrTemplate().split("<KEY>").join(CANONICAL_KEY);
    writeFileSync(join(commitOnly, "specs", "frs", "STE-FIX-A.md"), `${fr}\n`, "utf8");
    const commitCounts = await stagingProbeViolations(commitOnly);
    expect(commitCounts.bootstrap).toBeGreaterThanOrEqual(1);
    expect(commitCounts.needsTechnicalReview).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-489.4 — 2b is re-keyed from the aggregate onto probe #26's own row.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-489.4 — 2b measures its own subject, not the staging artefact", () => {
  test("2b's clause names the control's own subject: NEITHER capability key", () => {
    // STE-564. The control stages no milestone-attach key, so what makes it
    // the control is that probe #26 read neither one back. Paired with the
    // identifier clause — which proves the probe surfaced at all — that is
    // 2b's subject, and it carries no row decoration to go stale.
    const shell = subjectSpans().control;
    expect(shell).toContain("CAP_ASSERT");
    expect(shell).toContain("absent-token");
    expect(shell).toContain(CANONICAL_KEY);
    expect(shell).toContain(DEPRECATED_ALIAS);
    expect(shell.includes("**")).toBe(false);
  });

  test("PERMANENT RECORD — the retired aggregate is present in ALL THREE captures", () => {
    // Which is the whole defect: `GATE FAILED` alone cannot distinguish 2b's
    // subject failing from anything else on the run failing, and could not have
    // gone red for 2b however well or badly probe #26 behaved.
    for (const f of Object.values(FIXTURES)) {
      expect(assistantHits(f, "GATE FAILED")).toBeGreaterThanOrEqual(1);
    }
  });

  test("EXECUTION — 2b's clause passes on the control capture", () => {
    expect(runSpanOn(subjectSpans().control, FIXTURES.control)).toBe(0);
  });

  test("FALSIFIABILITY — it FAILS on the two captures where probe #26 did not fail", () => {
    // The decisive half. A re-key back onto the bare aggregate exits 0 here.
    expect(runSpanOn(subjectSpans().control, FIXTURES.positive)).not.toBe(0);
    expect(runSpanOn(subjectSpans().control, FIXTURES.alias)).not.toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// CROSS-SUBJECT ISOLATION — a clause is not isolated because it passes on its
// own capture, only because it also FAILS on one where its subject was absent.
// This is the pin that caught STE-488's false green after two implementer
// passes and a refactor had all reported the re-key clean.
// ══════════════════════════════════════════════════════════════════════════

describe("cross-subject isolation — every subject clause fails on both siblings", () => {
  const CAPTURES = ["positive", "control", "alias"] as const;

  for (const own of CAPTURES) {
    test(`2${own === "positive" ? "a" : own === "control" ? "b" : "c"}'s subject clause passes on its OWN capture and fails on the others`, () => {
      const shell = subjectSpans()[own];
      for (const against of CAPTURES) {
        const code = runSpanOn(shell, FIXTURES[against]);
        if (against === own) expect(code).toBe(0);
        else expect(code).not.toBe(0);
      }
    });
  }

  test("the identifier clause is deliberately NOT the discriminator", () => {
    // Probe #26 fires in all three sub-fixtures, so its row is present in all
    // three captures — as it must be. Recorded explicitly so nobody later
    // "fixes" the identifier clause into a discriminator it cannot be, or reads
    // its cross-capture pass as the isolation failure it is not.
    const shell = identifierSpan(fixture2a());
    expect(runSpanOn(shell, FIXTURES.positive)).toBe(0);
    expect(runSpanOn(shell, FIXTURES.control)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-489.5 — STE-483's harness proves each repaired assertion fails when
//                its own subject misbehaves, in both directions. STE-489 is
//                the LAST repair, so the registry must now be complete.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-489.5 — the falsifiability harness carries an STE-489 row", () => {
  const ste489 = (): RepairEntry | undefined => M127_REPAIRS.find((e) => e.id === "STE-489");

  test("STE-489 is registered and the registry is now COMPLETE", () => {
    expect(M127_REPAIR_ROSTER).toContain("STE-489");
    expect(ste489()).toBeDefined();
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).toEqual([]);
  });

  test("the row measures all THREE sub-fixtures, each against its OWN capture", () => {
    // Folding them onto one capture sends two thirds of the row vacuous BY
    // MEASUREMENT while it still reads as registered (the STE-488 lesson).
    const entry = ste489() as RepairEntry;
    const clauses = [entry, ...(entry.clauses ?? [])];
    expect(clauses.length).toBeGreaterThanOrEqual(3);

    const sections = clauses.map((c) => c.site.section);
    for (const sub of ["2a", "2b", "2c"]) {
      expect(sections.some((s) => s.includes(sub))).toBe(true);
    }

    const captures = new Set(
      clauses.map((c) => (c as { capture?: string }).capture ?? entry.capture ?? ""),
    );
    expect(captures.size).toBeGreaterThanOrEqual(3);
    for (const basename of Object.values(FIXTURES).map((p) => p.split("/").pop() as string)) {
      expect([...captures]).toContain(basename);
    }
  });

  test("EVERY clause scores by exit code — stdout-count is provably vacuous here", () => {
    // `capability_row_assert` prints a one-line VERDICT and signals through its
    // exit status; on stdout both halves read as 1 line and every pair would be
    // 1-vs-1 (the STE-485 lesson).
    const entry = ste489() as RepairEntry;
    expect(entry.scoreBy).toBe("exit-code");
    for (const clause of entry.clauses ?? []) expect(clause.scoreBy).toBe("exit-code");
  });

  test("extract → bind → run against LIVE SKILL bytes: every clause is falsifiable", () => {
    const results = checkRepairClauses(ste489() as RepairEntry, smokeSkill());
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const r of results) {
      expect(r.removed).toBeGreaterThan(0); // the mutation genuinely applied
      expect(r.verdict).toBe("falsifiable");
    }
    expect(harnessOutcomeFor(results)).toBe("harness-fails");
  });

  test("the present half really clears the bar and the absent half really does not", () => {
    const entry = ste489() as RepairEntry;
    const thresholds = [entry, ...(entry.clauses ?? [])].map((c) => c.threshold);
    const results = checkRepairClauses(entry, smokeSkill());
    expect(results.length).toBe(thresholds.length);
    results.forEach((r, i) => {
      expect(r.presentCount).toBeGreaterThanOrEqual(thresholds[i] as number);
      expect(r.absentCount).toBeLessThan(thresholds[i] as number);
    });
  });
});

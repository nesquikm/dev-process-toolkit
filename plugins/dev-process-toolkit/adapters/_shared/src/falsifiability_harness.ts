// falsifiability_harness — prove a repaired smoke assertion can actually FAIL.
//
// WHY THIS MODULE EXISTS. M127 repairs six assertions in
// `.claude/skills/smoke-test/SKILL.md`. Each of them has been passing (or
// failing) for the wrong reason, so "the repaired assertion now reads green"
// is not evidence. The only evidence is: take the subject away and watch the
// assertion go red — and watch it go green again when the subject is there.
//
// THREE METHOD CONSTRAINTS, all load-bearing:
//
//  1. EXTRACT-AND-EXECUTE. The shell form is sliced OUT OF the SKILL and those
//     exact bytes are executed. The harness never carries a paraphrase: a
//     private copy keeps reporting green after the SKILL drifts away from it,
//     which is precisely what the STE-456 AC.7 / STE-461 AC.12 method exists
//     to prevent. Hence a registry row names a SITE, never a `shell`.
//  2. MUTATE THE SUBJECT. A perfect pin on the wrong subject is worthless, so
//     a mutation that merely rewords nearby bytes is REFUSED, not scored.
//  3. COUNTS, NOT PRESENCE. A mutation that silently never applied leaves the
//     suite green and reads as a pass. Every comparison is over counts, and
//     the "did not apply" case throws rather than reaching a verdict.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The maintainer's smoke SKILL, relative to the repo root. */
export const SMOKE_SKILL_RELATIVE_PATH = ".claude/skills/smoke-test/SKILL.md";

/**
 * Where the shipped present-subject captures live. In the REPO, never `/tmp`:
 * the harness has to re-run offline, months after the conformance leg that
 * produced the originals has gone.
 */
export const FALSIFIABILITY_FIXTURE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "m127-falsifiability",
);

/** The conformance legs whose captures ship as fixtures. */
export type FalsifiabilityLeg = "linear" | "jira" | "none";

/** One shipped fixture, named by basename. The directory is never spelled twice. */
function fixturePath(basename: string): string {
  return join(FALSIFIABILITY_FIXTURE_DIR, basename);
}

/** The shipped present-subject capture for one leg. */
export function capturePathFor(leg: FalsifiabilityLeg): string {
  return fixturePath(`implement-${leg}.ndjson`);
}

/**
 * The shipped `/gate-check` capture in which probe #37 GENUINELY FIRED, for one
 * leg — a reduced slice of `/tmp/dpt-smoke-<leg>-ste222-probe.log` from the
 * 2026-08-16 conformance run, preserving every assistant-scoped count of the
 * originals. Fixture 3c's subject is a probe firing, not an `/implement` run,
 * so its rows resolve here rather than through `capturePathFor`.
 */
export function probeCapturePathFor(leg: FalsifiabilityLeg): string {
  return fixturePath(`gate-check-probe37-${leg}.ndjson`);
}

/**
 * Where in the SKILL an assertion's shell form lives. A section to slice and a
 * literal that selects one inline code span inside it — deliberately NOT the
 * shell itself, which would be the paraphrase this module forbids.
 */
export interface AssertionSite {
  readonly section: string;
  readonly select: string;
}

/**
 * How a run is turned into a number.
 *
 * `stdout-count` is the original contract and stays the default: a `grep -c`
 * form prints its count and the count IS the evidence.
 *
 * `exit-code` exists because `capability_row_assert` does not print a count at
 * all — it prints a one-line VERDICT (`present: ok key=present(assistant=1,…)`)
 * and signals through its exit status. Scored on stdout the verdict line reads
 * as "1 line" whether the expectation was met or not, so every CAP_ASSERT
 * clause would be 1-vs-1 and therefore VACUOUS by construction. Exit-code mode
 * scores 1 on exit 0 and 0 otherwise, which is the only reading that separates
 * the present half from the absent one.
 */
export type ScoreMode = "stdout-count" | "exit-code";

/**
 * Everything needed to score ONE assertion: where its bytes live, what subject
 * removal takes it down, the bar it has to clear, and how a run becomes a
 * number. A primary registry row and an extra clause are both this plus their
 * own identity fields, so one scorer serves both and the primary half of a
 * repair can never drift from its clauses.
 */
export interface ScorableClause {
  readonly site: AssertionSite;
  readonly subject: string;
  readonly threshold: number;
  /** Defaults to `stdout-count`. */
  readonly scoreBy?: ScoreMode;
  /**
   * Optional compound removal, for an `any-of` clause whose arms share NO
   * common substring. STE-485's verdict clause could name one subject
   * (`NOTES`, carried by `GATE PASSED WITH NOTES` too) and take the whole
   * any-of down with it. `"GATE FAILED"` and `error-severity` have no such
   * overlap, so removing either alone leaves the other arm standing and the
   * pair scores 1-vs-1 — vacuous, and vacuous for a reason that has nothing to
   * do with the assertion's health.
   *
   * A clause that supplies this still names the subject its `removed` count is
   * measured over, and every component still goes through `removeSubject`, so
   * a component that fails to apply THROWS rather than quietly weakening the
   * absent half. Build one with `removeAll`.
   */
  readonly mutate?: (capture: string) => string;
}

/**
 * A compound `mutate`: delete every listed subject in turn, each through
 * `removeSubject`, so a component that is not present in the capture throws
 * instead of leaving the absent half half-mutated.
 */
export function removeAll(
  subjects: readonly string[],
): (capture: string) => string {
  return (capture: string): string =>
    subjects.reduce((text, subject) => removeSubject(text, subject).text, capture);
}

/**
 * One EXTRA clause of the same repair — a second (third, …) assertion the FR
 * lands in the same section, scored against the same capture as its entry.
 * `label` names it; the result is id'd `<entry.id>/<label>`.
 */
export interface RepairClause extends ScorableClause {
  readonly label: string;
  /**
   * Fixture BASENAME override for THIS clause. Omitted, the clause is scored
   * against its entry's capture — which is right whenever the clauses are
   * halves of one fixture.
   *
   * STE-488 is the case that is not: 9a and 9b are separate sub-fixtures with
   * separate captures, and `plan_identity_mode_conditional` scores
   * assistant-0 against 9a's tracker-block log. Folding both onto one capture
   * would send 9b's clauses vacuous BY MEASUREMENT while the row still read as
   * registered.
   */
  readonly capture?: string;
}

/** One repair's falsifiability registration. Carries a site, never a shell. */
export interface RepairEntry extends ScorableClause {
  readonly id: string;
  readonly leg: FalsifiabilityLeg;
  /**
   * Fixture BASENAME override. A row whose subject is not an `/implement` run
   * names the capture it actually measures; omitted, the leg's `implement-`
   * capture is used and STE-484's row is unchanged.
   */
  readonly capture?: string;
  /** Extra clauses of the SAME repair, scored against the same capture. */
  readonly clauses?: readonly RepairClause[];
}

/**
 * Apply ONE level of the capture-override rule: a basename names a shipped
 * fixture, an omitted one falls through to whatever that level's default is.
 *
 * The rule now holds at two levels — an entry falls through to its leg's
 * `implement-` capture, a clause falls through to its entry's — and the two
 * differ ONLY in that fallback. Spelling the `basename ? fixturePath : …`
 * branch once keeps a future third level from acquiring a third, subtly
 * different reading of "omitted".
 */
function captureOrDefault(basename: string | undefined, fallback: string): string {
  return basename ? fixturePath(basename) : fallback;
}

/** The shipped capture a row measures: its `capture` override, or its leg's. */
export function resolveCapturePath(entry: RepairEntry): string {
  return captureOrDefault(entry.capture, capturePathFor(entry.leg));
}

/** The six FR ids M127 repairs, in plan order. */
export const M127_REPAIR_ROSTER: readonly string[] = [
  "STE-484",
  "STE-485",
  "STE-486",
  "STE-487",
  "STE-488",
  "STE-489",
];

/**
 * The registry. Starts empty and grows by one row as each repair lands; the
 * "zero uncovered" gate belongs to the milestone's final task.
 */
export const M127_REPAIRS: readonly RepairEntry[] = [
  {
    // STE-484 — fixture group 7's forked `tdd-result` hand-off count. The site
    // selects the runner invocation by the module it names; the two retired
    // grep forms live in the same section as history and must never be picked.
    id: "STE-484",
    site: {
      section: "Fixture group 7",
      select: "fork_tdd_result_assert.ts",
    },
    subject: "```tdd-result",
    leg: "linear",
    threshold: 3,
  },
  {
    // STE-485 — fixture 3c's two live clauses, scored against a capture in
    // which probe #37 genuinely fired. Both are `capability_row_assert`
    // invocations, so both signal through their EXIT CODE; scored on stdout
    // they would be 1-vs-1 and vacuous.
    //
    // The `none` leg is the capture on purpose. It is the leg on which the
    // hyphenated spelling never surfaces, so an any-of clause that still names
    // it is proved here to pass on the hardest of the three — and a single
    // subject removal takes the whole clause down, which is what makes the
    // absent half evidence rather than a rewording.
    id: "STE-485",
    site: {
      section: "Sub-fixture 3c",
      select: "cross-cutting-spec-stale-file-refs cross_cutting_spec_stale_file_refs",
    },
    subject: "cross_cutting_spec_stale_file_refs",
    leg: "none",
    capture: "gate-check-probe37-none.ndjson",
    threshold: 1,
    scoreBy: "exit-code",
    clauses: [
      {
        // The verdict half. `NOTES` is the subject because it is the substring
        // every rendered notes verdict on every leg carries — including inside
        // `GATE PASSED WITH NOTES` — so removing it retires the whole any-of.
        site: {
          section: "Sub-fixture 3c",
          select: '"GATE PASSED WITH NOTES" NOTES',
        },
        subject: "NOTES",
        threshold: 1,
        scoreBy: "exit-code",
        label: "verdict",
      },
    ],
  },
  {
    // STE-486 — § Phase 4's tracker-less claim-witness row, which now inherits
    // fixture 10a's sampling-gap carve-out instead of contradicting it.
    //
    // The capture is a `lock-samples` log, not an `/implement` one: this row's
    // subject is what the § Phase 2 step 3 sampler recorded, so it resolves
    // through `capture` rather than through the leg's default.
    //
    // `exit-code` is the only non-vacuous reading (the STE-485 lesson). The
    // runner prints a one-line VERDICT, so stdout counting reads 1 whether the
    // witness held or not and every half would score 1-vs-1.
    //
    // The ABSENT half is scored against a project where the claim GENUINELY
    // never happened, and that choice is load-bearing: against a confirming
    // project the carve-out turns the sha-stripped log into a reported gap that
    // still exits 0, and the pair goes vacuous — which is the carve-out working,
    // not a defect.
    id: "STE-486",
    site: {
      section: "Tracker-less rows",
      select: "claim_witness_assert.ts",
    },
    subject: "4f1d9c8b7a6e5d4c3b2a1908f7e6d5c4b3a29180",
    leg: "none",
    capture: "lock-samples-none-claimed.log",
    threshold: 1,
    scoreBy: "exit-code",
  },
  {
    // STE-487 — § Phase 9's manifest self-check. The site is the enumerating
    // check's own invocation, bound to the shipped `linear` manifest: the list
    // of paths a repaired leg actually persisted, one per line.
    //
    // The capture is a MANIFEST, not an `/implement` log, so the row resolves
    // through `capture`. Measuring the manifest rather than the SKILL's prose is
    // the point of the repair — STE-423's claim was asserted over prose and
    // could not see the offending class.
    //
    // The subject is the leg segment itself, and removing it is exactly the
    // 2026-08-16 collision reproduced: every path collapses to
    // `/tmp/dpt-smoke--phase9/<fixture>-<date>.log`, which two concurrent legs
    // would spell identically, and the check exits non-zero on all five.
    //
    // `exit-code` is the only non-vacuous reading (the STE-485 lesson). The CLI
    // prints ONE verdict line on both branches — `artifact-paths: ok …` and
    // `artifact-paths: FAIL …` — so a stdout count scores 1-vs-1 and the pair
    // would be vacuous by construction rather than by measurement.
    id: "STE-487",
    site: {
      section: "Phase 9",
      select: "artifact-manifest",
    },
    subject: "linear",
    leg: "linear",
    capture: "phase9-artifact-manifest-linear.log",
    threshold: 1,
    scoreBy: "exit-code",
  },
  {
    // STE-488 — sub-fixtures 9a and 9b, re-keyed off the probes' own sentences
    // and onto what `/gate-check` actually renders. FOUR clauses, because 9a
    // and 9b are two sub-fixtures and each carries an identifier clause and a
    // verdict clause; a row that scored only 9a would report a half-measured
    // repair as a whole one.
    //
    // TWO CAPTURES, BY MEASUREMENT AND NOT BY PREFERENCE. 9b's clauses name
    // their own log through `RepairClause.capture`, because
    // `plan_identity_mode_conditional` is assistant-0 in 9a's tracker-block
    // capture — folding the four clauses onto one log sends 9b's half vacuous
    // while the row still reads as registered.
    //
    // EVERY clause is `exit-code` (the STE-485 lesson): all four are
    // `capability_row_assert` invocations, which print a one-line VERDICT and
    // signal through exit status, so a stdout count reads 1 whether the
    // expectation was met or not and every pair would be 1-vs-1.
    //
    // The two identifier clauses take a single subject: the hyphenated arm is
    // measured 0 on this leg, so removing the underscored spelling retires the
    // whole any-of. The two verdict clauses cannot — `"GATE FAILED"` and
    // `error-severity` share no substring — so they remove BOTH arms through
    // `removeAll`, each component still via `removeSubject`.
    id: "STE-488",
    site: {
      section: "Sub-fixture 9a",
      select: 'ste450-tracker-block.log "**#13 "',
    },
    subject: "**#13 ",
    leg: "none",
    capture: "gate-check-ste450-tracker-block-none.ndjson",
    threshold: 1,
    scoreBy: "exit-code",
    clauses: [
      {
        site: {
          section: "Sub-fixture 9a",
          select: 'ste450-tracker-block.log "GATE FAILED"',
        },
        subject: "GATE FAILED",
        mutate: removeAll(["GATE FAILED", "error-severity"]),
        threshold: 1,
        scoreBy: "exit-code",
        label: "9a-verdict",
      },
      {
        site: {
          section: "Sub-fixture 9b",
          select: 'ste450-plan-stem.log "**#73 "',
        },
        // The plan-stem capture rendered this row as `**✗ Probe #73 ...`, not as
        // the bare `**#73 ` shape its sibling used — the same LLM-rendering
        // variance the two arms exist for. The subject is the shape THIS capture
        // actually carries, so the mutation demonstrably applies; if a future
        // capture renders the other shape, `removeSubject` throws loudly rather
        // than leaving the absent half unmutated and scoring a silent pass.
        subject: "**✗ Probe #73 ",
        capture: "gate-check-ste450-plan-stem-none.ndjson",
        threshold: 1,
        scoreBy: "exit-code",
        label: "9b-probe",
      },
      {
        site: {
          section: "Sub-fixture 9b",
          select: 'ste450-plan-stem.log "GATE FAILED"',
        },
        subject: "GATE FAILED",
        mutate: removeAll(["GATE FAILED", "error-severity"]),
        capture: "gate-check-ste450-plan-stem-none.ndjson",
        threshold: 1,
        scoreBy: "exit-code",
        label: "9b-verdict",
      },
    ],
  },
  {
    // STE-489 — fixture group 2's three sub-fixtures, re-keyed off a raw-byte
    // regex that spanned JSON-encoded newlines and onto `capability_row_assert`.
    // THREE clauses, one per sub-fixture, because 2a / 2b / 2c are three
    // sub-fixtures with three separate captures; a row that scored only 2a
    // would report a third-measured repair as a whole one.
    //
    // THREE CAPTURES, BY MEASUREMENT AND NOT BY PREFERENCE (the STE-488
    // lesson). Each clause's subject is assistant-0 — and raw-0 — in BOTH
    // sibling captures: that cross-subject isolation is the whole point of the
    // repair, so folding the three clauses onto one log would send two thirds
    // of the row vacuous while it still read as registered.
    //
    // The SUBJECT clause is scored, never the identifier one. Probe #26 fires
    // in all three sub-fixtures, so the identifier clause is true in all three
    // captures by design and cannot discriminate; it proves only that the row
    // surfaced. Each subject clause is the thing its sub-fixture is about.
    //
    // EVERY clause is `exit-code` (the STE-485 lesson): all three are
    // `capability_row_assert` invocations, which print a one-line VERDICT and
    // signal through exit status, so a stdout count reads 1 whether the
    // expectation was met or not and every pair would be 1-vs-1.
    //
    // 2b's subject is the row-scoped `**#26 ` shape THIS capture renders, not
    // the `**Probe #26 ` arm — which is assistant-0 and raw-0 here, so removing
    // the one present arm retires the whole any-of and no `removeAll` is needed
    // (and would throw, since the absent arm cannot be removed).
    id: "STE-489",
    site: {
      section: "Sub-fixture 2a",
      select: "ste221-positive.log milestone_attach_skipped_adapter_limit",
    },
    subject: "milestone_attach_skipped_adapter_limit",
    leg: "linear",
    capture: "gate-check-ste221-positive-linear.ndjson",
    threshold: 1,
    scoreBy: "exit-code",
    clauses: [
      {
        site: {
          section: "Sub-fixture 2b",
          select: "ste221-control.log '**#26 ",
        },
        subject: "**#26 `tracker-project-milestone-attached` — GATE FAILED",
        capture: "gate-check-ste221-control-linear.ndjson",
        threshold: 1,
        scoreBy: "exit-code",
        label: "2b-control",
      },
      {
        site: {
          section: "Sub-fixture 2c",
          select: "ste221-alias.log milestone_attach_unavailable",
        },
        subject: "milestone_attach_unavailable",
        capture: "gate-check-ste221-alias-linear.ndjson",
        threshold: 1,
        scoreBy: "exit-code",
        label: "2c-alias",
      },
    ],
  },
];

/**
 * Roster ids with no registry row, in roster order. Throws on a registry id
 * the roster does not know, and on a duplicate id — both are registry defects
 * that would otherwise silently shrink the reported gap.
 */
export function uncoveredRepairs(
  registry: readonly RepairEntry[],
  roster: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  for (const entry of registry) {
    if (!roster.includes(entry.id)) {
      throw new Error(`falsifiability registry: unknown repair id ${entry.id}`);
    }
    if (seen.has(entry.id)) {
      throw new Error(`falsifiability registry: duplicate repair id ${entry.id}`);
    }
    seen.add(entry.id);
  }
  return roster.filter((id) => !seen.has(id));
}

/** An extracted assertion: the SKILL's own bytes, plus where they came from. */
export interface ExtractedAssertion {
  readonly shell: string;
  readonly line: number;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

/**
 * Blank out fenced code blocks while preserving every byte offset and line
 * number, so heading detection and inline-span scanning never trip over a
 * diagnostic block's fence backticks.
 */
function maskFences(body: string): string {
  const lines = body.split("\n");
  let inFence = false;
  const masked = lines.map((line) => {
    const isFence = FENCE_RE.test(line);
    const blank = isFence || inFence;
    if (isFence) inFence = !inFence;
    return blank ? " ".repeat(line.length) : line;
  });
  return masked.join("\n");
}

/**
 * A half-open `[start, end)` byte range into the SKILL body. Both the section
 * slice and the inline code spans inside it are the same shape, and both index
 * the ORIGINAL body — the masked copy exists only to keep those offsets valid.
 */
interface ByteSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The span of the section whose heading contains `section`, ending at the next
 * heading of the same or shallower depth. A nested sub-heading is INSIDE its
 * parent; a sibling never bleeds in.
 */
function sliceSection(masked: string, section: string): ByteSpan {
  const lines = masked.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }

  const matches: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = HEADING_RE.exec(lines[i] ?? "");
    if (heading && (heading[2] ?? "").includes(section)) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`falsifiability site: no heading contains "${section}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `falsifiability site: ${matches.length} headings contain "${section}" — ambiguous`,
    );
  }

  const headIndex = matches[0] as number;
  const depth = (HEADING_RE.exec(lines[headIndex] as string)?.[1] ?? "#").length;
  let endLine = lines.length;
  for (let i = headIndex + 1; i < lines.length; i += 1) {
    const heading = HEADING_RE.exec(lines[i] ?? "");
    if (heading && (heading[1] as string).length <= depth) {
      endLine = i;
      break;
    }
  }
  const start = offsets[headIndex] as number;
  const end = endLine < lines.length ? (offsets[endLine] as number) : masked.length;
  return { start, end };
}

/**
 * Inline code spans in `[from, to)`, matching a run of N backticks with the
 * next run of exactly N. Double-backtick spans are therefore extracted with
 * any ``` fence token inside them intact — which is exactly the shape the
 * fence-counting assertions need.
 */
function inlineSpans(masked: string, from: number, to: number): ByteSpan[] {
  const spans: ByteSpan[] = [];
  let i = from;
  while (i < to) {
    if (masked[i] !== "`") {
      i += 1;
      continue;
    }
    let open = i;
    while (open < to && masked[open] === "`") open += 1;
    const width = open - i;
    let j = open;
    let closed = -1;
    while (j < to) {
      if (masked[j] !== "`") {
        j += 1;
        continue;
      }
      let run = j;
      while (run < to && masked[run] === "`") run += 1;
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
    spans.push({ start: open, end: closed });
    i = closed + width;
  }
  return spans;
}

/**
 * Slice the section, scan the inline code spans inside it, and return the one
 * whose body contains `site.select` — as VERBATIM bytes of `skillBody`. Zero
 * matches and more than one match both throw: an undetermined subject must
 * never fall back to a remembered form.
 */
export function extractAssertionShell(
  skillBody: string,
  site: AssertionSite,
): ExtractedAssertion {
  const masked = maskFences(skillBody);
  const { start, end } = sliceSection(masked, site.section);

  const hits = inlineSpans(masked, start, end).filter((span) =>
    skillBody.slice(span.start, span.end).includes(site.select),
  );
  if (hits.length === 0) {
    throw new Error(
      `falsifiability site: no code span in "${site.section}" contains "${site.select}"`,
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `falsifiability site: ${hits.length} code spans in "${site.section}" contain ` +
        `"${site.select}" — ambiguous`,
    );
  }

  const hit = hits[0] as ByteSpan;
  const raw = skillBody.slice(hit.start, hit.end);
  const shell = raw.trim();
  const at = skillBody.indexOf(shell, hit.start);
  const line = skillBody.slice(0, at === -1 ? hit.start : at).split("\n").length;
  return { shell, line };
}

/** A shell form with its `<tracker>` capture path resolved to a real file. */
export interface BoundAssertion {
  readonly command: string;
  readonly capturePath: string;
}

const CAPTURE_TOKEN_RE = /\/tmp\/dpt-smoke-[^\s'"`]*\.log/g;

/**
 * Substitute the capture-path token with `capturePath`, leaving every other
 * byte of the SKILL's form untouched. Exactly one token must occur: zero means
 * the command would never read the fixture at all, more than one means the
 * harness cannot tell which capture it is measuring.
 */
export function bindCapture(shell: string, capturePath: string): BoundAssertion {
  const tokens = shell.match(CAPTURE_TOKEN_RE) ?? [];
  if (tokens.length !== 1) {
    throw new Error(
      `falsifiability bind: expected exactly 1 capture-path token, found ${tokens.length}`,
    );
  }
  return { command: shell.replace(tokens[0] as string, capturePath), capturePath };
}

/** This plugin's root, from the module's own location. Never from cwd. */
const PLUGIN_ROOT_DIR = join(import.meta.dir, "..", "..", "..");

/**
 * The environment an extracted SKILL form runs in.
 *
 * The SKILL's assertion bytes reference the runner variables it declares in its
 * own setup fence — `${PLUGIN_DIR}`, `${CAP_ASSERT}`. Left unset, `bun ""`
 * prints its usage banner and EXITS 0, so an exit-code-scored clause reads 1 on
 * BOTH halves and the pair goes vacuous for a reason that has nothing to do
 * with the assertion under test. Worse, that is indistinguishable from a
 * command that never launched — the one thing this module exists to rule out.
 *
 * A caller's own value always wins: these are defaults for an unset variable,
 * never an override of a deliberate one.
 */
export function harnessEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pluginDir = base.PLUGIN_DIR || PLUGIN_ROOT_DIR;
  return {
    ...base,
    PLUGIN_DIR: pluginDir,
    CAP_ASSERT:
      base.CAP_ASSERT || join(pluginDir, "adapters", "_shared", "src", "capability_row_assert.ts"),
  };
}

/** What executing a bound assertion produced. */
export interface AssertionRun {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly count: number;
}

/**
 * Execute the bound bytes through bash. A non-zero exit is DATA, not an error
 * — `grep -c` exits 1 on zero matches, which is the most informative outcome
 * the absent-subject half can produce.
 *
 * `env` is materialised from `process.env` AT CALL TIME rather than left to the
 * default inheritance. Bun snapshots the environment at process start, so a
 * caller's `process.env.PLUGIN_DIR = …` never reaches the child under the
 * default — the SKILL's `${PLUGIN_DIR}` would expand to the empty string and
 * the span would resolve, or not, purely by cwd accident. That makes the
 * absent-subject half indistinguishable from a command that never launched,
 * which is the one thing this module exists to rule out.
 */
export function runAssertion(bound: BoundAssertion): AssertionRun {
  const proc = spawnSync("bash", ["-c", bound.command], {
    encoding: "utf8",
    env: harnessEnv(),
  });
  const stdout = proc.stdout ?? "";
  const trimmed = stdout.trim();
  const count = /^-?\d+$/.test(trimmed)
    ? Number.parseInt(trimmed, 10)
    : stdout.split("\n").filter((l) => l.trim() !== "").length;
  return { command: bound.command, exitCode: proc.status ?? -1, stdout, count };
}

/**
 * Exit statuses that mean "this command never really ran" rather than "the
 * expectation was not met".
 *
 * `capability_row_assert` exits 2 on a usage error and 1 on a genuine miss;
 * bash itself exits 127 on command-not-found and 126 on not-executable. Under
 * a naive `exitCode === 0 ? 1 : 0` all of those collapse into the same 0 as a
 * legitimate RED — so a typo'd verb, a moved module or a mis-bound path makes
 * the ABSENT half score 0, the pair reads 1-vs-0, and the assertion is
 * certified falsifiable on the strength of a command that never executed.
 *
 * That is the "mutation that never applied" class (the M124 lesson) arriving in
 * the scorer instead of the mutator, and M127 met it twice before this guard
 * existed: an inert `process.env` assignment, and an unset `CAP_ASSERT` making
 * `bun ""` print a usage banner and exit 0. Both were caught by hand. This
 * makes the third instance loud.
 *
 * `-1` IS IN THE SET, and the route to it is measured rather than assumed.
 * `runAssertion` sets `exitCode: proc.status ?? -1`, and `spawnSync` reports a
 * null status on a SPAWN FAILURE or a SIGNAL KILL — both unambiguously "never
 * ran". `kill -9 $$` reaches the scorer as -1, and before this it scored a
 * silent 0, buying exactly the same certification-on-a-command-that-never-
 * executed as the other three statuses. A refactor pass found the hole and
 * correctly declined to widen the set itself, since that is a behaviour change;
 * it was closed deliberately afterwards, with the pin below.
 *
 * DELIBERATELY NOT WIDER. Statuses 1, 3, 125 and 128 are ordinary failures and
 * MUST keep scoring 0 — a guard that swallowed those would suppress the very
 * REDs this harness exists to produce. `tests/m127-ste-483-scorerun-never-ran-
 * guard.test.ts` pins both directions, including those four boundary statuses,
 * so an over-broad guard is as red as a missing one. That pin exists because
 * this constant was added on the orchestrator's initiative with no AC behind
 * it, and an anti-vacuity guard that nothing can falsify is the defect it was
 * written to prevent.
 */
const NEVER_RAN_EXIT_CODES = new Set([-1, 2, 126, 127]);

/**
 * Turn one run into its score under `mode`.
 *
 * Throws rather than scoring when an `exit-code` run signals that it never
 * really executed — a refusal is the only honest reading, because the two
 * states a score has to separate are indistinguishable from that status alone.
 */
export function scoreRun(run: AssertionRun, mode: ScoreMode): number {
  if (mode !== "exit-code") return run.count;
  if (NEVER_RAN_EXIT_CODES.has(run.exitCode)) {
    throw new Error(
      `falsifiability scoring refused: command exited ${run.exitCode}, which means it did not run ` +
        `(usage error / not found / not executable) rather than that the expectation failed. ` +
        `Scoring it as a RED would certify the assertion falsifiable on a command that never executed.\n` +
        `  command: ${run.command}\n` +
        `  stdout: ${run.stdout.slice(0, 200)}`,
    );
  }
  return run.exitCode === 0 ? 1 : 0;
}

function occurrences(text: string, needle: string): number {
  if (needle === "") throw new Error("falsifiability subject: empty subject");
  return text.split(needle).length - 1;
}

/** The result of deleting every occurrence of a subject from a capture. */
export interface SubjectRemoval {
  readonly text: string;
  readonly removed: number;
}

/**
 * Delete every occurrence of `subject`. Throws when it removed NOTHING: a
 * mutation that never applied leaves the capture healthy, and a presence-only
 * harness scores that unchanged capture as "went red" (the M124 lesson).
 */
export function removeSubject(capture: string, subject: string): SubjectRemoval {
  const removed = occurrences(capture, subject);
  if (removed === 0) {
    throw new Error(`falsifiability mutation did not apply: subject "${subject}" not present`);
  }
  return { text: capture.split(subject).join(""), removed };
}

/** The three mutation classes; only `subject-removed` is evidence. */
export type MutationClass = "not-applied" | "subject-removed" | "rewording-only";

/**
 * Classify what a mutation actually did. Bytes unchanged is `not-applied`; the
 * subject's occurrence count falling to zero is `subject-removed`; anything
 * else that moved bytes without moving that count is `rewording-only`.
 */
export function classifyMutation(
  original: string,
  mutated: string,
  subject: string,
): MutationClass {
  if (mutated === original) return "not-applied";
  return occurrences(mutated, subject) === 0 ? "subject-removed" : "rewording-only";
}

/** Whether an assertion demonstrably distinguishes present from absent. */
export type FalsifiabilityVerdict = "falsifiable" | "vacuous";

/** One assertion's measured present/absent pair and the verdict over it. */
export interface FalsifiabilityResult {
  readonly id: string;
  readonly command: string;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly removed: number;
  readonly verdict: FalsifiabilityVerdict;
}

/** Inputs for one falsifiability check. */
export interface FalsifiabilityCheck {
  readonly id: string;
  readonly shell: string;
  readonly capturePath: string;
  readonly subject: string;
  readonly threshold: number;
  readonly mutate?: (capture: string) => string;
  /** Defaults to `stdout-count` — STE-484's row is unchanged by this field. */
  readonly scoreBy?: ScoreMode;
}

/**
 * Run the assertion against the present capture and against a mutated copy of
 * it, and score the pair. The mutation must classify as `subject-removed` or
 * the check throws — a rewording is not evidence. `falsifiable` requires BOTH
 * halves: the present capture clears the threshold AND the absent one does
 * not. Either half missing is `vacuous`.
 *
 * The mutated bytes go to a temporary file; the shipped fixture is never
 * written back over.
 */
export function checkFalsifiability(check: FalsifiabilityCheck): FalsifiabilityResult {
  const original = readFileSync(check.capturePath, "utf8");
  const mutate = check.mutate ?? ((capture: string) => removeSubject(capture, check.subject).text);
  const mutated = mutate(original);

  const klass = classifyMutation(original, mutated, check.subject);
  if (klass !== "subject-removed") {
    throw new Error(
      `falsifiability ${check.id}: mutation classified "${klass}" — only ` +
        `"subject-removed" is evidence`,
    );
  }
  const removed = occurrences(original, check.subject) - occurrences(mutated, check.subject);

  // Both halves run the SAME extracted bytes; only the bound capture differs.
  // That is the entire experiment, so it goes through one call site.
  const measure = (capturePath: string): AssertionRun =>
    runAssertion(bindCapture(check.shell, capturePath));

  const mode: ScoreMode = check.scoreBy ?? "stdout-count";
  const present = measure(check.capturePath);
  const presentCount = scoreRun(present, mode);

  const dir = mkdtempSync(join(tmpdir(), "dpt-falsifiability-"));
  let absentCount: number;
  try {
    const mutatedPath = join(dir, "mutated.ndjson");
    writeFileSync(mutatedPath, mutated, "utf8");
    absentCount = scoreRun(measure(mutatedPath), mode);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const verdict: FalsifiabilityVerdict =
    presentCount >= check.threshold && absentCount < check.threshold ? "falsifiable" : "vacuous";

  return {
    id: check.id,
    command: present.command,
    presentCount,
    absentCount,
    removed,
    verdict,
  };
}

/**
 * Score one REGISTERED repair, end to end, from its registry row alone.
 *
 * The chain the rest of this module leaves open: extract the entry's site out
 * of `skillBody`, bind those bytes to that entry's shipped capture, and run the
 * present/absent pair. There is deliberately NO `shell` parameter — a shell
 * argument is exactly the paraphrase constraint 1 forbids, and it is the door
 * through which a remembered copy keeps reporting green after the SKILL drifts
 * away from it. A drifted site therefore THROWS out of `extractAssertionShell`;
 * it never degrades to a private fallback form.
 */
export function checkRepairEntry(
  entry: RepairEntry,
  skillBody: string,
): FalsifiabilityResult {
  return scoreClause(entry.id, entry, resolveCapturePath(entry), skillBody);
}

/**
 * Extract ONE clause's bytes out of the SKILL and score its present/absent
 * pair. The single site at which a registered clause — primary or extra —
 * becomes a shell, so the no-paraphrase constraint has exactly one place to
 * hold and a drifted site throws from exactly one call.
 */
function scoreClause(
  id: string,
  clause: ScorableClause,
  capturePath: string,
  skillBody: string,
): FalsifiabilityResult {
  const { shell } = extractAssertionShell(skillBody, clause.site);
  return checkFalsifiability({
    id,
    shell,
    capturePath,
    subject: clause.subject,
    threshold: clause.threshold,
    scoreBy: clause.scoreBy,
    mutate: clause.mutate,
  });
}

/**
 * Score EVERY clause of one registered repair: the primary row first, then each
 * extra clause in registration order, id'd `<entry.id>/<label>`.
 *
 * A repair that lands two assertions in the same section is one repair, and a
 * harness that scores only the first of them reports a half-measured row as a
 * whole one. A clause is scored against its entry's capture unless it names its
 * OWN — the STE-488 case, where one repair spans two sub-fixtures whose logs
 * are not interchangeable (see `RepairClause.capture`).
 */
export function checkRepairClauses(
  entry: RepairEntry,
  skillBody: string,
): readonly FalsifiabilityResult[] {
  const capturePath = resolveCapturePath(entry);
  return [
    scoreClause(entry.id, entry, capturePath, skillBody),
    ...(entry.clauses ?? []).map((clause) =>
      scoreClause(
        `${entry.id}/${clause.label}`,
        clause,
        captureOrDefault(clause.capture, capturePath),
        skillBody,
      ),
    ),
  ];
}

/** The only two tokens the plan's halt line may carry. */
export const HARNESS_OUTCOME_TOKENS = ["harness-fails", "harness-vacuous"] as const;

/** One of the two literal halt tokens. */
export type HarnessOutcome = (typeof HARNESS_OUTCOME_TOKENS)[number];

/**
 * The verdict over a whole result set. An EMPTY set throws: zero results is
 * not evidence, and a harness that answered "harness-fails" over nothing at
 * all is the exact defect this module retires.
 */
export function harnessOutcomeFor(results: readonly FalsifiabilityResult[]): HarnessOutcome {
  if (results.length === 0) {
    throw new Error("falsifiability outcome: empty result set is not evidence");
  }
  return results.some((r) => r.verdict === "vacuous") ? "harness-vacuous" : "harness-fails";
}

const OUTCOME_LINE_RE = /^[ \t]*harness-outcome:[ \t]*(\S.*)$/gm;

/**
 * Read the plan's single `harness-outcome:` line. Exactly one line, carrying
 * exactly one of the two tokens — the unresolved placeholder names BOTH and
 * must never read as a recorded outcome.
 */
export function readHarnessOutcome(planBody: string): HarnessOutcome {
  const values = [...planBody.matchAll(OUTCOME_LINE_RE)].map((m) => (m[1] as string).trim());
  if (values.length !== 1) {
    throw new Error(
      `harness-outcome: expected exactly 1 line, found ${values.length}`,
    );
  }
  const value = values[0] as string;
  if (!(HARNESS_OUTCOME_TOKENS as readonly string[]).includes(value)) {
    throw new Error(`harness-outcome: "${value}" is not one of the two literal tokens`);
  }
  return value as HarnessOutcome;
}

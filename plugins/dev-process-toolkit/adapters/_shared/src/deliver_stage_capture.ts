// deliver_stage_capture — STE-492: a real predicate for the
// `deliver-stage-result` hand-off contract, taking a CAPTURED WORKER STAGE
// REPORT as its subject.
//
// THE DEFECT. Every one of the eighteen shipped STE-464 acceptance criteria for
// the `deliver-stage-result` contract is a prose-grep of `/deliver`'s own
// `skills/deliver/SKILL.md`. A contract with no producer anywhere in the
// toolkit — no worker ever emitting the fence, no artifact ever checked — passed
// all eighteen, because the only thing they ever read was the orchestrator
// describing the contract to itself. Producer/consumer asymmetry (STE-485 /
// STE-396): the consumer side was pinned to the byte, the producer side was
// evidenced by nothing.
//
// THE FIX. This module reads a capture — the text a ceremony stage actually
// emitted — from disk and returns a structured verdict. The smoke driver's
// fixture group 14 runs it against a worker capture, so the contract now has a
// second, non-prose evidence path that fails when the producer stops producing.
//
// THE VACUITY THIS MODULE MUST NOT HAVE. `skills/deliver/SKILL.md` itself
// carries a well-formed ```deliver-stage-result EXAMPLE — one fence, all six
// sections, in the canonical order. A naive "does the text contain the banner"
// (or even "banner plus ordered sections") predicate therefore scores the
// ORCHESTRATOR'S OWN PROSE as a passing worker report, which is a perfect pin on
// the wrong subject and worth nothing. So the predicate additionally demands
// what a template cannot have: CONCRETE scalars. A capture must carry a real
// `stage:` value, a real milestone identity under the shared `milestone_token`
// union grammar — `M<digits>` or `M_<epic-key>` (the SKILL's says `M<N>`, which
// is neither) — and a real `status:`, none of them carrying the `#`-annotated
// alternation a template uses to enumerate its options.
//
// WHAT IT DELIBERATELY DOES NOT DEMAND. The three LIST sections (`summary`,
// `gate`, `follow_ups`) are never content-checked, because the literal
// `- (none found)` fallback is legal in any of them — and on a REDUCED chain (a
// milestone whose work lands in a tree with no toolkit) `gate` legitimately
// carries exactly that: there is no project gate command there to report pass
// and skip counts from. Grading list content would fail that healthy case.
// The three SCALAR sections are always filled, `milestone` included, so they are
// the only ones this predicate constrains.
//
// Pure and read-only by construction: one `readFileSync`, no git, no network,
// no child processes — the same discipline every `adapters/_shared/src` scanner
// follows, so a smoke driver can call it mid-run without side effects.

import { readFileSync } from "node:fs";

import { findFences } from "./markdown_fences";
import { MILESTONE_TOKEN_SOURCE } from "./milestone_token";

/**
 * A concrete milestone identity, anchored on the SHARED union grammar rather
 * than a private `M\d+` copy.
 *
 * This is load-bearing, not hygiene. Fixture group 14 is rostered on every leg
 * (`legs: ALL_LEGS`), and the three mint paths emit three different shapes: the
 * Linear route mints `M<N>`, the Jira route `M_<epic-key>`, and the
 * tracker-less route `M_<short-ULID>`. A hand-rolled `^M\d+$` recognizes only
 * the first, so a perfectly healthy capture from the jira or tracker-less leg
 * would be graded `ok:false` — the group would false-RED on two of its three
 * legs while looking green on the one that happened to be developed against.
 * `milestone_token.ts` is the one home for this grammar (STE-376), and its
 * consumer audit greps for exactly this import so a private copy cannot
 * silently return.
 *
 * The SKILL's placeholder `M<N>` still matches NEITHER branch of the union, so
 * widening here does not reopen the wrong-subject vacuity the module exists to
 * close — and the `#`-alternation check remains an independent second ground.
 */
const CONCRETE_MILESTONE_RE = new RegExp(`^${MILESTONE_TOKEN_SOURCE}$`);

/** The fenced banner every stage report must end with. */
export const DELIVER_STAGE_FENCE_BANNER = "```deliver-stage-result";

/**
 * Opening / closing markers, indentation-tolerant: a worker report relayed
 * through a nested list or a quoted pane transcript keeps the fence but not
 * the column-0 position, and rejecting that would fail the healthy case.
 * The opener is built from the exported banner so the two cannot drift.
 */
const FENCE_OPEN = new RegExp(`^[ \\t]*${DELIVER_STAGE_FENCE_BANNER}[ \\t]*$`);
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

/**
 * The six sections, in THE canonical order. Restated here as the module's own
 * authority; `skills/deliver/SKILL.md` and `docs/deliver-reference.md` state the
 * same order in prose for the worker's benefit.
 */
export const DELIVER_STAGE_SECTIONS = [
  "stage",
  "milestone",
  "status",
  "summary",
  "gate",
  "follow_ups",
] as const;

/**
 * Every stage `/deliver` can run, across ALL routes — the single vocabulary for
 * the fence's `stage:` scalar.
 *
 * This is deliberately wider than the full ceremony's three. A milestone whose
 * work lands in a tree with no toolkit runs a REDUCED chain (`work` then `pr`),
 * and one targeting another toolkit repo runs `spec-write` first. Those stages
 * emit the same six-section fence as any other — the reduced chain is exempt
 * from stages it never RUNS, never from the fence contract itself.
 *
 * Caught by the STE-495 refactor pass: this list was the full-ceremony triple,
 * so a healthy reduced-chain worker emitting `stage: work` was graded `ok:
 * false` with "not one of implement | ship-milestone | pr". Fixture group 14
 * would have false-REDded a correct reduced chain — the third instance in this
 * milestone of the fence predicate disagreeing with the routing it grades.
 *
 * `target_repo.ts` derives its `StageId` union from this const rather than
 * keeping a second copy; the import runs that way because `target_repo` already
 * imports `DELIVER_STAGE_SECTIONS` from here, and the reverse would be circular.
 */
export const DELIVER_STAGE_IDS = [
  "spec-write",
  "implement",
  "ship-milestone",
  "pr",
  "work",
] as const;

const STAGE_VALUES = DELIVER_STAGE_IDS;

/** The two terminal statuses a stage report can carry. */
const STATUS_VALUES = ["ok", "failed"] as const;

/** Line cap INSIDE the fence (SKILL § Stage hand-offs). */
const FENCE_LINE_CAP = 20;

/**
 * Minimum characters of report prose before the fence. A bare fence with no
 * report around it is not a stage hand-off; it is a snippet.
 */
const MIN_PROSE_CHARS = 40;

export interface DeliverStageCaptureVerdict {
  /** True only when every clause below holds. */
  ok: boolean;
  /** One human-readable line per violated clause; empty iff `ok`. */
  reasons: readonly string[];
}

/**
 * CRLF/BOM normalization. A capture written on Windows, or one a tool prefixed
 * with U+FEFF, is the same report — and a line-anchored check that silently
 * missed it would fail the healthy case, which is the loudest possible way to
 * be wrong about a green run.
 */
function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/** Top-level `key:` lines inside the fence, in the order they appear. */
function topLevelKeys(lines: readonly string[]): string[] {
  const keys: string[] = [];
  for (const line of lines) {
    const hit = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (hit !== null) keys.push(hit[1]!);
  }
  return keys;
}

/** The raw text after `key:` on its top-level line, or `undefined`. */
function scalarValue(lines: readonly string[], key: string): string | undefined {
  for (const line of lines) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim();
  }
  return undefined;
}

/**
 * Does this scalar carry a `#` alternation comment (`ok  # ok | failed`)? That
 * is a template enumerating its options, not a report stating a fact — the
 * single most reliable tell that the subject is `/deliver`'s own SKILL rather
 * than something a worker emitted.
 */
function hasTemplateAnnotation(value: string): boolean {
  return value.includes("#");
}

function checkScalar(
  reasons: string[],
  lines: readonly string[],
  key: string,
  allowed: RegExp,
  expectation: string,
): void {
  const raw = scalarValue(lines, key);
  if (raw === undefined) {
    reasons.push(`\`${key}:\` is missing from the fence`);
    return;
  }
  if (hasTemplateAnnotation(raw)) {
    reasons.push(
      `\`${key}:\` carries a \`#\` alternation comment (${JSON.stringify(raw)}) — ` +
        `that is a template enumerating its options, not a capture reporting a value`,
    );
  }
  const value = raw.split("#")[0]!.trim();
  if (!allowed.test(value)) {
    reasons.push(
      `\`${key}:\` is ${JSON.stringify(value)}, not ${expectation} — a placeholder ` +
        `is a template, not a captured worker report`,
    );
  }
}

/**
 * Verify one captured stage report against the `deliver-stage-result` contract.
 *
 * Returns `{ ok: true, reasons: [] }` only for a capture that a ceremony stage
 * could genuinely have emitted: report prose, then exactly one well-formed
 * fence, with all six sections in the canonical order and concrete scalars.
 * Every violated clause contributes its own reason, so a diagnostic names all
 * of what is wrong rather than only the first thing.
 */
export function verifyDeliverStageCapture(
  capturePath: string,
): DeliverStageCaptureVerdict {
  let raw: string;
  try {
    raw = readFileSync(capturePath, "utf-8");
  } catch (error) {
    return {
      ok: false,
      reasons: [
        `capture ${JSON.stringify(capturePath)} could not be read: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const body = normalize(raw);
  const lines = body.split("\n");
  const reasons: string[] = [];

  // The fence walk is `markdown_fences.findFences` — the one scanner shared
  // with the ```bash probes and the `tdd-result` parser. Only the grading
  // policy below is this contract's own.
  const fences = findFences(body, FENCE_OPEN, FENCE_CLOSE);

  if (fences.length === 0) {
    // Deliberately the whole verdict: with no fence there is nothing to check
    // sections or scalars against, and appending six phantom "missing section"
    // reasons would bury the one fact that matters.
    return {
      ok: false,
      reasons: [
        "capture carries no ```deliver-stage-result fence — a stage report " +
          "must end with exactly one, and prose naming the contract is not one",
      ],
    };
  }
  if (fences.length > 1) {
    reasons.push(
      `capture carries ${fences.length} \`deliver-stage-result\` fences — ` +
        "the contract is exactly one, as the last thing in the report",
    );
  }

  const fence = fences[0]!;
  if (fence.endLine < 0) {
    return {
      ok: false,
      reasons: [
        ...reasons,
        "the ```deliver-stage-result fence is never closed — an unterminated " +
          "fence is not a hand-off the orchestrator can read",
      ],
    };
  }
  const fenceLines = fence.lines;

  const prose = lines.slice(0, fence.startLine - 1).join("\n").trim();
  if (prose.length < MIN_PROSE_CHARS) {
    reasons.push(
      `only ${prose.length} characters of report prose precede the fence — a ` +
        "bare fence is a snippet, not a captured stage report",
    );
  }

  if (fenceLines.length > FENCE_LINE_CAP) {
    reasons.push(
      `the fence holds ${fenceLines.length} lines, over the ${FENCE_LINE_CAP}-line cap`,
    );
  }

  const canonical = DELIVER_STAGE_SECTIONS as readonly string[];
  const keys = topLevelKeys(fenceLines);
  const missing = canonical.filter((name) => !keys.includes(name));
  if (missing.length > 0) {
    reasons.push(
      `fence is missing section(s) ${missing.join(", ")} — sections are never ` +
        "omitted; an empty one keeps its heading and carries `- (none found)`",
    );
  }
  const known = keys.filter((key) => canonical.includes(key));
  if (missing.length === 0 && known.join(",") !== canonical.join(",")) {
    reasons.push(
      `fence sections are out of order: got ${known.join(" < ")}, expected ` +
        `${canonical.join(" < ")} — the section order is fixed, never reordered`,
    );
  }

  checkScalar(
    reasons,
    fenceLines,
    "stage",
    new RegExp(`^(?:${STAGE_VALUES.join("|")})$`),
    `one of ${STAGE_VALUES.join(" | ")}`,
  );
  checkScalar(
    reasons,
    fenceLines,
    "milestone",
    CONCRETE_MILESTONE_RE,
    "a concrete milestone identity (`M<digits>` or `M_<epic-key>`)",
  );
  checkScalar(
    reasons,
    fenceLines,
    "status",
    new RegExp(`^(?:${STATUS_VALUES.join("|")})$`),
    `one of ${STATUS_VALUES.join(" | ")}`,
  );

  return { ok: reasons.length === 0, reasons };
}

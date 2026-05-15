// tdd_spec_review_result — STE-296 AC.3. Deterministic parser for the
// `tdd-spec-review-result` fenced YAML block emitted by the spec-review
// audit subagent at end-of-FR. Mirrors the closed-schema parser in
// `tdd_result.ts` and reuses the schema-agnostic fence + scoped-YAML
// primitives from `tdd_fence_yaml.ts`. Schema validation (REQUIRED_FIELDS,
// status check, array-field check, numeric drift_count) stays here so
// the closed-schema contract for the `tdd-spec-review-result` block is
// locally readable.
//
// Why hand-rolled parser: the schema is closed (one role × nine fields)
// and the parser has to surface field-level format-violation reasons
// that route into the orchestrator's halt / advisory channels. A
// general YAML lib would make "missing field X" detection harder to
// attribute. Same rationale as `tdd_result.ts` and `frontmatter.ts`.

import {
  extractFencedBlock,
  parseYamlFields,
  type ExtractResult,
} from "./tdd_fence_yaml";

export type { ExtractResult };

export type TddSpecReviewStatus = "ok" | "failed";

export interface TddSpecReviewBlock {
  role: "spec-reviewer";
  status: TddSpecReviewStatus;
  missing_acs: string[];
  partial_acs: string[];
  drift_count: number;
  advisory_findings: string[];
  cross_cutting_drift: string[];
  command: string;
  output_excerpt: string;
  notes?: string;
}

export type ParseResult =
  | { ok: true; block: TddSpecReviewBlock }
  | { ok: false; reason: string };

const FENCE_OPEN = /^```tdd-spec-review-result\s*$/;
const FENCE_TAG = "tdd-spec-review-result";

const REQUIRED_FIELDS: ReadonlyArray<string> = [
  "status",
  "missing_acs",
  "partial_acs",
  "drift_count",
  "advisory_findings",
  "cross_cutting_drift",
  "command",
  "output_excerpt",
];

const ARRAY_FIELDS: ReadonlyArray<string> = [
  "missing_acs",
  "partial_acs",
  "advisory_findings",
  "cross_cutting_drift",
];

const VALID_STATUSES: readonly TddSpecReviewStatus[] = ["ok", "failed"];

/**
 * Locate the unique `tdd-spec-review-result` fenced block inside
 * arbitrary text (typically the audit subagent's stdout). Returns the
 * body between the opening ` ```tdd-spec-review-result ` line and the
 * closing ` ``` ` line.
 *
 * Multiple fences ⇒ format violation (AC.3 mandates exactly one).
 * Zero fences ⇒ format violation.
 */
export function extractTddSpecReviewBlock(text: string): ExtractResult {
  return extractFencedBlock(text, FENCE_OPEN, FENCE_TAG);
}

/**
 * Parse a fenced `tdd-spec-review-result` body into a typed block.
 * Accepts either the body alone or the full
 * ```tdd-spec-review-result ... ``` fence (the parser unwraps in that
 * case via extractTddSpecReviewBlock).
 */
export function parseTddSpecReviewBlock(text: string): ParseResult {
  let body = text;
  if (FENCE_OPEN.test(text.split("\n", 1)[0] ?? "")) {
    const ex = extractTddSpecReviewBlock(text);
    if (!ex.ok) return { ok: false, reason: ex.reason };
    body = ex.body;
  }
  const fields = parseYamlFields(body);

  // Role is checked separately and must be exactly `spec-reviewer`.
  if (!("role" in fields)) {
    return { ok: false, reason: "missing required field `role`" };
  }
  const role = fields.role as string;
  if (role !== "spec-reviewer") {
    return {
      ok: false,
      reason: `invalid role \`${role}\` — expected \`spec-reviewer\``,
    };
  }

  for (const required of REQUIRED_FIELDS) {
    if (!(required in fields)) {
      return {
        ok: false,
        reason: `missing required field \`${required}\``,
      };
    }
  }

  const status = fields.status as string;
  if (!VALID_STATUSES.includes(status as TddSpecReviewStatus)) {
    return {
      ok: false,
      reason:
        `invalid status \`${status}\` — expected one of ${VALID_STATUSES.join(", ")}`,
    };
  }

  for (const arrField of ARRAY_FIELDS) {
    const v = fields[arrField];
    if (!Array.isArray(v)) {
      return {
        ok: false,
        reason: `field \`${arrField}\` must be a list (got ${typeof v})`,
      };
    }
  }

  const driftRaw = fields.drift_count;
  const driftNum = typeof driftRaw === "number"
    ? driftRaw
    : Number(driftRaw as string);
  if (Number.isNaN(driftNum)) {
    return {
      ok: false,
      reason: `field \`drift_count\` must be a number (got \`${String(driftRaw)}\`)`,
    };
  }

  const command = fields.command;
  if (typeof command !== "string" || command.length === 0) {
    return {
      ok: false,
      reason: "field `command` must be a non-empty string",
    };
  }

  const output_excerpt = fields.output_excerpt;
  if (typeof output_excerpt !== "string") {
    return {
      ok: false,
      reason: "field `output_excerpt` must be a string",
    };
  }

  const block: TddSpecReviewBlock = {
    role: "spec-reviewer",
    status: status as TddSpecReviewStatus,
    missing_acs: (fields.missing_acs as unknown[]).map(String),
    partial_acs: (fields.partial_acs as unknown[]).map(String),
    drift_count: driftNum,
    advisory_findings: (fields.advisory_findings as unknown[]).map(String),
    cross_cutting_drift: (fields.cross_cutting_drift as unknown[]).map(String),
    command,
    output_excerpt,
  };
  if ("notes" in fields && typeof fields.notes === "string") {
    block.notes = fields.notes;
  }
  return { ok: true, block };
}


// tdd_result — STE-225 AC.4. Deterministic parser for the `tdd-result`
// fenced YAML block emitted by every TDD child subagent (test-writer,
// implementer, refactorer). The block is the only in-band channel
// between orchestrator and child; the orchestrator gates retries and
// halts on its shape.
//
// Why hand-rolled parser: the schema is closed (4 roles × 5 fields) and
// the parser has to surface field-level format-violation reasons that
// route into the retry state machine. A general YAML lib would make
// "missing field X" detection harder to attribute. Same rationale as
// frontmatter.ts — we don't pull a YAML dep for a tightly-bound schema.
//
// Shared primitives — fence extraction + scoped-YAML parsing — live in
// `tdd_fence_yaml.ts` and are reused by `tdd_spec_review_result.ts`
// (STE-296 AUDIT-stage parser). Schema validation (REQUIRED_FIELDS,
// role/status checks) stays here so the closed-schema contract for the
// `tdd-result` block is locally readable.

import {
  extractFencedBlock,
  parseYamlFields,
  type ExtractResult,
} from "./tdd_fence_yaml";

export type { ExtractResult };

export type TddRole = "test-writer" | "implementer" | "refactorer" | "spec-reviewer";
export type TddStatus = "ok" | "failed";

export interface TddResultBlock {
  role: TddRole;
  status: TddStatus;
  files: string[];
  command: string;
  output_excerpt: string;
  notes?: string;
}

export type ParseResult =
  | { ok: true; block: TddResultBlock }
  | { ok: false; reason: string };

export interface ParseOptions {
  /**
   * If set, parser fails when block.role does not equal expectedRole.
   * Reason text names both the expected and observed role so the
   * format-violation retry prompt can route correctly.
   */
  expectedRole?: TddRole;
}

const FENCE_OPEN = /^```tdd-result\s*$/;
const FENCE_TAG = "tdd-result";

const REQUIRED_FIELDS: ReadonlyArray<keyof TddResultBlock> = [
  "role",
  "status",
  "files",
  "command",
  "output_excerpt",
];

const VALID_ROLES: readonly TddRole[] = [
  "test-writer",
  "implementer",
  "refactorer",
];

const VALID_STATUSES: readonly TddStatus[] = ["ok", "failed"];

/**
 * Locate the unique `tdd-result` fenced block inside arbitrary text
 * (typically the child subagent's stdout). Returns the body between the
 * opening ` ```tdd-result ` line and the closing ` ``` ` line.
 *
 * Multiple fences ⇒ format violation (AC.4 mandates exactly one).
 * Zero fences ⇒ format violation.
 */
export function extractTddResultBlock(text: string): ExtractResult {
  return extractFencedBlock(text, FENCE_OPEN, FENCE_TAG);
}

/**
 * Parse a fenced `tdd-result` body into a typed block. Accepts either
 * the body alone or the full ```tdd-result ... ``` fence (the parser
 * unwraps in that case via extractTddResultBlock).
 */
export function parseTddResultBlock(
  text: string,
  options: ParseOptions = {},
): ParseResult {
  let body = text;
  if (FENCE_OPEN.test(text.split("\n", 1)[0] ?? "")) {
    const ex = extractTddResultBlock(text);
    if (!ex.ok) return { ok: false, reason: ex.reason };
    body = ex.body;
  }
  const fields = parseYamlFields(body);
  for (const required of REQUIRED_FIELDS) {
    if (!(required in fields)) {
      return {
        ok: false,
        reason: `missing required field \`${required}\``,
      };
    }
  }
  const role = fields.role as string;
  if (!VALID_ROLES.includes(role as TddRole)) {
    return {
      ok: false,
      reason:
        `invalid role \`${role}\` — expected one of ${VALID_ROLES.join(", ")}`,
    };
  }
  if (options.expectedRole && role !== options.expectedRole) {
    return {
      ok: false,
      reason:
        `wrong role: expected \`${options.expectedRole}\`, got \`${role}\``,
    };
  }
  const status = fields.status as string;
  if (!VALID_STATUSES.includes(status as TddStatus)) {
    return {
      ok: false,
      reason:
        `invalid status \`${status}\` — expected one of ${VALID_STATUSES.join(", ")}`,
    };
  }
  const files = fields.files;
  if (!Array.isArray(files)) {
    return {
      ok: false,
      reason: `field \`files\` must be a list (got ${typeof files})`,
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
  const block: TddResultBlock = {
    role: role as TddRole,
    status: status as TddStatus,
    files: files.map(String),
    command,
    output_excerpt,
  };
  if ("notes" in fields && typeof fields.notes === "string") {
    block.notes = fields.notes;
  }
  return { ok: true, block };
}


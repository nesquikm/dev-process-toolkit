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

export type TddRole = "test-writer" | "implementer" | "refactorer";
export type TddStatus = "ok" | "failed";

export interface TddResultBlock {
  role: TddRole;
  status: TddStatus;
  files: string[];
  command: string;
  output_excerpt: string;
  notes?: string;
}

export type ExtractResult =
  | { ok: true; body: string }
  | { ok: false; reason: string };

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
const FENCE_CLOSE = /^```\s*$/;

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
  const lines = text.split("\n");
  const fences: { startLine: number; body: string }[] = [];
  let inFence = false;
  let buf: string[] = [];
  let bufStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence && FENCE_OPEN.test(line)) {
      inFence = true;
      bufStart = i + 1;
      buf = [];
      continue;
    }
    if (inFence && FENCE_CLOSE.test(line)) {
      fences.push({ startLine: bufStart, body: buf.join("\n") });
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  if (fences.length === 0) {
    return {
      ok: false,
      reason: "no `tdd-result` fenced block found in subagent output",
    };
  }
  if (fences.length > 1) {
    return {
      ok: false,
      reason:
        `expected exactly one \`tdd-result\` fenced block, found ${fences.length}`,
    };
  }
  return { ok: true, body: fences[0]!.body };
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

interface YamlFields {
  role?: string;
  status?: string;
  files?: string[];
  command?: string;
  output_excerpt?: string;
  notes?: string;
  [key: string]: unknown;
}

/**
 * Minimal scoped-YAML parser for the tdd-result schema. Handles:
 *   - top-level scalars (`key: value`)
 *   - inline empty list (`files: []`)
 *   - block list (`files:\n  - a\n  - b`)
 *   - block-literal scalar (`output_excerpt: |\n  line1\n  line2`)
 *
 * The parser intentionally rejects shapes outside this schema (no
 * nested maps, no flow-style maps, no block-folded `>`). The closed
 * schema makes that safe; downstream callers are gated by the strict
 * field set in REQUIRED_FIELDS.
 */
function parseYamlFields(body: string): YamlFields {
  const out: YamlFields = {};
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      i++;
      continue;
    }
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      i++;
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon < 0) {
      i++;
      continue;
    }
    const key = raw.slice(0, colon).trim();
    const rest = raw.slice(colon + 1).trim();
    if (rest === "|") {
      const collected: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.length === 0) {
          collected.push("");
          i++;
          continue;
        }
        if (!(next.startsWith(" ") || next.startsWith("\t"))) break;
        const dedented = next.replace(/^(?:  |\t)/, "");
        collected.push(dedented);
        i++;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") {
        collected.pop();
      }
      out[key] = collected.join("\n");
      continue;
    }
    if (rest === "[]") {
      out[key] = [];
      i++;
      continue;
    }
    if (rest === "") {
      const collected: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.length === 0) {
          i++;
          continue;
        }
        if (!(next.startsWith("  -") || next.startsWith("\t-"))) break;
        const item = next.replace(/^(?:  |\t)-\s*/, "").trim();
        collected.push(item);
        i++;
      }
      out[key] = collected;
      continue;
    }
    out[key] = stripQuotes(rest);
    i++;
  }
  return out;
}

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  }
  return v;
}

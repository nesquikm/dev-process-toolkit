// tdd_fence_yaml — STE-296 refactor. Shared scoped-YAML parser + fence-
// extraction helper used by both `tdd_result.ts` (STE-225, the 3-stage
// TDD child block) and `tdd_spec_review_result.ts` (STE-296, the AUDIT
// stage block). The two callers carry closed schemas with different
// required-field sets; the extraction/parsing primitives here are
// **schema-agnostic** — they produce a raw `Record<string, unknown>`
// and rely on the callers to do field-level validation.
//
// Why this is safe (vs. "do NOT extract if the indirection breaks the
// closed-schema reading"): the closed-schema enforcement lives entirely
// in the caller (REQUIRED_FIELDS validation, role checks, type checks).
// This module only handles the syntactic primitives:
//   - locating the unique fenced block by an opening regex
//   - parsing a body of scoped YAML (top-level scalars, inline empty
//     list, block list, block-literal scalar)
// Both callers retain their own field-validation pipelines verbatim.

export type ExtractResult =
  | { ok: true; body: string }
  | { ok: false; reason: string };

export interface YamlFields {
  [key: string]: unknown;
}

const FENCE_CLOSE = /^```\s*$/;

/**
 * Locate the unique fenced block whose opening line matches `fenceOpen`
 * (e.g., /^```tdd-result\s*$/ or /^```tdd-spec-review-result\s*$/).
 * Returns the body between the opening line and the next ` ``` ` line.
 *
 * Exactly one fence is required: zero or multiple ⇒ format violation
 * with a reason string naming the offending fence tag (`fenceTag`).
 */
export function extractFencedBlock(
  text: string,
  fenceOpen: RegExp,
  fenceTag: string,
): ExtractResult {
  const lines = text.split("\n");
  const fences: { startLine: number; body: string }[] = [];
  let inFence = false;
  let buf: string[] = [];
  let bufStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence && fenceOpen.test(line)) {
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
      reason: `no \`${fenceTag}\` fenced block found in subagent output`,
    };
  }
  if (fences.length > 1) {
    return {
      ok: false,
      reason:
        `expected exactly one \`${fenceTag}\` fenced block, found ${fences.length}`,
    };
  }
  return { ok: true, body: fences[0]!.body };
}

/**
 * Minimal scoped-YAML parser shared by `tdd-result` and
 * `tdd-spec-review-result` blocks. Handles:
 *   - top-level scalars (`key: value`)
 *   - inline empty list (`key: []`)
 *   - block list (`key:\n  - a\n  - b`)
 *   - block-literal scalar (`key: |\n  line1\n  line2`)
 *
 * Intentionally rejects shapes outside this schema (no nested maps, no
 * flow-style maps, no block-folded `>`). The closed-schema callers gate
 * downstream usage with strict REQUIRED_FIELDS validation, so the
 * narrow surface here is safe.
 */
export function parseYamlFields(body: string): YamlFields {
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

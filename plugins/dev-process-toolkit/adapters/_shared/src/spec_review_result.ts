// spec_review_result (STE-308 AC-STE-308.3) — deterministic parser for the
// `spec-review-result` fenced block emitted by the `spec-reviewer` audit
// subagent (forked via `/dev-process-toolkit:spec-review`).
//
// This module is the AC-STE-308.3 deliverable. AC-STE-308.1 (the subagent
// file under `agents/spec-reviewer.md`) is the sibling deliverable in the
// same FR; both share this test file, so the parser surface must exist for
// the AC-STE-308.1 tests to load. The parser body below is the minimum
// implementation that satisfies the AC-STE-308.1 imports and unblocks the
// shared test file; AC-STE-308.3's own dedicated tests (under
// `tests/spec-review-result-parser.test.ts`) are owned by a separate /tdd
// AC and may further expand this module.
//
// Closed-schema rules per AC-STE-308.3:
//   - exactly one fenced ```spec-review-result block
//   - role: spec-reviewer
//   - required sections in canonical order:
//       ## Traceability map
//       ## Findings
//       ## Drift hints
//   - each AC row inside `## Traceability map` carries required fields
//     `ac`, `impl` (or null), `test` (or null), `status` (one of
//     `done` / `missing` / `partial`).

export type TraceabilityStatus = "done" | "missing" | "partial";

export interface TraceabilityRow {
  ac: string;
  impl: string | null;
  test: string | null;
  status: TraceabilityStatus;
}

export interface SpecReviewResult {
  traceability: TraceabilityRow[];
  drift_count: number;
  drift_entries: string[];
  advisory_findings: string[];
}

export type SpecReviewResultParse =
  | { ok: true; block: SpecReviewResult }
  | { ok: false; reason: string };

const FENCE_OPEN = "```spec-review-result";
const FENCE_CLOSE = "```";

const SECTION_TRACEABILITY = "## Traceability map";
const SECTION_FINDINGS = "## Findings";
const SECTION_DRIFT = "## Drift hints";

const VALID_STATUSES: ReadonlyArray<TraceabilityStatus> = [
  "done",
  "missing",
  "partial",
];

function parseNullable(raw: string): string | null {
  const v = raw.trim();
  if (v === "null" || v === "") return null;
  return v;
}

function parseRow(line: string): { ok: true; row: TraceabilityRow } | { ok: false; reason: string } {
  // Strip leading bullet marker (`- `) if present.
  let body = line.replace(/^\s*-\s+/, "").trim();
  if (body.length === 0) {
    return { ok: false, reason: "row body empty (expected `ac`, `impl`, `test`, `status` fields)" };
  }
  const fields: Record<string, string> = {};
  for (const part of body.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    fields[key] = value;
  }
  if (!("ac" in fields) || fields.ac!.length === 0) {
    return { ok: false, reason: "row is missing required field `ac`" };
  }
  if (!("status" in fields)) {
    return { ok: false, reason: `row \`${fields.ac}\` is missing required field \`status\`` };
  }
  const status = fields.status!.trim() as TraceabilityStatus;
  if (!VALID_STATUSES.includes(status)) {
    return {
      ok: false,
      reason: `row \`${fields.ac}\` has invalid \`status\` value \`${status}\` ` +
        `(expected one of: ${VALID_STATUSES.join(", ")})`,
    };
  }
  const impl = "impl" in fields ? parseNullable(fields.impl!) : null;
  const test = "test" in fields ? parseNullable(fields.test!) : null;
  return {
    ok: true,
    row: {
      ac: fields.ac!,
      impl,
      test,
      status,
    },
  };
}

/**
 * Parse the `spec-review-result` fenced block out of free-form text.
 * Returns `{ ok: true, block }` when the block conforms to the closed
 * schema, or `{ ok: false, reason }` naming the offending part.
 */
export function parseSpecReviewResultBlock(content: string): SpecReviewResultParse {
  const lines = content.split("\n");

  // Exactly-one rule — count opening fences across the whole input.
  const fenceOpenIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === FENCE_OPEN) fenceOpenIndices.push(i);
  }
  if (fenceOpenIndices.length === 0) {
    return { ok: false, reason: `no fenced \`${FENCE_OPEN}\` block found (expected exactly one)` };
  }
  if (fenceOpenIndices.length > 1) {
    return {
      ok: false,
      reason:
        `expected exactly one \`${FENCE_OPEN}\` fenced block, ` +
        `found ${fenceOpenIndices.length} (multiple/extra blocks)`,
    };
  }

  const openIdx = fenceOpenIndices[0]!;
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i] === FENCE_CLOSE) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return { ok: false, reason: `missing closing fence \`${FENCE_CLOSE}\`` };
  }

  const inner = lines.slice(openIdx + 1, closeIdx);

  // Parse role line (the first non-empty line in inner SHOULD be `role: spec-reviewer`).
  let roleSeen = false;
  let roleValue: string | null = null;
  for (const line of inner) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("role:")) {
      roleSeen = true;
      roleValue = line.slice("role:".length).trim();
      break;
    }
  }
  if (!roleSeen) {
    return { ok: false, reason: "missing required `role:` field" };
  }
  if (roleValue !== "spec-reviewer") {
    return {
      ok: false,
      reason: `invalid \`role\` value \`${roleValue}\` (expected \`spec-reviewer\`)`,
    };
  }

  // Locate each section heading inside `inner`.
  const headingIndices: { idx: number; text: string }[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i]!.startsWith("## ")) {
      headingIndices.push({ idx: i, text: inner[i]! });
    }
  }
  const sectionHeadings = headingIndices.map((h) => h.text);

  if (!sectionHeadings.includes(SECTION_TRACEABILITY)) {
    return {
      ok: false,
      reason: `missing required section \`${SECTION_TRACEABILITY}\``,
    };
  }
  if (!sectionHeadings.includes(SECTION_FINDINGS)) {
    return {
      ok: false,
      reason: `missing required section \`${SECTION_FINDINGS}\``,
    };
  }
  if (!sectionHeadings.includes(SECTION_DRIFT)) {
    return {
      ok: false,
      reason: `missing required section \`${SECTION_DRIFT}\``,
    };
  }

  function bodyOf(sectionName: string): string[] {
    const idx = headingIndices.findIndex((h) => h.text === sectionName);
    if (idx < 0) return [];
    const startIdx = headingIndices[idx]!.idx + 1;
    const endIdx =
      idx + 1 < headingIndices.length ? headingIndices[idx + 1]!.idx : inner.length;
    return inner.slice(startIdx, endIdx);
  }

  const traceabilityBody = bodyOf(SECTION_TRACEABILITY);
  const findingsBody = bodyOf(SECTION_FINDINGS);
  const driftBody = bodyOf(SECTION_DRIFT);

  const traceability: TraceabilityRow[] = [];
  for (const raw of traceabilityBody) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("-")) continue;
    const parsed = parseRow(raw);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    traceability.push(parsed.row);
  }

  function bulletEntries(body: string[]): string[] {
    const out: string[] = [];
    for (const raw of body) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      if (!trimmed.startsWith("-")) continue;
      const entry = trimmed.replace(/^-\s+/, "").trim();
      if (entry === "(none)") continue;
      out.push(entry);
    }
    return out;
  }

  const advisory_findings = bulletEntries(findingsBody);
  const drift_entries = bulletEntries(driftBody);

  return {
    ok: true,
    block: {
      traceability,
      drift_count: drift_entries.length,
      drift_entries,
      advisory_findings,
    },
  };
}

// deps_research_result (STE-301 AC-STE-301.10 / AC-STE-301.11) — deterministic
// parser for the `deps-research-result` fenced block emitted by the
// `deps-researcher` subagent (forked via `/dev-process-toolkit:deps-research`).
//
// Pattern clone of STE-230's `spec-research-result` shape probe
// (`spec_research_result_shape.ts`), retargeted as a function-shaped parser
// instead of a `/gate-check` probe. The parser is consumed by the
// `/brainstorm` Step 1.5b and `/spec-write` § 0b step 2.5b injection paths as
// well as the dedicated gate-check probe for the deps-research result log.
//
// Closed-schema rules (AC-STE-301.10):
//   - banner line above the opening fence
//   - opening fence ```deps-research-result
//   - exactly three `##` headings in canonical order:
//       ## Relevant Packages
//       ## API Surface Highlights
//       ## Reusable Patterns
//   - optional fourth section `## Missing deps`
//   - hard cap 25 lines (banner + open-fence + body + close-fence)
//   - exactly one fenced block in the text (multiple ⇒ violation)
//
// Any violation surfaces as `{ ok: false, reason: <string naming the
// offending part> }` so the caller can render a precise format-violation
// note. The successful return shape gives the caller per-section body lines
// for downstream rendering (e.g. injection into a prompt body).

/**
 * Canonical banner line — byte-equal match required. Substring match
 * elsewhere in the text is not enough; the banner must sit on its own
 * line immediately above the opening fence.
 */
export const DEPS_RESEARCH_BANNER =
  "> [dependency reference — sibling-package docs surfaced for context; verify against source before treating as authority]";

/**
 * Canonical section names in canonical order. Byte-equal heading lines
 * required (the `## ` prefix is included so a future indent or bullet
 * shape change surfaces as a violation).
 */
export const DEPS_RESEARCH_SECTIONS: readonly string[] = [
  "## Relevant Packages",
  "## API Surface Highlights",
  "## Reusable Patterns",
];

/**
 * Optional fourth subsection — naming entries whose local checkout is
 * absent at scan time. Permitted only after the three canonical
 * sections; never before.
 */
export const DEPS_RESEARCH_OPTIONAL_SECTION = "## Missing deps";

const FENCE_OPEN = "```deps-research-result";
const FENCE_CLOSE = "```";
const MAX_BLOCK_LINES = 25;

export interface DepsResearchSections {
  "## Relevant Packages": string[];
  "## API Surface Highlights": string[];
  "## Reusable Patterns": string[];
  "## Missing deps"?: string[];
}

export type DepsResearchParseResult =
  | { ok: true; sections: DepsResearchSections }
  | { ok: false; reason: string };

/**
 * Parse the `deps-research-result` fenced block out of free-form text.
 * Returns `{ ok: true, sections }` when the block conforms to the
 * closed schema, or `{ ok: false, reason }` naming the offending part
 * (banner / fence / section order / section name / line cap / exactly-
 * one rule).
 */
export function parseDepsResearchBlock(
  content: string,
): DepsResearchParseResult {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    // trailing newline is conventional; drop the synthetic empty entry
    lines.pop();
  }

  // Exactly-one rule — count opening fences across the whole input.
  const fenceOpenIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === FENCE_OPEN) fenceOpenIndices.push(i);
  }
  if (fenceOpenIndices.length === 0) {
    return {
      ok: false,
      reason: `missing opening fence \`${FENCE_OPEN}\``,
    };
  }
  if (fenceOpenIndices.length > 1) {
    return {
      ok: false,
      reason:
        `expected exactly one \`${FENCE_OPEN}\` fenced block, ` +
        `found ${fenceOpenIndices.length} (multiple/duplicate blocks)`,
    };
  }

  const fenceOpenIdx = fenceOpenIndices[0]!;

  // (a) banner immediately above the fence
  const bannerIdx = fenceOpenIdx - 1;
  if (bannerIdx < 0 || lines[bannerIdx] !== DEPS_RESEARCH_BANNER) {
    return {
      ok: false,
      reason:
        `missing canonical banner line on the line immediately above ` +
        `\`${FENCE_OPEN}\` (expected: \`${DEPS_RESEARCH_BANNER}\`)`,
    };
  }

  // Find the closing fence after the opening one.
  let fenceCloseIdx = -1;
  for (let i = fenceOpenIdx + 1; i < lines.length; i++) {
    if (lines[i] === FENCE_CLOSE) {
      fenceCloseIdx = i;
      break;
    }
  }
  if (fenceCloseIdx === -1) {
    return {
      ok: false,
      reason:
        `missing closing fence \`${FENCE_CLOSE}\` for the ` +
        `\`${FENCE_OPEN}\` block`,
    };
  }

  // (d) ≤ 25-line cap on the whole block (banner + open-fence +
  // sections + close-fence). Banner counts as 1 line.
  const blockLineCount =
    1 /* banner */ +
    (fenceCloseIdx - fenceOpenIdx + 1); /* open + body + close */
  if (blockLineCount > MAX_BLOCK_LINES) {
    return {
      ok: false,
      reason:
        `block is ${blockLineCount} lines; the ≤ ${MAX_BLOCK_LINES}-` +
        `line cap is exceeded (banner + opening fence + sections + ` +
        `closing fence)`,
    };
  }

  // (c) headings — exactly three canonical, optionally followed by the
  // `## Missing deps` subsection. All headings live inside the fence.
  const inner = lines.slice(fenceOpenIdx + 1, fenceCloseIdx);
  const headings: { index: number; text: string }[] = [];
  for (let i = 0; i < inner.length; i++) {
    const l = inner[i]!;
    if (l.startsWith("## ")) {
      headings.push({ index: i, text: l });
    }
  }

  const canonical = DEPS_RESEARCH_SECTIONS;
  if (headings.length < canonical.length) {
    return {
      ok: false,
      reason:
        `expected ${canonical.length} canonical \`## \` headings inside ` +
        `the block (in order: ${canonical.join(", ")}), found ` +
        `${headings.length}`,
    };
  }
  if (headings.length > canonical.length + 1) {
    return {
      ok: false,
      reason:
        `expected at most ${canonical.length + 1} \`## \` headings ` +
        `inside the block (3 canonical + optional ` +
        `\`${DEPS_RESEARCH_OPTIONAL_SECTION}\`), found ${headings.length}`,
    };
  }

  // Canonical positions: each heading at position i MUST equal
  // canonical[i]. Out-of-order swap or typo surfaces here.
  for (let i = 0; i < canonical.length; i++) {
    const got = headings[i]!.text;
    const want = canonical[i]!;
    if (got !== want) {
      // Disambiguate "wrong name" vs "wrong order" — if the offender
      // appears elsewhere in the canonical list, it's an order
      // violation; otherwise it's an unknown name.
      const isKnown = canonical.includes(got);
      const reason = isKnown
        ? `section order violation at position ${i + 1}: ` +
          `found \`${got}\`, expected \`${want}\``
        : `unknown section name at position ${i + 1}: \`${got}\` ` +
          `(expected \`${want}\`)`;
      return { ok: false, reason };
    }
  }

  // Optional fourth heading MUST be the canonical "## Missing deps".
  if (headings.length === canonical.length + 1) {
    const optional = headings[canonical.length]!.text;
    if (optional !== DEPS_RESEARCH_OPTIONAL_SECTION) {
      return {
        ok: false,
        reason:
          `unknown section name at optional position ` +
          `${canonical.length + 1}: \`${optional}\` (expected ` +
          `\`${DEPS_RESEARCH_OPTIONAL_SECTION}\`)`,
      };
    }
  }

  // Build per-section body line arrays. Each section's body runs from
  // the line after its heading up to (but not including) the next
  // heading — or the end of the inner block for the last section.
  const sections: DepsResearchSections = {
    "## Relevant Packages": [],
    "## API Surface Highlights": [],
    "## Reusable Patterns": [],
  };
  for (let h = 0; h < headings.length; h++) {
    const startIdx = headings[h]!.index + 1;
    const endIdx =
      h + 1 < headings.length ? headings[h + 1]!.index : inner.length;
    const body = inner.slice(startIdx, endIdx);
    const heading = headings[h]!.text as keyof DepsResearchSections;
    if (heading === "## Missing deps") {
      sections["## Missing deps"] = body;
    } else {
      sections[heading] = body;
    }
  }

  return { ok: true, sections };
}

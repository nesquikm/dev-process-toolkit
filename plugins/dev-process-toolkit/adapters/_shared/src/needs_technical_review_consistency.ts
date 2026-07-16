// needs_technical_review_consistency — /gate-check probe (STE-227 AC-STE-227.9).
//
// Bidirectional invariant on every active FR file:
//   - When `needs_technical_review: true` is set in frontmatter, the
//     `## Technical Design` and `## Testing` body sections MUST contain the
//     canonical placeholder substring (`needs technical review — run`).
//     Anchored substring match — not byte-exact — so future copy edits of
//     the placeholder don't break archived FRs, but ordinary prose
//     containing only the bare two-word phrase doesn't accidentally satisfy
//     the assertion.
//   - When the flag is absent or false, those sections MUST be non-placeholder
//     content (non-empty AND not containing the placeholder substring).
//   - A missing `## Technical Design` or `## Testing` heading itself
//     fires a `missing_section` violation regardless of flag — both sections
//     are part of the canonical 5-section FR shape.
//
// Severity: error. Hard fail on mismatch. Notes use the NFR-10 canonical
// shape (`file:line — reason` + Remedy + Context).
//
// Archived FRs (under `specs/frs/archive/`) are vacuous — the probe walks
// only `specs/frs/*.md` (top-level) and skips files under `archive/`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface NeedsTechnicalReviewConsistencyViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface NeedsTechnicalReviewConsistencyReport {
  violations: NeedsTechnicalReviewConsistencyViolation[];
}

// Anchored on the em-dash so that ordinary prose mentioning the bare
// two-word phrase "needs technical review" does not accidentally satisfy
// the assertion. The full canonical placeholder (`[needs technical review
// — run /spec-write <FR-id> to complete]`) and reasonable copy variants
// (`— please run`, `— ask the technical reviewer to run`) all contain
// this prefix.
const PLACEHOLDER_SUBSTRING = "needs technical review —";

interface ParsedFrontmatter {
  needsTechnicalReview: boolean;
  needsTechnicalReviewLine: number;
  status: string | null;
  endLine: number; // 1-indexed line number of the closing `---` (or 0 if no frontmatter)
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return {
      needsTechnicalReview: false,
      needsTechnicalReviewLine: 1,
      status: null,
      endLine: 0,
    };
  }
  let needsTechnicalReview = false;
  let needsTechnicalReviewLine = 1;
  let status: string | null = null;
  let endLine = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endLine = i + 1;
      break;
    }
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    if (m[1] === "needs_technical_review") {
      needsTechnicalReview = m[2]!.trim() === "true";
      needsTechnicalReviewLine = i + 1;
    } else if (m[1] === "status") {
      status = m[2]!.trim();
    }
  }
  return { needsTechnicalReview, needsTechnicalReviewLine, status, endLine };
}

interface SectionExtract {
  body: string;
  startLine: number; // 1-indexed line number of the heading itself
}

function extractSection(content: string, headingName: string): SectionExtract | null {
  const lines = content.split("\n");
  const headingRe = new RegExp(`^##\\s+${headingName}\\s*$`);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i]!)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j]!)) {
      endIdx = j;
      break;
    }
  }
  const body = lines.slice(startIdx + 1, endIdx).join("\n");
  return { body, startLine: startIdx + 1 };
}

type ViolationKind =
  | "missing_placeholder"
  | "stray_placeholder"
  | "empty_section"
  | "missing_section";

function buildMessage(reason: string, file: string, kind: ViolationKind): string {
  const remedy = {
    missing_placeholder:
      "Frontmatter declares `needs_technical_review: true` but `## Technical Design` and/or `## Testing` body lacks the canonical placeholder substring (`[needs technical review — run /spec-write …]`). Either restore the placeholder line or remove the `needs_technical_review:` flag once the technical sections are filled in.",
    stray_placeholder:
      "Frontmatter does not set `needs_technical_review: true` but `## Technical Design` and/or `## Testing` body still carries the placeholder substring. Either complete the section with real content or set `needs_technical_review: true` to declare the gap explicitly.",
    empty_section:
      "FR file's `## Technical Design` and/or `## Testing` section has an empty body. Fill the section with real content, or set `needs_technical_review: true` to declare the gap explicitly (which makes the placeholder line the expected body).",
    missing_section:
      "FR file is missing the `## Technical Design` and/or `## Testing` heading entirely. Both sections are part of the canonical 5-section FR shape (Requirement / Acceptance Criteria / Technical Design / Testing / Notes; an optional `## Summary` may open the body). Add the missing heading and either fill it with real content or set `needs_technical_review: true` to declare the gap explicitly.",
  }[kind];
  return [
    `needs_technical_review_consistency: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: file=${file}, probe=needs_technical_review_consistency`,
  ].join("\n");
}

export async function runNeedsTechnicalReviewConsistencyProbe(
  projectRoot: string,
): Promise<NeedsTechnicalReviewConsistencyReport> {
  const frsDir = join(projectRoot, "specs", "frs");
  if (!existsSync(frsDir)) return { violations: [] };

  const violations: NeedsTechnicalReviewConsistencyViolation[] = [];
  const entries = readdirSync(frsDir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip archive/ dir (vacuous) and any non-md file.
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    const fullPath = join(frsDir, entry.name);
    const rel = relative(projectRoot, fullPath);
    const content = readFileSync(fullPath, "utf-8");
    const fm = parseFrontmatter(content);

    // Defensive: archived FRs that somehow live at the top level skip.
    if (fm.status === "archived") continue;

    const techDesign = extractSection(content, "Technical Design");
    const testing = extractSection(content, "Testing");

    const sections: Array<{ name: string; section: SectionExtract | null }> = [
      { name: "Technical Design", section: techDesign },
      { name: "Testing", section: testing },
    ];

    // Frontmatter line is the anchor when sections are missing — there's
    // no body line number to point at otherwise. Falls back to line 1 when
    // frontmatter parsing failed.
    const fmAnchor = fm.endLine > 0 ? fm.endLine : 1;

    for (const { name, section } of sections) {
      if (!section) {
        const reason = `${rel} is missing the \`## ${name}\` heading entirely`;
        violations.push({
          file: fullPath,
          line: fmAnchor,
          reason,
          note: `${rel}:${fmAnchor} — ${reason} (missing_section)`,
          message: buildMessage(reason, rel, "missing_section"),
        });
        continue;
      }
      const body = section.body;
      const trimmed = body.trim();
      const hasPlaceholder = trimmed.toLowerCase().includes(PLACEHOLDER_SUBSTRING);

      if (fm.needsTechnicalReview) {
        // Flag set: section body MUST contain placeholder substring.
        if (!hasPlaceholder) {
          const reason = `${rel} has \`needs_technical_review: true\` but \`## ${name}\` section lacks the canonical placeholder substring`;
          violations.push({
            file: fullPath,
            line: section.startLine,
            reason,
            note: `${rel}:${section.startLine} — ${reason} (missing_placeholder)`,
            message: buildMessage(reason, rel, "missing_placeholder"),
          });
        }
      } else {
        // Flag absent or false: section body MUST be non-empty AND non-placeholder.
        if (trimmed.length === 0) {
          const reason = `${rel} has no \`needs_technical_review:\` flag but \`## ${name}\` section is empty`;
          violations.push({
            file: fullPath,
            line: section.startLine,
            reason,
            note: `${rel}:${section.startLine} — ${reason} (empty_section)`,
            message: buildMessage(reason, rel, "empty_section"),
          });
        } else if (hasPlaceholder) {
          const reason = `${rel} has no \`needs_technical_review:\` flag but \`## ${name}\` section still carries the placeholder substring`;
          violations.push({
            file: fullPath,
            line: section.startLine,
            reason,
            note: `${rel}:${section.startLine} — ${reason} (stray_placeholder)`,
            message: buildMessage(reason, rel, "stray_placeholder"),
          });
        }
      }
    }
  }
  return { violations };
}

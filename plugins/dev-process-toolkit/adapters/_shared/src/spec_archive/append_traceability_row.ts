// append_traceability_row — STE-171 AC-STE-171.1 helper.
//
// Phase 4 § Milestone Archival calls this once per archived FR to append a
// shipped-AC row to `specs/requirements.md` § 6 Traceability Matrix. The
// row shape is `| AC-<frId>.<lo>..<hi> | <impl-files> | <test-files> |`
// when the AC numbers form a contiguous range, otherwise comma-separated
// per-AC entries. Idempotent on re-run: an existing row mentioning any
// `AC-<frId>.` token is detected and not duplicated. Missing § 6 or
// missing requirements.md ⇒ silent no-op (no throw, no synthetic section).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AppendResult {
  added: boolean;
  rowText: string | null;
}

const HEADING_RE = /^##\s+6\.\s+Traceability Matrix\s*$/m;
const NEXT_HEADING_RE = /^##\s+\S/m;

function formatAcRange(frId: string, acNumbers: number[]): string {
  if (acNumbers.length === 0) return `AC-${frId}`;
  const sorted = [...acNumbers].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  const isContiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  if (isContiguous) {
    return lo === hi ? `AC-${frId}.${lo}` : `AC-${frId}.${lo}..${hi}`;
  }
  return sorted.map((n) => `AC-${frId}.${n}`).join(", ");
}

function locateMatrixSection(content: string): { sectionStart: number; sectionEnd: number } | null {
  const headingMatch = HEADING_RE.exec(content);
  if (!headingMatch) return null;
  const sectionStart = headingMatch.index + headingMatch[0].length;
  // Find the next `##` heading after § 6 (or EOF).
  const remainder = content.slice(sectionStart);
  const nextHeadingMatch = NEXT_HEADING_RE.exec(remainder);
  const sectionEnd = nextHeadingMatch ? sectionStart + nextHeadingMatch.index : content.length;
  return { sectionStart, sectionEnd };
}

export function appendTraceabilityRow(
  repoRoot: string,
  frId: string,
  acNumbers: number[],
  implFiles: string[],
  testFiles: string[],
): AppendResult {
  const reqPath = join(repoRoot, "specs", "requirements.md");
  if (!existsSync(reqPath)) return { added: false, rowText: null };

  let content: string;
  try {
    content = readFileSync(reqPath, "utf-8");
  } catch {
    return { added: false, rowText: null };
  }

  const section = locateMatrixSection(content);
  if (!section) return { added: false, rowText: null };

  const sectionBody = content.slice(section.sectionStart, section.sectionEnd);
  // Idempotency: any prior row carrying `AC-<frId>.` (with trailing dot or
  // end-of-token) means the FR has already been logged. Escape every regex
  // metacharacter in `frId` so unusual tracker-ID shapes (e.g., `+`, `(`)
  // don't fall through to a malformed regex.
  const escapedFrId = frId.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const existingRowRe = new RegExp(`AC-${escapedFrId}\\.[0-9]`);
  if (existingRowRe.test(sectionBody)) {
    return { added: false, rowText: null };
  }

  const acColumn = formatAcRange(frId, acNumbers);
  const implColumn = implFiles.length > 0 ? implFiles.join(", ") : "—";
  const testColumn = testFiles.length > 0 ? testFiles.join(", ") : "—";
  const row = `| ${acColumn} | ${implColumn} | ${testColumn} |`;

  // Append the row at the end of the section, before the next heading. Trim
  // trailing whitespace inside the section so the row sits flush with the
  // existing table; preserve a single trailing newline before the next
  // heading.
  const trimmedSection = sectionBody.replace(/\s+$/, "");
  const newSection = `${trimmedSection}\n${row}\n\n`;
  const next = content.slice(0, section.sectionStart) + newSection + content.slice(section.sectionEnd);

  writeFileSync(reqPath, next);
  return { added: true, rowText: row };
}

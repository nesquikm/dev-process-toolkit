// audit_log — STE-108 AC-STE-108.7 helper.
//
// Append a `## /setup audit` entry to CLAUDE.md when /setup auto-decides a
// `default:`-annotated step. The audit section is the sole signal that a
// project was set up autonomously (or with pre-baked answers); reading it
// is sufficient signal for `/gate-check` probe `setup-audit-section-presence`.
//
// Pure file I/O. The skill prose decides *when* to append; this helper only
// formats and writes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SECTION_HEADING = "## /setup audit";

export interface AuditEntry {
  date: string; // ISO date (YYYY-MM-DD)
  step: string; // e.g., "7c"
  field: string; // e.g., "branch_template"
  value: unknown; // serialized verbatim with JSON.stringify (quotes for strings)
  reason: string; // free-form, typically "default applied" / "pre-baked answer"
}

function renderBullet(entry: AuditEntry): string {
  // JSON.stringify handles every type uniformly, including escaping `"` and
  // `\` in strings — required so a value like `feat/{ticket-id}-"weird"` round-trips through
  // YAML-flavoured prose without breaking the audit-line shape.
  const valueRendered = JSON.stringify(entry.value);
  const reasonRendered = JSON.stringify(entry.reason);
  return `- ${entry.date} step:${entry.step} (${entry.field}) value:${valueRendered} reason:${reasonRendered}`;
}

/**
 * Append an audit entry to CLAUDE.md's `## /setup audit` section.
 *
 * Behavior:
 *   - section absent: create it at the end of file with one blank line above
 *     the heading and the new bullet directly below.
 *   - section present: insert the new bullet at the end of the section
 *     (immediately before the next `##`-level heading or EOF).
 *   - never de-duplicates — append-only is the contract (STE-108 AC-STE-108.7).
 *
 * @throws Error if the CLAUDE.md file does not exist.
 */
export function appendAuditEntry(claudeMdPath: string, entry: AuditEntry): void {
  if (!existsSync(claudeMdPath)) {
    throw new Error(
      `appendAuditEntry: CLAUDE.md not found at ${claudeMdPath} — /setup must write the file before logging audit entries`,
    );
  }
  const content = readFileSync(claudeMdPath, "utf-8");
  const bullet = renderBullet(entry);
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((l) => l === SECTION_HEADING);

  let next: string;
  if (sectionStart < 0) {
    // Create the section at end of file.
    const trimmed = content.replace(/\n+$/, "");
    next = `${trimmed}\n\n${SECTION_HEADING}\n\n${bullet}\n`;
  } else {
    // Find where the section ends (next `##` heading or EOF).
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]!)) {
        sectionEnd = i;
        break;
      }
    }
    // Walk backwards from sectionEnd to find the last non-empty line in
    // the section — we insert directly after it, then preserve the trailing
    // blank line(s) before the next `##` heading.
    let lastBulletIdx = sectionStart;
    for (let i = sectionEnd - 1; i > sectionStart; i--) {
      if ((lines[i] ?? "").length > 0) {
        lastBulletIdx = i;
        break;
      }
    }
    const before = lines.slice(0, lastBulletIdx + 1);
    const after = lines.slice(lastBulletIdx + 1);
    next = [...before, bullet, ...after].join("\n");
  }
  writeFileSync(claudeMdPath, next);
}

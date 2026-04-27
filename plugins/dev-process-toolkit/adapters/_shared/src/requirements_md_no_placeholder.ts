// requirements_md_no_placeholder — /gate-check probe (STE-129 AC-STE-129.4).
//
// Severity: warning. Scans `specs/requirements.md` for the literal
// `<tracker-id>` placeholder (outside fenced/inline-backtick spans), the
// `[Feature Name]` placeholder, and the legacy `### FR-N: [Feature Name]`
// heading shape. Each surviving placeholder → one note in `file:line —
// reason` shape. Catches the cross-spec drift surface where /setup or a
// hand edit left a placeholder block in `requirements.md` even though the
// architecture moved per-FR detail to `specs/frs/<id>.md` post-M18.
//
// Exemptions: tokens inside HTML comments (<!-- ... -->), inline
// backticks (`...`), and fenced code blocks (```...```) are exempt — those
// are documentation/example surfaces, not active content.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "warning" | "error";

export interface RequirementsMdPlaceholderViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface RequirementsMdPlaceholderReport {
  violations: RequirementsMdPlaceholderViolation[];
}

const PLACEHOLDER_TOKENS: { pattern: RegExp; label: string }[] = [
  { pattern: /\[Feature Name\]/, label: "[Feature Name]" },
  { pattern: /<tracker-id>/, label: "<tracker-id>" },
];

const LEGACY_FR_HEADING = /^###\s+FR-\d+:\s*\[Feature Name\]/;

function buildMessage(reason: string, file: string, label: string): string {
  return [
    `requirements_md_no_placeholder: ${reason}`,
    `Remedy: ${label === "<tracker-id>"
      ? `substitute the literal <tracker-id> with the real tracker ID returned by the allocator, or remove the heading entirely if the FR belongs in specs/frs/`
      : `remove the placeholder heading from specs/requirements.md (per-FR content lives in specs/frs/<id>.md post-M18)`}. ` +
      `requirements.md is cross-cutting only — see plugins/dev-process-toolkit/docs/patterns.md § Test Layout Policy / STE-129.`,
    `Context: file=${file}, placeholder=${label}, probe=requirements_md_no_placeholder, severity=warning`,
  ].join("\n");
}

function stripExemptSpans(line: string): string {
  // Replace anything inside backticks `...` with spaces of equal length so
  // line offsets stay aligned. (Most callers don't depend on offsets, but
  // this keeps the line scanning simple and conservative.)
  return line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

function lineIsInsideFenceOrComment(
  rawLines: string[],
  index: number,
): boolean {
  let inFence = false;
  let inComment = false;
  for (let i = 0; i <= index; i++) {
    const line = rawLines[i] ?? "";
    if (/^```/.test(line)) {
      // The opener/closer line itself is fence metadata — not "inside" content.
      // Return the pre-toggle state so a line that is itself a ``` boundary
      // is treated as not-inside (which is what we want — boundary lines never
      // hold placeholder content). Lines AFTER an opener are inside the fence.
      if (i < index) inFence = !inFence;
      else return inFence;
    }
    if (i === index) break;
    if (line.includes("<!--") && !line.includes("-->")) inComment = true;
    else if (line.includes("-->") && !line.includes("<!--")) inComment = false;
    // single-line `<!-- ... -->` (both markers on one line) doesn't change state
  }
  if (inFence) return true;
  if (inComment) return true;
  // Single-line HTML comment that wraps the entire line.
  const target = (rawLines[index] ?? "").trim();
  if (target.startsWith("<!--") && target.endsWith("-->")) return true;
  return false;
}

export async function runRequirementsMdNoPlaceholderProbe(
  projectRoot: string,
): Promise<RequirementsMdPlaceholderReport> {
  const reqPath = join(projectRoot, "specs", "requirements.md");
  if (!existsSync(reqPath)) return { violations: [] };

  let content: string;
  try {
    content = readFileSync(reqPath, "utf-8");
  } catch {
    return { violations: [] };
  }

  const lines = content.split("\n");
  const rel = relative(projectRoot, reqPath);
  const violations: RequirementsMdPlaceholderViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lineIsInsideFenceOrComment(lines, i)) continue;
    const raw = lines[i]!;
    const visible = stripExemptSpans(raw);

    // Legacy FR-N: [Feature Name] heading shape (compound check, more
    // informative than just `[Feature Name]`).
    if (LEGACY_FR_HEADING.test(raw)) {
      const reason = `legacy FR placeholder heading "${raw.trim()}" (per-FR content moved to specs/frs/ post-M18)`;
      violations.push({
        file: reqPath,
        line: i + 1,
        reason,
        note: `${rel}:${i + 1} — ${reason}`,
        message: buildMessage(reason, rel, "FR-N: [Feature Name]"),
        severity: "warning",
      });
      continue; // don't double-report on the same heading line
    }

    for (const { pattern, label } of PLACEHOLDER_TOKENS) {
      if (pattern.test(visible)) {
        const reason = `surviving ${label} placeholder in active content`;
        violations.push({
          file: reqPath,
          line: i + 1,
          reason,
          note: `${rel}:${i + 1} — ${reason}`,
          message: buildMessage(reason, rel, label),
          severity: "warning",
        });
      }
    }
  }

  return { violations };
}

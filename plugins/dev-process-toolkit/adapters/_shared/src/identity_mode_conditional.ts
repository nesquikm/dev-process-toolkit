// identity_mode_conditional — /gate-check probe (STE-86 AC-STE-86.5/6/8).
//
// Bimodal invariant:
//   - mode: none        → every active FR MUST carry `id: fr_<26-char ULID>`
//   - mode: <tracker>   → every active FR MUST NOT carry an `id:` line
//
// Severity at M21 ship: warning. After ≥1 dogfood cycle, flip to "error"
// via the TODO anchor below.
//
// Zero runtime dep on ulid.ts (AC-STE-86.8) — the ULID shape regex is
// inlined as a private constant. The probe is a bimodal-invariant enforcer
// and must not cross the scope-3 isolation boundary around mode-none
// identity minting.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { readTaskTrackingSection } from "./resolver_config";

// AC-STE-86.8: inlined to avoid runtime dep on ulid.ts.
const ULID_ID_LINE_RE = /^id: fr_[0-9A-HJKMNP-TV-Z]{26}$/;
const ANY_ID_LINE_RE = /^id:\s*(.*)$/;

// AC-STE-86.6: severity posture at M21 ship. Keep as a literal string for
// stable grepping by the follow-up severity flip.
// TODO(STE-<follow-up>): flip severity to "error" after one dogfood cycle
export const IDENTITY_MODE_CONDITIONAL_SEVERITY: "warning" | "error" = "warning";

export interface IdentityModeViolation {
  file: string;
  line: number;
  expected: "present" | "absent" | "fr_<26-char ULID>";
  actual: string;
  note: string;
  message: string;
}

export interface IdentityModeConditionalReport {
  mode: string;
  severity: "warning" | "error";
  violations: IdentityModeViolation[];
}

interface IdScan {
  present: boolean;
  line: number;
  value: string;
  wellFormed: boolean;
}

function scanFrontmatterForId(content: string): IdScan {
  if (!content.startsWith("---\n")) {
    return { present: false, line: 0, value: "", wellFormed: false };
  }
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) {
    return { present: false, line: 0, value: "", wellFormed: false };
  }
  const fmText = content.slice(4, closeIdx);
  const fmLines = fmText.split("\n");
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    const m = ANY_ID_LINE_RE.exec(line);
    if (!m) continue;
    return {
      present: true,
      // +2: one for the leading `---\n` line, one for 1-based indexing.
      line: i + 2,
      value: (m[1] ?? "").trim(),
      wellFormed: ULID_ID_LINE_RE.test(line),
    };
  }
  return { present: false, line: 0, value: "", wellFormed: false };
}

function resolveMode(projectRoot: string): string {
  const section = readTaskTrackingSection(join(projectRoot, "CLAUDE.md"));
  const mode = section["mode"];
  if (!mode || mode.length === 0) return "none";
  return mode;
}

async function listActiveFRs(projectRoot: string): Promise<string[]> {
  const frsDir = join(projectRoot, "specs", "frs");
  try {
    const entries = await readdir(frsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(frsDir, e.name))
      .sort();
  } catch {
    return [];
  }
}

function buildNote(file: string, line: number, reason: string, projectRoot: string): string {
  const rel = relative(projectRoot, file);
  return `${rel}:${line} — ${reason}`;
}

function buildMessage(reason: string, remedy: string, context: Record<string, string>): string {
  // NFR-10 canonical shape: verdict + remedy + context fused.
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `identity_mode_conditional: ${reason}\nRemedy: ${remedy}\nContext: ${contextStr}`;
}

/**
 * Scan every active FR under `projectRoot/specs/frs/*.md` and return the
 * list of violations. Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` v2 conformance probes + the STE-82 integration
 * test at `tests/gate-check-identity-mode-conditional.test.ts`.
 */
export async function runIdentityModeConditionalProbe(
  projectRoot: string,
): Promise<IdentityModeConditionalReport> {
  const mode = resolveMode(projectRoot);
  const isTracker = mode !== "none";
  const files = await listActiveFRs(projectRoot);
  const violations: IdentityModeViolation[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const scan = scanFrontmatterForId(content);

    if (isTracker) {
      // Tracker mode: id: must be absent.
      if (scan.present) {
        const expected = "absent" as const;
        const actual = scan.value;
        violations.push({
          file,
          line: scan.line,
          expected,
          actual,
          note: buildNote(file, scan.line, `expected ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `tracker-mode FR carries an id: line that should be absent (observed ${actual})`,
            `delete the id: line from ${relative(projectRoot, file)} frontmatter — the tracker ID is the canonical identity in tracker mode`,
            { mode, file: relative(projectRoot, file), line: String(scan.line) },
          ),
        });
      }
    } else {
      // mode: none — id: must be present AND well-formed.
      if (!scan.present) {
        const expected = "present" as const;
        const actual = "missing";
        violations.push({
          file,
          line: 1,
          expected,
          actual,
          note: buildNote(file, 1, `expected id: line ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `mode-none FR is missing its id: line`,
            `add a valid id: fr_<26-char ULID> line to ${relative(projectRoot, file)} frontmatter — mode-none identity is the short-ULID`,
            { mode, file: relative(projectRoot, file) },
          ),
        });
      } else if (!scan.wellFormed) {
        const expected = "fr_<26-char ULID>" as const;
        const actual = scan.value;
        violations.push({
          file,
          line: scan.line,
          expected,
          actual,
          note: buildNote(
            file,
            scan.line,
            `expected ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `mode-none FR has a malformed id: value (observed ${actual})`,
            `fix the id: line in ${relative(projectRoot, file)} to match ${expected}`,
            { mode, file: relative(projectRoot, file), line: String(scan.line) },
          ),
        });
      }
    }
  }

  return {
    mode,
    severity: IDENTITY_MODE_CONDITIONAL_SEVERITY,
    violations,
  };
}

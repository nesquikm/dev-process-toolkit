// identity_mode_conditional — /gate-check probe (STE-86 AC-STE-86.5/6/8).
//
// Bimodal invariant:
//   - mode: none        → every active FR MUST carry `id: fr_<26-char ULID>`
//   - mode: <tracker>   → every active FR MUST NOT carry an `id:` line
//
// Severity flipped warning → error at M29 (STE-110 AC-STE-110.4): now that
// /spec-write's tracker-mode template no longer emits `id:`, regressions
// must hard-fail rather than slip through as a `GATE PASSED WITH NOTES`.
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

// STE-110 AC-STE-110.4 (M29): severity flipped warning → error. The flip
// landed once /spec-write stopped emitting `id:` in tracker mode (the
// regression source). The TODO anchor below is preserved as a historical
// pointer; the literal "error" string is what /gate-check reads.
// TODO(STE-110): severity flipped warn → error in M29 ship.
export const IDENTITY_MODE_CONDITIONAL_SEVERITY: "warning" | "error" = "error";

export interface IdentityModeViolation {
  file: string;
  line: number;
  expected: "present" | "absent" | "populated" | "fr_<26-char ULID>";
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

/**
 * Extract the line array of an FR's YAML frontmatter block, or `null` when
 * the content lacks a well-formed `---\n...\n---` opener. Shared by
 * `scanFrontmatterForId` and `scanFrontmatterForTracker` — both scanners
 * walked the same 7-line prelude before this hoist.
 */
function splitFrontmatterLines(content: string): string[] | null {
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return null;
  return content.slice(4, closeIdx).split("\n");
}

function scanFrontmatterForId(content: string): IdScan {
  const fmLines = splitFrontmatterLines(content);
  if (fmLines === null) {
    return { present: false, line: 0, value: "", wellFormed: false };
  }
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

// STE-321 AC-STE-321.5 + AC-STE-321.10 — bidirectional `tracker:` invariant.
//
// Detect whether the FR frontmatter carries a `tracker:` block and whether it
// is populated. Three states:
//   - present=false              → no `tracker:` line at all
//   - present=true, empty=true   → `tracker: {}` (legacy drift in mode-none)
//   - present=true, empty=false  → `tracker:` followed by at least one nested
//                                  `<key>: <value>` line (canonical tracker mode)
//
// Twin scanner of `scanFrontmatterForId`. Exported so the test surface
// (`tests/m84-ste-321-adapter-shape.test.ts`) can byte-check the helper
// independently of the probe.

export interface TrackerScan {
  present: boolean;
  empty: boolean;
  line: number;
}

const TRACKER_LINE_RE = /^tracker:\s*(.*)$/;

export function scanFrontmatterForTracker(content: string): TrackerScan {
  const fmLines = splitFrontmatterLines(content);
  if (fmLines === null) {
    return { present: false, empty: false, line: 0 };
  }
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    const m = TRACKER_LINE_RE.exec(line);
    if (!m) continue;
    // +2: one for the leading `---\n` line, one for 1-based indexing.
    const lineNum = i + 2;
    const inlineValue = (m[1] ?? "").trim();
    // `tracker: {}` — empty inline map.
    if (inlineValue === "{}") {
      return { present: true, empty: true, line: lineNum };
    }
    // `tracker: { key: value }` — populated inline map.
    if (inlineValue.startsWith("{") && inlineValue.endsWith("}")) {
      const body = inlineValue.slice(1, -1).trim();
      return { present: true, empty: body.length === 0, line: lineNum };
    }
    // `tracker:` with trailing content other than `{...}` — treat as populated.
    if (inlineValue.length > 0) {
      return { present: true, empty: false, line: lineNum };
    }
    // `tracker:` followed by indented child lines → populated when at least
    // one nested `key: value` line appears before frontmatter close.
    for (let j = i + 1; j < fmLines.length; j++) {
      const child = fmLines[j]!;
      if (/^\s+\S/.test(child)) {
        // indented continuation — populated.
        return { present: true, empty: false, line: lineNum };
      }
      if (child.length === 0) continue;
      // un-indented sibling key → tracker: had no children, treat as empty.
      break;
    }
    return { present: true, empty: true, line: lineNum };
  }
  return { present: false, empty: false, line: 0 };
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
    const trackerScan = scanFrontmatterForTracker(content);

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
      // STE-321 AC-STE-321.5: tracker mode requires `tracker:` present + populated.
      if (!trackerScan.present || trackerScan.empty) {
        const expected = "populated" as const;
        const actual = !trackerScan.present ? "missing" : "empty";
        const violationLine = trackerScan.present ? trackerScan.line : 1;
        violations.push({
          file,
          line: violationLine,
          expected,
          actual,
          note: buildNote(
            file,
            violationLine,
            `expected tracker: ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `tracker-mode FR is missing a populated tracker: block (observed ${actual})`,
            `add a tracker: { ${mode}: <ticket-id> } block to ${relative(projectRoot, file)} frontmatter — tracker mode binds the FR to its ticket via this field`,
            { mode, file: relative(projectRoot, file), line: String(violationLine) },
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
      // STE-321 AC-STE-321.5: mode-none requires `tracker:` ABSENT.
      if (trackerScan.present) {
        const expected = "absent" as const;
        const actual = trackerScan.empty ? "tracker: {}" : "tracker: { ... }";
        violations.push({
          file,
          line: trackerScan.line,
          expected,
          actual,
          note: buildNote(
            file,
            trackerScan.line,
            `expected tracker: ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `mode-none FR carries a tracker: block that should be absent (observed ${actual})`,
            `delete the tracker: line from ${relative(projectRoot, file)} frontmatter — mode-none FRs identify themselves via the short-ULID id: line, not a tracker binding`,
            { mode, file: relative(projectRoot, file), line: String(trackerScan.line) },
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

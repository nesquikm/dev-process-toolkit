// best_practices_manifest_hygiene — /gate-check probe #76 (STE-465).
//
// Invariant (AC-STE-465.4): when `specs/best-practices.yaml` is present, its
// shape must validate against the STE-465 manifest schema
// (`best_practices_manifest.ts` reader — closed schema, repo-relative paths)
// AND every entry's `path` must resolve on disk relative to the project root.
// A shape error or a dangling `path` is an ERROR-severity violation in the
// NFR-10 canonical shape naming the manifest line, the offending value, and
// the remedy.
//
// Vacuous when the manifest is absent — the day-one default for every
// existing consumer project (absence is NOT the same as an empty manifest:
// `best_practices: []` on disk is a valid, present, zero-entry manifest).
//
// Violation shape mirrors probe #16/#63 (`plan_ship_coherence.ts`): `note` is
// `<repo-relative-file>:<line> — <reason>`, `message` is the multi-line
// canonical shape with `Remedy:` and `Context:` sub-lines.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BestPracticesManifestShapeError,
  readManifest,
} from "./best_practices_manifest";

const PROBE = "best_practices_manifest_hygiene";
const MANIFEST_REL = "specs/best-practices.yaml";

export interface BestPracticesManifestHygieneViolation {
  file: string;
  line: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface BestPracticesManifestHygieneReport {
  violations: BestPracticesManifestHygieneViolation[];
  notes: string[];
}

/** Build the full violation record: `note` per STE-82, `message` per NFR-10. */
function makeViolation(
  file: string,
  line: number,
  reason: string,
  remedy: string,
): BestPracticesManifestHygieneViolation {
  return {
    file,
    line,
    reason,
    note: `${MANIFEST_REL}:${line} — ${reason}`,
    message: [
      `${PROBE}: ${reason}`,
      `Remedy: ${remedy}`,
      `Context: file=${MANIFEST_REL}, probe=${PROBE}`,
    ].join("\n"),
  };
}

/**
 * Best-effort 1-based line number for the manifest line declaring `path:
 * <path>`. Falls back to 1 when the raw text can't be re-located (the note
 * stays well-formed either way).
 */
function findPathLine(rawText: string, path: string): number {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:-\s+)?path:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const value = m[1]!.trim();
    const unquoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
        ? value.slice(1, -1)
        : value;
    if (unquoted === path) return i + 1;
  }
  return 1;
}

/**
 * Extract the manifest line number carried inside a shape-error reason
 * (`best-practices.yaml line N: ...` / `... at line N: ...`). Falls back
 * to 1 for reasons that don't name a line (e.g., the empty-file refusal).
 */
function lineFromShapeReason(reason: string): number {
  const m = /\bline (\d+)\b/.exec(reason);
  return m ? Number(m[1]) : 1;
}

/**
 * Scan `specs/best-practices.yaml` under `projectRoot`: validate the
 * manifest shape via the STE-465 reader, then check every entry's `path`
 * resolves on disk relative to `projectRoot`. Pure function — no side
 * effects, no writes.
 *
 * Call site: `/gate-check` conformance probe #76 + the STE-465 integration
 * test at `tests/gate-check-best-practices-manifest-hygiene.test.ts`.
 */
export async function runBestPracticesManifestHygieneProbe(
  projectRoot: string,
): Promise<BestPracticesManifestHygieneReport> {
  const manifestAbs = join(projectRoot, "specs", "best-practices.yaml");
  const violations: BestPracticesManifestHygieneViolation[] = [];
  const notes: string[] = [];

  // Vacuous when the manifest is absent — the day-one consumer default.
  if (!existsSync(manifestAbs)) return { violations, notes };

  let rawText = "";
  try {
    rawText = readFileSync(manifestAbs, "utf8");
  } catch {
    // Unreadable-but-present falls through to readManifest, whose own
    // read wraps the failure into a shape error below.
  }

  try {
    const manifest = readManifest(join(projectRoot, "specs"));
    for (const entry of manifest.best_practices) {
      if (existsSync(join(projectRoot, entry.path))) continue;
      violations.push(
        makeViolation(
          manifestAbs,
          findPathLine(rawText, entry.path),
          `manifest entry \`${entry.name}\` references ${entry.path}, which does not resolve on disk`,
          `create ${entry.path}, fix the entry's \`path\` to the document's real repo-relative location, or remove the entry via /deps-style manifest editing (/dev-process-toolkit:setup best-practices surface).`,
        ),
      );
    }
  } catch (err) {
    if (!(err instanceof BestPracticesManifestShapeError)) throw err;
    // Shape error → exactly one ERROR violation carrying the reader's
    // NFR-10 reason. Never a silent skip, never a crash.
    violations.push(
      makeViolation(
        manifestAbs,
        lineFromShapeReason(err.reason),
        `malformed best-practices manifest: ${err.reason}`,
        "fix specs/best-practices.yaml to conform to the manifest schema (closed entry keys: name, path, scope, topics, notes; repo-relative paths) and re-run /gate-check.",
      ),
    );
  }

  return { violations, notes };
}

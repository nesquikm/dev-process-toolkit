// tracker_tolerance_wrapper_present — /gate-check probe (STE-304 AC-STE-304.10).
//
// Defense-in-depth byte-check that the tracker-tolerance Provider wrapper
// remains present in the toolkit's shared adapter layer. If a future refactor
// accidentally drops `tracker_tolerance.ts` or renames the `withTolerance`
// export, FR4's relaxed status-mapping probes would silently lose tolerance
// — the prompt path would never wire up. This probe is the structural fuse
// that catches that regression at gate-check time.
//
// Severity: error.
//
// Vacuous when `plugins/dev-process-toolkit/adapters/_shared/src/` is absent
// (non-toolkit projects do not ship the shared adapter layer; the probe has
// nothing to check).
//
// Mirrors probe #16 archive_plan_status shape — returns a
// `violations: TrackerToleranceWrapperPresentViolation[]` report with
// `file:line — reason` notes in NFR-10 canonical shape so callers can
// render them verbatim.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SHARED_SRC_RELPATH = join(
  "plugins",
  "dev-process-toolkit",
  "adapters",
  "_shared",
  "src",
);
const WRAPPER_BASENAME = "tracker_tolerance.ts";
const WRAPPER_RELPATH = join(SHARED_SRC_RELPATH, WRAPPER_BASENAME);
// Accept either form of the public re-export so the probe doesn't drift if
// the wrapper is reshaped into a `const` factory later.
const EXPORT_NEEDLE = /export\s+(?:function|const)\s+withTolerance\b/;

export interface TrackerToleranceWrapperPresentViolation {
  file: string;
  line: number;
  severity: "error";
  reason: string;
  /** `file:line — reason` per NFR-10 / STE-82. */
  note: string;
  /** NFR-10 canonical multi-line `Refusing: / Remedy: / Context:` shape. */
  message: string;
}

export interface TrackerToleranceWrapperPresentReport {
  violations: TrackerToleranceWrapperPresentViolation[];
  /** Populated when the probe early-returned (no shared-src dir present). */
  skippedReason?: string;
}

function buildMessage(reason: string, remedy: string, context: string): string {
  return [
    `tracker_tolerance_wrapper_present: Refusing: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: ${context}`,
  ].join("\n");
}

/**
 * Scan the toolkit's shared adapter layer for the tracker-tolerance Provider
 * wrapper and return the list of structural violations. Pure function — no
 * side effects, no writes.
 *
 * Vacuous when the shared adapter src directory is absent (non-toolkit
 * projects). When present, asserts (a) `tracker_tolerance.ts` exists and
 * (b) the file exports a `withTolerance` symbol (function or const).
 *
 * Call site: `/gate-check` conformance probes
 * (`tracker_tolerance_wrapper_present`) + the integration test at
 * `tests/gate-check-tracker-tolerance-wrapper-present.test.ts`.
 */
export async function runTrackerToleranceWrapperPresentProbe(
  projectRoot: string,
): Promise<TrackerToleranceWrapperPresentReport> {
  const violations: TrackerToleranceWrapperPresentViolation[] = [];

  const sharedSrcDir = join(projectRoot, SHARED_SRC_RELPATH);
  if (!existsSync(sharedSrcDir)) {
    return {
      violations,
      skippedReason: "adapters dir absent",
    };
  }

  const wrapperPath = join(sharedSrcDir, WRAPPER_BASENAME);
  const wrapperRel = relative(projectRoot, wrapperPath);

  if (!existsSync(wrapperPath)) {
    const reason = `${WRAPPER_RELPATH} is missing — the tracker-tolerance Provider wrapper has been removed or renamed.`;
    violations.push({
      file: wrapperPath,
      line: 1,
      severity: "error",
      reason,
      note: `${wrapperRel}:1 — ${reason}`,
      message: buildMessage(
        reason,
        "restore `adapters/_shared/src/tracker_tolerance.ts` exporting `withTolerance(provider, specsDir, deps?)` per STE-304 AC-STE-304.1.",
        `mode=tracker-tolerance, stage=existence, path=${wrapperPath}`,
      ),
    });
    return { violations };
  }

  let raw: string;
  try {
    raw = readFileSync(wrapperPath, "utf8");
  } catch (err) {
    const reason = `cannot read ${WRAPPER_RELPATH}: ${err instanceof Error ? err.message : String(err)}`;
    violations.push({
      file: wrapperPath,
      line: 1,
      severity: "error",
      reason,
      note: `${wrapperRel}:1 — ${reason}`,
      message: buildMessage(
        reason,
        "fix filesystem permissions on plugins/dev-process-toolkit/adapters/_shared/src/tracker_tolerance.ts and re-run /gate-check.",
        `mode=tracker-tolerance, stage=read, path=${wrapperPath}`,
      ),
    });
    return { violations };
  }

  if (!EXPORT_NEEDLE.test(raw)) {
    const reason = `${WRAPPER_RELPATH} does not export \`withTolerance\` — FR4's relaxed status-mapping probes would silently lose tolerance.`;
    violations.push({
      file: wrapperPath,
      line: 1,
      severity: "error",
      reason,
      note: `${wrapperRel}:1 — ${reason}`,
      message: buildMessage(
        reason,
        "restore the `export function withTolerance(...)` (or `export const withTolerance = ...`) symbol per STE-304 AC-STE-304.1.",
        `mode=tracker-tolerance, stage=export, path=${wrapperPath}`,
      ),
    });
  }

  return { violations };
}

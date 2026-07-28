// STE-284 AC-STE-284.4 — `tracker_local_reconciliation_drift` probe.
//
// Wraps `reconcileTrackerLocal` (AC-STE-284.2) for the /gate-check side. The
// helper returns three disjoint orphan lists (tracker-orphans, local-orphans,
// milestone-mismatches); this probe maps them to violation rows with a
// severity tier and adds a local-side scan for the hard FR-id collision shape
// the helper cannot see by construction (two local files both bind the same
// tracker ID — both files have a binding, so neither is an orphan).
//
// Severity tiers:
//   - info  — no drift (all three orphan lists empty + no local collisions)
//   - warning — any drift that is recoverable by re-syncing or renaming:
//       tracker-orphan (tracker has FR id with no local file), unbound local
//       FR (no `tracker:` block), milestone-mismatch.
//   - error — hard FR-id collisions:
//       (a) same tracker ID bound by two or more local files, OR
//       (b) local FR's `tracker:` value points at an FR id absent from the
//           tracker's active set.
//
// The probe is mode-aware via the underlying helper: `LocalProvider`
// (`mode: 'none'`) returns three empty lists, so the probe surfaces severity
// info with zero violations on every local-only project.
//
// Scaffolding carve-out: a LOCAL-side milestone mismatch whose plan declares
// `kind: scaffolding` is dropped here rather than in the shared helper. The
// helper's report stays faithful (its other consumer is /spec-write's preamble
// reconcile, which wants the full picture); only the gate-check render
// suppresses the row, because the bootstrap plan has no tracker milestone by
// design and every freshly bootstrapped project would otherwise open life with
// a meaningless warning. The filter keys on the structural `side`
// discriminator, never on the `details` prose.

import { join } from "node:path";
import { evaluatePlanOnlyEligibility } from "./plan_only_archival";
import type { Provider } from "./provider";
import {
  readLocalFRBindings,
  reconcileTrackerLocal,
} from "./reconcile_tracker_local";

export type DriftSeverity = "info" | "warning" | "error";

export interface DriftViolation {
  kind: "tracker-orphan" | "local-orphan" | "milestone-mismatch" | "duplicate-local-binding";
  severity: "warning" | "error";
  note: string;
}

export interface TrackerLocalReconciliationDriftResult {
  severity: DriftSeverity;
  violations: DriftViolation[];
}

export interface RunProbeDeps {
  provider: Provider;
}

// Splits the two local-orphan sub-kinds apart: "no `tracker:` block at all"
// (warning) vs "binds to IDs the tracker does not carry" (error). This one IS
// still a `details` prose match, and deliberately so — BOTH sub-kinds are
// `side: "local"`, so the structural discriminator cannot separate them and
// widening the `side` filter to cover this branch would silently collapse the
// error tier into the warning tier. Separating them structurally needs a new
// field on `ReconcileItem`, which no AC covers; until then the byte-stability
// of the two `details` templates is pinned by
// `tests/m117-ste-430-retry-and-gate-noise.test.ts` and by
// `adapters/_shared/src/__tests__/reconcile_tracker_local.test.ts`.
const LOCAL_ORPHAN_DANGLING_RE = /binds to tracker IDs/;

/**
 * /gate-check probe wrapper for `reconcileTrackerLocal`. Returns a severity
 * tier and a flat violation list ready for the gate-check reporter.
 *
 * Severity escalates to `error` only when a hard FR-id collision is detected
 * (local-orphan-dangling OR duplicate local binding). All other drift forms
 * (tracker-orphan, milestone-mismatch, unbound local FR) surface as
 * `warning`. A clean reconcile reports `info` with zero violations.
 *
 * Pure read-side: never writes, never throws on missing directories
 * (a brand-new specs/ tree reconciles as fully empty).
 */
export async function runTrackerLocalReconciliationDriftProbe(
  projectRoot: string,
  deps: RunProbeDeps,
): Promise<TrackerLocalReconciliationDriftResult> {
  const specsDir = join(projectRoot, "specs");
  const report = await reconcileTrackerLocal(deps.provider, specsDir);

  const violations: DriftViolation[] = [];
  let hasError = false;

  for (const item of report.trackerOrphans) {
    violations.push({
      kind: "tracker-orphan",
      severity: "warning",
      note: item.details,
    });
  }

  for (const item of report.localOrphans) {
    const isDangling = LOCAL_ORPHAN_DANGLING_RE.test(item.details);
    if (isDangling) {
      hasError = true;
      violations.push({ kind: "local-orphan", severity: "error", note: item.details });
    } else {
      violations.push({ kind: "local-orphan", severity: "warning", note: item.details });
    }
  }

  for (const item of report.milestoneMismatches) {
    if (item.side === "local" && (await isScaffoldingPlan(specsDir, item.id))) continue;
    violations.push({
      kind: "milestone-mismatch",
      severity: "warning",
      note: item.details,
    });
  }

  // Detect duplicate local bindings — same tracker ID bound by two or more
  // local files. The reconcile helper cannot see this by construction (both
  // files have a binding, so neither is a local-orphan).
  const dupes = findDuplicateLocalBindings(specsDir);
  for (const dup of dupes) {
    hasError = true;
    violations.push({
      kind: "duplicate-local-binding",
      severity: "error",
      note: `Tracker ID ${dup.id} is bound by ${dup.files.length} local files: ${dup.files.join(", ")}.`,
    });
  }

  let severity: DriftSeverity;
  if (hasError) severity = "error";
  else if (violations.length > 0) severity = "warning";
  else severity = "info";

  return { severity, violations };
}

/**
 * True when `<specsDir>/plan/<milestone>.md` declares the scaffolding kind in
 * its frontmatter — the bootstrap plan `/setup` writes, which has no tracker
 * milestone BY DESIGN and must not be reported as local-side milestone drift.
 *
 * Routed through `evaluatePlanOnlyEligibility`, which already owns this exact
 * frontmatter read and whose `parseFrontmatter(..., { lenient: true })` call
 * normalizes BOM + CRLF before matching. A hand-rolled `kind:` line scanner
 * here would re-create the CRLF/BOM blindness that was swept out of this
 * repo's frontmatter readers once already, and it would fail OPEN — an
 * unparsed scaffolding plan would resume emitting the spurious warning.
 *
 * Deliberately narrow: only `reason === "scaffolding"` suppresses. The
 * sibling `"all-checked"` eligibility reason is about archival readiness, not
 * about whether a tracker milestone is expected to exist, so a fully-checked
 * feature plan still reports drift.
 */
async function isScaffoldingPlan(specsDir: string, milestone: string): Promise<boolean> {
  const verdict = await evaluatePlanOnlyEligibility(specsDir, milestone);
  return verdict.planExists && verdict.reason === "scaffolding";
}

interface DuplicateBinding {
  id: string;
  files: string[];
}

/**
 * Group `readLocalFRBindings(specsDir)` by tracker ID and surface every ID
 * bound by ≥ 2 distinct local files. Pure grouping over the shared FS-walk
 * helper — no FS / frontmatter parsing here (canonical SoT is
 * `reconcile_tracker_local.ts`).
 */
function findDuplicateLocalBindings(specsDir: string): DuplicateBinding[] {
  const byId = new Map<string, string[]>();
  for (const fr of readLocalFRBindings(specsDir)) {
    for (const trackerId of fr.trackerIds) {
      const list = byId.get(trackerId) ?? [];
      list.push(fr.filename);
      byId.set(trackerId, list);
    }
  }
  const out: DuplicateBinding[] = [];
  for (const [id, files] of byId.entries()) {
    if (files.length > 1) out.push({ id, files: files.sort() });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// migrate_skip_baseline — the command-line front door of the skip ratchet's
// MIGRATION.
//
// It exists because `renderSkipVerdict` hands a reader a command when the store
// standing for their trunk is at a version this build cannot read
// (AC-STE-527.9). A refusal that names a command nothing can run is the defect
// class M136 exists to stop shipping, so the command names this file.
//
// One rule holds here, and it is the reason the remedy is a migration rather
// than a re-capture: WHAT IS DROPPED IS NAMED. `captureSkipBaseline` would also
// clear an unreadable envelope, but silently — the numbers it displaces are
// never printed, and a store written by a stricter build would vanish into a
// fresh baseline that looks measured. This entry point prints every key it
// drops, so the operator sees the cost before the next capture takes it.

import { resolve } from "node:path";

import { migrateSkipBaselineStore, SKIP_BASELINE_STORE_VERSION } from "./skip_baseline";

// Read-only-to-the-operator CLI, mirroring `capture_skip_baseline.ts`: imported
// by tests and by consumers wanting `migrateSkipBaselineStore`,
// `import.meta.main` is false and this block never runs, so the module is
// side-effect-free at import. Usage:
//
//   bun run migrate_skip_baseline.ts [projectRoot]
//
// `projectRoot` defaults to `process.cwd()`.
if (import.meta.main) {
  const projectRoot = resolve(process.argv[2] ?? process.cwd());
  try {
    const { dropped } = migrateSkipBaselineStore(projectRoot);
    const at = `store at v${SKIP_BASELINE_STORE_VERSION}`;
    console.log(
      dropped.length === 0
        ? `skip baseline: nothing to migrate — ${at}`
        : `skip baseline: ${at}, ${dropped.length} unreadable record(s) dropped: ` +
            `${dropped.join(", ")} — re-capture at the branch point to measure again`,
    );
  } catch (error) {
    console.error(`migrate_skip_baseline: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

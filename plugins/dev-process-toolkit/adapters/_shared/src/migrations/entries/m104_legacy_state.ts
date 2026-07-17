// M108 STE-391 — seed entry: M104 legacy state (AC-STE-391.3).
//
// Detects the pre-M104 root-level state folders (tracked locks, git-ignored
// ledger) and the stale ledger line in the consumer's ROOT `.gitignore` —
// all superseded by the consolidated `.dpt/` tree in v2.46.0. Retired
// literals come exclusively from `../legacy_paths` (AC-STE-391.1).
//
// DELETE-EVERYTHING SEMANTICS (operator decision): neither the locks nor the
// ledger are carried forward into `.dpt/`. Locks are a coordination signal
// whose pre-M104 contents are stale by construction, and the ledger is
// regenerable append-only telemetry — so the migration removes both rather
// than shouldering a data-migration path nobody asked for.

import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { writeDptGitignore } from "../../setup/dpt_gitignore";
import { readLines, removeTracked, rewriteLinesIfChanged } from "../consumer_files";
import type { DetectResult, MigrationEntry } from "../index";
import { LEGACY_ROOT_GITIGNORE_LINE, legacyLedgerDir, legacyLocksDir } from "../legacy_paths";

/** The consumer's root ignore file — the one carrying the stale ledger line. */
function rootGitignore(projectRoot: string): string {
  return join(projectRoot, ".gitignore");
}

/**
 * Shared by the entry's `detect` and its `apply` guard, so "did this fire?" and
 * "is there anything left to do?" can never answer differently. Module-level
 * rather than a method, so `apply` never depends on a `this` binding.
 */
function detectLegacyState(projectRoot: string): DetectResult {
  const evidence: string[] = [];

  const locks = legacyLocksDir(projectRoot);
  if (existsSync(locks)) {
    evidence.push(`legacy locks dir ${relative(projectRoot, locks)}/ present (superseded in v2.46.0)`);
  }

  const ledger = legacyLedgerDir(projectRoot);
  if (existsSync(ledger)) {
    evidence.push(`legacy ledger dir ${relative(projectRoot, ledger)}/ present (superseded in v2.46.0)`);
  }

  const lines = readLines(rootGitignore(projectRoot));
  if (lines !== null && lines.some((line) => line.trim() === LEGACY_ROOT_GITIGNORE_LINE)) {
    evidence.push(
      `root .gitignore carries the stale "${LEGACY_ROOT_GITIGNORE_LINE}" ledger line (superseded in v2.46.0)`,
    );
  }

  return { applies: evidence.length > 0, evidence };
}

export const m104LegacyState: MigrationEntry = {
  id: "m104-legacy-state",
  introduced_in: "2.46.0",
  title: "Collapse pre-M104 root state folders and stale root-.gitignore line into the .dpt tree",
  kind: "script",
  detect: detectLegacyState,
  apply(projectRoot) {
    // Re-apply is a no-op by construction: with nothing left to detect there is
    // nothing to heal, so we never touch the tree (not even to re-assert
    // `.dpt/`, which would create it in a project this entry does not govern).
    if (!detectLegacyState(projectRoot).applies) {
      return { changed: [], summary: "No pre-M104 legacy state found — nothing to do." };
    }

    const changed: string[] = [];

    // Locks were TRACKED pre-M104, so removal has to reach the index too.
    const locks = removeTracked(projectRoot, legacyLocksDir(projectRoot), { recursive: true });
    if (locks !== null) changed.push(locks);

    // The ledger was git-ignored, so it has no index entry to clear.
    const ledger = legacyLedgerDir(projectRoot);
    if (existsSync(ledger)) {
      rmSync(ledger, { recursive: true, force: true });
      changed.push(relative(projectRoot, ledger));
    }

    // Strip ONLY the stale line: every other rule in the file is the operator's
    // and survives byte-for-byte, original line endings included.
    const gitignore = rootGitignore(projectRoot);
    const stripped = rewriteLinesIfChanged(gitignore, (lines) =>
      lines.filter((line) => line.trim() !== LEGACY_ROOT_GITIGNORE_LINE),
    );
    if (stripped) changed.push(relative(projectRoot, gitignore));

    // Ignore ownership now lives in the committed nested file the toolkit owns.
    const dptIgnore = writeDptGitignore(projectRoot);
    if (dptIgnore.outcome === "written") {
      changed.push(relative(projectRoot, dptIgnore.path));
    }

    return {
      changed,
      summary: `Removed pre-M104 root state and ensured the .dpt tree (${changed.join(", ")}). Locks and ledger data are deleted, not migrated.`,
    };
  },
};

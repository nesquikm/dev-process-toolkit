// STE-383 AC-STE-383.1 — the toolkit-owned nested ignore file: compose it,
// write it, and no-op when the baseline already matches.
//
// This is a file the TOOLKIT owns, not one the operator authors. That is what
// collapses /setup's duty to "write one file we own" — impossible to partially
// apply, and safe to re-run. It also removes the operator-question seam the
// tracker-config write needs: there is no prompt branch here, because there is
// no authored content to diff against.
//
// THE BODY IS DELIBERATELY RELATIVE. A nested ignore file's patterns resolve
// against its OWN directory, so `ledger/` + `scratch/` are position-independent:
// the same bytes work whether the project is the repo root or a package nested
// three levels down. Rooting them (`/...`) would pin the file to the repo root;
// prefixing them with the toolkit-root name would re-create the blanket
// exclusion trap one level down — git never descends into an excluded
// directory, so it would silently unversion the tracked lock namespace.
//
// THE POLARITY IS TRACKED-BY-DEFAULT. No `!` re-inclusion rule appears here,
// by design. A forgotten rule under this polarity leaks scratch into a commit:
// loud, visible, harmless. A forgotten rule under ignore-and-negate unversions
// a lock: silent, invisible, correctness-breaking.
//
// Path composition is delegated to `dpt_paths` — the single source of the
// toolkit-root literal (AC-STE-382.1). This module composes none of its own.
// `dpt_paths` is pure path composition by design, so the I/O lives here.
//
// Idempotence follows the tracker-config write's precedent: byte-compare the
// baseline against the proposal, and short-circuit on a match with no write.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dptRoot } from "../dpt_paths";

/**
 * The canonical body: the two subtrees that are machine-generated and
 * disposable. Locks are absent on purpose — they are a coordination signal and
 * must stay tracked.
 */
export const DPT_GITIGNORE_BODY = "ledger/\nscratch/\n";

export type DptGitignoreOutcome = "written" | "unchanged";

export interface WriteDptGitignoreResult {
  /** `written` on first run or a drifted baseline; `unchanged` on a match. */
  outcome: DptGitignoreOutcome;
  /** Absolute path of the file the call governs, written or not. */
  path: string;
}

/** The nested ignore file inside the toolkit-owned root. */
export function dptGitignorePath(projectRoot: string): string {
  return join(dptRoot(projectRoot), ".gitignore");
}

/**
 * Write the canonical ignore file, creating the toolkit-owned root when
 * absent. Idempotent by byte-compare: a baseline identical to the canonical
 * body means no write at all (not "wrote the same bytes again"), so re-running
 * leaves the file's mtime untouched.
 *
 * A drifted baseline is RESTORED rather than preserved — this file is ours, and
 * a hand-edit that drops a rule re-opens the leak the file exists to close.
 */
export function writeDptGitignore(projectRoot: string): WriteDptGitignoreResult {
  const path = dptGitignorePath(projectRoot);

  if (existsSync(path)) {
    try {
      if (readFileSync(path, "utf-8") === DPT_GITIGNORE_BODY) {
        return { outcome: "unchanged", path };
      }
    } catch {
      // Unreadable baseline is treated as drift: fall through and restore the
      // canonical body rather than leaving the leak open.
    }
  }

  mkdirSync(dptRoot(projectRoot), { recursive: true });
  writeFileSync(path, DPT_GITIGNORE_BODY);
  return { outcome: "written", path };
}

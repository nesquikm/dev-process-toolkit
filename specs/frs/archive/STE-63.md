---
title: One-time PR garbage sweep (orphans → patterns → per-file judgment)
milestone: M19
status: archived
archived_at: 2026-04-23T14:49:58Z
tracker:
  linear: STE-63
created_at: 2026-04-23T12:22:52Z
---

## Requirement

The branch `feat/m12-tracker-integration` has accumulated M12 through M18 work across many files (adapters, skills, docs, fixtures, templates). Some of that is load-bearing; some is accumulated exploration, debugging aids, duplicated snapshots, or obsolete scaffolding. Before M19's branch-automation feature lands in PR-2, run a one-time three-pass audit over `git diff main...HEAD` and delete files that don't earn their keep.

Scope bound: `git diff main...HEAD` only — not the entire repo. Bounded to what this PR would otherwise ship.

This is **explicitly not a reusable skill** — the brainstorm rejected recurring sweep tooling. One-time cleanup, single commit, report lives in the PR description.

## Acceptance Criteria

- AC-STE-63.1: Pass 1 (orphans) enumerates every file in `git diff main...HEAD` (added or modified) and classifies each as "referenced" or "orphan." Referenced = at least one of: (a) imported/required by source code, (b) linked from a doc/skill/README, (c) named by a skill or command, (d) named in `plugin.json`/`marketplace.json`/`package.json`, (e) matched by a test fixture path pattern. Orphans become candidates for deletion.
- AC-STE-63.2: Pass 2 (pattern cruft) scans the same file set for known-cruft filename patterns: `tmp-*`, `tmp_*`, `debug-*`, `*_old*`, `*.bak`, `scratch-*`, duplicate snapshot files (`*.snapshot` with identical content to another snapshot), and backup copies (`*.orig`). Pattern-matched files become candidates for deletion regardless of reference status.
- AC-STE-63.3: Pass 3 (per-file judgment) walks every file that survived passes 1-2 and emits a short summary (path + one-line role) followed by `[Y] keep / [d] delete / [s] skip`. User decision is final. `s` defers the decision (file stays, flagged as "unresolved" in report).
- AC-STE-63.4: The final commit deletes only files the user explicitly approved for deletion (passes 1+2 flagged candidates that user confirmed, plus pass-3 `d` decisions). Files flagged by passes 1-2 that user did not confirm are retained.
- AC-STE-63.5: Commit is single and atomic, message: `chore(m19): garbage sweep — <N> files deleted (STE-63)`. No partial commits across the three passes.
- AC-STE-63.6: Sweep report (not checked in) is produced in the `/implement` session's output with: (a) per-pass count of flagged files, (b) per-file decision, (c) rationale summary. User pastes the report into PR-1's description at PR-open time.
- AC-STE-63.7: After the commit lands, `/gate-check` passes on the current branch. No test breakage from deletions. If any test fails, the failing deletion is reverted (single follow-up commit) and its entry in the report is reclassified as "reverted post-gate-check."
- AC-STE-63.8: The sweep never touches files outside `git diff main...HEAD`: no deletions under directories unchanged relative to `main`. Sweep also never touches files in exemption list: `CHANGELOG.md`, `LICENSE`, `.gitignore`, `plugin.json`, `marketplace.json`, top-level `README.md`, and any file under `specs/frs/archive/` or `specs/plan/archive/`.

## Technical Design

Procedural, not a persisted skill. `/implement STE-63` walks the three passes inline: Pass 1 uses `grep` / `rg` to check incoming references; Pass 2 is glob patterns against the diff file list; Pass 3 is interactive.

No new code ships in this FR — no new adapter modules, no new skill files, no new tests. The only repo change is the deletion commit itself. The "implementation" is the act of running the audit and making the deletions.

Report format is LLM-generated from the pass decisions. No report template file is checked in.

## Testing

The gate is `/gate-check` + the existing test suite passing on the swept branch. No new unit tests. If the sweep deletes something that breaks a test, the test failure *is* the regression signal — the failing deletion reverts.

Ripgrep gate as a sanity check: `rg -l <deleted-file-basename> plugins/` should return zero matches for every deleted file (confirms no straggling references).

## Notes

**Dogfooding moment.** STE-63 ships before STE-64 (Approach 2 from brainstorm) on `feat/m12-tracker-integration` — the feature (branch-automation prompt) doesn't exist yet, so no convention is enforced for this FR's own branch. STE-64 will be the first to dogfood the new convention on a fresh `feat/m19-branch-automation` branch.

**Sweep surface.** Expect candidates in `plugins/dev-process-toolkit/docs/` (some docs accumulated during exploration may no longer be referenced), `plugins/dev-process-toolkit/tests/fixtures/` (duplicate snapshots from M13–M17 work), and `adapters/` (any scaffolding left from M12). Actual numbers surface during pass 1.

**Exemption rationale.** CHANGELOG/LICENSE/.gitignore/plugin.json/marketplace.json/README are always referenced by external consumers. `specs/frs/archive/` and `specs/plan/archive/` are the authoritative history — even "orphaned" archived FRs should never be touched by the sweep (their orphan-ness is by design; they're not supposed to be linked from live code).

---
title: Root spec-file hygiene — cleanup + gate
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-59
created_at: 2026-04-23T06:40:57.000Z
---

## Requirement

Two parts, one coordinated PR.

**Part 1 — Baseline cleanup.** Apply `/tmp/dpt-drift-2026-04-23.md`'s `Suggested action` column to the three root spec files so they stop leaking archived-milestone IDs and no longer carry stale release metadata. After the rewrite, `requirements.md` + `technical-spec.md` reflect current project state (M17 in-flight while implementing; no orphan M12/M13/M14 framing; release version matches `plugin.json`).

**Part 2 — Gate.** Install a `/gate-check` assertion that prevents regression on two axes: archived-milestone IDs in live-framing positions, and version/status drift between root specs and `plugin.json`.

Together these make the "root specs stay shape-only, current-only" invariant enforceable instead of aspirational. The drift report is evidence the invariant silently rots without a gate.

## Acceptance Criteria

- AC-STE-59.1: `specs/requirements.md` §1 Overview cleaned per drift report medium-severity entries:
  - "Latest shipped release: v1.17.0" → current version at FR-D implementation time
  - "In-flight milestone: M15" → "M17" (or removed if M17 has already shipped when FR-D lands)
  - "§1 M15 context (in-flight)" subsection (lines 22–29) removed or folded into `## Shipped milestones` summary
- AC-STE-59.2: `specs/requirements.md` §4 Edge Cases cleaned per drift-report high-severity entries:
  - Orphan `**M13 edge cases:**` header (L214) and `**M14 edge cases:**` header (L228) relabeled topic-scoped ("Parallel-safe layout edge cases", "Tracker-native entry edge cases")
  - Inline "post-M14" / "pre-M14" / "M12 + M13 regression fixtures" references at L172–174, L233, L235 rewritten version-framed (e.g., "post-v1.15") or deleted
- AC-STE-59.3: `specs/requirements.md` §5 Out-of-Scope cleaned per drift-report high-severity entries:
  - Orphan `**M12-specific out-of-scope:**` (L254), `**M13-specific out-of-scope:**` (L270), `**M14-specific out-of-scope:**` (L284) headers relabeled topic-scoped
  - Inline M12/M13/M14 references in bullets at L273, L287, L291, L294 rewritten
- AC-STE-59.4: `specs/technical-spec.md` Schema Q (L278), Schema T (L317, L319), Schema U (L334) code-block placeholders: `milestone: M13` / `kickoff_branch: plan/M13-kickoff` changed to generic `milestone: M<N>` / `plan/M<N>-kickoff` (drift-report advisory entries).
- AC-STE-59.5: `skills/gate-check/SKILL.md` gains a "Root spec hygiene" check with two sub-checks:
  - **(a) Milestone-ID leakage** — scan `specs/requirements.md`, `specs/technical-spec.md`, `specs/testing-spec.md` for `\bM\d+\b` patterns. For each match, walk up to the containing heading; skip if under `## Shipped milestones` / `## Archived context` / similar allowlist. For remaining matches, check `specs/plan/archive/M<N>.md` existence; report `<file>:<line>: archived milestone <id> in live-framing` for each hit. Fail gate if any leakage.
  - **(b) Version/status freshness** — read `plugin.json` → `version`; parse `requirements.md` §1 for `Latest shipped release: vX.Y.Z` and `In-flight milestone: M<N>` lines. Assert declared version matches `plugin.json` version. If in-flight milestone is named, assert `specs/plan/M<N>.md` exists (not archive). Report drift with specific line + expected/observed values. Fail gate.
- AC-STE-59.6: `tests/gate-check-root-hygiene.test.ts` covers both sub-checks with positive (clean spec fixtures) and negative (drift-laden fixtures) cases.
- AC-STE-59.7: `docs/patterns.md` gains a "Root Spec Hygiene" section (~10 lines) documenting the invariant and the gate mechanism.
- AC-STE-59.8: After Part 1 rewrites + Part 2 gate install, running `/gate-check` on this repo reports clean root-spec hygiene with no errors. Self-consistency check — the gate passes on the baseline it was designed against.

## Technical Design

**Part 1 is mechanical.** Apply drift-report `Suggested action` entries one-by-one. Ordering within Part 1 doesn't matter; all edits are textual rewrites.

**Part 2 adds two gate sub-checks.**

*Milestone-ID leakage detector:*
1. Ripgrep for `\bM\d+\b` in the three root spec files
2. For each match, walk up to the containing `##`/`###` heading; skip if the heading matches the allowlist regex (Shipped milestones | Archived context | similar)
3. For remaining matches, check if `specs/plan/archive/M<N>.md` exists (= archived milestone); report leakage
4. Exit non-zero if any leakage

*Version freshness detector:*
1. Read `plugin.json`; extract `version`
2. Grep `requirements.md` §1 for `Latest shipped release: v\d+\.\d+\.\d+`
3. Optionally grep for `In-flight milestone: M\d+` line
4. Assert declared version matches `plugin.json`; assert in-flight milestone (if present) resolves to `specs/plan/M<N>.md`
5. Exit non-zero on drift

Both sub-checks output structured lines (`<file>:<line>: <reason>`) so humans can act directly.

Grep-based detection is intentional — AST-based markdown parsing is overkill for the pattern space, and grep produces stable line numbers. Decision captured from brainstorm deferred decision #4.

## Testing

Two layers:
- Unit tests with fixture spec files (one valid, one drift-laden per category) assert each detector's pass/fail behavior.
- Integration: run `/gate-check` on this repo post-Part-1 rewrite; assert clean output (AC-STE-59.8).

## Notes

**Ordering constraint inside this FR's PR:** Part 1 edits MUST land in the same diff as Part 2's gate install. Committing the gate without Part 1 fixes means the gate fails on its first run — the FR ships broken.

**Ordering relative to other M17 FRs:** FR-D runs LAST in M17. FR-C1..C4 touch docs and mentions that `requirements.md`'s §1 Overview may reference (migrator, INDEX.md, Sync log — all being deleted). Running FR-D after FR-C1..C4 means Part 1's cleanup reflects the post-deletion repo state; running FR-D first would require re-editing `requirements.md` when FR-C1..C4 land. Avoid the double-edit.

**Brainstorm deferred decisions addressed:**
- FR-D enforcement shape: grep-based convention detection (Technical Design above). Not AST-based.
- FR-39 audit-loss ADR is owned by FR-C4 (AC-STE-58.9), not this FR.

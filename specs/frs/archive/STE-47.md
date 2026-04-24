---
title: /implement Phase 4 Calls releaseLock on FR-Scope Runs (Not Only During Milestone Archival)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-47
created_at: 2026-04-22T11:54:19.000Z
---

## Requirement

`skills/implement/SKILL.md` Phase 4 calls `Provider.releaseLock(id)` only inside the "v2 procedure" milestone-archival subsection (AC-46.4). For an FR-scope run — e.g., implementing 2 of 11 FRs in an in-flight milestone — no archival fires, so the ticket stays at `In Progress` after commit lands. Dogfooded 2026-04-22 during `/implement FR-57 FR-58`: both FRs landed in separate commits, but STE-36 and STE-37 remained `In Progress` until the user flagged it ("Why in progress? We just done with them, right?"). The tracker state has to mirror the git state; a ticket stuck at `In Progress` after its commit lands is a lying tracker.

## Acceptance Criteria

- AC-68.1: `skills/implement/SKILL.md` Phase 4 step 15 explicitly instructs calling `Provider.releaseLock(id)` for each ticket touched during the run, immediately after the commit has landed (user approved + `git commit` succeeded), regardless of whether milestone archival runs.
- AC-68.2: `docs/implement-tracker-mode.md` Phase 4 subsection mirrors the post-commit releaseLock instruction with explicit "Done transition" wording and cross-references the SKILL.md step.
- AC-68.3: On an aborted run (gate failure, Spec Breakout, user rejection at step 15, or any Phase 1–3 exit), releaseLock is NOT called — the in-flight lock stays on the branch for resume via the `already-ours` path (AC-46.1). The SKILL.md instruction is explicit about this boundary: release only after successful commit-land.
- AC-68.4: In `mode: none`, post-commit `releaseLock` is a no-op on the skill's behavior — `LocalProvider.releaseLock` cleans up `.dpt-locks/<id>` regardless, and `TrackerProvider.releaseLock` routes through the active adapter's `transition_status(done)`. Pattern 9 regression gate (byte-diff against `mode-none-v2-migration` fixture) must not regress.
- AC-68.5: A doc-conformance test under `tests/` asserts `skills/implement/SKILL.md` Phase 4 step 15 carries a `releaseLock` marker co-located with the commit-approval instruction, NOT only inside the Milestone Archival subsection.
- AC-68.6: On a multi-FR run where archival does NOT fire (FR subset of an in-flight milestone), releaseLock is called once per touched FR. On a full-milestone run where archival DOES fire, releaseLock is called exactly once per FR — the archival path consumes the releaseLock responsibility; SKILL.md is explicit about avoiding double-calls.

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/implement FR-57 FR-58` post-mortem. Finding #2 of 3 (2026-04-22 post-FR-57/58 dogfooding). User-observed gap: "Why in progress? We just done with them, right?"

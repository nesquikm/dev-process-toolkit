---
title: Rewrite /setup --migrate as mode-switching (D6)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-98
created_at: 2026-04-25T06:42:16Z
---

## Requirement

`/setup --migrate` toggles a project between `mode: none ↔ tracker` modes. The code is legitimate and stays — the toggle is a real operator workflow even with no users today. But the docs frame the flow as "migration" with elaborate atomicity guarantees, rollback prompts, and "existing project" reassurance. The framing exists to protect future-self from undefined behavior on a live project — but with no live projects, the framing is overhead.

Rewrite the docs to treat the operation as "mode switching," not "migration." Drop atomicity ceremony; if a switch fails, the user reruns. Keep the code intact (idempotent, atomicity-by-construction is fine — just don't advertise it).

## Acceptance Criteria

- AC-STE-98.1: `skills/setup/SKILL.md` references to `--migrate` reframed as `--switch` (or comparable mode-switching language). The CLI flag name itself can stay `--migrate` for backwards-compat with any maintainer muscle memory; only the surrounding prose changes. {#AC-STE-98.1}
- AC-STE-98.2: `docs/setup-tracker-mode.md` "migration" language replaced with "mode switching" / "switching modes" / "toggle" throughout. The doc no longer references "rollback prompts" or "atomicity guarantees" as user-facing features. {#AC-STE-98.2}
- AC-STE-98.3: Any rollback-prompt elaborate-error code paths in `/setup`'s migrate handler are simplified to a one-line refusal: "Mode switch failed. Rerun with cleaned state." (or canonical NFR-10 shape). {#AC-STE-98.3}
- AC-STE-98.4: The actual atomicity-by-construction (no half-state on success) is preserved — only the user-facing ceremony is removed. {#AC-STE-98.4}
- AC-STE-98.5: `bun test` green. `tests/setup-migrate*.test.ts` (or similar) updated to assert the simplified prose if it currently locks the elaborate error shape. {#AC-STE-98.5}

## Technical Design

Four locations to touch:
1. `skills/setup/SKILL.md` step describing `--migrate` invocation.
2. `docs/setup-tracker-mode.md` section on mode switching (currently framed as migration).
3. `/setup` runtime — simplify any rollback-prompt branches.
4. Tests — update prose-locking assertions if needed.

The CLI flag name is intentionally NOT changed (`--migrate` stays). Renaming the flag would create needless churn; only the prose changes.

## Testing

No new tests. Existing tests may need adjustment if they lock prose strings. Run `bun test` and react to failures.

## Notes

This is one of two FRs that intentionally keep code while changing prose (the other is STE-93 D1 partial — it deletes prose AND code). The distinction matters because deletion-of-code is reviewer-checkable (`git diff --stat`), whereas keep-code-rewrite-prose requires careful diff reading.

Origin: PR #4 audit D6.

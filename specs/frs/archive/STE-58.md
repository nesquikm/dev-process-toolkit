---
title: Delete ### Sync log subsection + sync_log.ts helper
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-58
created_at: 2026-04-23T06:40:53.000Z
---

## Requirement

`CLAUDE.md`'s `### Sync log` subsection is a write-only audit trail. FR-39's bidirectional AC sync (tracker-mode) appends entries; `/setup`'s migration path appended entries; nothing reads them. `git log` captures every sync event as a commit — richer (diff, blame) and authoritative. The sync log duplicates with worse UX.

Delete the subsection, the helper, the resolver-config exclusion logic, and all append call sites.

## Acceptance Criteria

- AC-STE-58.1: `CLAUDE.md`'s `### Sync log` subsection under `## Task Tracking` is removed.
- AC-STE-58.2: `plugins/dev-process-toolkit/adapters/_shared/src/sync_log.ts` and `sync_log.test.ts` are deleted.
- AC-STE-58.3: `plugins/dev-process-toolkit/adapters/_shared/src/resolver_config.ts`: the exclusion logic that skips lines under `### Sync log` when parsing `## Task Tracking` key-value pairs is simplified (parser no longer needs the exclusion since the subsection no longer exists). Corresponding test cases in `resolver_config.test.ts` are updated.
- AC-STE-58.4: `skills/setup/SKILL.md`: the step creating the empty `### Sync log` subsection as part of Schema L output (step 6 per AC-STE-14) is removed. Migration append sites (currently step 38) are removed — likely already gone via FR-C1's migrator deletion; double-check.
- AC-STE-58.5: `skills/spec-write/SKILL.md`: references to appending sync-log entries per FR-39 (AC-STE-17.8) are removed. The tracker-mode diff/resolve flow continues to function; only the audit-trail emission is dropped.
- AC-STE-58.6: `plugins/dev-process-toolkit/templates/CLAUDE.md.template`: `### Sync log` subsection removed so fresh installs don't create it.
- AC-STE-58.7: Docs updated:
  - `docs/fr-39-sync.md` — Sync-log section removed; replaced with one line noting git log is the audit trail
  - `docs/setup-tracker-mode.md` — Sync log subsection (lines 173–177) removed
  - `docs/spec-write-tracker-mode.md` — line 27 (sync-log append instruction) removed
  - `docs/patterns.md` — line 390 (Task-Tracking parser note about excluding Sync log) removed or updated to reflect simplified parser
- AC-STE-58.8: Ripgrep gate: `rg -n 'sync_log|### Sync log|Sync log' plugins/ CLAUDE.md specs/` returns zero matches, excluding `CHANGELOG.md` + archived FR files.
- AC-STE-58.9: ADR captured in `docs/patterns.md` (or `docs/sdd-methodology.md`): a short "Audit trail" section noting `git log` is authoritative and that FR-39's per-AC conflict-resolution trace is not retained post-M17. Captures the brainstorm's explicit tradeoff-acceptance.

## Technical Design

Subtractive, with one simplification: `resolver_config.ts`'s Task-Tracking parser no longer needs to exclude the `### Sync log` subsection (since it won't exist). Parser logic simplifies; no new logic.

## Testing

`sync_log.test.ts` deleted. `resolver_config.test.ts` updated to remove Sync-log fixtures and adjust assertions for the simplified parser. Existing FR-39 bidirectional sync tests continue to pass — the sync mechanism is unchanged; only the audit emission is gone.

## Notes

Intentional tradeoff per brainstorm: FR-39's per-AC conflict-resolution trace is lost. The ADR (AC-STE-58.9) captures the decision so future debugging doesn't mourn the absence. `git log` surfaces every sync commit; for per-AC granularity, `git blame` on the relevant FR file provides equivalent detail.

Independent of other FRs — no ordering dependency beyond "benefits from FR-C1 landing first if it also touches `/setup` migration paths."

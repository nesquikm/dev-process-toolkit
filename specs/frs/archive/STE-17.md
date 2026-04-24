---
title: Bidirectional AC Sync with B-Style Conflict Resolution
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-17
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Detect when tracker ACs diverge from a local FR's AC list (PM added/edited an AC checkbox directly in the tracker), surface a per-AC diff, prompt the user to resolve each conflict, and apply the resolution to both sides before the skill proceeds.

## Acceptance Criteria

- AC-STE-17.1: `/implement` at skill start (after AC-STE-11.2 records `updatedAt`) calls the active adapter's `pull_acs(ticket_id)` and diffs against the local FR's AC list (parsed from `specs/requirements.md`)
- AC-STE-17.2: Diff classifies each AC as: `identical`, `local-only`, `tracker-only`, or `edited-both`
- AC-STE-17.3: If any non-identical AC exists, the skill prompts per-AC with exactly four options: `keep local`, `keep tracker`, `merge` (free-text editor), `cancel`
- AC-STE-17.4: Resolution applied to both sides: local `specs/requirements.md` updated for non-tracker-canonical changes AND adapter's `upsert_ticket_metadata` called for non-local-canonical changes; both sides converge before the skill proceeds past pre-flight
- AC-STE-17.5: Selecting `cancel` on any prompt aborts the skill cleanly with zero state mutation on either side
- AC-STE-17.6: Linear adapter's `pull_acs` returns a normalized AC representation (whitespace + list-marker formatting collapsed to a canonical form) so the diff doesn't trigger on Linear's server-side normalization; same normalization applied on push via `upsert_ticket_metadata` so round-trips converge on first iteration
- AC-STE-17.7: Conflict resolution is strictly per-AC — no `accept all tracker` / `accept all local` bulk shortcuts (sustainability: bulk shortcuts hide drift, which is what bidirectional sync is supposed to surface)
- AC-STE-17.8: Resolution events append to CLAUDE.md's `### Sync log` subsection (under `## Task Tracking`) as a single bullet line: `- <ISO timestamp> — <N> AC conflicts resolved on <ticket-id>` (audit trail). The bullet form matches Schema L; no `last_sync:` key in the log (that would be single-value whereas sync events are append-only)
- AC-STE-17.9: `/spec-write` after editing an FR's AC list in tracker mode runs the same diff/resolve loop before pushing — so a local edit doesn't silently overwrite a tracker-side edit made between the last sync and now
- AC-STE-17.10: Only `/implement` (pre-flight) and `/spec-write` (post-save) run the full STE-17 diff/resolve loop. `/gate-check` detects `updatedAt` mismatch per AC-STE-11.3 but does NOT run resolution — mismatch is a warning with two user options: retry after `/implement` (which will run STE-17), or proceed knowing the session is stale. `/pr` only calls `transition_status` + optional `upsert_ticket_metadata` for the PR link; no AC diff.
- AC-STE-17.11: The `DPT_TEST_FROZEN_TIME` override in `adapters/_shared/src/sync_log.ts` MUST be gated on `NODE_ENV === "test"` (or accepted only via an explicit injected option). In production paths the override has no effect — `formatSyncLogEntry` reads `new Date().toISOString()` directly. A unit test asserts that calling `formatSyncLogEntry` with `DPT_TEST_FROZEN_TIME` set but `NODE_ENV !== "test"` produces a current-time ISO string, not the frozen value

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

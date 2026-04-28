---
title: Live MCP Access, No Persistent Cache, Optimistic Concurrency
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-11
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Skills make live MCP calls; nothing is cached on disk. Concurrency between sessions is handled via `updatedAt` (or ETag) comparison, not via TTLs.

## Acceptance Criteria

- AC-STE-11.1: No persistent cache directory (`.dpt/cache/` or similar) is created or written by any skill
- AC-STE-11.2: `/implement` after `claimLock` succeeds fetches ticket content and records the tracker's `updatedAt` (or ETag equivalent) in-memory for the session (STE-45 AC-STE-45.1 clarification — original "at skill start" phrasing was ambiguous and caused /gate-check to flag claimLock's own write as drift)
- AC-STE-11.3: `/gate-check` at skill start re-fetches the ticket; if `updatedAt` differs from the value recorded at `/implement` start, the skill warns `"Ticket was modified since /implement — review changes before proceeding"` and prompts for confirmation
- AC-STE-11.4: Network failure during any MCP call fails the skill cleanly with an actionable error message in NFR-10 canonical shape; no partial state is written anywhere
- AC-STE-11.5: `/implement` → `/gate-check` → `/pr` chain performs at minimum one fetch per skill, not per operation within the skill

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

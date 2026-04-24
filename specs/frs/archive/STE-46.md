---
title: Document Linear save_issue Parameter Names + Detect Silent No-Ops
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-46
created_at: 2026-04-22T11:54:19.000Z
---

## Requirement

`adapters/linear.md` § Operations currently describes `mcp__linear__create_issue` / `mcp__linear__update_issue` with `stateId` and separate team.states lookups. The real Linear MCP surface is a single `mcp__linear__save_issue` tool with `state` (accepts state type, name, or ID — no team.states lookup needed) and `assignee` (accepts user ID, name, email, or `"me"`). More dangerous: unknown parameter names (e.g., `status`, `assigneeEmail`) are silently ignored — the tool returns a successful-looking response while nothing mutated on Linear. Dogfooded 2026-04-22 during `/implement FR-57 FR-58`: claimLock's first attempt used `status: "In Progress"` + `assigneeEmail: "..."`; the response echoed the pre-call `updatedAt` and `status: "Backlog"` unchanged. The session falsely believed the transition landed. User flagged the no-op post-hoc.

## Acceptance Criteria

- AC-67.1: `adapters/linear.md` § Operations updates every MCP tool reference from `create_issue` / `update_issue` to `save_issue` (the actual tool), and documents `state` (accepts type/name/ID) and `assignee` (accepts ID/name/email/`"me"`) as the canonical parameter names. The table mapping `pull_acs` / `push_ac_toggle` / `transition_status` / `upsert_ticket_metadata` to MCP calls is updated in lockstep.
- AC-67.2: `adapters/linear.md` adds a "Silent no-op trap" subsection stating that `save_issue` ignores unknown parameter names without raising a validation error; any `save_issue` caller MUST verify `updatedAt` / `startedAt` / `completedAt` advanced past the pre-call value before treating the call as successful.
- AC-67.3: `docs/tracker-adapters.md` cross-references the Linear-specific guidance so cross-adapter readers hit the silent-no-op warning before writing a new adapter.
- AC-67.4: A doc-conformance test under `tests/` asserts `adapters/linear.md` carries the markers `save_issue`, `state:`, `assignee:`, and the canonical silent-no-op warning phrase.
- AC-67.5: `TrackerProvider.claimLock` and `TrackerProvider.releaseLock` (in `adapters/_shared/src/tracker_provider.ts`) gain a post-call `updatedAt` guard — after `transitionStatus` / `upsertTicketMetadata`, re-fetch via `getTicketStatus` and assert `updatedAt` advanced past the pre-call value; if not, throw `TrackerWriteNoOpError` (NFR-10 canonical shape) so the skill surfaces loudly instead of silently proceeding. Unit test via a stub driver that simulates the no-op path.

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/implement FR-57 FR-58` post-mortem. Finding #1 of 3 (2026-04-22 post-FR-57/58 dogfooding). Part of the same pattern as FR-56..66 — each dogfooding run closes real doc-code gaps in the tracker-mode surface.

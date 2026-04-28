---
title: /implement Phase-4 task-state transition reliability
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-54
created_at: 2026-04-23T06:40:43.000Z
---

## Requirement

`/implement` Phase 4 inconsistently drops `Provider.releaseLock`, leaving Linear tickets in `In Progress` after ship. The failure isn't deterministic — sometimes Claude calls `releaseLock` and everything finalizes, sometimes it skips straight to the final report after the commit lands and the tickets stay open. The fix combines three mechanisms so the failure can't slip through silently:

1. **Instruction hardening** — restructure Phase 4's close procedure into a single atomic "Close" step that lists, in order, the commit + `releaseLock` + post-release verification.
2. **Mechanism bundling** — the close step can't be half-done: any path out of Phase 4 that doesn't complete all three sub-steps exits non-zero.
3. **Gate backstop** — `/gate-check` independently verifies that every archived FR's bound ticket has reached the canonical `Done` state; drift reports the FR + ticket + observed/expected states.

## Acceptance Criteria

- AC-STE-54.1: `skills/implement/SKILL.md` Phase 4 restructures the close procedure into a single "Close" step that names (in order): (a) final commit, (b) `Provider.releaseLock` for every archived FR, (c) post-release status verification. No exit path through Phase 4 skips (b); if any `releaseLock` throws, Phase 4 fails loudly.
- AC-STE-54.2: After `releaseLock`, the SKILL.md instructs Claude to invoke `Provider.getTicketStatus(ticketId)` for each released FR and assert the returned status matches the adapter's `status_mapping.done` canonical name. A mismatch surfaces with NFR-10-shape refusal naming the ticket and Phase 4 exits non-zero.
- AC-STE-54.3: `skills/gate-check/SKILL.md` gains a "Ticket-state drift" check. For every FR file under `specs/frs/archive/` with `status: archived`, resolve the tracker binding from frontmatter and assert `Provider.getTicketStatus` returns the canonical `Done` state. Report drifted tickets in the gate output with the FR's ULID + tracker ID + observed vs. expected state. Skipped for `mode: none`.
- AC-STE-54.4: `Provider` interface gains `getTicketStatus(ticketId: string): Promise<{ status: string }>` if not already present. `LocalProvider` returns a sentinel `{ status: "local-no-tracker" }`. `LinearProvider` (or whichever class wraps Linear) invokes `mcp__linear__get_issue` and returns the `status` field verbatim. Adapter metadata exposes a `read_status` capability string if missing.
- AC-STE-54.5: Two test files:
  - `tests/implement-phase4-close.test.ts` — prose-assert Phase 4 SKILL.md contains the single-Close structure and names the three ordered mechanisms.
  - `tests/gate-check-ticket-state-drift.test.ts` — prose-assert `gate-check` SKILL.md includes the drift check and names `Provider.getTicketStatus`. Plus a unit test exercising `LinearProvider.getTicketStatus` against a mocked MCP client returning `Done` / `In Progress` / `Backlog`.
- AC-STE-54.6: Manual dogfood: running `/implement STE-<any-M17-FR>` end-to-end ends with the bound Linear ticket in `Done`; running `/gate-check` on a clean repo reports zero ticket-state drift.

## Technical Design

The current Phase 4 instruction distributes `releaseLock` across two SKILL.md paragraphs that describe different concerns (commit mechanics vs. lifecycle finalization). Claude reads the first paragraph, commits, reports, and sometimes stops — especially under fast-mode compression. Fix converges on one atomic procedure:

```
Phase 4 Close (atomic — all three steps required)
  1. git commit (includes FR archive moves)
  2. for each archived FR f:
       Provider.releaseLock(f.id)
       assert Provider.getTicketStatus(f.tracker[<key>]).status == status_mapping.done
  3. Phase 4 report
```

The Linear adapter already exposes `transition_status` (write side). `getTicketStatus` is a thin wrapper over `mcp__linear__get_issue`'s `status` field. No new MCP capability needed.

## Testing

Prose assertions on SKILL.md content (matching the style of the existing `tests/implement-phase4-releaselock.test.ts`). `LinearProvider.getTicketStatus` gets a unit test with a mocked MCP client. Manual dogfood is the end-to-end proof. The gate-check drift detector is the long-term backstop — if future changes reintroduce the skip-releaseLock regression, `/gate-check` will report stale tickets and fail the build.

## Notes

The user-feedback memory "After Phase 4 commit, move tickets to Done via releaseLock" gets formalized as SKILL.md prose + test + gate after this FR — the memory becomes documentation instead of load-bearing behavior prompt.

Dependency: benefits from FR-A (STE-53) landing first so dogfood smoke actually runs. No hard blockers.

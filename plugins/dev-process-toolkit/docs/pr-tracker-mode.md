# `/pr` Tracker Mode Flow

Detailed tracker-mode procedures for `/pr`. Pointed at from
`skills/pr/SKILL.md` to keep the skill lean.

In `mode: none`, this document is unused — the pre-M12 body runs unchanged.

## Pre-flight (before PR creation)

1. Schema L probe → if `mode: none`, exit to `none` path.
2. Ticket-binding pre-flight per `docs/ticket-binding.md` (STE-27). Decline
   exits cleanly with zero side effects.

## Post-create (after `gh pr create` returns)

After the PR URL is known:

1. **Transition status** — call the active adapter's
   `transition_status(ticket_id, "in_review")`. The adapter resolves the
   tracker-side label via `status_mapping`.
2. **Update ticket description with PR link** (optional, best-effort) —
   call `upsert_ticket_metadata(ticket_id, title, <description with PR
   URL appended>)`. This appends a `PR: <url>` line to the existing
   description body; it does NOT rewrite ACs (those have dedicated ops).

Both calls are best-effort: if either fails, surface a canonical-shape
warning and continue. PR creation is the primary side effect; tracker
updates are supplementary.

## Capability degradation (STE-16 AC-STE-16.6)

- **Adapter missing `transition_status`** → skip the status call; print:

  ```
  Adapter <name> does not support transition_status — ticket status unchanged.
  Remedy: transition the ticket to "In Review" manually in the tracker.
  Context: mode=<mode>, ticket=<ID>, skill=pr
  ```

- **Adapter missing `upsert_ticket_metadata`** → skip the PR-link
  update; print an equivalent warning. PR creation still succeeds.

Both warnings are `GATE PASSED WITH NOTES` equivalent — `/pr` doesn't
fail because of missing tracker capabilities.

## MCP call budget (NFR-8)

`/pr` makes at most **2** MCP calls total:

1. `transition_status(ticket, in_review)` — once per invocation.
2. `upsert_ticket_metadata(ticket, ...)` — once, optional (skip if the
   PR URL is already known to be stable in the tracker's UI without
   this update).

Budget respected even if the user runs `/pr` repeatedly on the same
branch — each invocation is independent, no memoization.

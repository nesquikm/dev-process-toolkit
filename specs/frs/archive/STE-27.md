---
title: Ticket Binding and Session-Start Confirmation
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-27
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Every skill that mutates the tracker resolves and confirms the active ticket before any side effect. Branch-name regex is the primary resolver, CLAUDE.md front-matter is the fallback, and an interactive prompt is the final resort. Mismatches between resolvers fail loudly — never silent guess.

## Acceptance Criteria

- AC-STE-27.1: Every mutating skill (`/implement`, `/gate-check`, `/pr`, `/spec-write` in tracker mode) prints `"Operating on ticket <ID>: <title> — proceed? [y/N]"` at skill start
- AC-STE-27.2: Ticket-ID resolution order: (1) branch-name regex via adapter's `ticket_id_regex`, (2) `active_ticket:` line in CLAUDE.md's `## Task Tracking` section, (3) interactive prompt if both fail
- AC-STE-27.3: Mismatch between branch regex and CLAUDE.md front-matter fails the skill with an explicit error — never picked silently
- AC-STE-27.4: User declining at the confirmation prompt exits the skill cleanly with zero side effects

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

---
id: fr_01KPT3RPR7P1CK6W2894NNBAVT
title: Migration Prompts for Initial Ticket State (Backlog vs Done)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-39
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

Procedure doc is silent on the initial `state:` of newly created tickets — which defaults to `Backlog` across trackers. Migrating a project whose FRs describe already-shipped work lands every ticket in `Backlog`, misrepresenting reality and forcing a manual bulk-transition. Dogfooded 2026-04-22 — Claude had to ask the user explicitly, user picked `Done` (27 shipped FRs).

## Acceptance Criteria

- AC-60.1: Before the bulk push, migration prompts once: `"Create all N tickets as: [1] Backlog (new work) / [2] Done (shipped work) / [3] In Progress (in flight) / [4] ask per-FR. Enter 1-4; default 1."`
- AC-60.2: Option 4 (per-FR) prompts for each FR using its frontmatter `status:` field as a default (active → `Backlog`, in_progress → `In Progress`); archived FRs are always excluded from the push per AC-45.3
- AC-60.3: Chosen state is applied via `save_issue`/`upsert_ticket_metadata`'s `state` parameter (or adapter-equivalent)
- AC-60.4: Adapter metadata declares allowed initial states via `status_mapping` (already exists per Schema M); a state choice that's not in the allowlist fails the prompt with NFR-10 canonical error naming the valid options
- AC-60.5: The chosen default state is recorded in the sync-log entry: `- <ISO> — Migration complete: none → linear, 27 FRs moved (initial state: Done)`

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #5 of 8. The prompt is essentially the dogfooding user experience codified.

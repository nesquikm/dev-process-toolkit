---
title: Per-Milestone Plan Files
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-21
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Single `plan.md` is replaced with `specs/plan/<M#>.md` — one file per milestone. Each file is written once on a dedicated kickoff branch, frozen for the milestone's duration, and subsequently edited only via a replan branch. Ticket branches never edit the plan.

## Acceptance Criteria

- AC-STE-21.1: `specs/plan/<M#>.md` exists for every active or archived milestone; filenames match `^M\d+\.md$`
- AC-STE-21.2: Each plan file has frontmatter: `milestone` (string), `status` (`draft` | `active` | `complete`), `kickoff_branch` (string, null if `draft`), `frozen_at` (ISO date, null if `draft`)
- AC-STE-21.3: Once `status: active`, plan content is immutable. Any skill writing to an `active` plan file fails with: *"Plan for <M#> is frozen. Create a `plan/<M#>-replan-<N>` branch to revise."*
- AC-STE-21.4: Replan branches named `plan/<M#>-replan-<N>` are the sanctioned mechanism for mid-milestone plan changes; each replan produces a new commit to the same plan file, preserving prior plan in git history
- AC-STE-21.5: Archival moves plan files to `specs/plan/archive/<M#>.md` (parallel to FR archival under STE-22)
- AC-STE-21.6: Aggregate legacy `plan.md` is not retained in v2; `specs/plan/INDEX.md` (generated) lists all milestones with current status for cross-milestone views

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

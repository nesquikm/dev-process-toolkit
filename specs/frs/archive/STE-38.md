---
id: fr_01KPT3RPR4XSAWBBF4CQSS0DTK
title: Migration Populates Linear Project Milestone Field
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-38
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

`upsert_ticket_metadata(null, title, description)` creates a flat ticket in Linear with no project-milestone association. Each FR declares its local milestone via frontmatter `milestone: M<N>`. Migration should map that to Linear's native Project Milestone so the tracker view mirrors the spec's milestone grouping — otherwise 27 shipped FRs land under one flat project, losing the milestone taxonomy. Dogfooded 2026-04-22 — Claude manually set the milestone field.

## Acceptance Criteria

- AC-59.1: For the `linear` adapter, migration sets the Linear Project Milestone on `save_issue` by matching FR frontmatter `milestone: M<N>` to a Linear milestone whose name starts with `M<N>` (case-sensitive, exact-prefix) on the configured project
- AC-59.2: If no matching Linear milestone exists, migration prompts once per missing milestone: `"Linear milestone 'M<N>' not found on project '<name>'. [1] Create it / [2] Skip milestone binding for these N FRs / [3] Cancel migration. Enter 1-3."`
- AC-59.3: Jira adapter: capability not implemented in v1 — adapter's `capabilities.project_milestone` declares `false`; migration logs a one-liner `"Jira does not map milestones at push time; use Jira fixVersions manually."`
- AC-59.4: Adapter metadata declares the capability: Linear → `project_milestone: true`; Jira → `false`; Custom template → `false` with a comment pointing adapter authors at the Linear implementation
- AC-59.5: Documented in `docs/tracker-adapters.md` with a side-by-side table of the per-adapter milestone mapping behaviour and the FR-to-tracker field derivation

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #4 of 8.

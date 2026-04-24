---
id: fr_01KPR3M74XA75GJKT4Z4HG95VC
title: Archive Directory and Index
milestone: M7
status: archived
archived_at: 2026-04-10T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Establishes `specs/archive/` and `specs/archive/index.md` as conventions. Skills in the hot path (`/implement`, `/gate-check`) never read the archive; `/spec-review` may optionally consult the index for historical queries. Keeps the cache-hot prefix stable per prompt-caching best practices.

## Acceptance Criteria

- AC-19.1: `setup/SKILL.md` step 2 (scaffolding) creates an empty `specs/archive/` directory alongside `specs/` when generating new spec files
- AC-19.2: `setup/SKILL.md` creates an initial `specs/archive/index.md` with header row `| Milestone | Title | Archived | Archive File |`
- AC-19.3: `templates/spec-templates/` contains a new file `archive-index.md.template` with the header row and a one-line purpose description
- AC-19.4: `spec-review/SKILL.md` contains a step titled `### Optional: Consult Archive Index` that reads `specs/archive/index.md` only if the user's query references a milestone ID not present in live `plan.md`
- AC-19.5: `gate-check/SKILL.md` Drift Check contains the literal instruction: `Never read specs/archive/ — only live spec files count for drift detection`
- AC-19.6: `implement/SKILL.md` Phase 1 (Understand) contains the literal instruction: `Do not read specs/archive/ during implementation — archived milestones are historical context only`
- AC-19.7: Archive files are append-only. Reopening a milestone creates `M{N}-r2-{slug}.md` (per AC-17.7) and never mutates the original

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M7-bounded-context.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

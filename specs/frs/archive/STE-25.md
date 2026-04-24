---
id: fr_01KPR3M74XA75GJKT4Z4HG95TB
title: Documentation + Release
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-25
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Ship v1.16.0 with complete documentation: a new pattern entry, methodology update, CLAUDE.md template refresh, CHANGELOG entry, version bumps across plugin.json + marketplace.json, and a refreshed README "Latest:" line.

## Acceptance Criteria

- AC-STE-25.1: `plugins/dev-process-toolkit/docs/patterns.md` has a new section `## Pattern: ULID File-per-FR Layout` cross-linking STE-26..STE-28 and summarizing the invariants (immutable filenames, local minting, provider abstraction)
- AC-STE-25.2: `plugins/dev-process-toolkit/docs/methodology.md` has a new `## Parallel-safe layout` section explaining the rationale, the migration story, and the one-ticket-one-branch discipline
- AC-STE-25.3: `plugins/dev-process-toolkit/templates/CLAUDE.md.template` describes the v2 `specs/` tree structure (with `frs/`, `plan/`, `.dpt-layout`)
- AC-STE-25.4: `CHANGELOG.md` has a new `## [1.16.0] — YYYY-MM-DD — "Parallel-safe"` entry cross-referencing STE-26..STE-25, following Keep a Changelog format per CLAUDE.md release checklist
- AC-STE-25.5: `plugins/dev-process-toolkit/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` version fields bumped to `1.16.0` atomically (both or neither)
- AC-STE-25.6: `README.md` "Latest:" line updated to `v1.16.0 — "Parallel-safe"`; Structure list refreshed if skill count or directory layout changed
- AC-STE-25.7: `docs/tracker-adapters.md` is updated to document the new `Provider` interface and how adapters implement it (if the M12 adapter surface needs changes to fit the Provider abstraction, those are documented here)

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

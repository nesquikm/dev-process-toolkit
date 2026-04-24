---
id: fr_01KPR3M74XA75GJKT4Z4HG95TG
title: Documentation + Release
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-34
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Ship v1.17.0 with documentation covering the resolver contract, adapter-author registration surface, and release checklist updates.

## Acceptance Criteria

- AC-STE-34.1: `plugins/dev-process-toolkit/docs/patterns.md` gains a new section `## Pattern: Tracker-ID Auto-Resolution` cross-linking STE-30..54 and summarizing the three detection branches, the fallthrough contract, and the ambiguity resolution model
- AC-STE-34.2: `plugins/dev-process-toolkit/docs/tracker-adapters.md` gains a section titled "Registering tracker ID patterns for the resolver" documenting how adapter authors expose their ID regex and URL host/path pattern so `resolveFRArgument` can detect them
- AC-STE-34.3: `CHANGELOG.md` has a new `## [1.17.0] — YYYY-MM-DD — "Tracker-native Entry"` entry cross-referencing STE-30..55, following Keep a Changelog format per CLAUDE.md release checklist
- AC-STE-34.4: `plugins/dev-process-toolkit/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` version fields bumped to `1.17.0` atomically (both or neither)
- AC-STE-34.5: `README.md` "Latest:" line updated to `v1.17.0 — "Tracker-native Entry"`; Structure list refreshed if directory layout changed

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

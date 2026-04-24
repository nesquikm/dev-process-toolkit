---
id: fr_01KPR3M74XA75GJKT4Z4HG95VD
title: Documentation and Release Notes for Archival Feature
milestone: M7
status: archived
archived_at: 2026-04-10T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** The archival feature introduces a new workflow concept (compactable specs), a new skill (`/spec-archive`), a new directory convention (`specs/archive/`), and a new phase in `/implement`. None of this is discoverable unless the repository's own docs, README, and project-root CLAUDE.md are updated to mention it. Covers all non-skill, non-template content that users read to learn the toolkit.

## Acceptance Criteria

- AC-20.1: `docs/patterns.md` contains a new section titled `### Pattern: Archival Lifecycle` explaining when a milestone is archived, what moves (plan block + traceability-matched ACs), what does NOT move (`technical-spec.md`), and the rationale (prompt-caching stability + bounded context cost)
- AC-20.2: `docs/sdd-methodology.md` contains a new paragraph (or section) noting that spec files are **compactable** — completed milestones move to `specs/archive/` automatically at `/implement` Phase 4, and that this is part of the normal methodology, not an advanced feature
- AC-20.3: `docs/adaptation-guide.md` contains a new section titled `## Customizing Archival` explaining how users can opt out (by deleting `specs/archive/`) and how to manually archive via `/spec-archive`
- AC-20.4: `README.md` feature list (or equivalent "what's in the box" section) includes a bullet mentioning `/spec-archive` and `specs/archive/` with a one-line description
- AC-20.5: `CHANGELOG.md` exists at repo root in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and contains a `## [1.10.0] — YYYY-MM-DD — "Bounded Context"` section summarizing FR-16 through FR-19 under an `### Added` subsection. `README.md` references `CHANGELOG.md` via a short "Release Notes" section instead of embedding release notes inline (keeps the README from rotting into a changelog)
- AC-20.6: `CLAUDE.md` (project root, not the template) updates any skill count reference from `11 skills` to `12 skills` (or equivalent phrasing that reflects the new `/spec-archive`)
- AC-20.7: `CLAUDE.md` (project root) lists `/spec-archive` in any section that enumerates available skills or key commands
- AC-20.8: `docs/skill-anatomy.md` — if it references specific skills by name in examples — adds `/spec-archive` to any such list (otherwise: no change required; skip silently)
- AC-20.9: Every doc/README/CHANGELOG addition above cross-references at least one relevant FR ID (FR-16, FR-17, FR-18, or FR-19) so readers can trace narrative back to normative spec
- AC-20.10: `CLAUDE.md` (repo root) Release Checklist section lists exactly 3 mandatory files: `plugin.json`, `marketplace.json`, and `CHANGELOG.md`. The checklist contains a literal instruction that CHANGELOG.md must be updated on every version bump with a new Keep-a-Changelog-format entry, and explicitly warns against embedding release notes in README

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M7-bounded-context.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

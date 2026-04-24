---
id: fr_01KPT3RPRGSRW3NF5BT0HQJ2P7
title: M15 Documentation + Release (v1.18.0)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-43
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

Ship v1.18.0 "Migration Hardening" with complete documentation: CHANGELOG entry cross-referencing the 8 fix FRs, atomic version bumps across plugin.json + marketplace.json, README refresh, and a new pattern entry capturing the dogfooding-discovery methodology that produced M15.

## Acceptance Criteria

- AC-64.1: `CHANGELOG.md` has a new `## [1.18.0] — YYYY-MM-DD — "Migration Hardening"` entry cross-referencing FR-56..FR-70 (all 15 M15 FRs) using Keep a Changelog format per CLAUDE.md release checklist
- AC-64.2: `plugins/dev-process-toolkit/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` version fields bumped to `1.18.0` atomically (both or neither)
- AC-64.3: `README.md` "Latest:" line updated to `v1.18.0 — "Migration Hardening"`; Structure list refreshed if FR/skill counts changed
- AC-64.4: `docs/setup-migrate.md` is reviewed end-to-end for v1/v2 layout branching; all `specs/requirements.md` references are replaced by version-aware iteration per FR-57
- AC-64.5: `docs/patterns.md` gains a new section `## Pattern: Dogfooding Discovery` summarizing the 2026-04-22 methodology — migrate on the plugin's own repo, log findings as NFR-10-shape deviations, file each as a dedicated FR with a `Finding #N of M` note, bundle into a single "Hardening" milestone
- AC-64.6: M15 is archived per FR-45 v2 procedure — `specs/plan/M15.md` moved to `specs/plan/archive/M15.md`, each of the 15 FR files moved from `specs/frs/` to `specs/frs/archive/` with frontmatter `status: active` → `status: archived` + `archived_at: <ISO>`, and `specs/INDEX.md` regenerated; the archived `M15.md` plan file is the summary for future archaeology (the v1 `specs/archive/M15-migration-hardening.md` path referenced by the original AC was purged by FR-70 before this FR landed, so the original AC target no longer exists)

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. M15 Documentation + Release FR matching the M12/M13/M14 pattern. Final FR of 9 for the milestone.

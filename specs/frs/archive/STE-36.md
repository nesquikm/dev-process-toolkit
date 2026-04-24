---
id: fr_01KPT3RPQY5M4AB12WN8GW8WJ0
title: none→tracker Migration Walks v2 Layout (specs/frs/)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-36
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

`docs/setup-migrate.md:104` says the `none → <tracker>` procedure iterates "each live FR in `specs/requirements.md`". In v2 layout, FRs live in `specs/frs/*.md` (one per file) and `requirements.md` holds only cross-cutting content. Without this fix, the migration on a v2 repo finds 0 FRs and silently does nothing. Dogfooded on 2026-04-22 — Claude had to apply judgment and walk `specs/frs/*.md` instead; the procedure as literally written was a no-op.

## Acceptance Criteria

- AC-57.1: `docs/setup-migrate.md` none→tracker procedure branches on layout version read from `specs/.dpt-layout`: v2 iterates `specs/frs/*.md` (excluding `archive/`); v1 iterates `specs/requirements.md` FR blocks as today
- AC-57.2: v2 iteration uses `readdirSync(specsDir + '/frs')` + frontmatter parsing (same parser used by `regenerateIndex`); archived FRs (`specs/frs/archive/`) are excluded
- AC-57.3: A regression fixture exercises none→linear migration on a v2 project with ≥3 FRs; asserts all 3 FRs produce tracker tickets (not 0)
- AC-57.4: Migration emits a structured summary before pushing: `"Found N FRs in <layout> layout; will create N tracker tickets."` plus a confirm prompt
- AC-57.5: If `specs/.dpt-layout` is absent AND `specs/requirements.md` is absent AND `specs/frs/` is absent, migration refuses with NFR-10 canonical error: `"No specs/ content found; nothing to migrate."`

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #2 of 8. Depends on FR-56 (detection fix) landing first.

---
id: fr_01KPT3RPRCKK3C8ZXGN1ZTG4MA
title: Refresh requirements.md Overview to Reflect Shipped Releases
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-41
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

`specs/requirements.md` §1 Overview contains narrative about v1.15.0 "in flight", v1.16.0 "planned", v1.17.0 "planned" — but git log + CHANGELOG show all three shipped. This is a stale read for any `/implement` or `/spec-write` invocation that loads the overview as context. The overview has become a changelog-by-accident, violating the "thin cross-cutting file" design from AC-40.3.

## Acceptance Criteria

- AC-62.1: Overview narrative reflects current shipped releases (v1.17.0 is the latest shipped; v1.18.0 is the in-flight milestone)
- AC-62.2: "v1.X.X (in flight / planned)" markers are removed from sections describing shipped milestones; those descriptions move to `CHANGELOG.md` if not already there
- AC-62.3: Historical context (motivation, rationale across past milestones) is preserved but condensed: one sentence per shipped milestone, linking to `specs/archive/` for full detail
- AC-62.4: Overview length target: ≤80 lines (currently 23 lines of overview + ~180 lines of dense historical narrative = way over budget)
- AC-62.5: A lint rule in `/gate-check` warns (not fails) if `specs/requirements.md` contains `(in flight)` / `(planned)` markers referencing versions that already appear in `CHANGELOG.md` as shipped — catches future drift

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #7 of 8. Cosmetic on the surface but affects every context load — high value for low effort.

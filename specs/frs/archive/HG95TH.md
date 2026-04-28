---
id: fr_01KPR3M74XA75GJKT4Z4HG95TH
title: CI/CD Parity for `/gate-check` (partial — AC-3.3..3.6 only; AC-3.1, AC-3.2 archived in M3)
milestone: M1
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Support structured output and document how to keep gate-check in sync with CI pipelines.

## Acceptance Criteria

- AC-3.3: `docs/adaptation-guide.md` contains a section titled `## CI/CD Parity` explaining how to keep gate-check commands in sync with CI pipeline
- AC-3.4: `examples/typescript-node/` contains a file `.github/workflows/gate-check.yml` with a working GitHub Actions config
- AC-3.5: `examples/python/` contains a file `.github/workflows/gate-check.yml`
- AC-3.6: `examples/flutter-dart/` contains a file `.github/workflows/gate-check.yml`

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M1-templates-and-docs.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

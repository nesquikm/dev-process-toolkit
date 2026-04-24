---
id: fr_01KPR3M74XA75GJKT4Z4HG95TK
title: Better Spec Templates
milestone: M1
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Enhance spec templates with security, NFRs, negative ACs, ADR, and richer ADAPT markers.

## Acceptance Criteria

- AC-14.1: `templates/spec-templates/requirements.md.template` contains a section titled `## Security / Abuse Cases` with at least 2 example entries showing attacker motivation and mitigation
- AC-14.2: `templates/spec-templates/requirements.md.template` NFR section contains at least 2 constraint examples with a numeric value and unit (e.g., `p95 latency < 200ms`, `availability >= 99.9%`)
- AC-14.3: `templates/spec-templates/requirements.md.template` contains at least 2 negative acceptance criteria examples using the pattern `must NOT...`
- AC-14.4: `templates/spec-templates/technical-spec.md.template` contains a section titled `## Architecture Decision Records` with a table template: `Decision`, `Options Considered`, `Choice`, `Rationale`
- AC-14.5: `<!-- ADAPT -->` markers across all 4 spec templates include at least 2 concrete stack-specific examples each (TypeScript, Python, or Flutter)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M1-templates-and-docs.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

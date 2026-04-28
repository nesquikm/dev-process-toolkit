---
title: Ship Linear + Jira + Custom Template in v1
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-16
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

v1 ships built-in adapters for Linear and Jira, plus a `custom` template for community-contributed trackers.

## Acceptance Criteria

- AC-STE-16.1: `adapters/linear.md` declares the 4-op contract per AC-STE-10.3 (frontmatter `capabilities`, `ac_storage_convention: description-section`, `ticket_id_regex`, `status_mapping`); `adapters/linear/src/normalize.ts` provides the Linear-specific text-wrangling helper (description canonicalization for round-trip idempotence per AC-STE-17.6) with passing unit tests; MCP dispatch is LLM-driven against the Linear MCP server. End-to-end conformance is verified by the Tier 5 manual checklist in `docs/tracker-adapters.md` against a live Linear workspace
- AC-STE-16.2: `adapters/jira.md` declares the 4-op contract per AC-STE-10.3 (frontmatter `capabilities`, `ac_storage_convention: custom-field`, `ticket_id_regex`, `status_mapping`); `adapters/jira/src/discover_field.ts` provides the Jira-specific text-wrangling helper (custom-field GID discovery per AC-STE-9.6) with passing unit tests; MCP dispatch is LLM-driven against the Atlassian MCP server. End-to-end conformance is verified by the Tier 5 manual checklist against a live Jira Cloud tenant
- AC-STE-16.4: `adapters/_template.md` + `adapters/_template/src/*.ts` ship with inline documentation and a placeholder implementation
- AC-STE-16.5: `docs/tracker-adapters.md` documents the 4-op contract with a worked custom-tracker example
- AC-STE-16.6: Capabilities-aware skills gracefully degrade when the active adapter lacks a capability (e.g., adapter declaring no `push_ac_toggle` capability → `/gate-check` prints a manual-update reminder in NFR-10 canonical shape instead of erroring)

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

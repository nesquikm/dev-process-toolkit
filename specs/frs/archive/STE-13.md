---
title: AC Extraction Layer (Strict Parsing)
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-13
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Skills that read ACs use the adapter's parser, not the raw description blob. Comments, history, preamble, and attachments are discarded at the parser boundary so the model only sees AC content.

## Acceptance Criteria

- AC-STE-13.1: Each adapter declares its AC parsing convention in metadata (e.g., Linear: `## Acceptance Criteria` section in description; Jira: discovered custom-field)
- AC-STE-13.2: Skills extract ACs using the adapter's declared `ac_storage_convention`, not the raw ticket description blob. For bounded-scope storage (Jira: discovered custom-field per AC-STE-9.6) extraction is a direct field read. For section-anchored storage (Linear: `## Acceptance Criteria` heading in the description) extraction is bounded by the anchor; the LLM MUST NOT feed the pre-anchor preamble or post-anchor content to downstream prompts. Adapters MAY provide a text-wrangling helper to enforce the bound (e.g., `linear/src/normalize.ts` returns empty output if the anchor is absent, forcing AC-STE-13.4 fail rather than silent fall-through)
- AC-STE-13.3: Non-AC content (comments, history, description preamble, attachments) is outside the `ac_storage_convention` scope and MUST NOT be passed to downstream prompts. For bounded-scope trackers this is automatic. For section-anchored trackers the anchor is the contract boundary. Enforcement is the adapter convention + skill-author discipline + spec-review inspection, not runtime validation — v1 ships no structural validator that asserts "no out-of-scope text reached the model"
- AC-STE-13.4: Empty AC parse fails the skill with `"No acceptance criteria found in ticket <ID>"` rendered in NFR-10 canonical shape — never silently proceed on an empty AC list

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

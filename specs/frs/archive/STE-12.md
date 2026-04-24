---
title: Mode-Consistency Invariant
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-12
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Every affected skill reads the tracker mode from CLAUDE.md before any other action and behaves consistently. Skills that are not applicable in a given mode exit cleanly — never partial behavior.

## Acceptance Criteria

- AC-STE-12.1: Affected skills (`/spec-write`, `/implement`, `/gate-check`, `/pr`, `/spec-review`, `/spec-archive`) read `## Task Tracking` from CLAUDE.md before any AC operation
- AC-STE-12.2: A skill that is not applicable in the current mode exits cleanly with a one-line message — never partial behavior
- AC-STE-12.3: In tracker mode, `specs/requirements.md` continues to hold FR AC text; the tracker mirrors it via `upsert_ticket_metadata` and holds canonical checkbox state. No skill writes ACs **unilaterally** to either side — local writes trigger a push to tracker (per AC-STE-12.7 + AC-STE-17.9), and drift detected on pull (AC-STE-17.1) is resolved interactively (AC-STE-17.3) before applying to either side
- AC-STE-12.4: In `none` mode, no skill makes MCP calls or reads tracker state
- AC-STE-12.5: Declared mode vs. actual state mismatch (e.g., `mode: linear` but MCP unreachable, or `mode: none` but `## Task Tracking` references ticket IDs) fails the skill and points the user to `/setup --migrate` (error surfaced in NFR-10 canonical shape)
- AC-STE-12.6: Non-AC content in `specs/` (overview, NFRs, technical-spec, testing-spec, plan, traceability, edge cases, archive) is read and written identically in both modes
- AC-STE-12.7: `/spec-write` after saving an FR edit/creation, and `/implement` at skill start, both invoke the STE-17 sync diff/resolve loop via the active adapter — so neither edit nor execution paths silently overwrite the other side
- AC-STE-12.8: The Pattern 9 regression gate (`tests/scripts/verify-regression.ts`) MUST execute the canonical Schema L probe against at least (i) the `mode-none-baseline` fixture and (ii) a CLAUDE.md freshly rendered from `templates/CLAUDE.md.template` (the `mode-none-fresh-setup` fixture). Both invocations must report `mode=none`. File-hash-only comparison against a static fixture does NOT satisfy this AC — snapshot comparison verifies fixture stability, not skill behaviour. Gate fails (stop-ship) if either probe invocation reports anything other than `mode=none`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

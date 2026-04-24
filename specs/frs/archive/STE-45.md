---
title: updatedAt Recording Timing — Record After claimLock to Avoid Self-Drift
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-45
created_at: 2026-04-22T08:30:00.000Z
---

## Requirement

AC-33.2 says `/implement` records the tracker's `updatedAt` "at skill start". AC-33.3 says `/gate-check` warns if `updatedAt` differs from what `/implement` recorded. BUT `Provider.claimLock` (step 0.c) writes to the ticket (sets status `In Progress` + assignee), bumping the tracker's `updatedAt`. A naive implementation recording `updatedAt` before `claimLock` makes `/gate-check` flag the skill's own write as "ticket modified since /implement". Dogfooded 2026-04-22 — observed STE-35 `updatedAt` bump from `2026-04-22T08:12:47.609Z` → `2026-04-22T08:26:34.407Z` across `claimLock`; a naive gate-check would fire a false-positive drift warning.

## Acceptance Criteria

- AC-66.1: `/implement` records the tracker's `updatedAt` **after** `Provider.claimLock` completes, not at skill start
- AC-66.2: `skills/implement/SKILL.md` step 0 ordering updated: 0.c `claimLock` → 0.d `pull_acs` + record `updatedAt` → FR-39 diff/resolve (current order has `updatedAt` recording implicit in 0.d but the AC-33.2 spec says "at skill start", creating ambiguity)
- AC-66.3: `specs/frs/` AC-33.2 reworded to: *"`/implement` after `claimLock` succeeds fetches ticket content and records the tracker's `updatedAt` in-memory for the session"*
- AC-66.4: Regression fixture: /implement on a Backlog FR → claimLock fires → updatedAt recorded → simulated /gate-check re-fetch → no drift warning (delta = 0)
- AC-66.5: Same rule applies to any other tracker-writing pre-flight step: record `updatedAt` **after** all pre-flight side effects (including branch-name interop warning writes, if any)
- AC-66.6: Edge case: if `claimLock` is `already-ours` (resuming on an existing claim) and the current `updatedAt` is older than the one previously recorded this session, prefer the newer value (prevents backslide when a skill is resumed after a legitimate tracker-side edit)
- AC-66.7: `docs/implement-tracker-mode.md` gains a one-line call-out: *"Record `updatedAt` AFTER `claimLock` — the claim itself mutates the ticket."*

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/implement STE-35` dogfooding session. Finding #10 of 10. Narrow spec bug with loud downstream symptom (false-positive drift warnings on every /gate-check run in tracker mode).

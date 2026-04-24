---
title: Archive plan-status normalization + gate-check probe #16
milestone: M25
status: archived
archived_at: 2026-04-24T21:20:14Z
tracker:
  linear: STE-92
created_at: 2026-04-24T20:40:30Z
---

## Requirement

Per the PR #4 audit (iteration 2 H5, downgraded to cosmetic in iteration 5), 18 of 24 archived plan files in `specs/plan/archive/` carry non-canonical `status:` values:

- `status: active` (4 plans): M20, M21, M23, M24 — the most recent milestones. `/implement` Phase 4 shipped them and never flipped plan status, so the `git mv` moved active-state plans into `archive/`.
- `status: complete` (12 plans): M1–M11, M19 — non-canonical third value from an earlier convention.
- `status: draft` (2 plans): M16, M18 — milestones that shipped but whose plans were never status-bumped beyond initial draft.
- `status: archived` (6 plans): M12–M15, M17, M22 — canonical.

H5's iteration-5 downgrade to cosmetic is correct (verified): every live code path that scans plan files excludes `specs/plan/archive/` (gate-check SKILL.md:102, implement SKILL.md:23, docs SKILL.md:107, spec-archive SKILL.md:102, ship-milestone SKILL.md:16, plan_lock.ts is path-arg-driven), so no runtime skill consumes archived plan status today. The drift is cosmetic. But `/implement` Phase 4 prose doesn't flip plan status on close, so future milestones will continue re-drifting. Backfill the 18 plans, fix the Phase 4 prose root cause, add a gate-check probe as defense-in-depth.

## Acceptance Criteria

- AC-STE-92.1: All 24 files matching `specs/plan/archive/M*.md` carry frontmatter `status: archived`. {#AC-STE-92.1}
- AC-STE-92.2: All 24 files carry a non-null `archived_at:` ISO-8601 timestamp. For plans where `archived_at` is being introduced (not just reaffirmed), the value matches `git log -1 --format=%cI --diff-filter=A -- specs/plan/archive/M<N>.md` (the commit that added the file at its archive path). {#AC-STE-92.2}
- AC-STE-92.3: `skills/implement/SKILL.md` Phase 4 atomic-commit prose (approximately line 236) includes an instruction to flip the closing milestone's `specs/plan/<M#>.md` frontmatter `status: active` → `status: archived` and set `archived_at` to the same timestamp used for the FR status flips, as part of the atomic commit with the `git mv`. {#AC-STE-92.3}
- AC-STE-92.4: `skills/gate-check/SKILL.md` declares probe #16 "Archive plan-status invariant" asserting every `specs/plan/archive/*.md` carries frontmatter `status: archived` and a non-null `archived_at`; probe description follows the existing probe-1-15 convention (numbered list entry, one-sentence assertion, link to test file). {#AC-STE-92.4}
- AC-STE-92.5: `tests/gate-check-archive-plan-status.test.ts` exists and covers: (a) positive case — all archived plans carry canonical status; (b) negative cases — `status: active` / `status: complete` / `status: draft` / missing `archived_at` each fail with the canonical NFR-10 error shape. {#AC-STE-92.5}
- AC-STE-92.6: `tests/implement-phase4-close.test.ts` (or a new peer test) locks the new plan-status flip prose in `/implement` Phase 4. {#AC-STE-92.6}
- AC-STE-92.7: After this FR lands, `/gate-check` runs green on the current repo state — probe #16 fires all-pass because the backfill and probe ship in the same commit. {#AC-STE-92.7}

## Technical Design

- **Backfill (AC-STE-92.1, .2):** frontmatter-only edits across 18 files. A small one-shot script reads each file, calls `git log -1 --format=%cI --diff-filter=A -- <file>` for the timestamp, rewrites the frontmatter via `parseFrontmatter` + `setFrontmatter` (existing helpers in `adapters/_shared/src/frontmatter.ts`), and writes back. Script lives in `tests/scripts/` for the session and is deleted after the backfill commit — explicitly NOT shipped in `adapters/_shared/src/migrations/` (M26's deletion target).
- **Phase 4 prose fix (AC-STE-92.3):** additive edit to `skills/implement/SKILL.md` Phase 4 around line 236. New instruction paragraph after the FR status-flip loop, before the `git mv`. Language mirrors the existing FR flip pattern.
- **Probe #16 (AC-STE-92.4):** new numbered entry in `skills/gate-check/SKILL.md` following the probe-1-15 pattern. Implementation reads `specs/plan/archive/*.md`, parses frontmatter via `parseFrontmatter`, asserts `status === "archived"` and `archived_at` is a non-empty ISO string. Runs per-`/gate-check` invocation; cost is negligible (small filesystem scan, no network).
- **Test (AC-STE-92.5):** new `tests/gate-check-archive-plan-status.test.ts` following the `gate-check-*.test.ts` convention (see `gate-check-active-ticket-drift.test.ts` as recent precedent). Uses in-memory fixtures — no new fixture directory. Covers positive + 4 negative cases.
- **Phase 4 test (AC-STE-92.6):** either extend `tests/implement-phase4-close.test.ts` with a plan-status-flip assertion or add a sibling file — whichever keeps the diff smaller.

## Testing

- Positive case: real repo state after backfill passes probe #16.
- Negative cases: fixture plan with `status: active`, `status: complete`, `status: draft`, or missing `archived_at` each triggers the canonical NFR-10 error.
- Regression: existing 15 probes continue passing byte-identically. Total test count increases by ~5 (probe #16 cases) + 1 (Phase 4 prose lock).

## Notes

H5's iteration-5 downgrade to cosmetic is correct, verified again in this FR's backfill design — no live runtime consumes archived plan status today. Probe #16 is defense-in-depth against hypothetical future skills that might consume archived plan status without the existing path's `archive/` exclusion.

Vocabulary choice: `archived` (not `complete`, not `done`, not `shipped`) is canonical because `specs/plan/archive/` is the path. Status matches directory.

The one-shot backfill script is intentionally not promoted to a reusable adapter — M26 is deleting `adapters/_shared/src/migrations/` entirely, and this script would be added at exactly the wrong moment. Local script, run once, delete.

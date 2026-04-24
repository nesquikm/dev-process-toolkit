---
title: M24.md archived-plan metadata refresh
milestone: M25
status: archived
archived_at: 2026-04-24T21:20:14Z
tracker:
  linear: STE-90
created_at: 2026-04-24T20:40:26Z
---

## Requirement

`specs/plan/archive/M24.md` was drafted when M24 was tentatively targeting v1.25.0 with codename undecided. M24 shipped as v1.26.0 "Symmetry" on 2026-04-24 (per `git log main..HEAD` and CHANGELOG.md:9), but the archived plan file was moved to `archive/` without updating its prose or frontmatter. Four drift points:

- Frontmatter `status: active` — should be `archived`.
- Frontmatter lacks `archived_at`.
- Line 10: `**Release target:** v1.25.0. Codename TBD ("Claim Enforcement" / "Symmetry" contenders).` — actual ship was v1.26.0, codename "Symmetry".
- Line 11: `**Status:** drafted 2026-04-24 from M23 "Self-Hosted" dogfood finding.` — says "drafted" despite the milestone having shipped.

This is a metadata-only cleanup; M24's body content (phases, risk scan, etc.) accurately describes what shipped and stays unchanged. The broader 18-plan vocabulary normalization is STE-92's scope.

## Acceptance Criteria

- AC-STE-90.1: `specs/plan/archive/M24.md` frontmatter `status` is `archived`. {#AC-STE-90.1}
- AC-STE-90.2: `specs/plan/archive/M24.md` frontmatter includes `archived_at:` with an ISO-8601 timestamp equal to the commit time of the `git mv` that moved the plan to `archive/` (obtained via `git log -1 --format=%cI --diff-filter=A -- specs/plan/archive/M24.md` or equivalent). {#AC-STE-90.2}
- AC-STE-90.3: Line 10 reads `**Release target:** v1.26.0. **Codename:** "Symmetry".` {#AC-STE-90.3}
- AC-STE-90.4: Line 11 reads `**Status:** shipped 2026-04-24 as v1.26.0 "Symmetry".` {#AC-STE-90.4}
- AC-STE-90.5: No other lines of `M24.md` are modified — this FR's scope is header metadata only. {#AC-STE-90.5}

## Technical Design

Targeted prose edits. No code changes, no new tests.

## Testing

No new test required. STE-92's probe #16 will retroactively assert this file passes the canonical archive-plan-status invariant.

## Notes

This is one of five FRs in M25. The broader "all 18 plans with drifted status" fix is STE-92 — that FR's commit ships AFTER this one to keep the per-FR diff clean.

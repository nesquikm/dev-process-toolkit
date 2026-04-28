---
title: Strip transition-state framing — v1→v2 lenient + STE-60→61 window (D3 + D4)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-96
created_at: 2026-04-25T06:42:12Z
---

## Requirement

Two sibling categories of transition-state framing exist throughout docs and skills, both rendered moot by the no-users frame:

**D3 — v1→v2 layout migration scaffolding:**
- `docs/sdd-methodology.md:138` — "v2 is the only supported layout… there is no v1 → v2 migration path, and no v1 projects remain in production use." Accurate but the disclaimer wouldn't exist if there were no users to reassure.
- `docs/adaptation-guide.md:244` — "Projects that want `plan.md` / `requirements.md` style monoliths should stay on pre-M13 releases (v1.15.x)." Dead advice; no pre-M13 projects in the wild.
- `skills/setup/SKILL.md:27` — "v2 is the baseline layout — there is no v1 → v2 migration path…" Also dead.
- `docs/v2-layout-reference.md:39` — "plan files produced by migration have `kickoff_branch: null` and `frozen_at: null` even when `status: active`… `/gate-check` treats migrated plans leniently on round 1." Lenient transition logic no user will hit.

**D4 — STE-60→61 transition window:**
- `skills/gate-check/SKILL.md:25` — "Legacy `fr_<ULID>.md` filenames fail this gate (STE-61 completed the one-time rewrite in v1.21.0). Supersedes the pre-M18 filename ↔ `id:` equality assertion…"
- `docs/v2-layout-reference.md:62` — "lenient during the STE-60 → STE-61 transition window so legacy `fr_<ULID>.md` files still pass; STE-61 AC-STE-61.5 flips to strict"
- `docs/patterns.md:425, 444` — similar "Superseded-by M18 STE-60 + M21 STE-76" framing.

No project has legacy `fr_<ULID>.md` filenames. The transition is a ghost of two milestones ago.

## Acceptance Criteria

- AC-STE-96.1: `docs/sdd-methodology.md:138` v1→v2 disclaimer paragraph deleted; surrounding text reflows for continuity. {#AC-STE-96.1}
- AC-STE-96.2: `docs/adaptation-guide.md:244` "pre-M13 releases (v1.15.x)" advice deleted. {#AC-STE-96.2}
- AC-STE-96.3: `skills/setup/SKILL.md:27` v1→v2 disclaimer deleted. {#AC-STE-96.3}
- AC-STE-96.4: `docs/v2-layout-reference.md:39` lenient-on-migrated-plans clause deleted; the surrounding paragraph asserts strict round-1 behavior. Any code path implementing the lenient branch (likely in `/gate-check` probe #4 plan-freeze logic) is removed. {#AC-STE-96.4}
- AC-STE-96.5: `skills/gate-check/SKILL.md:25` rewritten as strict-only contract: "Every `specs/frs/**/*.md` base name equals `Provider.filenameFor(spec)`." No "supersedes" paragraph, no "M18 STE-61 AC-STE-61.5" reference. {#AC-STE-96.5}
- AC-STE-96.6: `docs/v2-layout-reference.md:62` STE-60→61 transition-window language deleted. {#AC-STE-96.6}
- AC-STE-96.7: `docs/patterns.md:425, 444` "Superseded-by M18 STE-60 + M21 STE-76" notes deleted (cumulative scope: any `> **Superseded-by**` lines in patterns.md, of which audit found 1 confirmed instance — single-line deletion). {#AC-STE-96.7}
- AC-STE-96.8: `bun test` green; existing 16 gate-check probes (15 + M25's #16) continue passing on real repo state. {#AC-STE-96.8}

## Technical Design

Pure prose rewrites + one small code deletion (lenient-on-migrated-plans branch in `/gate-check`).

For each location, the rewrite pattern is:
- Before: "X was Y in pre-M<N>; STE-<N> made it Z. Lenient until STE-<M>; strict thereafter."
- After: "X is Z." (single sentence, present tense, no historical chain)

If a probe test asserts the lenient-branch behavior, delete that test case (the branch is being removed). If a probe test asserts the strict invariant, it stays.

## Testing

No new tests. Verify all 16 gate-check probes still pass after the lenient-branch deletion in `<tracker-id-d>` AC-STE-96.4. If any probe test shrinks (e.g., a "lenient case" gets removed), document in the commit message.

## Notes

Probe titles #1, #2, #6, #9 also embed historical "supersedes" cruft — those are STE-97's scope (final-state prose sweep), not this FR. Keep the boundary clean: this FR is about removing transition-window logic; STE-97 is about prose hygiene in titles and bodies.

Origin: PR #4 audit D3 + D4.

---
id: fr_01KPWH1CMQ7184QNNF5ZKJJ8D9
title: Delete specs/.dpt-layout + layout probes
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-56
created_at: 2026-04-23T06:40:48.000Z
---

## Requirement

With the v1→v2 migrator removed (FR-C1), `specs/.dpt-layout` is written by nothing and read only by skills' "Layout probe" step as a version gate. Its remaining job would be rejecting hypothetical v3+ installs — speculative, since no v3 exists.

Per brainstorm deferred decision #3, the **full-delete** path is chosen over the retain-as-v3-guard path. If v3 ever ships, version gating can be reintroduced at that time with appropriate semantics. Delete the marker, the `layout.ts` helper, and the "Layout probe" step from every skill.

## Acceptance Criteria

- AC-STE-56.1: `specs/.dpt-layout` is deleted from the repo.
- AC-STE-56.2: `plugins/dev-process-toolkit/adapters/_shared/src/layout.ts` is deleted along with any associated test file (`layout.test.ts`).
- AC-STE-56.3: Any template or helper that seeds `.dpt-layout` on setup is deleted (likely `plugins/dev-process-toolkit/templates/specs/.dpt-layout.template` if it exists; else covered by AC-STE-56.4's removal of SKILL.md prose that writes it inline).
- AC-STE-56.4: "Layout probe" sections are removed from all skills:
  - `skills/implement/SKILL.md` (step 0.a)
  - `skills/spec-write/SKILL.md` (step 0 Layout probe)
  - `skills/spec-archive/SKILL.md` (step 0 probe)
  - `skills/gate-check/SKILL.md` (Layout probe line)
  - `skills/setup/SKILL.md` (Layout detection in step 1)
  Each skill proceeds assuming v2 structure unconditionally.
- AC-STE-56.5: Layout-related tests deleted: `tests/layout-*.test.ts`, `tests/v2-layout-*.test.ts` (all files matching).
- AC-STE-56.6: Ripgrep gate: `rg -n '\.dpt-layout|layout\.ts|[Ll]ayout probe|versionGate' plugins/ specs/` returns zero matches, excluding `CHANGELOG.md` + archived FR files.
- AC-STE-56.7: Docs updated to drop the probe-based versioning story:
  - `docs/v2-layout-reference.md` — probe/version sections removed (rewrite or delete depending on remaining content)
  - `docs/patterns.md` — version-gate pattern removed
  - `docs/sdd-methodology.md` — layout-probe narrative removed
  - `docs/skill-anatomy.md` — probe step removed from canonical skill structure
  - `docs/adaptation-guide.md` — any probe references removed

## Technical Design

Subtractive. The probe/gate mechanism exists to distinguish v1 from v2 at skill entry; with v1 non-existent (FR-C1), the branch is dead. Each skill's step 0 collapses from "probe layout → branch on version → run v2 path" to "run v2 path" unconditionally.

No new code. No new logic.

## Testing

Existing skill tests that don't assert probe behavior continue to pass. Tests that do assert probe behavior are deleted (they validated removed code).

## Notes

Dependency: lands AFTER FR-C1. Running FR-C2 first would still leave the migrator writing `.dpt-layout` on completion in any intermediate state.

Brainstorm deferred decision #3 resolved here: **full delete** chosen; forward-compat v3 guard is speculative and not added.

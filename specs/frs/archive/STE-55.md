---
id: fr_01KPWH1CMPXN1JSN9XDVNTFEKM
title: Delete v1→v2 migrator; keep mode transitions only
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-55
created_at: 2026-04-23T06:40:46.000Z
---

## Requirement

The plugin has no consumers outside this repo. The v1→v2 migrator (shipped in M13 under FR-47/48) exists to migrate pre-existing v1-layout projects to v2. No such projects exist. The migrator module, `/setup`'s migration branch, `docs/setup-migrate.md`, and all migration-specific tests are dead weight. Delete them. Retain `mode: none ↔ tracker` transitions in `/setup` — those cover live-user scenarios.

## Acceptance Criteria

- AC-STE-55.1: `plugins/dev-process-toolkit/adapters/_shared/src/migrate/` directory is removed — every `.ts` and `.test.ts` under it deleted.
- AC-STE-55.2: `skills/setup/SKILL.md`: the v1→v2 migration branch (triggered when the layout probe detects v1 or sees no marker + `specs/requirements.md` present) is removed. Mode-transition prose (`mode: none ↔ tracker`) is retained unchanged.
- AC-STE-55.3: `docs/setup-migrate.md` is deleted.
- AC-STE-55.4: Migration-related tests deleted:
  - `tests/setup-migrate-*.test.ts` (all files matching)
  - `tests/v2-migration-*.test.ts` if present
  - `adapters/_shared/src/migrate/*.test.ts` (covered by AC-STE-55.1)
- AC-STE-55.5: Docs updated to remove v1→v2 migration references:
  - `docs/adaptation-guide.md` — "Migration from v1" content removed
  - `docs/patterns.md` — v1→v2 migration pattern removed; FR-47 archival pattern retained (different concern)
  - `docs/sdd-methodology.md` — v1→v2 narrative replaced with "v2 is the baseline"
  - `docs/v2-layout-reference.md` — migration-specific sections removed (full doc may survive if non-migration content remains; decide during implementation)
- AC-STE-55.6: Ripgrep gate: `rg -n 'v1→v2|v1->v2|migrate/index|setup-migrate|migrateV1ToV2' plugins/` returns zero matches, excluding `CHANGELOG.md` entries and archived FR files under `specs/frs/archive/`.
- AC-STE-55.7: `/setup`'s mode-transition tests (`tests/setup-mode-*.test.ts` or equivalent) continue to pass unchanged.

## Technical Design

Subtractive. The `migrate/` directory is a self-contained module; deletion is clean. `/setup`'s SKILL.md has three branches: (1) v1 detected → migrator, (2) no layout + no v1 → fresh v2 install, (3) v2 present → mode/config edit. After this FR, branch (1) is removed. Branch (2) simplifies further under FR-C2 (layout-probe removal) since the "detect layout" step itself goes away.

No new code. Pure deletion + doc edits.

## Testing

Ripgrep gate (AC-STE-55.6) verifies deletion completeness. `/setup`'s remaining test suite passes without modification.

## Notes

Dependency: FR-C1 lands before FR-C2. The migrator writes `specs/.dpt-layout` at completion; deleting the migrator first means no new marker files get created, and FR-C2 then cleans up the existing marker and its probe.

FR-C1 does not touch `specs/.dpt-layout` directly — that's FR-C2's scope.

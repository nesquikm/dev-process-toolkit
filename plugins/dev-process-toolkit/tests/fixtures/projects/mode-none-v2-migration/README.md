# Fixture: mode-none-v2-migration

A v2-layout project in `mode: none`. Used by the Pattern 9 byte-diff
regression gate (`tests/scripts/verify-regression.ts`) to lock that every
mode-aware skill's behavior on a `mode: none` + v2-layout project stays
byte-identical across releases.

## Invariants locked here

- `CLAUDE.md` has **no** `## Task Tracking` section → Schema L probe reports `mode=none` (AC-29.5 canonical form)
- FRs live under `specs/frs/<ulid>.md` (not monolithic `requirements.md`)
- `specs/plan/M<N>.md` per milestone (not monolithic `plan.md`)
- No `specs/frs/archive/` subdirectory (fixture has no archived FRs)

## What this widens

Pattern 9 regression gate coverage. Before this fixture the gate covered
`mode: none` via the `mode-none-baseline`, `mode-none-flutter`, and
`mode-none-archived` fixtures. This fixture extends the invariant to v2
spec layouts — so a future skill edit that accidentally changes behavior
when the layout is v2 but tracker mode is `none` gets caught by byte-diff.

# Fixture: mode-none-v2-migration

A v2-layout project in `mode: none` — the shape that surfaces FR-56 (the
dogfooding-session finding that `/setup --migrate` detection excluded the
`mode: none → <tracker>` transition on v2 projects).

## Invariants locked here

- `CLAUDE.md` has **no** `## Task Tracking` section → Schema L probe reports `mode=none` (AC-29.5 canonical form)
- `specs/.dpt-layout` reports `version: v2`
- FRs live under `specs/frs/<ulid>.md` (not monolithic `requirements.md`)
- `specs/plan/M<N>.md` per milestone (not monolithic `plan.md`)
- No `specs/frs/archive/` subdirectory (fixture has no archived FRs)

## What this widens

Pattern 9 regression gate coverage. The Pattern 9 invariant is "every
mode-aware skill's behavior on a `mode: none` project is byte-identical to
pre-M12." Before this fixture the gate covered `mode: none` on v1 layout
(`mode-none-baseline`, `mode-none-flutter`, `mode-none-archived`). This
fixture extends the invariant to v2-layout `mode: none` projects — so a
future skill edit that accidentally changes behavior when the layout is v2
but tracker mode is `none` gets caught by byte-diff.

## FR-56 testing surface

FR-56's AC-56.3 requires a fixture with this shape. Static SKILL.md-content
assertions (under `tests/setup-migration-detection.test.ts`) lock the
routing-rule text that would correctly route `/setup --migrate` on this
fixture into tracker-mode migration (not fresh-setup). The fixture itself
is the existential evidence — when the routing rule is followed by an LLM
reading SKILL.md, this fixture is the shape it'll see and must handle.

# mode-none-baseline fixture

Minimal downstream-project fixture used to capture the pre-M12 `mode: none`
baseline snapshot (`tests/fixtures/baselines/m1-m11-regression.snapshot`).
Phase H Task 1 byte-diffs a fresh capture against the committed snapshot —
any delta is stop-ship per Pattern 9.

## What this fixture is

- A plain project with `CLAUDE.md` + `specs/` that does **not** contain a
  `## Task Tracking` section. Every mode-aware skill must behave as if
  `mode: none` — identical to pre-M12.
- Deliberately stable: no timestamps, no UUIDs, no tracker references.
  The capture script runs `find` + `shasum` over the file bytes only.

## Scope

Pattern 9 protects file-state determinism. What is captured:

- `CLAUDE.md` (absence of `## Task Tracking`).
- `specs/plan.md`, `specs/requirements.md`, `specs/technical-spec.md`,
  `specs/testing-spec.md`, `specs/archive/index.md`.

What is **not** captured:

- Skill rendered output (LLM-driven, non-deterministic).
- Tool invocation order, terminal colors.
- Helper-script stdout (Tier 4 unit tests handle that).

See `docs/tracker-adapters.md` § Conformance Checklist for the Tier 5
manual flow that complements this Pattern-9 byte-diff.

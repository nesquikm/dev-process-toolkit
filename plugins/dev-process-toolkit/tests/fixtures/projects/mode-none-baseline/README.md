# mode-none-baseline fixture

Minimal downstream-project fixture used by `tests/scripts/verify-regression.test.ts`
to exercise the live Schema L probe against a known-good `mode: none` shape
(no `## Task Tracking` section). The pre-M18 v2-minimal byte-diff snapshot
loop was retired in M39 STE-141.

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

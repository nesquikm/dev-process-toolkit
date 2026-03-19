---
description: Run the project gate checks and report results. Use after completing any feature, before creating a PR, or to verify project health.
argument-hint: '[--fix to auto-fix lint issues]'
---

# Gate Check

Run the project's gating checks and report a clear pass/fail for each.

## Commands

Read the project's CLAUDE.md to find the gate check commands (look for "Key Commands" or "Gating rule" section). If no CLAUDE.md exists, ask the user what commands to run.

Typical commands by stack (use as fallback if CLAUDE.md doesn't specify):
<!-- ADAPT: If copying this skill manually, replace with your project's commands -->
1. Run typecheck: `npm run typecheck` (or `fvm flutter analyze`, `mypy .`, etc.)
2. Run lint: `npm run lint $ARGUMENTS` (if `$ARGUMENTS` contains `--fix`, add `-- --fix`)
3. Run tests: `npm run test` (or `fvm flutter test`, `pytest`, etc.)
4. Run build: `npm run build` (optional — include if your project has a build step)

## Reporting

For each step:

- If it passes, report ✓ with a one-line summary
- If it fails, report ✗ with the specific errors (include file:line references)

At the end, give a clear verdict: **GATE PASSED** or **GATE FAILED** with what needs fixing.

## Rules

- This is a **deterministic kill switch** — if it fails, the gate fails. Period.
- Do NOT let judgment override a failing gate
- Do NOT skip any step

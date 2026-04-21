---
name: gate-check
description: Run the project gate checks and report results. Use after completing any feature, before creating a PR, or to verify project health.
argument-hint: '[--fix to auto-fix lint issues]'
---

# Gate Check

Run the project's gating checks and report a clear pass/fail for each.

## Layout + Tracker Mode Probes

Before running any commands:

- **Layout probe** — Read `specs/.dpt-layout` via `bun run adapters/_shared/src/layout.ts`. If `version: v2`, run the v2 conformance probes below in addition to the standard gate checks. If marker absent, run v1 behavior unchanged. If version > v2, exit with the canonical message (AC-47.3).
- **Tracker Mode Probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker-mode hooks skip. If a tracker mode is active:
  - Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` (FR-32). Decline exits cleanly with zero side effects (AC-32.4).
  - Re-fetch the ticket's `updatedAt` and warn on mismatch against the value recorded at `/implement` start (AC-33.3); do NOT run FR-39 resolution here (AC-39.10).
  - On gate pass, push the AC toggle via the active adapter's `push_ac_toggle` (capability permitting; FR-38 AC-38.6 degrades with a canonical-shape warning otherwise).
  See `docs/gate-check-tracker-mode.md` for the full tracker-mode flow.

## v2 Conformance Probes (AC-49.5, NFR-15)

When the layout probe reports `v2`, run these deterministic probes in addition to the normal gate:

1. **Filename ↔ `id:` equality** — for every `specs/frs/**/*.md`, parse the YAML frontmatter and verify `id == filename_stem` byte-for-byte. Mismatch → **GATE FAILED** naming the offending file (AC-41.2, AC-41.5).
2. **ULID filename regex** — every active/archived FR filename must match `^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$` (AC-41.1). Non-matching filename → **GATE FAILED**.
3. **Required frontmatter fields** — every FR file must have `id`, `title`, `milestone`, `status`, `archived_at`, `tracker`, `created_at` present. Missing a field → **GATE FAILED** naming the file and field.
4. **Layout version match** — `.dpt-layout` must report the expected version. Missing marker with `specs/requirements.md` present → **GATE FAILED** with the canonical pointer to `/setup --migrate` (AC-47.5).
5. **Stale lock scan** — list every `.dpt-locks/<ulid>` entry whose `branch` field names a merged-into-main or deleted branch. Each stale lock → **GATE PASSED WITH NOTES**. Offer `$ARGUMENTS --cleanup-stale-locks` action that deletes them in a single commit (AC-46.5).
6. **Plan post-freeze edit scan** — for each `specs/plan/<M#>.md` with `status: active` + non-null `frozen_at`, scan `git log --follow` for commits to that path authored after `frozen_at`. Each post-freeze commit → **GATE PASSED WITH NOTES** listing the SHA. No auto-revert — user decides (AC-44.4).

Full details: `docs/v2-layout-reference.md` § `/gate-check`.

## Commands

Read the project's CLAUDE.md to find the gate check commands (look for "Key Commands" or "Gating rule" section). If no CLAUDE.md exists, ask the user what commands to run.

Typical commands by stack (use as fallback if CLAUDE.md doesn't specify):
1. Run typecheck: `npm run typecheck` (or `fvm flutter analyze`, `mypy .`, etc.)
2. Run lint: `npm run lint $ARGUMENTS` (if `$ARGUMENTS` contains `--fix`, add `-- --fix`)
3. Run tests: `npm run test` (or `fvm flutter test`, `pytest`, etc.)
4. Run build: `npm run build` (optional — include if your project has a build step)
5. Run security audit (optional): `npm audit` (or `pip-audit`, `cargo audit`, `flutter pub audit`). Flag known vulnerabilities. This step is advisory — failures here produce NOTES, not GATE FAILED, unless your project explicitly gates on audit.

## Reporting

For each step:

- If it passes, report ✓ with the actual output summary (e.g., "✓ Tests: 47 passed, 0 failed")
- If it fails, report ✗ with the specific errors (include file:line references)

**Cite actual output numbers** — do not report GATE PASSED from memory of a previous run. Run each command fresh and read the result.

If a failure cause is unclear after reading the error output, use `/dev-process-toolkit:debug` for structured investigation.

## Code Review

After all commands pass, review the **changed code**. Use `git diff` against the base branch (e.g., `git diff main...HEAD`) if on a feature branch, or `git diff HEAD~1` if on the main branch. If there are uncommitted changes, include `git diff` (unstaged) and `git diff --cached` (staged) as well. Your job here is to find problems, not to praise the work. Approach this as if reviewing someone else's code — look for what's wrong, not what's right.

Use the canonical review rubric in `agents/code-reviewer.md` as the source of truth for criteria (quality, security, patterns, stack-specific). **Run the review inline** — gate-check must return a verdict in one turn, so do not delegate to the `code-reviewer` subagent from here. Also check spec compliance: every AC has a corresponding test, and no undocumented behavior has been added (security and spec-compliance concerns are the only critical criteria in gate-check; other concerns are non-critical).

For each criterion, report: **OK** or **CONCERN** with specifics. Use the exact shape documented at the bottom of `agents/code-reviewer.md` (`<criterion> — OK` or `<criterion> — CONCERN: file:line — <reason>`).

## Drift Check

> Never read specs/archive/ — only live spec files count for drift detection.

If `specs/` directory exists, check whether the implementation has drifted from the spec:

1. Read `specs/requirements.md` and extract all ACs
2. For each AC, search the codebase for implementing code and tests
3. Build a traceability table:

| AC ID | Status | Location |
|-------|--------|----------|
| AC-1.1 | implemented | src/feature.ts:42 |
| AC-1.2 | not found | — |
| AC-2.1 | implemented | src/service.ts:15 |

- **implemented** — code and/or tests found matching the AC
- **not found** — no implementing code found
- **no AC** — code exists in changed files with no corresponding spec AC (`potential drift`)

If `specs/` directory does not exist, skip this section silently.

Drift findings do NOT cause GATE FAILED. They appear under GATE PASSED WITH NOTES as informational items for the developer to review.

## Verdict

Combine command results + code review into a final verdict:

- **GATE PASSED** — all commands pass AND no concerns in code review
- **GATE PASSED WITH NOTES** — all commands pass but code review found non-critical concerns or drift check found spec-implementation gaps (list them). These are things the user should be aware of but that don't block merging.
- **GATE FAILED** — any command failed OR code review found critical concerns (spec compliance or security issues)

Always state what needs fixing if not a clean pass.

## Structured Output

Optionally produce a JSON summary alongside the Markdown report. This enables CI pipelines to parse gate results programmatically.

````json
{
  "steps": [
    { "step": "typecheck", "status": "pass", "summary": "No type errors" },
    { "step": "lint", "status": "pass", "summary": "0 warnings" },
    { "step": "test", "status": "pass", "summary": "47 passed, 0 failed" },
    { "step": "build", "status": "pass", "summary": "Build succeeded" },
    { "step": "security-audit", "status": "pass", "summary": "0 vulnerabilities" },
    { "step": "code-review", "status": "pass", "summary": "No critical concerns" },
    { "step": "drift-check", "status": "notes", "summary": "2 ACs not found" }
  ],
  "verdict": "GATE PASSED WITH NOTES"
}
````

The `verdict` field uses one of: `GATE PASSED`, `GATE PASSED WITH NOTES`, `GATE FAILED`.

## Rules

- The **commands** (typecheck, lint, tests, build) are the **deterministic kill switch** — if any command fails, it's GATE FAILED. Period. No judgment can override a failing command.
- The **code review** is an additional advisory layer — it can elevate GATE PASSED to GATE PASSED WITH NOTES (non-critical) or GATE FAILED (critical: security or spec violations). But it cannot downgrade a failing command to a pass.
- Do NOT skip any step — run all commands AND the code review
- Do NOT report GATE PASSED without running commands fresh this session

## Red Flags

If you hear yourself thinking any of these, stop and run the gate anyway:

- "I'll run gate-check after the next task" → run it now
- "I know the tests pass" → run them and read the actual output
- "It should work now" → "should" is not a gate result
- "Just this once I'll skip it" → there is no just this once

### Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| Should work now | Run the verification |
| I'm confident | Confidence ≠ evidence |
| Just this once | No exceptions |
| Linter passed | Linter ≠ compiler / tests |
| Agent said success | Verify independently |
| Partial check is enough | Partial proves nothing |

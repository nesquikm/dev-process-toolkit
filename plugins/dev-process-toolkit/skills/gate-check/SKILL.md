---
name: gate-check
description: Run the project gate checks and report results. Use after completing any feature, before creating a PR, or to verify project health.
argument-hint: '[--fix to auto-fix lint issues]'
---

# Gate Check

Run the project's gating checks and report a clear pass/fail for each.

## Layout + Tracker Mode Probes

Before running any commands:

- **Tracker Mode Probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker-mode hooks skip. If a tracker mode is active:
  - Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` (STE-27). Decline exits cleanly with zero side effects (AC-STE-27.4).
  - Re-fetch the ticket's `updatedAt` and warn on mismatch against the value recorded at `/implement` start (AC-STE-11.3); do NOT run STE-17 resolution here (AC-STE-17.10).
  - On gate pass, push the AC toggle via the active adapter's `push_ac_toggle` (capability permitting; STE-16 AC-STE-16.6 degrades with a canonical-shape warning otherwise).
  See `docs/gate-check-tracker-mode.md` for the full tracker-mode flow.

## v2 Conformance Probes (AC-STE-24.5, NFR-15)

Run these deterministic v2 invariant probes in addition to the normal gate:

1. **Filename ↔ frontmatter convention (M18 STE-61 AC-STE-61.5, strict)** — for every `specs/frs/**/*.md`, resolve `Provider` once (same rule as `/implement`), parse the YAML frontmatter, and compute the expected base name via `Provider.filenameFor(spec)`. Strict byte-for-byte comparison: any filename that does not match → **GATE FAILED** naming the file, the actual basename, and the expected name. Legacy `fr_<ULID>.md` filenames fail this gate (STE-61 completed the one-time rewrite in v1.21.0). Supersedes the pre-M18 filename ↔ `id:` equality assertion (M13 AC-STE-18.2 / AC-STE-18.5) and the pre-M18 ULID filename regex.
2. **Required frontmatter fields** — every FR file must have `id`, `title`, `milestone`, `status`, `archived_at`, `tracker`, `created_at` present. Missing a field → **GATE FAILED** naming the file and field.
3. **Stale lock scan** — list every `.dpt-locks/<ulid>` entry whose `branch` field names a merged-into-main or deleted branch. Each stale lock → **GATE PASSED WITH NOTES**. Offer `$ARGUMENTS --cleanup-stale-locks` action that deletes them in a single commit (AC-STE-28.5).
4. **Plan post-freeze edit scan** — for each `specs/plan/<M#>.md` with `status: active` + non-null `frozen_at`, scan `git log --follow` for commits to that path authored after `frozen_at`. Each post-freeze commit → **GATE PASSED WITH NOTES** listing the SHA. No auto-revert — user decides (AC-STE-21.4).
5. **Stale release marker scan** (STE-41 AC-STE-41.5) — grep `specs/requirements.md` for markers of the form `(in flight — v<X.Y.Z>)` or `(planned — v<X.Y.Z>)`. For each captured version, check whether `CHANGELOG.md` already contains a `## [X.Y.Z]` header (i.e., that version has shipped). Every match where the CHANGELOG says shipped → **GATE PASSED WITH NOTES** listing the stale marker + its line number + the shipped release so the operator can rewrite the overview to past-tense. Warn-only, never **GATE FAILED** — prose drift shouldn't block the gate.
6. **Per-milestone heading strip** (STE-42 AC-STE-42.6) — grep `specs/technical-spec.md` and `specs/testing-spec.md` for `^#{1,3} M\d+` (matches `# M<N>:`, `## <N>. M<N> — …`, or any other milestone-framed heading). Any match → **GATE FAILED** naming the file and line with a pointer to AC-STE-26.3 (post-migration cross-cutting files must carry zero per-milestone headings). Per-FR design / per-milestone narrative belongs in `specs/frs/<name>.md` or `specs/plan/<M#>.md`, not in the cross-cutting spec files.
7. **Duplicate AC-prefix scan** (STE-50 AC-STE-50.5) — call `acLint(specsDir)` from `adapters/_shared/src/ac_lint.ts`. It walks every active `specs/frs/*.md` (excluding `archive/`), extracts each file's `## Acceptance Criteria` section, and counts `AC-<prefix>.<N>` occurrences per file. Any count > 1 → **GATE FAILED** naming the file + `AC-<prefix>.<N>` pair + occurrence count. The `<prefix>` is tracker-mode-aware (tracker ID or short-ULID tail per STE-50), so both prefix shapes are checked by the same probe.
8. **Ticket-state drift** (STE-54 AC-STE-54.3) — for every FR file under `specs/frs/archive/` whose frontmatter has `status: archived` and a non-null `tracker.<key>` binding, resolve `Provider` once (same rule as `/implement`) and call `Provider.getTicketStatus(<tracker-ref>)`. Assert the returned `status` matches the adapter's `status_mapping.done` canonical name. Every drifted ticket → **GATE FAILED** reporting a row with the FR's **ULID** + **tracker ID** (e.g. `linear:STE-53`) + **observed** vs. **expected** state so the operator can manually transition or rerun `/implement`. **Skipped for `mode: none`** — `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel and there's nothing to compare. The check catches the regression where `/implement` Phase 4 lands a commit + archives FRs but drops `releaseLock`, stranding the tracker at `In Progress` after the commit — STE-54's instruction-level fixes harden the write path, and this probe is the read-side backstop.
9. **Root spec hygiene** (STE-59 AC-STE-59.5) — call `runRootHygiene(specsDir, pluginJsonPath)` from `adapters/_shared/src/root_hygiene.ts`. It runs two sub-checks on the three root spec files (`specs/requirements.md`, `specs/technical-spec.md`, `specs/testing-spec.md`):
    - **(a) Milestone-ID leakage** — scans for `\bM\d+\b` tokens, walks up to the containing `##`/`###` heading, skips matches under the allowlist (`Shipped milestones` / `Archived context` / `Shipped releases` / `Release notes` / `Release history`), then reports any remaining match that resolves to an existing `specs/plan/archive/M<N>.md`. Each hit → **GATE FAILED** with `<file>:<line>: archived milestone M<N> in live-framing (heading "<title>")`.
    - **(b) Version/status freshness** — reads `plugin.json` `version`; parses `requirements.md` §1 Overview for `Latest shipped release: vX.Y.Z` and optional `In-flight milestone: M<N>` lines. Declared version must match `plugin.json`; in-flight milestone (if named) must resolve to a live `specs/plan/M<N>.md`, not the archive. Each drift → **GATE FAILED** naming the specific line + observed vs. expected value.

    Enforces the "root specs stay shape-only, current-only" invariant documented in `docs/patterns.md` § Root Spec Hygiene.

10. **CLAUDE.md.template branch_template: hygiene** (STE-64 AC-STE-64.12) — grep `plugins/dev-process-toolkit/templates/CLAUDE.md.template` for the literal substring `branch_template:`. Zero matches → **GATE FAILED** with the standard hygiene-gate error shape, pointing to the template file and asking the operator to re-add the key documentation. This gate protects `/setup` step 7c's seeded-key contract: if the template silently loses its `branch_template:` documentation, downstream projects generated by `/setup` will have branch automation silently disabled even when the user wants it (AC-STE-64.1 backward-compat reading is "absent ⇒ disabled" — the template's job is to advertise the key so users know it exists).
11. **Tracker-mode ULID prose hygiene** (STE-67 AC-STE-67.6) — **tracker mode only** (skipped when `mode: none`). Grep `specs/plan/*.md` (active only, excluding `archive/`), the current release section of `CHANGELOG.md` (content after the topmost `## [X.Y.Z]` heading and before the next `## [` heading), and `README.md` for the pattern `fr_[0-9A-HJKMNP-TV-Z]{26}` (the full ULID regex). Each hit → **GATE PASSED WITH NOTES** listing `<file>:<line>` so the operator can rewrite the prose to use the tracker ID instead. Warn-only, **never** GATE FAILED — pre-existing content shouldn't block merges. Skipped entirely in `mode: none` (the full 26-char ULID does not appear in user-facing prose there either — the short-ULID tail is the human-facing form — but the probe is tracker-mode-scoped to avoid any risk of false-positive chatter on projects that hand-wrote ULIDs into historical docs).

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

> Never read `specs/frs/archive/` or `specs/plan/archive/` — only live spec files count for drift detection.

If `specs/` directory exists, check whether the implementation has drifted from the spec:

1. Read `specs/requirements.md` and extract all ACs
2. For each AC, search the codebase for implementing code and tests
3. Build a traceability table:

| AC ID | Status | Location |
|-------|--------|----------|
| AC-STE-42.1 | implemented | src/feature.ts:42 |
| AC-STE-42.2 | not found | — |
| AC-STE-43.1 | implemented | src/service.ts:15 |

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

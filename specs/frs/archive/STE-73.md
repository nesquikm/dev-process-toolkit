---
title: /ship-milestone skill — formalize Release Checklist + invoke /docs --commit --full
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-73
created_at: 2026-04-23T15:05:00Z
---

## Requirement

The Release Checklist in `CLAUDE.md` currently prescribes a manual 4-step ceremony for every milestone close: bump version in `plugin.json`, bump in `marketplace.json`, add CHANGELOG entry, update README's "Latest:" line + counts. The checklist explicitly warns "missing any of them is a release bug." This ceremony is error-prone (partial updates ship), un-dogfooded (the toolkit prescribes discipline it doesn't enforce on its own releases), and has no obvious hook for the new M20 docs-regeneration step.

STE-73 introduces `/ship-milestone` — a new skill that bundles the Release Checklist as one atomic, human-approved action. The skill:

1. Reads the target milestone from `specs/plan/M<N>.md` (or takes `M<N>` as an arg).
2. Constructs proposed changes: version bump across all 4 checklist files; CHANGELOG entry summarizing the milestone's shipped FRs (with tracker cross-refs); README "Latest:" line + any structure counts that changed.
3. Invokes `/docs --commit --full` internally to merge any pending fragments and regenerate canonical docs reflecting the milestone's cumulative surface change.
4. Shows a unified diff of *every* modified file and requires explicit human approval before creating the release commit.
5. On approval: stages + commits with the conventional release message; **does not push** (push remains a user action — preserves the "human approval before commit" principle AND the "shared-state actions require confirmation" principle).

The `changelog_ci_owned: true` flag from STE-68 skips the CHANGELOG write step (CI owns it). All other steps run regardless of docs configuration; a repo with no docs-modes enabled gets the release ceremony minus the `/docs` step.

## Acceptance Criteria

- AC-STE-73.1: New skill at `plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md`. Discoverable as `dev-process-toolkit:ship-milestone` via Claude Code's skill-discovery convention — the plugin name (`dev-process-toolkit`) comes from `plugin.json` `name:`, and the skill name (`ship-milestone`) comes from the skill directory + its SKILL.md frontmatter `name:`. No explicit `skills` array is added to `plugin.json` — Claude Code discovers skills by filesystem walk, matching every other skill in this plugin (`implement`, `docs`, `gate-check`, etc.). Invocation: `/ship-milestone M<N>` or `/ship-milestone` (no-arg picks the most recent in-progress milestone — the one whose `specs/plan/M<N>.md` has `status: active` or absent frozen_at).
- AC-STE-73.2: Reads target milestone's FR list from `specs/plan/M<N>.md`. For each FR: fetch title, tracker ref, final status (archived = shipped, active = not shipped). Milestone close refuses if any FR in the plan is not yet archived (AC-STE-73.8).
- AC-STE-73.3: Constructs the release version by reading current `version` in `plugins/dev-process-toolkit/.claude-plugin/plugin.json` and bumping per semver inference: major FRs (any FR flagged `breaking: true` in frontmatter) → major bump; any non-archival FR → minor bump; patch-only milestones → patch bump. Default is minor (matches M12–M19 history). User can override with `--version X.Y.Z`.
- AC-STE-73.4: Executes the Release Checklist in order, constructing proposed file contents:
  1. `plugins/dev-process-toolkit/.claude-plugin/plugin.json` — `version` field updated.
  2. `.claude-plugin/marketplace.json` — matching `version` in the plugin entry.
  3. `CHANGELOG.md` — new `## [X.Y.Z] — YYYY-MM-DD — "<Codename>"` section at top, with `### Added` / `### Changed` / `### Removed` / `### Fixed` subsections populated from FR titles + optional manual summary. **Skipped if `changelog_ci_owned: true`** (from STE-68); instead, a comment block is printed reminding the user to ensure CI will run.
  4. `README.md` — "Latest:" line updated; any structure counts (skills, patterns, etc.) recomputed from current filesystem.
- AC-STE-73.5: After file-content construction, invokes `/docs --commit --full` internally. If docs are disabled (both modes false in `## Docs`), this step is skipped with log message `docs disabled — skipping /docs --commit --full`. If enabled but the `/docs` invocation fails, `/ship-milestone` aborts with NFR-10:

  ```
  /ship-milestone: /docs --commit --full failed; cannot proceed with release.
  Remedy: fix the underlying /docs failure (see its stderr), then re-run /ship-milestone. Partial release (release commit without doc updates) is not supported.
  Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
  ```

- AC-STE-73.6: Shows a single unified diff of ALL modified files (4 release-checklist files + any docs/ files touched by /docs --commit --full) and requires explicit approval (`y` / `yes`). On approval: `git add` the files + `git commit` with message:

  ```
  M<N>: v<X.Y.Z> "<Codename>" — <one-line summary>
  ```

  where `<one-line summary>` is user-provided via `--summary "<text>"` or prompted interactively. Does NOT run `git push`.
- AC-STE-73.7: On refusal (any response other than `y` / `yes`): no staging, no commit, any temp files deleted, exits 0 with message `ship-milestone declined; release not committed. To retry, re-run /ship-milestone M<N>.`
- AC-STE-73.8: Refuses to run if ANY FR in `specs/plan/M<N>.md` has `status: active` (not yet archived by `/implement` Phase 4). NFR-10:

  ```
  /ship-milestone: milestone M<N> has <count> unshipped FR(s): <list>.
  Remedy: finish each FR via /implement (which archives on success), or move the unfinished FR to a later milestone's plan, then re-run /ship-milestone.
  Context: milestone=M<N>, unshipped=<count>, skill=ship-milestone
  ```

- AC-STE-73.9: Refuses if working tree has uncommitted changes outside the expected-modified set (the 4 release files + `docs/` subtree). User's unrelated in-progress work is never collateral to a release commit. NFR-10 shape.
- AC-STE-73.10: Prompts for codename via `Enter milestone codename (short, memorable — e.g., "Diátaxis"): ` if not passed via `--codename "<name>"`. Validates: non-empty, ≤32 chars, no backticks or newlines. Re-prompt on invalid.
- AC-STE-73.11: After successful commit, prints a post-ship checklist:

  ```
  M<N> shipped as v<X.Y.Z> "<Codename>".
  Next steps (not automated):
    1. git push  (when ready)
    2. /pr  (open release PR if this is a branch-based flow)
    3. Update any external references (tracker milestone close, announcement)
  ```

- AC-STE-73.12: Generated CHANGELOG entry closes with the line `Total test count at release: <N> tests, <F> failures, <E> errors.` where `<N>`, `<F>`, `<E>` come from running the project's test gate at ship time (stack-inferred command — `bun test` for this plugin, `fvm flutter test` for Flutter, `pytest` for Python, etc., reading the project's `gate-commands.md` if present). Skipped entirely when `changelog_ci_owned: true` (STE-68) — CI owns the CHANGELOG in that case. Test failures > 0 surface as NFR-10 refusal:

  ```
  /ship-milestone: cannot tag release with <F> test failure(s).
  Remedy: fix failing tests, then re-run /ship-milestone. The CHANGELOG closing line reports `<N> tests, <F> failures, <E> errors` — a non-zero F blocks release.
  Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
  ```

  Convention established by M22's STE-78 for v1.22.0 (AC-STE-78.8); STE-73 ensures every subsequent release carries the line consistently. Line sits below all `### Added / ### Changed / ### Removed / ### Fixed` subsections as the final line of the release entry, before the horizontal rule separating from the previous release.

## Technical Design

**Skill file:** `plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md`. Stays within NFR-1 300-line budget; detailed reference (CHANGELOG subsection policy, version-bump semver rules, structure-count computation recipes) overflows to `plugins/dev-process-toolkit/docs/ship-milestone-reference.md`.

**Version bump logic:** Lives in a new helper `adapters/_shared/src/version_bump.ts`:

```typescript
export interface BumpContext {
  currentVersion: string;        // semver from plugin.json
  frs: FrSummary[];              // active + archived in the milestone
  override?: string;             // --version flag
}

export function inferBump(ctx: BumpContext): { version: string; rationale: string };
```

Rationale returned for diff explanation ("minor bump: milestone shipped N additive FRs"; "major bump: FR `<STE-X>` marked breaking").

**CHANGELOG entry construction:** Reads FR frontmatter `changelog_category` field (new; default `Added`) to group entries. FR titles become bullet points. Cross-refs rendered as `(STE-X)`. User can edit the entry pre-approval by writing `e` at the approval prompt — opens `$EDITOR` on the proposed entry.

**README structure-count refresh:** Walks skills/, patterns in docs/, agents/ directories and emits current counts; substitutes into README's `## Structure` block. Refuses if the block's shape has changed (a human touched the block manually — surface NFR-10 asking the user to re-confirm).

**Internal `/docs --commit --full` invocation:** `/ship-milestone` does not reimplement docs logic — it calls into the `/docs` skill's flow directly (shared module or subprocess). Any approval prompt from `/docs` is merged into `/ship-milestone`'s single approval step — user sees one diff covering everything.

**Test-gate invocation for AC-STE-73.12:** Runs the project's test command once, parses output for `<N> tests, <F> failures, <E> errors` (stack-specific parsers; `bun test` emits `N pass / F fail`, pytest emits `N passed, F failed`, etc.). Failed-test count blocks the release before any approval prompt. Parser lives at `adapters/_shared/src/test_count_parser.ts` with a dispatch table keyed by detected stack. Missing/unrecognized test output falls back to "could not determine test count" — surfaces NFR-10 asking the user to specify or skip the line.

## Testing

Fixture repo at `tests/fixtures/projects/ship-milestone-happy/` with:
- A completed milestone (all FRs archived) in `specs/plan/M<N>.md`.
- Current versions across the 4 checklist files.
- A seeded `docs/` tree with pending fragments.

Integration tests assert: correct version bump, correct CHANGELOG entry structure, correct README "Latest:" line, docs/ regenerated, commit created with correct message, no push.

Negative fixtures: milestone with unshipped FR (AC-STE-73.8), dirty working tree (AC-STE-73.9), `/docs` failure (AC-STE-73.5 abort), failing tests (AC-STE-73.12 refusal with `<F> test failure(s)` message), `changelog_ci_owned: true` (AC-STE-73.12 line suppressed).

New unit tests for `test_count_parser.ts`: bun-format output, pytest-format output, flutter-format output, malformed/unrecognized output → NFR-10 fallback.

## Notes

**Why not auto-push.** "Shared-state actions require user confirmation" (core principle in the CLAUDE.md preamble). Pushing publishes the release — reversibility is much harder than reverting a local commit. The user remains the one to push, always.

**Why `changelog_ci_owned: true` skips, rather than warns-and-writes.** If CI owns the CHANGELOG (e.g., release-please, conventional-commits automation), an extra write from this skill creates a merge conflict or overrides CI's logic. Skipping is safe; the release commit just doesn't touch CHANGELOG, and CI runs post-push.

**Interaction with STE-75 (`/implement M<N>` prompt).** STE-75 offers to chain into `/ship-milestone` at the end of a milestone-scope `/implement` run. That flow passes through `/ship-milestone`'s standard AC-STE-73.6 approval gate — chaining is not a bypass. Human sees and approves the release commit diff even when called via chain.

**Branch hygiene.** `/ship-milestone` does not create branches, merge branches, or push. The existing branch-automation work from STE-64 (M19) is compatible: if the user is on a release-ready branch (conventional name), `/ship-milestone` commits there. If on a weird branch, `/ship-milestone` commits there too — the skill does not police branch names (that's `/setup`'s / `/implement`'s job at kickoff time).

**Release target:** v1.23.0. Phase C of M20 plan (depends on STE-70).

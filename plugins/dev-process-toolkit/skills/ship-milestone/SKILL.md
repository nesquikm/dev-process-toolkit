---
name: ship-milestone
description: Bundle the Release Checklist + /docs --commit --full into one atomic, human-approved release commit. Reads specs/plan/M<N>.md, bumps the four release files, regenerates docs, prompts once for approval, commits on `y`, does not push.
argument-hint: '[M<N>] [--version X.Y.Z] [--codename "<name>"] [--summary "<text>"]'
---

# /ship-milestone

Ship one completed milestone as a single, reviewed release commit. Dogfoods the Release Checklist in `CLAUDE.md` so partial-update bugs (e.g., a release that forgets to bump the README "Latest:" line) cannot happen.

Detailed reference (CHANGELOG subsection policy, version-bump semver rules, structure-count recipes, stack-specific test-parser fallbacks) lives in `docs/ship-milestone-reference.md`.

## Invocation

- `/ship-milestone M<N>` — explicit milestone.
- `/ship-milestone` — no-arg form picks the **most recent in-progress milestone**: the `specs/plan/M<N>.md` with `status: active` (or with `frozen_at: null`). Refuse with NFR-10 if none qualifies.
- Optional flags: `--version X.Y.Z` (override inferred bump), `--codename "<name>"` (skip prompt), `--summary "<text>"` (commit one-liner, else prompted).

## Pre-flight refusals

Any of these fire before any file write and exit non-zero with an NFR-10-shape message:

1. **Unshipped FRs** (AC-STE-73.8). Walk `specs/plan/M<N>.md`; if any row links to an FR file whose frontmatter has `status: active` (not yet archived), **probe tracker state** per STE-83 and emit one of two remedy shapes.

   For each `status: active` FR, call `Provider.getTicketStatus(<tracker-ref>)`. Partition the unshipped set by whether the returned status equals the adapter's `status_mapping.done`:

   - **All unshipped FRs are tracker-Done-but-file-active** — every ticket already reached `status_mapping.done` (typical after per-FR `/implement <FR-id>` runs, which Done-transition each ticket in Phase 4 Close but leave `status: active` because milestone-scope archival is a separate step). Refuse with the `/spec-archive`-pointing remedy:

     ```
     /ship-milestone: milestone M<N> has <count> unshipped FR(s): <list>. All <count> tracker tickets are already at status_mapping.done — the file side still shows status: active because single-FR /implement runs intentionally skip milestone archival.
     Remedy: run /spec-archive M<N> to bulk-archive the file side (git mv + frontmatter flip for every FR + the plan file, one atomic commit), then re-run /ship-milestone.
     Context: milestone=M<N>, unshipped=<count>, skill=ship-milestone
     ```

   - **Any unshipped FR is genuinely unshipped** — at least one ticket is NOT at `status_mapping.done` (or the tracker returned anything other than Done). `mode: none` falls into this branch too: `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel, so it can never match `status_mapping.done`. Refuse with the existing remedy:

     ```
     /ship-milestone: milestone M<N> has <count> unshipped FR(s): <list>.
     Remedy: finish each FR via /implement, or move the unfinished FR to a later milestone's plan, then re-run /ship-milestone.
     Context: milestone=M<N>, unshipped=<count>, skill=ship-milestone
     ```

   Both shapes exit non-zero and preserve the `Context:` line byte-identically. See `docs/ship-milestone-reference.md` § Refusal #1 remedy shapes for the full decision matrix including mixed tracker-Done / not-Done sets (the "any genuinely unshipped" branch wins on mix — safer than misdirecting to `/spec-archive` when a ticket genuinely isn't done yet).

2. **Dirty working tree outside the expected set** (AC-STE-73.9). The expected-modified set is the four release files plus the `docs/` subtree (for the `/docs --commit --full` step). `git status --porcelain` lines outside that set ⇒ refuse:

   ```
   /ship-milestone: working tree has uncommitted changes outside the release files: <list>.
   Remedy: commit or stash unrelated changes, then re-run /ship-milestone. Release commits must not bundle unrelated work.
   Context: milestone=M<N>, unexpected=<count>, skill=ship-milestone
   ```

3. **Test gate red** (AC-STE-73.12). Run the project's test command once; if `<F>` failures > 0, refuse:

   ```
   /ship-milestone: cannot tag release with <F> test failure(s).
   Remedy: fix failing tests, then re-run /ship-milestone. The CHANGELOG closing line reports `<N> tests, <F> failures, <E> errors` — a non-zero F blocks release.
   Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
   ```

   Use the stack detector to pick bun / pytest / flutter parsers from `adapters/_shared/src/test_count_parser.ts`. Unrecognized output or unknown stack → NFR-10 asking the user to specify or skip the line.

## Flow

### 1. Resolve milestone + FR list (AC-STE-73.2)

Read `specs/plan/M<N>.md`. Extract every FR with a live tracker ID / ULID. For each, read `specs/frs/<name>.md` frontmatter and pull `title`, `tracker.<key>`, `breaking` (default `false`), `changelog_category` (default `Added`), and `status` (must be `archived` after the pre-flight refusal in step 8 above).

### 2. Infer version (AC-STE-73.3)

Call `inferBump({ currentVersion, frs, override })` from `adapters/_shared/src/version_bump.ts`. Rules:

- **major bump** when any FR frontmatter has `breaking: true`.
- **patch bump** when every FR's `changelog_category` is `Fixed` or `Removed` (pure fix-class milestone).
- **minor bump** otherwise — the default, matching M12–M19 history.
- `--version X.Y.Z` override wins and bypasses inference.

### 3. Prompt for codename (AC-STE-73.10)

If `--codename "<name>"` was passed, validate and use it. Otherwise prompt:

```
Enter milestone codename (short, memorable — e.g., "Diátaxis"):
```

Validate: non-empty, ≤ 32 chars, no backticks, no newlines. Re-prompt on invalid until the user provides a valid value or aborts.

### 4. Construct release-file changes (AC-STE-73.4)

Build proposed file contents in this exact order:

1. **`plugins/dev-process-toolkit/.claude-plugin/plugin.json`** — `version` field updated.
2. **`.claude-plugin/marketplace.json`** — matching `version` in the plugin entry.
3. **`CHANGELOG.md`** — new `## [X.Y.Z] — YYYY-MM-DD — "<Codename>"` section at the top, with `### Added` / `### Changed` / `### Removed` / `### Fixed` subsections populated from FR `changelog_category` + title. Cross-references rendered as `(STE-X)`. Closing line (AC-STE-73.12): `Total test count at release: <N> tests, <F> failures, <E> errors.` using `parseTestOutput` on the already-run test gate. **Skipped entirely if `changelog_ci_owned: true`** (from `readDocsConfig(CLAUDE.md)` — STE-68 key) — CI owns the CHANGELOG; the test-count closing line is also suppressed because it lives inside the CHANGELOG entry.
4. **`README.md`** — "Latest: **vX.Y.Z — '<Codename>'**" line in the `## Release Notes` section; any `## Structure` counts (skills, patterns, agents) recomputed from current filesystem.

### 5. Invoke /docs --commit --full (AC-STE-73.5)

If `readDocsConfig(CLAUDE.md)` returns at least one mode true, run `/docs --commit --full` in-process. Its approval prompt is merged into step 6's single gate (user sees one diff).

If both docs modes are false, log `docs disabled — skipping /docs --commit --full` and continue.

If `/docs --commit --full` fails (any non-zero exit / thrown error), abort with NFR-10:

```
/ship-milestone: /docs --commit --full failed; cannot proceed with release.
Remedy: fix the underlying /docs failure (see its stderr), then re-run /ship-milestone. Partial release (release commit without doc updates) is not supported.
Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
```

### 6. Unified diff + approval (AC-STE-73.6)

Print a single unified diff covering every modified file (the four release files + any `docs/` files `/docs --commit --full` touched). Then:

```
=== Proposed diff (N files, M lines) ===
<diff>
=== Apply? [y/N] ===
```

Accept case-insensitive `y` / `yes` as approval. The user can type `e` to open `$EDITOR` on the proposed CHANGELOG entry, then re-prompt (see reference § `e` edit-in-loop).

### 7. On approval — commit (AC-STE-73.6, AC-STE-133.5)

`git add` the expected-modified set and create a single commit in [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) form (STE-133). The commit-msg hook installed by `/setup` enforces the format locally.

```
chore(release): v<X.Y.Z>

<one-line summary>

Release: v<X.Y.Z> "<Codename>"
Refs: M<N>
```

- **Subject** — exactly `chore(release): v<X.Y.Z>` (≤ 72 chars; `chore(release): v1.37.0` is 23 chars, well within budget).
- **Body** — the existing release-checklist summary (CHANGELOG diff one-liner, files bumped, FRs included). `<one-line summary>` is `--summary "<text>"` if provided, else prompted.
- **Footers** — `Release: v<X.Y.Z> "<Codename>"` (machine-readable release metadata) **and** `Refs: M<N>` (milestone group reference). One blank line separates the body from the footer block per CC spec.

**Does not run `git push`** — the push remains a user action (core principle: shared-state actions require confirmation).

### 8. On refusal (AC-STE-73.7)

Any response other than `y` / `yes` (including Ctrl-C): no staging, no commit, any temp files deleted. Exit `0` with:

```
ship-milestone declined; release not committed. To retry, re-run /ship-milestone M<N>.
```

### 9. Post-ship checklist (AC-STE-73.11)

After the commit lands, print:

```
M<N> shipped as v<X.Y.Z> "<Codename>".
Next steps (not automated):
  1. git push  (when ready)
  2. /pr  (open release PR if this is a branch-based flow)
  3. Update any external references (tracker milestone close, announcement)
```

## Rules

- **Never `git push`.** The user pushes. Publishing a release is irreversible from the agent's side; that invariant holds regardless of user pressure.
- **Never bundle unrelated work.** Pre-flight refusal 2 exists because a release commit that carries an unrelated half-fix corrupts the release's provenance in git history.
- **Never skip the CHANGELOG closing line** on a CHANGELOG-owned release (AC-STE-73.12). A non-zero `<F>` blocks release; `<N>=0` is still written if the test gate happens to run zero tests (the line itself is the discipline).
- **Single approval gate.** Merge `/docs --commit --full`'s diff into the ship-milestone diff; the user sees one unified diff and answers `y` / `N` once.
- **Stay within the expected-modified set.** Pre-flight refusal 2 is the contract; `git add -A` is forbidden — use explicit `git add <file>` per expected path.
- **Version bump is inferred, not invented.** Reach for `inferBump` before `--version`; `--version` is an escape hatch when inference is wrong, not a default.
- **Codename validation is strict.** Backticks in commit messages break shell embeds downstream; newlines break the commit subject line. Re-prompt on invalid.

## Red flags

- "The test gate is flaky, let me skip the closing line this once" → no. A non-zero `<F>` blocks release. Fix the flake.
- "The diff is huge but it's mostly `docs/` regen, approve it" → approval is on the user. State the diff size and wait.
- "`--version` is easier than debugging the bumper" → debug the bumper. `--version` is for when the release is genuinely exceptional.
- "Let me `git push` on their behalf to save a step" → never. Shared-state actions require confirmation.

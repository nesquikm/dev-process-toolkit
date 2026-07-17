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
- `/ship-milestone` — no-arg form picks the **most recent in-progress milestone**: the `specs/plan/M<N>.md` with `status: active` (or with `frozen_at: null`). If none qualifies, run the ship-debt offer below before refusing.
- Optional flags: `--version X.Y.Z` (override inferred bump), `--codename "<name>"` (skip prompt), `--summary "<text>"` (commit one-liner, else prompted).

### Ship-debt offer

When the bare no-arg form (`/ship-milestone` with no argument) finds **zero** plans with `status: active`, do not fall straight into the flat "no active plan" NFR-10 refusal. First scan `specs/plan/archive/` for ship debt: archived plans whose frontmatter **lacks `shipped_in`** and that are **not parked** (no `ship_state: parked` opt-out in frontmatter — the same predicate the `plan_ship_coherence` probe reads). Order candidates **newest-first** — sort by `archived_at` descending — and offer each in turn with the exact prompt:

```
Unshipped archived milestone M<N> — ship it? [y/N]
```

- `y` / `yes` (case-insensitive) — proceed with that milestone exactly as if `/ship-milestone M<N>` had been invoked; resolution takes the archive-fallback leg of Flow step 1.
- **Decline** (anything else, default `N`) — move to the next candidate; once candidates are exhausted (or none existed), emit today's refusal text and exit code byte-identically — the offer changes nothing about the declined path.

## Pre-flight refusals

Any of these fire before any file write and exit non-zero with an NFR-10-shape message:

1. **Unshipped FRs**. Walk `specs/plan/M<N>.md`; if any row links to an FR file whose frontmatter has `status: active` (not yet archived), **probe tracker state** and emit one of two remedy shapes.

   **Task-bullet pre-flight (STE-201 AC-STE-201.1..3).** In addition to the FR-row walk, parse the milestone's `**Tasks:**` block. For each `[ ]` (unchecked) bullet, find a backing FR row by either (a) explicit inline link `- [ ] foo — STE-NNN` (wins over heuristic), or (b) case-insensitive substring match between the task's leading verb-phrase and an FR row's title. A task with no backing FR row, or one whose backing FR is `status: active` (not yet archived), accumulates into the `unbacked_tasks` list. A task explicitly marked `[deferred]` (e.g., `- [deferred] multiply — moved to M3`) is treated as ship-OK — same parse path as `[x]` and `[ ]`. If `unbacked_tasks` is non-empty, refuse with the AC-STE-201.2 shape:

   ```
   /ship-milestone: milestone M<N> plan has <count> unchecked task(s) with no FR backing:
   - <task-1>
   - <task-2>
   Cannot tag a release for a milestone whose plan describes uncompleted scope.
   Remedy: either /spec-write FRs for the unbacked tasks (then /implement them), or
   move the tasks to a later milestone's plan, then re-run /ship-milestone.
   Context: milestone=M<N>, unbacked-tasks=<count>, skill=ship-milestone
   ```

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

2. **Dirty working tree outside the expected set**. The expected-modified set is every entry in the host's `## Release Files` block, plus the `docs/` subtree (for the `/docs --commit --full` step), plus the resolved plan path (`specs/plan/M<N>.md`, or `specs/plan/archive/M<N>.md` on the archive-fallback leg) for the `shipped_in` frontmatter stamp. `git status --porcelain` lines outside that set ⇒ refuse:

   ```
   /ship-milestone: working tree has uncommitted changes outside the release files: <list>.
   Remedy: commit or stash unrelated changes, then re-run /ship-milestone. Release commits must not bundle unrelated work.
   Context: milestone=M<N>, unexpected=<count>, skill=ship-milestone
   ```

3. **Test gate red**. Run the project's test command once; if `<F>` failures > 0, refuse:

   ```
   /ship-milestone: cannot tag release with <F> test failure(s).
   Remedy: fix failing tests, then re-run /ship-milestone. The CHANGELOG closing line reports `<N> tests, <F> failures, <E> errors` — a non-zero F blocks release.
   Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
   ```

   Use the stack detector to pick bun / pytest / flutter parsers from `adapters/_shared/src/test_count_parser.ts`. Unrecognized output or unknown stack → NFR-10 asking the user to specify or skip the line.

## Flow

### 1. Resolve milestone + FR list

Read `specs/plan/M<N>.md`. **Archive fallback (STE-210 AC-STE-210.1):** if `specs/plan/M<N>.md` is missing, check `specs/plan/archive/M<N>.md` — when the archived plan exists AND every FR row in it has `status: archived` (consistent end state), proceed to read from the archive path. When the archived plan exists but FR rows are mixed (some still `status: active`), refuse with NFR-10:

```
/ship-milestone: active plan path missing but archived plan has unarchived FRs — corrupt state.
Remedy: investigate; either restore plan to active/ or archive remaining FRs.
Context: milestone=M<N>, skill=ship-milestone
```

When neither path exists, refuse `Plan M<N> not found in specs/plan/ or specs/plan/archive/`. The fallback only activates when the active path is genuinely missing — for milestones whose plans are still in `specs/plan/`, behavior is unchanged.

Whichever path survives this resolution — `specs/plan/M<N>.md` or the archive-fallback `specs/plan/archive/M<N>.md` — is the **resolved plan path**; step 7 later stamps `shipped_in` into its frontmatter as part of the release commit.

Extract every FR with a live tracker ID / ULID. For each, read `specs/frs/<name>.md` frontmatter and pull `title`, `tracker.<key>`, `breaking` (default `false`), `changelog_category` (default `Added`), and `status` (must be `archived` after Pre-flight refusal #1 above — Unshipped FRs).

### 2. Infer version

Call `inferBump({ currentVersion, frs, override })` from `adapters/_shared/src/version_bump.ts`. Rules:

- **major bump** when any FR frontmatter has `breaking: true`.
- **patch bump** when every FR's `changelog_category` is `Fixed` or `Removed` (pure fix-class milestone).
- **minor bump** otherwise — the default, matching M12–M19 history.
- `--version X.Y.Z` override wins and bypasses inference.

### 3. Prompt for codename

If `--codename "<name>"` was passed, validate and use it. Otherwise prompt:

```
Enter milestone codename (short, memorable — e.g., "Diátaxis"):
```

Validate: non-empty, ≤ 32 chars, no backticks, no newlines. Re-prompt on invalid until the user provides a valid value or aborts.

### 4. Construct release-file changes

**Migration-coverage pre-flight.** Before computing any bump, call `assertMigrationDeclared(planPath, MIGRATIONS, releaseVersion)` from `adapters/_shared/src/migrations/coverage.ts` (registry from `adapters/_shared/src/migrations/index.ts`; version from step 2). It refuses with the NFR-10 shape (naming the plan) when the plan's `migration:` key is absent or the template sentinel (`null`/empty), when a declared id is not present in the registry, or when the declared id's `introduced_in` ≠ the version being shipped. `migration: none` proceeds. The step rides the existing ceremony — no additional approval prompt; a refusal aborts before any file is rewritten.

Read the host project's `## Release Files` block from `CLAUDE.md` via `parseReleaseFiles(content)` from `adapters/_shared/src/release_config.ts`. The block declares every path that gets rewritten on this release; no path is hard-coded in this skill body. Schema reference + per-kind worked examples live in `docs/ship-milestone-reference.md` § Release Files block schema.

For each entry, compute the new file content via `bumpFile(entry, currentContent, opts)`:

- **`kind: json`** — rewrites a JSON property at the dot-path in `field`. Output is reformatted with two-space indent.
- **`kind: toml`** — rewrites a TOML field (top-level or one-level dotted).
- **`kind: yaml`** — rewrites a top-level YAML scalar; preserves a Flutter `+<build>` suffix on the same line.
- **`kind: changelog`** — inserts a new `## [X.Y.Z] — YYYY-MM-DD — "<Codename>"` section above the topmost prior version section. Body comes from FR `changelog_category` + title (`### Added` / `### Changed` / `### Removed` / `### Fixed` subsections; cross-refs rendered as `(STE-X)`). Closing line `Total test count at release: <N> tests, <F> failures, <E> errors.` from `parseTestOutput`. **Skipped entirely if `changelog_ci_owned: true`** (from `readDocsConfig(CLAUDE.md)`) — CI owns the CHANGELOG; the closing line is also suppressed because it lives inside the entry.
- **`kind: regex`** — substitutes the `(?<version>...)` capture in `pattern` using the `replace` template (with `{version}` placeholder). Used for free-form lines like the README "Latest:" banner.

`optional: true` entries whose `path` is missing on disk emit an `n/a` row in the proposed-diff summary; required (non-optional) entries with missing paths surface NFR-10 canonical refusal.

Refusals: `MissingReleaseFilesBlockError` (block absent or empty) and `MalformedReleaseFilesError` (entry violates schema, e.g. regex without `(?<version>)` named group) both abort the run with the canonical NFR-10 shape — `Remedy: add a \`## Release Files\` block to CLAUDE.md (run /setup or copy from examples/<stack>/release.yml). Context: skill=ship-milestone`.

### 5. Invoke /docs --commit --full

If `readDocsConfig(CLAUDE.md)` returns at least one mode true, run `/docs --commit --full` in-process. Its approval prompt is merged into step 6's single gate (user sees one diff).

If both docs modes are false, log `docs disabled — skipping /docs --commit --full` and continue.

If `/docs --commit --full` fails (any non-zero exit / thrown error), abort with NFR-10:

```
/ship-milestone: /docs --commit --full failed; cannot proceed with release.
Remedy: fix the underlying /docs failure (see its stderr), then re-run /ship-milestone. Partial release (release commit without doc updates) is not supported.
Context: milestone=M<N>, version=<X.Y.Z>, skill=ship-milestone
```

### 6. Unified diff + approval

Print a single unified diff covering every modified file (every `## Release Files` entry that produced a non-empty bump + any `docs/` files `/docs --commit --full` touched). The diff also renders the frontmatter stamp hunk — `shipped_in: v<X.Y.Z>` on the resolved plan file — alongside the release-file bumps; the stamp rides the existing single `Apply?` approval below, no extra prompt. Then:

```
=== Proposed diff (N files, M lines) ===
<diff>
=== Apply? [y/N] ===
```

Accept case-insensitive `y` / `yes` as approval. The user can type `e` to open `$EDITOR` on the proposed CHANGELOG entry, then re-prompt (see reference § `e` edit-in-loop).

### 7. On approval — commit

**Universal pre-commit branch gate (STE-228).** Before `git add` runs, call `requireCommittableBranch({ commitType: "chore", proposedBranchName, currentBranch, isAutoMode })` from `adapters/_shared/src/require_committable_branch.ts` with `proposedBranchName` returned by `branchNameFor({ version })` from `skills/ship-milestone/branch_name_for.ts` (release shape → `release/v<X.Y.Z>`; collision-suffix per STE-228 AC-STE-228.11 is exceedingly rare for this skill). On `created` / `edited` the gate runs `git checkout -b <branchName>` so the release commit lands on the new branch; `declined` rolls back staging via `git reset HEAD <paths>` (explicit list, never `--hard`) and exits non-zero before the release commit lands; `no-op` (off-trunk OR `commitType ∈ TRUNK_OK_TYPES = ["ci"]`) is silent. Auto-mode default-apply uses the `<dpt:auto-approve>v1</dpt:auto-approve>` marker per STE-226. See STE-228 § Branch-name canonical table for the full builder catalogue.

**Stamp the resolved plan.** Before the commit is created, call `stampShippedIn(resolvedPlanPath, "v<X.Y.Z>")` from `adapters/_shared/src/plan_ship_stamp.ts` to write `shipped_in: v<X.Y.Z>` — the final version chosen for this release, after any `--version` override — into the resolved plan file's frontmatter. The stamp targets the resolved plan path from step 1, so it lands identically on the live path and the archive-fallback path, and the stamped plan file rides the same single atomic release commit.

**Stamp semantics.** `shipped_in` is written only by this skill or the one-shot backfill script (run once against the historical archive, never shipped, deleted after the backfill commit). Absence of `shipped_in` on an archived plan means unshipped debt: the plan reached the archive without a release carrying it. Absence on a live plan is normal — the milestone simply hasn't shipped yet.

**Render the `## Token Stats` rollup.** Opt-in gate: skip this rollup render when `readTokenStatsConfig(projectRoot).enabled === false`. Alongside the stamp, read the token ledger (`.dpt/ledger/token-ledger.jsonl`; absent or no rows for this milestone ⇒ skip, vacuously), scope rows to this milestone first — a row belongs when its `claimed_by` names an in-scope FR, or (for unclaimed rows) when its `git_branch` is on the milestone's branch lineage, so a shared ledger never leaks another milestone's rows — then call `renderMilestoneRollup(rows, { frOrder })` / its upsert counterpart `upsertMilestoneRollup` from `adapters/_shared/src/token_stats_render.ts` to write the milestone rollup into the resolved plan file (`specs/plan/M<N>.md`, or the archive-fallback path): one per-FR subtotal line per model for each in-scope FR (plan order), a `(main-loop)` line per model for unattributed orchestrator rows, a `design/exploration` line for `brainstorm` rows never claimed by any FR (no `claimed_by` mark — exploratory cost stays visible instead of being dropped), and a milestone `total` row. The block is sentinel-fenced (`token-stats:begin` / `token-stats:end`) and idempotent — re-rendering replaces the fenced region in place, never appending a duplicate. Stage the updated plan file with the rest of the set so the rollup rides the release commit — never a commit of its own, never a standalone working-tree mutation.

`git add` the expected-modified set and create a single commit in [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) form. The commit-msg hook installed by `/setup` enforces the format locally.

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

### 8. On refusal

Any response other than `y` / `yes` (including Ctrl-C): no staging, no commit, any temp files deleted. Exit `0` with:

```
ship-milestone declined; release not committed. To retry, re-run /ship-milestone M<N>.
```

### 9. Post-ship checklist

After the commit lands, print:

```
M<N> shipped as v<X.Y.Z> "<Codename>".
Next steps (not automated):
  1. git push  (when ready)
  2. /pr  (open release PR if this is a branch-based flow)
  3. Update any external references (tracker milestone close, announcement)
```

### 10. Opt-in /pr chain

Fires only after a **successful release commit** lands **off-trunk** (the step-7 branch gate created `release/v<X.Y.Z>`, or the run was already on a feature branch). On-trunk landings and every refusal/abort path skip this step silently. After the step-9 checklist prints, prompt (exact format, mirroring /implement Phase 5's milestone-close prompt):

```
Open ceremony PR via /pr now? (y/n):
```

- **Accept** — input is `y` or `yes` (case-insensitive, trimmed). Chain into `/pr` **in-process** with all `/pr` gates intact — the tracker-mode probe, the uncommitted-changes confirmation, and the push run exactly as on a manual `/pr` invocation. Any push happens inside `/pr` under its own confirmation; `/ship-milestone` itself still never pushes — the chain does not erode that invariant.
- **Decline** — input is `n` / `no` / empty / any other non-matching string. Do not chain; print the hint and exit 0: `Run: /pr`.

Chain-start failure ⇒ NFR-10 canonical refusal, exit non-zero:

```
/ship-milestone: attempted to chain into /pr but it failed to start: <error>.
Remedy: verify the plugin is installed and the pr skill is enabled, then run /pr manually.
Context: milestone=M<N>, chain=pr, skill=ship-milestone
```

## Rules

- **Never `git push`.** The user pushes. Publishing a release is irreversible from the agent's side; that invariant holds regardless of user pressure.
- **Never bundle unrelated work.** Pre-flight refusal 2 exists because a release commit that carries an unrelated half-fix corrupts the release's provenance in git history.
- **Never skip the CHANGELOG closing line** on a CHANGELOG-owned release. A non-zero `<F>` blocks release; `<N>=0` is still written if the test gate happens to run zero tests (the line itself is the discipline).
- **Single approval gate.** Merge `/docs --commit --full`'s diff into the ship-milestone diff; the user sees one unified diff and answers `y` / `N` once.
- **Stay within the expected-modified set.** Pre-flight refusal 2 is the contract; the set is whatever `## Release Files` declares (plus `docs/` if `/docs --commit --full` ran). `git add -A` is forbidden — use explicit `git add <file>` per entry.
- **Version bump is inferred, not invented.** Reach for `inferBump` before `--version`; `--version` is an escape hatch when inference is wrong, not a default.
- **Codename validation is strict.** Backticks in commit messages break shell embeds downstream; newlines break the commit subject line. Re-prompt on invalid.

## Red flags

- "The test gate is flaky, let me skip the closing line this once" → no. A non-zero `<F>` blocks release. Fix the flake.
- "The diff is huge but it's mostly `docs/` regen, approve it" → approval is on the user. State the diff size and wait.
- "`--version` is easier than debugging the bumper" → debug the bumper. `--version` is for when the release is genuinely exceptional.
- "Let me `git push` on their behalf to save a step" → never. Shared-state actions require confirmation.

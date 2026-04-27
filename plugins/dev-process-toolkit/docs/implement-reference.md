# `/implement` Reference

Extended reference material for `/dev-process-toolkit:implement` that was extracted from `skills/implement/SKILL.md` to keep the skill file under the NFR-1 300-line cap. The skill file contains a one-line pointer to this file at the Stage C section.

This reference is **not required reading** on every run — the skill itself has enough guidance to operate. Consult this file when Stage C (Hardening) is run on round 1 of the self-review loop, or when a hardening pass needs concrete examples.

## Phase 3 Stage C — Hardening Pass (first round only)

After Stage B passes on round 1, run a hardening pass before declaring victory. Skip this on round 2 (diminishing returns).

### f. Negative & edge-case tests

For each module created or modified, ask:

- What happens with empty / null / missing input?
- What happens at boundary values (`0`, `-1`, `MAX_INT`, empty string, empty array, single-element array)?
- What happens when an external dependency fails (network error, timeout, malformed response, unexpected status code)?
- Are there race conditions or ordering assumptions? Can two writers clobber each other? Can a reader observe a partial write?
- What happens under concurrent load (if the module is called from multiple callers)?

You don't need to test every combination — focus on the cases most likely to cause real bugs. Add tests for any gaps found. If the module is a pure function with a small input space, consider property-based testing; if it's a state machine, test every transition at least once.

### g. Error path audit

Verify that error handling:

- **Doesn't swallow errors silently** — caught exceptions must either be rethrown, logged with context, or explicitly ignored with a comment explaining why.
- **Doesn't leak sensitive information in error messages** — no raw database errors to the client, no stack traces in production responses, no credentials or PII in logs.
- **Returns appropriate error types/codes at system boundaries** — HTTP 4xx for client errors, 5xx for server errors; typed error unions for internal APIs; specific exception classes, not bare `Exception` catches.
- **Has a retry or fallback strategy where appropriate** — transient failures on external deps usually warrant bounded retry; permanent failures should fail fast.
- **Logs enough context to diagnose** — include the operation name, inputs (redacted), and the downstream error.

### Stack-specific hardening examples

These are illustrative — use the patterns in your project's CLAUDE.md as the authoritative list.

- **TypeScript / Node:** verify `async/await` error propagation (no unhandled rejections); check that `Promise.all` isn't hiding partial failures; confirm `JSON.parse` is wrapped in try/catch at system boundaries.
- **Python:** verify `with` statements close resources on exception; check that `except Exception:` is specific or commented; confirm `asyncio.gather` uses `return_exceptions=True` when partial failure is acceptable.
- **Flutter / Dart:** verify `async` functions return `Future` and are `await`ed; check that `Stream` subscriptions are cancelled in `dispose()`; confirm `tryEmit()` is used on closed BLoCs.
- **Go:** verify every returned `error` is checked; check that deferred `Close()` calls are paired with error handling; confirm context cancellation propagates through goroutines.
- **Rust:** verify `Result` is not discarded with `let _ = ...`; check that `?` propagates errors to the right boundary; confirm `panic!` is only used for truly unreachable states.

## Branch Proposal (STE-64)

Fires at Phase 1 entry, **between resolver (0.b′) and `claimLock` (0.c)** — the branch identity must settle before the lock binds to it.

### Guard

1. Read `branch_template:` from Schema L (the probe already ran in step 0.d; the value is in-session).
   - Absent ⇒ skip the whole step. Branch automation disabled (AC-STE-64.1).
   - Present ⇒ continue.
2. Extract the run-scope identifier from the resolver result:
   - Milestone run (`fallthrough` + arg matches `M<N>`) ⇒ `RunScope.kind = "milestone"`, `number = "<N>"`.
   - Tracker-mode FR run ⇒ `RunScope.kind = "fr-tracker"`, `trackerId = <resolved tracker ID>`.
   - Mode-none FR run ⇒ `RunScope.kind = "fr-mode-none"`, `shortUlid = spec.id.slice(23, 29).toLowerCase()`.
3. Call `isCurrentBranchAcceptable(currentBranch, scope)` from `adapters/_shared/src/branch_proposal.ts`. `true` ⇒ skip the proposal (branch already encodes the scope). `false` ⇒ continue.

### Proposal render

4. Run a single LLM pass over the FR's `## Requirement` section (or the milestone plan file's "Why this milestone exists" section for milestone runs) and return `{type, slug}` as structured JSON. `type` ∈ `{feat, fix, chore}`; `slug` is a 2–4 word kebab-case phrase summarizing the work.
5. Call `buildBranchProposal({template, type, slug, milestone, trackerId, shortUlid})`. The function:
   - Clamps `{type}` to the allowed set (unknown ⇒ `feat`; AC-STE-64.13).
   - Sanitizes `{slug}` to `[a-z0-9-]`, collapses hyphen runs, strips leading/trailing hyphens.
   - Throws `EmptySlugError` if the slug sanitizes to empty (⇒ surface as NFR-10 refusal and re-prompt).
   - Substitutes `{type}`, `{N}`, `{ticket-id}`, `{slug}` into the template.
   - Truncates slug-only if the rendered name exceeds 60 chars.

### Prompt

6. Render: `Create branch '<rendered>'? [Y] accept / [e] edit / [n] abort`.
   - `Y` or `enter` ⇒ `git checkout -b <rendered>`, continue Phase 1 at step 0.c.
   - `e` ⇒ present the rendered name on an editable input line; re-prompt `Y/e/n` on the edited string. No cap on edit iterations, but the user must ultimately press `Y` or `n`.
   - `n` ⇒ exit cleanly with `aborted: branch not created` and **zero side effects** (no `claimLock`, no ticket writes, no file changes).

### Failure handling

7. `git checkout -b` fails (branch already exists with different upstream, uncommitted changes conflict, permissions, etc.): surface the git error via NFR-10 canonical shape and exit non-zero. Never silently proceed on the old branch after a failed checkout (AC-STE-64.8).

### Scope boundary (AC-STE-64.9)

Only `/implement` reads `branch_template:`. `/tdd`, `/debug`, `/spec-write`, `/gate-check`, `/pr`, `/spec-archive`, `/spec-review`, `/visual-check`, `/simplify`, `/brainstorm` never read the key and never prompt for branch creation.

## Milestone Archival Procedure

Full sub-step ordering for the Phase 4 Milestone Archival block (STE-22). The skill itself carries a condensed summary; consult this section when executing the archival or debugging an interrupted run. Sub-steps are lettered to avoid clashing with the Phase 4 flow numbering (steps 13–15 in the skill).

a. Scan `specs/frs/*.md` for every FR with frontmatter `milestone == <current>`. Build the FR batch.
b. For each batched FR: plan one `git mv specs/frs/<name> specs/frs/archive/<name>` (where `<name>` is `Provider.filenameFor(spec)` — M18 STE-60; stem preserved across the move) + frontmatter flip (`status: active → archived`; set `archived_at: <ISO now>`) + one `Provider.releaseLock(<ulid>)` call.
c. If `specs/plan/<M#>.md` exists, plan one `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` (AC-STE-21.5) to batch alongside the FR moves.
d. Present the full batch as a diff preview — list every `git mv`, every frontmatter flip, every `releaseLock`. Do not summarize.
e. On explicit human approval (Phase 4 step 15): execute all moves + flips + `releaseLock` calls and commit atomically in a single commit (AC-STE-22.2, AC-STE-22.6). Any error aborts the entire batch — no partial archival.
f. Run the Post-Archive Drift Check from `skills/spec-archive/SKILL.md` § Post-Archive Drift Check. Render the unified Schema I table; offer the 3-choice UX (address inline / save to `specs/drift-<date>.md` / acknowledge). The drift check never blocks the already-committed archival.
g. `specs/technical-spec.md` is **never** archived — ADRs use `Superseded-by:` in place (ADR convention).

## Decision matrix (round resolution)

The self-review loop has hard exit conditions that Stage C feeds into. For reference:

| Outcome | Action |
|---------|--------|
| All stages pass + gate confirms clean (`GATE PASSED`) | Exit loop, proceed to Phase 4 |
| Gate returns `GATE PASSED WITH NOTES` | Treat non-critical notes as informational, include in Phase 4 report, exit loop |
| Issues found on round 1 | Fix, re-run gate check, go to round 2 |
| Issues found on round 2, same issue types as round 1 | **STOP and escalate** — going in circles |
| Issues found on round 2, different issue types | Fix, re-run gate check, escalate to user (diminishing returns) |

After any fix, always re-run the full gate check before continuing. Read the actual output and report the numbers (e.g., `47 tests, 0 failures, 0 errors`). Never claim clean from memory of a previous run.

## Spec Deviation Check

The skill's condensed rule is "if reality contradicts the spec, STOP and classify". Full playbook for Phase 2 step 9:

a. **STOP coding forward.** The spec is the source of truth. If reality contradicts it, the spec must be updated first — do not work around a broken spec.

b. **Assess already-written code.** If significant code was already written against the incorrect spec, evaluate whether to revert to the last checkpoint (git commit) or adapt the existing code. Prefer reverting if the spec change alters the fundamental approach.

c. **Classify the issue** — exactly one of four types (Schema per NFR-4):

| Class | When | Action |
|-------|------|--------|
| `underspecified` | spec silent but behavior clearly implied | add edge case to specs + add test + continue. No user approval needed. |
| `ambiguous` | spec silent, reasonable people disagree | propose most conservative behavior, log as provisional decision in specs, add test, confirm at Phase 4. Continue. |
| `contradicts` | what the spec says cannot work or conflicts with another requirement | present contradiction + propose 2+ options with tradeoffs. **Wait for user decision.** Update spec with decision. |
| `infeasible` | specified approach hits a hard technical wall | explain why + propose alternatives. **Wait for user decision.** |

d. **Always backfill specs.** Any edge case discovered during implementation (whether it blocks you or not) must be:

- Logged in `specs/requirements.md` edge-case section (or `specs/technical-spec.md` if architectural).
- Covered by a test.
- Never allowed to live only in code — that's tribal knowledge, and it rots.

## Spec Breakout

The skill's condensed rule is "3 or more `contradicts` / `infeasible` deviations ⇒ STOP + Spec Breakout report + recommend rewrite". Full report shape:

1. **Title line.** `Spec Breakout — milestone M<N>` + date.
2. **Trigger.** Count + list of deviations by ID (e.g., `3 contradicts, 1 infeasible — total 4 ≥ threshold 3`).
3. **Deviation table.** Schema per NFR-4 Deviation Table: columns `Deviation`, `Classification`, `Resolution` (or `unresolved — awaiting decision`), `Needs Confirmation?`.
4. **Affected specs.** Named sections of `specs/requirements.md` / `specs/technical-spec.md` that need rewrite.
5. **Recommended scope.** Proposed rewrite scope (single section, whole FR, whole milestone plan).
6. **Resume condition.** What must change in the specs before `/implement` can safely resume.

Breakout is a valid skill output, not a failure. Emit the report, update the task list, and wait for the user to update specs. The threshold is configurable via CLAUDE.md (look for a line like `spec_breakout_threshold: <N>`; default `3`).

## Phase 4b Doc Fragment Hook

STE-74 installs this hook. The skill body carries the condensed flow; this section covers edge cases and the diagnostic log shape.

### When it runs

Phase 4b fires after Phase 4a (gate pass) and before Phase 4c (report + approval) / 4d (Close). Its enabling gate is the `## Docs` section of `CLAUDE.md` (read via `readDocsConfig(CLAUDE.md)` from `adapters/_shared/src/docs_config.ts`). Both `userFacingMode` and `packagesMode` false — or the section absent — ⇒ **silent no-op**: no log line, no row, zero output. This preserves byte-identical behavior for projects that don't use docs generation (AC-STE-74.3).

### FR ID resolver order

Phase 4b invokes `/docs --quick` with the resolver that `/docs` itself uses (AC-STE-74.2):

1. **Branch template match.** If `branch_template:` is set in Schema L and the current branch name maps to a tracker ID or ULID under that template, use it.
2. **Diff scan.** Otherwise, find the most-recent FR whose file appears in the working-tree diff (`git log -1 --format=%H -- specs/frs/<fr>.md`).
3. **Unbound fallback.** If neither resolves, `/docs --quick` writes `docs/.pending/_unbound-<UTC-timestamp>.md` with a `warning:` line in the frontmatter. No retry — the fragment is still written.

### Success path (AC-STE-74.4)

On successful fragment write, `/implement` appends exactly one row to the existing Phase 4 Spec Deviation Summary table:

```
| Doc fragment | added | docs/.pending/<fr-id>.md | — |
```

The `<fr-id>` placeholder resolves to the actual fragment base name (tracker ID, short-ULID tail, or `_unbound-<ts>`).

### Failure path (AC-STE-74.5, AC-STE-74.6)

`/docs --quick` non-zero exit, thrown error, or 60-second timeout — Phase 4b logs one warning line to stdout, then appends:

```
| Doc fragment | skipped (error) | — | /docs --quick failed: <first-line-of-error>. Run manually after commit to retry. |
```

The `<first-line-of-error>` is the first line of stderr (or the string `timeout after 60s` on timeout). Phase 4 then continues to Phase 4c normally — the implementation commit does not block on a failed fragment write. The user can re-run `/docs --quick` manually after the commit lands.

### Diagnostic log shape

The single log line printed on success (stdout):

```
phase-4b: /docs --quick wrote docs/.pending/<fr-id>.md
```

On failure (stderr, then the skipped row goes to the Deviation table):

```
phase-4b: warning — /docs --quick failed: <first-line-of-error>
```

No log line is ever printed when Phase 4b is gated off (both modes false or section absent) — zero-output invariant.

### Out-of-scope

- **Cross-FR fragments.** Phase 4b writes exactly one fragment per `/implement` run, bound to the FR being implemented. If a diff genuinely spans multiple FRs, the human runs `/docs --quick` manually with explicit overrides after the commit.
- **Retry on failure.** No automatic retry. A single failure appends the skipped row and lets the user decide.
- **`--skip-docs` flag.** None. AC-STE-74.8 forbids a new `/implement` flag; temporary opt-out is done by flipping Schema L docs keys.

## Commit message format (STE-133)

Phase 4 commits use [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The `commit-msg` hook installed by `/setup` is the deterministic gate; this section is the cooperative specification the agent follows when proposing the message at the step 14 approval gate (AC-STE-133.4, AC-STE-133.9).

### Subject

`<type>(<scope>): <title>` — total length ≤ 72 characters. Append `!` after the scope (or after the bare type when no scope) for breaking changes (`feat(api)!: drop legacy endpoint`, `feat!: rename root config`).

### Type heuristic

Pick from the [Angular set](https://www.conventionalcommits.org/en/v1.0.0/#summary):

| FR class | Type | Notes |
|----------|------|-------|
| New user-visible functionality | `feat` | Default for spec-driven feature FRs. |
| Bug-fix FR | `fix` | Use when the FR's purpose is to correct broken behavior. |
| Documentation-only change (README, docs/, prose-only SKILL.md edits) | `docs` | No production code touched. |
| Behavior-preserving restructure | `refactor` | Renames, dead-code removal, reorganization with no semantic change. |
| Build / tooling / non-functional housekeeping | `chore` | Dependency bumps, gitignore edits, hook installs. |
| Test-only change | `test` | New tests with no production-code change. |
| Performance | `perf` | Use sparingly — most perf work is `refactor` + benchmarks. |

### Scope

Primary touched skill or area: `skills/implement`, `skills/pr`, `adapters/linear`, `adapters/_shared`, `templates`, `tests`, `docs`. Multi-area FRs pick the dominant area; if no single area dominates, omit the scope (`feat: ...` is valid).

### Body + footer

- **Body** — the existing Phase 4 prose (AC checklist resolution, files touched, deviation summary). Unchanged in shape from pre-M36.
- **Footer** — one `Refs:` line per FR touched, in tracker-ID form: `Refs: STE-<N>`. In `mode: none` use the short-ULID tail (`Refs: VDTAF4`). Multiple FRs in one commit get one `Refs:` line each.

### Example

```
feat(commits): adopt Conventional Commits v1.0.0

Adds `commit-msg` hook template + skill prose updates so the
toolkit and adopting projects share one deterministic
commit-format gate. Local hook hard-blocks non-CC commits
without grace period.

Refs: STE-133
```

### Step 14 approval-gate render

Alongside the AC checklist and gate output, the report must include the proposed `<type>(<scope>): <title>`. The user can redirect type/scope before approval (e.g., "use `chore` not `feat` — this is non-functional"). The commit-msg hook is the deterministic backstop if drift slips through.

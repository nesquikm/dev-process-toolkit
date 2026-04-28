---
title: Branch automation in /implement + /setup (Schema L branch_template)
milestone: M19
status: archived
archived_at: 2026-04-23T14:49:58Z
tracker:
  linear: STE-64
created_at: 2026-04-23T12:23:53Z
---

## Requirement

`/implement` currently runs on whatever branch the user happens to be on — typically `feat/m12-tracker-integration` or even `main`. There is no guard rail preventing implementation on `main`; no naming convention is enforced; and there's no ergonomic path to "create the right branch and get going." Users have correctly pointed out that the result is long-lived branches accumulating multiple milestones (like `feat/m12-tracker-integration` carrying M12 through M18) and inconsistent naming on the branches that do get created.

Three concerns drive this FR:
1. **Safety** — don't let `/implement` proceed silently on `main`.
2. **Consistency** — enforce a predictable branch-naming convention across milestones.
3. **Ergonomics** — remove the "remember to `git checkout -b` first" toil.

Solution: `/implement` detects when the current branch is `main`/`master` OR doesn't encode the current milestone/FR identifier in its name, runs an LLM pass over the FR content to infer `{type}` (`feat`/`fix`/`chore`) + `{slug}`, renders the template from `CLAUDE.md` Schema L `branch_template:`, and prompts `[Y] accept / [e] edit / [n] abort`. `/setup` asks once at first run and seeds `branch_template:` with a scope-aware default into Schema L.

## Acceptance Criteria

- AC-STE-64.1: Schema L (`## Task Tracking`) gains a new key: `branch_template:`. The default value, seeded by `/setup`, is `{type}/m{N}-{slug}` in `mode: none` and `{type}/{ticket-id}-{slug}` in tracker modes. Existing projects without the key are silently tolerated by `readTaskTrackingSection`; `/implement` treats missing `branch_template:` as "branch automation disabled."
- AC-STE-64.2: `acPrefix()` and other Schema L consumers continue to work unchanged — `branch_template:` is a flat string key, parsed by the existing parser. No parser changes required; only a new consumer (`buildBranchProposal`) reads the key.
- AC-STE-64.3: `/setup` on first run (or on mode transition) asks the user a single question: "Branch-naming template? (default: `<default-for-mode>`)". Response: empty → accept default; non-empty → use as-is. Written into Schema L under `branch_template:`. Skipped if the key already exists in CLAUDE.md.
- AC-STE-64.4: `/implement` Phase 1 (entry) computes "is the current branch acceptable?" via the rule: acceptable IFF current branch is not `main`/`master` AND the branch name contains the current milestone identifier (`m{N}` case-insensitive) when running a milestone, OR the tracker ID / short-ULID when running a single FR. Otherwise, proceeds to the branch-proposal flow.
- AC-STE-64.5: Branch proposal flow: a single LLM pass reads the FR's `## Requirement` section (or, for milestone runs, the M-plan file's "Why this milestone exists" section) and returns structured `{type: "feat"|"fix"|"chore", slug: "<2-4-word-kebab-case>"}`. The template is rendered by substituting `{type}`, `{N}` (milestone number), `{ticket-id}` (tracker ID in tracker mode, short-ULID tail in `mode: none`), `{slug}`. Truncation: if rendered branch name exceeds 60 chars, truncate the slug portion only.
- AC-STE-64.6: The prompt renders as: `Create branch '<rendered>'? [Y] accept / [e] edit / [n] abort`. `Y`/`enter` → `git checkout -b <rendered>` then continue `/implement`. `e` → show the rendered name on an editable input line, re-prompt Y/e/n on the edited string (no cap on edit iterations, but the user must ultimately press Y or n). `n` → `/implement` exits cleanly with a one-line "aborted: branch not created" message and no side effects.
- AC-STE-64.7: In `mode: none`, the proposal uses the short-ULID (chars 23-29 of the FR's ULID, per M16's AC-prefix convention) as `{ticket-id}`. Example: FR with `id: fr_01KPX4MKGDV6PDR0KCPQ22J2P6` → `{ticket-id}` = `22j2p6` (lowercased to match branch-name convention). This is symmetric with M18's mode-none filename convention (`22J2P6.md`).
- AC-STE-64.8: If `git checkout -b` fails (e.g., branch already exists with different upstream, uncommitted changes conflict), `/implement` surfaces the git error via NFR-10 canonical error shape (verdict / remedy / context) and exits non-zero. Never silently proceeds on the old branch after a failed checkout.
- AC-STE-64.9: `/tdd`, `/debug`, `/spec-write`, `/gate-check`, `/pr`, `/spec-archive`, `/spec-review`, `/visual-check`, `/simplify`, `/brainstorm` are **not in scope** for branch automation. Only `/implement` reads `branch_template:` and runs the prompt. The other skills continue to run on whatever branch they're invoked from.
- AC-STE-64.10: The skill file `plugins/dev-process-toolkit/skills/implement/SKILL.md` documents the new Phase 1 branch-proposal step. `plugins/dev-process-toolkit/skills/setup/SKILL.md` documents the new `/setup` question. `plugins/dev-process-toolkit/docs/patterns.md` adds a new pattern entry ("Branch naming automation") or updates the existing Pattern 6 (Schema L) to list `branch_template:`. `docs/setup-tracker-mode.md`, `docs/setup-none-mode.md` (if present), and `templates/CLAUDE.md.template` include the new key.
- AC-STE-64.11: At least two new unit tests land: one for `buildBranchProposal` (template rendering across mode: none + tracker mode, truncation, type/slug substitution) and one for `isCurrentBranchAcceptable` (main/master rejection, milestone match, FR match, case-insensitivity of milestone matching). Both live under `adapters/_shared/src/branch_*.test.ts`.
- AC-STE-64.12: `/gate-check` adds a doc assertion: `branch_template:` appears in `templates/CLAUDE.md.template`'s Schema L block. If the template is missing the key, the gate fails with the standard hygiene-gate error shape.
- AC-STE-64.13: `buildBranchProposal` sanitizes LLM-returned `{type}` and `{slug}` before template substitution. Allowed character class: `[a-z0-9-]` (lowercase alphanumerics + hyphen). Any other character is either dropped (for `{slug}`) or coerced to the closest allowed `{type}` (`feat`/`fix`/`chore`; unknown values default to `feat`). Empty post-sanitization `{slug}` throws a canonical NFR-10 error — never silently produces `feat/m19-` with a trailing hyphen. Unit tests assert the sanitizer against adversarial inputs: `$()`, backticks, newlines, spaces, semicolons, path-traversal (`../`), Unicode homoglyphs. This closes the shell-injection risk surface even though the skill's `git checkout -b` invocation already quotes the argument — defense in depth.

## Technical Design

**New module:** `adapters/_shared/src/branch_proposal.ts` exporting `buildBranchProposal(spec, template, mode)` and `isCurrentBranchAcceptable(branchName, spec, mode)`. Both pure functions; the LLM call that returns `{type, slug}` happens in the skill, not the adapter (adapters are deterministic — LLM pass is skill responsibility).

**Schema L extension:** one new key, flat string value. `readTaskTrackingSection` already returns a key:value map — nothing to change on the parser side. `branch_template:` joins `mode:`, `mcp_server:`, `jira_ac_field:` as an additive key.

**`/implement` Phase 1 wiring:** new sub-step inserted before "resolve the spec argument." Roughly:

```
1. parseArgs → spec-or-milestone
2. readCLAUDEMd → {mode, branch_template, ...}
3. if branch_template is set AND !isCurrentBranchAcceptable(git.currentBranch, spec, mode):
     {type, slug} = LLM.inferBranchNaming(spec)
     rendered = renderTemplate(branch_template, {type, N, ticketId, slug})
     prompt Y/e/n; handle response
   else: continue on current branch
4. ... existing phases
```

**`/setup` wiring:** after Schema L authoring in step 7b, add step 7c: ask the `branch_template:` question (once, if not present). Append the key to the Schema L block. The question text is stack-agnostic; the default depends on mode.

**Edge cases (covered by ACs):**
- Missing `branch_template:` → disabled (AC-1, backward compat).
- `mode: none` with no tracker ID → short-ULID fallback (AC-7, matches M18 filename).
- Current branch on a non-matching but still feature-looking name → still triggers prompt (AC-4, "milestone match required").
- git checkout failure → NFR-10 error (AC-8, never silent fallback).

## Testing

New test files under `adapters/_shared/src/`:
- `branch_proposal.test.ts` — template rendering, truncation, multi-mode substitution, short-ULID lowercasing.
- `branch_acceptable.test.ts` — acceptability check across main/master, milestone matches, FR matches, case variants.

No new E2E tests; the interactive Y/e/n flow is validated by the `/implement` dogfood pass on PR-2 itself (this FR creates its own branch via the feature being built — circular but verifying).

Stack-agnostic: the branch-name renderer takes strings and produces strings. No git operations in unit tests; `git checkout -b` is exercised by the skill's bash step.

## Notes

**Dogfooding circularity.** STE-64's own branch is created by the feature it's introducing. Safe because the skill's instruction is updated *before* the LLM call renders a proposal — so running `/implement STE-64` on `feat/m19-branch-automation` (already created) satisfies AC-STE-64.4 (branch matches FR) and skips the proposal flow. The first *real* test of the feature happens when the next post-M19 FR starts.

**Interaction with `/pr`.** `/pr` generates conventional-commits PR titles (`feat:`, `fix:`, `chore:`). The `{type}` inferred for branch naming is independent of the commit type — they're allowed to diverge if the work's nature shifts mid-implementation. Not a concern; both are LLM-inferred from context.

**Why LLM, not regex heuristic.** Picked (b) in brainstorm: FR titles like "Delete `active_ticket:` key" or "One-time rewrite of 83 archived FRs" wouldn't be classified correctly by keyword heuristics. Full-content LLM judgment catches the chore-vs-feat distinction reliably. Cost: one extra short call per `/implement` invocation (and only when the branch check fails).

**Abort semantics (AC-6).** `n` exits with *zero* side effects — no branch created, no files touched, no tracker calls. User can re-run `/implement` anytime after fixing the branch manually.

---
name: pr
description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.
argument-hint: '[PR title]'
---

Create a pull request for the current branch.

## Tracker Mode Probe

Before creating the PR, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and the rest of this skill runs unchanged. If a tracker mode is active:

- Run the 2-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` before any MCP write. Decline exits cleanly with zero side effects.
- After the PR is created, call `transition_status(ticket, in_review)` and optionally `upsert_ticket_metadata` to add the PR URL to the ticket description (NFR-8 ≤ 2 MCP calls). Capability-missing cases degrade with a canonical-shape warning + proceed.

See `docs/pr-tracker-mode.md` for the full tracker-mode flow.

## Ship-State Pre-Flight (Soft)

Before Step 1, check whether this branch archives a milestone without carrying its release:

1. **Detect archive moves (tree-based).** Run `git diff main...HEAD --name-status` and look for paths added or renamed under `specs/plan/archive/` or `specs/frs/archive/`. Detection is over the merged tree, not commit messages — a squashed or reordered history cannot hide the move.
2. **Check for a release marker.** Run `git log main..HEAD --oneline` and look for a `chore(release):` commit. If one is present, the release already rides this branch — suppress the prompt and proceed.
3. **Prompt only when both hold** (archive moves present, no release marker). Print the affected milestone(s), then prompt exactly:

   ```
   Milestone archive detected on this branch, but no release commit.
   [m]erge later / [s]hip first / [a]bort
   ```

   - `m` — proceed with PR creation as normal; the release ships later. Inject a `Follow-up: /ship-milestone M<N>` line into the PR body for each affected milestone, so the merged PR itself documents the outstanding ceremony.
   - `s` — exit with zero side effects and print the hint: `Run /ship-milestone M<N>, then re-run /pr`.
   - `a` — abort cleanly with zero side effects.

This pre-flight is soft: it never auto-blocks, and every choice is the operator's. Branches with no archive moves — spec-only PRs included — see no prompt at all and go straight to Step 1.

## Steps

1. Check `git status` and `git log` to understand what's being submitted
2. If on `main`, create a new branch from the changes:
   - Branch name format: `feat/short-description`, `fix/short-description`, or `chore/short-description`
3. If there are uncommitted changes, confirm with the user before staging and committing
4. Push the branch with `-u` flag
5. Create the PR using `gh pr create`:
   - **Title**: mirror the underlying feature commit's [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) subject — `<type>(<scope>): <title>`, ≤ 72 characters. Use `!` for breaking changes (`feat(api)!: drop legacy endpoint`). When the branch carries multiple commits, pick the type/scope of the dominant change (the merge commit or release commit on a release branch). The PR title and the squash-merge subject must both validate against the commit-msg hook.
   - Body format:

```
## Summary
<1-3 bullet points describing what changed and why>

## Test plan
- [ ] Testing steps or verification notes
```

6. Report the PR URL to the user

## Notes

- Default base branch is `main`
- If `$ARGUMENTS` contains a PR title, use it
- Always confirm with the user before pushing if there are uncommitted changes

---
name: pr
description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.
argument-hint: '[--draft]'
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

## Merge-Boundary Check (CHANGELOG test count)

Before Step 1, check whether the release entry's test count still describes this branch. Call `checkMergeBoundary(repoRoot)` from `adapters/_shared/src/release_test_count_guard.ts`: it is a git query — the latest `chore(release):` commit, the commits since it, and the test files those commits changed — and it costs milliseconds, never a gate run.

It warns only when BOTH hold: commits landed past the release commit AND at least one of them changed a test file. A docs-only commit cannot move the count, and warning about it would train the operator to ignore the warning. A branch with no release commit on it is clean by definition and prints nothing. When it does fire, print the module's warning verbatim — quoted here rather than retyped, so the two cannot drift:

```
/pr: the CHANGELOG test count was written at <sha>; work has landed on top of it since.
  commits since the release commit: <C>
  test files changed since it: <T>
  - <changed test file>
The stated count cannot describe this branch — it was measured before those commits.
Remedy: re-run the gate and rewrite the topmost CHANGELOG entry's closing line, then amend the release commit; or open this PR and let the release ship after it merges.
Context: release=<sha>, commits-since=<C>, test-files-changed=<T>, skill=pr
```

This check is soft, like the ship-state pre-flight above: it never blocks, and the operator decides whether to amend the release or let the count be rewritten by the next one. It exists because the count is written once and the branch keeps moving — measured on this repository at `f504493`, where a count that was honest when written was 242 tests short by the time the PR opened.

## Steps

1. Check `git status` and `git log` to understand what's being submitted
2. If on `main`, create a new branch from the changes:
   - Branch name format: `feat/short-description`, `fix/short-description`, or `chore/short-description`
3. If there are uncommitted changes, confirm with the user before staging and committing
4. Push the branch with `-u` flag
5. Create the PR using `gh pr create`:
   - **Draft**: when the invocation explicitly asks for one — the `--draft` flag, or plain English such as "open it as a draft" — pass `--draft` to `gh pr create`. The default is non-draft: an invocation that never asks for a draft is left exactly as it is today, with no `--draft` flag and no extra prompt.
   - **Unsupported draft**: when the host or the installed CLI cannot open a draft — the host does not support draft pull requests, the repository or fork disallows them, or the `gh` on this machine has no `--draft` flag — **refuse and say so**. Never silently open a normal pull request instead: a downgrade nobody was told about is exactly the misrepresentation this rule exists to prevent, and a silent skip is worse than a loud failure. Refuse in the canonical shape — `Refusing: cannot open a draft pull request — <reasons>.` / `Remedy: re-run /pr without the draft request to open a normal pull request, or open the draft manually on the host.` / `Context: host=<host> guards=<ids>` — and stop with zero side effects. Render it by calling `assertDraftSupported` in `adapters/_shared/src/pr_draft.ts` rather than retyping the wording here: that module is the single source of this refusal's text, and the shape above is quoted from it so the two cannot drift. The Remedy names the *request*, not the flag, because a draft can also be asked for in plain English; the Context names no PR URL, because the refusal lands before anything is created and there is no URL to name.
   - **Title**: always derived from the dominant commit's [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) subject — `<type>(<scope>): <title>`, ≤ 72 characters — with no user-supplied override path. Use `!` for breaking changes (`feat(api)!: drop legacy endpoint`). When the branch carries multiple commits, the dominant commit is the merge commit or release commit on a release branch, otherwise the primary feature commit. The PR title and the squash-merge subject must both validate against the commit-msg hook.
   - Body format:

```
## Summary
<1-3 bullet points describing what changed and why>

## Test plan
- [ ] Testing steps or verification notes
```

6. Report the PR URL to the user, and name the state it was opened in — `draft` or `ready for review`. Both states are stated outright: silence is not a statement, so a run that opened a normal pull request says `ready for review` rather than merely omitting the word `draft`. The reader can tell which state was opened from the report alone, without opening the host.

## Notes

- Default base branch is `main`
- Always confirm with the user before pushing if there are uncommitted changes
- When the invocation carries free text after `/pr`, explicitly reply "PR titles are derived from the commit subject; amend the commit to change the title" and proceed — the free text is never used as the title

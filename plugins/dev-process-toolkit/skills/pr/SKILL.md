---
name: pr
description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.
argument-hint: '[--draft]'
---

Create a pull request for the current branch.

## Tracker Mode Probe

Before creating the PR, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and the rest of this skill runs unchanged. If a tracker mode is active:

- Run the 2-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` before any MCP write. Decline exits cleanly with zero side effects.
- After the PR is created, decide the status move from where the ticket already is, then call `transition_status(ticket, in_review)` only when that move goes forward. Skip it when the observed status already maps to the `done` role — moving a finished ticket into the review lane drags it backwards — and skip it when the project's `in_review` status is byte-identical to its `in_progress` status, because the project declares no review lane to move to. Report every skip in plain words, stating the observed status and the reason it was not moved; a skipped transition is announced, never swallowed. Then optionally call `upsert_ticket_metadata` to add the PR URL to the ticket description (NFR-8 ≤ 2 MCP calls — the observed status was already read by the binding pre-flight, so deciding costs no additional call). Capability-missing cases degrade with a canonical-shape warning + proceed.

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

## Spec-Review Pre-Flight (Hard — Enforced by the Harness)

The `pre-pr-spec-review` hook refuses the `gh pr create` Bash call unless `/dev-process-toolkit:spec-review` has already run in this session as a `Skill` `tool_use`. The hook grades the current session's transcript, so a review that ran in an earlier session does not count, and neither does auditing the specs by hand or summarising them in prose — the invocation itself is the token, not the reading. The refusal is `exit 2` at `PreToolUse`, which lands before the command, so the `gh pr create` never runs.

Unlike the Ship-State pre-flight directly above, this one is not this skill's to decide: there is no prompt and no operator choice, because the harness blocks the tool call before the skill sees it. Run `/dev-process-toolkit:spec-review` first, then re-run `/pr`. Full manual, including the verbatim refusal text and the override path: `docs/hooks-reference.md`.

## Steps

1. Check `git status` and `git log` to understand what's being submitted
2. If on `main`, create a new branch from the changes:
   - Branch name format: `feat/short-description`, `fix/short-description`, or `chore/short-description`
3. If there are uncommitted changes, confirm with the user before staging and committing
4. Push the branch with `-u` flag
5. Create the PR using `gh pr create`:
   - **Draft**: when the invocation explicitly asks for one — the `--draft` flag, or plain English such as "open it as a draft" — pass `--draft` to `gh pr create`. The default is non-draft: an invocation that never asks for a draft is left exactly as it is today, with no `--draft` flag and no extra prompt.
   - **Unsupported draft**: when the host or the installed CLI cannot open a draft — the host does not support draft pull requests, the repository or fork disallows them, or the `gh` on this machine has no `--draft` flag — **refuse and say so**. Never silently open a normal pull request instead: a downgrade nobody was told about is exactly the misrepresentation this rule exists to prevent, and a silent skip is worse than a loud failure. Refuse in the canonical shape — `Refusing: cannot open a draft pull request — <reasons>.` / `Remedy: re-run /pr without the draft request to open a normal pull request, or open the draft manually on the host.` / `Context: host=<host> guards=<ids>` — and stop with zero side effects. Render it by calling `assertDraftSupported` in `adapters/_shared/src/pr_draft.ts` rather than retyping the wording here: that module is the single source of this refusal's text, and the shape above is quoted from it so the two cannot drift. The Remedy names the *request*, not the flag, because a draft can also be asked for in plain English; the Context names no PR URL, because the refusal lands before anything is created and there is no URL to name.
   - **Title**: always derived from the dominant commit's [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) subject — `<type>(<scope>): <title>`, ≤ 72 characters — with no user-supplied override path. Use `!` for breaking changes (`feat(api)!: drop legacy endpoint`). When the branch carries multiple commits, the dominant commit is the branch's own `chore(release):` commit when the branch carries one, otherwise the primary feature commit. Squash merging is enabled on this repository with the title source set to the commit-or-PR title, which takes the single commit's subject when the branch carries exactly one and this PR title once it carries two or more — so on a multi-commit branch a squash promotes this title to a commit subject on the trunk. The local commit-msg hook does not enforce that: it runs only on commits authored in a checkout, and every merge here is authored server-side.
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

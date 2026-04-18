---
name: pr
description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.
argument-hint: '[PR title]'
---

Create a pull request for the current branch.

## Tracker Mode Probe

Before creating the PR, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and the rest of this skill runs unchanged. If a tracker mode is active:

- Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` (FR-32) before any MCP write. Decline exits cleanly with zero side effects (AC-32.4).
- After the PR is created, call `transition_status(ticket, in_review)` and optionally `upsert_ticket_metadata` to add the PR URL to the ticket description (NFR-8 ≤ 2 MCP calls). Capability-missing cases degrade per FR-38 AC-38.6 (canonical-shape warning + proceed).

See `docs/pr-tracker-mode.md` for the full tracker-mode flow.

## Steps

1. Check `git status` and `git log` to understand what's being submitted
2. If on `main`, create a new branch from the changes:
   - Branch name format: `feat/short-description`, `fix/short-description`, or `chore/short-description`
3. If there are uncommitted changes, confirm with the user before staging and committing
4. Push the branch with `-u` flag
5. Create the PR using `gh pr create`:
   - Title: short, under 70 characters
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

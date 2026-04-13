---
name: pr
description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.
argument-hint: '[PR title]'
---

Create a pull request for the current branch.

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

---
id: fr_01KPXFS377P0YE847SRRPRGQH6
title: /implement M<N> → /ship-milestone prompt (opt-in chain, not auto-close)
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-75
created_at: 2026-04-23T15:07:00Z
---

## Requirement

`/implement` today supports milestone-scope invocation (`/implement M<N>`) — it walks the plan's FR list and implements each in turn. When the last FR archives cleanly, `/implement` exits with no indication that the milestone itself is now ripe for closing. The user must remember to run `/ship-milestone` as a separate action; forgetting leaves the milestone open with all its FRs shipped (confusing state) and the Release Checklist unrun.

STE-75 closes this gap with an explicit **opt-in prompt** at the end of a successful milestone-scope run: "All FRs in M<N> shipped. Run `/ship-milestone` now? (y/n)". On `y`, chain into `/ship-milestone M<N>` in the same session — its own approval gates still fire. On `n` or non-interactive context, print the precise command to run manually: `Ready to close milestone. Run: /ship-milestone M<N>`.

The design choice is **prompt, not silent chain** — violating "human approval before commit" at the milestone-close step would be a serious regression. Users sometimes want to pause between "last FR done" and "cutting release" for: manual CHANGELOG curation, a final `/simplify` sweep, a cold re-review of the milestone diff, or deferring the close to tomorrow. The prompt respects those uses.

The prompt NEVER fires for single-FR invocations (`/implement <FR-id>`) — only milestone-scope (`/implement M<N>`). It's also skipped if any FR gate-checked-failed during the run (milestone is not complete; there's nothing to close).

## Acceptance Criteria

- AC-STE-75.1: After `/implement M<N>` completes its FR loop with **all FRs in the milestone** having passed Phase 4 (archived to `specs/frs/archive/`, status transitioned, tracker metadata pushed), the skill prompts exactly once:

  ```
  All FRs in M<N> shipped.
  Run /ship-milestone M<N> now? (y/n):
  ```

  (Exact format, including the blank line separation. Prompts on stdout, reads from stdin.)
- AC-STE-75.2: On user input `y` / `yes` (case-insensitive, trimmed): `/implement` chains into `/ship-milestone M<N>` within the same session. All of `/ship-milestone`'s own gates (STE-73: unshipped-FR refusal impossible here since we just shipped all; dirty-working-tree refusal applies as usual; codename prompt applies; final approval gate on the release diff applies).
- AC-STE-75.3: On user input `n` / `no` / empty / anything else (case-insensitive): `/implement` does NOT chain. Prints:

  ```
  Ready to close milestone. Run: /ship-milestone M<N>
  ```

  and exits 0. The user can run the command manually at their leisure.
- AC-STE-75.4: The prompt is skipped entirely — no output, no chain — in these cases:
  - `/implement` was invoked with a single-FR arg (e.g., `/implement STE-42`), regardless of whether that FR happened to be the last active in some milestone.
  - `/implement` was invoked with `all` arg or no arg.
  - Any FR in the milestone's `specs/plan/M<N>.md` plan is still `status: active` after the run (milestone incomplete).
  - Any FR's Phase 4 gate-check failed during this session's run (partial success).
  - stdin is not a TTY (non-interactive context — CI, piped input). Prints the manual-command hint per AC-STE-75.3 instead of prompting, without accepting input.
- AC-STE-75.5: If user answers `y` but `/ship-milestone` fails to start (e.g., skill not registered, `skills/ship-milestone/` missing), `/implement` surfaces the error per NFR-10 and exits non-zero. The error names the specific failure and suggests manual invocation:

  ```
  /implement: attempted to chain into /ship-milestone but it failed to start: <error>.
  Remedy: verify the skill is installed (check plugins/dev-process-toolkit/.claude-plugin/plugin.json), then run /ship-milestone M<N> manually.
  Context: milestone=M<N>, chain=ship-milestone, skill=implement
  ```

- AC-STE-75.6: Chain behavior when user answers `y`: `/ship-milestone`'s own approval gate on the release diff (STE-73 AC-STE-73.6) is the deciding gate for the release commit — a `y` on the chain prompt does NOT pre-approve the release. User sees the release diff and explicitly approves it at that second gate. Refusal at the second gate exits cleanly without creating the release commit.
- AC-STE-75.7: `skills/implement/SKILL.md` gains one new sub-step at the end of the milestone-scope flow — named "Phase 5: Milestone close prompt (STE-75)". This sub-step is the LAST thing `/implement` does before exiting; nothing else happens between the prompt and process exit.

## Technical Design

**`skills/implement/SKILL.md` edits:** After the existing milestone-loop exit point (when all FRs are processed), add:

```
## Phase 5: Milestone close prompt (STE-75)

Conditions checked in order:
  1. Was /implement invoked with M<N> arg? (not FR-id, not 'all', not empty)
  2. Did every FR in specs/plan/M<N>.md have status transition from active → archived in this run?
  3. Is stdin a TTY?

If all three are true: print the prompt, read stdin, act per AC-STE-75.2 / .3.
If #3 is false but #1+#2 are true: print the manual-command hint (no prompt, no input read).
If #1 or #2 is false: exit silently without mentioning /ship-milestone.
```

**No new modules.** `/implement` already tracks milestone-scope invocations via its argument parsing; STE-75 just adds the post-loop decision.

**TTY detection:** Standard POSIX — `isatty(0)` / check `process.stdin.isTTY` in a Node context. In Claude Code skill context, the "TTY" proxy is "can the user reply to a prompt in the same session" — implementation-wise the skill just emits the prompt and waits for the next user turn. For the NFR-10 non-interactive path, the skill detects via environment (e.g., `CI=1` or explicit skill-level non-interactive flag) and prints the hint instead.

**Chain mechanism:** Same as `/implement` invoking `/gate-check` today — invoke the next skill in-session. No subprocess, no file-based handoff.

## Testing

Fixture scenarios (integration-level):
- Happy chain: milestone with 3 FRs, all implement successfully, user answers `y`, `/ship-milestone` runs (and its own approval prompt is shown). Assert: `/ship-milestone` invoked.
- Decline chain: same milestone, user answers `n`, prints hint, exits. Assert: `/ship-milestone` NOT invoked.
- Empty answer: same milestone, user presses enter with no input, treated as no. Assert: hint printed, no chain.
- Single-FR invocation: `/implement STE-X` (X being the last active FR in some milestone); assert no prompt.
- Partial failure: milestone with 3 FRs, FR 2 fails gate-check; `/implement` halts at FR 2 anyway (existing behavior); assert no prompt at any point.
- Incomplete milestone plan: milestone with an `active` FR that wasn't in the run's FR list (e.g., user ran `/implement M1 FR-2` syntax if that existed — it doesn't but as a safety check); assert no prompt.
- Non-TTY: stdin piped; assert hint printed, no input read.

Regression: `/implement <FR-id>` fixture runs byte-identically to pre-STE-75 behavior.

## Notes

**Why prompt not auto-chain.** The M20 brainstorm surfaced this tension: auto-chaining preserves ergonomics but violates the "human approval before commit" principle (CLAUDE.md #4). The release commit is the highest-stakes commit in the toolkit; requiring an explicit opt-in is the right gate. Users who find the prompt annoying can train their muscle memory to type `y` immediately — the friction is tiny, the safety benefit is real.

**Why single session, not "run /ship-milestone later".** Running in-session preserves context: the milestone's FR summaries, commit messages, and test outputs are all fresh in the assistant's working context, which makes `/ship-milestone`'s CHANGELOG-entry construction (AC-STE-73.4) more accurate. A fresh session would lose that fidelity.

**Not in scope:** more elaborate "what's next" UX (e.g., showing the summary of what `/ship-milestone` is about to do). That's `/ship-milestone`'s own job — it shows its own diff and prompts for its own approval. Keeping STE-75 minimal (one prompt, one branch) is the right scope.

**Interaction with STE-74's Phase 4b.** STE-75 runs AFTER all FRs have passed through Phase 4 (including 4b = doc fragment). So any pending fragments in `docs/.pending/` are already staged. `/ship-milestone` (chained via STE-75 `y`) will pick them up in its `/docs --commit --full` sub-step.

**Release target:** v1.23.0. Phase D of M20 plan (depends on STE-73).

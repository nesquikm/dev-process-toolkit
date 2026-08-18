# `/pr` Tracker Mode Flow

Detailed tracker-mode procedures for `/pr`. Pointed at from
`skills/pr/SKILL.md` to keep the skill lean.

In `mode: none`, this document is unused — the `mode: none` branch runs unchanged.

## Pre-flight (before PR creation)

1. Schema L probe → if `mode: none`, exit to `none` path.
2. Ticket-binding pre-flight per `docs/ticket-binding.md`. Decline
   exits cleanly with zero side effects.

## Draft pull requests on this path

Draft support is not a tracker-mode feature and not a tracker-less one — it is
a property of the `gh pr create` invocation, so it behaves identically here.
The draft state is decided **before** the PR is created: the invocation is
parsed for an explicit request (the `--draft` flag or plain English such as
"open it as a draft"), the host is checked for draft capability, and the
resulting `gh pr create …` argv either carries `--draft` or does not. Tracker
mode changes none of that — the same builder produces the same argv in
`mode: none`, `mode: linear`, and `mode: jira`.

Consequently the post-create steps below are **orthogonal to the draft
choice**: both run unchanged whether the PR was opened as a draft or ready for
review, and neither is skipped, reordered, or duplicated because of it.

**A draft still transitions the ticket to `in_review`.** This is deliberate and
stated here rather than left to the reader: a draft is "built, not yet claimed
ready", so an argument exists for holding the ticket back. The shipped
behaviour does not do that, for two reasons. First, the transition marks that
work has left the author's hands and is visible for review on the host — the
draft flag communicates readiness on the PR itself, which is where a reviewer
looks. Second, splitting the transition on draft state would make the
post-create sequence conditional and put the call budget below at the mercy of
an invocation flag. If the ticket should stay put, move it back in the tracker
after the fact; `/pr` does not infer that.

The refusal path is likewise shared: when the host cannot hold drafts and a
draft was explicitly asked for, `/pr` refuses with the canonical
`Refusing:` / `Remedy:` / `Context:` shape **before** anything is created — so
no PR is opened and no tracker call is made. A silent downgrade to a normal PR
never happens on either path.

## Post-create (after `gh pr create` returns)

After the PR URL is known:

1. **Transition status** — call the active adapter's
   `transition_status(ticket_id, "in_review")`. The adapter resolves the
   tracker-side label via `status_mapping`.
2. **Update ticket description with PR link** (optional, best-effort) —
   call `upsert_ticket_metadata(ticket_id, title, <description with PR
   URL appended>)`. This appends a `PR: <url>` line to the existing
   description body; it does NOT rewrite ACs (those have dedicated ops).

Both calls are best-effort: if either fails, surface a canonical-shape
warning and continue. PR creation is the primary side effect; tracker
updates are supplementary.

## Capability degradation

- **Adapter missing `transition_status`** → skip the status call; print:

  ```
  Adapter <name> does not support transition_status — ticket status unchanged.
  Remedy: transition the ticket to "In Review" manually in the tracker.
  Context: mode=<mode>, ticket=<ID>, skill=pr
  ```

- **Adapter missing `upsert_ticket_metadata`** → skip the PR-link
  update; print an equivalent warning. PR creation still succeeds.

Both warnings are `GATE PASSED WITH NOTES` equivalent — `/pr` doesn't
fail because of missing tracker capabilities.

## MCP call budget (NFR-8)

`/pr` makes at most **2** MCP calls total:

1. `transition_status(ticket, in_review)` — once per invocation.
2. `upsert_ticket_metadata(ticket, ...)` — once, optional (skip if the
   PR URL is already known to be stable in the tracker's UI without
   this update).

Budget respected even if the user runs `/pr` repeatedly on the same
branch — each invocation is independent, no memoization.

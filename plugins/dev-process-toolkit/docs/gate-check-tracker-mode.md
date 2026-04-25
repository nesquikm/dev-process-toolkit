# `/gate-check` Tracker Mode Flow

Detailed tracker-mode procedures for `/gate-check`. Pointed at from
`skills/gate-check/SKILL.md` to keep the skill under NFR-1 (≤300 lines).

In `mode: none`, this document is unused — the `mode: none` branch runs unchanged.

## Pre-flight sequence (mode-gated, in order)

### 1. Ticket-binding pre-flight (STE-27)

Run the 3-tier resolver and mandatory confirmation prompt per
`docs/ticket-binding.md`. Decline exits cleanly with zero side effects.

### 2. `updatedAt` re-check (AC-STE-11.3)

Call the active adapter's `pull_acs(ticket_id)` exactly once at skill
entry, and capture the returned ticket's `updatedAt`. Compare against the
value recorded at `/implement` start (session state — not disk).

- **Match** → continue to the gate commands.
- **Mismatch** → surface this canonical-shape warning and offer exactly
  two options (AC-STE-17.10; `/gate-check` does **not** run STE-17 resolution):

  ```
  Ticket was modified since /implement — review changes before proceeding.
  Remedy: choose — (a) retry after /implement (runs STE-17 diff/resolve), or (b) proceed knowing the session is stale.
  Context: mode=<mode>, ticket=<ID>, skill=gate-check
  ```

  The options are literally (a) and (b); there is no "merge" or "cancel
  with side effects" path here. On (a), the skill exits cleanly (user
  re-runs `/implement`). On (b), the skill proceeds — the user has
  accepted responsibility.

### 3. Gate commands (unchanged)

Run the project's gating commands (typecheck / lint / tests / optional
build / optional security audit) exactly as in `none` mode.

### 4. Code review + drift check (unchanged)

Inline review per the canonical rubric; drift check if `specs/` exists.

### 5. On pass — `push_ac_toggle` per completed AC

On `GATE PASSED` or `GATE PASSED WITH NOTES`, walk the session-cached AC
list and call the active adapter's `push_ac_toggle(ticket_id, ac_id,
state=true)` for each AC whose implementation newly satisfies its test.
AC state transitions `false → true` fire the call; already-true ACs are
skipped (idempotent).

## Capability degradation (STE-16 AC-STE-16.6)

If the active adapter's `capabilities:` frontmatter list does **not**
include `push_ac_toggle`, replace the step-5 push calls with this
canonical-shape warning and continue:

```
Adapter <name> does not support push_ac_toggle — AC checkboxes must be toggled manually in the tracker.
Remedy: open the ticket and toggle the passing ACs yourself, or upgrade the adapter.
Context: mode=<mode>, ticket=<ID>, skill=gate-check
```

Gate pass / fail verdict is unaffected by the missing capability.

## MCP call budget (NFR-8)

`/gate-check` makes **exactly one** MCP call on entry (`pull_acs` for the
re-fetch) plus **zero or more** `push_ac_toggle` calls on gate pass (one
per newly-satisfied AC, never more). Total ≤ 1 + N where N is the number
of ACs transitioning `false → true`. For the common case of a single-AC
change, total = 2.

## Parallelization interaction

`/gate-check` is typically run once per branch per session, so
parallelization concerns are minimal. If two parallel subagents both run
`/gate-check` against the same ticket, the second one's `pull_acs` sees
the first one's `push_ac_toggle` side effects — which is exactly the
detection intent of AC-STE-11.3 (`updatedAt` mismatch warns the user).

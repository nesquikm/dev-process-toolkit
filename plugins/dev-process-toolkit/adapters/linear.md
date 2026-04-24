---
name: linear
mcp_server: linear
ticket_id_regex: '^(?:[A-Z]{2,10})-([0-9]+)$'
ticket_id_source: branch-name
ac_storage_convention: description-section
status_mapping:
  in_progress: In Progress
  in_review: In Review
  done: Done
capabilities:
  - pull_acs
  - push_ac_toggle
  - transition_status
  - upsert_ticket_metadata
project_milestone: true
ticket_description_template: |
  {fr_body}

  ---

  Source: specs/frs/{tracker_id}.md
helpers_dir: adapters/linear/src
resolver:
  id_pattern: '^[A-Z]+-\d+$'
  url_host: 'linear.app'
  url_path_regex: '/[^/]+/issue/([A-Z]+-\d+)'
---

# Linear Adapter

ACs live as `- [ ]` / `- [x]` checkboxes under a `## Acceptance Criteria`
heading in the Linear issue description (AC-37.1). Linear normalizes markdown
on the server side — `normalize.ts` applies the same canonical form on both
pull and push so round-trips converge on the first iteration (AC-39.6,
AC-37.5).

## MCP tool names

> **Verified 2026-04-22 against the live authenticated Linear MCP.** The
> introspected surface is a single `mcp__linear__save_issue` tool for
> creates + updates; `mcp__linear__get_issue` is the sole read. Earlier
> `create_issue` / `update_issue` references in this adapter were incorrect
> and have been removed (FR-67).

| Operation | MCP tool | Canonical parameters | Notes |
|-----------|----------|----------------------|-------|
| `pull_acs` | `mcp__linear__get_issue` | `id` | Parse description section `## Acceptance Criteria`. |
| `push_ac_toggle` | `mcp__linear__save_issue` | `id`, `description` | Rewrite description with toggled box via semantic markdown diff (AC-37.5). |
| `transition_status` | `mcp__linear__save_issue` | `id`, **`state`** (accepts state type, name, or ID — no team.states lookup needed) | Pass the canonical status name resolved via `status_mapping` (e.g., `"In Progress"`). **Never** pass `stateId`, `status`, or any other variant — Linear silently ignores unknown keys. |
| `upsert_ticket_metadata` | `mcp__linear__save_issue` (omit `id` to create, pass `id` to update) | `id?`, `title`, `description`, **`assignee`** (accepts user ID, name, email, or `"me"`) | Body MUST include the back-link (AC-37.6). **Never** pass `assigneeId` or `assigneeEmail` — Linear silently ignores unknown keys. |

### Silent no-op trap (FR-67 AC-67.2)

`mcp__linear__save_issue` accepts *any* keys in its input and returns a
successful-looking response even when the keys it received are unknown —
the server echoes the pre-call state and never mutates the ticket. There
is no validation error.

Dogfooded 2026-04-22 during `/implement FR-57 FR-58`: `claimLock`'s
first attempt passed `status: "In Progress"` + `assigneeEmail: "..."`.
The response echoed the pre-call `updatedAt` and `status: "Backlog"`;
the session falsely believed the transition landed.

**Rule for every `save_issue` caller:** after the call, re-fetch the
ticket via `mcp__linear__get_issue` (or the returned payload) and assert
that at least one of `updatedAt` / `startedAt` / `completedAt` advanced
past the pre-call value before treating the call as successful. If none
advanced, the write was silently no-op'd — treat it as a hard failure
and surface an NFR-10 canonical-shape error.

`adapters/_shared/src/tracker_provider.ts` encodes this as
`TrackerWriteNoOpError`; `TrackerProvider.claimLock` and
`TrackerProvider.releaseLock` perform the post-call `updatedAt` check
automatically. Adapter driver implementations MUST populate
`TicketStatusSummary.updatedAt` so the guard can fire — see
`docs/tracker-adapters.md` § Silent no-op trap for the cross-adapter
pattern.

### claimLock-skipped trap (STE-65)

Symmetric trap on the release side. If `/implement` Phase 1 step 0.c
(`Provider.claimLock`) is skipped — either by a manual invocation that
started later than entry, or by a session that resumed mid-run without
the claim firing — the ticket stays in `Backlog` while implementation
proceeds. At Phase 4 Close, a naive `releaseLock` would call
`transitionStatus('done')` and leap `Backlog → Done`, skipping
`In Progress` entirely (no `startedAt` ever set on the Linear ticket —
exactly what STE-60/STE-61/STE-62 shipped with during M18).

`TrackerProvider.releaseLock` now re-fetches the ticket's current status
before `transitionStatus` and asserts the pre-state is `"in_progress"`.
Any other pre-state (`backlog`, `unstarted`, `cancelled`, `done`,
`completed`) raises `TrackerReleaseLockPreconditionError` without calling
`transitionStatus`. Complement to the post-write `TrackerWriteNoOpError`:
pre-write asserts the ticket is in the expected state, post-write asserts
the write landed. Both layers together make `releaseLock` fail-closed.

No extra MCP call — the pre-state check reuses the `getTicketStatus`
fetch that the post-write `updatedAt` guard already does (NFR-8 call
budget preserved). The error carries the ticket ref, tracker key, and
observed status; operators fix either by transitioning the ticket to
`In Progress` manually or by rerunning `/implement` from Phase 1 so
`claimLock` fires.

## Endpoint migration (AC-30.9)

Linear's legacy `https://mcp.linear.app/sse` endpoint is retired. `/setup`
detects the stale URL in `claude mcp list` output and offers a dry-run
settings.json diff to `https://mcp.linear.app/mcp`. The current MCP uses
the Streamable-HTTP transport; tool names and shapes remain compatible.

## Operations

### `pull_acs(ticket_id) → AcList`

1. Call `mcp__linear__get_issue(id=ticket_id)`.
2. Extract the full description blob.
3. Pipe the blob through `bun run adapters/linear/src/normalize.ts`
   (stdin = full blob, stdout = canonical-form `## Acceptance Criteria`
   block; empty string if no AC section).
4. Parse the normalized block into Schema N `AcceptanceCriterion[]`:
   - Each canonical line matches `^(?<indent>\s*)- \[(?<state>[ x])\] (?<text>.*)$`.
   - `id` is the leading `AC-X.Y` token in `text` when present; otherwise
     assign an adapter-local `linear-<n>` id (the mirror in
     `specs/requirements.md` is canonical for ID semantics — Path B).
   - `completed = state === "x"`.
5. If the parsed list is empty, fail the skill with NFR-10 canonical shape
   (`"No acceptance criteria found in ticket <ID>"`, Remedy, Context) per
   AC-35.4. Never silently proceed on empty.

### `push_ac_toggle(ticket_id, ac_id, state) → void`

1. `mcp__linear__get_issue(id=ticket_id)` to read the current description.
2. Pipe through `normalize.ts` to get the canonical block.
3. Toggle the single bullet whose `id` matches `ac_id`; leave all other
   bullets byte-identical to the canonical form (semantic markdown diff —
   AC-37.5).
4. Reassemble the full description: preamble + canonical block + suffix.
5. `mcp__linear__save_issue(id=ticket_id, description=<new body>)`.
6. On Linear's server-side re-normalization round-trip, the canonical form
   is a fixpoint (AC-39.6); `pull_acs` immediately after push returns the
   same list.

### `transition_status(ticket_id, status) → void`

1. Resolve the target status name: look up `status_mapping[status]` (e.g.,
   `in_review → "In Review"`). No team.states lookup is needed — Linear's
   `save_issue` accepts the state name directly via the `state` parameter.
2. `mcp__linear__save_issue(id=ticket_id, state=<resolved name>)`. **Never
   pass `stateId` or `status`** — Linear silently ignores unknown keys
   (§ Silent no-op trap). Callers MUST verify `updatedAt`/`startedAt`
   advanced before treating the call as successful.
3. Unknown `status` values fail with NFR-10 canonical shape.

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

1. If `ticket_id_or_null === null`:
   - `mcp__linear__save_issue(team=<project team>, title, description=<rendered template>)` (create: omit `id`).
   - Capture the returned issue ID.
2. Else:
   - `mcp__linear__save_issue(id=ticket_id_or_null, title, description=<rendered template>)` (update: pass `id`).
3. When setting the assignee, pass `assignee` (accepts ID, name, email, or
   `"me"`). **Never pass `assigneeId` or `assigneeEmail`** — Linear
   silently ignores unknown keys (§ Silent no-op trap).
4. Render `ticket_description_template` with `{fr_body}` = full FR
   description body and `{tracker_id}` = the FR's Linear ticket ID (e.g.
   `STE-67`). The back-link line `Source: specs/frs/{tracker_id}.md` is
   mandatory (AC-37.6) and routes readers to the file-per-FR spec file.
   STE-67 retired the old `{fr_anchor}` variable + `specs/requirements.md#...`
   path — the v1 monolithic-requirements layout has no v2 equivalent.
5. Return the issue ID. After the call, the `TrackerProvider` post-write
   guard verifies `updatedAt` advanced; a silent no-op raises
   `TrackerWriteNoOpError`.

## Helper: `normalize.ts`

Pure function over text (Schema P):

- CRLF → LF
- Trailing whitespace per line stripped
- Bullet syntax canonicalized (`- [ ] `, `- [x] ` with exact spacing)
- Non-AC preamble / trailing headings excluded from output
- Idempotent: `normalize(normalize(x)) === normalize(x)` for all inputs
- No network; no auth; JSON stdin not required (the helper takes a raw
  description blob)

Run the unit tests with `bun test adapters/linear/src/normalize.test.ts`.

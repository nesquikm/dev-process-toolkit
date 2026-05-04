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
| `upsert_ticket_metadata` | `mcp__linear__save_issue` (omit `id` to create, pass `id` to update) | `id?`, `title`, `description`, **`assignee`** (accepts user ID, name, email, or `"me"`), **`team?`** (required on create — sourced from `### Linear`.team if not passed), **`project?`** (required on create — sourced from `### Linear`.project if not passed), **`labels?`** (optional on create — sourced from `### Linear`.default_labels when populated) | Body MUST include the back-link to `specs/frs/<TICKET-ID>.md`. **Never** pass `assigneeId` or `assigneeEmail` — Linear silently ignores unknown keys. On create, both `team` and `project` MUST be present (resolved from the call argument or from the workspace binding sub-section); reject the call if neither source supplies a value. **Labels:** when `### Linear`.default_labels is populated (free-form sub-section field, parsed as inline-YAML array per `docs/patterns.md`) **or** the call argument carries `labels`, forward every entry as the `labels` parameter to `save_issue` (Linear MCP accepts either label IDs or names). Empty array or missing key ⇒ no `labels` field is forwarded. On update (with `id`), `team`, `project`, and `labels` are not forwarded — Linear cannot reassign team/project/labels on an existing issue without explicit operator intent (`save_issue.labels` is also append-only on update per the MCP contract, so silent overrides would surprise the operator). |

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

**Missing `project` on create is a silent landing failure.**
Linear's `mcp__linear__save_issue` requires `team` (the call fails loudly
without it) but treats `project` as optional. A create call that omits
`project` succeeds — the ticket lands in the team's default view, outside
the user's expected project board. The adapter MUST read `### Linear`.project
from `CLAUDE.md` (via `readWorkspaceBinding(claudeMdPath, "linear")`) and
forward it as the `project` field. If neither the call argument nor the
sub-section value is available, **reject the create** with NFR-10 canonical
shape rather than silently landing in the no-project default. Discovered
2026-04-27 when newly created tickets landed outside the user's project
board because the adapter dropped the missing-project signal.

`adapters/_shared/src/tracker_provider.ts` encodes this as
`TrackerWriteNoOpError`; `TrackerProvider.claimLock` and
`TrackerProvider.releaseLock` perform the post-call `updatedAt` check
automatically. Adapter driver implementations MUST populate
`TicketStatusSummary.updatedAt` so the guard can fire — see
`docs/tracker-adapters.md` § Silent no-op trap for the cross-adapter
pattern.

### claimLock-skipped trap

Symmetric trap on the release side. If `/implement` Phase 1 step 0.c
(`Provider.claimLock`) is skipped — either by a manual invocation that
started later than entry, or by a session that resumed mid-run without
the claim firing — the ticket stays in `Backlog` while implementation
proceeds. At Phase 4 Close, a naive `releaseLock` would call
`transitionStatus('done')` and leap `Backlog → Done`, skipping
`In Progress` entirely (no `startedAt` ever set on the Linear ticket —
the silent failure mode the per-FR claim runbook closes).

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

## Operations

### `pull_acs(ticket_id) → AcList`

1. Call `mcp__linear__get_issue(id=ticket_id)`.
2. Extract the full description blob.
3. Pipe the blob through `stripLinearACFences` (`adapters/linear/src/format_description.ts`) — strips backtick-wrapped AC prefixes and legacy `<issue id>` auto-link wrappers in the AC-prefix shape, leaving bare issue references in prose untouched.
4. Pipe the stripped blob through `bun run adapters/linear/src/normalize.ts`
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

### `upsert_ticket_metadata(ticket_id_or_null, title, description, team?, project?, labels?) → ticket_id`

**Backtick-wrap AC prefixes on emit.** Before passing `description` to `mcp__linear__save_issue`, run `formatLinearDescription(description)` from `adapters/linear/src/format_description.ts` to wrap AC prefixes in inline-code fences. Linear's auto-linker treats backticked tokens as literal code and skips them, so the round-trip stays byte-identical after the pull-side strip. Idempotent — applying twice is a no-op. Linear-only; Jira / custom adapters do not auto-link, so wrapping there would be cosmetic noise.


1. If `ticket_id_or_null === null`:
   - Resolve `team` and `project` per the workspace binding contract: if
     not passed by the caller, read them from `### Linear` in CLAUDE.md via
     `readWorkspaceBinding(claudeMdPath, "linear")`. Reject the call with
     NFR-10 canonical shape if either is unresolved (the silent-landing
     trap is the precise failure mode this guards against).
   - Resolve `labels` per the same workspace binding contract:
     if not passed by the caller, read `default_labels` from `### Linear`
     via `readWorkspaceBinding(...)` (parsed as `defaultLabels: string[]`).
     Empty array or absent key ⇒ no `labels` field is forwarded; the
     create call lands without labels and Linear's per-team default
     labelling applies.
   - `mcp__linear__save_issue(team=<resolved>, project=<resolved>, title, description=<rendered template>, labels=<resolved or omitted>)` (create: omit `id`).
   - Capture the returned issue ID.
2. Else:
   - `mcp__linear__save_issue(id=ticket_id_or_null, title, description=<rendered template>)` (update: pass `id`). `team` / `project` /
     `labels` are **not** forwarded on update — once a ticket is bound to a
     workspace, reassignment requires explicit operator intent.
3. When setting the assignee, pass `assignee` (accepts ID, name, email, or
   `"me"`). **Never pass `assigneeId` or `assigneeEmail`** — Linear
   silently ignores unknown keys (§ Silent no-op trap).
4. Render `ticket_description_template` with `{fr_body}` = full FR
   description body and `{tracker_id}` = the FR's Linear ticket ID (e.g.
   `LIN-67`). The back-link line `Source: specs/frs/{tracker_id}.md` is
   mandatory and routes readers to the file-per-FR spec file. The legacy
   `{fr_anchor}` variable + `specs/requirements.md#...` path has been
   retired — the v1 monolithic-requirements layout has no v2 equivalent.
5. Return the issue ID. After the call, the `TrackerProvider` post-write
   guard verifies `updatedAt` advanced; a silent no-op raises
   `TrackerWriteNoOpError`.

### `attach_project_milestone(ticket_id, milestone_name) → void`

Idempotent binding from a Linear issue to a project milestone matching the local plan-file H1 heading. Implemented by `attachProjectMilestone(provider, project, milestoneName, ticketId)` in `adapters/_shared/src/attach_project_milestone.ts`; called by `/implement` Phase 1 step 0.f when the adapter declares `project_milestone: true` (see frontmatter above). Procedure:

1. List milestones in `project` via `mcp__linear__list_milestones`.
2. If `milestone_name` is absent from the list, create it via `mcp__linear__save_milestone(project, name=milestone_name)`.
3. Attach the ticket via `mcp__linear__save_issue(id=ticket_id, milestone=milestone_name)` — the parameter is the milestone *name* (string), not an ID. Linear silently dropping `milestone:` would cause `getIssue` to round-trip `projectMilestone == null`; the post-write verify catches the silent no-op (FR-67 pattern).
4. Re-fetch via `mcp__linear__get_issue(id=ticket_id)` and assert `projectMilestone.name === milestone_name`. Mismatch → raise `MilestoneAttachmentError` (NFR-10 canonical shape).

**Capability-gap surfacing in FR `## Notes` (STE-194).** When the adapter cannot attach (e.g., Linear project starts with zero milestones and the smoke driver has not seeded one), `/spec-write` declares the gap by writing the canonical `milestone_attach_unavailable` capability key into the new FR's `## Notes` section (per `skills/spec-write/SKILL.md` § Step 7's capability-key map). `/gate-check` probe #26 (`tracker-project-milestone-attached`) reads the same token from `## Notes` and downgrades the missing-binding outcome from GATE FAILED to ADVISORY (see `skills/gate-check/SKILL.md` § probe #26 decision table). The round-trip — write the token in spec-write, read the token in gate-check — keeps the audit trail visible without false-positive gate failures on intentional capability gaps.

> **Symmetric note (Gateway-Timeout idempotency hardening).** Linear's `save_issue` shares the same
> Gateway-Timeout class of failure mode as Jira's `createJiraIssue` —
> the Linear MCP can return a network-error response while the
> server-side write has already landed. Smoke #6 surfaced the defect on
> Jira only, but the mitigation applies to both adapters: on a network
> error during create, retry the idempotency probe with backoff
> (`1s + 2s + 4s`, three attempts via `mcp__linear__list_issues`
> filtered by `query=<title>`) before falling through to a fresh
> create. Persistent miss after backoff ⇒ surface
> `tracker_idempotency_uncertain` in /spec-write Step 7 (same canonical
> capability key as Jira). See `adapters/jira.md` § `upsert_ticket_metadata`
> for the full schedule and rationale.

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

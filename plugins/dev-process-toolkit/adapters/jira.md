---
name: jira
mcp_server: atlassian
ticket_id_regex: '^([A-Z][A-Z0-9]{1,9}-[0-9]+)$'
ticket_id_source: branch-name
ac_storage_convention: custom-field
status_mapping:
  in_progress: In Progress
  in_review: In Review
  done: Done
capabilities:
  - pull_acs
  - push_ac_toggle
  - transition_status
  - upsert_ticket_metadata
project_milestone: false
ticket_description_template: |
  {fr_body}

  ---

  Source: specs/frs/{tracker_id}.md
helpers_dir: adapters/jira/src
resolver:
  id_pattern: '^[A-Z][A-Z0-9]{1,9}-\d+$'
  url_host: '<your Jira host, e.g., example.atlassian.net>'
  url_path_regex: '/browse/([A-Z][A-Z0-9]{1,9}-\d+)'
---

# Jira Adapter

ACs live in a **per-tenant custom field**. The GID (e.g., `customfield_10047`)
varies per Jira project, so `/setup` runs one-time discovery via
`/rest/api/3/field` introspection and records it as `jira_ac_field:
customfield_XXXXX` in `## Task Tracking` (AC-30.6). All subsequent reads and
writes of AC content pass through that recorded GID — never hard-coded.

## MCP tool names

> **Status: provisional (Phase H conformance).** This env has no Atlassian
> MCP configured, so `tools/list` introspection couldn't be performed at
> implementation time. Names below follow the Atlassian Rovo MCP public
> documentation and the `mcp__<server>__<tool>` convention. Phase H Task 2
> (Tier 5 manual conformance) re-verifies against a live authenticated
> Atlassian MCP.

| Operation | MCP tool | Notes |
|-----------|----------|-------|
| `pull_acs` | `mcp__atlassian__get_issue` | Extract the `fields[<jira_ac_field>]` value; parse per the AC convention documented in the field's description template. |
| `push_ac_toggle` | `mcp__atlassian__update_issue` | Set the single field identified by `jira_ac_field` to the updated AC block. |
| `transition_status` | `mcp__atlassian__transition_issue` | Resolve transition id via `get_transitions` + `status_mapping`. |
| `upsert_ticket_metadata` | `mcp__atlassian__create_issue` (new) / `mcp__atlassian__update_issue` (existing) | Body MUST include the back-link (AC-37.6). **STE-117:** on create, `project` is required (Jira API requirement) — sourced from the call argument or `### Jira`.project in CLAUDE.md; reject with NFR-10 canonical shape if neither supplies a value. `team` does not apply to Jira and is silently dropped if forwarded. |

### Silent no-op trap

> **Provisional.** The concrete Jira tool surface in this subsection is
> tentative until a live authenticated Atlassian MCP is introspected (H3
> stays open). The shared-code behavior described below fires for every
> adapter via `adapters/_shared/src/tracker_provider.ts`, so the trap itself
> is adapter-agnostic — the Jira-specific tool names + parameter lists are
> what's provisional.

Any write operation that addresses fields or transitions Jira doesn't know
about (unknown field GIDs, transition IDs that don't exist in the current
workflow) can return a successful-looking response while mutating nothing
on the ticket. There is no canonical validation error for "unknown field"
in every Jira MCP; the caller can't distinguish success from silent no-op
by the response shape alone.

**Rule for every write caller:** after the call, re-fetch the ticket and
assert that at least one of `updated` / `statuscategorychangedate` (or the
Jira-MCP equivalent of Linear's `updatedAt` / `startedAt` / `completedAt`)
advanced past the pre-call value before treating the call as successful.
If none advanced, the write was silently no-op'd — treat it as a hard
failure and surface an NFR-10 canonical-shape error.

`adapters/_shared/src/tracker_provider.ts` encodes this as
`TrackerWriteNoOpError`; `TrackerProvider.claimLock` and
`TrackerProvider.releaseLock` perform the post-call `updatedAt` check
automatically for every adapter, not just Linear. Adapter driver
implementations MUST populate `TicketStatusSummary.updatedAt` so the guard
can fire — see `docs/tracker-adapters.md` § Silent no-op trap for the
cross-adapter pattern and `adapters/linear.md` § Silent no-op trap for the
reference implementation that was dogfooded against a live MCP.

### claimLock-skipped trap (STE-65)

Symmetric trap on the release side. If `/implement` Phase 1 step 0.c
(`Provider.claimLock`) is skipped — either by a manual invocation that
started later than entry, or by a session that resumed mid-run without
the claim firing — the Jira ticket stays in `Backlog` (or equivalent
pre-start status) while implementation proceeds. At Phase 4 Close, a
naive `releaseLock` would call `transitionStatus('done')` and leap
`Backlog → Done`, skipping `In Progress` entirely (no `startedAt`-like
timestamp ever set on the Jira ticket).

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
`claimLock` fires. This guard is adapter-agnostic — the shared code fires
regardless of whether the driver is `linear`, `jira`, or a custom adapter.

## Self-hosted Jira

v1 supports Atlassian Cloud only via the Rovo MCP. Self-hosted Jira is
explicitly out of scope (requirements §5 M12 out-of-scope). A community
adapter may override `mcp_server:` and retest.

## Operations

### `pull_acs(ticket_id) → AcList`

1. Call `mcp__atlassian__get_issue(issueIdOrKey=ticket_id, fields=["<jira_ac_field>"])`.
2. Read the value at `fields[<jira_ac_field>]`. Atlassian Document Format
   (ADF) or plain-text; either way, extract bullet-list items.
3. Each extracted bullet becomes a Schema N `AcceptanceCriterion`:
   - `id` is the leading `AC-X.Y` token if present; otherwise an
     adapter-local `jira-<n>` id.
   - `text` is the trimmed bullet body.
   - `completed` — Jira doesn't have native checkboxes in text fields;
     adopt the `- [x]` / `- [ ]` prefix convention (same form as Linear),
     or map to a companion boolean subtask if the project admin chose that.
4. If the field is absent or empty, fail the skill with NFR-10 canonical
   shape `"No acceptance criteria found in ticket <ID>"` per AC-35.4.

### `push_ac_toggle(ticket_id, ac_id, state) → void`

1. `mcp__atlassian__get_issue(ticket_id, fields=["<jira_ac_field>"])` to
   read the current AC block.
2. Toggle the single bullet whose `id` matches `ac_id`.
3. `mcp__atlassian__update_issue(issueIdOrKey=ticket_id, fields={ "<jira_ac_field>": <new value> })`.
4. Jira does not server-side normalize markdown; the pushed form is the
   canonical form (no round-trip loop).

### `transition_status(ticket_id, status) → void`

1. `mcp__atlassian__get_transitions(ticket_id)` → list of available
   transitions for the issue's current workflow.
2. Resolve `status_mapping[status]` → target workflow name, then match the
   transition whose `to.name` equals it.
3. `mcp__atlassian__transition_issue(ticket_id, transition={ id: <matched id> })`.
4. Unknown `status` values (or a missing transition) fail with NFR-10
   canonical shape.

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

1. If `ticket_id_or_null === null`:
   - `mcp__atlassian__create_issue(projectKey=<from CLAUDE.md>, summary=title, description=<rendered template>, issuetype="Story")`.
   - Capture the returned `key` (e.g., `ABC-123`); that's the ticket id.
2. Else:
   - `mcp__atlassian__update_issue(issueIdOrKey=ticket_id_or_null, fields={ summary, description })`.
3. Render `ticket_description_template` with `{fr_body}` and `{tracker_id}`
   (Jira key, e.g. `ABC-123`) substituted; back-link to
   `specs/frs/{tracker_id}.md` is mandatory (AC-37.6). STE-67 retired the
   v1 `{fr_anchor}` + `specs/requirements.md#...` form.
4. Return the ticket id.

## Helper: `discover_field.ts`

One-time per-project custom-field GID discovery. Called by `/setup` when the
user picks `jira` (AC-30.6).

- JSON on stdin: `{ fields: <full response of GET /rest/api/3/field> }`
- JSON on stdout: `{ ok: true, gid: "customfield_XXXXX", name: "..." }` on
  success, or `{ ok: false, reason: "..." }` if no AC field is found.
- No network calls (Schema P pure function); the caller shells out to the
  Atlassian MCP and pipes the response in.
- Matching strategy (in order):
  1. Exact name `"Acceptance Criteria"` (case-insensitive)
  2. Partial name containing `"Acceptance Criteria"`
  3. Name containing `"AC"` as a whole word (fallback)
- If multiple fields match, prefer the exact-name hit; tie-break by lowest
  GID numeric suffix.
- If zero fields match, return `{ ok: false }` so `/setup` can prompt the
  user to create the field and re-run discovery.

Tests: see `discover_field.test.ts` (run with `bun test`).

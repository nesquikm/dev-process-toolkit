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

  Source: specs/requirements.md#{fr_anchor}
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

> **Status: provisional (Phase H conformance).** This env has Linear MCP
> configured at the deprecated V1 SSE endpoint and unauthenticated, so
> `tools/list` introspection couldn't be performed at implementation time.
> Names below follow Linear's public MCP documentation and the
> `mcp__<server>__<tool>` convention. Phase H Task 2 (Tier 5 manual
> conformance) re-verifies against a live authenticated Linear MCP.

| Operation | MCP tool | Notes |
|-----------|----------|-------|
| `pull_acs` | `mcp__linear__get_issue` | Parse description section `## Acceptance Criteria`. |
| `push_ac_toggle` | `mcp__linear__update_issue` | Rewrite description with toggled box via semantic markdown diff (AC-37.5). |
| `transition_status` | `mcp__linear__update_issue` | Pass `stateId` resolved via `status_mapping`. |
| `upsert_ticket_metadata` | `mcp__linear__create_issue` (new) / `mcp__linear__update_issue` (existing) | Body MUST include the back-link (AC-37.6). |

## Endpoint migration (AC-30.9)

Linear's V1 SSE endpoint `https://mcp.linear.app/sse` shuts down 2026-05-11.
`/setup` detects `https://mcp.linear.app/sse` in `claude mcp list` output and
offers a dry-run settings.json diff to V2 `https://mcp.linear.app/mcp`. The
V2 MCP uses the Streamable-HTTP transport; tool names and shapes remain
compatible.

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
5. `mcp__linear__update_issue(id=ticket_id, description=<new body>)`.
6. On Linear's server-side re-normalization round-trip, the canonical form
   is a fixpoint (AC-39.6); `pull_acs` immediately after push returns the
   same list.

### `transition_status(ticket_id, status) → void`

1. Resolve the target Linear state ID: look up `status_mapping[status]`
   (e.g., `in_review → "In Review"`), then query the team's states via
   `mcp__linear__list_teams` / team.states to get the state ID.
2. `mcp__linear__update_issue(id=ticket_id, stateId=<resolved>)`.
3. Unknown `status` values fail with NFR-10 canonical shape.

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

1. If `ticket_id_or_null === null`:
   - `mcp__linear__create_issue(teamId=<project team>, title, description=<rendered template>)`.
   - Capture the returned issue ID.
2. Else:
   - `mcp__linear__update_issue(id=ticket_id_or_null, title, description=<rendered template>)`.
3. Render `ticket_description_template` with `{fr_body}` = full FR
   description body and `{fr_anchor}` = `FR-{N}`. The back-link line
   `Source: specs/requirements.md#{fr_anchor}` is mandatory (AC-37.6).
4. Return the issue ID.

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

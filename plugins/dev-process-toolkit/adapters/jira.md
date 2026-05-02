---
name: jira
mcp_server: atlassian
ticket_id_regex: '^([A-Z][A-Z0-9]{1,9}-[0-9]+)$'
ticket_id_source: branch-name
ac_storage_convention: jira-ac-field-dispatched
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

> Verified against live MCP 2026-04-29 (smoke-test #5).

ACs live in one of two places, dispatched by the value of the existing
top-level Schema L key `jira_ac_field:` under `## Task Tracking`:

- `jira_ac_field: customfield_XXXXX` — per-tenant **custom field** path. The
  GID varies per Jira project; `/setup` runs `/rest/api/3/field`
  introspection (via `discover_field.ts`) and records the GID. AC reads /
  writes go through that field.
- `jira_ac_field: description` — **description-body** path (sentinel value).
  No custom field exists in this project (or the operator opted out of
  creating one — common for team-managed Kanban templates that ship without
  one). AC reads / writes parse and rewrite the bullet list under the
  `## Acceptance Criteria` heading inside the issue's description body. The
  heading is the parse anchor; bullets outside that section are ignored on
  read; `push_ac_toggle` rewrites the entire `## Acceptance Criteria` section
  atomically.

`jira_ac_field:` is the same canonical Schema L key in both cases — no new
key was added. The discriminator is the value: any string matching
`customfield_\d+` is a custom-field GID; the literal string `description`
is the description-body sentinel; any other value is rejected with
NFR-10 canonical shape during `/setup`.

## MCP tool names

| Operation | MCP tool | Notes |
|-----------|----------|-------|
| `pull_acs` | `mcp__atlassian__getJiraIssue` | Branches on `jira_ac_field`: read the custom-field value (custom-field path) or the issue's description body (description path) and parse `## Acceptance Criteria` bullets. |
| `push_ac_toggle` | `mcp__atlassian__editJiraIssue` | Branches on `jira_ac_field`: write back the toggled custom-field value or rewrite the description's `## Acceptance Criteria` section atomically. Pass `contentFormat: "markdown"` to round-trip markdown without ADF conversion. |
| `transition_status` | `mcp__atlassian__transitionJiraIssue` | Resolve transition id via `getTransitionsForJiraIssue` + `status_mapping`. Primary match is `to.name`; fallback is `to.statusCategory.key` (canonical category). |
| `upsert_ticket_metadata` | `mcp__atlassian__createJiraIssue` (new) / `mcp__atlassian__editJiraIssue` (existing) | Body MUST include the back-link to `specs/frs/<TICKET-ID>.md`. On create, `project` is required (Jira API requirement) — sourced from the call argument or `### Jira`.project in CLAUDE.md; reject with NFR-10 canonical shape if neither supplies a value. `team` does not apply to Jira and is silently dropped if forwarded. **Labels:** when `### Jira`.default_labels is populated (free-form sub-section field, parsed as inline-YAML array per `docs/patterns.md`) **or** the call argument carries `labels`, forward every entry into `createJiraIssue.additional_fields.labels` (the only Jira-MCP path for setting labels — there is no top-level `labels` parameter, see the `mcp__atlassian__createJiraIssue` schema). Empty array or missing key ⇒ no `labels` field is set. **Update path** (`editJiraIssue`): labels are not modified — `defaultLabels` applies only on create per the workspace-binding rule. Default issue type is `Task`; override via `jira_issue_type:` in `### Jira`. Pass `contentFormat: "markdown"` so the rendered description body keeps its markdown shape. |
| `addCommentToJiraIssue` | `mcp__atlassian__addCommentToJiraIssue` | Available on the live MCP surface (smoke-test #5 enumerated tool list) for callers that need to post a markdown comment. Pass `contentFormat: "markdown"`. No /implement-internal caller today. |
| Project visibility probe | `mcp__atlassian__getVisibleJiraProjects` | Called by `/setup` step 7b before any other Jira operation; refuses with NFR-10 canonical shape when the configured `project` key is not visible to the authenticated principal. |

> **No `deleteJiraIssue` tool.** The MCP surface does not expose issue
> deletion. `/spec-archive` for Jira transitions the ticket to `Done` (or a
> `Cancelled`-equivalent) — never deletes. This is a hard constraint, not a
> policy choice.

### Silent no-op trap

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

### claimLock-skipped trap

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
explicitly out of scope. A community adapter may override `mcp_server:`
and retest.

## Space pre-creation (manual prerequisite)

The Atlassian Rovo MCP exposes no project-creation tool, so the operator
**must create the Space (Jira project) in the Jira UI before running
`/setup`**. `/setup` for `mode: jira` records the project key in the
`### Jira` sub-section under `## Task Tracking`; on every subsequent run,
the adapter validates that the configured key is visible to the
authenticated principal via `mcp__atlassian__getVisibleJiraProjects`.

If the project is **not visible** (key typo, OAuth principal lacks
membership, project archived), refuse with NFR-10 canonical shape:

```
Jira project '<key>' not visible to the authenticated principal.
Remedy: create the Space in the Jira UI before running /setup, or grant the OAuth principal membership; then re-run the failing skill — `/setup` for first-time recording, `/setup --migrate` to re-record an already-bound project key.
Context: mode=jira, project=<key>, skill=<caller>
```

Refusing here is load-bearing: a silent fall-through would let Jira
operations fail later with opaque permission errors. Visibility check is
~50ms and runs before any other Jira call (NFR-8 call budget).

## Operations

### `pull_acs(ticket_id) → AcList`

Dispatches on the value of `jira_ac_field` recorded in `## Task Tracking`.

**Custom-field path** (`jira_ac_field: customfield_XXXXX`):

1. Call `mcp__atlassian__getJiraIssue(issueIdOrKey=ticket_id, fields=["<jira_ac_field>"], contentFormat: "markdown")`.
2. Read the value at `fields[<jira_ac_field>]`. With
   `contentFormat: "markdown"` the field renders as markdown text; without
   it, Atlassian Document Format (ADF) or plain text. Either way, extract
   bullet-list items.
3. Each extracted bullet becomes a Schema N `AcceptanceCriterion`:
   - `id` is the leading `AC-X.Y` token if present; otherwise an
     adapter-local `jira-<n>` id.
   - `text` is the trimmed bullet body.
   - `completed` — adopt the `- [x]` / `- [ ]` prefix convention (same
     form as Linear), or map to a companion boolean subtask if the
     project admin chose that.
4. If the field is absent or empty, fail the skill with NFR-10 canonical
   shape `"No acceptance criteria found in ticket <ID>"` per AC-35.4.

**Description-body path** (`jira_ac_field: description`):

1. Call `mcp__atlassian__getJiraIssue(issueIdOrKey=ticket_id, fields=["description"], contentFormat: "markdown")`.
2. Read the issue's description body as markdown text. Locate the literal
   heading line `## Acceptance Criteria` (case-sensitive). Bullet-list
   items between that heading and the next `##`-level heading (or EOF) are
   the AC block; bullets outside the section are ignored on read.
3. Map each bullet to a Schema N `AcceptanceCriterion` with the same
   `id` / `text` / `completed` extraction rules as the custom-field path.
4. If the heading is absent or the section contains no bullets, fail with
   the same NFR-10 canonical shape as above.

The two paths share the bullet-extraction helper; only the source string
(custom-field value vs. description body) differs.

#### ADF round-trip artifact (escape tolerance)

When the description body is sent through `mcp__atlassian__createJiraIssue`,
markdown bullets are converted into Atlassian Document Format (ADF) and then
re-rendered back to markdown on `mcp__atlassian__getJiraIssue`. The
round-trip is not byte-stable — input `- [x] AC N: ...` re-renders as
`* \[x\] AC N: ...` (asterisk-bullet marker + ADF-escaped square brackets,
e.g. `\[x\]` and `\[ \]`). The Jira UI renders the escaped form correctly
as a checkbox; raw markdown tooling sees the literal escape sequence.

The bullet-extraction helper tolerates both `[x]`/`[ ]` and the escaped
`\[x\]`/`\[ \]` form by design — the parser regex makes the leading
backslash optional. Coverage: `adapters/_shared/src/jira_pull_acs.ts`,
unit-tested in `jira_pull_acs.test.ts`. **Failure mode if tolerance were
dropped:** /implement's AC-toggle round-trip would silently break on the
live Jira path — the toggle would write `- [x]` locally, the server would
re-render to `* \[x\]`, and the next pull_acs would fail to parse the
re-rendered AC, marking it as missing on the tracker side. The smoke
#9 / Jira run 2 evidence (4/4 ACs flipped end-to-end) confirms current
parser tolerance; the explicit tests ensure a future regex tightening
cannot silently regress.

### `push_ac_toggle(ticket_id, ac_id, state) → void`

Dispatches on the value of `jira_ac_field` recorded in `## Task Tracking`.

**Custom-field path** (`jira_ac_field: customfield_XXXXX`):

1. `mcp__atlassian__getJiraIssue(ticket_id, fields=["<jira_ac_field>"], contentFormat: "markdown")` to
   read the current AC block.
2. Toggle the single bullet whose `id` matches `ac_id`.
3. `mcp__atlassian__editJiraIssue(issueIdOrKey=ticket_id, fields={ "<jira_ac_field>": <new value> }, contentFormat: "markdown")`.

**Description-body path** (`jira_ac_field: description`):

1. `mcp__atlassian__getJiraIssue(ticket_id, fields=["description"], contentFormat: "markdown")` to
   read the current description.
2. Locate the `## Acceptance Criteria` heading. Toggle the single bullet
   whose `id` matches `ac_id` inside that section, leaving prose outside
   the section byte-identical.
3. `mcp__atlassian__editJiraIssue(issueIdOrKey=ticket_id, fields={ description: <new full body> }, contentFormat: "markdown")`.
   The whole description body is rewritten in one call — there is no
   per-section patch primitive on the MCP. The `## Acceptance Criteria`
   heading is the parse anchor; preserving it byte-identical is the
   operator's responsibility on manual edits.

In both paths, the post-write `updatedAt` guard
(`TrackerWriteNoOpError`) applies. Jira does not server-side normalize
markdown when `contentFormat: "markdown"` is set; the pushed form is
the canonical form (no round-trip loop).

### `transition_status(ticket_id, status) → void`

1. `mcp__atlassian__getTransitionsForJiraIssue(ticket_id)` → list of
   available transitions for the issue's current workflow.
2. Resolve the target transition via this two-step algorithm:

   ```
   resolveTransitionId(targetStatus, transitions, statusMapping):
     targetName = statusMapping[targetStatus]
     for t in transitions:
       if t.to.name == targetName: return t.id          # primary
     targetCategory = canonicalCategory(targetStatus)   # fallback
     for t in transitions:
       if t.to.statusCategory.key == targetCategory: return t.id
     raise NFR10(...)
   ```

   Primary match is by exact `to.name` against
   `status_mapping[targetStatus]`. Fallback is by `to.statusCategory.key`
   — Jira workflows always have one of three category keys:

   | Canonical category | Maps from |
   |--------------------|-----------|
   | `new`              | (no canonical mapping in `status_mapping`; backlog states) |
   | `indeterminate`    | `in_progress`, `in_review` |
   | `done`             | `done` |

   `canonicalCategory(in_review) = indeterminate` collapses the two
   when the workflow has no exact `In Review` state — common in default
   team-managed Kanban templates that ship `To Do` / `In Progress` /
   `Done` only. Workflows with a real `In Review` named state get
   exact-name precedence, so the collapse is invisible there.

3. `mcp__atlassian__transitionJiraIssue(ticket_id, transition={ id: <matched id> })`.
4. Unknown `status` values (or no transition matches by name OR
   category) fail with NFR-10 canonical shape.

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

1. If `ticket_id_or_null === null`:
   - Resolve the issue type: default `Task`, override via
     `jira_issue_type:` in the `### Jira` block under `## Task Tracking`.
     Default-team-managed Kanban templates have `Task` / `Epic` /
     `Subtask` only (no `Story`); `Task` is the universally available
     choice. Operators on Scrum templates can switch to `Story` via the
     override.
   - **Pre-create JQL idempotency probe (single-shot fast path).** Before
     `createJiraIssue` fires, search the project for a ticket whose summary
     matches `title` exactly. A hit means the FR was already created on a
     prior run (resume / retry); return that id without writing.
   - `mcp__atlassian__createJiraIssue(projectKey=<from CLAUDE.md ### Jira>, summary=title, description=<rendered template>, issuetype=<resolved type>, contentFormat: "markdown")`.
   - **Network-error retry path (Gateway-Timeout idempotency hardening).**
     If the create call returns a network-error response
     (Gateway-Timeout / 504 / connection reset / equivalent) instead of a
     successful key, the server-side write may have landed despite the
     timeout (smoke #6 finding F6: the original write succeeded as `DST-2`
     while the timeout caused the retry path to fire). Re-run the JQL
     idempotency probe with backoff to give Atlassian's eventual-consistency
     window time to settle:

     | Attempt | Wait before probe | Action |
     |---------|-------------------|--------|
     | 1       | 1 second          | JQL search by exact `summary` match |
     | 2       | 2 seconds         | Same JQL search |
     | 3       | 4 seconds         | Same JQL search |

     Three attempts total; the schedule is `1s + 2s + 4s` (cumulative ~7s
     of additional latency on the timeout path only). The single-shot probe
     above stays as the fast path — the backoff schedule fires only on the
     network-error branch. If any backoff attempt finds the original write,
     return that id (no duplicate create). If all three backoff probes still
     miss, the original write genuinely failed server-side: fall through to
     a fresh `createJiraIssue` AND surface a `tracker_idempotency_uncertain`
     warning row in `/spec-write` Step 7 — the operator should manually
     verify before downstream skills bind to the new id.
   - Capture the returned `key` (e.g., `ABC-123`); that's the ticket id.
2. Else:
   - `mcp__atlassian__editJiraIssue(issueIdOrKey=ticket_id_or_null, fields={ summary, description }, contentFormat: "markdown")`.
3. Render `ticket_description_template` with `{fr_body}` and `{tracker_id}`
   (Jira key, e.g. `ABC-123`) substituted; back-link to
   `specs/frs/{tracker_id}.md` is mandatory. The legacy `{fr_anchor}` +
   `specs/requirements.md#...` form has been retired.
4. Return the ticket id.

Every write here passes through the silent-no-op trap: post-call
`updatedAt` is asserted to have advanced.

> **Out of scope.** Atlassian Rovo MCP does not currently expose
> idempotency-key headers on `createJiraIssue` — revisit if a future MCP
> version surfaces them; the backoff retry path is the present-day
> mitigation.

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
- `{ ok: false }` is a **first-class supported signal**, not an error. It
  fires on team-managed Kanban templates that ship no AC custom field —
  the most common starting Jira template. `/setup` interprets it as a
  branch point and prompts the operator to choose between (a) creating a
  custom field in the Jira UI and re-running `/setup` (records
  `jira_ac_field: customfield_XXXXX`) or (b) accepting the
  description-body sentinel (records `jira_ac_field: description`). No
  silent fallback — the choice is recorded explicitly.

Tests: see `discover_field.test.ts` (run with `bun test`).

---
name: _template
mcp_server: <exact name from `claude mcp list`, e.g., "linear", "atlassian", "asana">
ticket_id_regex: '^(?:TPL)-([0-9]+)$'
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
ticket_description_template: |
  {fr_body}

  ---

  Source: specs/requirements.md#{fr_anchor}
helpers_dir: adapters/_template/src
---

# `_template` Adapter

This is the starting point for a **custom tracker adapter**. Copy this directory
to `adapters/<your-tracker>/`, rename the frontmatter `name:`, and fill in the
four operation sections below. Keep the frontmatter shape identical — every
field in Schema M is load-bearing for `/setup`, `/implement`, `/gate-check`,
and `/pr`.

> The plugin's skills never call tracker-specific code directly. They read this
> markdown, resolve the active adapter, and invoke one of the four operations
> below. That's the entire contract. See `docs/tracker-adapters.md` for the
> full walkthrough and Schema M/N/O/P definitions.

## Frontmatter fields (Schema M)

| Field | Purpose |
|-------|---------|
| `name` | Adapter identifier. Matches `## Task Tracking` → `mode:` value. |
| `mcp_server` | Exact server name as reported by `claude mcp list`. Used by `/setup` MCP detection. |
| `ticket_id_regex` | Pattern that extracts the ticket ID from a branch name (Pattern 6, Tier 1 resolution). Use a non-capturing prefix group and a single capturing group for the ID. |
| `ticket_id_source` | Where IDs come from: `branch-name`, `ticket-url-paste`, or `active-ticket-only`. |
| `ac_storage_convention` | How ACs live in the tracker: `description-section`, `custom-field`, or `subtasks`. |
| `status_mapping` | Canonical states (`in_progress` / `in_review` / `done`) → tracker-side labels. `/pr` calls `transition_status(in_review)` after a PR is opened. |
| `capabilities` | Subset of `[pull_acs, push_ac_toggle, transition_status, upsert_ticket_metadata]`. A missing capability triggers FR-38 AC-38.6 graceful degradation (NFR-10 warning + proceed). |
| `ticket_description_template` | Body written by `upsert_ticket_metadata`. MUST contain a back-link to `specs/requirements.md#{fr_anchor}` per AC-37.6. |
| `helpers_dir` | Path to TypeScript helper sources, invoked via `bun run`. No compiled binaries. |

## 4-Op Interface (Schema N/O)

Every adapter implements exactly four operations. They are invoked by the
mode-aware skills; they never bypass this adapter contract.

### `pull_acs(ticket_id) → AcList`

Fetch current AC state from the tracker.

```
Schema N:
type AcceptanceCriterion = { id: string; text: string; completed: boolean };
type AcList = AcceptanceCriterion[];
```

**MCP tool:** *(replace with your tracker's tool, e.g., `mcp__linear__get_issue`)*

**Parser:** extract AC lines per `ac_storage_convention`; discard description
preamble, comments, history, and attachments (FR-35). Normalize output via
`helpers_dir/normalize.ts` so round-trips converge on the first iteration
(AC-39.6). Empty AC parse is a canonical-shape NFR-10 error (AC-35.4).

### `push_ac_toggle(ticket_id, ac_id, state) → void`

Toggle a single AC checkbox. Never rewrites untoggled ACs.

**MCP tool:** *(replace)*

**Implementation note:** push only the minimal diff (per AC-37.5 for Linear,
per subtask PATCH for Asana, per custom-field set for Jira).

### `transition_status(ticket_id, status) → void`

Move the ticket to a canonical status. Valid values: `in_progress`,
`in_review`, `done`. Resolve the tracker-side label via `status_mapping`.

**MCP tool:** *(replace)*

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

Create a ticket (null id) or update an existing one. Returns the final ticket
ID. Writes title and description only — **never** toggles ACs or changes
status (those ops are dedicated).

**Required:** the description body MUST include `ticket_description_template`
rendered with `{fr_body}` and `{fr_anchor}` substituted, so PMs can always
jump to `specs/requirements.md#FR-N` from the ticket (AC-37.6).

**MCP tool:** *(replace)*

## Helper scripts (`adapters/<tracker>/src/*.ts`)

Helpers are **pure functions over text** (Schema P):

- JSON on stdin → JSON on stdout
- Errors on stderr + non-zero exit code
- No network calls; no auth state; no file I/O outside stdin/stdout
- Invoked as `bun run adapters/<tracker>/src/<helper>.ts`

Typical helpers:

- `normalize.ts` — canonical-form normalization for description-section
  adapters (Linear, custom markdown trackers).
- `discover_field.ts` — one-time tenant-specific ID resolution (Jira field GIDs).
- `html_to_md.ts` / `md_to_html.ts` — for trackers that store rich text
  (Asana).

Tests live next to the helpers as `*.test.ts`, run via `bun test`. Aim for
100% coverage of helper behavior (testing-spec §6.3 Tier 4). All tests must
hold `normalize(normalize(x)) === normalize(x)` for any normalization helper.

## Conformance checklist

See `docs/tracker-adapters.md` § Conformance Checklist. Contributors PRing a
custom adapter must include a passed checklist for their tracker (Tier 5).

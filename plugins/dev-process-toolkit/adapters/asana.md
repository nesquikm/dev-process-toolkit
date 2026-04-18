---
name: asana
mcp_server: asana
ticket_id_regex: '^asana-([0-9]+)$'
ticket_id_source: ticket-url-paste
ac_storage_convention: subtasks
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
helpers_dir: adapters/asana/src
---

# Asana Adapter

ACs live as **subtasks** of the parent task; checkbox state maps directly to
each subtask's `completed` boolean (AC-37.3). Status convention varies per
workspace — `/setup` discovers whether the workspace uses sections, a custom
enum field, or the task's own `completed` flag, and records
`asana_status_convention: <section | custom_enum | completed_boolean>` in
`## Task Tracking` (AC-30.7).

Asana descriptions use a restricted HTML dialect (`<body>`, `<b>`, `<i>`,
`<code>`, `<pre>`, `<a>`, `<strong>`, `<em>`, `<u>`, `<ul>`, `<ol>`, `<li>`,
`<h1>`-`<h2>`, `<br>`). The adapter round-trips through Markdown so skills
speak Markdown uniformly; `html → md → html === html` must hold per the
conformance checklist.

## MCP tool names

> **Status: provisional (Phase H conformance).** This env has no Asana MCP
> configured, so `tools/list` introspection couldn't be performed at
> implementation time. Names below follow Asana's V2 MCP public docs and the
> `mcp__<server>__<tool>` convention. **Known V2 churn (spring 2026 forum
> reports):** `create_task_story` may be missing on some workspaces — the
> adapter declares degraded capability at runtime per FR-38 AC-38.6. Phase H
> Task 2 (Tier 5 manual conformance) re-verifies against a live authenticated
> Asana MCP.

| Operation | MCP tool | Notes |
|-----------|----------|-------|
| `pull_acs` | `mcp__asana__get_task` + `mcp__asana__get_subtasks_for_task` | Each subtask becomes one AC. |
| `push_ac_toggle` | `mcp__asana__update_task` | Flip the single subtask's `completed` boolean. |
| `transition_status` | `mcp__asana__update_task` | Vary by `asana_status_convention` (section membership / custom-enum value / `completed` flag). |
| `upsert_ticket_metadata` | `mcp__asana__create_task` (new) / `mcp__asana__update_task` (existing) | Description rendered as HTML via `md_to_html.ts`; back-link mandatory (AC-37.6). |

## URL paste fallback (AC-32.5)

Branch names rarely carry Asana gids. When Pattern 6 Tier 1 (branch regex)
and Tier 2 (`active_ticket:`) both fail, `/implement`, `/gate-check`, and
`/pr` fall through to an interactive prompt that accepts a full task URL:

```
Paste Asana task URL (https://app.asana.com/0/<proj>/<gid>):
```

The prompt handler extracts `<gid>` via the regex `https?://app\.asana\.com/0/\d+/(\d+)`.

## Operations

### `pull_acs(ticket_id) → AcList`

1. `mcp__asana__get_task(task_gid=ticket_id)` — parent task metadata.
2. `mcp__asana__get_subtasks_for_task(task_gid=ticket_id)` — returns an
   array of subtask objects.
3. Map each subtask to Schema N `AcceptanceCriterion`:
   - `id` is the leading `AC-X.Y` token in `subtask.name` if present;
     otherwise `asana-<subtask.gid>`.
   - `text` is the subtask's `name` (trimmed).
   - `completed = subtask.completed` (boolean).
4. If the subtasks list is empty, fail with NFR-10 canonical shape
   `"No acceptance criteria found in ticket <ID>"` per AC-35.4.

### `push_ac_toggle(ticket_id, ac_id, state) → void`

1. `mcp__asana__get_subtasks_for_task(task_gid=ticket_id)` — resolve
   `ac_id → subtask_gid`.
2. `mcp__asana__update_task(task_gid=<subtask_gid>, completed=state)`.
3. No description rewrite; only the single subtask's `completed` flips.

### `transition_status(ticket_id, status) → void`

Resolves via `asana_status_convention`:

- **section** — `mcp__asana__update_task(task_gid=ticket_id,
  memberships=[{ project, section: <resolved section gid> }])`.
- **custom_enum** — `mcp__asana__update_task(task_gid=ticket_id,
  custom_fields={ "<status field gid>": "<resolved enum value gid>" })`.
- **completed_boolean** — `mcp__asana__update_task(task_gid=ticket_id,
  completed=<status === "done">)`. `in_progress` / `in_review` no-op on
  this convention; surface an NFR-10 canonical-shape warning but proceed.

Unknown `status` values fail with NFR-10 canonical shape.

### `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id`

1. Render `ticket_description_template` with `{fr_body}` + `{fr_anchor}`
   (back-link mandatory per AC-37.6).
2. Pipe the rendered Markdown through
   `bun run adapters/asana/src/md_to_html.ts` to produce Asana's
   restricted HTML.
3. If `ticket_id_or_null === null`:
   - `mcp__asana__create_task(workspace_gid=<from CLAUDE.md>, name=title,
     html_notes=<html>)`.
   - Capture returned task gid.
4. Else:
   - `mcp__asana__update_task(task_gid=ticket_id_or_null, name=title,
     html_notes=<html>)`.
5. Return the task gid.
6. **Important:** ACs are NOT written as part of the description. ACs are
   created / toggled via dedicated subtask ops. `upsert_ticket_metadata`
   only touches `name` + `html_notes`.

## Helpers

### `html_to_md.ts`

Converts Asana's restricted HTML to Markdown.

- stdin: raw HTML string (from `task.html_notes`)
- stdout: Markdown equivalent
- Supported tags: `<body>`, `<b>` / `<strong>`, `<i>` / `<em>`, `<u>`,
  `<code>`, `<pre>`, `<a href>`, `<ul>` / `<ol>` / `<li>`, `<h1>` / `<h2>`,
  `<br>`
- Unknown tags fail with an NFR-10 canonical-shape error so the drift
  isn't buried in silent conversion.

### `md_to_html.ts`

Inverse of `html_to_md.ts`. Deterministic: `html_to_md(md_to_html(html))`
equals the normalized form of `html_to_md(html)`.

- stdin: Markdown string
- stdout: Asana restricted HTML
- Output always wrapped in a single `<body>` root.

### Round-trip invariant

`html → md → html === html` for any valid Asana-restricted HTML input,
**after** both sides pass through `html_to_md` → `md_to_html`. In practice:
`md_to_html(html_to_md(html))` equals `html` when `html` is already the
canonical form produced by `md_to_html`. Tests enforce this on all
fixtures under `tests/fixtures/mcp/asana/`.

Tests: see `html_to_md.test.ts` + `md_to_html.test.ts` (run with `bun test`).

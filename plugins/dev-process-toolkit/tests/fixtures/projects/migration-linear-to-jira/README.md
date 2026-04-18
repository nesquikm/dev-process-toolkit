# `migration-linear-to-jira` fixture

Scenario: a `mode: linear` project runs `/setup --migrate` and picks
`jira`. Internal flow: reconcile against local first (to absorb any
tracker-side drift on the Linear side), then push resolved state to Jira
via `upsert_ticket_metadata` on the Jira adapter. Old Linear tickets are
untouched (AC-36.6).

## Inputs

- CLAUDE.md `## Task Tracking`: `mode: linear`, 3 linked Linear tickets.
- Jira MCP configured and healthy.
- Bun ≥ 1.2 available; Jira AC custom-field discovery already done at
  migration entry and recorded as a staging-key in the migration
  in-memory state (will be written to CLAUDE.md only on success).

## Expected behavior

1. `/setup --migrate` detects current mode = `linear`.
2. User picks `3. jira`.
3. Internal `linear → none` half: reconcile each FR's Linear AC list
   against local via FR-39 (but don't rewrite CLAUDE.md yet).
4. Internal `none → jira` half: for each FR, call
   `upsert_ticket_metadata(null, title, description)` on the Jira
   adapter; capture returned Jira issue keys (e.g., `PROJ-1`, `PROJ-2`,
   `PROJ-3`).
5. Only after both halves succeed:
   - CLAUDE.md `## Task Tracking` rewritten with `mode: jira` +
     `mcp_server: atlassian` + `jira_ac_field: customfield_XXXXX`.
   - Traceability matrix rows updated with the Jira keys.
   - Sync log: `- <ISO> — Migration complete: linear → jira, 3 FRs moved`.
6. Old Linear tickets left intact. User not prompted to close them
   (they're on the "old" tracker — closure is the user's call on the
   Linear UI, not the plugin's).

## Fail conditions

- Any Linear ticket modified (they're source-of-truth during step 3
  only, not mutated).
- CLAUDE.md rewritten before the Jira side completes.
- Old Linear ticket deleted or status-transitioned by the migration
  (out-of-scope per AC-36.6).

---
id: fr_01KPR3M74WN5NYPM4D2PSQ8CQK
title: Smart /setup MCP Detection, Install, and OAuth Verification
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-9
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/setup` in tracker mode introspects the user's MCP configuration, guides install for missing servers, verifies the connection, and runs first-time discovery for per-tenant quirks. Never silently mutates `settings.json`.

## Acceptance Criteria

- AC-STE-9.1: `/setup` detects currently configured MCP servers by shelling out to `claude mcp list` (or equivalent introspection) — covers enterprise, user, project, and local scopes automatically without hand-parsing multiple `settings.json` paths
- AC-STE-9.2: If the matching MCP for the chosen tracker is absent, `/setup` prints the exact JSON diff (showing the proposed `mcpServers.<name>` entry) and requires explicit user confirmation before writing
- AC-STE-9.3: `/setup` never silently writes to `settings.json` — every write is dry-run preview + explicit confirm
- AC-STE-9.4: After install or confirmation that the MCP is present, `/setup` runs a harmless test call to verify the connection works (Linear `list_teams`, Jira `search` with no criteria)
- AC-STE-9.5: If the test call fails, `/setup` hard-stops and refuses to record `mode: <tracker>` in CLAUDE.md — the project remains in `mode: none` until MCP is healthy (error surfaced in NFR-10 canonical shape)
- AC-STE-9.6: For Jira: `/setup` discovers the "Acceptance Criteria" custom-field GID per project (`/rest/api/3/field` introspection) and records it in CLAUDE.md's `## Task Tracking` section
- AC-STE-9.8: When the user picks any tracker mode (linear/jira/custom), `/setup` verifies Bun is installed via `bun --version`; if absent, prompts the user with installation guidance (`brew install bun` on macOS, documented paths for Linux/Windows) and hard-stops mode recording until Bun is available (NFR-10 canonical error shape)
- AC-STE-9.9: When the user picks `linear`, `/setup` inspects the Linear MCP server URL from `claude mcp list`; if it matches `https://mcp.linear.app/sse` (deprecated V1 SSE endpoint, shutdown 2026-05-11), `/setup` warns the user and offers a dry-run settings.json diff to migrate to V2 `https://mcp.linear.app/mcp`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

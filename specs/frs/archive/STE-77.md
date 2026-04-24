---
title: Linear SSE endpoint swap (deadline 2026-05-11)
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-77
created_at: 2026-04-24T07:53:16Z
---

## Requirement

Linear's deprecated V1 SSE endpoint (`https://mcp.linear.app/sse`) sunsets 2026-05-11. The repo's `.mcp.json` currently points at the V1 endpoint; post-sunset, dogfooding of Linear MCP stops working. Docs (`docs/setup-tracker-mode.md:88`, `docs/tracker-adapters.md` ~line 271) advertise the deprecated URL and carry "shutdown 2026-05-11" warnings that become factually wrong on 2026-05-12.

Swap `.mcp.json` to the successor endpoint, refresh both doc files in the same commit. Ships first in M22 because the deadline gates all other M22 work that relies on Linear MCP (STE-79's 5 description rewrites).

## Acceptance Criteria

- AC-STE-77.1: `.mcp.json` server URL changed from `https://mcp.linear.app/sse` to the successor endpoint (Linear's current supported endpoint — verify via Linear docs at swap time).
- AC-STE-77.2: `plugins/dev-process-toolkit/docs/setup-tracker-mode.md:88` prose refreshed — no reference to "V1 SSE endpoint" or "shutdown 2026-05-11"; points at the current endpoint.
- AC-STE-77.3: `plugins/dev-process-toolkit/docs/tracker-adapters.md` (~line 271) refreshed to match AC-STE-77.2.
- AC-STE-77.4: Post-swap, an in-session `mcp__linear__get_issue STE-67` call succeeds from the plugin's MCP config.

## Technical Design

Pure config + doc edit. No code change, no Provider interface change, no new tests.

## Testing

Manual in-session dogfood: one `mcp__linear__get_issue` call post-swap. MCP endpoint is not mockable in the shipped test suite; no automated test.

## Notes

Hard deadline: 2026-05-11. First commit of M22 ships this FR.

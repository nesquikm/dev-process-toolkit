---
id: fr_01KPZ7GRFS7EK16T50A8EXVE9N
title: AC-STE-67.2 completion — rewrite 5 M19 Linear descriptions
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-79
created_at: 2026-04-24T07:53:53Z
---

## Requirement

AC-STE-67.2 (rewrite 5 M19 Linear descriptions to drop the `**ULID:**` header) was deferred in M19 because the `/implement M19` session had no Linear MCP wired. M22's session does (verified 2026-04-24). This FR closes the deferral.

For STE-63, STE-64, STE-65, STE-66, STE-67: rewrite each Linear ticket description so the header is `**Spec file:** specs/frs/<that-ticket-id>.md` (canonical form per `adapters/linear.md:~50`), not `**ULID:** fr_<26chars>`.

## Acceptance Criteria

- AC-STE-79.1: `mcp__linear__save_issue` called once per ticket for STE-63..STE-67; each call rewrites the description body. Header line becomes `**Spec file:** specs/frs/<that-ticket-id>.md`; no `**ULID:**` line remains anywhere in the body.
- AC-STE-79.2: Post-rewrite, `mcp__linear__get_issue` for each of STE-63..STE-67 returns a description with zero occurrences of the string `ULID` (case-sensitive; Schema Q `id:` is frontmatter in the FR file, not in the Linear description).
- AC-STE-79.3: CHANGELOG.md v1.22.0 STE-67 entry deferral paragraph (~line 19) rewritten to reflect completion: "AC-STE-67.2 completed during M22 release-prep via Linear-enabled /implement session."

## Technical Design

Two-pass execution: (1) `mcp__linear__get_issue` per ticket to capture current description; (2) construct rewritten body and call `mcp__linear__save_issue` with `id` + new `description`. No helper module needed — inline in the /implement session. Idempotent per-call: safe to re-run if partial success.

## Testing

Post-batch verification: `mcp__linear__get_issue` × 5, grep each description body for `ULID` substring. No automated test (Linear MCP not mockable in shipped test suite).

## Notes

Partial failure tolerable (each ticket is independent). Re-fetch STE-63..STE-67 descriptions as a verification pass after the batch; any ticket still carrying `ULID` gets a retry.

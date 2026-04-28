---
title: Adapter contract parity (Jira traps + _template.md + dead capability)
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-81
created_at: 2026-04-24T07:54:28Z
---

## Requirement

The audit found four adapter-contract gaps:

1. **H8** — `adapters/jira.md` has no `### claimLock-skipped trap` subsection, though the STE-65 guard in `adapters/_shared/src/tracker_provider.ts:266-272` fires for every adapter, not just Linear.
2. **H9** — `adapters/jira.md` has no `### Silent no-op trap` subsection, though `verifyWriteLanded` (`tracker_provider.ts:274`) fires for every adapter.
3. **M8** — `adapters/linear.md:16` declares `read_status` as a capability with zero consumers across the plugin. Dead declaration.
4. **M9** — `_template.md` doesn't document `## MCP tool names` or `### Adapter-specific traps` section slots, so future adapters have no contract to follow.

Fix all four together: copy Linear's trap subsections into jira.md (adapted), delete `read_status`, expand `_template.md` with the missing slots.

## Acceptance Criteria

- AC-STE-81.1: `plugins/dev-process-toolkit/adapters/jira.md` gains a `### claimLock-skipped trap (STE-65)` subsection that mirrors `adapters/linear.md:81-106` in structure (pre-state guard, error type, remediation). Text adapted where Linear-specific.
- AC-STE-81.2: `plugins/dev-process-toolkit/adapters/jira.md` gains a `### Silent no-op trap` subsection mirroring `adapters/linear.md:54-79`. Section notes Jira-specific behavior is tentative pending live-MCP introspection (H3 remains).
- AC-STE-81.3: `plugins/dev-process-toolkit/adapters/linear.md:16` `read_status` capability line is deleted.
- AC-STE-81.4: `plugins/dev-process-toolkit/adapters/_template.md` gains a `## MCP tool names` section slot (required) and a `### Adapter-specific traps` subsection slot inside `## Operations` (optional; renders as "N/A" for adapters without traps).
- AC-STE-81.5: Post-edit, `adapters/linear.md` and `adapters/jira.md` both declare all required sections from `_template.md`.
- AC-STE-81.6: `grep -rn read_status plugins/dev-process-toolkit/` returns zero hits.

## Technical Design

Prose edits only. `_template.md` expansion is structural (adds the section slots); adapter files fill them. No helper/code changes.

## Testing

- Prose-assertion test extending existing adapter-structure tests: `tests/adapter-contract-parity.test.ts` asserts both Jira and Linear declare the trap subsections and declare the required `_template.md` sections.
- Grep-based test for AC-STE-81.6: `read_status` has no consumers.

## Notes

H3 (Jira is provisional; MCP tool names not live-verified) remains out of scope — the backported sections describe shared-code behavior, not Jira-specific tool surface. When Jira MCP is wired, contract verification of the Jira surface happens then.

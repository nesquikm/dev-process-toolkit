---
title: Tracker Mode Flag at /setup
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-8
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/setup` gains a tracker-mode question that selects the AC backend for the project. Default `none` preserves today's behavior; any other value routes AC reads/writes through an MCP-backed adapter while leaving all other spec content local.

## Acceptance Criteria

- AC-STE-8.1: `/setup` prompts for tracker mode with exactly these options: `none`, `linear`, `jira`, `custom`
- AC-STE-8.2: Default is `none`; if the user declines or skips the prompt, `specs/` is created and behavior is identical to pre-M12
- AC-STE-8.3: Selected mode is recorded in `CLAUDE.md` under a new `## Task Tracking` section as a parseable line: `mode: <value>`
- AC-STE-8.4: In tracker mode (`mode ≠ none`), `specs/` is created unconditionally — it is the required local mirror for AC text per Path B. In `none` mode, `specs/` creation follows the **pre-M12 user-opt-in flow unchanged** (Pattern 9 takes precedence): `/setup`'s existing SDD-workflow question is the gate, so projects that decline SDD still produce no `specs/` directory. Tracker modes never ask the SDD opt-in because `specs/` is structurally required
- AC-STE-8.5: `/setup` default path does NOT create a `## Task Tracking` section. Absence of the section is treated as `mode: none` by every skill. A manually-authored `mode: none` line is equivalent and must be accepted identically by skills, but is not the canonical form produced by `/setup` (canonical form = absence)
- AC-STE-8.6: `templates/CLAUDE.md.template` MUST NOT contain any line matching the Schema L probe anchor `^## Task Tracking$`. The only occurrence of the heading `## Task Tracking` in a template-derived CLAUDE.md is the live section emitted by `/setup` when the user picks a tracker mode (per AC-STE-8.3). Verified by `grep -c '^## Task Tracking$' templates/CLAUDE.md.template` returning 0. Prevents the Schema L probe from reporting a false positive on projects that retain a template-borne comment block
- AC-STE-8.7: `/setup` in `mode: none` produces a CLAUDE.md for which `grep -c '^## Task Tracking$'` returns 0. Verified end-to-end by running `/setup` in mode: none against an empty-project fixture and running the probe on the resulting file

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

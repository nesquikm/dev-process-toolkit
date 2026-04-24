---
id: fr_01KPR3M74XA75GJKT4Z4HG95TQ
title: Drop `disable-model-invocation` on Composable Side-Effect Skills
milestone: M10
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Remove `disable-model-invocation: true` from `/implement` and `/pr` frontmatter. Keep it on `/setup` (genuine one-time bootstrap). Rationale: the flag was an over-correction. `/implement` and `/pr` already have multiple in-skill human-in-the-loop gates (pre-flight prompts, Phase 4 approval, commit gates, branch confirmations) that protect against runaway execution. The start-time block adds no additional safety for these skills but blocks clean agent-team composition — subagents wanting to invoke `/implement` in a fresh context currently have to read `SKILL.md` and execute the body manually, a leaky abstraction over the skill system. `/setup` is different: it's a one-time project bootstrap that genuinely should only run on explicit human invocation.

## Acceptance Criteria

- AC-27.1: `plugins/dev-process-toolkit/skills/implement/SKILL.md` frontmatter does NOT contain `disable-model-invocation: true`
- AC-27.2: `plugins/dev-process-toolkit/skills/pr/SKILL.md` frontmatter does NOT contain `disable-model-invocation: true`
- AC-27.3: `plugins/dev-process-toolkit/skills/setup/SKILL.md` frontmatter retains `disable-model-invocation: true` (unchanged)
- AC-27.4: `docs/skill-anatomy.md` "Best Practices" entry about `disable-model-invocation` is updated to narrow the recommendation: use the flag only for one-time bootstrap skills (like `/setup`), not for workflow skills that already gate side effects via in-skill human approval
- AC-27.5: `docs/parallel-execution.md` "Agent-Teams" section documents that `/implement` can now be invoked directly via the `Skill` tool from subagents — no mention of the prior workaround as a blessed pattern (this FR removes the need for it)
- AC-27.6: No other skill in `plugins/dev-process-toolkit/skills/` gains the flag as a compensating change — the rationale in this FR deliberately allows workflow skills to compose

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M10-second-look.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

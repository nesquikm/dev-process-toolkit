---
id: fr_01KPR3M74XA75GJKT4Z4HG95TP
title: Parallel Execution Guidance Doc + /implement Pointer
milestone: M10
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

New `docs/parallel-execution.md` explaining when and how to use Claude Code's native subagents and agent-teams with `/implement`, plus the worktree-per-subagent isolation pattern. `/implement` links to the doc via a dedicated `## Parallelization` subsection so it's consulted when relevant — no orphaned documentation.

## Acceptance Criteria

- AC-25.1: `plugins/dev-process-toolkit/docs/parallel-execution.md` exists
- AC-25.2: Doc contains exactly three top-level sections: `## Native Subagents`, `## Agent-Teams`, `## Worktree-per-Subagent Isolation`
- AC-25.3: "Native Subagents" section links to `https://code.claude.com/docs/en/sub-agents` and gives a 1–2 paragraph "when to use" guideline tied to `/implement` task fan-out
- AC-25.4: "Agent-Teams" section links to `https://code.claude.com/docs/en/agent-teams` and explains the differential ("teams for ongoing collaboration; subagents for one-shot task isolation") with at least one concrete example each
- AC-25.5: "Worktree-per-Subagent Isolation" section explains: one worktree per parallel agent, merge-back via the same options as `/implement`'s existing worktree recovery flow, conflict-avoidance via task partitioning by file
- AC-25.6: `implement/SKILL.md` contains a new `## Parallelization` subsection placed immediately before Phase 3, with the literal pointer line: "For parallelizable work, see `docs/parallel-execution.md` before dispatching."
- AC-25.7: `docs/parallel-execution.md` does not exceed 200 lines (focused doc, not a dump)
- AC-25.8: Doc carries an "Advisory only" disclaimer at the top — the parallelization patterns are opt-in suggestions, not required by `/implement`'s default flow

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M10-second-look.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

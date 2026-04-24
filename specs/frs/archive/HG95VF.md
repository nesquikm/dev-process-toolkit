---
id: fr_01KPR3M74XA75GJKT4Z4HG95VF
title: Unify Review Infrastructure and Retire Dead Subagents
milestone: M9
status: archived
archived_at: 2026-04-11T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Context.** Audit (2026-04-11) of `plugins/dev-process-toolkit/agents/` and every SKILL.md found two orphaned subagents (`code-reviewer`, `test-writer`) with zero invocation sites, plus duplicate review rubric logic across 4 files (`gate-check`, `implement` Phase 3 Stage B, `simplify`, `code-reviewer.md`). `docs/skill-anatomy.md:131-140` documents `context: fork` + `agent:` delegation but 0 of 12 skills exercise it. `implement/SKILL.md` is 276/300 lines against NFR-1 and its Phase 3 Stage B inlines ~60 lines of review rubric that would benefit from context-isolated delegation. `test-writer.md` (26 lines, 6 steps) is a weaker duplicate of `/tdd` (55 lines with RED/GREEN/VERIFY + shallow assertion anti-patterns) and nothing references it.

**Goal.** Give `code-reviewer` a real delegation point so it stops being dead code; delete `test-writer` so it stops advertising an entry point that doesn't exist; consolidate the review rubric to one canonical home.

**Design decision — explicit `Agent`-tool invocation, not `context: fork`.** The `context: fork` + custom agent pattern is documented in `skill-anatomy.md` but never exercised in this plugin (0/12 skills). Unknown failure modes. FR-22 instead routes delegation through explicit `Agent`-tool invocation documented inside the skill body — boring, well-documented, gives the skill author explicit control over prompt and result shape, and we know it works. `context: fork` remains as a documented alternative but is explicitly labeled as unexercised (see AC-22.8).

**Acceptance criteria:**

- [x] **AC-22.1** — `plugins/dev-process-toolkit/agents/test-writer.md` is deleted. `rg 'test-writer' plugins/` returns zero matches (CHANGELOG.md is exempt). `docs/adaptation-guide.md` Step 6 no longer lists it.

- [x] **AC-22.2** — `/implement` Phase 3 Stage B invokes `code-reviewer` via explicit `Agent`-tool invocation documented inside `implement/SKILL.md`. The delegation block spells out: (a) the exact prompt to send — includes the AC checklist from Phase 1, the list of changed files (from `git diff --name-status`), and a pointer to CLAUDE.md for stack hints; (b) the expected return shape — `OK` / `CONCERN` per criterion with file:line references; (c) how the parent skill integrates findings into the Stage B pass/fail decision and whether to proceed to Stage C. No `context: fork` frontmatter.

- [x] **AC-22.3** — The stack-specific review checklist currently at `implement/SKILL.md:171-176` moves into `code-reviewer.md` (or `docs/implement-reference.md`). `code-reviewer.md` becomes the canonical rubric referenced by both `/implement` Stage B (via delegation) and `/gate-check` Code Review section (via pointer).

- [x] **AC-22.4** — `gate-check/SKILL.md` Code Review section (~lines 33-53) replaces its inline rubric copy with a pointer to `code-reviewer.md`. Gate-check continues to run the review **inline** (synchronous, no delegation) because a gate verdict must return in one turn — only the rubric source is unified, not the execution path.

- [x] **AC-22.5** — The spec compliance section at `code-reviewer.md:34-40` is deleted. `/spec-review` remains the sole canonical home for AC→code traceability. `code-reviewer` covers quality, security, and patterns only.

- [x] **AC-22.6** — `simplify/SKILL.md` (36 lines) is **not** converted to delegation. Its review rubric wording is aligned with `code-reviewer.md` where they overlap (reuse/quality/efficiency) so users don't get contradictory guidance between the two paths.

- [x] **AC-22.7** — `docs/adaptation-guide.md` Step 6 (Configure Agents, ~lines 109-121) rewritten: (a) removes the `test-writer` and `debugger` bullets (the latter was never implemented), (b) describes `code-reviewer` as the canonical review agent with `/implement` Phase 3 Stage B as the reference delegation point, (c) links to the skill-anatomy example from AC-22.8.

- [x] **AC-22.8** — `docs/skill-anatomy.md` Subagent Execution section (~lines 131-140) adds a concrete, copy-pasteable example of `/implement` Phase 3 Stage B's explicit `Agent`-tool invocation as the reference implementation. The existing abstract `context: fork` example is retained but labeled "Alternative — unexercised in this plugin as of v1.12.0."

- [x] **AC-22.9** — Post-change `wc -l plugins/dev-process-toolkit/skills/implement/SKILL.md` returns a number under 240 (down from 276). Buffers NFR-1 for future Phase 3 additions.

- [x] **AC-22.10** — Version bumped to **1.12.0** per the release checklist in `CLAUDE.md`. All three files updated: `plugins/dev-process-toolkit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `CHANGELOG.md`. CHANGELOG entry uses codename "Dead Branches", cross-references FR-22, and has `### Added` / `### Changed` / `### Removed` subsections.

## Acceptance Criteria

*(no acceptance criteria recorded in v1 archive)*

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M9-dead-branches.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

---
name: simplify
description: Review changed code for reuse, quality, and efficiency, then fix any issues found. Use after completing a feature to clean up.
argument-hint: '[focus area]'
---

# Simplify

Review recently changed files for code quality issues and fix them. This skill complements `agents/code-reviewer.md` (the canonical defect/security rubric used by `/implement` Stage B and `/gate-check` Code Review) by focusing on *cleanup* — reuse, clarity, and efficiency — on files that have already passed review. Where wording overlaps (naming, hardcoded values, pattern compliance), follow the code-reviewer rubric as the source of truth.

## Process

1. **Find changed files** — Check `git diff --name-only HEAD~1` (or `git diff --name-only` for uncommitted changes)

2. **Review for:**
   - **Reuse** — Is there duplicated logic that should be extracted? Any shared helper already exists?
   - **Quality** — Unclear names, unnecessary complexity, or hardcoded values that should come from config (same standard as `agents/code-reviewer.md` § Code quality)
   - **Efficiency** — Obvious performance issues (N+1 queries, unbounded loops, unnecessary allocations)

3. **Fix issues** — Apply changes directly, keeping fixes minimal and focused

4. **Verify** — Run gate check to ensure nothing broke

## Focus

If `$ARGUMENTS` specifies a focus area, prioritize that:
- "memory" → focus on memory efficiency
- "performance" → focus on performance
- "readability" → focus on code clarity
- "types" → focus on type safety

## Rules

- Only touch files that were recently changed (don't refactor unrelated code)
- Keep changes minimal — fix real issues, don't gold-plate
- Run gate check after all changes

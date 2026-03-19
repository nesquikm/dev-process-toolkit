---
description: Review changed code for reuse, quality, and efficiency, then fix any issues found. Use after completing a feature to clean up.
argument-hint: '[focus area]'
---

# Simplify

Review recently changed files for code quality issues and fix them.

## Process

1. **Find changed files** — Check `git diff --name-only HEAD~1` (or `git diff --name-only` for uncommitted changes)

2. **Review for:**
   - **Reuse** — Is there duplicated logic that should be extracted?
   - **Quality** — Are there code smells, unclear names, or unnecessary complexity?
   - **Efficiency** — Are there obvious performance issues?

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

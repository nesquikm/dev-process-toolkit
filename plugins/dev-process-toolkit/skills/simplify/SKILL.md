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

4. **Verify** — Run gate check to ensure nothing broke. If no refactors are warranted (the diff is already minimal) and the no-op preconditions documented in [`## When this is a no-op`](#when-this-is-a-no-op) hold, the gate re-run is skipped — re-running an unchanged tree against a clean gate is wasted tokens. Consult the most recent `/implement` or `/gate-check` log for the active gate stamp.

5. **Closing summary — dirty-tree advisory (STE-216)** — At the end of every `/simplify` invocation (after Verify, before exit), capture `git status --porcelain` once. If the output is **non-empty** (any modified, added, deleted, or untracked file), emit two lines to stdout:

   ```
   ⚠ tree dirty: M <files> — run /pr or git commit to land the simplification
   Capability: simplify_tree_dirty
     Rendered: tree dirty after /simplify — modified files: <list>; run /pr or git commit to land the simplification
   ```

   `<files>` and `<list>` are the per-file paths from `git status --porcelain`, comma-joined. The literal token `tree dirty:` is machine-greppable so the smoke driver and operator-side automation can detect the dirty case deterministically. The `simplify_tree_dirty` capability key is registered in the static plain-language map shared by `/spec-write` step 7 (single source of truth).

   When the output is **empty** (clean tree — the no-op gate-skip path or the rare case where the operator committed concurrently), no advisory fires and no capability row emits. The two-line dirty-case output is opt-in by tree state.

   The advisory is **informational**: `/simplify` continues to exit 0 in the dirty case. Auto-commit was considered as the symmetric fix to `/implement` Phase 4 and rejected per CLAUDE.md core principle "human approval before commit". Subsequent `/pr` / `/gate-check` / `git commit` are the operator's responsibility; the fix is purely a visibility increase. The advisory fires regardless of whether `/simplify` itself made the change (canonical case) or `/simplify` ran on a tree that was already dirty before the skill started — distinguishing source is non-essential, the actionable signal is the dirty tree at exit time.

## Focus

If `$ARGUMENTS` specifies a focus area, prioritize that:
- "memory" → focus on memory efficiency
- "performance" → focus on performance
- "readability" → focus on code clarity
- "types" → focus on type safety

## Rules

- Only touch files that were recently changed (don't refactor unrelated code)
- Keep changes minimal — fix real issues, don't gold-plate
- Run gate check after all changes (subject to the [no-op carve-out](#when-this-is-a-no-op))

## When this is a no-op {#when-this-is-a-no-op}

`/simplify` exits as a no-op without re-running gate checks when both preconditions hold:

1. **Working tree is clean** — no diff vs. the prior `/simplify` entry, so there is nothing to simplify.
2. **Prior `/gate-check` returned clean** — no failing gate to re-verify.

Rationale: re-running an unchanged tree against an already-clean gate produces no signal change, so the gate re-run is skipped to save tokens. The skill emits a single line acknowledging the no-op (referencing this section by name — *"per `## When this is a no-op`, gate re-run is skipped"*) and exits. If either precondition fails — the tree has uncommitted changes, or the prior gate stamp is dirty — the carve-out does NOT apply and the full Verify step (3 → 4) runs as normal.

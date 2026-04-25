---
title: Delete orphan MCP fixtures + dead frontmatter exports (M11 + M18)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-95
created_at: 2026-04-25T06:42:10Z
---

## Requirement

Two unrelated dead-code categories landed in the same FR because they share the same shape (delete-only, no replacement, no live consumers):

**M11 — Orphan MCP fixtures.** `tests/fixtures/mcp/linear/{get_issue.json, get_issue_empty_ac.json, update_issue.json}` were introduced in M12 Phase E Task 3 (commit `c66c7d1`) for "FR-35 AC parser boundary" but the plugin's tests never opened them. Audit verified: zero inbound references across the whole repo.

**M18 — Dead frontmatter exports.** `adapters/_shared/src/frontmatter.ts` exports two functions with zero live callers:
- `parseFrontmatterFlat` (line 72) — alternative flat-shape parser
- `setTrackerBinding` (line 120) — FR-58 migration binding writer that `/setup --migrate` was meant to call but doesn't (the flow uses raw CLAUDE.md rewriting instead)

Audit verified: only hits across the entire repo are in `frontmatter.ts` itself and `frontmatter.test.ts`. The plugin is not published as an npm package — there's no public-API contract to preserve.

## Acceptance Criteria

- AC-STE-95.1: `tests/fixtures/mcp/linear/` directory does not exist (or is empty). The 3 orphan JSON fixtures are deleted. {#AC-STE-95.1}
- AC-STE-95.2: `grep -rn "fixtures/mcp" plugins/dev-process-toolkit/` returns no live references. {#AC-STE-95.2}
- AC-STE-95.3: `parseFrontmatterFlat` is removed from `adapters/_shared/src/frontmatter.ts`. The corresponding `describe` block in `frontmatter.test.ts` is deleted. {#AC-STE-95.3}
- AC-STE-95.4: `setTrackerBinding` is removed from `adapters/_shared/src/frontmatter.ts`. The corresponding `describe` block in `frontmatter.test.ts` is deleted. {#AC-STE-95.4}
- AC-STE-95.5: `grep -rn "parseFrontmatterFlat\|setTrackerBinding" plugins/dev-process-toolkit/ adapters/` returns no matches. {#AC-STE-95.5}
- AC-STE-95.6: `bun test` remains green. Total test count decreases by the count from the deleted `describe` blocks (~25 tests). {#AC-STE-95.6}

## Technical Design

Two independent deletions in one commit:

1. `rm tests/fixtures/mcp/linear/*.json` (and remove the `linear/` subdir if it's now empty; remove `mcp/` if also empty).
2. Edit `adapters/_shared/src/frontmatter.ts` — delete `parseFrontmatterFlat` function (line 72 + body) and `setTrackerBinding` function (line 120 + body). Keep `parseFrontmatter` (the structured parser used by 8 callers).
3. Edit `adapters/_shared/src/frontmatter.test.ts` — delete the two corresponding `describe` blocks.

Run `bun test` after each step.

## Testing

No new tests. ~25 tests deleted from `frontmatter.test.ts`. Document the delta in the commit message.

## Notes

L14 from the audit observed three variant parsers in `frontmatter.ts` (structured + flat + scattered inline regex). Removing `parseFrontmatterFlat` collapses to one canonical parser plus the inline regex callsites — a future FR could consolidate further, but that's out of scope here.

Origin: PR #4 audit M11 + M18.

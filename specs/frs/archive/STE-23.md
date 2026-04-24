---
id: fr_01KPR3M74XA75GJKT4Z4HG95T9
title: `/setup`-Driven Migration with Safety Rails
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-23
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/setup` detects the v1 layout, prompts explicitly, and performs the migration in a reversible way: clean-tree precondition, dry-run preview, backup git tag, single migration commit, layout-marker commit. Splits `requirements.md` by FR, co-locates per-FR content from `technical-spec.md` / `testing-spec.md`, splits `plan.md` by milestone, and converts `specs/archive/*.md` into per-FR archive files.

## Acceptance Criteria

- AC-STE-23.1: `/setup` detects v1 via `specs/requirements.md` present AND `specs/.dpt-layout` absent
- AC-STE-23.2: On detection, `/setup` prompts: `"Migrate specs/ to v2 layout (file-per-FR + ULID)? [y/N]"`. Default answer is No. Never auto-applies
- AC-STE-23.3: Migration refuses to start if `git status --porcelain` returns any output. Refusal prints: `"Migration requires a clean working tree. Uncommitted files: <list>"` and exits non-zero
- AC-STE-23.4: `/setup --migrate-dry-run` writes the planned v2 tree into `specs/.migration-preview/` and prints a diff summary to stdout. No commits, no live-tree mutation. Preview directory is `.gitignore`d by the migration
- AC-STE-23.5: Live migration first creates a git tag `dpt-v1-snapshot-<YYYYMMDD-HHMMSS>` pointing at HEAD, then proceeds
- AC-STE-23.6: Migration splits each `### FR-N:` block from `requirements.md` into a new `specs/frs/<ulid>.md`, mints a ULID via `LocalProvider.mintId()`, and merges corresponding per-FR subsections from `technical-spec.md` / `testing-spec.md` into `## Technical Design` / `## Testing` of the new file
- AC-STE-23.7: Migration splits `plan.md` by `## M<N>:` heading into `specs/plan/<M#>.md` files, preserving all content and adding frontmatter (`milestone`, `status: complete` for archived milestones, `status: active` for in-flight, `kickoff_branch: null`, `frozen_at: null`)
- AC-STE-23.8: Migration preserves cross-cutting content in slimmed `technical-spec.md` / `testing-spec.md` (architecture, patterns, schemas, conventions) — removes only per-FR subsections
- AC-STE-23.9: Migration converts existing `specs/archive/*.md` into `specs/frs/archive/<ulid>.md` files; archived FRs get freshly-minted ULIDs and carry `status: archived` + `archived_at` frontmatter preserving original archival date
- AC-STE-23.10: Migration commits the new tree as a single commit with message `feat(specs): migrate to v2 layout` — separate from any pre-existing commits and from the layout-marker commit
- AC-STE-23.11: Migration writes `specs/.dpt-layout` with `version: v2`, `migrated_at: <ISO>`, `migration_commit: <SHA>` in a second commit: `chore(specs): record v2 layout marker`. Two commits total: migration + marker
- AC-STE-23.12: Migration prints a structured summary: `N FRs migrated`, `M milestones split`, `K archived items converted`, `<byte-size> residual in technical-spec.md`, `<byte-size> residual in testing-spec.md`, `tag: dpt-v1-snapshot-<timestamp>`
- AC-STE-23.13: Migration is idempotent: running `/setup --migrate` on an already-v2 tree (detected by `specs/.dpt-layout` present with `version: v2`) exits cleanly with message: `"Already on v2 layout (migrated <date>). Nothing to do."`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

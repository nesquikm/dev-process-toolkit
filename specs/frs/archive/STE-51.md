---
id: fr_01KPTSA7W8N116XWSXXE0G1PY3
title: Purge legacy FR-N references from repo
milestone: M16
status: archived
archived_at: 2026-04-22T19:55:21.000Z
tracker:
  linear: STE-51
created_at: 2026-04-22T14:32:16.000Z
---

## Requirement

Every `AC-<N>.<M>` prefix, `### FR-<N>:` heading, `{#FR-<N>}` anchor, and `FR-<N>` prose citation inside this repo is rewritten to the STE-50 scheme. No reusable migration tooling is packaged — this is a mechanical one-off edit committed atomically. The plugin has no external adopters yet, so a throwaway rewrite suffices; no script, no dry-run mode, no idempotency harness.

## Acceptance Criteria

- AC-STE-51.1: Every FR in `specs/frs/*.md` (excluding `archive/`) has its `AC-<N>.<M>` prefixes rewritten to the STE-50-derived prefix (tracker ID or short-ULID) for that FR.
- AC-STE-51.2: Every `### FR-<N>: Title {#FR-<N>}` heading in active FR files is rewritten to `### <NEW_PREFIX>: Title {#<NEW_PREFIX>}` where `<NEW_PREFIX>` matches STE-50's scheme.
- AC-STE-51.3: Every `FR-<N>` prose reference and `#FR-<N>` markdown link target across `specs/**`, `plugins/dev-process-toolkit/docs/**`, and `plugins/dev-process-toolkit/skills/**` is rewritten using the same `<NEW_PREFIX>` mapping. `specs/INDEX.md` is regenerated via `regenerateIndex()` at the end.
- AC-STE-51.4: Out of scope (preserved as historical record): `CHANGELOG.md`, git commit history, top-level `README.md`, and any file under `specs/frs/archive/` or `specs/plan/archive/`.
- AC-STE-51.5: Post-rewrite ripgrep gate: `rg -n '\bFR-\d+\b' specs/frs specs/plan plugins/dev-process-toolkit/docs plugins/dev-process-toolkit/skills` returns zero matches (excluding `archive/` paths). The gate is run manually as part of the PR.

## Technical Design

One-off mechanical edit. No committed script, no module under `adapters/_shared/`, no unit tests for a migrator. The executor (human or Claude during `/implement`) walks the target file set, builds an in-head mapping of `FR-<N>` → `<NEW_PREFIX>` using `acPrefix()` from STE-50 against each FR's frontmatter, and applies the rewrites file-by-file — any throwaway tool (sed, ripgrep-replace, editor macros) is acceptable as long as the end state satisfies AC-STE-51.1–STE-51.5. Ordering dependency unchanged: runs **after** STE-50 lands (needs `acPrefix()`) and **before** STE-52's resolver removal (otherwise leftover FR-N references orphan themselves when `findFRByFRCode` disappears). Commit is a single atomic rewrite commit separate from the STE-50 mechanism commit.

## Testing

No unit tests — nothing to unit-test. Correctness signals: (1) full `/gate-check` green after the rewrite; (2) the AC-STE-51.5 ripgrep gate returns zero matches; (3) the AC-STE-50.5 duplicate-AC lint returns zero matches across the rewritten files.

## Notes

Scope is this repo only. No external adopters; no reusable slash command; no `/spec-write` support for triggering this rewrite on other projects. Post-rewrite, `FR-<N>` survives only as immutable history in `CHANGELOG.md`, git commit messages, and archived plans/FRs under `specs/**/archive/`. Future milestones' FRs are identified by tracker ID (Linear) or short-ULID alone.

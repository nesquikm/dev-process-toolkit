---
title: One-time rewrite of existing FR filenames to new convention
milestone: M18
status: archived
archived_at: 2026-04-23T11:34:27Z
tracker:
  linear: STE-61
created_at: 2026-04-23T08:18:02.000Z
---

## Requirement

After STE-60 ships, the resolver tolerates both ULID and tracker-ID filenames. STE-61 performs the one-time `git mv` rewrite of every existing FR file to its new convention-compliant name, removes the dual-pattern fallback from the resolver, flips the `/gate-check` filename assertion to strict, and updates any remaining cross-references.

At M18 kickoff time, scope is **83 archived FRs** in `specs/frs/archive/` from M12-M17 (all tracker-bound → all rename to `STE-N.md`). Any active FRs at STE-61 execution time (e.g., mid-flight work) are also renamed.

## Acceptance Criteria

- AC-STE-61.1: Every file matching `specs/frs/**/fr_*.md` is `git mv`d to its new name computed via `Provider.filenameFor(spec)`. Both active (`specs/frs/<name>.md`) and archive (`specs/frs/archive/<name>.md`) paths are rewritten. Tracker-bound FRs → `<tracker-id>.md`; FRs without tracker binding (defensive — should be zero at M18 kickoff) → `<short-ULID>.md`.
- AC-STE-61.2: Rewrite is **atomic** — all `git mv` operations land in a single commit. Pre-commit sanity: a script reads each file's frontmatter and asserts every FR has a resolvable new name (no nulls, no collisions).
- AC-STE-61.3: Cross-references that pin specific `fr_<ULID>.md` paths are updated:
  - `docs/**/*.md` — grep for `fr_[0-9A-HJKMNP-TV-Z]{26}\.md` patterns and rewrite to new name
  - `README.md` — any FR path references updated
  - `CHANGELOG.md` — **preserved verbatim** as historical record (intentional exception; historical entries naturally reference the old convention)
- AC-STE-61.4: `plugins/dev-process-toolkit/adapters/_shared/src/resolve.ts` `findFRByTrackerRef` Phase 2 (frontmatter-scan fallback added by STE-60 AC-STE-60.2) is removed. Resolver becomes single-pattern: direct filename lookup only. The helper signature is unchanged.
- AC-STE-61.5: `skills/gate-check/SKILL.md`'s filename-matches-frontmatter assertion (STE-60 AC-STE-60.7) flips from lenient to strict. Any ULID-named FR file fails the gate post-flip.
- AC-STE-61.6: Test files update:
  - `tests/resolver-dual-pattern.test.ts` (added by STE-60) is **deleted**
  - `tests/resolver-single-pattern.test.ts` is added, asserting the resolver fails fast on ULID-named files (negative test against a fixture)
- AC-STE-61.7: Ripgrep gate: `rg -n 'fr_[0-9A-HJKMNP-TV-Z]{26}\.md' plugins/ docs/ README.md specs/` returns zero matches. `CHANGELOG.md` is excluded (historical).
- AC-STE-61.8: Full `/gate-check` run passes post-rewrite. The now-strict filename-matches-frontmatter assertion confirms every FR file's basename matches its expected convention-compliant name.

## Technical Design

**Mechanical rewrite script.** A one-shot script (`scripts/rewrite-fr-filenames.ts` — committed alongside the rewrite commit, or discarded; pick during implementation) iterates `specs/frs/**/*.md`:

1. Read file; parse frontmatter
2. Compute new filename via `Provider.filenameFor(spec)` (same helper STE-60 added)
3. `git mv <old> <new>`
4. Collect any self-references in the file content (rare); rewrite in-place
5. After the loop, sanity-check: each FR's new filename is unique (no collisions in short-ULIDs across modes)

Then a second pass greps `docs/`, `README.md`, `specs/` for any pinned `fr_<ULID>.md` references and rewrites them.

All renames + doc updates + resolver simplification + gate flip land in **one commit**. Partial rewrites are the failure mode — half-renamed repo confuses readers and flaps the gate.

**Resolver simplification.** Delete Phase 2 from `findFRByTrackerRef`. Delete the `resolver-dual-pattern.test.ts` that exercised the fallback. Add `resolver-single-pattern.test.ts` asserting the strict behavior.

**Gate flip.** `skills/gate-check/SKILL.md` loses the "tolerate ULID filenames" branch; the assertion becomes `basename(file) == Provider.filenameFor(spec)`.

## Testing

Primary guards:
- Ripgrep gate (AC-STE-61.7) — zero `fr_<ULID>.md` references
- Strict filename assertion in `/gate-check` (AC-STE-61.5 + AC-STE-61.8)

Secondary:
- `resolver-single-pattern.test.ts` (AC-STE-61.6) — unit test confirms the resolver no longer falls back to frontmatter scanning

## Notes

**Breaking change:** anyone with a bookmark or external reference to `specs/frs/archive/fr_<old-ULID>.md` hits a dead link. git log --follow still traces renames. External references are assumed zero per M17's "no external consumers" justification (confirmed M17 deletion-sweep rationale).

**CHANGELOG intentionally exempt** from rewrite — historical release notes cite `fr_<ULID>` names from the era they were written; rewriting them would be historical revisionism. New CHANGELOG entries from M18 onward use the new convention.

**Mode transitions post-M18:** `/setup`'s mode-transition rename (STE-60 AC-STE-60.6) continues to handle the `none ↔ tracker` case for active FRs. Archive is frozen by STE-61; mode transitions do not retroactively touch archive.

**Dependency:** requires STE-60 landed first (Provider.filenameFor + lenient gate exist).

**Release implication:** the resolver simplification in AC-STE-61.4 removes ULID filename support entirely. Strict SemVer reading = major bump (v2.0.0). Pragmatic reading = minor bump (v1.21.0). No external consumers use the resolver programmatically, so pragmatic is defensible. Decision deferred to release time.

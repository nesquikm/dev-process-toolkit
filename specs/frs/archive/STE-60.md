---
title: Filename convention + code paths (tracker-ID-keyed / short-ULID)
milestone: M18
status: archived
archived_at: 2026-04-23T11:34:27Z
tracker:
  linear: STE-60
created_at: 2026-04-23T08:17:58.000Z
---

## Requirement

The plugin's FR files live at `specs/frs/fr_<ULID>.md` — ULID is collision-proof but opaque to humans. Tracker-mode projects (the primary use case) reference tickets by `STE-N` everywhere — prose, ACs, headings, Linear UI, commit messages — except in the filename. `mode: none` projects reference FRs by short-ULID in ACs per M16's AC-prefix convention, but again not in the filename. M18 closes that gap: filename matches the human-facing prefix.

**New convention:**
- **Tracker mode**: `specs/frs/<tracker-id>.md` (e.g., `STE-53.md`)
- **`mode: none`**: `specs/frs/<short-ULID>.md` — 6-char tail of `spec.id`, matching M16's AC-prefix (e.g., `VDTAF4.md`)

STE-60 defines the convention, updates all code paths, and tolerates both patterns (ULID legacy + new convention) during the transition window. STE-61 performs the one-time rewrite of existing FRs and collapses the resolver back to single-pattern.

## Acceptance Criteria

- AC-STE-60.1: `Provider` interface gains `filenameFor(spec: FRSpec): string` returning the base filename with `.md` extension but no directory. `LocalProvider` returns `<short-ULID>.md` (6-char tail of `spec.id`, via the same `spec.id.slice(23, 29)` rule M16's `acPrefix()` uses). `LinearProvider` (or the active tracker adapter class) returns `<tracker-id>.md` using `spec.tracker[adapter.name]`. Adapters for other trackers follow the same pattern.
- AC-STE-60.2: `plugins/dev-process-toolkit/adapters/_shared/src/resolve.ts` `findFRByTrackerRef(specsDir, trackerKey, trackerId)` is updated to two-phase resolution: (a) direct filename hit — read `<specsDir>/<trackerId>.md` + `<specsDir>/archive/<trackerId>.md`; (b) fallback frontmatter scan — iterate any `fr_*.md` files (active + archive) and match on `frontmatter.tracker[trackerKey]`. Phase (b) is the transition-window tolerance removed by STE-61.
- AC-STE-60.3: `skills/spec-write/SKILL.md` step 0b.2 filename construction uses `Provider.filenameFor(spec)` for new FRs instead of the hard-coded `fr_<ULID>.md`.
- AC-STE-60.4: `skills/implement/SKILL.md` Phase 4 archival `git mv` source and destination paths use `Provider.filenameFor(spec)`.
- AC-STE-60.5: `skills/spec-archive/SKILL.md` filename construction (both active → archive paths) uses `Provider.filenameFor(spec)`.
- AC-STE-60.6: `skills/setup/SKILL.md` mode-transition rename step: on `mode: none → tracker` or `tracker → mode: none`, for each FR under `specs/frs/*.md` (active — NOT archive), compute the new filename via `Provider.filenameFor()`, `git mv` to the new name, update any self-referencing cross-links inside the file (rare — checked by grep). All renames land in a single atomic commit per transition.
- AC-STE-60.7: `skills/gate-check/SKILL.md` gains a "Filename matches frontmatter" assertion. For each `specs/frs/**/*.md`, compute expected filename via `Provider.filenameFor(spec)`; compare against actual basename. During the STE-60→STE-61 transition window, the check is **lenient**: `fr_<ULID>.md` files are tolerated. STE-61 flips the check to strict.
- AC-STE-60.8: Docs updated to describe the new convention:
  - `docs/v2-layout-reference.md` — filename convention section (new or updated)
  - `docs/patterns.md` — FR identity pattern updated; M13's pattern gets a `Supersedes` / `Superseded-by` note
  - `docs/sdd-methodology.md` — filename references in tree diagrams
  - `docs/skill-anatomy.md` — FR creation path description
  - `docs/adaptation-guide.md` — any filename references
  - `templates/CLAUDE.md.template` — tree diagram
  - `docs/ticket-binding.md` — mode-transition rename flow
  - `docs/resolver-entry.md` — explain dual-pattern resolver during transition + STE-61 collapse
- AC-STE-60.9: `plugins/dev-process-toolkit/tests/filename-convention.test.ts` covers `Provider.filenameFor()` for tracker mode + `mode: none`, plus `ShortUlidCollisionError` semantics (reuse of M16's existing `scanShortUlidCollision`).
- AC-STE-60.10: `plugins/dev-process-toolkit/tests/resolver-dual-pattern.test.ts` covers `findFRByTrackerRef` tolerating both ULID and tracker-ID filenames during transition. This test is deleted by STE-61.

## Technical Design

**`Provider.filenameFor(spec)`** returns the full base filename including `.md` extension (no directory). Tracker mode: `spec.tracker[adapter.name] + ".md"`. Mode: none: `spec.id.slice(23, 29) + ".md"`. Exact short-ULID slice matches M16's `acPrefix()` for consistency — filename, AC prefix, and heading prefix all derive from the same identifier.

**Dual-pattern resolver.** `findFRByTrackerRef` gets two phases:

```
Phase 1 — direct filename lookup (O(1)):
  try readFile(<specsDir>/<trackerId>.md)
  try readFile(<specsDir>/archive/<trackerId>.md)
  return hit if found

Phase 2 — frontmatter scan fallback (O(N)):
  for each fr_*.md in <specsDir>/ + <specsDir>/archive/:
    parse frontmatter
    if frontmatter.tracker[trackerKey] == trackerId:
      return hit
  return miss
```

Post-STE-61, Phase 2 is deleted — the resolver is strictly filename-keyed.

**`/setup` mode-transition rename.** The existing mode-change flow gains a rename sub-step. Each FR in `specs/frs/*.md` (active only) is renamed via `git mv`, frontmatter preserved. Archive is untouched by mode transitions — archived FRs stay under their current convention at the time of archival; STE-61 is the separate bulk rewrite for existing archives.

**`/gate-check` lenient mode.** During the transition window the assertion accepts either `fr_<ULID>.md` OR `Provider.filenameFor(spec)` as valid. STE-61 AC-STE-61.5 flips this to strict mode.

## Testing

Two new test files:
- `filename-convention.test.ts` — `Provider.filenameFor()` behavior for tracker + mode: none, edge cases on short-ULID derivation
- `resolver-dual-pattern.test.ts` — `findFRByTrackerRef` direct hit + frontmatter fallback

Existing resolver tests update to cover the direct-hit path (cheap optimization over frontmatter scan). M17-era tests continue to pass unchanged — no FR files are renamed during STE-60 implementation.

## Notes

**Transition window discipline.** Landing STE-60 without STE-61 leaves the resolver in dual-pattern mode indefinitely. That's technical debt. STE-60's notes explicitly flag that STE-61 should land in the same PR sequence or very close; the team shouldn't treat "STE-60 shipped" as "milestone done."

**Dependency:** lands first in M18 (STE-60 → STE-61). STE-61 depends on `Provider.filenameFor()` and the lenient gate assertion.

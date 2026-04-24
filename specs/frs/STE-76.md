---
id: fr_01KPXG3Z2H1VCC70QHSACEQ3Y0
title: De-ULID tracker-mode FRs — drop id frontmatter, migrate archive
milestone: M21
status: active
archived_at: null
tracker:
  linear: STE-76
created_at: 2026-04-23T15:42:00Z
---

## Requirement

In tracker mode, every FR carries `id: fr_<ULID>` in frontmatter as "collision-proof canonical identity" (NFR-15). But the filename is the tracker ID (`STE-72.md`), the AC prefix is the tracker ID (`AC-STE-72.1`), and STE-67 (M19) made ULIDs invisible in all user-facing prose. The ULID only matters as a hedge against tracker-workspace renames — a scenario `findFRByTrackerRef` already handles via the frontmatter `tracker:` field.

In short: tracker-mode ULIDs are ceremony. Every new FR mints one; every spec-write has to think about it; every reviewer has to parse past it. STE-76 removes the ceremony.

Mode-none keeps the short-ULID (6-char tail) as filename + AC prefix convention — that stays unchanged. Only the tracker-mode `id:` frontmatter goes.

This FR is a **seed placeholder** captured during M20 spec-write (2026-04-23). Full specification (detailed Technical Design, per-file migration plan, risk scan) to be authored in a future `/spec-write` session. The seed is sufficient to anchor the milestone in Linear and in the local plan.

## Acceptance Criteria

- AC-STE-76.1: Schema Q frontmatter definition in `technical-spec.md` is updated: `id` is mode-conditional — **required** in `mode: none`, **absent** in tracker mode. Full contract spelled out in the conditional clause of Schema Q.
- AC-STE-76.2: NFR-15 Identity Invariant is revised: tracker-mode identity is the tracker ID (filename stem + AC prefix); mode-none identity is the short-ULID (6-char tail). Cross-mode symmetry is dropped as a stated invariant.
- AC-STE-76.3: `Provider.mintId()` is mode-conditional: `LocalProvider` still mints ULIDs; `TrackerProvider` returns the tracker ID directly. No ULID is generated in tracker mode at FR creation time.
- AC-STE-76.4: `findFRByTrackerRef` remains the cross-ref mechanism — its existing behavior is unchanged; it now covers the only remaining tracker-rename scenario.
- AC-STE-76.5: Migration: all 91+ archived FRs under `specs/frs/archive/` have their `id:` line removed. Single atomic commit with descriptive message. Filenames already match tracker IDs (STE-60+ M18 convention) — no `git mv` needed.
- AC-STE-76.6: `/gate-check` gains an assertion: in tracker mode, `id:` must be absent from active FR frontmatter. Missing-but-expected or present-but-forbidden are both gate failures with NFR-10 remedy.
- AC-STE-76.7: Rollback strategy: migration is one atomic commit. If downstream dogfooding surfaces an unexpected invariant break, the commit is reverted — no partial state.

**Note:** these ACs are the seed set. A full `/spec-write` pass will likely refine / expand them; current form captures the decision shape without deep design.

## Technical Design

**Deferred to full `/spec-write`.** Top-level shape:

- Edit Schema Q in `specs/technical-spec.md` for mode-conditional `id`.
- Edit NFR-15 in `specs/requirements.md` for the revised invariant.
- Edit `adapters/_shared/src/local_provider.ts` — no change (mode-none keeps ULIDs).
- Edit `adapters/_shared/src/tracker_provider.ts` — `mintId()` returns tracker ID.
- New migration script `adapters/_shared/src/migrations/strip_ulid.ts` (one-shot) — removes `id:` line from tracker-mode FR frontmatter under `specs/frs/archive/**/*.md`.
- `/gate-check` SKILL.md addition for AC-STE-76.6 assertion.
- Regression: mode-none fixtures (`tests/fixtures/mode-none-regression/`) must remain byte-identical post-migration.

## Testing

Deferred to full `/spec-write`. Coverage expectation: 100% branch coverage on new migration script (NFR-21 analog), snapshot regression on `mode-none-regression` fixture, and a new `tracker-de-ulid` fixture for the `/gate-check` assertion (both "`id:` absent in tracker mode" and "`id:` present in mode: none" flavors).

## Notes

**Why now.** Surfaced during M20 spec-write when the user asked "why are we minting ULIDs for tracker-mode projects?". The answer was "we follow existing convention" — which was correct but prompted the recognition that the convention itself is ceremony worth removing. Deferred to M21 to keep M20 focused on docs generation.

**Dependency.** Order: **M22 → M20 → M21.** M22 (v1.22.0 release-prep audit sweep) must ship first because its STE-80 installs the `<tracker-id>` template convention that STE-76's Schema Q revision will touch — STE-76 makes `id:` mode-conditional, and the template's seeded Schema Q example must mirror the revised invariant cleanly. M22's STE-82 also installs the probe authoring contract (every `/gate-check` probe ships with its integration test); AC-STE-76.6 (gate-check assertion for `id:` absent from tracker-mode) needs to honor this — full `/spec-write` pass should add the probe test explicitly. M20 (v1.23.0 docs) should settle before M21's archive migration to avoid cross-milestone churn on the FR set; no hard blocker, scheduling preference.

**Scope boundary.** Git-history rewrites of ULID references in old commit messages / CHANGELOG entries are explicitly out of scope. Historical records remain intact; the change is forward-only from v1.24.0 (or whatever M21 ships as).

**Why not remove mode-none ULIDs too.** Mode-none has no tracker-side identity — the short-ULID IS the identity. Removing it would force mode-none to invent an alternate keying scheme (filename-based collisions, sequence numbers, etc.) which is a much larger design change.

**Release target:** TBD. Codename TBD. Not blocking M20.

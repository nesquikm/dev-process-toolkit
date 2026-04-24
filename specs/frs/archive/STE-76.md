---
title: De-ULID tracker-mode FRs — spec-text + archive migration
milestone: M21
status: archived
archived_at: 2026-04-24T17:55:00Z
tracker:
  linear: STE-76
created_at: 2026-04-23T15:42:00Z
---

## Requirement

Tracker-mode FRs carry `id: fr_<ULID>` in frontmatter as "collision-proof canonical identity" (NFR-15 invariant #2). But post-M16/M18/M19, the ULID is pure ceremony:

- Filename is the tracker ID (`STE-76.md`) — M18 STE-60.
- AC prefix is the tracker ID (`AC-STE-76.1`) — M16 FR Identity Stability.
- User-facing prose carries no ULIDs — M19 STE-67.
- Tracker-workspace renames are handled by `findFRByTrackerRef` via the `tracker:` map — no `id:` needed for that.

STE-76 removes the ceremony. In tracker mode, `id:` is absent from frontmatter; the tracker ID is the canonical identity. `Provider.mintId()` stops being called on the tracker-mode code path. Mode-none keeps the short-ULID convention (filename stem + `id:` value + AC prefix) — each mode owns its own identity scheme, and cross-mode symmetry is explicitly dropped from NFR-15.

This FR covers the **spec-text edits, archive data migration, and tracker-mode code-path changes**. The structural capability-split of the `Provider` interface is scoped to STE-85; the migration tool + bimodal probe test are scoped to STE-86.

## Acceptance Criteria

- AC-STE-76.1: Schema Q (`specs/technical-spec.md` § Schema Q) declares `id:` **mode-conditional** — required in `mode: none`, absent in tracker mode. The conditional clause spells out both rules and cross-references NFR-15.
- AC-STE-76.2: NFR-15 (`specs/requirements.md`) is rewritten: tracker-mode identity = tracker ID (filename stem + AC prefix); mode-none identity = short-ULID (6-char tail, filename stem + AC prefix + `id:` value). Invariant #2 (`id: ≡ filename stem`) becomes mode-scoped to `mode: none`. Cross-mode symmetry is explicitly dropped.
- AC-STE-76.3: All active tracker-mode FRs in `specs/frs/*.md` have their `id:` frontmatter line removed. At M21 kickoff this is STE-76 + the two FRs created by this `/spec-write` session; by implementation time the count may grow (any FR added under tracker mode during M21 development is covered by the same edit pass).
- AC-STE-76.4: All **tracker-mode** archived FRs under `specs/frs/archive/**/*.md` (76 files at M21 implementation time; 31 mode-none hybrid archives are skipped by the mode-aware migration tool — bimodal safety per NFR-15 mode-scoped Invariant #2) have their `id:` frontmatter line removed. Execution uses the migration tool from FR-`STE-86`. Single atomic commit. Filenames unchanged (already tracker-ID-stemmed per STE-60).
- AC-STE-76.5: Tracker-mode code paths no longer call `Provider.mintId()` or write `id:` frontmatter. Specifically: `adapters/_shared/src/import.ts` drops the `provider.mintId()` call (current line 33) on the tracker path, and the FR-creation body stops emitting the `id:` line when the resolved mode is tracker. `TrackerProvider.mintId()` survives as now-dead code until FR-`STE-85` removes it from the `Provider` interface — flagged by an inline `// TODO(STE-<capability-split>)` comment.
- AC-STE-76.6: `findFRByTrackerRef` (`adapters/_shared/src/resolve.ts`) behavior unchanged — remains the cross-ref mechanism for tracker-workspace renames. No code diff; covered by existing regression fixtures.
- AC-STE-76.7: `/gate-check` gains a **warning-level** probe (defined in FR-`STE-86`): in tracker mode, `id:` must be absent from active FR frontmatter; in `mode: none`, `id:` must be present and equal the filename stem. Warnings surface in the report but do not fail the gate. Posture switches to hard-fail (`severity: error`) after ≥1 full dogfood cycle — the switch is a single-line probe edit and does not require its own FR.
- AC-STE-76.8: Mode-none regression: fixtures under `tests/fixtures/mode-none-regression/` remain byte-identical post-migration. No change to `LocalProvider.mintId()`, Schema Q mode-none clause, or short-ULID AC-prefix logic.
- AC-STE-76.9: Rollback strategy: the archive migration (AC-STE-76.4) lands as one atomic commit; active-FR edits (AC-STE-76.3) and code-path edits (AC-STE-76.5) land in a single subsequent commit. If post-migration dogfood surfaces a missed invariant, reverting both commits produces a consistent pre-M21 state.

## Technical Design

**Work streams land in order**: FR-`STE-86` (migration tool + probe) → STE-76 (this FR: spec-text + active-FR strip + tracker-path code edits + archive migration run) → FR-`STE-85` (capability split).

### Spec-text edits (AC-STE-76.1, AC-STE-76.2)

- `specs/requirements.md` NFR-15 — rewrite per AC-STE-76.2. Invariant #2 becomes mode-scoped; cross-mode symmetry sentence is removed.
- `specs/technical-spec.md` Schema Q — replace the `id:` "required" clause with a mode-conditional block; cross-reference NFR-15.
- `plugins/dev-process-toolkit/templates/spec-templates/fr.md.template` — drop `id: fr_<ULID>` from the tracker-mode example; annotate the conditional.
- `plugins/dev-process-toolkit/docs/**` — audit `v2-layout-reference.md`, `spec-write-tracker-mode.md`, `ticket-binding.md`, and any patterns doc referring to Schema Q `id:` as unconditional.

### Tracker-path code edits (AC-STE-76.5)

- `adapters/_shared/src/import.ts` — delete the `provider.mintId()` call (line 33 at time of writing); stop emitting `id:` in the generated FR frontmatter when the resolved mode is tracker. Filename is already tracker-ID-stemmed via `Provider.filenameFor(spec)` (AC-STE-60.3); no filename change.
- `adapters/_shared/src/tracker_provider.ts` — leave `mintId()` body as-is; add `// TODO(STE-<capability-split>): remove when Provider.mintId() moves to IdentityMinter sub-interface` above the method. Unreachable post-STE-76 in production code paths.
- `adapters/_shared/src/ac_prefix.ts` — no change (already bimodal per AC-STE-50.2).
- `adapters/_shared/src/local_provider.ts` — no change (mode-none keeps `id:`).
- Active tracker-mode FR files (`specs/frs/STE-76.md` + the two new M21 FRs): strip the `id:` line in the same commit as the code edits.

### Archive migration (AC-STE-76.4)

Executed via `strip_ulid.ts` from FR-`STE-86`:

1. Dry-run against `specs/frs/archive/**/*.md`; confirm file count matches (107 as of 2026-04-24).
2. Apply; verify each file still parses as YAML frontmatter + Markdown body.
3. Commit atomically with message `chore(m21): strip id: frontmatter from 107 archived tracker-mode FRs (STE-76)`.

### Why the split (STE-76 vs. FR-`STE-85` vs. FR-`STE-86`)

- STE-76 is a **spec + data migration** FR. Its ACs are about contents: Schema Q text, archive files, active files, probe-emission posture.
- The **capability split** is a pure-refactor typecheck-pass; bundling it with the data migration bloats the review surface and mixes concerns.
- The **migration tool** is one-shot code with its own test surface; bundling would force STE-76 to own tests for machinery it only executes.

### Why warning-first probe (AC-STE-76.7)

A hard-fail from day one risks blocking `/gate-check` if any downstream consumer (skill, adapter, internal probe) reads `id:` from a tracker-mode FR in a path I haven't audited. Warning-first surfaces violations without blocking. After one full dogfood cycle across `/implement`, `/spec-write`, `/spec-review`, `/docs`, `/ship-milestone`, `/gate-check --probe`, and `/debug`, the probe's `severity:` flips from `warning` to `error` in a single-line follow-up.

## Testing

- **Spec-text coverage**: spec files are the source of truth; `/spec-review` catches drift. No tests.
- **Migration execution**: unit + integration tests live in FR-`STE-86`.
- **Bimodal invariant**: probe test + its STE-82-style integration test live in FR-`STE-86`.
- **Mode-none regression**: `tests/fixtures/mode-none-regression/` snapshot must be byte-identical post-migration (AC-STE-76.8). Any drift is a blocker.
- **Post-migration archive spot-check**: after the atomic commit from AC-STE-76.4, inspect 3 archived FRs (oldest / median / newest by `created_at`) — confirm YAML parses, body is byte-identical except for the removed `id:` line, and the file still resolves via `findFRByTrackerRef`.
- **Import regression**: `adapters/_shared/src/import.test.ts` gains a case asserting that a tracker-mode `importFromTracker` call produces an FR with no `id:` line; the existing mode-none case remains unchanged.

## Notes

**Why now.** Surfaced during M20 spec-write (2026-04-23). Scope expanded during M21 brainstorm (2026-04-24) from spec-text-only to full scope-3 isolation (capability interface, Option 2) after the user observed that scripts should support both modes cleanly — "eliminate ULID from everywhere in tracker mode."

**Dependency chain.** M22 (v1.22.0) shipped first, installing the STE-80 `<tracker-id>` template convention Schema Q now inherits. M20 (v1.23.0) shipped first to settle the FR set before the 107-file archive rewrite. Within M21: FR-`STE-86` (migration tool + probe) → STE-76 (this FR) → FR-`STE-85` (capability split).

**Scope boundary.** Git-history rewrites of ULID references in old commit messages / CHANGELOG entries are out of scope. Historical records stay intact; the change is forward-only from the release that ships M21.

**Why not drop mode-none ULIDs too.** Mode-none has no tracker-side identity — the short-ULID IS the identity. Removing it would force an alternate keying scheme (filename collisions, sequence numbers), a much larger redesign.

**Release target:** v1.24.0 (provisional). Codename TBD.

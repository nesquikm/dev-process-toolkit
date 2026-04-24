---
title: Purge v1 specs/archive/ Drift from Docs, Skills, Specs
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-49
created_at: 2026-04-22T13:44:35Z
---

## Requirement

The v1→v2 layout migration (M13 Phase D) converted the filesystem from a flat `specs/archive/M{N}-{slug}.md` + rolling `index.md` layout to per-unit archives at `specs/frs/archive/<ulid>.md` + `specs/plan/archive/M{N}.md`. The prose around that filesystem was never cleaned up: `README.md:34`, three docs (`sdd-methodology.md`, `patterns.md`, `adaptation-guide.md`), three skills (`/spec-archive` — whose entire procedure is still written for v1 — plus `/setup` § 8 and `/implement` Phase 4), and the live cross-cutting specs all still speak the v1 archive path. `/setup` still provisions `specs/archive/` + an archive-index template on fresh v2 projects. FR-45 already shipped the v2 archival mechanism (`git mv` + frontmatter flip + INDEX.md regen, AC-45.1/2/4/6); this FR makes the documentation and skill prose catch up.

**Scope:** doc/skill/spec prose rewrites only. No new runtime behavior — FR-45 already shipped the v2 mechanism. This FR ships the v2 documentation.

## Acceptance Criteria

### AC-70.1: `specs/archive/` appears nowhere in tracked prose {#AC-70-1}

Running `grep -rn 'specs/archive' plugins/dev-process-toolkit/docs plugins/dev-process-toolkit/skills README.md specs/requirements.md specs/technical-spec.md specs/testing-spec.md` returns zero matches. Occurrences under `plugins/dev-process-toolkit/tests/fixtures/` (legacy/migration test data), `CHANGELOG.md` (release history), `specs/frs/archive/` (archived FR content, frozen), and `specs/plan/archive/` (archived milestone content, frozen) are exempt from this gate.

### AC-70.2: `/spec-archive` SKILL.md describes v2 primitives end-to-end {#AC-70-2}

`plugins/dev-process-toolkit/skills/spec-archive/SKILL.md` describes the procedure as:

1. Resolve the argument (ULID, tracker ID, URL, or `M<N>`) to one or more FR file paths.
2. For each FR: `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` + flip frontmatter `status: active → archived` + set `archived_at: <ISO>`.
3. For `M<N>` milestone-group args: batch all matching FRs in one commit (AC-45.6), and if the milestone plan file is also present, `git mv specs/plan/M{N}.md specs/plan/archive/M{N}.md` in the same commit.
4. Regenerate `specs/INDEX.md` via `regenerateIndex(specsDir)`.
5. Call `Provider.releaseLock(id)` for each archived FR.

No mention of Schema G archive files, `index.md` row appends, or `specs/archive/` anywhere in the file. The v1 "write file first / append to index.md / rewrite pointer line" procedure is removed in full.

### AC-70.3: `/setup` creates no v1-archive artifacts {#AC-70-3}

`plugins/dev-process-toolkit/skills/setup/SKILL.md` § 8 "Create specs (optional)" does not reference `specs/archive/` or the `archive-index.md.template`. Running `/setup` on a fresh project (default layout: v2) produces `specs/`, `specs/frs/`, `specs/plan/`, `specs/.dpt-layout` (version: v2), and the base template files (`requirements.md`, `technical-spec.md`, `testing-spec.md`, cross-cutting stubs). No `specs/archive/` directory and no `specs/archive/index.md`.

### AC-70.4: `/implement` Phase 4 prose drops v1 fallback {#AC-70-4}

`plugins/dev-process-toolkit/skills/implement/SKILL.md` Phase 4 archival section:

- The "v1 procedure (legacy layout)" paragraph referencing Schema G and `specs/archive/M{N}-{slug}.md` is removed.
- The "Do not read specs/archive/ during implementation" cautionary line is rewritten to "Do not read `specs/frs/archive/` or `specs/plan/archive/` during implementation — archived FRs and milestones are historical context only."
- All other archival language in the skill describes only the v2 `git mv` + frontmatter-flip flow.

### AC-70.5: README.md `:34` aligns with v2 {#AC-70-5}

The `/spec-archive` row in `README.md`'s skills table describes the skill as archiving FRs into `specs/frs/archive/` and archiving milestones into `specs/plan/archive/` — not `specs/archive/`. Citation references to FR-17/FR-21 remain (the FRs are archived; their citation is historical).

### AC-70.6: Doc files rewritten for v2 archival {#AC-70-6}

The following docs reference `specs/frs/archive/` / `specs/plan/archive/` consistently and `specs/archive/` zero times:

- `plugins/dev-process-toolkit/docs/sdd-methodology.md` (§ "Specs are compactable" + "Archival-hotspot collisions")
- `plugins/dev-process-toolkit/docs/patterns.md` (§ Archival Lifecycle pattern)
- `plugins/dev-process-toolkit/docs/adaptation-guide.md` (§ "Opting in / opting out of archival" and § "Layout customization")

Historical *citations* of FR-16/FR-17/FR-19 as archived-FR references remain; v1-specific procedural instructions that would produce `specs/archive/`-layout artifacts are rewritten to describe FR-45's per-unit v2 flow.

### AC-70.7: Live cross-cutting specs reference v2 archive paths only {#AC-70-7}

- `specs/requirements.md:10-20` — "Shipped milestones" block: each milestone pointer points at the real v2 path (`specs/plan/archive/M{N}.md`), not the defunct `specs/archive/M{N}-{slug}.md`. Per-slug filenames like `M11-single-file.md` are replaced with `M11.md`.
- `specs/technical-spec.md` § 203 Schema G archive-file-format section is removed (v1-only) OR rewritten to state that in v2 the archive-side header is the FR's Schema Q frontmatter itself (pointing to the existing Schema Q definition rather than defining a new schema).
- `specs/technical-spec.md` § 369 ADR "Archive directory layout" is superseded: the live decision reads **(a) flat per-unit — archived FRs at `specs/frs/archive/<ulid>.md`, archived milestones at `specs/plan/archive/M{N}.md`**. The original v1-flat decision row is marked `Superseded-by: FR-70`.
- `specs/technical-spec.md` § 582 Pattern 5 Sync-Log rotation: the `/spec-archive rotates old entries to specs/archive/sync-log-<YYYY-MM>.md` clause is **removed** — sync-log rotation is speculative (NFR-5 append-only, current log is 2 entries), and reintroducing a `specs/archive/` path for one unused feature would contradict AC-70.1.

### AC-70.8: testing-spec.md test matrix prunes dead v1 rows {#AC-70-8}

`specs/testing-spec.md` has zero rows referencing `specs/archive/`:

- Rows at lines 93–94, 101, 103 (FR-16 / FR-19 setup-archival test rows) are **removed** — those FRs are archived, their v1-specific ACs no longer describe live behavior, and FR-45 supplies the v2 equivalents already covered by its own test rows.
- Rows at lines 144, 145, 147 (post-archive drift test steps) are **rewritten** to reference `specs/frs/archive/` and/or `specs/plan/archive/` as appropriate.
- The "Literal strings" row (line 26) drops the AC-16.7 / AC-19.5 / AC-19.6 literal citations (ACs are frozen in archived FRs) and retains the AC-45.x literals for the v2 `git mv` flow.
- Row at line 189 (pre-v1.10.0 specs fixture) is **removed** — the plugin no longer supports projects without `.dpt-layout`; that edge case was retired by the M13 v2 migration.

### AC-70.9: `archive-index.md.template` removed or marked legacy {#AC-70-9}

`plugins/dev-process-toolkit/templates/spec-templates/archive-index.md.template` is **deleted** (preferred — nothing references it after this FR lands), or its first line is rewritten to `<!-- LEGACY v1-layout only; not copied by /setup on v2 projects -->`. No skill, doc, README, or live spec references the template path after this FR.

### AC-70.10: Gate checks pass; regression test enforces AC-70.1 {#AC-70-10}

`/gate-check` passes on the plugin's own repo after this FR lands: no drift findings, all tests pass. A new regression test at `plugins/dev-process-toolkit/tests/archive-path-drift.test.ts` executes the AC-70.1 grep over the same path set and asserts zero matches; the test fails loudly if any future change reintroduces `specs/archive/` in tracked prose.

## Technical Design

**No code change.** All work is `Edit`-tool rewrites of `.md` files plus one template deletion plus one new test file. FR-45 already shipped the v2 archival mechanism (`git mv` + frontmatter flip, AC-45.1/2/4/6) — the behavior exists. This FR aligns the prose to match.

**Order of edits** (to minimize inconsistency windows — skills change behavior contracts, so update them first so any in-flight invocation reads a consistent instruction):

1. **Skills** — `/spec-archive` full procedure rewrite; `/setup` § 8 v1 archive-dir-creation step removed; `/implement` Phase 4 v1 fallback paragraph removed.
2. **Docs** — `sdd-methodology.md`, `patterns.md`, `adaptation-guide.md`, `README.md`.
3. **Live specs** — `requirements.md` milestone pointers; `technical-spec.md` § 203 / § 369 / § 582; `testing-spec.md` matrix rows.
4. **Template cleanup** — delete `archive-index.md.template`.
5. **Regression test** — add `tests/archive-path-drift.test.ts` asserting AC-70.1 grep.
6. **Final scan** — `grep -rn 'specs/archive'` over the AC-70.1 path set → zero matches gate.

**Three edit categories** (per-file treatment):

- **Replace with v2 paths.** Most references. `/spec-archive` procedure, README row, patterns "Archival Lifecycle", `/implement` Phase 4 cautionary line, requirements milestone pointers.
- **Delete entirely.** v1-only content with no v2 equivalent. `/setup` archive-dir step, `technical-spec.md` § 203 Schema G section, testing-spec FR-16/FR-19 setup-archival rows and the pre-v1.10.0 fixture row, `archive-index.md.template`.
- **Leave alone.** History. `CHANGELOG.md`, `specs/frs/archive/` FR content, `specs/plan/archive/` milestone content, `tests/fixtures/` legacy/migration test fixtures.

**Superseded v1 FR clauses.** FR-16 (auto-archive Phase 4), FR-17 (Schema G file format), FR-19 (setup provisions archive dir), FR-21 (post-archive drift check) each carry v1-specific clauses superseded by FR-45's per-unit archival. These FRs are already archived at `specs/frs/archive/fr_01KPR3M74XA75GJKT4Z4HG95V{9,A,B,C,D}.md`; their content is frozen. This FR does **not** edit archived FR files — it only removes the *live* references to their v1 clauses and adds `Superseded-by: FR-70` on the technical-spec ADR that still carries a live v1 decision.

## Testing

Primary gate is **AC-70.1** (deterministic `grep -rn` over the AC-70.1 path set, zero matches). Secondary gate is **AC-70.10** (`/gate-check` on the plugin's own repo).

New automated regression test: `plugins/dev-process-toolkit/tests/archive-path-drift.test.ts`. Shells the same `grep -rn 'specs/archive'` command over `plugins/dev-process-toolkit/docs`, `plugins/dev-process-toolkit/skills`, `README.md`, and the three live cross-cutting spec files. Asserts zero matches. Test must fail loudly if any future commit reintroduces `specs/archive/` in tracked prose.

No unit tests are required — the work is prose, and AC-70.2 through AC-70.9 are reviewed by rendering each rewritten skill/doc mentally against a fresh v2 project and confirming the prose describes what FR-45 actually does.

## Notes

- **Why one FR not split.** The edits are small per-file but tightly coupled — changing `/spec-archive` prose forces matching README-row + patterns-"Archival Lifecycle" + adaptation-guide updates in the same change. Splitting would multiply inter-FR merge-ordering headaches without reducing actual work. Brainstorm 2026-04-22 (option A) confirmed.
- **Relationship to FR-45.** FR-45 shipped the v2 archival *mechanism* (git mv, frontmatter flip, INDEX regen, AC-45.1/2/4/6). FR-70 ships the v2 archival *documentation*. FR-45 without FR-70 leaves every skill and doc describing a code path that no longer exists.
- **Out of scope.** Top-level archive rollup index (brainstorm option 2 was declined — per-unit archives only); changing per-unit archival semantics; editing archived FR file content; reintroducing `specs/archive/` under any name including sync-log rotation.
- **Discovery.** Dogfooding session 2026-04-22 surfaced this drift while investigating "we have specs/archive and specs/frs/archive/ in several places, should we make everything consistent?" The underlying v2 filesystem was already correct; only the prose was out of date.

---
title: Hide full 26-char ULIDs from user-facing surfaces in tracker-mode projects
milestone: M19
status: archived
archived_at: 2026-04-23T14:49:58Z
tracker:
  linear: STE-67
created_at: 2026-04-23T13:27:25Z
---

## Requirement

The 26-char ULID (`fr_<26chars>`) is the collision-proof stable primary key. Its legitimate homes are (a) frontmatter `id:` (Schema Q invariant, NFR-15) and (b) code-internal references (`Provider.getMetadata`, resolver, `getFrPath`). It is **not** a user-facing identifier — in tracker mode the human-facing ID is the tracker ID (`STE-67`); in `mode: none` it's the short-ULID tail (`VDTAF4`). The full 26-char form appearing in user-facing prose is redundant noise inherited from the pre-M18 era when ULIDs were also the filename stems.

Surfaces to clean up:

- Linear ticket description `**ULID:**` header (currently emitted by every FR description in tracker mode — STE-60 through STE-67 all carry it)
- `specs/plan/M<N>.md` FR-list table ULID column
- `CHANGELOG.md` active release section narrative, `README.md` prose (historical archive sections and past releases are exempt — frozen)

Frontmatter `id:`, code paths (`Provider.getMetadata`, `findFRByTrackerRef`, `getFrPath`, `importFromTracker`'s internal renderer), and archived content are explicitly out of scope. `mode: none` projects continue to reference the short-ULID tail (6 chars) as the human-facing identifier — only the full 26-char form is prohibited in prose.

## Acceptance Criteria

- AC-STE-67.1: `specs/plan/M<N>.md` FR-list table columns reduce to `FR | Title | Tracker` (drop ULID). The existing `specs/plan/M19.md` is rewritten in the same commit as a one-shot cleanup; the plan template at `plugins/dev-process-toolkit/templates/spec-templates/plan.md.template` (or wherever the canonical template lives) gets the same treatment. Mode: none projects show short-ULID tail in the `FR` column; tracker mode shows the tracker ID.
- AC-STE-67.2: Existing Linear descriptions for M19's active tickets (STE-63, STE-64, STE-65, STE-66, STE-67) have their `**ULID:** fr_...` header block rewritten in a one-shot cleanup (one `save_issue` per ticket). The replacement header is `**Spec file:** specs/frs/<tracker-id>.md` and carries no ULID reference. No ULID leak in the description body either.
- AC-STE-67.3: `plugins/dev-process-toolkit/adapters/linear.md`'s `ticket_description_template` frontmatter field drops any ULID reference. Canonical form: `"{fr_body}\n\n---\n\nSource: specs/frs/{tracker_id}.md"`. The `{fr_anchor}` substitution variable is retired if it only served the ULID header; otherwise the template is updated to route it through the tracker-ID path.
- AC-STE-67.4: `importFromTracker` in `plugins/dev-process-toolkit/adapters/_shared/src/import.ts` does not include the ULID in the rendered description pushed back to the tracker via `Provider.sync(spec)`. Only the FR frontmatter carries it.
- AC-STE-67.5: `plugins/dev-process-toolkit/docs/patterns.md` Pattern 6 (Tracker Mode) gains a short "Full ULIDs are internal-only" callout: *"In tracker mode, user-facing prose (Linear descriptions, plan-file FR lists, CHANGELOG active-release sections, README) references FRs by their tracker ID. The 26-char ULID lives only in frontmatter `id:` and in code-internal references — never surfaced to human readers. Archived content keeps whatever form it had at archival time."*
- AC-STE-67.6: `skills/gate-check/SKILL.md` gains a new doc-hygiene probe: in tracker-mode projects (Schema L `mode:` resolves to an adapter), grep `specs/plan/*.md` (active only, excluding `archive/`), the current release section of `CHANGELOG.md` (content after the top `## [X.Y.Z]` heading and before the next `## [`), and `README.md` for `fr_[0-9A-HJKMNP-TV-Z]{26}` — each hit → **GATE PASSED WITH NOTES** listing file + line. Warn-only, never **GATE FAILED** (pre-existing content shouldn't block merges). Skipped entirely in `mode: none` (the full ULID never appears there either in practice, but the probe is tracker-mode-scoped because mode: none's short-ULID tail is the human-facing form).
- AC-STE-67.7: Prose assertion test `plugins/dev-process-toolkit/tests/tracker-mode-ulid-hygiene.test.ts` asserts `adapters/linear.md`'s `ticket_description_template` frontmatter value does NOT contain the case-sensitive substring `ULID`. Follows the shape of `linear-adapter-doc-markers.test.ts`.
- AC-STE-67.8: `CHANGELOG.md` v1.22.0 entry notes the cosmetic change under `### Changed`: Linear ticket descriptions no longer carry the `**ULID:**` header; plan-file FR-list tables dropped the ULID column. No downstream remediation required — purely additive cleanup.

## Technical Design

Pure prose / convention / one adapter frontmatter edit + one `importFromTracker` body edit + one `/gate-check` probe. No Provider interface change, no schema change, no migration path.

**Edit targets:**

1. `plugins/dev-process-toolkit/adapters/linear.md` frontmatter — rewrite `ticket_description_template` to drop ULID header.
2. `plugins/dev-process-toolkit/adapters/_shared/src/import.ts` `renderFRFile` — align the rendered body with the new template.
3. `plugins/dev-process-toolkit/docs/patterns.md` Pattern 6 — add the callout.
4. `plugins/dev-process-toolkit/skills/gate-check/SKILL.md` — add the new probe to the v2 conformance probes list.
5. `specs/plan/M19.md` — drop ULID column in the FR-list table as a one-shot retroactive cleanup (active milestone only).
6. `plugins/dev-process-toolkit/templates/spec-templates/plan.md.template` (if it has a ULID column placeholder) — drop it.
7. Linear API: 5× `mcp__linear__save_issue` to rewrite STE-63/64/65/66/67 descriptions. (STE-67 cleans itself up as part of its own implementation.)

**Dogfooding circularity.** STE-67's own initial ticket description and FR file will carry `**ULID:** ...` until the AC work strips them — dogfooding the convention against pre-existing content.

## Testing

- Unit test `tests/tracker-mode-ulid-hygiene.test.ts` asserting the Linear adapter template no longer mentions `ULID` (AC-7).
- Existing prose-assertion tests continue to pass unchanged.
- The new `/gate-check` probe is covered by a positive + negative fixture test in `tests/gate-check-ulid-hygiene.test.ts` (or folded into an existing gate-check test file — implementation choice).
- Manual retroactive cleanup of the 5 Linear descriptions + M19.md plan table happens as part of the implementation commit, verified by re-fetching each ticket and grepping its description.

## Notes

**Scope:** cosmetic. Zero functional behavior change. Frontmatter / code / resolver all keep using ULIDs unchanged.

**Relationship to STE-60 / STE-61 / STE-66.** STE-60 + STE-61 moved the filename from `fr_<ULID>.md` to `<tracker-id>.md`. STE-66 forbids *guessed* tracker IDs at draft time. STE-67 is the final step: even after the ID is known and the file is correctly named, don't duplicate the ULID into user-facing prose.

**Archive exempt.** Pre-M19 archived plan files and shipped CHANGELOG entries retain their existing ULID references — rewriting history isn't worth it, and the gate-check probe scopes to active content only.

**`mode: none` unchanged.** The short-ULID tail (6 chars) remains the human-facing identifier in mode: none — that's symmetric with the AC-prefix rule (M16) and the filename rule (M18). Only the full 26-char form is the noise this FR removes from prose.

**Retroactive self-cleanup.** STE-67's own Linear description and spec file, as initially written, carry `**ULID:** ...`. The implementation PR strips them as part of AC-STE-67.2's one-shot cleanup. The spec file's frontmatter `id:` stays (load-bearing).

**Release target:** v1.22.0 (M19 codename "Branch Convention"). Ships alongside STE-63, STE-64, STE-65, STE-66. Bundles naturally with STE-66's PR since both are prose-convention changes.

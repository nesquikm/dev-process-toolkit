---
title: Forbid guessed tracker IDs in spec drafts — require <tracker-id> placeholder until Linear assigns
milestone: M19
status: archived
archived_at: 2026-04-23T14:49:58Z
tracker:
  linear: STE-66
created_at: 2026-04-23T13:17:39Z
---

## Requirement

When `/spec-write` or `/brainstorm` drafts a new FR in tracker mode, nothing stops the implementer from guessing the next Linear ticket ID (e.g., "STE-65 is next because STE-64 is the last one I've seen"). The guess gets baked into every downstream artifact — AC prefixes, filename, plan-file table row, prose cross-references — before the Linear ticket actually exists. If Linear has already assigned that number to a different ticket or skipped numbers for cancelled ones, the guess is silently wrong and the FR ships misaligned with its own tracker binding. The M19 dogfood caught exactly this failure mode (drafted `AC-STE-65.*` by guessing before the ticket was created).

Fix: both skills explicitly instruct the implementer to use the literal placeholder `<tracker-id>` (rendered as `STE-<N>` when the Linear adapter is active) in every draft until the ticket exists. Order is load-bearing: **create Linear ticket first, read the returned ID, substitute globally, then write the FR file.** Never draft with a guessed number.

## Acceptance Criteria

- AC-STE-66.1: `skills/spec-write/SKILL.md` step 0b gains an explicit "Draft with placeholder" rule stating: *"When drafting a new tracker-bound FR, use `<tracker-id>` (or the adapter-specific rendering — `STE-<N>` for Linear, `PROJ-<N>` for Jira, etc.) as the tracker-ID placeholder throughout the draft (AC prefixes, filename, plan-file row, prose). Do NOT guess the next sequential number. The real ID is only known after `Provider.sync(spec)` / `upsertTicketMetadata(id=null, …)` returns. Substitute the placeholder globally once the ID is assigned, then write the FR file."*
- AC-STE-66.2: `skills/brainstorm/SKILL.md` phase 4 (Hand Off to Spec Write) gains a one-line echo of the same rule: *"Brainstorm drafts that preview AC text must use `<tracker-id>` placeholders — see `/spec-write` § 0b."* — so a brainstorm session that previews AC text doesn't seed guessed IDs into the transition summary.
- AC-STE-66.3: `docs/spec-write-tracker-mode.md` gets a new "Tracker ID Assignment Order" section with a concrete example: draft shows `AC-STE-<N>.1` → Linear assigns `STE-67` on save → substitute globally to `AC-STE-67.1`, file lands at `specs/frs/STE-67.md`.
- AC-STE-66.4: `docs/patterns.md` Pattern 6 (Tracker Mode) gains a short "Tracker ID assignment order — ticket first, FR second" callout that cross-references the two skills.
- AC-STE-66.5: Prose assertion test `plugins/dev-process-toolkit/tests/spec-write-placeholder-convention.test.ts` grep-asserts that `skills/spec-write/SKILL.md` step 0b contains the literal string `<tracker-id>` (or equivalent) and the phrase "never guess" (case-insensitive), and that `skills/brainstorm/SKILL.md` phase 4 contains the cross-reference to `/spec-write`. Same test file, two assertions — following the shape of existing prose-assertion tests (`implement-phase4-close.test.ts`, `linear-adapter-doc-markers.test.ts`).

## Technical Design

Pure prose + one prose-assertion test. No runtime code change. Convention-level enforcement mirrors the `skill-path-portability.test.ts` pattern M17 introduced — a grep-gate protects against regression.

**Edit targets:**

1. `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` step 0b — insert the "Draft with placeholder" rule immediately before the "Mint a ULID via `Provider.mintId()`" sub-step (the ULID is local-mint and always available; the tracker ID isn't).
2. `plugins/dev-process-toolkit/skills/brainstorm/SKILL.md` phase 4 — add the one-line cross-reference in the "Summarize the approved decision" / "Transition" block.
3. `plugins/dev-process-toolkit/docs/spec-write-tracker-mode.md` — new "Tracker ID Assignment Order" H2 section near the top.
4. `plugins/dev-process-toolkit/docs/patterns.md` Pattern 6 — short callout block.

## Testing

One new test file: `plugins/dev-process-toolkit/tests/spec-write-placeholder-convention.test.ts`. Structure follows `implement-phase4-close.test.ts`: reads each SKILL.md file, scopes to the relevant section via `indexOf('## Process')` / `indexOf('### 0b')` / etc., and asserts the required substrings are present. Two top-level `describe` blocks (one per skill), each with 1–2 `test` cases asserting the placeholder/never-guess prose.

No unit-level coverage needed — this is a prose invariant; the grep assertion is sufficient.

## Notes

**Dogfood origin.** M19 `/spec-write` session drafted the releaseLock-precondition FR (STE-65) using `AC-STE-65.*` before the Linear ticket existed. User flagged the premature assumption: "did you assume the next task will be STE-65? What if you were wrong?" Same class of mistake as the existing memory rule "Linear STE-N ≠ FR-N — Look up Linear ID from FR frontmatter; don't assume".

**Self-applied at draft time.** This FR's own initial draft used `AC-STE-<N>.*` placeholders (rendered in the brainstorm / spec-write conversation as literal `STE-<N>` substrings), then substituted to `STE-66` once Linear assigned. Dogfooding the convention before it's even formally codified.

**Relationship to STE-65.** Independent FR — neither blocks the other. Shipped together in M19 because both were triggered by the same session; a single PR (or two) is a packaging decision, not a dependency.

**Not in scope:** automation that creates the Linear ticket from the spec-write skill itself (vs. relying on `Provider.sync`). Current flow creates the file locally and pushes to tracker on save; STE-66 only codifies the *order* of ticket creation vs. draft finalization, not a new code path.

**Release target:** v1.22.0 (current M19 codename "Branch Convention"). Ships alongside STE-63, STE-64, STE-65.

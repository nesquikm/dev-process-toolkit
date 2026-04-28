---
id: fr_01KPR3M74XA75GJKT4Z4HG95VE
title: Post-Archive Drift Detection
milestone: M8
status: archived
archived_at: 2026-04-10T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** After any archival operation (`/spec-archive` manual invocation or `/implement` Phase 4 auto-archival), run a two-pass drift check against the live spec files to flag stale content — scope-limiting narrative or orphan identifier references that contradict the post-archive state. **Pass A (token grep)** scans for literal archived identifiers (`M{N}`, `FR-{N}`, `AC-{N}.`) excluding the Schema H pointer lines the archival just wrote. **Pass B (semantic scan)** has Claude read each live spec with the list of just-archived milestones/FRs and archive-file excerpts as context, flagging narrative sections whose framing assumes the archived scope is the whole project. Output is a unified drift report — advisory only, never auto-rewriting narrative. Motivation: during the v1.10.0 dogfood on a Flutter project, archiving M1-M4 (documentation milestones) left `requirements.md` calling the project a "layered documentation set" in Overview and "documentation only" in Out-of-Scope, directly contradicting the in-flight M5 code milestone. Manual consistency passes across four files are the problem this FR solves.

## Acceptance Criteria

- AC-21.1: `skills/spec-archive/SKILL.md` contains a step titled `## Post-Archive Drift Check` placed after file modifications complete and before the final report
- AC-21.2: `skills/implement/SKILL.md` Phase 4 `### Milestone Archival` subsection contains a step titled `#### Post-Archive Drift Check` placed after the archive move completes and before the final Phase 4 report rendering
- AC-21.3: The drift check consists of two passes: **Pass A (token grep)** and **Pass B (semantic scan)**, documented in that order, with each pass producing findings that merge into a single unified report
- AC-21.4: **Pass A** instructs the agent to grep live spec files (`requirements.md`, `technical-spec.md`, `testing-spec.md`, `plan.md`) for the exact archived identifiers just moved — literal `M{N}`, `FR-{N}`, `AC-{N}.` patterns — excluding the Schema H pointer lines the archival operation wrote (matched by the `^> archived:` prefix)
- AC-21.5: **Pass B** instructs the agent to read each live spec file with a brief containing (a) the list of milestone/FR IDs just archived, (b) a one-paragraph excerpt of each archive file's title and goal, and (c) an instruction to flag narrative sections whose framing assumes the archived scope is the entire project
- AC-21.6: Pass B explicitly names the canary pattern: narrative that labels the project by the archived scope (e.g., "documentation-only", "layered X set") when remaining live milestones contradict that framing. The literal example from the Flutter dogfood run is included as guidance. **Note:** this criterion is inherently subjective — the canary example bounds the judgment but edge cases will vary between runs. Accepted tradeoff per the accuracy-first design decision in the ADR.
- AC-21.7: The drift report is a table with exactly 5 columns: `File`, `Section`, `Severity`, `Reason`, `Suggested action`. Severity values are exactly 2: `high` (Pass A — explicit orphan token reference) and `medium` (Pass B — semantic framing drift)
- AC-21.8: The drift check is **advisory only** — the skill never auto-edits narrative based on Pass B findings. Pass A findings may be offered as mechanical deletions but still require explicit user approval before any edit
- AC-21.9: The drift check contains the literal instruction: `technical-spec.md uses Superseded-by markers, not archival — Pass B flags for this file are advisory only, never push for removal`
- AC-21.10: If the drift report is empty (both passes found nothing), the skill prints the literal string `No drift detected` and continues to the final report without prompting
- AC-21.11: If the drift report is non-empty, the skill offers the user three choices: (a) address inline now — walk through each flag with approval per edit, (b) save the report to `specs/drift-{YYYY-MM-DD}.md` for later review, or (c) acknowledge and continue without edits. The skill never blocks the archival operation itself
- AC-21.12: `docs/patterns.md` contains a new section titled `### Pattern: Post-Archive Drift Check` explaining the two-pass approach, the canary example from the Flutter dogfood, and why Pass B is load-bearing despite its false-positive rate

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M8-residue-scan.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.

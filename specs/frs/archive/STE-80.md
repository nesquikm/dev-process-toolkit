---
id: fr_01KPZ7GRFS7EK16T50A8EXVE9P
title: Template <tracker-id> convention comment (STE-66 reach)
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-80
created_at: 2026-04-24T07:54:09Z
---

## Requirement

STE-66 introduced the `<tracker-id>` placeholder convention for spec drafts — never guess the next sequential tracker number; use `<tracker-id>` until the allocator assigns real IDs. The convention is documented in `/spec-write` SKILL.md, `/brainstorm` SKILL.md, `docs/spec-write-tracker-mode.md`, and `docs/patterns.md:406` — but none of those surfaces reach a user who authors specs by hand using only the templates in `templates/spec-templates/`.

A user in tracker mode who bypasses `/spec-write` (copies templates into a repo, edits by hand) produces `FR-1` / `AC-1.1`-style IDs — the exact mistake STE-66 is designed to prevent.

## Acceptance Criteria

- AC-STE-80.1: `plugins/dev-process-toolkit/templates/spec-templates/requirements.md.template` gains a top-of-file HTML-comment guidance block referencing STE-66 / `<tracker-id>` placeholder convention; comment links to `docs/spec-write-tracker-mode.md` for the full rule.
- AC-STE-80.2: `plugins/dev-process-toolkit/templates/spec-templates/plan.md.template` gains the equivalent top-of-file comment.
- AC-STE-80.3: Both comments are HTML comment blocks (`<!-- ... -->`); rendering output in consumers is unchanged.
- AC-STE-80.4: At least one seeded example in each template shows `<tracker-id>` explicitly (e.g., `### <tracker-id>: <Title> {#<tracker-id>}` in requirements.md.template, `| STE-<tracker-id> | ...` in plan.md.template's FR table example).

## Technical Design

Pure template edit. No helper changes. No schema changes.

## Testing

Prose-assertion test: `tests/template-tracker-id-convention.test.ts` asserts each template contains the literal string `<tracker-id>` at least once.

## Notes

Covers audit M4. Testing-spec cross-reference: new prose-assertion test sits alongside existing template-hygiene tests.

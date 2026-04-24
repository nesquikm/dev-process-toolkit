---
title: Stale version pin sweep in docs/
milestone: M25
status: archived
archived_at: 2026-04-24T21:20:14Z
tracker:
  linear: STE-89
created_at: 2026-04-24T20:40:24Z
---

## Requirement

Two docs pages pin to versions released long ago, framing live content as point-in-time snapshots:

- `plugins/dev-process-toolkit/docs/skill-anatomy.md:179` — "As of v1.22.0, **0 of 12 skills in this plugin use this frontmatter** — the failure modes and prompt-passing ergonomics are not road-tested here." Plugin is v1.26.0; skill count is 14. Both data points stale.
- `plugins/dev-process-toolkit/docs/adaptation-guide.md:111` — "As of v1.12.0 the plugin ships exactly one agent:" v1.12.0 is 14 releases ago; the "exactly one agent" claim is still true but the version framing reads like the doc has rotted.

## Acceptance Criteria

- AC-STE-89.1: `docs/skill-anatomy.md:179` is rewritten to final-state prose with no `As of v<X>` pin and no skill count. Suggested phrasing: "No skills in this plugin use this frontmatter — the failure modes and prompt-passing ergonomics are not road-tested here." {#AC-STE-89.1}
- AC-STE-89.2: `docs/adaptation-guide.md:111` is rewritten to final-state prose with no `As of v<X>` pin. Suggested phrasing: "The plugin ships exactly one agent:" {#AC-STE-89.2}
- AC-STE-89.3: `docs/parallel-execution.md:31` ("As of v1.13.0…") is preserved unchanged — that pin dates a concrete behavior change and is out of scope per audit L1. {#AC-STE-89.3}

## Technical Design

Two prose edits. No code changes, no new tests.

## Testing

No new test required.

## Notes

Scope is intentionally narrow — only audit findings H3 and H4. The broader "drop all version-pinned final-state language" sweep (audit L1, L11, L12) is out of scope for M25.

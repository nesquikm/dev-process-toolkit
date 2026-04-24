---
id: fr_01KPR3M74WN5NYPM4D2PSQ8CQY
title: ULID as Canonical ID
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-18
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Every FR has a repo-minted ULID as its canonical ID. The ID appears in both the filename and the `id:` frontmatter field, is minted locally (never network-bound), and is immutable for the lifetime of the FR — archival preserves the ULID via path-only rename.

## Acceptance Criteria

- AC-STE-18.1: FR filenames match the regex `^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$` (Crockford base32 ULID with `fr_` prefix)
- AC-STE-18.2: Frontmatter `id:` value equals the filename stem byte-for-byte
- AC-STE-18.3: `Provider.mintId()` is a pure local call (no network); returns a monotonic-within-millisecond, random-across-processes ULID per the standard library guarantee
- AC-STE-18.4: No skill renames an FR file after creation. The only path change permitted is archival (`specs/frs/<ulid>.md` → `specs/frs/archive/<ulid>.md`), which preserves the stem
- AC-STE-18.5: `/gate-check` fails with a clear message if any `specs/frs/**/*.md` violates AC-STE-18.1 or AC-STE-18.2

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

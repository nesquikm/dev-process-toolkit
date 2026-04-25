---
title: Delete strip_ulid migration tool (D2)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-94
created_at: 2026-04-25T06:42:08Z
---

## Requirement

`adapters/_shared/src/migrations/` ships the M21 STE-86 one-shot tool that strips `id:` lines from existing tracker-mode FRs. Three files (`strip_ulid.ts`, `strip_ulid.cli.ts`, `strip_ulid.test.ts`) plus a CLI entrypoint nobody will invoke.

The tool already ran on the maintainer's own archive in commit `fb51ca8` (M21). No pre-M21 projects exist outside the plugin's own repo. With no external installs, no future user will ever benefit from this code path.

Audit verified: zero inbound references outside the `migrations/` directory itself.

## Acceptance Criteria

- AC-STE-94.1: `adapters/_shared/src/migrations/` directory does not exist after this FR lands. {#AC-STE-94.1}
- AC-STE-94.2: `grep -rn "strip_ulid\|migrations/strip" plugins/dev-process-toolkit/ adapters/` returns matches only in CHANGELOG / historical files (no live code references). {#AC-STE-94.2}
- AC-STE-94.3: `bun test` remains green. Total test count decreases by the count from `strip_ulid.test.ts` (document the decrease in the commit message). {#AC-STE-94.3}
- AC-STE-94.4: No CHANGELOG entry is rewritten — historical records of strip_ulid's existence remain (the v1.25.0 entry that introduced it stays as written). {#AC-STE-94.4}

## Technical Design

`rm -rf adapters/_shared/src/migrations/`. Run `bun test`. If anything breaks, restore via `git revert` and investigate (audit suggests nothing will break).

Note: this is the ONLY `adapters/_shared/src/migrations/` directory. STE-92's backfill script (M25) lives in `tests/scripts/`, NOT here — explicitly to avoid recreating the directory M26 is deleting.

## Testing

No new tests. The 25 (approx) tests in `strip_ulid.test.ts` are deleted along with the source. Document the test-count delta in the commit message and the eventual v1.28.0 CHANGELOG entry.

## Notes

First M-milestone where total test count goes DOWN (joint with STE-95). This is a feature, not a regression — less surface area to maintain. CHANGELOG should explicitly frame the drop as intentional.

Origin: PR #4 audit D2.

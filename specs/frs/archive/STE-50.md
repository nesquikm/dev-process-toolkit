---
id: fr_01KPTSA7W7NX6R98CBXTVDTAF4
title: Collision-proof AC prefixes (tracker ID / short-ULID)
milestone: M16
status: archived
archived_at: 2026-04-22T19:55:21.000Z
tracker:
  linear: STE-50
created_at: 2026-04-22T14:31:40.000Z
---

## Requirement

When a new FR is created in v2 layout, its Acceptance Criteria prefixes must be derived from a collision-proof source instead of the human-chosen FR-N sequence. In tracker mode, AC prefixes use the bound tracker ID (e.g., `AC-STE-47.1`). In `mode: none`, AC prefixes use a 6-char slice from the random portion of the FR's ULID (e.g., `AC-XR98CB.1`) — not the timestamp portion, which rolls too slowly to be collision-proof for rapid sequential creation. A defensive spec-lint catches the rarer within-FR `.N` collision at check time.

## Acceptance Criteria

- AC-STE-50.1: In tracker mode, `/spec-write`'s v2 FR-creation path and `importFromTracker` (STE-31) emit AC prefixes of the form `AC-<TRACKER_ID>.<N>`, where `<TRACKER_ID>` is the canonical ID in the FR frontmatter's `tracker:` block.
- AC-STE-50.2: In `mode: none`, `/spec-write`'s v2 FR-creation path emits AC prefixes of the form `AC-<ULID_SHORT>.<N>`, where `<ULID_SHORT>` is `spec.id.slice(23, 29)` on the `fr_`-prefixed 29-char identifier — i.e., the **last 6 chars** of the 16-char random portion of the ULID. The first-6-chars-of-raw-ULID shape must not be used (timestamp-based; 6th char rolls only every ~33 seconds), and the first-6-chars-of-random-portion shape must not be used either (`adapters/_shared/src/ulid.ts` implements monotonic ULIDs: within the same millisecond the randomness is incremented at the least-significant end, so the leading random chars are shared across burst mints). The tail 6 chars are collision-proof both across bursts (fresh randomness) and within bursts (monotonic counter varies).
- AC-STE-50.3: In `mode: none`, before writing a new FR file, `specs/frs/*.md` (excluding `archive/`) is scanned for any existing AC prefix sharing the same 6-char slice. A collision aborts the write with an NFR-10-shape error and no partial file is left on disk. (With 30 bits of randomness per slice, realistic collision probability is ~1 in 10^6 at 50 FRs and stays negligible below ~10K FRs.)
- AC-STE-50.4: STE-50 applies only to FRs created after its activation. Existing FRs keep their `AC-<N>.M` prefixes until STE-51's migration runs. No backfill in STE-50.
- AC-STE-50.5: A spec-lint check (invokable standalone and wired into `/gate-check`) scans every `specs/frs/*.md` (excluding `archive/`) for duplicate `AC-<prefix>.<N>` lines within any single FR's `## Acceptance Criteria` section and exits non-zero with an NFR-10-shape message when it finds any.

## Technical Design

New helper `acPrefix(spec: FRSpec): string` in `adapters/_shared/src/ac_prefix.ts` centralizes derivation: if the spec's `tracker:` block has any non-null value, return that value (tracker mode); otherwise return `spec.id.slice(23, 29)` — the last 6 chars of the random portion (chars 0..2 are `fr_`, 3..12 are the 10-char timestamp, 13..28 are 16 chars of randomness; 23..28 is the monotonic tail that varies per-mint even within the same millisecond). The helper takes only `spec` (not `mode`) because the spec itself determines mode — an empty `tracker: {}` block is indistinguishable from `mode: none` at prefix-derivation time, and that's the correct semantic (a tracker-mode FR whose tracker isn't yet bound falls back to short-ULID until sync populates the binding). `/spec-write`'s § 0b FR-creation path calls the helper once and interpolates `<N>` per-AC during write. The `mode: none` collision scan (AC-STE-50.3) reads each file in `specs/frs/` (excluding `archive/`), computes its prefix via `acPrefix()`, and throws `ShortUlidCollisionError` (new, routed through NFR-10) if the new FR's prefix matches any existing one. The AC-N duplicate lint (AC-STE-50.5) lives in `adapters/_shared/src/ac_lint.ts` and is callable from the `/gate-check` skill alongside other gate checks. No lockfile; no manifest state. Short-ULID length is a fixed constant (6) — not configurable — to keep AC-prefix shape stable across projects.

## Testing

Unit tests for `acPrefix` cover both modes. A regression test covers the specific bug of slicing the timestamp portion: mint two ULIDs within the same millisecond (use `DPT_TEST_ULID_SEED` or inject directly), assert their `acPrefix` outputs differ — this would fail under the broken "first 6 chars of raw ULID" implementation. `mode: none` collision detection is tested by injecting two ULIDs crafted to share `slice(13, 19)` (bypassing `mintId`) and asserting the second write aborts with the canonical error. Integration test for `/spec-write`'s v2 FR-creation path in both modes asserts the emitted AC prefixes match the expected shape. Unit tests for `ac_lint` cover a clean FR file, an FR with a duplicate AC-N line, and an FR with a duplicate split across list-position noise (e.g., reordered bullets). Existing STE-17 diff/resolve tests must continue to pass byte-identically for ACs under the grandfathered scheme.

## Notes

The tail of the random portion (`slice(23, 29)`) is used — not the head — because `adapters/_shared/src/ulid.ts` implements monotonic ULIDs: within the same millisecond, randomness is incremented at the least-significant byte rather than re-rolled. So same-ms burst mints share the leading random chars (e.g., this repo's `fr_01KPTSA7W8N116XWSXXE0G1PY3` and `fr_01KPTSA7W8N116XWSXXE0G1PY4` both have `slice(13, 19) == "N116XW"`) but differ in the tail (`0G1PY3` vs `0G1PY4`). The timestamp head is off-limits for the same reason as before: the 6th char rolls only every ~33 seconds, so timestamp slices collide across real-time batches. The random portion is 16 chars of 5-bit Crockford Base32 = 80 bits of entropy; a 6-char tail slice is 30 bits ≈ 1B combinations, birthday-collision-safe well beyond 10K FRs per repo across separate mints. Length is a constant, not configurable, to keep the AC-prefix shape stable across projects. The AC-73.* prefixes themselves will be rewritten to `AC-STE-50.*` by STE-51's migration — transitional by design.

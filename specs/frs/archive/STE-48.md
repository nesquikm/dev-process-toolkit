---
id: fr_01KPTGHS9X7KY0DV9QSGFN2JW2
title: Resolver Accepts FR-N Codes via AC-Prefix Scan
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-48
created_at: 2026-04-22T11:54:19.000Z
---

## Requirement

`adapters/_shared/src/resolve.ts` routes ULIDs, tracker IDs (`LIN-1234`), and URLs. It does NOT recognize `FR-N` (DPT-internal FR codes like `FR-57`), so those arguments land in the `fallthrough` branch — forcing skills (and the humans driving them) to grep for backing ULIDs manually. Dogfooded 2026-04-22 during `/implement FR-57 FR-58`: had to scan `specs/frs/*.md` for `AC-57.` / `AC-58.` to locate the ULID-named files. The DPT spec convention is stable: every FR's `## Acceptance Criteria` block carries `AC-<N>.M` lines where N matches the FR number, making the lookup deterministic.

## Acceptance Criteria

- AC-69.1: `resolveFRArgument(arg, config)` recognizes `^FR-\d+$` as a new `kind: "fr-code"` route — alongside existing `ulid`, `tracker-id`, `url`, and `fallthrough` kinds — and returns `{ kind: "fr-code", frNumber: <N> }` on match.
- AC-69.2: A new helper `findFRByFRCode(specsDir, frNumber)` in `adapters/_shared/src/resolve.ts` scans `specs/frs/*.md` (excluding `archive/`) and returns the ULID of the FR whose `## Acceptance Criteria` section contains any line starting with `AC-<N>.` for the queried N. On miss, returns `null`; `/spec-write` / `/implement` treat miss as NFR-10 canonical refusal with `Remedy: run /spec-write FR-<N> to scaffold it, or pass the ULID directly if it exists under archive/`.
- AC-69.3: Multiple FR files containing `AC-<N>.` lines for the same N surface as `AmbiguousArgumentError` per NFR-20 — never silently pick a winner. Error message enumerates all matching ULIDs.
- AC-69.4: A regression fixture under `tests/fixtures/resolver/fr-code-lookup/` with ≥2 FRs (one non-ambiguous FR-N, one ambiguous scenario) proves both the happy path (single match → ULID) and the ambiguity error path.
- AC-69.5: `docs/resolver-entry.md` decision table gains a row for `FR-N` routing: the AC-prefix scan rule, the ambiguity policy, and the miss-error remedy are documented in one place.
- AC-69.6: Backward compat (NFR-18): all existing argument forms (ULID, tracker-ID, URL, `all`, `requirements`, milestone codes like `M13`, keyword fallthrough) continue to route byte-identically — the new `fr-code` kind is strictly additive. A Pattern 9 byte-diff run against existing regression fixtures passes unchanged.

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/implement FR-57 FR-58` post-mortem. Finding #3 of 3 (2026-04-22 post-FR-57/58 dogfooding). The DPT codebase has ≥60 FRs; FR-N arguments are the natural form humans type (and it's how you asked: `/implement FR-57 FR-58`). The resolver should speak that language.

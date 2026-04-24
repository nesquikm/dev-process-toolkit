---
title: Remove FR-N as primary alias
milestone: M16
status: archived
archived_at: 2026-04-22T19:55:21.000Z
tracker:
  linear: STE-52
created_at: 2026-04-22T14:32:39.000Z
---

## Requirement

After STE-51's migration has completed, the FR-N resolver path and all FR-N-specific code paths are removed. The codebase converges on a single identifier scheme: ULID for file identity, tracker ID or short-ULID as the human-facing prefix in spec headings, anchors, and AC lines. STE-52 is a purely subtractive FR — no new functionality, only deletion and cleanup.

## Acceptance Criteria

- AC-STE-52.1: `findFRByFRCode`, `FR_CODE_RE`, the `FRCode` type, and the `kind: "fr-code"` branch are removed from `adapters/_shared/src/resolve.ts`. The `ResolveKind` union narrows to `ulid | tracker-id | url | fallthrough`.
- AC-STE-52.2: `/spec-write`'s step 0a resolver-entry copy is updated to remove the FR-code route. Passing a literal `FR-<N>` argument now produces `kind: "fallthrough"`.
- AC-STE-52.3: Unit tests under the STE-48 resolver test suite exercising the FR-code path are removed. A replacement unit test asserts `resolveFRArgument("STE-50", config)` returns `{ kind: "fallthrough" }`.
- AC-STE-52.4: Documentation referencing FR-N as a valid `/spec-write` argument or resolver input — `docs/ticket-binding.md`, `docs/resolver-entry.md`, any skill copy mentioning the FR-code route — is updated to reflect the removal. The STE-48 entry in `CHANGELOG.md` is left intact as historical record.
- AC-STE-52.5: A ripgrep gate verifies cleanliness: `rg -n 'fr-code|FRCode|findFRByFRCode|FR_CODE_RE' plugins/` returns zero matches after STE-52 lands. Run manually as part of the PR's gate check.

## Technical Design

Purely subtractive change. Mechanical deletion of the code paths named in AC-STE-52.1–STE-52.2. `/spec-write`'s step 0a in `SKILL.md` is edited to renumber around the removed FR-code route. No new code; no behavior added. Ordering dependency: STE-52 runs only after STE-51 completes, otherwise legacy FR-N references (headings, anchors, cross-refs, AC prefixes) orphan themselves because the resolver can no longer map them.

## Testing

`resolve.test.ts` updates: remove FR-code fixtures, add one case asserting fallthrough for `FR-<N>` arguments. Any integration tests for `/spec-write` that passed an `FR-<N>` argument are updated to use ULID or tracker-ID arguments. The AC-prefix scan test introduced by STE-48 is deleted. Full gate-check suite must pass green after the deletions — this is the primary correctness signal that nothing depended on the removed code beyond what the tests already covered.

## Notes

Terminal FR of M16. Post-STE-52, "FR-N" survives only in immutable history: `CHANGELOG.md` entries for HG95V1 through STE-52 themselves, and git commit messages. Future milestones' FRs are identified by their tracker ID (Linear) or short-ULID alone.

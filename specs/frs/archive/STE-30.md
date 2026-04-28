---
title: Tracker-ID Argument Resolver (Shared Utility)
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-30
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

A shared utility detects whether a skill's argument is a ULID, a tracker ID, or a full tracker URL, and — in conjunction with a companion frontmatter scanner — routes three skills (`/spec-write`, `/implement`, `/spec-archive`) through a single code path for argument resolution. Consolidates what would otherwise be three near-identical detection blocks into one tested, canonical implementation.

## Acceptance Criteria

- AC-STE-30.1: `adapters/_shared/src/resolve.ts` exports `resolveFRArgument(arg, config): {kind: 'ulid' | 'tracker-id' | 'url' | 'fallthrough', ulid?: string, trackerKey?: string, trackerId?: string}`
- AC-STE-30.2: ULID detection via regex `^fr_[0-9A-HJKMNP-TV-Z]{26}$` → `{kind: 'ulid', ulid: arg}`
- AC-STE-30.3: Tracker-ID detection uses per-tracker patterns registered via adapter metadata. Built-in: Linear/Jira `^[A-Z]+-\d+$` (prefix must match a configured tracker's project prefix), GitHub `^#?\d+$`. Returns `{kind: 'tracker-id', trackerKey, trackerId}` on unambiguous match
- AC-STE-30.4: URL detection matches `^https?://` AND host ∈ allowlist: `linear.app` (Linear), `github.com` (GitHub), Jira host string from `## Task Tracking` section (Jira). Path-extraction per tracker: Linear `/[^/]+/issue/([A-Z]+-\d+)/`, GitHub `/[^/]+/[^/]+/issues/(\d+)`, Jira `/browse/([A-Z]+-\d+)`. Returns `{kind: 'url', trackerKey, trackerId}`
- AC-STE-30.5: Explicit prefix form `<tracker>:<id>` (e.g., `linear:LIN-1234`, `github:42`) always wins over inference. Tracker name is case-insensitive; the explicit prefix is documented as the disambiguation escape hatch
- AC-STE-30.6: Ambiguous match (same `^[A-Z]+-\d+$` string matches prefixes of multiple configured trackers) → error per NFR-10 canonical shape naming each candidate (`linear:FOO-42`, `jira:FOO-42`) and the explicit-prefix remedy. Never silently picks a winner
- AC-STE-30.7: Unrecognized argument (fails all three detection branches and is not a known skill keyword like `all` / `requirements` / `technical-spec` / `testing-spec` / `plan` / `M\d+`) → returns `{kind: 'fallthrough'}`; each consuming skill handles this per its existing contract
- AC-STE-30.8: Companion utility `findFRByTrackerRef(specsDir, trackerKey, trackerId, {includeArchive?: boolean}): string | null` scans `specs/frs/**/*.md` frontmatter for a matching `tracker.<key>: <id>` and returns the ULID or null. Archive excluded by default; opt-in for lookup-only callers
- AC-STE-30.9: 100% branch-covered by unit tests at `adapters/_shared/src/resolve.test.ts` — each detection branch, each combination of configured trackers, each ambiguity path, each URL host, the fallthrough case

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

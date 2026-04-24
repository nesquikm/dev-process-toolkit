---
id: fr_01KPR3M74XA75GJKT4Z4HG95T4
title: Provider Interface for ID Lifecycle
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-20
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

A single typed `Provider` interface abstracts ID lifecycle and tracker integration behind one shape. Two implementations ship at v2: `LocalProvider` (no tracker) and `TrackerProvider` (wraps the M12 adapter surface). Skills consume `Provider` via dependency injection and never branch on mode.

## Acceptance Criteria

- AC-STE-20.1: `Provider` exposes at least: `mintId(): string`, `getMetadata(id): FRMetadata`, `sync(spec): SyncResult`, `getUrl(id, trackerKey?): string | null`, `claimLock(id, branch): LockResult`, `releaseLock(id): void`
- AC-STE-20.2: `LocalProvider` and `TrackerProvider` both implement the full interface. `LocalProvider.sync()` is a no-op returning success; `LocalProvider.getUrl()` returns null
- AC-STE-20.3: Provider selection happens once per skill invocation at entry, based on `/setup` config read from `CLAUDE.md` `## Task Tracking` section (Schema L). No skill re-resolves mid-execution
- AC-STE-20.4: All spec-touching skills depend on `Provider` via injection — no skill imports a concrete implementation directly
- AC-STE-20.5: `mintId()` is always local (no network, works offline) regardless of provider; this is the invariant that makes tracker-less and offline authoring work uniformly
- AC-STE-20.6: `Provider` interface definition lives in `adapters/_shared/src/provider.ts`; implementations in `adapters/_shared/src/local_provider.ts` and `adapters/_shared/src/tracker_provider.ts`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.

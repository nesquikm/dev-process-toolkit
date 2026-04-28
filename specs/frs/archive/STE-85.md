---
title: Capability-split Provider interface — IdentityMinter sub-interface
milestone: M21
status: archived
archived_at: 2026-04-24T17:55:00Z
tracker:
  linear: STE-85
created_at: 2026-04-24T13:15:00Z
---

## Requirement

Post-STE-76, no tracker-mode code path in `adapters/_shared/src/` calls `Provider.mintId()`. But `mintId()` remains on the base `Provider` interface, and `TrackerProvider.mintId()` is live code returning a ULID that nothing reads. The invariant "tracker-mode code never mints a ULID" is tribal knowledge, enforced by convention.

STE-85 makes the invariant type-enforced. `mintId()` moves from `Provider` to a new sub-interface `IdentityMinter`. `LocalProvider` implements `Provider, IdentityMinter`; `TrackerProvider` implements `Provider` alone. Any tracker-mode call site accidentally referring to `mintId()` becomes a TypeScript error (`TS2339: Property 'mintId' does not exist on type 'Provider'`).

This is a pure-refactor typecheck-pass. The diff is confined to `adapters/_shared/src/`: one interface split, two implementation class-declarations updated, `tracker_provider.ts`'s `mintId()` method + `ulid` import deleted, and one call-graph audit.

## Acceptance Criteria

- AC-STE-85.1: `adapters/_shared/src/provider.ts` declares two exported interfaces: `Provider` (without `mintId()`) and `IdentityMinter` (with `mintId(): string`). Both type-only — the file's existing "types only, no runtime code" contract is preserved.
- AC-STE-85.2: `adapters/_shared/src/local_provider.ts` declares `class LocalProvider implements Provider, IdentityMinter`. The `mintId()` method body stays as-is; the `import { mintId as mintIdImpl } from "./ulid";` import stays.
- AC-STE-85.3: `adapters/_shared/src/tracker_provider.ts` declares `class TrackerProvider implements Provider` (no `IdentityMinter`). The `mintId()` method and the `import { mintId as mintIdImpl } from "./ulid";` line are both deleted. The prior TODO comment from STE-76 AC-STE-76.5 is resolved and removed in the same commit.
- AC-STE-85.4: `bun run typecheck` (`tsc --noEmit`) passes post-refactor. No production path in `adapters/_shared/src/**` (excluding `*.test.ts`) references `IdentityMinter` except via a value statically typed as `LocalProvider` or `Provider & IdentityMinter`. Verified by re-running `grep -rn "mintId\|IdentityMinter" adapters/_shared/src/ | grep -v ".test.ts"` and inspecting each match.
- AC-STE-85.5: `adapters/_shared/src/import.ts` — post-STE-76 carries no `provider.mintId()` call on the tracker path; this FR adds no code change there. Re-running the audit confirms the STE-76 edit held.
- AC-STE-85.6: Existing tests in `adapters/_shared/src/*.test.ts` pass unchanged. Pre-refactor confirmed no test asserts behavior of `TrackerProvider.mintId()`; if any is discovered during implementation, it is deleted or retargeted at `LocalProvider` in the same commit.
- AC-STE-85.7: No downstream consumer outside `adapters/_shared/` changes. Skills and probe code already consume the base `Provider` interface; none asked for `mintId()`.

## Technical Design

### Interface split

```typescript
// provider.ts (after STE-85)
export interface Provider {
  getMetadata(id: string): Promise<FRMetadata>;
  sync(spec: FRSpec): Promise<SyncResult>;
  getUrl(id: string, trackerKey?: string): string | null;
  claimLock(id: string, branch: string): Promise<LockResult>;
  releaseLock(id: string): Promise<"transitioned" | "already-released">;
  getTicketStatus(ticketId: string): Promise<{ status: string }>;
  filenameFor(spec: FRSpec): string;
}

export interface IdentityMinter {
  mintId(): string;
}
```

### Class conformance

- `LocalProvider` → `implements Provider, IdentityMinter`. No method-body changes.
- `TrackerProvider` → `implements Provider`. Delete `mintId()` body + `ulid` import + the M22-era `// mintId(): always local (AC-43.5)` comment that becomes stale.

### Call-site audit

Post-STE-76, the only non-test call to `provider.mintId()` was in `adapters/_shared/src/import.ts:33`, which STE-76 removed. STE-85 re-runs `grep -rn "mintId\|IdentityMinter" adapters/_shared/src/` and asserts:

1. Zero production-path matches on any value typed as `Provider` (not `Provider & IdentityMinter` or `LocalProvider`).
2. Test-path matches only in `local_provider.test.ts` (expected — tests `mintId()` directly).
3. Type-alias matches in `provider.ts` only (the interface declarations themselves).

### Why a sub-interface, not an optional method

An optional `mintId?(): string` on `Provider` pushes noise to every call site (`provider.mintId?.()` + `undefined` handling) and doesn't express the real shape: the capability is present, or it isn't. A sub-interface puts the distinction on the type system — the runtime shape is clean.

### Why not folder-move or sub-package

Considered under scope-3 Option 1 (folder + ESLint) and Option 3 (sub-package) during M21 brainstorm. Rejected — lint rules rot silently (`eslint-disable` can undo the invariant), and sub-package is overbuilt for this repo size. The type system's capability-interface pattern achieves the same guarantee without runtime cost or build-target complexity.

### Enforcement

Any future code that writes `const p: Provider = new TrackerProvider(...); p.mintId();` is a `TS2339` error. That's the structural invariant.

## Testing

- **Type-check gate**: `bun run typecheck` passes post-refactor. Failure surfaces any missed call site. This is the primary enforcement mechanism — no new unit test can prove what `tsc` already proves.
- **Existing tests**:
  - `local_provider.test.ts` tests `mintId()` as before. Unchanged.
  - `tracker_provider.test.ts` must not test `mintId()`. Current source does not (verified pre-refactor); if a test is added between STE-85 draft and implementation, it is deleted in the same commit.
- **Grep regression**: implementation commit includes the output of `grep -rn "mintId\|IdentityMinter" adapters/_shared/src/` in the commit message body for reviewer verification.

## Notes

**Ordering within M21**: ships last of the three M21 FRs. STE-86 ships first (migration tool + probe); STE-76 ships second (consumes tool + applies spec-text + strips active-FR `id:` frontmatter + removes `mintId()` call sites); STE-85 ships third (structural refactor of the now-unreachable `mintId()` on `TrackerProvider`).

**Why not merge with STE-76.** Considered during brainstorm — rejected. STE-76 is a spec + data migration FR; STE-85 is a pure-refactor typecheck-pass. Mixing bloats the review surface and obscures the atomic revert target if one landed with a regression and the other didn't.

**Release target:** v1.24.0 alongside STE-76 + STE-86.

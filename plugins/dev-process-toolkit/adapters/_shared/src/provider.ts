// Provider interface (FR-43, AC-43.1/6).
//
// This file MUST contain only types — no runtime code. All implementations
// live in local_provider.ts / tracker_provider.ts and consume this contract
// by import. Kept type-only so that skills can depend on the contract
// without pulling an implementation.
//
// Signatures match technical-spec.md §8.4 byte-for-byte.

export type FRStatus = "active" | "in_progress" | "archived";

export interface FRMetadata {
  id: string;
  title: string;
  milestone: string;
  status: FRStatus;
  tracker: Record<string, string | null>;
  inFlightBranch: string | null;
  assignee: string | null;
}

export interface SyncResult {
  kind: "ok" | "skipped" | "conflict" | "error";
  updated: string[];
  conflicts: string[];
  message: string;
}

export interface LockResult {
  kind: "claimed" | "already-ours" | "taken-elsewhere";
  branch: string | null;
  message: string;
}

export interface FRSpec {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Capability sub-interface for ULID minting. Scoped to `mode: none` only
 * — tracker mode identity is the tracker ID, so `TrackerProvider` does NOT
 * implement `IdentityMinter` (STE-85 AC-STE-85.1). Any attempt to call
 * `mintId()` on a value statically typed as the base `Provider` is a
 * `TS2339` error: the structural invariant "tracker-mode code never mints
 * a ULID" is now type-enforced rather than by convention.
 */
export interface IdentityMinter {
  mintId(): string;
}

export interface Provider {
  getMetadata(id: string): Promise<FRMetadata>;
  sync(spec: FRSpec): Promise<SyncResult>;
  getUrl(id: string, trackerKey?: string): string | null;
  claimLock(id: string, branch: string): Promise<LockResult>;
  /**
   * Release the in-flight lock for the given FR.
   *
   * Returns `"transitioned"` when the release performed work:
   *   - `TrackerProvider`: ticket moved from In Progress → Done.
   *   - `LocalProvider`: `.dpt-locks/<id>` existed and was removed + committed.
   *
   * Returns `"already-released"` on the idempotent branch (STE-84 AC-STE-84.2):
   *   - `TrackerProvider`: ticket was already at the adapter's canonical Done
   *     status — no `transitionStatus` call is made. Also returned when the
   *     FR has no binding for the driver's tracker.
   *   - `LocalProvider`: no lock file was present — silently no-ops without
   *     touching git.
   *
   * Throws `TrackerReleaseLockPreconditionError` (STE-65, narrowed by STE-84
   * AC-STE-84.5) when the tracker ticket is in any state other than
   * In Progress or canonical Done — the `Backlog → Done` silent-leap
   * guardrail is preserved; only the terminal-Done short-circuit is new.
   */
  releaseLock(id: string): Promise<"transitioned" | "already-released">;
  /**
   * Read-side status probe used by `/implement` Phase 4 post-release
   * verification (AC-STE-54.2) and `/gate-check` ticket-state drift
   * detection (AC-STE-54.3). `LocalProvider` returns the
   * `"local-no-tracker"` sentinel; `TrackerProvider` delegates to the
   * driver and returns the driver's canonical status string verbatim.
   */
  getTicketStatus(ticketId: string): Promise<{ status: string }>;
  /**
   * Return the base filename (no directory) a newly-created or
   * about-to-archive FR file should live under (M18 STE-60 AC-STE-60.1).
   *
   *   - `LocalProvider`: `<short-ULID>.md` — `spec.id.slice(23, 29)`.
   *   - `TrackerProvider`: `<tracker-id>.md` via `spec.tracker[driver.trackerKey]`,
   *     falling back to the short-ULID form when the binding is absent for
   *     the driver's tracker.
   */
  filenameFor(spec: FRSpec): string;
}

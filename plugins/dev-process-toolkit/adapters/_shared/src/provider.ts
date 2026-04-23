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

export interface Provider {
  mintId(): string;
  getMetadata(id: string): Promise<FRMetadata>;
  sync(spec: FRSpec): Promise<SyncResult>;
  getUrl(id: string, trackerKey?: string): string | null;
  claimLock(id: string, branch: string): Promise<LockResult>;
  releaseLock(id: string): Promise<void>;
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

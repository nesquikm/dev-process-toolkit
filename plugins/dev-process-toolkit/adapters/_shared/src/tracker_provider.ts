// TrackerProvider — Provider implementation that composes over the M12
// adapter surface (FR-43, FR-46).
//
// Design: TrackerProvider depends on an AdapterDriver interface, which maps
// the 4-op M12 adapter contract (pull_acs, push_ac_toggle, transition_status,
// upsert_ticket_metadata) plus read-side helpers (getTicketStatus, getUrl).
// Real drivers make MCP calls; tests inject stubs.
//
//   - mintId(): always local (AC-43.5) — never consults the driver.
//   - sync(): calls upsertTicketMetadata only for the driver's trackerKey;
//       other keys are foreign-tracker refs and are handled by their own
//       providers (cross-tracker reconciliation is out of scope per §8.11).
//   - claimLock(id, branch): reads status via getTicketStatus; if
//       in_progress + other assignee → taken-elsewhere; if in_progress +
//       current user → already-ours; else transitionStatus('in_progress')
//       and upsertTicketMetadata({assignee}) (AC-46.3).
//   - releaseLock(id): transitionStatus('done') — Phase 4 completion path.
//       An explicit-release variant (status='unstarted') is deferred to
//       Phase F if it's needed by /implement --release-lock.

import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "./provider";
import { mintId as mintIdImpl } from "./ulid";

export type TicketStatus = "unstarted" | "backlog" | "in_progress" | "done" | "cancelled" | "completed";

export interface TicketStatusSummary {
  status: TicketStatus;
  assignee: string | null;
}

export interface UpsertMetadataInput {
  title?: string;
  description?: string;
  assignee?: string;
  backLink?: string;
}

export interface AdapterDriver {
  trackerKey: string;
  pullAcs(ticketId: string): Promise<unknown[]>;
  pushAcToggle(ticketId: string, acId: string, state: boolean): Promise<void>;
  transitionStatus(ticketId: string, status: TicketStatus): Promise<void>;
  upsertTicketMetadata(ticketId: string | null, meta: UpsertMetadataInput): Promise<string>;
  getTicketStatus(ticketId: string): Promise<TicketStatusSummary>;
  getUrl(ticketId: string): string;
}

export interface TrackerProviderOptions {
  driver: AdapterDriver;
  currentUser: string;
  /**
   * Resolves an FR ULID to the tracker-specific ticket ref for the driver's
   * tracker. Default implementation treats ids matching /^[A-Z]+-\d+$/ as
   * already-resolved tracker refs (test convenience) and returns null
   * otherwise. Production wires a filesystem-backed resolver that reads
   * frontmatter.tracker[driver.trackerKey] from the FR file.
   */
  resolveTrackerRef?: (idOrRef: string) => Promise<string | null>;
}

function isInProgress(s: TicketStatus): boolean {
  return s === "in_progress";
}

function isClaimable(s: TicketStatus): boolean {
  return s === "unstarted" || s === "backlog" || s === "cancelled" || s === "done" || s === "completed";
}

export class TrackerProvider implements Provider {
  private readonly driver: AdapterDriver;
  private readonly currentUser: string;
  private readonly resolveTrackerRefImpl: (idOrRef: string) => Promise<string | null>;

  constructor(options: TrackerProviderOptions) {
    this.driver = options.driver;
    this.currentUser = options.currentUser;
    this.resolveTrackerRefImpl =
      options.resolveTrackerRef ??
      (async (idOrRef: string) => (/^[A-Z]+-\d+$/.test(idOrRef) ? idOrRef : null));
  }

  mintId(): string {
    return mintIdImpl();
  }

  async getMetadata(id: string): Promise<FRMetadata> {
    const trackerRef = await this.resolveTrackerRef(id);
    if (!trackerRef) {
      return {
        id,
        title: "",
        milestone: "",
        status: "active",
        tracker: {},
        inFlightBranch: null,
        assignee: null,
      };
    }
    const summary = await this.driver.getTicketStatus(trackerRef);
    return {
      id,
      title: "",
      milestone: "",
      status: summary.status === "in_progress" ? "in_progress" : "active",
      tracker: { [this.driver.trackerKey]: trackerRef },
      inFlightBranch: null,
      assignee: summary.assignee,
    };
  }

  async sync(spec: FRSpec): Promise<SyncResult> {
    const tracker = (spec.frontmatter["tracker"] ?? {}) as Record<string, string | null>;
    const ticketId = tracker[this.driver.trackerKey];
    if (!ticketId) {
      return {
        kind: "skipped",
        updated: [],
        conflicts: [],
        message: `No ${this.driver.trackerKey} ref on FR ${spec.frontmatter["id"] ?? "<unknown>"}`,
      };
    }
    await this.driver.upsertTicketMetadata(ticketId, {
      title: String(spec.frontmatter["title"] ?? ""),
      description: spec.body,
    });
    return {
      kind: "ok",
      updated: [this.driver.trackerKey],
      conflicts: [],
      message: `Synced ${this.driver.trackerKey}:${ticketId}`,
    };
  }

  getUrl(id: string, trackerKey?: string): string | null {
    const key = trackerKey ?? this.driver.trackerKey;
    if (key !== this.driver.trackerKey) return null;
    // Best-effort: if id looks like a tracker ref (e.g., LIN-1234), delegate;
    // otherwise return null. Skills that have a resolved tracker ref should
    // pass it directly.
    if (/^[A-Z]+-\d+$/.test(id)) return this.driver.getUrl(id);
    return null;
  }

  async claimLock(id: string, branch: string): Promise<LockResult> {
    const trackerRef = await this.resolveTrackerRef(id);
    if (!trackerRef) {
      return {
        kind: "taken-elsewhere",
        branch: null,
        message: `FR ${id} has no ${this.driver.trackerKey} ref; cannot claim in tracker mode`,
      };
    }
    const summary = await this.driver.getTicketStatus(trackerRef);
    if (isInProgress(summary.status)) {
      if (summary.assignee === this.currentUser) {
        return { kind: "already-ours", branch, message: `Lock already held by ${this.currentUser}` };
      }
      return {
        kind: "taken-elsewhere",
        branch: null,
        message: `Ticket ${trackerRef} is in_progress with assignee ${summary.assignee ?? "<unassigned>"}`,
      };
    }
    if (!isClaimable(summary.status)) {
      return {
        kind: "taken-elsewhere",
        branch: null,
        message: `Ticket ${trackerRef} status=${summary.status} is not claimable`,
      };
    }
    await this.driver.transitionStatus(trackerRef, "in_progress");
    await this.driver.upsertTicketMetadata(trackerRef, { assignee: this.currentUser });
    return { kind: "claimed", branch, message: `Lock claimed on ${branch} via ${this.driver.trackerKey}:${trackerRef}` };
  }

  async releaseLock(id: string): Promise<void> {
    const trackerRef = await this.resolveTrackerRef(id);
    if (!trackerRef) return;
    await this.driver.transitionStatus(trackerRef, "done");
  }

  private async resolveTrackerRef(id: string): Promise<string | null> {
    return this.resolveTrackerRefImpl(id);
  }
}

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
  /**
   * ISO-8601 timestamp of the ticket's last mutation. Drivers SHOULD return
   * this so `TrackerProvider` can verify writes actually landed (FR-67
   * AC-67.5 silent-no-op guard). A driver that omits `updatedAt` disables
   * the guard for its tickets — see adapters/<tracker>.md § Silent no-op
   * trap.
   */
  updatedAt?: string;
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

export type TrackerWriteOperation = "claimLock" | "releaseLock";

/**
 * Thrown by `TrackerProvider.releaseLock` when the pre-release status
 * probe returns anything other than `"in_progress"` (STE-65 AC-STE-65.2).
 * Guards against the `Backlog → Done` silent-leap path that surfaced
 * in the M18 dogfood — if `claimLock` was skipped or the ticket was
 * moved out-of-band, the release must fail loudly rather than paper
 * over the drift by transitioning from whatever state the ticket is in.
 * NFR-10 canonical shape: verdict + remedy + context fused into the message.
 */
export class TrackerReleaseLockPreconditionError extends Error {
  readonly ticketRef: string;
  readonly trackerKey: string;
  readonly observedStatus: TicketStatus;
  constructor(args: { ticketRef: string; trackerKey: string; observedStatus: TicketStatus }) {
    super(
      `TrackerProvider.releaseLock: ticket ${args.trackerKey}:${args.ticketRef} is in "${args.observedStatus}" state; expected "in_progress".\n` +
        `Remedy: /implement Phase 1 step 0.c (Provider.claimLock) was skipped or the ticket was moved out-of-band. Transition the ticket to In Progress manually (or rerun /implement from Phase 1 so claimLock fires), then re-run Phase 4 Close.\n` +
        `Context: trackerKey=${args.trackerKey}, ticket=${args.ticketRef}, operation=releaseLock`,
    );
    this.name = "TrackerReleaseLockPreconditionError";
    this.ticketRef = args.ticketRef;
    this.trackerKey = args.trackerKey;
    this.observedStatus = args.observedStatus;
  }
}

/**
 * Thrown when a tracker write (`claimLock`, `releaseLock`) reported success
 * but the ticket's `updatedAt` did not advance past the pre-call value —
 * signaling that the adapter's MCP call silently no-op'd (often because the
 * caller used unknown parameter names, e.g., `status` instead of `state` on
 * Linear `save_issue`). NFR-10 canonical shape: the message fuses verdict,
 * remedy, and context so callers can print it directly.
 */
export class TrackerWriteNoOpError extends Error {
  readonly ticketRef: string;
  readonly trackerKey: string;
  readonly operation: TrackerWriteOperation;
  readonly preUpdatedAt: string;
  readonly postUpdatedAt: string;
  constructor(args: {
    ticketRef: string;
    trackerKey: string;
    operation: TrackerWriteOperation;
    preUpdatedAt: string;
    postUpdatedAt: string;
  }) {
    super(
      `TrackerProvider.${args.operation}: post-call updatedAt did not advance for ticket ${args.ticketRef} (pre=${args.preUpdatedAt}, post=${args.postUpdatedAt}) — the tracker MCP call silently no-op'd.\n` +
        `Remedy: verify the driver's transitionStatus/upsertTicketMetadata is using adapter-canonical parameter names (see adapters/${args.trackerKey}.md § Silent no-op trap).\n` +
        `Context: trackerKey=${args.trackerKey}, ticket=${args.ticketRef}, operation=${args.operation}`,
    );
    this.name = "TrackerWriteNoOpError";
    this.ticketRef = args.ticketRef;
    this.trackerKey = args.trackerKey;
    this.operation = args.operation;
    this.preUpdatedAt = args.preUpdatedAt;
    this.postUpdatedAt = args.postUpdatedAt;
  }
}

function isInProgress(s: TicketStatus): boolean {
  return s === "in_progress";
}

function isStrictlyAfter(post: string, pre: string): boolean {
  const preNum = Date.parse(pre);
  const postNum = Date.parse(post);
  if (Number.isFinite(preNum) && Number.isFinite(postNum)) {
    return postNum > preNum;
  }
  return post > pre;
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
    // Guard transitionStatus independently — if it no-op'd, the assignee
    // write would otherwise paper over it on a single combined re-fetch.
    const afterTransition = await this.verifyWriteLanded(trackerRef, summary.updatedAt, "claimLock");
    await this.driver.upsertTicketMetadata(trackerRef, { assignee: this.currentUser });
    await this.verifyWriteLanded(trackerRef, afterTransition, "claimLock");
    return { kind: "claimed", branch, message: `Lock claimed on ${branch} via ${this.driver.trackerKey}:${trackerRef}` };
  }

  async releaseLock(id: string): Promise<"transitioned" | "already-released"> {
    const trackerRef = await this.resolveTrackerRef(id);
    if (!trackerRef) return "already-released";
    const pre = await this.driver.getTicketStatus(trackerRef);
    // STE-84: idempotent-terminal short-circuit. A ticket already at the
    // adapter's canonical Done status has nothing to release — returning
    // "already-released" without a transitionStatus call keeps bulk
    // /spec-archive clean when every FR was shipped via single-FR /implement
    // (which Done-transitions the ticket in its own Phase 4 Close).
    if (pre.status === "done") return "already-released";
    // STE-65 (narrowed by STE-84 AC-STE-84.5): guard against claimLock-skipped
    // / out-of-band state. Non-In-Progress + non-Done pre-states still throw
    // byte-identically — the Backlog → Done silent-leap guardrail is preserved.
    if (pre.status !== "in_progress") {
      throw new TrackerReleaseLockPreconditionError({
        ticketRef: trackerRef,
        trackerKey: this.driver.trackerKey,
        observedStatus: pre.status,
      });
    }
    await this.driver.transitionStatus(trackerRef, "done");
    await this.verifyWriteLanded(trackerRef, pre.updatedAt, "releaseLock");
    return "transitioned";
  }

  /**
   * Treat `idOrRef` as a ULID (→ resolve to the tracker ref via
   * frontmatter) OR as an already-resolved tracker ref (e.g., `STE-53`).
   * The tracker ref falls through `resolveTrackerRefImpl`, which by
   * default echoes anything matching `/^[A-Z]+-\d+$/`.
   */
  async getTicketStatus(idOrRef: string): Promise<{ status: string }> {
    const trackerRef = (await this.resolveTrackerRef(idOrRef)) ?? idOrRef;
    const summary = await this.driver.getTicketStatus(trackerRef);
    return { status: String(summary.status) };
  }

  filenameFor(spec: FRSpec): string {
    const tracker = spec.frontmatter["tracker"];
    if (tracker && typeof tracker === "object" && !Array.isArray(tracker)) {
      const ref = (tracker as Record<string, unknown>)[this.driver.trackerKey];
      if (typeof ref === "string" && ref.length > 0) {
        return `${ref}.md`;
      }
    }
    const id = spec.frontmatter["id"];
    if (typeof id !== "string") {
      throw new TypeError(
        `TrackerProvider.filenameFor: no tracker[${this.driver.trackerKey}] binding and spec.frontmatter.id is ${typeof id}`,
      );
    }
    return `${id.slice(23, 29)}.md`;
  }

  /**
   * Guard is opt-in: drivers that don't surface `updatedAt` disable the
   * silent-no-op check (FR-67 AC-67.5). Real adapters MUST return it.
   * Returns the post-write `updatedAt` so chained writes can use it as the
   * next baseline without double-fetching.
   *
   * Comparison strategy: Schema O canonical form is ISO-8601 UTC
   * (`YYYY-MM-DDTHH:MM:SS.sssZ`), which lexicographically sorts correctly.
   * We primarily rely on `Date.parse` so non-UTC offsets from driver quirks
   * (e.g., `+00:00` vs `Z`) still compare by absolute instant; if either
   * timestamp fails to parse we fall back to string compare rather than
   * disabling the guard silently.
   */
  private async verifyWriteLanded(
    trackerRef: string,
    preUpdatedAt: string | undefined,
    operation: TrackerWriteOperation,
  ): Promise<string | undefined> {
    if (!preUpdatedAt) return undefined;
    const post = await this.driver.getTicketStatus(trackerRef);
    if (!post.updatedAt) return undefined;
    if (isStrictlyAfter(post.updatedAt, preUpdatedAt)) return post.updatedAt;
    throw new TrackerWriteNoOpError({
      ticketRef: trackerRef,
      trackerKey: this.driver.trackerKey,
      operation,
      preUpdatedAt,
      postUpdatedAt: post.updatedAt,
    });
  }

  private async resolveTrackerRef(id: string): Promise<string | null> {
    return this.resolveTrackerRefImpl(id);
  }
}

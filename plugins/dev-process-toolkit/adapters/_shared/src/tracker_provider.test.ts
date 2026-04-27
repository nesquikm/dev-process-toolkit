// Phase B Tier 4 tests for tracker_provider.ts (FR-43, FR-46 tracker branch).
//
// Uses a stubbed AdapterDriver — no real MCP calls.

import { describe, expect, test } from "bun:test";
import type { AdapterDriver, TicketStatusSummary } from "./tracker_provider";
import {
  TrackerProvider,
  TrackerReleaseLockPreconditionError,
  TrackerWriteNoOpError,
} from "./tracker_provider";

function makeStub(overrides: Partial<AdapterDriver> = {}): {
  driver: AdapterDriver;
  calls: string[];
} {
  const calls: string[] = [];
  const driver: AdapterDriver = {
    trackerKey: "linear",
    async pullAcs(_ticketId) {
      calls.push(`pullAcs`);
      return [];
    },
    async pushAcToggle(ticketId, acId, state) {
      calls.push(`pushAcToggle(${ticketId},${acId},${state})`);
    },
    async transitionStatus(ticketId, status) {
      calls.push(`transitionStatus(${ticketId},${status})`);
    },
    async upsertTicketMetadata(ticketId, meta) {
      calls.push(`upsertTicketMetadata(${ticketId ?? "new"},${JSON.stringify(meta)})`);
      return ticketId ?? "LIN-NEW";
    },
    async getTicketStatus(ticketId): Promise<TicketStatusSummary> {
      calls.push(`getTicketStatus(${ticketId})`);
      return { status: "unstarted", assignee: null };
    },
    getUrl(ticketId) {
      return `https://linear.app/${ticketId}`;
    },
    ...overrides,
  };
  return { driver, calls };
}

// STE-85 AC-STE-85.3/6: TrackerProvider does NOT implement IdentityMinter.
// The pre-STE-85 `mintId (AC-43.5)` describe block was removed here —
// mintId is now a capability that only `LocalProvider` exposes, enforced
// by the type system. See `local_provider.test.ts` for the mintId behavior
// under the new split; the tracker-path invariant is enforced by
// `tsc --noEmit`.

describe("TrackerProvider.sync (AC-43.2)", () => {
  test("sync calls driver.upsertTicketMetadata for each tracker key", async () => {
    const { driver, calls } = makeStub();
    const p = new TrackerProvider({ driver, currentUser: "user@example.com" });
    const result = await p.sync({
      frontmatter: {
        id: "fr_01HZ7XJFKP0000000000000A02",
        title: "T",
        milestone: "M13",
        status: "active",
        tracker: { linear: "LIN-1234" },
      },
      body: "## Requirement\n\nBody.\n",
    });
    expect(result.kind).toBe("ok");
    expect(calls.find((c) => c.startsWith("upsertTicketMetadata"))).toBeDefined();
  });

  test("sync skips keys that are not the driver's trackerKey", async () => {
    const { driver, calls } = makeStub({ trackerKey: "linear" });
    const p = new TrackerProvider({ driver, currentUser: "u" });
    await p.sync({
      frontmatter: {
        id: "fr_01HZ7XJFKP0000000000000A02",
        title: "T",
        milestone: "M13",
        status: "active",
        tracker: { github: "gh/123" },
      },
      body: "",
    });
    // Linear driver not called for a github-only FR
    expect(calls.find((c) => c.startsWith("upsertTicketMetadata"))).toBeUndefined();
  });
});

describe("TrackerProvider.claimLock (FR-46 AC-46.1, AC-46.3)", () => {
  test("unstarted ticket: claim succeeds — transitionStatus + upsertTicketMetadata(assignee)", async () => {
    const { driver, calls } = makeStub({
      async getTicketStatus() {
        return { status: "unstarted", assignee: null };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const result = await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    expect(result.kind).toBe("claimed");
    expect(calls.find((c) => c.startsWith("transitionStatus")) ?? "").toContain("in_progress");
    expect(calls.find((c) => c.startsWith("upsertTicketMetadata"))).toBeDefined();
  });

  test("in_progress + assignee != current user: refuse (AC-46.1)", async () => {
    const { driver } = makeStub({
      async getTicketStatus() {
        return { status: "in_progress", assignee: "other@example.com" };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const result = await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    expect(result.kind).toBe("taken-elsewhere");
    expect(result.message).toContain("other@example.com");
  });

  test("in_progress + assignee == current user: already-ours", async () => {
    const { driver } = makeStub({
      async getTicketStatus() {
        return { status: "in_progress", assignee: "user@example.com" };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const result = await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    expect(result.kind).toBe("already-ours");
  });
});

describe("TrackerProvider.releaseLock (AC-46.4)", () => {
  test("release calls transitionStatus('done') and returns 'transitioned' (Phase 4 completion)", async () => {
    // STE-65 AC-STE-65.5: releaseLock now requires pre-state in_progress.
    // STE-84 AC-STE-84.2: the in_progress branch returns "transitioned".
    const { driver, calls } = makeStub({
      async getTicketStatus() {
        return { status: "in_progress", assignee: "u", updatedAt: undefined };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const outcome = await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(outcome).toBe("transitioned");
    expect(calls.find((c) => c.startsWith("transitionStatus")) ?? "").toContain("done");
  });
});

describe("TrackerProvider.releaseLock — pre-state assertion (STE-65 AC-STE-65.2, AC-STE-65.4; narrowed by STE-84)", () => {
  // STE-84 AC-STE-84.5: non-In-Progress + non-Done pre-states still throw
  // byte-identically; "done" is now the idempotent-terminal branch, not an
  // error. "completed" remains rejected — only the canonical Done status
  // (status_mapping.done) short-circuits.
  const REJECTED_STATES: Array<"backlog" | "unstarted" | "cancelled" | "completed"> = [
    "backlog",
    "unstarted",
    "cancelled",
    "completed",
  ];

  for (const rejected of REJECTED_STATES) {
    test(`rejects pre-state "${rejected}" — throws TrackerReleaseLockPreconditionError and does not call transitionStatus`, async () => {
      const { driver, calls } = makeStub({
        async getTicketStatus() {
          return { status: rejected, assignee: "u", updatedAt: "2026-04-23T10:00:00.000Z" };
        },
      });
      const p = new TrackerProvider({
        driver,
        currentUser: "u",
        resolveTrackerRef: async () => "LIN-1234",
      });
      await expect(p.releaseLock("fr_01HZ7XJFKP0000000000000B03")).rejects.toBeInstanceOf(
        TrackerReleaseLockPreconditionError,
      );
      // Critical: no transitionStatus call at all on the rejected path (AC-STE-65.4b)
      expect(calls.filter((c) => c.startsWith("transitionStatus")).length).toBe(0);
    });
  }

  test("error message carries NFR-10 canonical shape substrings (AC-STE-65.4c)", async () => {
    const { driver } = makeStub({
      async getTicketStatus() {
        return { status: "backlog", assignee: null, updatedAt: "2026-04-23T10:00:00.000Z" };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-9999",
    });
    let err: TrackerReleaseLockPreconditionError | null = null;
    try {
      await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    } catch (e) {
      if (e instanceof TrackerReleaseLockPreconditionError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.observedStatus).toBe("backlog");
    expect(err!.ticketRef).toBe("LIN-9999");
    expect(err!.trackerKey).toBe("linear");
    expect(err!.message).toContain('expected "in_progress"');
    expect(err!.message).toContain("Remedy:");
    expect(err!.message).toContain("Context: trackerKey=");
    expect(err!.name).toBe("TrackerReleaseLockPreconditionError");
  });
});

describe("TrackerProvider.releaseLock — idempotent-terminal branch (STE-84 AC-STE-84.2, AC-STE-84.6)", () => {
  test("in_progress pre-state returns 'transitioned' and calls transitionStatus('done')", async () => {
    const { driver, calls } = makeStub({
      async getTicketStatus() {
        return { status: "in_progress", assignee: "u", updatedAt: undefined };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const outcome = await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(outcome).toBe("transitioned");
    expect(calls.filter((c) => c.startsWith("transitionStatus")).length).toBe(1);
    expect(calls.find((c) => c.startsWith("transitionStatus")) ?? "").toContain("done");
  });

  test("done pre-state returns 'already-released' and does NOT call transitionStatus", async () => {
    let getStatusFetches = 0;
    const { driver, calls } = makeStub({
      async getTicketStatus() {
        getStatusFetches++;
        return { status: "done", assignee: "u", updatedAt: "2026-04-24T12:00:00.000Z" };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const outcome = await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(outcome).toBe("already-released");
    // Critical: no write — the Done ticket is left alone (AC-STE-84.2)
    expect(calls.filter((c) => c.startsWith("transitionStatus")).length).toBe(0);
    // Exactly one getTicketStatus call — no verifyWriteLanded re-fetch on the
    // idempotent branch (NFR-8 call-budget discipline per STE-84 Notes).
    expect(getStatusFetches).toBe(1);
  });

  test("missing tracker ref returns 'already-released' (no binding → no-op)", async () => {
    const { driver, calls } = makeStub();
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => null,
    });
    const outcome = await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(outcome).toBe("already-released");
    // Zero driver calls — resolve miss short-circuits before any MCP work.
    expect(calls.length).toBe(0);
  });

  test("completed pre-state still throws — only canonical Done short-circuits (AC-STE-84.5)", async () => {
    const { driver, calls } = makeStub({
      async getTicketStatus() {
        return { status: "completed", assignee: "u", updatedAt: "2026-04-24T12:00:00.000Z" };
      },
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-1234",
    });
    await expect(p.releaseLock("fr_01HZ7XJFKP0000000000000B03")).rejects.toBeInstanceOf(
      TrackerReleaseLockPreconditionError,
    );
    expect(calls.filter((c) => c.startsWith("transitionStatus")).length).toBe(0);
  });
});

describe("TrackerProvider.claimLock — silent no-op guard (FR-67 AC-67.5)", () => {
  function makeTimeStubbedDriver(
    opts: {
      // One timestamp per fetch the driver will serve, in order.
      // For claimLock's success path: [pre, afterTransition, afterUpsert].
      // For claimLock's no-op path: supply equal timestamps at the no-op
      // boundary to trip the guard.
      updatedAtSequence: string[];
      trackerKey?: string;
    },
  ): { driver: AdapterDriver; calls: string[]; fetchCount: () => number } {
    const calls: string[] = [];
    let fetchCount = 0;
    const driver: AdapterDriver = {
      trackerKey: opts.trackerKey ?? "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus(ticketId, status) {
        calls.push(`transitionStatus(${ticketId},${status})`);
      },
      async upsertTicketMetadata(ticketId, meta) {
        calls.push(`upsertTicketMetadata(${ticketId ?? "new"},${JSON.stringify(meta)})`);
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(ticketId): Promise<TicketStatusSummary> {
        const n = ++fetchCount;
        calls.push(`getTicketStatus#${n}(${ticketId})`);
        const idx = Math.min(n - 1, opts.updatedAtSequence.length - 1);
        const updatedAt = opts.updatedAtSequence[idx]!;
        // n=1 is the pre-claimLock status check — must be claimable.
        // n>=2 are post-write guard fetches — ticket now reflects claim state.
        return {
          status: n === 1 ? "unstarted" : "in_progress",
          assignee: n === 1 ? null : "user@example.com",
          updatedAt,
        };
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    return { driver, calls, fetchCount: () => fetchCount };
  }

  test("claimLock throws TrackerWriteNoOpError when transitionStatus silently no-ops (updatedAt does not advance on 1st post-write fetch)", async () => {
    const { driver } = makeTimeStubbedDriver({
      // pre, afterTransition (unchanged → no-op), afterUpsert (never reached)
      updatedAtSequence: [
        "2026-04-22T11:00:00.000Z",
        "2026-04-22T11:00:00.000Z",
        "2026-04-22T11:00:05.000Z",
      ],
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    await expect(
      p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test"),
    ).rejects.toThrow(TrackerWriteNoOpError);
  });

  test("claimLock succeeds when every write advances updatedAt", async () => {
    const { driver, calls } = makeTimeStubbedDriver({
      updatedAtSequence: [
        "2026-04-22T11:00:00.000Z",
        "2026-04-22T11:00:05.000Z",
        "2026-04-22T11:00:10.000Z",
      ],
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const result = await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    expect(result.kind).toBe("claimed");
    // Guard performed two post-write fetches (#2 after transitionStatus,
    // #3 after upsertTicketMetadata).
    expect(calls.some((c) => c.startsWith("getTicketStatus#2"))).toBe(true);
    expect(calls.some((c) => c.startsWith("getTicketStatus#3"))).toBe(true);
  });

  test("TrackerWriteNoOpError message cites ticket ref and operation (NFR-10 shape)", async () => {
    const { driver } = makeTimeStubbedDriver({
      updatedAtSequence: [
        "2026-04-22T11:00:00.000Z",
        "2026-04-22T11:00:00.000Z",
      ],
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    let err: TrackerWriteNoOpError | null = null;
    try {
      await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    } catch (e) {
      if (e instanceof TrackerWriteNoOpError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.ticketRef).toBe("LIN-1234");
    expect(err!.operation).toBe("claimLock");
    expect(err!.message).toContain("LIN-1234");
    expect(err!.message).toContain("Remedy:");
  });

  test("claimLock fires guard per-write: transitionStatus advances but upsertTicketMetadata silently no-ops → throw", async () => {
    // AC-67.5 — the guard must run after each write independently. A single
    // combined re-fetch would see transitionStatus's successful bump and
    // falsely report success on a silently-no-op'd upsertTicketMetadata.
    const { driver, calls, fetchCount } = makeTimeStubbedDriver({
      updatedAtSequence: [
        "2026-04-22T11:00:00.000Z",
        "2026-04-22T11:00:05.000Z", // transitionStatus landed
        "2026-04-22T11:00:05.000Z", // upsertTicketMetadata silently no-op'd (stuck)
      ],
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    let err: TrackerWriteNoOpError | null = null;
    try {
      await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    } catch (e) {
      if (e instanceof TrackerWriteNoOpError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.operation).toBe("claimLock");
    expect(err!.preUpdatedAt).toBe("2026-04-22T11:00:05.000Z");
    expect(err!.postUpdatedAt).toBe("2026-04-22T11:00:05.000Z");
    expect(calls).toContain("transitionStatus(LIN-1234,in_progress)");
    expect(calls.some((c) => c.startsWith("upsertTicketMetadata"))).toBe(true);
    expect(fetchCount()).toBe(3);
  });

  test("guard compares by parsed instant, not lexicographic string (offset-form robustness)", async () => {
    // Same instant expressed two ways: "2026-04-22T11:00:00+00:00" and
    // "2026-04-22T11:00:00Z" parse to the same Date.getTime(); lex compare
    // would report the second as "later" and falsely pass the guard. Drivers
    // should normalize to Z, but if one slips, the guard must still fire.
    const { driver } = makeTimeStubbedDriver({
      updatedAtSequence: [
        "2026-04-22T11:00:00+00:00",
        "2026-04-22T11:00:00Z", // same instant, different form
        "2026-04-22T11:00:00Z",
      ],
    });
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    await expect(
      p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test"),
    ).rejects.toThrow(TrackerWriteNoOpError);
  });

  test("guard is skipped when driver does not report updatedAt (legacy stub compatibility)", async () => {
    const calls: string[] = [];
    const driver: AdapterDriver = {
      trackerKey: "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus(ticketId, status) {
        calls.push(`transitionStatus(${ticketId},${status})`);
      },
      async upsertTicketMetadata(ticketId, meta) {
        calls.push(`upsertTicketMetadata(${ticketId ?? "new"},${JSON.stringify(meta)})`);
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(): Promise<TicketStatusSummary> {
        return { status: "unstarted", assignee: null };
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const result = await p.claimLock("fr_01HZ7XJFKP0000000000000B03", "feat/test");
    expect(result.kind).toBe("claimed");
  });
});

describe("TrackerProvider.releaseLock — silent no-op guard (FR-67 AC-67.5)", () => {
  test("releaseLock throws TrackerWriteNoOpError when post-call updatedAt did not advance", async () => {
    const calls: string[] = [];
    let fetchCount = 0;
    const driver: AdapterDriver = {
      trackerKey: "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus(ticketId, status) {
        calls.push(`transitionStatus(${ticketId},${status})`);
      },
      async upsertTicketMetadata(ticketId) {
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(): Promise<TicketStatusSummary> {
        fetchCount++;
        return {
          status: "in_progress",
          assignee: "user@example.com",
          updatedAt: "2026-04-22T11:00:00.000Z",
        };
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-9999",
    });
    await expect(p.releaseLock("fr_01HZ7XJFKP0000000000000B03")).rejects.toThrow(
      TrackerWriteNoOpError,
    );
    // Guard performed pre and post fetch.
    expect(fetchCount).toBe(2);
  });

  test("releaseLock succeeds when post-call updatedAt advances", async () => {
    const calls: string[] = [];
    let fetchCount = 0;
    const driver: AdapterDriver = {
      trackerKey: "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus(ticketId, status) {
        calls.push(`transitionStatus(${ticketId},${status})`);
      },
      async upsertTicketMetadata(ticketId) {
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(): Promise<TicketStatusSummary> {
        const n = ++fetchCount;
        return {
          status: n === 1 ? "in_progress" : "done",
          assignee: "user@example.com",
          updatedAt: n === 1 ? "2026-04-22T11:00:00.000Z" : "2026-04-22T11:00:05.000Z",
        };
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    const p = new TrackerProvider({
      driver,
      currentUser: "user@example.com",
      resolveTrackerRef: async () => "LIN-9999",
    });
    await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(calls.find((c) => c.startsWith("transitionStatus")) ?? "").toContain("done");
  });

  test("TrackerWriteNoOpError message includes operation=releaseLock", async () => {
    const driver: AdapterDriver = {
      trackerKey: "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus() {},
      async upsertTicketMetadata(ticketId) {
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(): Promise<TicketStatusSummary> {
        return {
          status: "in_progress",
          assignee: "u",
          updatedAt: "2026-04-22T11:00:00.000Z",
        };
      },
      getUrl: (id) => `https://linear.app/${id}`,
    };
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-9999",
    });
    let err: TrackerWriteNoOpError | null = null;
    try {
      await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    } catch (e) {
      if (e instanceof TrackerWriteNoOpError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.operation).toBe("releaseLock");
    expect(err!.ticketRef).toBe("LIN-9999");
  });
});

describe("TrackerProvider.getUrl", () => {
  test("delegates to driver.getUrl", () => {
    const { driver } = makeStub();
    const p = new TrackerProvider({ driver, currentUser: "u" });
    expect(p.getUrl("LIN-1234")).toBe("https://linear.app/LIN-1234");
  });
});

describe("UpsertMetadataInput widening (STE-117 AC-STE-117.2)", () => {
  test("adapters can read team + project off the input shape", async () => {
    // The widening is a structural type change — the test confirms a
    // driver implementation can accept and act on the new fields without
    // breaking the existing callers (back-compat = optional fields).
    const seen: { team?: string; project?: string } = {};
    const driver: AdapterDriver = {
      trackerKey: "linear",
      async pullAcs() {
        return [];
      },
      async pushAcToggle() {},
      async transitionStatus() {},
      async upsertTicketMetadata(ticketId, meta) {
        seen.team = meta.team;
        seen.project = meta.project;
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus() {
        return { status: "unstarted", assignee: null };
      },
      getUrl: (id) => `https://linear.app/${id}`,
    };
    await driver.upsertTicketMetadata(null, {
      title: "T",
      description: "D",
      team: "STE",
      project: "DPT — Dev Process Toolkit",
    });
    expect(seen.team).toBe("STE");
    expect(seen.project).toBe("DPT — Dev Process Toolkit");
  });

  test("call sites that omit team/project still type-check (back-compat)", async () => {
    const { driver } = makeStub();
    // Existing call shape: title + description only — must compile + run.
    const id = await driver.upsertTicketMetadata(null, {
      title: "T",
      description: "D",
    });
    expect(id).toBe("LIN-NEW");
  });
});

// Phase B Tier 4 tests for tracker_provider.ts (FR-43, FR-46 tracker branch).
//
// Uses a stubbed AdapterDriver — no real MCP calls.

import { describe, expect, test } from "bun:test";
import type { AdapterDriver, TicketStatusSummary } from "./tracker_provider";
import { TrackerProvider } from "./tracker_provider";
import { ULID_REGEX } from "./ulid";

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

describe("TrackerProvider.mintId (AC-43.5)", () => {
  test("mintId is always local — does not consult driver", () => {
    const { driver, calls } = makeStub();
    const p = new TrackerProvider({ driver, currentUser: "user@example.com" });
    const id = p.mintId();
    expect(id).toMatch(ULID_REGEX);
    expect(calls).toEqual([]);
  });
});

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
  test("release calls transitionStatus('done') by default (Phase 4 completion)", async () => {
    const { driver, calls } = makeStub();
    const p = new TrackerProvider({
      driver,
      currentUser: "u",
      resolveTrackerRef: async () => "LIN-1234",
    });
    await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(calls.find((c) => c.startsWith("transitionStatus")) ?? "").toContain("done");
  });
});

describe("TrackerProvider.getUrl", () => {
  test("delegates to driver.getUrl", () => {
    const { driver } = makeStub();
    const p = new TrackerProvider({ driver, currentUser: "u" });
    expect(p.getUrl("LIN-1234")).toBe("https://linear.app/LIN-1234");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import type { AdapterDriver, TicketStatusSummary } from "../adapters/_shared/src/tracker_provider";

// STE-84 AC-STE-84.7 — the idempotent-terminal branch must not regress the
// /gate-check ticket-state-drift probe (STE-54 AC-STE-54.3). The probe reads
// archive-side FRs and asserts each bound ticket is at status_mapping.done;
// a release that returned "already-released" means the ticket was already
// Done, so the probe continues to pass byte-identically.
//
// These prose + behavioural assertions lock the invariant: narrowing
// releaseLock to accept terminal-Done does not weaken STE-65's guardrail
// against the Backlog → Done silent-leap, and the read-side probe keeps
// the same shape.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function readGateCheck(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

describe("AC-STE-84.7 — ticket-state-drift probe shape is unchanged", () => {
  test("probe still asserts status matches status_mapping.done", () => {
    const body = readGateCheck();
    // The canonical Done status assertion is what proves STE-54's invariant;
    // the idempotent-terminal release must not force a rewrite of the probe.
    expect(body).toMatch(/Ticket-state drift/);
    expect(body).toMatch(/status_mapping\.done/);
  });

  test("probe still scopes to archive-side FRs with status: archived", () => {
    const body = readGateCheck();
    expect(body).toMatch(/specs\/frs\/archive\//);
    expect(body).toMatch(/status:\s*archived/);
  });

  test("probe still calls Provider.getTicketStatus per FR", () => {
    const body = readGateCheck();
    expect(body).toMatch(/Provider\.getTicketStatus|getTicketStatus\(/);
  });
});

describe("AC-STE-84.7 — positive path: already-released ticket passes the probe", () => {
  function makeDoneStub(): { driver: AdapterDriver; calls: string[] } {
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
      async upsertTicketMetadata(ticketId) {
        return ticketId ?? "LIN-NEW";
      },
      async getTicketStatus(ticketId): Promise<TicketStatusSummary> {
        calls.push(`getTicketStatus(${ticketId})`);
        return { status: "done", assignee: "u@e", updatedAt: "2026-04-24T12:00:00.000Z" };
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    return { driver, calls };
  }

  test("releaseLock on already-Done ticket returns 'already-released' without a transitionStatus call", async () => {
    const { driver, calls } = makeDoneStub();
    const p = new TrackerProvider({
      driver,
      currentUser: "u@e",
      resolveTrackerRef: async () => "LIN-1234",
    });
    const outcome = await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    expect(outcome).toBe("already-released");
    expect(calls.filter((c) => c.startsWith("transitionStatus")).length).toBe(0);
  });

  test("post-release getTicketStatus reports 'done' — probe's assertion holds", async () => {
    const { driver } = makeDoneStub();
    const p = new TrackerProvider({
      driver,
      currentUser: "u@e",
      resolveTrackerRef: async () => "LIN-1234",
    });
    await p.releaseLock("fr_01HZ7XJFKP0000000000000B03");
    // Simulate the /gate-check probe reading the archive-side FR.
    const probe = await p.getTicketStatus("LIN-1234");
    expect(probe.status).toBe("done");
  });
});

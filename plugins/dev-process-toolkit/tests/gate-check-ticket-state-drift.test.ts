import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import type { AdapterDriver, TicketStatusSummary } from "../adapters/_shared/src/tracker_provider";

// AC-STE-54.3 / AC-STE-54.5: /gate-check gains a "Ticket-state drift" check
// that walks archived FRs, resolves their tracker binding, and asserts each
// bound ticket has reached the canonical Done state. Skipped for mode: none.
//
// AC-STE-54.4 / AC-STE-54.5: Provider.getTicketStatus is unit-tested with a
// mocked driver — LocalProvider returns the "local-no-tracker" sentinel;
// TrackerProvider delegates to the driver and returns the driver's status
// string verbatim.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function readGateCheck(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

describe("AC-STE-54.3 — /gate-check ticket-state drift check prose", () => {
  test("gate-check SKILL.md includes a 'Ticket-state drift' section", () => {
    const body = readGateCheck();
    expect(body).toMatch(/Ticket-state drift/i);
  });

  test("drift check names Provider.getTicketStatus", () => {
    const body = readGateCheck();
    expect(body).toContain("getTicketStatus");
  });

  test("drift check scopes itself to specs/frs/archive/ with status: archived", () => {
    const body = readGateCheck();
    expect(body).toMatch(/specs\/frs\/archive\//);
    expect(body).toMatch(/status:\s*archived/);
  });

  test("drift check reports ULID + tracker ID + observed/expected state", () => {
    const body = readGateCheck();
    // Prose must name all three data points so the failing report is actionable.
    expect(body).toMatch(/ULID/i);
    expect(body).toMatch(/tracker\s*(ID|ref)/i);
    expect(body).toMatch(/observed.*expected|expected.*observed/i);
  });

  test("drift check skips for mode: none", () => {
    const body = readGateCheck();
    expect(body).toMatch(/mode:\s*none|skipped.*mode.*none/i);
  });
});

describe("AC-STE-54.4 — LocalProvider.getTicketStatus sentinel", () => {
  test("LocalProvider.getTicketStatus returns { status: 'local-no-tracker' }", async () => {
    const lp = new LocalProvider({ repoRoot: pluginRoot, gitUserEmail: "test@example.com" });
    const result = await lp.getTicketStatus("LIN-1234");
    expect(result).toEqual({ status: "local-no-tracker" });
  });

  test("LocalProvider.getTicketStatus does not touch the filesystem or git", async () => {
    const lp = new LocalProvider({ repoRoot: "/nonexistent/path/that/does/not/exist", gitUserEmail: "t@e" });
    // Sentinel return must not depend on repoRoot existing — it is a pure
    // capability advertisement.
    const result = await lp.getTicketStatus("STE-99");
    expect(result.status).toBe("local-no-tracker");
  });
});

describe("AC-STE-54.4 — TrackerProvider.getTicketStatus delegation", () => {
  function makeStub(summary: TicketStatusSummary): { driver: AdapterDriver; calls: string[] } {
    const calls: string[] = [];
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
      async getTicketStatus(ticketId) {
        calls.push(`getTicketStatus(${ticketId})`);
        return summary;
      },
      getUrl(ticketId) {
        return `https://linear.app/${ticketId}`;
      },
    };
    return { driver, calls };
  }

  test("returns Done when driver reports done", async () => {
    const { driver, calls } = makeStub({ status: "done", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("LIN-1234");
    expect(result.status).toBe("done");
    expect(calls).toEqual(["getTicketStatus(LIN-1234)"]);
  });

  test("returns in_progress when driver reports in_progress", async () => {
    const { driver } = makeStub({ status: "in_progress", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("LIN-1234");
    expect(result.status).toBe("in_progress");
  });

  test("returns backlog when driver reports backlog", async () => {
    const { driver } = makeStub({ status: "backlog", assignee: null });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("LIN-1234");
    expect(result.status).toBe("backlog");
  });

  test("forwards the ticket ID to the driver verbatim", async () => {
    const { driver, calls } = makeStub({ status: "done", assignee: null });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    await p.getTicketStatus("STE-53");
    expect(calls).toEqual(["getTicketStatus(STE-53)"]);
  });
});

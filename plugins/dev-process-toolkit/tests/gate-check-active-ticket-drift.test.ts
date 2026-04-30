import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeTicketDriftPasses,
  inProgressMatches,
} from "../adapters/_shared/src/active_ticket_drift_predicate";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import type { AdapterDriver, TicketStatusSummary } from "../adapters/_shared/src/tracker_provider";

// AC-STE-87.1 / AC-STE-87.2 / AC-STE-87.4: /gate-check gains probe #14
// "Ticket-state drift — active side" that mirrors probe #8 symmetrically.
// It walks active FRs (specs/frs/*.md, excluding archive/), resolves Provider
// once, calls Provider.getTicketStatus(<tracker-ref>), and asserts the
// returned status matches status_mapping.in_progress AND assignee matches
// currentUser. Mismatch → GATE FAILED naming ULID + tracker ID + observed
// vs. expected status + observed vs. expected assignee. Skipped for
// mode: none.
//
// Same shape as gate-check-ticket-state-drift.test.ts (probe #8). The
// behavior assertions exercise the Provider primitives the probe's prose
// relies on; the prose-shape assertions verify SKILL.md carries the
// required instruction surface so /gate-check has something deterministic
// to follow.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function readGateCheck(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

function makeStub(summary: TicketStatusSummary): {
  driver: AdapterDriver;
  calls: string[];
} {
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

// AC-STE-87.x cases dogfood the production strict-shape predicate
// (`inProgressMatches`); STE-151 extended the probe with a composed
// predicate but the strict path stays load-bearing for the M23 drift cases
// these tests cover.

describe("AC-STE-87.1 — probe #14 prose shape in gate-check SKILL.md", () => {
  test("SKILL.md contains a probe #14 heading substring", () => {
    const body = readGateCheck();
    // Probe #14 must be positionally numbered and titled so /gate-check
    // can find and execute it.
    expect(body).toMatch(/14\.\s+\*\*Ticket-state drift.*active/i);
  });

  test("probe #14 names Provider.getTicketStatus", () => {
    const body = readGateCheck();
    expect(body).toContain("getTicketStatus");
  });

  test("probe #14 scopes itself to active specs/frs/*.md (non-archive)", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    expect(idx).toBeGreaterThan(-1);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toMatch(/specs\/frs\/\*\.md|specs\/frs\/\*\*|specs\/frs\//);
    expect(block).toMatch(/archive/i);
    expect(block).toMatch(/status:\s*active/);
  });

  test("probe #14 asserts status_mapping.in_progress AND assignee == currentUser", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toMatch(/in_progress/);
    expect(block).toMatch(/currentUser|assignee/i);
  });

  test("probe #14 reports ULID + tracker ID + observed vs. expected status + assignee", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toMatch(/ULID/i);
    expect(block).toMatch(/tracker\s*(ID|ref)/i);
    expect(block).toMatch(/observed.*expected|expected.*observed/i);
    expect(block).toMatch(/assignee/i);
  });

  test("probe #14 documents the mode: none skip", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toMatch(/mode:\s*none|local-no-tracker/i);
  });
});

describe("AC-STE-87.4(a) — positive: in_progress + matching assignee passes", () => {
  test("TrackerProvider.getTicketStatus returns in_progress when driver reports it, probe passes", async () => {
    const { driver, calls } = makeStub({ status: "in_progress", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("STE-87");
    expect(result.status).toBe("in_progress");
    expect(result.assignee).toBe("u@e");
    expect(calls).toEqual(["getTicketStatus(STE-87)"]);
    expect(inProgressMatches(result, "u@e")).toBe(true);
  });
});

describe("AC-STE-87.4(b) — negative: Backlog fails", () => {
  test("TrackerProvider surfaces backlog; probe comparison fails with observed=backlog vs. expected=in_progress", async () => {
    const { driver } = makeStub({ status: "backlog", assignee: null });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("STE-87");
    expect(result.status).toBe("backlog");
    expect(inProgressMatches(result, "u@e")).toBe(false);
  });
});

describe("AC-STE-87.4(c) — negative: Done fails", () => {
  test("TrackerProvider surfaces done on an active FR; probe comparison fails", async () => {
    const { driver } = makeStub({ status: "done", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("STE-87");
    expect(result.status).toBe("done");
    expect(inProgressMatches(result, "u@e")).toBe(false);
  });
});

describe("AC-STE-87.4(d) — negative: wrong assignee fails", () => {
  test("in_progress with a different assignee fails the probe's assignee==currentUser assertion", async () => {
    const { driver } = makeStub({ status: "in_progress", assignee: "other@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("STE-87");
    expect(result.status).toBe("in_progress");
    expect(result.assignee).toBe("other@e");
    expect(inProgressMatches(result, "u@e")).toBe(false);
  });
});

describe("AC-STE-87.2 — STE-28 already-ours shape tolerated", () => {
  test("probe passes regardless of whether this session called claimLock", async () => {
    // The probe is over observed state. A session that inherits an already-claimed
    // ticket (STE-28 "already-ours") should still pass without re-running claimLock.
    const { driver } = makeStub({ status: "in_progress", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const result = await p.getTicketStatus("STE-87");
    expect(inProgressMatches(result, "u@e")).toBe(true);
  });
});

describe("AC-STE-87.4(e) — mode: none skip", () => {
  test("LocalProvider.getTicketStatus returns local-no-tracker sentinel; probe skips", async () => {
    const lp = new LocalProvider({ repoRoot: pluginRoot, gitUserEmail: "t@e" });
    const result = await lp.getTicketStatus("STE-87");
    // Sentinel value tells the probe runner to short-circuit without
    // comparing against in_progress/currentUser.
    expect(result.status).toBe("local-no-tracker");
  });
});

describe("AC-STE-87.4(f) — probe authoring contract lists probe #14", () => {
  test("SKILL.md probe authoring contract names gate-check-active-ticket-drift.test.ts", () => {
    const body = readGateCheck();
    // STE-82 contract: every probe ships with its test file. The contract
    // section must reference probe #14's test so future edits can grep it.
    expect(body).toMatch(/gate-check-active-ticket-drift\.test\.ts/);
  });
});

describe("AC-STE-139.5 — active-ticket-drift runs clean on this repo's baseline", () => {
  test("LocalProvider.getTicketStatus returns the local-no-tracker sentinel (probe vacuous in mode: none)", async () => {
    // The probe walks active FRs and calls Provider.getTicketStatus. In mode: none
    // the LocalProvider returns the `local-no-tracker` sentinel which the probe
    // treats as a vacuous pass. We exercise the sentinel here so the baseline
    // contract stays locked (full tracker-mode probe is exercised at gate time
    // when MCP is wired).
    const lp = new LocalProvider({ repoRoot: pluginRoot, gitUserEmail: "test@example.com" });
    const result = await lp.getTicketStatus("STE-139");
    expect(result.status).toBe("local-no-tracker");
  });
});

// AC-STE-151 — relaxed predicate prose-shape assertions

describe("AC-STE-151.1/.2/.5 — probe #14 relaxed-predicate prose shape", () => {
  test("probe #14 references the single-FR-clean exemption", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toMatch(/single-FR[ -]clean/i);
  });

  test("probe #14 names the readPlanTaskState helper", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toContain("readPlanTaskState");
  });

  test("probe #14 names the activeTicketDriftPasses composed predicate", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    expect(block).toContain("activeTicketDriftPasses");
  });

  test("probe #14 renders the predicate truth table", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    // Header row + at least the single-FR-clean row + the strict-fallback row
    // must appear so the operator can read the rule without leaving SKILL.md.
    expect(block).toMatch(/\|\s*FR status\s*\|/);
    expect(block).toMatch(/single-FR clean|unchecked\s*>\s*0/i);
    expect(block).toMatch(/forgot bulk archive|all checked/i);
    expect(block).toMatch(/strict fallback|missing/i);
  });

  test("probe #14 mentions STE-151 origin so future readers can trace the relaxation", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    // Toolkit-meta `STE-<N>` literals are scrubbed from skill prose
    // (commit 2069ba4). Assert the conceptual content survives — the
    // probe must still describe the single-FR-clean exemption / relaxation
    // so future readers can trace the rule.
    expect(block).toMatch(/single-FR clean|relaxation|exemption|strictly weakens/i);
  });

  test("failure-row shape preserved (AC-STE-87.4(d) compatibility)", () => {
    const body = readGateCheck();
    const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
    const next = body.indexOf("\n15.", idx);
    const block = body.slice(idx, next > 0 ? next : undefined);
    // The relaxation strictly weakens the predicate — when it does fire, the
    // row must still carry observed-vs-expected status + assignee.
    expect(block).toMatch(/observed.*expected|expected.*observed/i);
    expect(block).toMatch(/assignee/i);
  });
});

const STATUS_MAP = { in_progress: "in_progress", done: "done" } as const;

describe("AC-STE-151.6(a) — active FR + Done ticket + plan with unchecked tasks ⇒ no fire", () => {
  test("TrackerProvider returns done; composed predicate exempts the FR via single-FR-clean rule", async () => {
    // Mid-milestone /implement <FR-id> shape: ticket transitioned to Done at
    // Phase 4 Close, FR file stays `status: active` per the milestone-bulk-
    // archive design, and the plan still has at least one unchecked task.
    const { driver } = makeStub({ status: "done", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const summary = await p.getTicketStatus("STE-151");
    expect(summary.status).toBe("done");
    expect(
      activeTicketDriftPasses(
        summary,
        { uncheckedTasks: 2, totalTasks: 2, planStatus: "active" },
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });
});

describe("AC-STE-151.6(b) — Done ticket + plan all-checked + plan active ⇒ fires", () => {
  test('"forgot bulk archive before /ship-milestone" shape — predicate fails, canonical row shape preserved', async () => {
    const { driver } = makeStub({ status: "done", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const summary = await p.getTicketStatus("STE-151");
    expect(
      activeTicketDriftPasses(
        summary,
        { uncheckedTasks: 0, totalTasks: 3, planStatus: "active" },
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
    // Canonical observed-vs-expected fields stay populated for the row
    // renderer; AC-STE-87.4(d) consumers see no shape change.
    expect(summary.status).toBe("done");
    expect(summary.assignee).toBe("u@e");
  });
});

describe("AC-STE-151.6(c) — Done ticket + plan missing ⇒ falls back to strict (fires)", () => {
  test("orphan plan: predicate denies the exemption, strict assertion runs and fails", async () => {
    const { driver } = makeStub({ status: "done", assignee: "u@e" });
    const p = new TrackerProvider({ driver, currentUser: "u@e" });
    const summary = await p.getTicketStatus("STE-151");
    expect(
      activeTicketDriftPasses(
        summary,
        { uncheckedTasks: 0, totalTasks: 0, planStatus: "missing" },
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });
});

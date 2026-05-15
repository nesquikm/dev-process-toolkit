// STE-284 AC-STE-284.7 — Provider.listMilestones() + Provider.listActiveFRs()
//
// LocalProvider (mode: 'none') MUST return `[]` for both. TrackerProvider
// (mode: 'tracker') delegates to a driver. The interface itself MUST carry
// both methods so reconcileTrackerLocal (AC.2) can call them without an
// `instanceof` check.

import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { TrackerProvider, type AdapterDriver, type TicketStatusSummary } from "../adapters/_shared/src/tracker_provider";
import type { Provider } from "../adapters/_shared/src/provider";

async function initRepo(dir: string): Promise<void> {
  await $`git init --initial-branch=main -q`.cwd(dir);
  await $`git config user.email test@example.com`.cwd(dir);
  await $`git config user.name Test`.cwd(dir);
  await $`git config commit.gpgsign false`.cwd(dir);
  mkdirSync(join(dir, "specs", "frs"), { recursive: true });
  writeFileSync(join(dir, ".gitkeep"), "");
  await $`git add .`.cwd(dir);
  await $`git commit -q -m init`.cwd(dir);
}

describe("AC-STE-284.7: LocalProvider.listMilestones returns []", () => {
  test("mode: 'none' → empty array, no side effects", async () => {
    const work = mkdtempSync(join(tmpdir(), "dpt-list-milestones-local-"));
    try {
      await initRepo(work);
      const p = new LocalProvider({ repoRoot: work });
      const ms = await p.listMilestones();
      expect(ms).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.7: LocalProvider.listActiveFRs returns []", () => {
  test("mode: 'none' → empty array (no tracker)", async () => {
    const work = mkdtempSync(join(tmpdir(), "dpt-list-active-local-"));
    try {
      await initRepo(work);
      const p = new LocalProvider({ repoRoot: work });
      const ids = await p.listActiveFRs();
      expect(ids).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.7: LocalProvider.mode === 'none'", () => {
  test("readonly mode getter reports 'none'", async () => {
    const work = mkdtempSync(join(tmpdir(), "dpt-mode-local-"));
    try {
      await initRepo(work);
      const p = new LocalProvider({ repoRoot: work });
      expect(p.mode).toBe("none");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.7: TrackerProvider.listMilestones delegates to driver", () => {
  test("driver.listMilestones returns names → provider returns same shape", async () => {
    const calls: string[] = [];
    const driver: AdapterDriver = {
      trackerKey: "linear",
      pullAcs: async () => [],
      pushAcToggle: async () => undefined,
      transitionStatus: async () => undefined,
      upsertTicketMetadata: async () => "STE-1",
      getTicketStatus: async (): Promise<TicketStatusSummary> => ({
        status: "in_progress",
        assignee: "alice",
      }),
      getUrl: () => "https://example/STE-1",
      // New driver capability for STE-284.
      listMilestones: async () => {
        calls.push("listMilestones");
        return [{ name: "M70" }, { name: "M71" }];
      },
      listActiveFRs: async () => {
        calls.push("listActiveFRs");
        return ["STE-1", "STE-2"];
      },
    } as AdapterDriver & {
      listMilestones: () => Promise<{ name: string }[]>;
      listActiveFRs: () => Promise<string[]>;
    };
    const p = new TrackerProvider({ driver, currentUser: "alice" });
    const ms = await p.listMilestones();
    expect(ms).toEqual([{ name: "M70" }, { name: "M71" }]);
    expect(calls).toContain("listMilestones");
  });

  test("TrackerProvider.listActiveFRs delegates to driver", async () => {
    const driver: AdapterDriver = {
      trackerKey: "linear",
      pullAcs: async () => [],
      pushAcToggle: async () => undefined,
      transitionStatus: async () => undefined,
      upsertTicketMetadata: async () => "STE-1",
      getTicketStatus: async () => ({ status: "in_progress", assignee: null } as TicketStatusSummary),
      getUrl: () => "https://example/STE-1",
      listMilestones: async () => [],
      listActiveFRs: async () => ["STE-280", "STE-281", "STE-282"],
    } as AdapterDriver & {
      listMilestones: () => Promise<{ name: string }[]>;
      listActiveFRs: () => Promise<string[]>;
    };
    const p = new TrackerProvider({ driver, currentUser: "alice" });
    const ids = await p.listActiveFRs();
    expect(ids).toEqual(["STE-280", "STE-281", "STE-282"]);
  });

  test("TrackerProvider.mode === 'tracker'", async () => {
    const driver: AdapterDriver = {
      trackerKey: "linear",
      pullAcs: async () => [],
      pushAcToggle: async () => undefined,
      transitionStatus: async () => undefined,
      upsertTicketMetadata: async () => "STE-1",
      getTicketStatus: async () => ({ status: "in_progress", assignee: null } as TicketStatusSummary),
      getUrl: () => "https://example/STE-1",
      listMilestones: async () => [],
      listActiveFRs: async () => [],
    } as AdapterDriver & {
      listMilestones: () => Promise<{ name: string }[]>;
      listActiveFRs: () => Promise<string[]>;
    };
    const p = new TrackerProvider({ driver, currentUser: "alice" });
    expect(p.mode).toBe("tracker");
  });
});

describe("AC-STE-284.7: Provider interface structural shape (duck-typed)", () => {
  test("Provider-typed value MUST expose `listMilestones` and `listActiveFRs`", async () => {
    // Structural test: build a Provider via LocalProvider, then call the
    // new methods via the base interface type. If `Provider` lacks either
    // method name, this file fails to compile.
    const work = mkdtempSync(join(tmpdir(), "dpt-iface-"));
    try {
      await initRepo(work);
      const p: Provider = new LocalProvider({ repoRoot: work });
      const ms = await p.listMilestones();
      const ids = await p.listActiveFRs();
      expect(Array.isArray(ms)).toBe(true);
      expect(Array.isArray(ids)).toBe(true);
      expect(p.mode).toBe("none");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

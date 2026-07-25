// STE-284 AC-STE-284.2 — reconcileTrackerLocal helper.
//
// Walks `<specsDir>/frs/*.md` (excluding archive/) and `<specsDir>/plan/M*.md`
// (excluding archive/) and reconciles them against `provider.listActiveFRs()`
// + `provider.listMilestones()`. Returns three disjoint orphan lists:
//
//   - trackerOrphans:    tracker FR IDs with no local file
//   - localOrphans:      local FR files with no tracker binding (or whose
//                        binding points to an FR not on tracker)
//   - milestoneMismatches: milestone names present on one side only
//
// Mode-none: vacuous (all three lists empty).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileTrackerLocal } from "../reconcile_tracker_local";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../provider";

// Stub provider modeled on `import.test.ts` StubProvider, extended with the
// new methods Provider gains for STE-284 (mode, listActiveFRs, listMilestones).
class StubTrackerProvider implements Provider {
  readonly mode = "tracker" as const;
  constructor(
    private readonly activeFRs: string[],
    private readonly milestones: { name: string }[],
  ) {}
  async listActiveFRs(): Promise<string[]> {
    return [...this.activeFRs];
  }
  async listMilestones(): Promise<{ name: string }[]> {
    return [...this.milestones];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
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
  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "" };
  }
  getUrl(): string | null {
    return null;
  }
  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "in_progress" };
  }
  filenameFor(_spec: FRSpec): string {
    return "stub.md";
  }
}

class StubLocalProvider implements Provider {
  readonly mode = "none" as const;
  async getMetadata(id: string): Promise<FRMetadata> {
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
  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "" };
  }
  getUrl(): string | null {
    return null;
  }
  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "local-no-tracker" };
  }
  filenameFor(_spec: FRSpec): string {
    return "stub.md";
  }
}

function makeSpecsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "reconcile-tracker-local-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs"), { recursive: true });
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  return specsDir;
}

function writeFR(
  specsDir: string,
  filename: string,
  trackerBinding: { key: string; id: string } | null,
  opts: { archive?: boolean; milestone?: string } = {},
): void {
  const tracker = trackerBinding ? `tracker:\n  ${trackerBinding.key}: ${trackerBinding.id}\n` : "tracker: {}\n";
  const milestone = opts.milestone ?? "M70";
  const status = opts.archive ? "archived" : "active";
  const body = `---\ntitle: Test FR\nmilestone: ${milestone}\nstatus: ${status}\narchived_at: null\n${tracker}created_at: 2026-05-13T00:00:00Z\n---\n\n# ${filename}\n`;
  const dir = opts.archive ? join(specsDir, "frs", "archive") : join(specsDir, "frs");
  writeFileSync(join(dir, filename), body);
}

function writePlan(specsDir: string, milestone: string, opts: { archive?: boolean } = {}): void {
  const status = opts.archive ? "archived" : "active";
  const archivedAt = opts.archive ? "2026-04-01T00:00:00Z" : "null";
  const body = `---\nmilestone: ${milestone}\nstatus: ${status}\narchived_at: ${archivedAt}\n---\n\n# ${milestone} — Test plan\n`;
  const dir = opts.archive ? join(specsDir, "plan", "archive") : join(specsDir, "plan");
  writeFileSync(join(dir, `${milestone}.md`), body);
}

describe("AC-STE-284.2: mode-none → vacuous (all empty arrays)", () => {
  test("LocalProvider (mode: 'none') returns empty orphan lists regardless of FS", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFR(specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, { milestone: "M1" });
      writePlan(specsDir, "M1");
      const provider = new StubLocalProvider();
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.trackerOrphans).toEqual([]);
      expect(r.localOrphans).toEqual([]);
      expect(r.milestoneMismatches).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: clean-sync → empty orphan lists", () => {
  test("tracker IDs match local files + milestones match → no drift", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFR(specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, { milestone: "M70" });
      writeFR(specsDir, "STE-2.md", { key: "linear", id: "STE-2" }, { milestone: "M70" });
      writePlan(specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-1", "STE-2"], [{ name: "M70" }]);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.trackerOrphans).toEqual([]);
      expect(r.localOrphans).toEqual([]);
      expect(r.milestoneMismatches).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: tracker-orphan kind (tracker has FR; local does not)", () => {
  test("tracker carries STE-99; local frs/ is empty → 1 trackerOrphan", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubTrackerProvider(["STE-99"], []);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.trackerOrphans).toHaveLength(1);
      const o = r.trackerOrphans[0]!;
      expect(o.kind).toBe("tracker-orphan");
      expect(o.id).toBe("STE-99");
      expect(typeof o.details).toBe("string");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: local-orphan kind (local file with no tracker binding)", () => {
  test("local FR carries empty tracker block → 1 localOrphan", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFR(specsDir, "STRAY.md", null, { milestone: "M70" });
      writePlan(specsDir, "M70");
      const provider = new StubTrackerProvider([], [{ name: "M70" }]);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.localOrphans).toHaveLength(1);
      const o = r.localOrphans[0]!;
      expect(o.kind).toBe("local-orphan");
      expect(typeof o.id).toBe("string");
      expect(typeof o.details).toBe("string");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: milestone-mismatch kind", () => {
  test("tracker milestone M99 with no local plan file → 1 milestoneMismatch", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubTrackerProvider([], [{ name: "M99" }]);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.milestoneMismatches).toHaveLength(1);
      const m = r.milestoneMismatches[0]!;
      expect(m.kind).toBe("milestone-mismatch");
      expect(m.id).toBe("M99");
      expect(typeof m.details).toBe("string");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("local plan M88 with no tracker milestone → 1 milestoneMismatch", async () => {
    const specsDir = makeSpecsDir();
    try {
      writePlan(specsDir, "M88");
      const provider = new StubTrackerProvider([], []);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.milestoneMismatches).toHaveLength(1);
      const m = r.milestoneMismatches[0]!;
      expect(m.kind).toBe("milestone-mismatch");
      expect(m.id).toBe("M88");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: archived/* files are excluded from orphan computation", () => {
  test("local archived FR with no tracker binding is NOT reported", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFR(specsDir, "STE-OLD.md", null, { archive: true, milestone: "M1" });
      writePlan(specsDir, "M1", { archive: true });
      const provider = new StubTrackerProvider([], []);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.trackerOrphans).toEqual([]);
      expect(r.localOrphans).toEqual([]);
      expect(r.milestoneMismatches).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-284.2: 2026-05-13 partial-scan reproduction (canonical case)", () => {
  test("M70 + STE-280/281/282 on tracker, local empty → 3 trackerOrphans + 1 milestoneMismatch", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubTrackerProvider(
        ["STE-280", "STE-281", "STE-282"],
        [{ name: "M70" }],
      );
      const r = await reconcileTrackerLocal(provider, specsDir);
      // Three tracker-orphan FRs (one per ID).
      expect(r.trackerOrphans).toHaveLength(3);
      const ids = r.trackerOrphans.map((o) => o.id).sort();
      expect(ids).toEqual(["STE-280", "STE-281", "STE-282"]);
      for (const o of r.trackerOrphans) {
        expect(o.kind).toBe("tracker-orphan");
      }
      // No local files → zero local-orphans.
      expect(r.localOrphans).toEqual([]);
      // One milestone-mismatch: tracker has M70, local plan/ is empty.
      expect(r.milestoneMismatches).toHaveLength(1);
      expect(r.milestoneMismatches[0]!.id).toBe("M70");
      expect(r.milestoneMismatches[0]!.kind).toBe("milestone-mismatch");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("STE-376 union grammar — epic-keyed milestones reconcile", () => {
  test("M_PROJ_500 present on both sides → no mismatch", async () => {
    const specsDir = makeSpecsDir();
    try {
      writePlan(specsDir, "M_PROJ_500");
      const provider = new StubTrackerProvider([], [{ name: "M_PROJ_500" }]);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.milestoneMismatches).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("tracker-only epic milestone surfaces as a mismatch (not silently dropped)", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubTrackerProvider([], [{ name: "M_PROJ_500" }]);
      const r = await reconcileTrackerLocal(provider, specsDir);
      expect(r.milestoneMismatches).toHaveLength(1);
      expect(r.milestoneMismatches[0]!.id).toBe("M_PROJ_500");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

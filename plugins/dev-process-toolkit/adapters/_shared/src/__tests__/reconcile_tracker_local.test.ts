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

// ---------------------------------------------------------------------------
// M_a85e46 / STE-652 (C-RECON) — `{ shared: true }`: a tracker milestone no
// local FR or plan claims is a sibling repository's. It is listed in
// `skippedMilestones`, never reported as a mismatch. A CLAIMED milestone is
// graded against active ∪ archived plans. The local-plan direction and the
// unshared output are untouched.
//
// Fixture (listMilestones):
//   M_GF_98 — active local plan                         → graded, matches
//   M_GF_92 — no FR, no plan anywhere                   → SKIPPED (sibling's)
//   M_GF_50 — archived FR names it + plan/archive/      → claimed, archived plan ⇒ not reported
//   M_GF_51 — active FR names it, no plan anywhere      → REPORTED (control)
//   M_GF_52 — ARCHIVED FR names it, no plan anywhere    → REPORTED (archived FR is a claim)
//   M_GF_60 — only plan/archive/M_GF_60.md, no FR       → claimed by its plan ⇒ not reported
// Local side: plan/M_GF_77.md with no tracker milestone → REPORTED (control)
// ---------------------------------------------------------------------------

function writeSharedFixture(specsDir: string): void {
  writePlan(specsDir, "M_GF_98");
  writeFR(specsDir, "GF-98.md", { key: "jira", id: "GF-98" }, { milestone: "M_GF_98" });
  writeFR(specsDir, "GF-50.md", { key: "jira", id: "GF-50" }, { archive: true, milestone: "M_GF_50" });
  writePlan(specsDir, "M_GF_50", { archive: true });
  writeFR(specsDir, "GF-51.md", { key: "jira", id: "GF-51" }, { milestone: "M_GF_51" });
  writeFR(specsDir, "GF-52.md", { key: "jira", id: "GF-52" }, { archive: true, milestone: "M_GF_52" });
  writePlan(specsDir, "M_GF_60", { archive: true });
  writePlan(specsDir, "M_GF_77");
}

const SHARED_TRACKER_MILESTONES = [
  { name: "M_GF_98" },
  { name: "M_GF_92" },
  { name: "M_GF_50" },
  { name: "M_GF_51" },
  { name: "M_GF_52" },
  { name: "M_GF_60" },
];
const SHARED_ACTIVE_FRS = ["GF-98", "GF-51"];

function trackerSide(r: { milestoneMismatches: { id: string; side: string }[] }): string[] {
  return r.milestoneMismatches.filter((m) => m.side === "tracker").map((m) => m.id).sort();
}

type SharedResult = Awaited<ReturnType<typeof reconcileTrackerLocal>> & { skippedMilestones?: string[] };

async function reconcileShared(specsDir: string): Promise<SharedResult> {
  const provider = new StubTrackerProvider(SHARED_ACTIVE_FRS, SHARED_TRACKER_MILESTONES);
  // `shared` is the option STE-652 adds to ReconcileOptions.
  return (await reconcileTrackerLocal(provider, specsDir, { shared: true })) as SharedResult;
}

describe("AC-STE-652.6 — shared: an unclaimed tracker milestone is skipped, not a mismatch", () => {
  test("AC-STE-652.6: M_GF_92 (no FR, no plan, active or archived) is in skippedMilestones and not reported", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeSharedFixture(specsDir);
      const r = await reconcileShared(specsDir);
      expect(r.milestoneMismatches.map((m) => m.id)).not.toContain("M_GF_92");
      // EXACT: claimed tokens are graded, never skipped — an always-skip
      // mutation (which would also drop M_GF_51/M_GF_52) goes red here.
      expect(r.skippedMilestones).toEqual(["M_GF_92"]);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.6: with EVERY tracker token unclaimed, all are skipped and none reported", async () => {
    const specsDir = makeSpecsDir();
    try {
      writePlan(specsDir, "M_GF_98");
      const provider = new StubTrackerProvider([], [{ name: "M_GF_98" }, { name: "M_GF_90" }, { name: "M_GF_91" }]);
      const r = (await reconcileTrackerLocal(provider, specsDir, { shared: true })) as SharedResult;
      expect(trackerSide(r)).toEqual([]);
      expect([...(r.skippedMilestones ?? [])].sort()).toEqual(["M_GF_90", "M_GF_91"]);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("AC-STE-652.7 — shared: a claimed milestone is graded against active ∪ archived plans", () => {
  test("AC-STE-652.7: claimed with no plan anywhere is REPORTED (M_GF_51 active FR, M_GF_52 archived FR); archived plan is NOT (M_GF_50, M_GF_60)", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeSharedFixture(specsDir);
      const r = await reconcileShared(specsDir);
      expect(trackerSide(r)).toEqual(["M_GF_51", "M_GF_52"]);
      // The reported row keeps its pinned wording (m117-ste-430).
      const row = r.milestoneMismatches.find((m) => m.id === "M_GF_51")!;
      expect(row).toEqual({
        kind: "milestone-mismatch",
        id: "M_GF_51",
        details: `Tracker milestone M_GF_51 has no local plan file at ${specsDir}/plan/M_GF_51.md.`,
        side: "tracker",
      });
      expect(r.skippedMilestones ?? []).not.toContain("M_GF_50");
      expect(r.skippedMilestones ?? []).not.toContain("M_GF_51");
      expect(r.skippedMilestones ?? []).not.toContain("M_GF_52");
      expect(r.skippedMilestones ?? []).not.toContain("M_GF_60");
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("AC-STE-652.8 — shared: the local-plan direction is unchanged", () => {
  test("AC-STE-652.8: local plan M_GF_77 with no tracker milestone is still reported (side local)", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeSharedFixture(specsDir);
      // Opposite-break leg (STE-652 audit): an ARCHIVED plan with no tracker
      // milestone is shipped history, never a local mismatch — a reader that
      // widened the local-plan direction to plan/archive/ would report it.
      writePlan(specsDir, "M_GF_70", { archive: true });
      const r = await reconcileShared(specsDir);
      const local = r.milestoneMismatches.filter((m) => m.side === "local");
      expect(local).toEqual([
        {
          kind: "milestone-mismatch",
          id: "M_GF_77",
          details: `Local plan ${specsDir}/plan/M_GF_77.md has no matching tracker milestone.`,
          side: "local",
        },
      ]);
      // Control: the shared option touched only milestone grading.
      expect(r.trackerOrphans).toEqual([]);
      expect(r.localOrphans).toEqual([]);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("AC-STE-652.9 — without the option the output is identical to HEAD", () => {
  test("AC-STE-652.9: the same fixture, option absent → HEAD's exact rows, no skippedMilestones field", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeSharedFixture(specsDir);
      const provider = new StubTrackerProvider(SHARED_ACTIVE_FRS, SHARED_TRACKER_MILESTONES);
      const r = await reconcileTrackerLocal(provider, specsDir);
      const tracker = (name: string) => ({
        kind: "milestone-mismatch",
        id: name,
        details: `Tracker milestone ${name} has no local plan file at ${specsDir}/plan/${name}.md.`,
        side: "tracker",
      });
      expect(r).toStrictEqual({
        trackerOrphans: [],
        localOrphans: [],
        milestoneMismatches: [
          tracker("M_GF_92"),
          tracker("M_GF_50"),
          tracker("M_GF_51"),
          tracker("M_GF_52"),
          tracker("M_GF_60"),
          {
            kind: "milestone-mismatch",
            id: "M_GF_77",
            details: `Local plan ${specsDir}/plan/M_GF_77.md has no matching tracker milestone.`,
            side: "local",
          },
        ],
      });
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.9: `{ shared: false }` is the unshared path too", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeSharedFixture(specsDir);
      const provider = new StubTrackerProvider(SHARED_ACTIVE_FRS, SHARED_TRACKER_MILESTONES);
      const absent = await reconcileTrackerLocal(provider, specsDir);
      const off = await reconcileTrackerLocal(provider, specsDir, { shared: false });
      expect(off).toStrictEqual(absent);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

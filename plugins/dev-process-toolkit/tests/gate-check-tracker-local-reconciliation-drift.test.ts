// STE-284 AC-STE-284.4 — `tracker_local_reconciliation_drift` probe.
//
// Three cases:
//   - clean-sync: no drift → severity = info / no violations
//   - drift-warning: any drift (orphans on either side, milestone mismatch)
//       → severity = warning, one note per drift row
//   - hard-collision-error: same tracker ID bound to two local files, OR
//       local FR pointing to non-existent tracker ID → severity = error
//
// The probe itself lives at
// `plugins/dev-process-toolkit/adapters/_shared/src/tracker_local_reconciliation_drift.ts`
// per AC-STE-324.5 (relocated from skills/gate-check/probes/ to the canonical
// adapters/_shared/src/ path matching 55 sibling probes); we import it from there.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerLocalReconciliationDriftProbe } from "../adapters/_shared/src/tracker_local_reconciliation_drift";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";

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
    return { id, title: "", milestone: "", status: "active", tracker: {}, inFlightBranch: null, assignee: null };
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

function makeProject(): { root: string; specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tracker-local-drift-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs"), { recursive: true });
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  return { root, specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeFR(specsDir: string, filename: string, tracker: { key: string; id: string } | null, milestone: string): void {
  const trackerBlock = tracker ? `tracker:\n  ${tracker.key}: ${tracker.id}\n` : "tracker: {}\n";
  const body = `---\ntitle: Test FR\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n${trackerBlock}created_at: 2026-05-13T00:00:00Z\n---\n\n# ${filename}\n`;
  writeFileSync(join(specsDir, "frs", filename), body);
}

function writePlan(specsDir: string, milestone: string): void {
  const body = `---\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n---\n\n# ${milestone} — Test plan\n`;
  writeFileSync(join(specsDir, "plan", `${milestone}.md`), body);
}

describe("AC-STE-284.4: clean-sync → no violations", () => {
  test("tracker IDs match local + milestones match → empty violations, no severity escalation", async () => {
    const ctx = makeProject();
    try {
      writeFR(ctx.specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, "M70");
      writeFR(ctx.specsDir, "STE-2.md", { key: "linear", id: "STE-2" }, "M70");
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-1", "STE-2"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations).toEqual([]);
      // No hard collision → severity must not be 'error'.
      expect(r.severity === "error").toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: drift → severity warning, ≥ 1 violation", () => {
  test("tracker-orphan STE-99 + missing local FR → warning with one note", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-99"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.severity).toBe("warning");
      // One of the violation notes should mention the orphan tracker ID.
      expect(r.violations.some((v) => v.note.includes("STE-99"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("milestone mismatch alone → severity warning", async () => {
    const ctx = makeProject();
    try {
      const provider = new StubTrackerProvider([], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.severity).toBe("warning");
      expect(r.violations.some((v) => v.note.includes("M70"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: hard collisions → severity error", () => {
  test("same tracker ID bound to two local files → error", async () => {
    const ctx = makeProject();
    try {
      // Two distinct local files both claim binding linear:STE-1.
      writeFR(ctx.specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, "M70");
      writeFR(ctx.specsDir, "DUPLICATE.md", { key: "linear", id: "STE-1" }, "M70");
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-1"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.severity).toBe("error");
      // The violation note must surface the duplicated tracker ID.
      expect(r.violations.some((v) => v.note.includes("STE-1"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("local FR points to non-existent tracker ID → error", async () => {
    const ctx = makeProject();
    try {
      writeFR(ctx.specsDir, "STE-GHOST.md", { key: "linear", id: "STE-9999" }, "M70");
      writePlan(ctx.specsDir, "M70");
      // Tracker has no FRs and no milestones matching → STE-9999 binding is dangling.
      const provider = new StubTrackerProvider([], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.severity).toBe("error");
      expect(r.violations.some((v) => v.note.includes("STE-9999"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: probe is registered in gate-check SKILL.md", () => {
  test("SKILL.md mentions `tracker_local_reconciliation_drift` probe by name", async () => {
    const skillPath = join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md");
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("tracker_local_reconciliation_drift");
  });
});

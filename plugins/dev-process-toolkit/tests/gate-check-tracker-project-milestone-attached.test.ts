// STE-118 AC-STE-118.6 — tracker-project-milestone-attached probe (#26).
//
// For each `status: active` FR with a tracker block:
//   1. Skip in mode: none.
//   2. Read FR's `milestone:` frontmatter.
//   3. Read matching `specs/plan/M<N>.md` heading; build canonical name.
//   4. Call `getIssue(<ticket-id>)`; assert
//      `projectMilestone.name === <canonical>`.
//   5. Hard-fail (NFR-10) when missing OR name mismatch.
//
// Vacuous on:
//   - mode: none
//   - archived FRs (immutable)
//   - active FRs without a `tracker:` block

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";

interface IssueState {
  id: string;
  projectMilestone?: { name: string } | null;
}

interface FixtureOpts {
  mode: "none" | "linear";
  workspaceBinding?: { team: string; project: string };
  active?: { id: string; milestone: string; trackerId?: string }[];
  archived?: { id: string; milestone: string; trackerId?: string }[];
  activePlans?: { n: number; heading: string }[];
  issues?: IssueState[];
}

function makeFixture(opts: FixtureOpts): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "milestone-attached-"));
  const specs = join(root, "specs");
  mkdirSync(join(specs, "frs"), { recursive: true });
  mkdirSync(join(specs, "frs", "archive"), { recursive: true });
  mkdirSync(join(specs, "plan"), { recursive: true });
  mkdirSync(join(specs, "plan", "archive"), { recursive: true });

  const taskTracking =
    opts.mode === "none"
      ? ""
      : opts.workspaceBinding
        ? `## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n### Linear\n\nteam: ${opts.workspaceBinding.team}\nproject: ${opts.workspaceBinding.project}\n`
        : "## Task Tracking\n\nmode: linear\nmcp_server: linear\n";
  writeFileSync(join(root, "CLAUDE.md"), `# Project\n\n${taskTracking}`);

  for (const fr of opts.active ?? []) {
    const trackerBlock = fr.trackerId ? `tracker:\n  linear: ${fr.trackerId}\n` : "tracker: {}\n";
    writeFileSync(
      join(specs, "frs", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: active\narchived_at: null\n${trackerBlock}created_at: 2026-04-27T00:00:00Z\n---\n\nbody\n`,
    );
  }
  for (const fr of opts.archived ?? []) {
    const trackerBlock = fr.trackerId ? `tracker:\n  linear: ${fr.trackerId}\n` : "tracker: {}\n";
    writeFileSync(
      join(specs, "frs", "archive", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: archived\narchived_at: 2026-04-25T00:00:00Z\n${trackerBlock}created_at: 2026-04-25T00:00:00Z\n---\n\nbody\n`,
    );
  }
  for (const plan of opts.activePlans ?? []) {
    writeFileSync(
      join(specs, "plan", `M${plan.n}.md`),
      `---\nmilestone: M${plan.n}\nstatus: active\n---\n\n# ${plan.heading}\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeIssueLookup(issues: IssueState[]) {
  return async (ticketId: string): Promise<{ projectMilestone?: { name: string } | null }> => {
    const found = issues.find((i) => i.id === ticketId);
    if (!found) return { projectMilestone: null };
    return { projectMilestone: found.projectMilestone ?? null };
  };
}

describe("vacuous: mode-none / archived / no tracker", () => {
  test("mode: none → vacuous pass", async () => {
    const fx = makeFixture({
      mode: "none",
      active: [{ id: "STE-1", milestone: "M1" }],
      activePlans: [{ n: 1, heading: "M1 — First milestone" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([]),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("archived FR → vacuous", async () => {
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      archived: [{ id: "STE-100", milestone: "M27", trackerId: "STE-100" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([]),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("active FR without tracker block → vacuous", async () => {
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      active: [{ id: "STE-1", milestone: "M31" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([]),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("happy path: ticket binding matches", () => {
  test("STE-117 → M31 with matching milestone → pass", async () => {
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
      issues: [{ id: "STE-117", projectMilestone: { name: "M31 — Tracker Workflow Hardening" } }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([
          { id: "STE-117", projectMilestone: { name: "M31 — Tracker Workflow Hardening" } },
        ]),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("hard fail: missing projectMilestone", () => {
  test("ticket has no milestone bound → fail with diagnostic", async () => {
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-117", projectMilestone: null }]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/STE-117/);
      expect(v.note).toMatch(/missing|not attached/i);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/probe=tracker_project_milestone_attached/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("hard fail: name mismatch", () => {
  test("local heading differs from tracker milestone name → fail rendering both", async () => {
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([
          { id: "STE-117", projectMilestone: { name: "M31 — Old name" } },
        ]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/STE-117/);
      expect(v.note).toMatch(/M31 — Tracker Workflow Hardening/);
      expect(v.note).toMatch(/M31 — Old name/);
      expect(v.message).toMatch(/--rename-milestone|rename/i);
    } finally {
      fx.cleanup();
    }
  });
});

describe("plan file missing: defer to probe #27", () => {
  test("active FR points at M99 (no plan file) → vacuous; orphan owned by probe #27", async () => {
    let getIssueCalls = 0;
    const fx = makeFixture({
      mode: "linear",
      workspaceBinding: { team: "STE", project: "DPT" },
      active: [{ id: "STE-200", milestone: "M99", trackerId: "STE-200" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: async () => {
          getIssueCalls++;
          return { projectMilestone: { name: "anything" } };
        },
      });
      // Probe #26 silently passes when the plan file is missing — the
      // orphan diagnostic is owned by probe #27. Assert: no violations
      // AND no MCP fetch was attempted (vacuous short-circuit).
      expect(r.violations).toEqual([]);
      expect(getIssueCalls).toBe(0);
    } finally {
      fx.cleanup();
    }
  });
});

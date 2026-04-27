// STE-118 AC-STE-118.3 — attachProjectMilestone shared helper.
//
// Wraps Linear MCP `list_milestones` / `save_milestone` / `save_issue` /
// `get_issue` to bind an issue to a project milestone matching the local
// plan-file heading. Idempotent: re-attaching an already-bound ticket is
// a no-op (same milestone), the helper still runs the verify round-trip.
//
// Signature:
//   attachProjectMilestone(provider, project, milestoneName, ticketId)
// where `provider` exposes:
//   - listMilestones(project): Promise<{ name: string }[]>
//   - saveMilestone(project, { name }): Promise<void>
//   - upsertTicketMetadata(ticketId, { milestone }): Promise<string>
//   - getIssue(ticketId): Promise<{ projectMilestone?: { name: string } | null }>
//
// Errors:
//   MilestoneAttachmentError thrown when the verify round-trip shows the
//   binding did not land (silent-no-op trap, NFR-10 canonical shape).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachProjectMilestone,
  MilestoneAttachmentError,
  planFileHeadingToMilestoneName,
} from "./attach_project_milestone";

interface Stub {
  milestones: { name: string }[];
  attached: string | null;
  forceFinalAttach?: string | null;
  calls: string[];
}

function makeProvider(stub: Stub) {
  return {
    async listMilestones(project: string): Promise<{ name: string }[]> {
      stub.calls.push(`listMilestones(${project})`);
      return [...stub.milestones];
    },
    async saveMilestone(project: string, opts: { name: string }): Promise<void> {
      stub.calls.push(`saveMilestone(${project},${opts.name})`);
      stub.milestones.push({ name: opts.name });
    },
    async upsertTicketMetadata(
      ticketId: string,
      meta: { milestone?: string },
    ): Promise<string> {
      stub.calls.push(`upsertTicketMetadata(${ticketId},${JSON.stringify(meta)})`);
      if (meta.milestone) stub.attached = meta.milestone;
      return ticketId;
    },
    async getIssue(ticketId: string): Promise<{ projectMilestone: { name: string } | null }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const name = stub.forceFinalAttach !== undefined ? stub.forceFinalAttach : stub.attached;
      return { projectMilestone: name ? { name } : null };
    },
  };
}

describe("happy path: milestone exists", () => {
  test("found-by-name → attach + verify, no save_milestone call", async () => {
    const stub: Stub = {
      milestones: [{ name: "M31 — Tracker Workflow Hardening" }],
      attached: null,
      calls: [],
    };
    const p = makeProvider(stub);
    await attachProjectMilestone(p, "DPT", "M31 — Tracker Workflow Hardening", "STE-117");
    expect(stub.calls).toContain("listMilestones(DPT)");
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
    expect(stub.calls).toContain('upsertTicketMetadata(STE-117,{"milestone":"M31 — Tracker Workflow Hardening"})');
    expect(stub.calls).toContain("getIssue(STE-117)");
    expect(stub.attached).toBe("M31 — Tracker Workflow Hardening");
  });
});

describe("happy path: milestone not found → save_milestone then attach", () => {
  test("create-on-miss flow", async () => {
    const stub: Stub = { milestones: [], attached: null, calls: [] };
    const p = makeProvider(stub);
    await attachProjectMilestone(p, "DPT", "M31 — New", "STE-117");
    expect(stub.calls.find((c) => c.startsWith("listMilestones"))).toBeDefined();
    expect(stub.calls).toContain("saveMilestone(DPT,M31 — New)");
    expect(stub.calls).toContain('upsertTicketMetadata(STE-117,{"milestone":"M31 — New"})');
  });
});

describe("silent no-op detection", () => {
  test("verify round-trip mismatch → MilestoneAttachmentError", async () => {
    const stub: Stub = {
      milestones: [{ name: "M31 — Tracker Workflow Hardening" }],
      attached: null,
      forceFinalAttach: null, // simulate save_issue silent no-op
      calls: [],
    };
    const p = makeProvider(stub);
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachProjectMilestone(p, "DPT", "M31 — Tracker Workflow Hardening", "STE-117");
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.expected).toBe("M31 — Tracker Workflow Hardening");
    expect(err!.actual).toBeNull();
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
  });

  test("verify shows wrong milestone bound → MilestoneAttachmentError naming both", async () => {
    const stub: Stub = {
      milestones: [{ name: "M31 — Tracker Workflow Hardening" }],
      attached: null,
      forceFinalAttach: "M30 — Stale doc references", // wrong binding
      calls: [],
    };
    const p = makeProvider(stub);
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachProjectMilestone(p, "DPT", "M31 — Tracker Workflow Hardening", "STE-117");
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.expected).toBe("M31 — Tracker Workflow Hardening");
    expect(err!.actual).toBe("M30 — Stale doc references");
  });
});

describe("idempotent: re-attach already-bound ticket", () => {
  test("ticket already at correct milestone → re-runs ops without throwing", async () => {
    const stub: Stub = {
      milestones: [{ name: "M31 — Tracker Workflow Hardening" }],
      attached: "M31 — Tracker Workflow Hardening", // already bound
      calls: [],
    };
    const p = makeProvider(stub);
    await attachProjectMilestone(p, "DPT", "M31 — Tracker Workflow Hardening", "STE-117");
    // Verify the attach call still fires (Linear no-ops on same milestone).
    expect(stub.calls).toContain('upsertTicketMetadata(STE-117,{"milestone":"M31 — Tracker Workflow Hardening"})');
    // Final state matches.
    expect(stub.attached).toBe("M31 — Tracker Workflow Hardening");
  });
});

describe("byte-equality match (em-dash safe)", () => {
  test("em-dash in milestone name matches literally", async () => {
    const target = "M27 — Dart/Python docs parity"; // U+2014 em-dash
    const stub: Stub = { milestones: [{ name: target }], attached: null, calls: [] };
    const p = makeProvider(stub);
    await attachProjectMilestone(p, "DPT", target, "STE-103");
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
    expect(stub.attached).toBe(target);
    // The byte at index 4 should be U+2014 (em-dash).
    expect(stub.attached!.charCodeAt(4)).toBe(0x2014);
  });

  test("hyphen-minus in name does NOT match em-dash milestone", async () => {
    const stub: Stub = {
      milestones: [{ name: "M31 — Tracker Workflow Hardening" }], // em-dash
      attached: null,
      calls: [],
    };
    const p = makeProvider(stub);
    // Caller passes hyphen-minus; helper must NOT match the em-dash entry.
    await attachProjectMilestone(p, "DPT", "M31 - Tracker Workflow Hardening", "STE-117");
    expect(stub.calls).toContain("saveMilestone(DPT,M31 - Tracker Workflow Hardening)");
  });
});

describe("planFileHeadingToMilestoneName (AC-STE-118.2)", () => {
  function makePlan(body: string): { path: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "plan-heading-"));
    const path = join(root, "M31.md");
    writeFileSync(path, body);
    return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("strips trailing {#M<N>} anchor", () => {
    const ctx = makePlan("---\nfm: 1\n---\n\n# M31 — Tracker Workflow Hardening {#M31}\n\nbody\n");
    try {
      expect(planFileHeadingToMilestoneName(ctx.path)).toBe("M31 — Tracker Workflow Hardening");
    } finally {
      ctx.cleanup();
    }
  });

  test("works without anchor", () => {
    const ctx = makePlan("# M30 — Stale doc references\n");
    try {
      expect(planFileHeadingToMilestoneName(ctx.path)).toBe("M30 — Stale doc references");
    } finally {
      ctx.cleanup();
    }
  });

  test("preserves em-dash byte-for-byte", () => {
    const ctx = makePlan("# M27 — Dart/Python docs parity {#M27}\n");
    try {
      const got = planFileHeadingToMilestoneName(ctx.path);
      expect(got).toBe("M27 — Dart/Python docs parity");
      expect(got.charCodeAt(4)).toBe(0x2014);
    } finally {
      ctx.cleanup();
    }
  });

  test("missing heading throws", () => {
    const ctx = makePlan("# Some other heading\n\n## Subhead\n");
    try {
      let err: Error | null = null;
      try {
        planFileHeadingToMilestoneName(ctx.path);
      } catch (e) {
        if (e instanceof Error) err = e;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/no recognizable H1 heading/);
    } finally {
      ctx.cleanup();
    }
  });
});

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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachProjectMilestone,
  MilestoneAttachmentError,
  milestoneLabel,
  planFileHeadingToMilestoneName,
} from "./attach_project_milestone";
// STE-362: namespace import so the retry-wrapper contract tests can probe
// exports that do not exist yet without a load-time named-import crash —
// a missing member reads as `undefined` and fails via assertion instead of
// taking the whole test file down with a SyntaxError.
import * as attachModule from "./attach_project_milestone";

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
    const result = await attachProjectMilestone(p, "DPT", "M31 — Tracker Workflow Hardening", "STE-117");
    expect(stub.calls).toContain("listMilestones(DPT)");
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
    expect(stub.calls).toContain('upsertTicketMetadata(STE-117,{"milestone":"M31 — Tracker Workflow Hardening"})');
    expect(stub.calls).toContain("getIssue(STE-117)");
    expect(stub.attached).toBe("M31 — Tracker Workflow Hardening");
    // STE-198 AC-STE-198.2: success against existing milestone returns capability:null
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
  });
});

describe("happy path: milestone not found → save_milestone then attach", () => {
  test("create-on-miss flow", async () => {
    const stub: Stub = { milestones: [], attached: null, calls: [] };
    const p = makeProvider(stub);
    const result = await attachProjectMilestone(p, "DPT", "M31 — New", "STE-117");
    expect(stub.calls.find((c) => c.startsWith("listMilestones"))).toBeDefined();
    expect(stub.calls).toContain("saveMilestone(DPT,M31 — New)");
    expect(stub.calls).toContain('upsertTicketMetadata(STE-117,{"milestone":"M31 — New"})');
    // STE-198 AC-STE-198.3: auto-create surfaces milestone_create_required
    expect(result.capability).toBe("milestone_create_required");
    expect(result.createdName).toBe("M31 — New");
  });
});

describe("STE-198 — capability split", () => {
  test("AC-STE-198.1 (b): supports('project_milestone') === false short-circuits", async () => {
    const stub: Stub = { milestones: [], attached: null, calls: [] };
    const p = makeProvider(stub);
    const noCap = { ...p, supports: (cap: string) => cap !== "project_milestone" };
    const result = await attachProjectMilestone(noCap, "DPT", "M2 — Feature", "JIRA-1");
    expect(result.capability).toBe("milestone_attach_skipped_adapter_limit");
    expect(result.createdName).toBeUndefined();
    // No list/save/upsert/get calls when adapter declares no capability.
    expect(stub.calls).toEqual([]);
  });

  test("AC-STE-198.3: supports('project_milestone') === true with empty list → auto-create", async () => {
    const stub: Stub = { milestones: [], attached: null, calls: [] };
    const p = makeProvider(stub);
    const withCap = { ...p, supports: (cap: string) => cap === "project_milestone" };
    const result = await attachProjectMilestone(withCap, "DPT", "M2 — Feature", "STE-198");
    expect(result.capability).toBe("milestone_create_required");
    expect(result.createdName).toBe("M2 — Feature");
    expect(stub.calls).toContain("saveMilestone(DPT,M2 — Feature)");
  });

  test("backwards-compat: missing supports() defaults to enabled", async () => {
    const stub: Stub = { milestones: [{ name: "M2 — Feature" }], attached: null, calls: [] };
    const p = makeProvider(stub); // no `supports` method
    const result = await attachProjectMilestone(p, "DPT", "M2 — Feature", "STE-198");
    // Existing milestone match → capability:null (no save_milestone, no row).
    expect(result.capability).toBeNull();
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
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
      // STE-335 AC-STE-335.2: the error noun broadened from "H1 heading" to
      // "milestone heading" now that planFileHeadingToMilestoneName accepts H1/H2.
      expect(err!.message).toMatch(/no recognizable milestone heading/);
    } finally {
      ctx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-329 — Jira `label` milestone-binding path.
//
// The Jira adapter declares `milestone_binding: label`: instead of binding a
// projectMilestone OBJECT (Linear), it mirrors the milestone M-token onto the
// issue as a hyphen label `milestone-<M-token>`, attached read-merge-write and
// verified by read-back. The Linear `object` branch above stays byte-identical.
// ───────────────────────────────────────────────────────────────────────

describe("STE-329 AC-STE-329.2 — milestoneLabel: M-token → label derivation", () => {
  test("leading M\\d+ of the canonical name becomes `milestone-M<N>`", () => {
    expect(milestoneLabel("M86 — Jira Project-Milestone Support")).toBe("milestone-M86");
  });

  test("anchor-stripped canonical name (no title) still derives the token", () => {
    // The canonical name passed in is already anchor-stripped per
    // planFileHeadingToMilestoneName; the label only needs the M-token.
    expect(milestoneLabel("M5 — x")).toBe("milestone-M5");
    expect(milestoneLabel("M120 — multi-digit milestone")).toBe("milestone-M120");
  });

  test("em-dash in the canonical name does not leak into the label (token only)", () => {
    // The full name carries a U+2014 em-dash + spaces; the label is
    // [A-Za-z0-9-] only (Jira labels forbid spaces).
    const label = milestoneLabel("M27 — Dart/Python docs parity");
    expect(label).toBe("milestone-M27");
    expect(label).not.toMatch(/\s/);
    expect(label).toMatch(/^[A-Za-z0-9-]+$/);
  });

  test("a name without a leading M-token throws (no silent empty label)", () => {
    let err: Error | null = null;
    try {
      milestoneLabel("Some milestone without an M-number");
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    expect(err).not.toBeNull();
  });
});

// Widened provider stub for the `label` branch. Models a Jira issue's label
// set plus a read-merge-write `addLabel` op. `milestoneBinding: "label"`
// selects the Jira verify path inside attachProjectMilestone.
interface LabelStub {
  labels: string[];
  // When set, the verify read-back returns these labels instead of the
  // live set — used to simulate a silent no-op (write landed nowhere).
  forceVerifyLabels?: string[];
  calls: string[];
}

function makeLabelProvider(stub: LabelStub) {
  return {
    milestoneBinding: "label" as const,
    // The label branch must NOT touch list/create — labels are
    // create-on-write. These throw so the test fails loudly if the branch
    // regresses into the object path.
    async listMilestones(): Promise<{ name: string }[]> {
      stub.calls.push("listMilestones");
      throw new Error("label branch must not call listMilestones");
    },
    async saveMilestone(): Promise<void> {
      stub.calls.push("saveMilestone");
      throw new Error("label branch must not call saveMilestone");
    },
    async upsertTicketMetadata(): Promise<string> {
      stub.calls.push("upsertTicketMetadata");
      throw new Error("label branch must not call upsertTicketMetadata for the milestone");
    },
    // Read-merge-write attach: union the requested label into the current
    // set (never clobber existing labels), idempotent on re-add.
    async addLabel(ticketId: string, label: string): Promise<void> {
      stub.calls.push(`addLabel(${ticketId},${label})`);
      if (!stub.labels.includes(label)) stub.labels.push(label);
    },
    async getIssue(
      ticketId: string,
    ): Promise<{ projectMilestone?: { name: string } | null; labels?: string[] }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const labels = stub.forceVerifyLabels !== undefined ? stub.forceVerifyLabels : stub.labels;
      return { projectMilestone: null, labels: [...labels] };
    },
  };
}

describe("STE-329 AC-STE-329.3 — read-merge-write attach preserves existing labels", () => {
  test("merge keeps default_labels / operator labels, adds milestone label", async () => {
    const stub: LabelStub = {
      labels: ["spec-driven", "operator-tag"], // pre-existing default_labels + operator label
      calls: [],
    };
    const p = makeLabelProvider(stub);
    await attachProjectMilestone(p, "DPT", "M86 — Jira Project-Milestone Support", "ABC-1");
    // Union: existing labels untouched, milestone label appended.
    expect(stub.labels).toContain("spec-driven");
    expect(stub.labels).toContain("operator-tag");
    expect(stub.labels).toContain("milestone-M86");
    // Never clobbered the existing set.
    expect(stub.labels.length).toBe(3);
    // Object-path ops must never fire on the label branch.
    expect(stub.calls.find((c) => c.startsWith("listMilestones"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("addLabel"))).toBeDefined();
  });

  test("idempotent: re-adding an existing milestone label is a no-op", async () => {
    const stub: LabelStub = {
      labels: ["spec-driven", "milestone-M86"], // already attached
      calls: [],
    };
    const p = makeLabelProvider(stub);
    await attachProjectMilestone(p, "DPT", "M86 — Jira Project-Milestone Support", "ABC-1");
    // No duplicate label; existing set unchanged.
    expect(stub.labels.filter((l) => l === "milestone-M86").length).toBe(1);
    expect(stub.labels).toContain("spec-driven");
    expect(stub.labels.length).toBe(2);
  });
});

describe("STE-329 AC-STE-329.4 — adapter-aware verify (label branch)", () => {
  test("label present after read-back → { capability: null }", async () => {
    const stub: LabelStub = { labels: ["spec-driven"], calls: [] };
    const p = makeLabelProvider(stub);
    const result = await attachProjectMilestone(
      p,
      "DPT",
      "M86 — Jira Project-Milestone Support",
      "ABC-1",
    );
    // Jira label-bind success: no milestone object created → capability null.
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    // Verify re-read happened.
    expect(stub.calls).toContain("getIssue(ABC-1)");
  });

  test("label absent after read-back → MilestoneAttachmentError (silent no-op trap)", async () => {
    const stub: LabelStub = {
      labels: ["spec-driven"],
      // Simulate editJiraIssue silently dropping the write: verify read-back
      // returns the old set without the milestone label.
      forceVerifyLabels: ["spec-driven"],
      calls: [],
    };
    const p = makeLabelProvider(stub);
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachProjectMilestone(p, "DPT", "M86 — Jira Project-Milestone Support", "ABC-1");
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.expected).toBe("milestone-M86");
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
    // STE-329: the remedy must be Jira-appropriate, not the Linear default —
    // it points at the label/editJiraIssue path, never `save_issue`.
    expect(err!.binding).toBe("label");
    expect(err!.message).toContain("binding=label");
    expect(err!.message).toContain("editJiraIssue");
    expect(err!.message).not.toContain("save_issue");
  });

  test("read-back shows a different milestone label only → MilestoneAttachmentError", async () => {
    const stub: LabelStub = {
      labels: ["spec-driven"],
      // Wrong milestone label present, expected one absent.
      forceVerifyLabels: ["spec-driven", "milestone-M30"],
      calls: [],
    };
    const p = makeLabelProvider(stub);
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachProjectMilestone(p, "DPT", "M86 — Jira Project-Milestone Support", "ABC-1");
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.expected).toBe("milestone-M86");
  });

  test("capability short-circuit still honored on the label provider", async () => {
    // supports('project_milestone') === false must short-circuit even on a
    // label-binding provider (no label write attempted).
    const stub: LabelStub = { labels: ["spec-driven"], calls: [] };
    const p = makeLabelProvider(stub);
    const noCap = { ...p, supports: (cap: string) => cap !== "project_milestone" };
    const result = await attachProjectMilestone(
      noCap,
      "DPT",
      "M86 — Jira Project-Milestone Support",
      "ABC-1",
    );
    expect(result.capability).toBe("milestone_attach_skipped_adapter_limit");
    expect(stub.calls).toEqual([]);
    expect(stub.labels).toEqual(["spec-driven"]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-335 — plan-heading parser unification (write path).
//
// `planFileHeadingToMilestoneName` must delegate to the shared parser
// (adapters/_shared/src/plan_heading.ts) so it accepts the CURRENT plan
// format (`## M<N>: <title> {#M<N>}`, H2 + colon) emitted by the plan
// template and /spec-write, while still raising on a headingless plan and
// still parsing the LEGACY `# M<N> — <title>` (H1 + em-dash) form.
// ───────────────────────────────────────────────────────────────────────

describe("STE-335 — planFileHeadingToMilestoneName delegates to the shared parser", () => {
  function makePlan(body: string): { path: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "ste335-plan-"));
    const path = join(root, "M.md");
    writeFileSync(path, body);
    return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("AC-STE-335.2: current-format `## M<N>: <title> {#M<N>}` → `M<N> — <title>` (no throw)", () => {
    const ctx = makePlan(
      "---\nmilestone: M86\nstatus: active\n---\n\n## M86: Jira Project-Milestone Support {#M86}\n\nbody\n",
    );
    try {
      const got = planFileHeadingToMilestoneName(ctx.path);
      expect(got).toBe("M86 — Jira Project-Milestone Support");
      // Separator normalized to U+2014 em-dash even though source used a colon.
      expect(got.charCodeAt(4)).toBe(0x2014);
    } finally {
      ctx.cleanup();
    }
  });

  test("AC-STE-335.2: current-format `## M<N>: <title>` without anchor → canonical", () => {
    const ctx = makePlan("## M87: Plan-heading parser unification\n");
    try {
      expect(planFileHeadingToMilestoneName(ctx.path)).toBe(
        "M87 — Plan-heading parser unification",
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("AC-STE-335.2: headingless plan still throws", () => {
    const ctx = makePlan("# Some other heading\n\n## Subhead\n\nno milestone here\n");
    try {
      let err: Error | null = null;
      try {
        planFileHeadingToMilestoneName(ctx.path);
      } catch (e) {
        if (e instanceof Error) err = e;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/no recognizable/i);
    } finally {
      ctx.cleanup();
    }
  });

  test("AC-STE-335.6: legacy `# M<N> — <title>` (H1+em-dash) → identical canonical name", () => {
    const ctx = makePlan("# M31 — Tracker Workflow Hardening {#M31}\n");
    try {
      const got = planFileHeadingToMilestoneName(ctx.path);
      expect(got).toBe("M31 — Tracker Workflow Hardening");
      expect(got.charCodeAt(4)).toBe(0x2014);
    } finally {
      ctx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-335 AC-STE-335.7 — repo-wide audit: no other live copy of the
// `^# (M\d+ — …)` heading regex. The two known copies
// (attach_project_milestone.ts PLAN_HEADING_REGEX, tracker_project_milestone_attached.ts
// HEADING_RE) must be removed in favor of the shared parser, so only
// plan_heading.ts defines the matcher.
// ───────────────────────────────────────────────────────────────────────

describe("STE-335 AC-STE-335.7 — single live copy of the heading regex", () => {
  // The defunct H1-only literal both old copies declared. After the fix it
  // must appear in NEITHER source file (they delegate to the shared parser).
  const LEGACY_REGEX_LITERAL = "/^# (M\\d+ — ";

  test("attach_project_milestone.ts no longer declares the H1-only heading regex", () => {
    const src = readFileSync(join(import.meta.dir, "attach_project_milestone.ts"), "utf-8");
    expect(src).not.toContain(LEGACY_REGEX_LITERAL);
    // It must instead import the shared parser.
    expect(src).toMatch(/parsePlanHeading/);
    expect(src).toMatch(/\.\/plan_heading/);
  });

  test("tracker_project_milestone_attached.ts no longer declares the H1-only heading regex", () => {
    const src = readFileSync(
      join(import.meta.dir, "tracker_project_milestone_attached.ts"),
      "utf-8",
    );
    expect(src).not.toContain(LEGACY_REGEX_LITERAL);
    expect(src).toMatch(/parsePlanHeading/);
    expect(src).toMatch(/\.\/plan_heading/);
  });

  test("plan_heading.ts is the sole module defining the heading matcher", () => {
    const parser = readFileSync(join(import.meta.dir, "plan_heading.ts"), "utf-8");
    // The shared module must declare a heading regex anchored at start-of-line
    // accepting one or two `#` and composing the M-token from the shared
    // union source — since STE-376 the numeric `M\d+` leaf lives in
    // milestone_token.ts, the single live copy.
    expect(parser).toMatch(/#\{1,2\}/);
    expect(parser).toMatch(/MILESTONE_TOKEN_SOURCE/);
    expect(parser).toMatch(/\.\/milestone_token/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-362 — transient-only retry wrapper around the attach + read-back
// verify round-trip (AC-STE-362.1) + vacuity guarantees (AC-STE-362.4).
//
// Contract under test (M97):
//   - attachProjectMilestone grows an optional 5th options param:
//       attachProjectMilestone(provider, project, name, ticketId, { sleep })
//     `sleep(ms)` is the injected wait the backoff schedule awaits — tests
//     inject a recorder so no real time passes.
//   - A transient/network failure (Gateway-Timeout / 504 / connection reset /
//     equivalent) retries the WHOLE attach + read-back-verify round-trip on
//     the canonical `1s + 2s + 4s` schedule: the no-wait fast-path attempt
//     first, then up to 3 backoff attempts — the upsertTicketMetadata
//     idempotency-retry shape from adapters/jira.md (fast path, then three
//     backoff attempts waiting 1s / 2s / 4s; cumulative ~7s on the failure
//     path only).
//   - The schedule is exported as TRANSIENT_RETRY_SCHEDULE_MS =
//     [1000, 2000, 4000] — one shared constant, no duplicated schedule.
//   - A non-transient MilestoneAttachmentError (binding mismatch — the write
//     landed but the read-back disagrees) NEVER retries: single round-trip,
//     zero sleeps, immediate surface. Retrying a mismatch would mask a real
//     config bug (e.g., forwarding a milestone ID instead of a name).
//   - The success path adds no latency: zero sleep calls, exactly one
//     attach + one verify.
//   - supports("project_milestone") === false still short-circuits before
//     any call — the wrapper never fires (AC-STE-362.4 vacuity).
// ───────────────────────────────────────────────────────────────────────

type AttachOpts = { sleep?: (ms: number) => Promise<void> };

// Typed alias pinning the widened signature. The cast keeps this file
// compiling against the pre-wrapper 4-param signature; at runtime the extra
// argument is simply ignored by the old implementation, so the retry tests
// fail RED via assertions (propagated transient error / empty sleep log),
// not via a TypeError.
const attachWithOpts = attachProjectMilestone as unknown as (
  provider: Parameters<typeof attachProjectMilestone>[0],
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: AttachOpts,
) => ReturnType<typeof attachProjectMilestone>;

function exportedSchedule(): unknown {
  return (attachModule as Record<string, unknown>)["TRANSIENT_RETRY_SCHEDULE_MS"];
}

function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

function countCalls(calls: string[], prefix: string): number {
  return calls.filter((c) => c.startsWith(prefix)).length;
}

// Object-branch (Linear) provider with fault injection: each queued error is
// thrown by the corresponding op exactly once (FIFO), then the op behaves
// like the plain stub — modeling a transient failure that clears on retry.
interface FlakyStub {
  milestones: { name: string }[];
  attached: string | null;
  forceFinalAttach?: string | null;
  calls: string[];
  upsertErrors: Error[];
  getIssueErrors: Error[];
}

function makeFlakyProvider(stub: FlakyStub) {
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
      stub.calls.push(`upsertTicketMetadata(${ticketId})`);
      const err = stub.upsertErrors.shift();
      if (err) throw err;
      if (meta.milestone) stub.attached = meta.milestone;
      return ticketId;
    },
    async getIssue(ticketId: string): Promise<{ projectMilestone: { name: string } | null }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const err = stub.getIssueErrors.shift();
      if (err) throw err;
      const name = stub.forceFinalAttach !== undefined ? stub.forceFinalAttach : stub.attached;
      return { projectMilestone: name ? { name } : null };
    },
  };
}

// Label-branch (Jira) provider with fault injection on addLabel.
interface FlakyLabelStub {
  labels: string[];
  forceVerifyLabels?: string[];
  calls: string[];
  addLabelErrors: Error[];
}

function makeFlakyLabelProvider(stub: FlakyLabelStub) {
  return {
    milestoneBinding: "label" as const,
    async listMilestones(): Promise<{ name: string }[]> {
      stub.calls.push("listMilestones");
      throw new Error("label branch must not call listMilestones");
    },
    async saveMilestone(): Promise<void> {
      stub.calls.push("saveMilestone");
      throw new Error("label branch must not call saveMilestone");
    },
    async upsertTicketMetadata(): Promise<string> {
      stub.calls.push("upsertTicketMetadata");
      throw new Error("label branch must not call upsertTicketMetadata for the milestone");
    },
    async addLabel(ticketId: string, label: string): Promise<void> {
      stub.calls.push(`addLabel(${ticketId},${label})`);
      const err = stub.addLabelErrors.shift();
      if (err) throw err;
      if (!stub.labels.includes(label)) stub.labels.push(label);
    },
    async getIssue(
      ticketId: string,
    ): Promise<{ projectMilestone?: { name: string } | null; labels?: string[] }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const labels = stub.forceVerifyLabels !== undefined ? stub.forceVerifyLabels : stub.labels;
      return { projectMilestone: null, labels: [...labels] };
    },
  };
}

describe("STE-362 AC-STE-362.1 — transient-only retry wrapper (object branch)", () => {
  const NAME = "M97 — Milestone-label coverage";

  test("canonical 1s/2s/4s backoff schedule is exported as a shared constant", () => {
    // Shared shape with the upsertTicketMetadata idempotency retry — one
    // exported constant, not a second hand-rolled schedule.
    expect(exportedSchedule()).toEqual([1000, 2000, 4000]);
  });

  test("504 on attach → one 1s backoff, retry succeeds, verify lands", async () => {
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      calls: [],
      upsertErrors: [new Error("504 Gateway Timeout")],
      getIssueErrors: [],
    };
    const rec = sleepRecorder();
    const result = await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    // Exactly one backoff step fired (the 1s leg), then success.
    expect(rec.sleeps).toEqual([1000]);
    // Fast-path attempt + one retry attempt.
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(2);
    // Attempt 1 died at the attach, so only the retry reached the verify.
    expect(countCalls(stub.calls, "getIssue")).toBe(1);
    expect(stub.attached).toBe(NAME);
  });

  test("transient verify failure retries the WHOLE round-trip (attach re-runs too)", async () => {
    // Connection reset on the read-back: the write may not have landed —
    // the retry must re-run attach + verify, not just re-read.
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      calls: [],
      upsertErrors: [],
      getIssueErrors: [new Error("ECONNRESET: connection reset by peer")],
    };
    const rec = sleepRecorder();
    const result = await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([1000]);
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(2);
    expect(countCalls(stub.calls, "getIssue")).toBe(2);
  });

  test("two transient failures walk the schedule (1s then 2s) before succeeding", async () => {
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      calls: [],
      upsertErrors: [
        new Error("504 Gateway Timeout"),
        new Error("connect ETIMEDOUT 18.205.93.1:443"),
      ],
      getIssueErrors: [],
    };
    const rec = sleepRecorder();
    const result = await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([1000, 2000]);
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(3);
  });

  test("persistent transient failure exhausts 1s+2s+4s then surfaces the error", async () => {
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      calls: [],
      // Fast path + all 3 backoff attempts fail.
      upsertErrors: [
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
      ],
      getIssueErrors: [],
    };
    const rec = sleepRecorder();
    let err: Error | null = null;
    try {
      await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    expect(err).not.toBeNull();
    // The transient error surfaces (permanent failure), NOT a mismatch shape.
    expect(err).not.toBeInstanceOf(MilestoneAttachmentError);
    expect(err!.message).toMatch(/504|Gateway/i);
    // Full canonical schedule consumed: 1s + 2s + 4s.
    expect(rec.sleeps).toEqual([1000, 2000, 4000]);
    // Fast-path attempt + 3 backoff attempts = 4 round-trips.
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(4);
  });

  test("binding mismatch (MilestoneAttachmentError) does NOT retry — zero sleeps, single round-trip", async () => {
    // Non-transient: the write landed but the read-back disagrees. Retrying
    // would mask a real config bug — the error must surface immediately.
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      forceFinalAttach: null, // simulate the silent-no-op mismatch on every read
      calls: [],
      upsertErrors: [],
      getIssueErrors: [],
    };
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(rec.sleeps).toEqual([]);
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(1);
    expect(countCalls(stub.calls, "getIssue")).toBe(1);
  });

  test("clean success adds no latency — zero sleeps, exactly one attach + one verify", async () => {
    const stub: FlakyStub = {
      milestones: [{ name: NAME }],
      attached: null,
      calls: [],
      upsertErrors: [],
      getIssueErrors: [],
    };
    const rec = sleepRecorder();
    const result = await attachWithOpts(makeFlakyProvider(stub), "DPT", NAME, "STE-362", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([]);
    expect(countCalls(stub.calls, "upsertTicketMetadata")).toBe(1);
    expect(countCalls(stub.calls, "getIssue")).toBe(1);
  });
});

describe("STE-362 AC-STE-362.1 — retry wrapper covers the label branch (Jira)", () => {
  const NAME = "M97 — Milestone-label coverage";

  test("connection reset on addLabel → 1s backoff, retry lands the label", async () => {
    const stub: FlakyLabelStub = {
      labels: ["spec-driven"],
      calls: [],
      addLabelErrors: [new Error("read ECONNRESET")],
    };
    const rec = sleepRecorder();
    const result = await attachWithOpts(makeFlakyLabelProvider(stub), "DPT", NAME, "GB-11", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([1000]);
    expect(countCalls(stub.calls, "addLabel")).toBe(2);
    // Attempt 1 died at addLabel, so only the retry reached the verify.
    expect(countCalls(stub.calls, "getIssue")).toBe(1);
    expect(stub.labels).toContain("milestone-M97");
    // Existing labels never clobbered across retries.
    expect(stub.labels).toContain("spec-driven");
  });

  test("label-verify mismatch does NOT retry — zero sleeps, single round-trip", async () => {
    const stub: FlakyLabelStub = {
      labels: ["spec-driven"],
      // Simulate editJiraIssue silently dropping the write on every read-back.
      forceVerifyLabels: ["spec-driven"],
      calls: [],
      addLabelErrors: [],
    };
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachWithOpts(makeFlakyLabelProvider(stub), "DPT", NAME, "GB-11", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.binding).toBe("label");
    expect(rec.sleeps).toEqual([]);
    expect(countCalls(stub.calls, "addLabel")).toBe(1);
    expect(countCalls(stub.calls, "getIssue")).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-375 — Jira `epic` milestone binding (M101).
//
// Contract under test: attachProjectMilestone accepts a THIRD binding,
// `milestoneBinding: "epic"`, alongside `"object"` (Linear) and `"label"`
// (Jira legacy). The epic branch:
//
//   1. (optional probe) `epicBindingAvailable(project): Promise<boolean>` —
//      the injected seam over `getJiraProjectIssueTypesMetadata` + the
//      parent-settability check. `false` ⇒ degrade to the `label` binding
//      and surface `milestone_epic_unsupported` (informational capability
//      row, never a throw). Absent ⇒ assume available (same posture as the
//      optional `supports` probe).
//   2. `listEpics(project): Promise<{ key: string; name: string }[]>` —
//      find-BEFORE-create: match by byte-equal canonical plan-heading name
//      (STE-118 discipline).
//   3. `createEpic(project, { name }): Promise<{ key: string }>` — only on
//      a find miss (`createJiraIssue issuetype=Epic` in jira.md prose);
//      surfaces `milestone_create_required` + `createdName` like the
//      object-branch auto-create.
//   4. Idempotency pre-check: `getIssue(ticketId)` now also exposes
//      `parent?: string | null`; when it already equals the Epic key the
//      attach is a NO-OP (no parent rewrite, no second Epic).
//   5. `setParent(ticketId, epicKey): Promise<void>` — the
//      `editJiraIssue additional_fields.parent` seam — then read-back
//      verify `parent === epicKey`; mismatch ⇒ MilestoneAttachmentError
//      with `binding: "epic"` (never retried); transient create/parent-set
//      failures retry the WHOLE round-trip on TRANSIENT_RETRY_SCHEDULE_MS.
//
// The epic branch NEVER scatters a `milestone-M<N>` label and never calls
// the object-path ops (listMilestones / saveMilestone /
// upsertTicketMetadata).
// ───────────────────────────────────────────────────────────────────────

const EPIC_NAME = "M101 — Jira milestone-as-Epic identity"; // U+2014 em-dash

type EpicAttachResult = { capability: string | null; createdName?: string };

// Cast keeps this file compiling against the pre-epic MilestoneOps type
// (binding union still "object" | "label"); at runtime the current
// implementation simply falls through to the object branch, so these tests
// fail RED via assertions, not TypeErrors (same pattern as attachWithOpts).
const attachEpic = attachProjectMilestone as unknown as (
  provider: unknown,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<EpicAttachResult>;

interface EpicStub {
  epics: { key: string; name: string }[];
  /** The FR Task's current parent Epic key (null = unparented). */
  parent: string | null;
  /** When set, read-backs return THIS parent instead of the live one —
   *  simulates a silent no-op / silently-dropped parent write. */
  forceVerifyParent?: string | null;
  labels: string[];
  calls: string[];
  /** Key minted for the next createEpic call. */
  nextEpicKey: string;
  createEpicErrors: Error[];
  setParentErrors: Error[];
  /** Landed-but-timed-out simulation: createEpic registers the Epic
   *  server-side BEFORE throwing its queued error. */
  createLandsBeforeThrow?: boolean;
  /** When defined, the provider exposes the epicBindingAvailable probe. */
  epicAvailable?: boolean;
}

function makeEpicProvider(stub: EpicStub) {
  const provider: Record<string, unknown> = {
    milestoneBinding: "epic" as const,
    async listEpics(project: string): Promise<{ key: string; name: string }[]> {
      stub.calls.push(`listEpics(${project})`);
      return stub.epics.map((e) => ({ ...e }));
    },
    async createEpic(project: string, opts: { name: string }): Promise<{ key: string }> {
      stub.calls.push(`createEpic(${project},${opts.name})`);
      const err = stub.createEpicErrors.shift();
      if (err) {
        if (stub.createLandsBeforeThrow) {
          stub.epics.push({ key: stub.nextEpicKey, name: opts.name });
        }
        throw err;
      }
      stub.epics.push({ key: stub.nextEpicKey, name: opts.name });
      return { key: stub.nextEpicKey };
    },
    async setParent(ticketId: string, epicKey: string): Promise<void> {
      stub.calls.push(`setParent(${ticketId},${epicKey})`);
      const err = stub.setParentErrors.shift();
      if (err) throw err;
      stub.parent = epicKey;
    },
    async getIssue(ticketId: string): Promise<{
      projectMilestone: { name: string } | null;
      parent: string | null;
      labels: string[];
    }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const parent =
        stub.forceVerifyParent !== undefined ? stub.forceVerifyParent : stub.parent;
      return { projectMilestone: null, parent, labels: [...stub.labels] };
    },
    // Present so the fallback leg CAN attach via label — and so the epic
    // branch's never-scatters-a-label claim is observable (the op exists
    // but must not fire on the epic path).
    async addLabel(ticketId: string, label: string): Promise<void> {
      stub.calls.push(`addLabel(${ticketId},${label})`);
      if (!stub.labels.includes(label)) stub.labels.push(label);
    },
    // Object-path ops must never fire on the epic branch — throw loudly.
    async listMilestones(): Promise<{ name: string }[]> {
      stub.calls.push("listMilestones");
      throw new Error("epic branch must not call listMilestones");
    },
    async saveMilestone(): Promise<void> {
      stub.calls.push("saveMilestone");
      throw new Error("epic branch must not call saveMilestone");
    },
    async upsertTicketMetadata(): Promise<string> {
      stub.calls.push("upsertTicketMetadata");
      throw new Error("epic branch must not call upsertTicketMetadata");
    },
  };
  if (stub.epicAvailable !== undefined) {
    provider["epicBindingAvailable"] = async (project: string): Promise<boolean> => {
      stub.calls.push(`epicBindingAvailable(${project})`);
      return stub.epicAvailable!;
    };
  }
  return provider;
}

function baseEpicStub(overrides: Partial<EpicStub> = {}): EpicStub {
  return {
    epics: [],
    parent: null,
    labels: [],
    calls: [],
    nextEpicKey: "DPT-500",
    createEpicErrors: [],
    setParentErrors: [],
    ...overrides,
  };
}

describe("STE-375 AC-STE-375.1 — epic binding: find-or-create + parent set", () => {
  test("existing Epic matched by canonical name → parent set to its key, no create, no sleeps", async () => {
    const stub = baseEpicStub({ epics: [{ key: "DPT-500", name: EPIC_NAME }] });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    // Find-before-create: the named Epic is reused, never re-created.
    expect(stub.calls.find((c) => c.startsWith("createEpic"))).toBeUndefined();
    expect(stub.epics.length).toBe(1);
    // The FR Task's parent is the Epic's key.
    expect(stub.calls).toContain("setParent(STE-375,DPT-500)");
    expect(stub.parent).toBe("DPT-500");
    // Read-back verify fired.
    expect(stub.calls).toContain("getIssue(STE-375)");
    // Success against an existing Epic → no capability row, no latency.
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
    // Object-path ops never fire on the epic branch.
    expect(stub.calls.find((c) => c.startsWith("listMilestones"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("saveMilestone"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("upsertTicketMetadata"))).toBeUndefined();
  });

  test("no Epic with the canonical name → create-on-miss, then parent set + capability row", async () => {
    const stub = baseEpicStub({ nextEpicKey: "DPT-501" });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    expect(stub.calls).toContain(`createEpic(DPT,${EPIC_NAME})`);
    expect(stub.epics).toEqual([{ key: "DPT-501", name: EPIC_NAME }]);
    expect(stub.parent).toBe("DPT-501");
    // Auto-create surfaces the same capability shape as the object branch.
    expect(result.capability).toBe("milestone_create_required");
    expect(result.createdName).toBe(EPIC_NAME);
    expect(rec.sleeps).toEqual([]);
  });

  test("the epic path never scatters a milestone-M<N> label", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      labels: ["spec-driven"],
    });
    const rec = sleepRecorder();
    await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    expect(stub.calls.find((c) => c.startsWith("addLabel"))).toBeUndefined();
    expect(stub.labels).toEqual(["spec-driven"]);
    expect(stub.labels).not.toContain("milestone-M101");
  });

  test("byte-equality name match: hyphen-minus name does NOT reuse the em-dash Epic", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }], // em-dash
      nextEpicKey: "DPT-502",
    });
    const rec = sleepRecorder();
    // Caller passes hyphen-minus; the em-dash Epic must NOT match (STE-118
    // byte-equality discipline), so a new Epic is created.
    await attachEpic(
      makeEpicProvider(stub),
      "DPT",
      "M101 - Jira milestone-as-Epic identity",
      "STE-375",
      { sleep: rec.sleep },
    );
    expect(
      stub.calls.find((c) => c.startsWith("createEpic(DPT,M101 - ")),
    ).toBeDefined();
    expect(stub.parent).toBe("DPT-502");
  });
});

describe("STE-375 AC-STE-375.2 — idempotent attach", () => {
  test("parent already equals the Epic key → no-op: no create, parent never rewritten", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      parent: "DPT-500", // already bound
    });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    // No second Epic, no parent rewrite.
    expect(stub.calls.find((c) => c.startsWith("createEpic"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("setParent"))).toBeUndefined();
    expect(stub.epics.length).toBe(1);
    expect(stub.parent).toBe("DPT-500");
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });

  test("re-running a successful attach creates nothing and rewrites nothing", async () => {
    const stub = baseEpicStub({ nextEpicKey: "DPT-503" });
    const rec = sleepRecorder();
    const p = makeEpicProvider(stub);
    // First run: create + parent-set.
    await attachEpic(p, "DPT", EPIC_NAME, "STE-375", { sleep: rec.sleep });
    expect(stub.parent).toBe("DPT-503");
    const createsAfterRun1 = countCalls(stub.calls, "createEpic");
    const parentSetsAfterRun1 = countCalls(stub.calls, "setParent");
    expect(createsAfterRun1).toBe(1);
    // Second run: full no-op — Epic reused (find-before-create), parent
    // untouched.
    const result = await attachEpic(p, "DPT", EPIC_NAME, "STE-375", { sleep: rec.sleep });
    expect(countCalls(stub.calls, "createEpic")).toBe(createsAfterRun1);
    expect(countCalls(stub.calls, "setParent")).toBe(parentSetsAfterRun1);
    expect(stub.epics.length).toBe(1);
    expect(result.capability).toBeNull();
  });
});

describe("STE-375 AC-STE-375.4 — Epic-absent fallback degrades to the label binding", () => {
  test("epicBindingAvailable:false → label attach + milestone_epic_unsupported row, no throw", async () => {
    const stub = baseEpicStub({
      labels: ["spec-driven"],
      epicAvailable: false,
    });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    // Informational capability row — surfaced, not raised.
    expect(result.capability).toBe("milestone_epic_unsupported");
    // The FR still attached via the legacy label path (read-merge-write union).
    expect(stub.labels).toContain("milestone-M101");
    expect(stub.labels).toContain("spec-driven");
    expect(stub.calls.find((c) => c.startsWith("addLabel"))).toBeDefined();
    // Label-path read-back verify still fires.
    expect(stub.calls).toContain("getIssue(STE-375)");
    // No Epic machinery on the degraded path.
    expect(stub.calls.find((c) => c.startsWith("createEpic"))).toBeUndefined();
    expect(stub.calls.find((c) => c.startsWith("setParent"))).toBeUndefined();
    expect(stub.parent).toBeNull();
  });
});

describe("STE-375 AC-STE-375.5 — read-back verify + epic error shape", () => {
  test("parent-set silently drops → MilestoneAttachmentError binding:'epic', never retried", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      forceVerifyParent: null, // write lands nowhere on every read-back
    });
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.binding).toBe("epic");
    // The read-back asserts on the Epic KEY, not the canonical name.
    expect(err!.expected).toBe("DPT-500");
    expect(err!.actual).toBeNull();
    // NFR-10 canonical shape + binding-aware remedy: the epic remedy talks
    // about the parent field, never the Linear save_issue path.
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
    expect(err!.message).toContain("binding=epic");
    expect(err!.message).toMatch(/parent/i);
    expect(err!.message).not.toContain("save_issue");
    // A binding mismatch is non-transient: zero sleeps, single parent-set.
    expect(rec.sleeps).toEqual([]);
    expect(countCalls(stub.calls, "setParent")).toBe(1);
  });

  test("read-back shows a DIFFERENT parent Epic → error names both keys", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      parent: "DPT-111",
      forceVerifyParent: "DPT-111", // rewrite silently dropped
    });
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.expected).toBe("DPT-500");
    expect(err!.actual).toBe("DPT-111");
    expect(err!.binding).toBe("epic");
  });

  test("transient 504 on parent-set → one 1s backoff, retry lands the parent", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      setParentErrors: [new Error("504 Gateway Timeout")],
    });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([1000]);
    expect(countCalls(stub.calls, "setParent")).toBe(2);
    expect(stub.parent).toBe("DPT-500");
  });

  test("persistent transient parent-set failure exhausts 1s+2s+4s then surfaces the error", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DPT-500", name: EPIC_NAME }],
      setParentErrors: [
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
      ],
    });
    const rec = sleepRecorder();
    let err: Error | null = null;
    try {
      await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
        sleep: rec.sleep,
      });
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    expect(err).not.toBeNull();
    // Permanent-transient surfaces the ORIGINAL error, not a mismatch shape.
    expect(err).not.toBeInstanceOf(MilestoneAttachmentError);
    expect(err!.message).toMatch(/504|Gateway/i);
    expect(rec.sleeps).toEqual([1000, 2000, 4000]);
  });

  test("transient failure on createEpic → retried on the canonical schedule, single Epic", async () => {
    const stub = baseEpicStub({
      nextEpicKey: "DPT-504",
      createEpicErrors: [new Error("read ECONNRESET")],
    });
    const rec = sleepRecorder();
    await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    expect(rec.sleeps).toEqual([1000]);
    expect(countCalls(stub.calls, "createEpic")).toBe(2);
    expect(stub.epics.length).toBe(1);
    expect(stub.parent).toBe("DPT-504");
  });

  test("landed-but-timed-out create: the retry re-runs find-before-create — no duplicate Epic", async () => {
    // The createEpic call registers the Epic server-side, then times out.
    // The retry must re-run the FIND leg first and reuse the landed Epic —
    // a blind re-create would mint a duplicate.
    const stub = baseEpicStub({
      nextEpicKey: "DPT-505",
      createEpicErrors: [new Error("504 Gateway Timeout")],
      createLandsBeforeThrow: true,
    });
    const rec = sleepRecorder();
    await attachEpic(makeEpicProvider(stub), "DPT", EPIC_NAME, "STE-375", {
      sleep: rec.sleep,
    });
    expect(rec.sleeps).toEqual([1000]);
    expect(countCalls(stub.calls, "createEpic")).toBe(1);
    expect(stub.epics.length).toBe(1);
    expect(stub.parent).toBe("DPT-505");
  });
});

describe("STE-362 AC-STE-362.4 — vacuity: short-circuits keep the wrapper inert", () => {
  test("supports:false short-circuits before the retry wrapper — zero calls, zero sleeps", async () => {
    // The wrapper must exist (exported canonical schedule) so this vacuity
    // claim is about the NEW retry wrapper, not the pre-wrapper status quo…
    expect(exportedSchedule()).toEqual([1000, 2000, 4000]);
    // …and yet stay fully inert on the capability short-circuit: ops primed
    // to throw transient errors are never reached, no backoff leg fires, no
    // extra tracker call is made.
    const stub: FlakyStub = {
      milestones: [],
      attached: null,
      calls: [],
      upsertErrors: [new Error("504 Gateway Timeout")],
      getIssueErrors: [new Error("504 Gateway Timeout")],
    };
    const rec = sleepRecorder();
    const p = makeFlakyProvider(stub);
    const noCap = { ...p, supports: (cap: string) => cap !== "project_milestone" };
    const result = await attachWithOpts(noCap, "DPT", "M97 — Milestone-label coverage", "JIRA-1", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBe("milestone_attach_skipped_adapter_limit");
    expect(stub.calls).toEqual([]);
    expect(rec.sleeps).toEqual([]);
  });
});

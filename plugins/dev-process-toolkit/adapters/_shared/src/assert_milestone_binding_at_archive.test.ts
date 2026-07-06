// STE-363 — archival-time milestone-label assertion (M97).
//
// Contract under test: `assertMilestoneBindingAtArchive(provider, project,
// frFile, deps)` from ./assert_milestone_binding_at_archive.
//
//   - `provider` is a MilestoneOps-shaped object (same surface as
//     attach_project_milestone.ts): getIssue / listMilestones / saveMilestone /
//     upsertTicketMetadata / addLabel? / supports? / milestoneBinding?.
//   - `project` is the tracker project name (threaded into
//     attachProjectMilestone on the miss path).
//   - `frFile` is the absolute path of the FR markdown being archived; the
//     helper reads its `milestone:` + `tracker:` frontmatter itself.
//   - `deps` carries `{ projectRoot, mode }` — projectRoot locates
//     `specs/plan/<milestone>.md`; `mode: "none"` is a vacuous case.
//
// Return shape (never throws on a refusal):
//   { outcome: "vacuous" }
//   { outcome: "asserted", token: "milestone_label_asserted_at_archive", detail }
//   { outcome: "refused",  token: "milestone_label_archive_refused",  detail }
//
// The binding predicate mirrors /gate-check probe #26
// (tracker_project_milestone_attached): `object` (Linear, default) ⇒
// projectMilestone.name byte-equals the canonical plan-heading name from
// planFileHeadingToMilestoneName; `label` (Jira) ⇒ `labels` contains
// `milestone-<M-token>`. On a miss the helper calls attachProjectMilestone
// ONCE (which carries the STE-362 transient retry) and re-verifies; a
// still-missing binding refuses with an NFR-10 canonical detail naming the
// ticket, the expected name/label, and the backfill remedy.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMilestoneBindingAtArchive } from "./assert_milestone_binding_at_archive";

const PLAN_HEADING = "## M31: Tracker Workflow Hardening {#M31}";
// planFileHeadingToMilestoneName normalizes the H2-colon form to em-dash.
const CANONICAL = "M31 — Tracker Workflow Hardening";
const LABEL = "milestone-M31";
const TICKET = "STE-901";

interface RepoOpts {
  /** FR frontmatter `milestone:` value (default M31). */
  milestone?: string;
  /** Verbatim tracker frontmatter block (default a linear binding to TICKET). */
  trackerBlock?: string;
}

function makeRepo(opts: RepoOpts = {}): { root: string; frPath: string } {
  const root = mkdtempSync(join(tmpdir(), "ste-363-"));
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const milestone = opts.milestone ?? "M31";
  const tracker = opts.trackerBlock ?? `tracker:\n  linear: ${TICKET}`;
  const frPath = join(root, "specs", "frs", `${TICKET}.md`);
  writeFileSync(
    frPath,
    `---\ntitle: Fixture FR\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n${tracker}\n---\n\n# ${TICKET}: Fixture\n`,
  );
  // The plan file is always M31.md — pointing the FR at M77 models the
  // missing-plan vacuity case without touching the fixture layout.
  writeFileSync(join(root, "specs", "plan", "M31.md"), `${PLAN_HEADING}\n\n- [x] task\n`);
  return { root, frPath };
}

interface Stub {
  milestones: { name: string }[];
  /** projectMilestone.name the ticket currently carries (object binding). */
  attached: string | null;
  /** labels the ticket currently carries (label binding). */
  labels: string[];
  /** When false, attach writes silently don't land (the GB-11 shape). */
  attachLands: boolean;
  calls: string[];
  milestoneBinding?: "object" | "label";
  supports?: (cap: string) => boolean;
}

function makeStub(overrides: Partial<Stub> = {}): Stub {
  return {
    milestones: [{ name: CANONICAL }],
    attached: null,
    labels: [],
    attachLands: true,
    calls: [],
    ...overrides,
  };
}

function makeProvider(stub: Stub) {
  return {
    milestoneBinding: stub.milestoneBinding,
    supports: stub.supports,
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
      stub.calls.push(`upsertTicketMetadata(${ticketId},${meta.milestone})`);
      if (stub.attachLands && meta.milestone) stub.attached = meta.milestone;
      return ticketId;
    },
    async addLabel(ticketId: string, label: string): Promise<void> {
      stub.calls.push(`addLabel(${ticketId},${label})`);
      if (stub.attachLands) stub.labels.push(label);
    },
    async getIssue(
      ticketId: string,
    ): Promise<{ projectMilestone: { name: string } | null; labels: string[] }> {
      stub.calls.push(`getIssue(${ticketId})`);
      return {
        projectMilestone: stub.attached ? { name: stub.attached } : null,
        labels: [...stub.labels],
      };
    },
  };
}

/** Calls that write toward (or enumerate for) an attach attempt. */
function attachSideCalls(stub: Stub): string[] {
  return stub.calls.filter((c) =>
    /^(upsertTicketMetadata|saveMilestone|addLabel|listMilestones)\(/.test(c),
  );
}

describe("AC-STE-363.1 — adapter-aware binding assertion at the archival boundary", () => {
  test("object binding present (byte-equal to plan heading) → asserted, zero attach calls", async () => {
    const { root, frPath } = makeRepo();
    const stub = makeStub({ attached: CANONICAL });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe("milestone_label_asserted_at_archive");
    expect(stub.calls).toContain(`getIssue(${TICKET})`);
    expect(attachSideCalls(stub)).toEqual([]);
  });

  test("object binding must byte-equal — hyphen-for-em-dash drift is NOT accepted as present", async () => {
    const { root, frPath } = makeRepo();
    // Same words, wrong dash: a lenient comparison would call this bound.
    const stub = makeStub({ attached: "M31 - Tracker Workflow Hardening" });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    // The drift routes through the attach path (which rebinds the canonical
    // name), so the fix is observable: an upsert fired and the ticket now
    // carries the canonical em-dash name.
    expect(stub.calls.some((c) => c.startsWith(`upsertTicketMetadata(${TICKET},`))).toBe(true);
    expect(stub.attached).toBe(CANONICAL);
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe("milestone_label_asserted_at_archive");
  });

  test("label binding present (labels ∋ milestone-<M-token>) → asserted, zero attach calls", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${TICKET}` });
    const stub = makeStub({
      milestoneBinding: "label",
      labels: ["backend", LABEL],
    });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DST", frPath, {
      projectRoot: root,
      mode: "jira",
    });
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe("milestone_label_asserted_at_archive");
    expect(stub.calls).toContain(`getIssue(${TICKET})`);
    expect(attachSideCalls(stub)).toEqual([]);
  });
});

describe("AC-STE-363.2 — attempt-then-refuse", () => {
  test("missing object binding, attach lands → asserted + milestone_label_asserted_at_archive, exactly one attach", async () => {
    const { root, frPath } = makeRepo();
    const stub = makeStub({ attached: null, attachLands: true });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe("milestone_label_asserted_at_archive");
    const upserts = stub.calls.filter((c) => c.startsWith("upsertTicketMetadata("));
    expect(upserts).toEqual([`upsertTicketMetadata(${TICKET},${CANONICAL})`]);
  });

  test("missing object binding, attach still missing → refused + NFR-10 detail (ticket, expected name, remedy)", async () => {
    const { root, frPath } = makeRepo();
    const stub = makeStub({ attached: null, attachLands: false });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe("milestone_label_archive_refused");
    // NFR-10 canonical shape: names the ticket, the expected milestone name,
    // and the remedy — including the backfill escape hatch.
    expect(res.detail).toContain(TICKET);
    expect(res.detail).toContain(CANONICAL);
    expect(res.detail).toMatch(/Remedy:/);
    expect(res.detail).toMatch(/Context:/);
    expect(res.detail).toContain("/spec-archive --backfill-milestone-labels");
    expect(res.detail).toContain("attach the milestone manually");
    // Attempted exactly once — no retry storm around a non-transient miss.
    const upserts = stub.calls.filter((c) => c.startsWith("upsertTicketMetadata("));
    expect(upserts).toHaveLength(1);
  });

  test("missing label binding, attach still missing → refused, detail names the expected label, one addLabel attempt", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${TICKET}` });
    const stub = makeStub({
      milestoneBinding: "label",
      labels: ["backend"],
      attachLands: false,
    });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DST", frPath, {
      projectRoot: root,
      mode: "jira",
    });
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe("milestone_label_archive_refused");
    expect(res.detail).toContain(TICKET);
    expect(res.detail).toContain(LABEL);
    expect(res.detail).toMatch(/Remedy:/);
    const adds = stub.calls.filter((c) => c.startsWith("addLabel("));
    expect(adds).toEqual([`addLabel(${TICKET},${LABEL})`]);
  });
});

describe("AC-STE-363.3 — FR-backed scope only", () => {
  test("fetches exactly the FR's bound ticket — no board enumeration, no other ids", async () => {
    const { root, frPath } = makeRepo();
    const stub = makeStub({ attached: CANONICAL });
    await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((c) => c === `getIssue(${TICKET})`)).toBe(true);
  });

  test("FR with an empty tracker block (`tracker: {}`) → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: "tracker: {}" });
    const stub = makeStub({ attached: CANONICAL });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("vacuous");
    expect(stub.calls).toEqual([]);
  });
});

describe("AC-STE-363.4 — vacuity (no fetch, no assertion, byte-identical archival)", () => {
  test("mode: none → vacuous, zero tracker calls, FR file untouched", async () => {
    const { root, frPath } = makeRepo();
    const before = readFileSync(frPath, "utf-8");
    const stub = makeStub({ attached: null });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "none",
    });
    expect(res.outcome).toBe("vacuous");
    expect(stub.calls).toEqual([]);
    expect(readFileSync(frPath, "utf-8")).toBe(before);
  });

  test("adapter with project_milestone: false → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeRepo();
    const stub = makeStub({
      attached: null,
      supports: (cap: string) => cap !== "project_milestone",
    });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("vacuous");
    expect(stub.calls).toEqual([]);
  });

  test("FR whose milestone: plan file is missing → vacuous, zero tracker calls (probe #27 owns the diagnostic)", async () => {
    const { root, frPath } = makeRepo({ milestone: "M77" }); // no specs/plan/M77.md
    const stub = makeStub({ attached: null });
    const res = await assertMilestoneBindingAtArchive(makeProvider(stub), "DPT", frPath, {
      projectRoot: root,
      mode: "linear",
    });
    expect(res.outcome).toBe("vacuous");
    expect(stub.calls).toEqual([]);
  });
});

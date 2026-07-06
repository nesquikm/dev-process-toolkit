// STE-364 — one-shot milestone-label backfill sweep (M97).
//
// Contract under test: `backfillMilestoneLabels(provider, project, specsDir,
// opts)` from ./backfill_milestone_labels.
//
//   - `provider` is a MilestoneOps-shaped object (same surface as
//     attach_project_milestone.ts): getIssue / listMilestones / saveMilestone /
//     upsertTicketMetadata / addLabel? / supports? / milestoneBinding?.
//   - `project` is the tracker project name (threaded into
//     attachProjectMilestone on the attach path).
//   - `specsDir` is the absolute path of the repo's `specs/` directory. The
//     sweep enumerates `<specsDir>/frs/*.md` AND `<specsDir>/frs/archive/*.md`,
//     keeping only FRs that carry BOTH a `tracker:` binding and `milestone:`
//     frontmatter (parseFrFrontmatter — shared with probe #26). The canonical
//     milestone name resolves via planFileHeadingToMilestoneName against
//     `<specsDir>/plan/<M>.md`, falling back to `<specsDir>/plan/archive/<M>.md`.
//   - `opts` is `{ mode: string; apply?: boolean }` — `mode: "none"` is a
//     vacuous case; `apply` defaults to FALSE (dry-run by default).
//
// Return shape — `{ backfilled, alreadyCorrect, failed }`:
//   - backfilled:     { ticketId, milestone }[] — attached this run. In a
//                     dry-run these are the INTENDED attaches (the preview
//                     `ticket → milestone` rows); no write fires.
//   - alreadyCorrect: { ticketId, milestone }[] — binding present, skipped.
//   - failed:         { ticketId, milestone, planFile, detail }[] — attach
//                     did not land; `planFile` is the plan file the FR maps
//                     to, `detail` carries the NFR-10 shape (Remedy line).
//
// The present/missing predicate is adapter-aware, mirroring STE-363:
// `object` (Linear, default) ⇒ projectMilestone.name byte-equals the
// canonical plan-heading name; `label` (Jira) ⇒ `labels` contains
// `milestone-<M-token>`. Best-effort per ticket: one failure is recorded
// and the sweep continues. FR-backed only: no board enumeration, ever.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillMilestoneLabels } from "./backfill_milestone_labels";

const PLAN_HEADING_M31 = "## M31: Tracker Workflow Hardening {#M31}";
// planFileHeadingToMilestoneName normalizes the H2-colon form to em-dash.
const CANONICAL_M31 = "M31 — Tracker Workflow Hardening";
const PLAN_HEADING_M30 = "## M30: Legacy Cleanup {#M30}";
const CANONICAL_M30 = "M30 — Legacy Cleanup";
const LABEL_M31 = "milestone-M31";

function makeRepo(): { root: string; specsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "ste-364-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  // M31 is an ACTIVE plan; M30 lives under plan/archive — the sweep must
  // resolve canonical names from BOTH locations.
  writeFileSync(join(specsDir, "plan", "M31.md"), `${PLAN_HEADING_M31}\n\n- [x] task\n`);
  writeFileSync(
    join(specsDir, "plan", "archive", "M30.md"),
    `${PLAN_HEADING_M30}\n\n- [x] task\n`,
  );
  return { root, specsDir };
}

interface FrOpts {
  /** `specs/frs` subdirectory: "" (active) or "archive". */
  dir?: "" | "archive";
  /** FR frontmatter `milestone:` value; null omits the line entirely. */
  milestone?: string | null;
  /** Verbatim tracker frontmatter block (default a linear binding). */
  trackerBlock?: string;
}

function writeFr(specsDir: string, name: string, opts: FrOpts = {}): string {
  const milestone = opts.milestone === undefined ? "M31" : opts.milestone;
  const milestoneLine = milestone === null ? "" : `milestone: ${milestone}\n`;
  const tracker = opts.trackerBlock ?? `tracker:\n  linear: ${name}`;
  const frPath = join(specsDir, "frs", opts.dir || "", `${name}.md`);
  writeFileSync(
    frPath,
    `---\ntitle: Fixture FR\n${milestoneLine}status: active\narchived_at: null\n${tracker}\n---\n\n# ${name}: Fixture\n`,
  );
  return frPath;
}

interface TicketState {
  /** projectMilestone.name the ticket currently carries (object binding). */
  attached: string | null;
  /** labels the ticket currently carries (label binding). */
  labels: string[];
  /** When false, attach writes silently don't land (the GB-11 shape). */
  attachLands: boolean;
}

interface Stub {
  milestones: { name: string }[];
  tickets: Record<string, Partial<TicketState>>;
  calls: string[];
  milestoneBinding?: "object" | "label";
  supports?: (cap: string) => boolean;
}

function makeStub(overrides: Partial<Stub> = {}): Stub {
  return {
    milestones: [{ name: CANONICAL_M31 }, { name: CANONICAL_M30 }],
    tickets: {},
    calls: [],
    ...overrides,
  };
}

function ticketState(stub: Stub, ticketId: string): TicketState {
  const t = (stub.tickets[ticketId] ??= {});
  t.attached ??= null;
  t.labels ??= [];
  t.attachLands ??= true;
  return t as TicketState;
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
      const t = ticketState(stub, ticketId);
      if (t.attachLands && meta.milestone) t.attached = meta.milestone;
      return ticketId;
    },
    async addLabel(ticketId: string, label: string): Promise<void> {
      stub.calls.push(`addLabel(${ticketId},${label})`);
      const t = ticketState(stub, ticketId);
      if (t.attachLands) t.labels.push(label);
    },
    async getIssue(
      ticketId: string,
    ): Promise<{ projectMilestone: { name: string } | null; labels: string[] }> {
      stub.calls.push(`getIssue(${ticketId})`);
      const t = ticketState(stub, ticketId);
      return {
        projectMilestone: t.attached ? { name: t.attached } : null,
        labels: [...t.labels],
      };
    },
  };
}

/** Calls that WRITE to the tracker (an attach that landed or tried to). */
function writeCalls(calls: string[]): string[] {
  return calls.filter((c) => /^(upsertTicketMetadata|saveMilestone|addLabel)\(/.test(c));
}

function ids(entries: { ticketId: string }[]): string[] {
  return entries.map((e) => e.ticketId).sort();
}

describe("AC-STE-364.1 — backfill sweep over active + archived FRs", () => {
  test("scans specs/frs/ AND specs/frs/archive/; canonical names resolve from active AND archived plan files; --apply attaches the missing", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901", { milestone: "M31" });
    writeFr(specsDir, "STE-810", { dir: "archive", milestone: "M30" });
    const stub = makeStub(); // both tickets start with no binding
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(res.backfilled)).toEqual(["STE-810", "STE-901"]);
    expect(res.backfilled.find((b) => b.ticketId === "STE-901")?.milestone).toBe(CANONICAL_M31);
    expect(res.backfilled.find((b) => b.ticketId === "STE-810")?.milestone).toBe(CANONICAL_M30);
    expect(res.alreadyCorrect).toEqual([]);
    expect(res.failed).toEqual([]);
    // The attaches actually landed with the plan-heading canonical names.
    expect(stub.tickets["STE-901"]?.attached).toBe(CANONICAL_M31);
    expect(stub.tickets["STE-810"]?.attached).toBe(CANONICAL_M30);
  });

  test("label-binding adapter: missing milestone-<M-token> label is attached via addLabel", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "GB-11", {
      dir: "archive",
      milestone: "M31",
      trackerBlock: "tracker:\n  jira: GB-11",
    });
    const stub = makeStub({
      milestoneBinding: "label",
      tickets: { "GB-11": { labels: ["backend"] } },
    });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DST", specsDir, {
      mode: "jira",
      apply: true,
    });
    expect(ids(res.backfilled)).toEqual(["GB-11"]);
    expect(res.backfilled[0]?.milestone).toBe(CANONICAL_M31);
    expect(stub.calls).toContain(`addLabel(GB-11,${LABEL_M31})`);
    expect(stub.tickets["GB-11"]?.labels).toContain(LABEL_M31);
    // Read-merge-write: the pre-existing label survives.
    expect(stub.tickets["GB-11"]?.labels).toContain("backend");
  });

  test("label-binding adapter: labels ∋ milestone-<M-token> counts as present — skipped, zero writes", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "GB-10", {
      milestone: "M31",
      trackerBlock: "tracker:\n  jira: GB-10",
    });
    const stub = makeStub({
      milestoneBinding: "label",
      tickets: { "GB-10": { labels: ["backend", LABEL_M31] } },
    });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DST", specsDir, {
      mode: "jira",
      apply: true,
    });
    expect(ids(res.alreadyCorrect)).toEqual(["GB-10"]);
    expect(res.backfilled).toEqual([]);
    expect(writeCalls(stub.calls)).toEqual([]);
  });
});

describe("AC-STE-364.2 — idempotent + dry-run default", () => {
  test("dry-run by default: intended changes listed as `ticket → milestone` rows, nothing written", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901"); // missing binding → intended
    writeFr(specsDir, "STE-902"); // already correct → skipped
    const stub = makeStub({ tickets: { "STE-902": { attached: CANONICAL_M31 } } });
    // No `apply` key at all — the default MUST be dry-run.
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
    });
    expect(ids(res.backfilled)).toEqual(["STE-901"]);
    expect(res.backfilled[0]?.milestone).toBe(CANONICAL_M31);
    expect(ids(res.alreadyCorrect)).toEqual(["STE-902"]);
    expect(res.failed).toEqual([]);
    // Reads only — classification needs getIssue, but NO write may fire.
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((c) => c.startsWith("getIssue("))).toBe(true);
    expect(stub.tickets["STE-901"]?.attached ?? null).toBe(null);
  });

  test("already-correct ticket is skipped with no write even under --apply", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901");
    const stub = makeStub({ tickets: { "STE-901": { attached: CANONICAL_M31 } } });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(res.alreadyCorrect)).toEqual(["STE-901"]);
    expect(res.backfilled).toEqual([]);
    expect(writeCalls(stub.calls)).toEqual([]);
  });

  test("re-running --apply after a clean sweep is a no-op (every ticket already correct)", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901");
    writeFr(specsDir, "STE-810", { dir: "archive", milestone: "M30" });
    const stub = makeStub();
    const provider = makeProvider(stub);
    const first = await backfillMilestoneLabels(provider, "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(first.backfilled)).toEqual(["STE-810", "STE-901"]);
    const callsAfterFirst = stub.calls.length;
    const second = await backfillMilestoneLabels(provider, "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(second.backfilled).toEqual([]);
    expect(ids(second.alreadyCorrect)).toEqual(["STE-810", "STE-901"]);
    expect(second.failed).toEqual([]);
    // Second pass performed zero writes.
    expect(writeCalls(stub.calls.slice(callsAfterFirst))).toEqual([]);
  });
});

describe("AC-STE-364.3 — best-effort per ticket + aggregate report", () => {
  test("one ticket's attach failure is recorded and the sweep continues; counts backfilled/already-correct/failed are correct", async () => {
    const { specsDir } = makeRepo();
    // Glob order STE-901 < STE-902 < STE-903: the FAILING ticket comes first,
    // so a successful later backfill proves the sweep did not abort.
    writeFr(specsDir, "STE-901");
    writeFr(specsDir, "STE-902");
    writeFr(specsDir, "STE-903");
    const stub = makeStub({
      tickets: {
        "STE-901": { attachLands: false }, // missing, attach won't land
        "STE-902": { attached: CANONICAL_M31 }, // already correct
        "STE-903": {}, // missing, attach lands
      },
    });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(res.backfilled)).toEqual(["STE-903"]);
    expect(ids(res.alreadyCorrect)).toEqual(["STE-902"]);
    expect(ids(res.failed)).toEqual(["STE-901"]);
    expect(res.backfilled).toHaveLength(1);
    expect(res.alreadyCorrect).toHaveLength(1);
    expect(res.failed).toHaveLength(1);
    // The sweep continued past the failure: STE-903's attach landed.
    expect(stub.tickets["STE-903"]?.attached).toBe(CANONICAL_M31);
    // Failed entry carries the ticket id, the plan file it maps to, and an
    // NFR-10-shaped detail.
    const failed = res.failed[0]!;
    expect(failed.ticketId).toBe("STE-901");
    expect(failed.milestone).toBe(CANONICAL_M31);
    expect(failed.planFile.endsWith(join("specs", "plan", "M31.md"))).toBe(true);
    expect(failed.detail).toMatch(/Remedy:/);
  });

  test("failed archived FR maps to its archived plan file path", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-810", { dir: "archive", milestone: "M30" });
    const stub = makeStub({ tickets: { "STE-810": { attachLands: false } } });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(res.failed)).toEqual(["STE-810"]);
    expect(
      res.failed[0]!.planFile.endsWith(join("specs", "plan", "archive", "M30.md")),
    ).toBe(true);
  });
});

describe("AC-STE-364.4 — FR-backed scope + vacuity", () => {
  test("FR-backed only: unbound / milestone-less FRs are never fetched; only bound tickets are, no board enumeration", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901"); // candidate (tracker + milestone)
    writeFr(specsDir, "local-only", { trackerBlock: "tracker: {}" }); // no binding
    writeFr(specsDir, "STE-888", { milestone: null }); // no milestone: line
    const stub = makeStub({ tickets: { "STE-901": { attached: CANONICAL_M31 } } });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(ids(res.alreadyCorrect)).toEqual(["STE-901"]);
    expect(res.backfilled).toEqual([]);
    expect(res.failed).toEqual([]);
    // Every tracker call is a getIssue for the ONE bound candidate — a
    // GB-12-class ticket (no FR) can never be fetched or touched.
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((c) => c === "getIssue(STE-901)")).toBe(true);
  });

  test("mode: none → zero candidates, zero tracker calls, even with apply: true", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901");
    const stub = makeStub();
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "none",
      apply: true,
    });
    expect(res.backfilled).toEqual([]);
    expect(res.alreadyCorrect).toEqual([]);
    expect(res.failed).toEqual([]);
    expect(stub.calls).toEqual([]);
  });

  test("adapter with project_milestone: false → zero candidates, zero tracker calls", async () => {
    const { specsDir } = makeRepo();
    writeFr(specsDir, "STE-901");
    const stub = makeStub({
      supports: (cap: string) => cap !== "project_milestone",
    });
    const res = await backfillMilestoneLabels(makeProvider(stub), "DPT", specsDir, {
      mode: "linear",
      apply: true,
    });
    expect(res.backfilled).toEqual([]);
    expect(res.alreadyCorrect).toEqual([]);
    expect(res.failed).toEqual([]);
    expect(stub.calls).toEqual([]);
  });
});

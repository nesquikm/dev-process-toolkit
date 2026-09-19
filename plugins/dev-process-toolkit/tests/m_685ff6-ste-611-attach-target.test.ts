// STE-611 (M_685ff6) — a feature request's milestone container is found
// before its ticket is created.
//
// This file grades AC-STE-611.1 (the exported resolver and the agreement
// suite), AC-STE-611.2 (the attach module's front door, spawned as a
// subprocess), AC-STE-611.4 (the attach reads the ticket first) and
// AC-STE-611.5 (a cross-project miss names the project).
//
// Every new-behaviour assertion is RED on the pre-change bytes (3170dfc):
// `resolveAttachTarget` is not exported, the module has no `import.meta.main`
// front door (a `bun run` of it exits 0 printing nothing), the attach
// enumerates before it reads, and the Epic-keyed miss has one text for every
// project. Legs labelled `(control)` pass on both sides by construction.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as attachModule from "../adapters/_shared/src/attach_project_milestone";
import { milestoneLabel } from "../adapters/_shared/src/attach_project_milestone";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { RECEIPT_ANNOUNCEMENT_PREFIX } from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, commitAll, git, pluginManifest } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ATTACH_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src", "attach_project_milestone.ts");
const SESSION = "s-611-attach";
const MANIFEST_VERSION = "2.87.0";

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-611-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let MANIFEST_DIR = "";
beforeAll(() => {
  MANIFEST_DIR = tempDir("manifest");
  pluginManifest(MANIFEST_DIR, MANIFEST_VERSION);
});

// ------------------------------------------------------- the module surface

type Target =
  | { surface: "parent"; key: string }
  | { surface: "label" }
  | { surface: "object"; id?: string }
  | { surface: "object-create" };

type AttachResult = { capability: string | null; createdName?: string; epicKey?: string };

const attach = attachModule.attachProjectMilestone as unknown as (
  provider: unknown,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<AttachResult>;

/** Read at call time, so a missing export reds each leg on its own. */
function resolveAttachTarget(provider: unknown, project: string, milestoneName: string): Promise<Target> {
  const fn = (attachModule as unknown as Record<string, unknown>).resolveAttachTarget;
  if (typeof fn !== "function") {
    throw new Error("resolveAttachTarget is not exported from adapters/_shared/src/attach_project_milestone.ts");
  }
  return Promise.resolve((fn as (p: unknown, pr: string, n: string) => Promise<Target>)(provider, project, milestoneName));
}

const noSleep = async (): Promise<void> => {};

// ----------------------------------------------------------- recording double

interface Call {
  op: string;
  args: unknown[];
}

interface TicketState {
  parent: string | null;
  labels: string[];
  projectMilestone: { name: string; id?: string } | null;
}

interface Double {
  provider: Record<string, unknown>;
  calls: Call[];
  ticket: TicketState;
  ops(): string[];
}

const WRITE_OPS = new Set(["setParent", "addLabel", "upsertTicketMetadata", "saveMilestone", "createEpic", "createMilestone"]);

function makeDouble(opts: {
  binding?: "epic" | "label" | "object";
  epics?: Array<{ key: string; name: string }>;
  milestones?: Array<{ name: string; id?: string }>;
  ticket?: Partial<TicketState>;
}): Double {
  const calls: Call[] = [];
  const epics = [...(opts.epics ?? [])];
  const milestones = [...(opts.milestones ?? [])];
  const ticket: TicketState = {
    parent: opts.ticket?.parent ?? null,
    labels: [...(opts.ticket?.labels ?? [])],
    projectMilestone: opts.ticket?.projectMilestone ?? null,
  };
  const provider: Record<string, unknown> = {
    listEpics: async (project: string) => {
      calls.push({ op: "listEpics", args: [project] });
      return epics.map((e) => ({ ...e }));
    },
    listMilestones: async (project: string) => {
      calls.push({ op: "listMilestones", args: [project] });
      return milestones.map((m) => ({ ...m }));
    },
    saveMilestone: async (project: string, o: { name: string }) => {
      calls.push({ op: "saveMilestone", args: [project, o] });
      milestones.push({ name: o.name });
    },
    upsertTicketMetadata: async (ticketId: string, meta: { milestone?: string }) => {
      calls.push({ op: "upsertTicketMetadata", args: [ticketId, meta] });
      const m = milestones.find((x) => x.id === meta.milestone) ?? milestones.find((x) => x.name === meta.milestone);
      ticket.projectMilestone = m ? { ...m } : null;
      return ticketId;
    },
    getIssue: async (ticketId: string) => {
      calls.push({ op: "getIssue", args: [ticketId] });
      return {
        parent: ticket.parent,
        labels: [...ticket.labels],
        projectMilestone: ticket.projectMilestone ? { ...ticket.projectMilestone } : null,
      };
    },
    setParent: async (ticketId: string, key: string) => {
      calls.push({ op: "setParent", args: [ticketId, key] });
      ticket.parent = key;
    },
    addLabel: async (ticketId: string, label: string) => {
      calls.push({ op: "addLabel", args: [ticketId, label] });
      if (!ticket.labels.includes(label)) ticket.labels.push(label);
    },
    createEpic: async () => {
      calls.push({ op: "createEpic", args: [] });
      throw new Error("the attach never mints an Epic");
    },
    createMilestone: async () => {
      calls.push({ op: "createMilestone", args: [] });
      throw new Error("the attach never mints a milestone");
    },
  };
  if (opts.binding === "epic" || opts.binding === "label") provider.milestoneBinding = opts.binding;
  return { provider, calls, ticket, ops: () => calls.map((c) => c.op) };
}

// ----------------------------------------------------------- the one table

const LINEAR_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"; // → M_3fa85f
const LINEAR_DECOY = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"; // → M_9b1deb
const LINEAR_NUMERIC_ID = "c0ffee00-0000-4000-8000-000000000001";
const TICKET = "FR-611";

interface Row {
  label: string;
  binding: "epic" | "label" | "object";
  project: string;
  name: string;
  epics?: Array<{ key: string; name: string }>;
  milestones?: Array<{ name: string; id?: string }>;
  /** A hit: the target the resolver must return. */
  expect?: Target;
  /** A miss: the permanent refusal class both must throw. */
  error?: string;
}

const TABLE: Row[] = [
  {
    label: "Epic-keyed token, hit (a name-matching decoy is listed first)",
    binding: "epic",
    project: "GF",
    name: "M_GF_78 — Waiting States II",
    epics: [
      { key: "GF-99", name: "M_GF_78 — Waiting States II" },
      { key: "GF-78", name: "Waiting States II" },
    ],
    expect: { surface: "parent", key: "GF-78" },
  },
  {
    label: "Epic-keyed token, miss",
    binding: "epic",
    project: "GF",
    name: "M_GF_78 — Waiting States II",
    epics: [{ key: "GF-12", name: "Unrelated Epic" }],
    error: "MilestoneEpicNotFoundError",
  },
  {
    label: "numeric token under the epic binding (label surface)",
    binding: "epic",
    project: "GF",
    name: "M15 — Legacy Payouts",
    epics: [{ key: "GF-15", name: "M15 — Legacy Payouts" }],
    expect: { surface: "label" },
  },
  {
    label: "numeric token under the label binding",
    binding: "label",
    project: "GF",
    name: "M86 — Jira Support",
    expect: { surface: "label" },
  },
  {
    label: "pre-key human title, hit",
    binding: "epic",
    project: "GF",
    name: "Concurrent milestone A",
    epics: [
      { key: "GF-49", name: "Concurrent milestone B" },
      { key: "GF-50", name: "Concurrent milestone A" },
    ],
    expect: { surface: "parent", key: "GF-50" },
  },
  {
    label: "pre-key human title, miss",
    binding: "epic",
    project: "GF",
    name: "Concurrent milestone A",
    epics: [{ key: "GF-49", name: "Concurrent milestone B" }],
    error: "MilestoneEpicUnmintedError",
  },
  {
    label: "a claimed token that parses as neither kind",
    binding: "epic",
    project: "GF",
    name: "M_ — Broken",
    epics: [{ key: "GF-49", name: "M_ — Broken" }],
    error: "MilestoneTokenUnparseableError",
  },
  {
    label: "Linear identifier token, hit (a name-matching decoy is listed first)",
    binding: "object",
    project: "DPT",
    name: "M_3fa85f — Waiting States II",
    milestones: [
      { name: "M_3fa85f — Waiting States II", id: LINEAR_DECOY },
      { name: "Waiting States II", id: LINEAR_ID },
    ],
    expect: { surface: "object", id: LINEAR_ID },
  },
  {
    label: "Linear identifier token, miss",
    binding: "object",
    project: "DPT",
    name: "M_3fa85f — Waiting States II",
    milestones: [{ name: "Waiting States II", id: LINEAR_DECOY }],
    error: "MilestoneObjectNotFoundError",
  },
  {
    label: "Linear numeric name, hit",
    binding: "object",
    project: "DPT",
    name: "M86 — Jira Support",
    milestones: [{ name: "M86 — Jira Support", id: LINEAR_NUMERIC_ID }],
    expect: { surface: "object" },
  },
  {
    label: "Linear numeric name, no match (grandfathered auto-create)",
    binding: "object",
    project: "DPT",
    name: "M86 — Jira Support",
    milestones: [{ name: "M87 — Something Else", id: LINEAR_DECOY }],
    expect: { surface: "object-create" },
  },
];

function doubleFor(row: Row): Double {
  return makeDouble({ binding: row.binding, epics: row.epics, milestones: row.milestones });
}

/** The surface an attach run actually wrote, read off its call log. */
function writtenTarget(d: Double, name: string): Target | null {
  const w = d.calls.filter((c) => WRITE_OPS.has(c.op));
  const parent = w.find((c) => c.op === "setParent");
  if (parent) return { surface: "parent", key: parent.args[1] as string };
  const label = w.find((c) => c.op === "addLabel");
  if (label) return label.args[1] === milestoneLabel(name) ? { surface: "label" } : null;
  if (w.some((c) => c.op === "saveMilestone")) return { surface: "object-create" };
  const upsert = w.find((c) => c.op === "upsertTicketMetadata");
  if (upsert) {
    const sent = (upsert.args[1] as { milestone?: string }).milestone;
    return sent === name ? { surface: "object" } : { surface: "object", id: sent };
  }
  return null;
}

type AttachFn = typeof attach;

/**
 * The agreement check: over every row, the attach binds exactly the target
 * the resolver returned, or both throw the same refusal (class and text).
 * Returns the disagreements; the real module must return none.
 */
async function disagreements(attachUnderTest: AttachFn): Promise<string[]> {
  const out: string[] = [];
  for (const row of TABLE) {
    let target: Target | undefined;
    let resolveErr: Error | undefined;
    try {
      target = await resolveAttachTarget(doubleFor(row).provider, row.project, row.name);
    } catch (e) {
      resolveErr = e as Error;
    }
    const d = doubleFor(row);
    let attachErr: Error | undefined;
    try {
      await attachUnderTest(d.provider, row.project, row.name, TICKET, { sleep: noSleep });
    } catch (e) {
      attachErr = e as Error;
    }
    if (row.error !== undefined) {
      if (resolveErr?.name !== row.error) out.push(`${row.label}: resolver threw ${resolveErr?.name ?? "nothing"}, not ${row.error}`);
      if (attachErr?.name !== row.error) out.push(`${row.label}: attach threw ${attachErr?.name ?? "nothing"}, not ${row.error}`);
      if (resolveErr && attachErr && resolveErr.message !== attachErr.message) out.push(`${row.label}: the two refusals differ in text`);
      const writes = d.calls.filter((c) => WRITE_OPS.has(c.op)).map((c) => c.op);
      if (writes.length > 0) out.push(`${row.label}: the refused attach wrote ${writes.join(", ")}`);
      continue;
    }
    if (resolveErr) {
      out.push(`${row.label}: resolver threw ${resolveErr.name}: ${resolveErr.message.split("\n")[0]}`);
      continue;
    }
    if (attachErr) {
      out.push(`${row.label}: attach threw ${attachErr.name}: ${attachErr.message.split("\n")[0]}`);
      continue;
    }
    const wrote = writtenTarget(d, row.name);
    const surfaceAgrees = wrote?.surface === target!.surface;
    const keyAgrees =
      target!.surface !== "parent" || (wrote?.surface === "parent" && wrote.key === target!.key);
    const idAgrees =
      target!.surface !== "object" || target!.id === undefined || (wrote?.surface === "object" && wrote.id === target!.id);
    if (!surfaceAgrees || !keyAgrees || !idAgrees) {
      out.push(`${row.label}: resolver said ${JSON.stringify(target)}, attach wrote ${JSON.stringify(wrote)}`);
    }
  }
  return out;
}

/** The body of `export async function attachProjectMilestone(…) { … }` in the module source. */
function attachBody(): string {
  const src = readFileSync(ATTACH_SRC, "utf-8");
  const start = src.indexOf("export async function attachProjectMilestone(");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

// ===========================================================================
// AC-STE-611.1 — one exported resolver; the attach finds only through it
// ===========================================================================

describe("AC-STE-611.1 — resolveAttachTarget is exported and returns the binding surface", () => {
  test("resolveAttachTarget is an exported function", () => {
    expect(typeof (attachModule as unknown as Record<string, unknown>).resolveAttachTarget).toBe("function");
  });

  for (const row of TABLE.filter((r) => r.expect !== undefined)) {
    test(`hit — ${row.label} → ${JSON.stringify(row.expect)}`, async () => {
      const d = doubleFor(row);
      const target = await resolveAttachTarget(d.provider, row.project, row.name);
      expect(target).toMatchObject(row.expect!);
      // Resolving is a read: nothing is written to the tracker.
      expect(d.calls.filter((c) => WRITE_OPS.has(c.op))).toEqual([]);
    });
  }

  for (const row of TABLE.filter((r) => r.error !== undefined)) {
    test(`miss — ${row.label} → throws ${row.error}, unchanged in class and text`, async () => {
      const viaResolver = await resolveAttachTarget(doubleFor(row).provider, row.project, row.name).then(
        () => null,
        (e: Error) => e,
      );
      expect(viaResolver?.name).toBe(row.error!);
      expect((viaResolver as { permanentRefusal?: unknown } | null)?.permanentRefusal).toBe(true);
      // The same refusal text the attach itself throws.
      const viaAttach = await attach(doubleFor(row).provider, row.project, row.name, TICKET, { sleep: noSleep }).then(
        () => null,
        (e: Error) => e,
      );
      expect(viaAttach?.message).toBe(viaResolver!.message);
    });
  }

  test("the grandfathered numeric Linear miss resolves to object-create and creates nothing while resolving", async () => {
    const row = TABLE.find((r) => r.expect?.surface === "object-create")!;
    const d = doubleFor(row);
    expect(await resolveAttachTarget(d.provider, row.project, row.name)).toMatchObject({ surface: "object-create" });
    expect(d.ops()).not.toContain("saveMilestone");
  });
});

describe("AC-STE-611.1 — the agreement suite: the resolver and the attach over one table", () => {
  test("every row: the attach binds the target the resolver returned, or both refuse identically", async () => {
    expect(await disagreements(attach)).toEqual([]);
  });

  test("a mutation giving the attach its own divergent find leg turns the agreement suite red", async () => {
    // The mutant finds the Epic by NAME before delegating — the pre-STE-521
    // find leg. On the decoy row it parents GF-99 while the resolver says GF-78.
    const mutant: AttachFn = async (provider, project, milestoneName, ticketId, opts) => {
      const p = provider as Record<string, (...a: unknown[]) => Promise<unknown>>;
      if ((provider as { milestoneBinding?: string }).milestoneBinding === "epic" && /^M_[A-Za-z0-9]/.test(milestoneName)) {
        // A well-formed Epic-keyed token only: `M_ — Broken` is the refusal row,
        // which the mutant must leave to the real attach.
        const epics = (await p.listEpics!(project)) as Array<{ key: string; name: string }>;
        const byName = epics.find((e) => e.name === milestoneName);
        if (byName) {
          await p.setParent!(ticketId, byName.key);
          return { capability: null, epicKey: byName.key };
        }
      }
      return attach(provider, project, milestoneName, ticketId, opts);
    };
    const found = await disagreements(mutant);
    // The disagreement must be the divergence itself — the mutant bound the
    // decoy the resolver did not choose — not merely a resolver that is absent.
    const decoy = found.filter((f) => f.startsWith("Epic-keyed token, hit"));
    expect(decoy.length).toBe(1);
    expect(decoy[0]).toContain('resolver said {"surface":"parent","key":"GF-78"}');
    expect(decoy[0]).toContain('attach wrote {"surface":"parent","key":"GF-99"}');
    // Every other row still agrees under the mutant: the check is not noisy.
    expect(found.length).toBe(1);
  });

  test("attachProjectMilestone obtains its target only through resolveAttachTarget (no enumeration of its own)", () => {
    const body = attachBody();
    expect(body).toMatch(/\bresolveAttachTarget\s*\(/);
    expect(body).not.toMatch(/\blistEpics\s*\(/);
    expect(body).not.toMatch(/\blistMilestones\s*\(/);
  });
});

// ===========================================================================
// AC-STE-611.4 — bound first
// ===========================================================================

describe("AC-STE-611.4 — the attach reads the ticket before any enumeration", () => {
  test("a legacy FR parented to GB-40, attached for M_GB_40 under GF, is a no-op (HEAD throws MilestoneEpicNotFoundError)", async () => {
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: "GF-85", name: "Payouts" }],
      ticket: { parent: "GB-40" },
    });
    const result = await attach(d.provider, "GF", "M_GB_40 — Payouts", TICKET, { sleep: noSleep });
    expect(result.capability).toBeNull();
    expect(d.ops()).not.toContain("listEpics");
    expect(d.ops()).not.toContain("listMilestones");
    expect(d.calls.filter((c) => WRITE_OPS.has(c.op))).toEqual([]);
    expect(d.ticket.parent).toBe("GB-40");
  });

  test("(control) the same FR with no parent under GF still refuses with MilestoneEpicNotFoundError", async () => {
    const d = makeDouble({ binding: "epic", epics: [{ key: "GF-85", name: "Payouts" }] });
    const err = await attach(d.provider, "GF", "M_GB_40 — Payouts", TICKET, { sleep: noSleep }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe("MilestoneEpicNotFoundError");
    expect(d.calls.filter((c) => WRITE_OPS.has(c.op))).toEqual([]);
  });

  test("an unbound Epic-keyed attach: the first call is the ticket read, before listEpics", async () => {
    const d = makeDouble({ binding: "epic", epics: [{ key: "GF-78", name: "Waiting States II" }] });
    await attach(d.provider, "GF", "M_GF_78 — Waiting States II", TICKET, { sleep: noSleep });
    const ops = d.ops();
    expect(ops[0]).toBe("getIssue");
    expect(ops.indexOf("getIssue")).toBeLessThan(ops.indexOf("listEpics"));
    expect(d.ticket.parent).toBe("GF-78");
  });

  test("an unbound Linear attach: the first call is the ticket read, before listMilestones", async () => {
    const d = makeDouble({ binding: "object", milestones: [{ name: "Waiting States II", id: LINEAR_ID }] });
    await attach(d.provider, "DPT", "M_3fa85f — Waiting States II", TICKET, { sleep: noSleep });
    const ops = d.ops();
    expect(ops[0]).toBe("getIssue");
    expect(ops.indexOf("getIssue")).toBeLessThan(ops.indexOf("listMilestones"));
  });

  const bound: Array<{ label: string; project: string; name: string; d: () => Double }> = [
    {
      label: "Epic-keyed, parent already the Epic",
      project: "GF",
      name: "M_GF_78 — Waiting States II",
      d: () => makeDouble({ binding: "epic", epics: [{ key: "GF-78", name: "Waiting States II" }], ticket: { parent: "GF-78" } }),
    },
    {
      label: "numeric under the epic binding, label already present",
      project: "GF",
      name: "M15 — Legacy Payouts",
      d: () => makeDouble({ binding: "epic", ticket: { labels: ["milestone-M15"] } }),
    },
    {
      label: "label binding, label already present",
      project: "GF",
      name: "M86 — Jira Support",
      d: () => makeDouble({ binding: "label", ticket: { labels: ["team-x", "milestone-M86"] } }),
    },
    {
      label: "Linear identifier, milestone already bound",
      project: "DPT",
      name: "M_3fa85f — Waiting States II",
      d: () =>
        makeDouble({
          binding: "object",
          milestones: [{ name: "Waiting States II", id: LINEAR_ID }],
          ticket: { projectMilestone: { name: "Waiting States II", id: LINEAR_ID } },
        }),
    },
    {
      label: "Linear numeric name, milestone already bound",
      project: "DPT",
      name: "M86 — Jira Support",
      d: () =>
        makeDouble({
          binding: "object",
          milestones: [{ name: "M86 — Jira Support", id: LINEAR_NUMERIC_ID }],
          ticket: { projectMilestone: { name: "M86 — Jira Support", id: LINEAR_NUMERIC_ID } },
        }),
    },
  ];
  for (const b of bound) {
    test(`already bound (${b.label}): one read, no enumeration, no write`, async () => {
      const d = b.d();
      const result = await attach(d.provider, b.project, b.name, TICKET, { sleep: noSleep });
      expect(result.capability).toBeNull();
      expect(d.ops()).toEqual(["getIssue"]);
    });
  }
});

// ===========================================================================
// AC-STE-611.5 — a cross-project miss names the project
// ===========================================================================

/** HEAD's same-project miss text, measured at 3170dfc — the byte-for-byte control. */
const HEAD_SAME_PROJECT_MISS =
  "MilestoneEpicNotFoundError: refusing to attach — no Epic in project \"GF\" has a key that sanitizes to the milestone token \"M_GF_99\" (the attach looked for the Epic key \"GF_99\"). The token was derived from an Epic that already exists, so creating one would mint a SECOND Epic under a key that can never match the token.\nRemedy: pick one — (a) confirm the Epic \"GF_99\" still exists and is visible in project \"GF\" (restore it if it was archived/deleted, or fix the project the adapter is searching); (b) if the Epic lives in a different project, point the attach at that project; (c) if the Epic is gone for good, re-derive the milestone id from an Epic that does exist (mint the Epic yourself, then re-run /spec-write so the plan heading carries the new `M_<epic-key>` token). Never hand-edit the token to a key that has no Epic.\nContext: token=\"M_GF_99\", epicKey=\"GF_99\", project=\"GF\", binding=epic, helper=attachProjectMilestone";

/** HEAD's Linear identifier miss text, measured at 3170dfc. */
const HEAD_LINEAR_MISS =
  "MilestoneObjectNotFoundError: refusing to attach — no milestone in project \"DPT\" has an identifier that sanitizes to the milestone token \"M_3fa85f\" (cut from the canonical name \"M_3fa85f — Waiting States II\"). The token was derived from a milestone that already exists, so creating one would mint a SECOND milestone under an identifier that can never match the token.\nRemedy: pick one — (a) confirm the milestone still exists and is visible in project \"DPT\" (restore it if it was archived/deleted, or fix the project the adapter is searching); (b) if the milestone lives in a different project, point the attach at that project; (c) if the milestone is gone for good, mint a new one with `mintMilestoneLinear` and re-run /spec-write so the plan heading carries the new `M_<key>` token. Never hand-edit the token to a key no milestone identifier derives to, and never rename a milestone to fix this — the NAME is not what binds.\nContext: token=\"M_3fa85f\", milestoneName=\"M_3fa85f — Waiting States II\", project=\"DPT\", binding=milestone-id, helper=attachProjectMilestone";

const remedyOf = (m: string): string => m.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";

/** Per-adapter applicability of the cross-project leg. Linear tokens carry no project. */
const AC5_LEGS: ReadonlyArray<{ adapter: "jira" | "linear"; applicable: boolean; why: string }> = [
  { adapter: "jira", applicable: true, why: "an Epic-keyed token embeds the project key" },
  { adapter: "linear", applicable: false, why: "Linear tokens carry no project" },
];

describe("AC-STE-611.5 — a cross-project miss names the project", () => {
  async function crossProjectMiss(): Promise<Error> {
    const d = makeDouble({ binding: "epic", epics: [{ key: "GF-85", name: "Payouts" }] });
    const err = await attach(d.provider, "GF", "M_GB_40 — Payouts", TICKET, { sleep: noSleep }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    return err!;
  }

  test("(control) the refusal is still MilestoneEpicNotFoundError and names the configured project and the token — HEAD already does", async () => {
    const err = await crossProjectMiss();
    expect(err.name).toBe("MilestoneEpicNotFoundError");
    expect(err.message).toContain('"GF"');
    expect(err.message).toContain("M_GB_40");
  });

  test("its remedy says the Epic lives in another project: set the parent by hand, or archive the FR before a repoint", async () => {
    const remedy = remedyOf((await crossProjectMiss()).message);
    expect(remedy).toMatch(/another project|different project|other project/i);
    expect(remedy).toMatch(/by hand/i);
    expect(remedy).toMatch(/archiv\w*\b[^.;]*\bFR\b/i);
    expect(remedy).toMatch(/repoint/i);
  });

  test("its remedy never says to create or mint an Epic", async () => {
    const remedy = remedyOf((await crossProjectMiss()).message);
    const advising = remedy
      .split(/(?<=[.;])\s+|\s+—\s+|\(\w\)\s+/)
      .filter((s) => /\b(create|creating|mint|minting|mintMilestoneEpic)\b[^.]*\bEpic\b/i.test(s))
      .filter((s) => !/\b(never|not|don't|do not)\b/i.test(s));
    expect(advising).toEqual([]);
    expect(remedy).not.toContain("mint the Epic yourself");
    expect(remedy).not.toContain("re-derive the milestone id");
  });

  test("(control) a same-project miss keeps today's text byte-for-byte", async () => {
    const d = makeDouble({ binding: "epic", epics: [{ key: "GF-85", name: "Payouts" }] });
    const err = await attach(d.provider, "GF", "M_GF_99 — Gone", TICKET, { sleep: noSleep }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toBe(HEAD_SAME_PROJECT_MISS);
  });

  for (const leg of AC5_LEGS) {
    if (!leg.applicable) {
      // Recorded as SKIPPED, never as a pass: the leg does not exist on this adapter.
      test.skip(`AC-STE-611.5 — ${leg.adapter}: not applicable (${leg.why})`, () => {});
    }
  }

  test("the Linear leg is recorded as skipped, not passed", () => {
    expect(AC5_LEGS.filter((l) => !l.applicable).map((l) => l.adapter)).toEqual(["linear"]);
    expect(AC5_LEGS.filter((l) => l.applicable).map((l) => l.adapter)).toEqual(["jira"]);
  });

  test("(control) a Linear identifier miss keeps today's text byte-for-byte", async () => {
    const d = makeDouble({ binding: "object", milestones: [{ name: "Other", id: LINEAR_DECOY }] });
    const err = await attach(d.provider, "DPT", "M_3fa85f — Waiting States II", TICKET, { sleep: noSleep }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toBe(HEAD_LINEAR_MISS);
  });
});

// ===========================================================================
// AC-STE-611.2 — the front door, spawned as a subprocess
// ===========================================================================

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runDoor(argv: string[], cwd: string, session = SESSION): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = session;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  const p = Bun.spawnSync(["bun", "run", ATTACH_SRC, ...argv], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function show(r: Run): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function receiptFiles(root: string, session = SESSION): string[] {
  const dir = receiptsDir(root, session);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => join(dir, n)) : [];
}

/** A git repository with an undeclared (no `repo_tag`) tracker binding and one plan. */
function repo(mode: "jira" | "linear", planToken: string, planTitle: string): { root: string; plan: string } {
  const root = tempDir(`door-${mode}`);
  if (mode === "jira") claudeMd(root, { mode: "jira", project: "GF" });
  else claudeMd(root, { mode: "linear", team: "STE", project: "DPT" });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const plan = join(root, "specs", "plan", `${planToken}.md`);
  writeFileSync(
    plan,
    `---\nmilestone: ${planToken}\nstatus: active\narchived_at: null\n---\n\n## ${planToken} — ${planTitle} {#${planToken}}\n\nBody.\n`,
  );
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "fixture");
  return { root, plan };
}

const epicRow = (key: string, summary: string, project = "GF") => ({
  key,
  fields: {
    summary,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    labels: [],
    issuetype: { name: "Epic" },
    project: { key: project },
  },
});

function listing(dir: string, body: unknown): string {
  const p = join(dir, `listing-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  return p;
}

function lines(out: string): string[] {
  return out.split("\n").filter((l) => l !== "");
}

function expectResolved(r: Run, root: string, needles: string[]): string {
  if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
  const ls = lines(r.stdout);
  for (const n of needles) expect(ls).toContain(n);
  const announced = ls.filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  expect(announced.length).toBe(1);
  const path = announced[0]!.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
  expect(announced[0]!).toMatch(/ sha256:[0-9a-f]{64}$/);
  expect(receiptFiles(root).map((p) => realpathSync(p))).toEqual([realpathSync(path)]);
  const receipt = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  expect(receipt.kind).toBe("attach-target");
  expect(receipt.sessionId).toBe(SESSION);
  return path;
}

function expectRefused(r: Run, root: string, ...needles: string[]): void {
  if (r.exitCode !== 1) throw new Error(`expected exit 1, got:\n${show(r)}`);
  expect(r.stdout).toBe("");
  expect(r.stderr.trim()).not.toBe("");
  for (const n of needles) expect(r.stderr).toContain(n);
  expect(receiptFiles(root)).toEqual([]);
}

describe("AC-STE-611.2 — the front door resolves, prints and writes one attach-target receipt", () => {
  test("Jira Epic-keyed: exit 0, surface=parent, key=GF-78, one dpt-receipt line and one attach-target receipt", () => {
    const { root, plan } = repo("jira", "M_GF_78", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const r = runDoor(
      [root, "jira", "GF", plan, listing(scratch, { issues: [epicRow("GF-99", "Other"), epicRow("GF-78", "Waiting States II")], isLast: true })],
      root,
    );
    const path = expectResolved(r, root, ["surface=parent", "key=GF-78"]);
    expect(readFileSync(path, "utf-8")).toContain("GF-78");
  }, 30_000);

  test("relocated: run from ANOTHER repository's checkout, the receipt lands under <projectRoot> only", () => {
    const { root, plan } = repo("jira", "M_GF_78", "Waiting States II");
    const elsewhere = repo("jira", "M_GF_12", "Elsewhere").root;
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "jira", "GF", plan, listing(scratch, { issues: [epicRow("GF-78", "Waiting States II")], isLast: true })], elsewhere);
    expectResolved(r, root, ["surface=parent", "key=GF-78"]);
    expect(receiptFiles(elsewhere)).toEqual([]);
  }, 30_000);

  test("a numeric Jira token resolves to surface=label and prints listing=not read", () => {
    const { root, plan } = repo("jira", "M15", "Legacy Payouts");
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "jira", "GF", plan, listing(scratch, { issues: [], isLast: true })], root);
    expectResolved(r, root, ["surface=label", "listing=not read"]);
  }, 30_000);

  test("Linear identifier token: surface=object and id=<the milestone identifier>", () => {
    const { root, plan } = repo("linear", "M_3fa85f", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const r = runDoor(
      [root, "linear", "DPT", plan, listing(scratch, { milestones: [{ id: LINEAR_DECOY, name: "M_3fa85f — Waiting States II" }, { id: LINEAR_ID, name: "Waiting States II" }] })],
      root,
    );
    expectResolved(r, root, ["surface=object", `id=${LINEAR_ID}`]);
  }, 30_000);

  test("Linear grandfathered numeric name with no match: surface=object-create", () => {
    const { root, plan } = repo("linear", "M86", "Jira Support");
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "linear", "DPT", plan, listing(scratch, { milestones: [{ id: LINEAR_DECOY, name: "M87 — Something Else" }] })], root);
    expectResolved(r, root, ["surface=object-create"]);
  }, 30_000);
});

describe("AC-STE-611.2 — every refusal exits 1, stderr only, no receipt", () => {
  test("a permanent refusal (Epic-keyed miss) → exit 1 with the refusal on stderr", () => {
    const { root, plan } = repo("jira", "M_GF_78", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "jira", "GF", plan, listing(scratch, { issues: [epicRow("GF-12", "Unrelated")], isLast: true })], root);
    expectRefused(r, root, "MilestoneEpicNotFoundError");
  }, 30_000);

  test("a permanent refusal on Linear (identifier miss) → exit 1", () => {
    const { root, plan } = repo("linear", "M_3fa85f", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "linear", "DPT", plan, listing(scratch, { milestones: [{ id: LINEAR_DECOY, name: "Waiting States II" }] })], root);
    expectRefused(r, root, "MilestoneObjectNotFoundError");
  }, 30_000);

  test("unreadable plan, unreadable/malformed/unrecognised listing, a not-last Jira page, incomplete argv → exit 1 each", () => {
    const { root, plan } = repo("jira", "M_GF_78", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const good = listing(scratch, { issues: [epicRow("GF-78", "Waiting States II")], isLast: true });
    const cases: Array<[string, string[]]> = [
      ["unreadable plan file", [root, "jira", "GF", join(root, "specs", "plan", "M_GF_404.md"), good]],
      ["unreadable listing", [root, "jira", "GF", plan, join(scratch, "absent.json")]],
      ["malformed listing", [root, "jira", "GF", plan, listing(scratch, "{not json")]],
      ["unrecognised listing shape", [root, "jira", "GF", plan, listing(scratch, { milestones: [] })]],
      ["a Jira page that is not the last page", [root, "jira", "GF", plan, listing(scratch, { issues: [epicRow("GF-78", "Waiting States II")], isLast: false, nextPageToken: "p2" })]],
      ["incomplete argv (no listing)", [root, "jira", "GF", plan]],
      ["incomplete argv (nothing)", []],
    ];
    const failures: string[] = [];
    for (const [label, argv] of cases) {
      const r = runDoor(argv, root);
      const ok = r.exitCode === 1 && r.stdout === "" && r.stderr.trim() !== "" && receiptFiles(root).length === 0;
      if (!ok) failures.push(`${label}: ${show(r)}`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  test("an unrecognised Linear listing shape → exit 1", () => {
    const { root, plan } = repo("linear", "M_3fa85f", "Waiting States II");
    const scratch = tempDir("door-scratch");
    const r = runDoor([root, "linear", "DPT", plan, listing(scratch, { issues: [] })], root);
    expectRefused(r, root);
  }, 30_000);
});

// STE-608 (M_685ff6) — a milestone mint names the act it performs and never
// joins silently. In-process half: the pure decision, both mints under an
// approved decision, the gate spec and the mandated dispatcher.
//
// ---------------------------------------------------------------------------
// CONTRACT this suite holds the implementer to
// ---------------------------------------------------------------------------
// milestone_token.ts exports
//   decideMilestoneMint(input: {
//     mode: "jira" | "linear";
//     project: string;
//     rows: JiraDecisionRow[] | LinearDecisionRow[];
//     title?: string;      // exactly ONE of title / joinKey
//     joinKey?: string;
//   }): { act: "create"; ... } | { act: "join"; via: "key" | "title"; key: string; name: string; ... }
//   JiraDecisionRow   = { key: string; name: string; statusCategory?: string; labels?: string[] }
//                       (statusCategory is Jira's `status.statusCategory.key`: "new" | "indeterminate" | "done";
//                        a row WITHOUT it makes the whole decision refuse)
//   LinearDecisionRow = { id: string; name: string }
//   A create names every closed key it excluded somewhere in the returned object.
//   Refusals are NFR-10: a verdict line, a `Remedy:` line, a `Context:` line.
//
// mintMilestoneEpic / mintMilestoneLinear accept `{ expect: <decision> }` and
// return `outcome: "created" | "joined"` beside their existing fields.
//
// ResolveMilestoneIdentityInput gains `rows`, `joinKey` and `shared`;
// resolveMilestoneIdentity returns `outcome: "joined"` on a key join, and
// milestoneAllocationGateSpec returns `decision` (the approved decision to
// hand to the mint) and `defaultValue: undefined` exactly on a shared title join.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as tokenModule from "../adapters/_shared/src/milestone_token";
import { milestoneIdFromEpicKey, milestoneIdFromLinearMilestone } from "../adapters/_shared/src/milestone_token";
import { mintMilestoneEpic } from "../adapters/_shared/src/mint_milestone_epic";
import { mintMilestoneLinear } from "../adapters/_shared/src/mint_milestone_linear";
import {
  milestoneAllocationGateSpec,
  resolveMilestoneIdentity,
} from "../adapters/_shared/src/resolve_milestone_identity";
import { requireOrRefuse, RequiresInputRefusedError } from "../adapters/_shared/src/requires_input";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

// --------------------------------------------------------------- fixtures

type Row = Record<string, unknown>;

const JIRA_OPEN = (key: string, name: string, labels: string[] = []): Row => ({
  key,
  name,
  statusCategory: "indeterminate",
  labels,
});
const JIRA_DONE = (key: string, name: string): Row => ({ key, name, statusCategory: "done", labels: [] });

const UUID_A = "550e8400-e29b-41d4-a716-446655440000"; // → M_550e84
const UUID_B = "7a1c3f00-0000-4000-8000-000000000001"; // → M_7a1c3f
const UUID_A_TWIN = "550e84ff-1111-4111-8111-111111111111"; // also → M_550e84

type Decide = (input: Record<string, unknown>) => Record<string, unknown>;

function decide(input: Record<string, unknown>): Record<string, unknown> {
  const fn = (tokenModule as unknown as { decideMilestoneMint?: Decide }).decideMilestoneMint;
  if (typeof fn !== "function") throw new Error("decideMilestoneMint is not exported from milestone_token.ts");
  return fn(input);
}

/** The thrown message of `fn`, asserted to be an NFR-10 refusal carrying every needle. */
function refusalOf(fn: () => unknown, ...needles: Array<string | RegExp>): string {
  let message: string | null = null;
  try {
    fn();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  if (message === null) throw new Error("expected an NFR-10 refusal, but nothing was thrown");
  if (/is not exported/.test(message)) throw new Error(message);
  const lines = message.split("\n");
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.some((l) => l.startsWith("Remedy:"))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context:"))).toBe(true);
  for (const n of needles) {
    if (typeof n === "string") expect(message).toContain(n);
    else expect(message).toMatch(n);
  }
  return message;
}

async function refusalOfAsync(fn: () => Promise<unknown>, ...needles: Array<string | RegExp>): Promise<string> {
  let message: string | null = null;
  try {
    await fn();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  if (message === null) throw new Error("expected a refusal, but the call resolved");
  expect(message).toMatch(/Remedy:/);
  for (const n of needles) {
    if (typeof n === "string") expect(message).toContain(n);
    else expect(message).toMatch(n);
  }
  return message;
}

// ------------------------------------------------------ recording providers

interface EpicRecorder {
  creates: string[];
  lists: number;
  labels: Array<[string, string]>;
  provider: {
    createEpic: (project: string, opts: { name: string }) => Promise<{ key: string }>;
    listEpics: (project: string) => Promise<Row[]>;
    addLabel: (ticketId: string, label: string) => Promise<void>;
  };
}

/** `pages[i]` is what the i-th listEpics call returns (the last one repeats). */
function epicRecorder(pages: Row[][], allocate = "GF-200", failFirstCreate = false): EpicRecorder {
  const rec: EpicRecorder = {
    creates: [],
    lists: 0,
    labels: [],
    provider: {
      createEpic: async (_project, opts) => {
        rec.creates.push(opts.name);
        if (failFirstCreate && rec.creates.length === 1) throw new Error("ETIMEDOUT: create timed out");
        return { key: allocate };
      },
      listEpics: async () => {
        const page = pages[Math.min(rec.lists, pages.length - 1)] ?? [];
        rec.lists += 1;
        return page as Row[];
      },
      addLabel: async (ticketId, label) => {
        rec.labels.push([ticketId, label]);
      },
    },
  };
  return rec;
}

interface LinearRecorder {
  creates: string[];
  lists: number;
  provider: {
    createMilestone: (project: string, opts: { name: string }) => Promise<{ id: string }>;
    listMilestones: (project: string) => Promise<{ name: string; id?: string }[]>;
  };
}

function linearRecorder(pages: Array<Array<{ name: string; id?: string }>>, allocate = UUID_B, failFirstCreate = false): LinearRecorder {
  const rec: LinearRecorder = {
    creates: [],
    lists: 0,
    provider: {
      createMilestone: async (_project, opts) => {
        rec.creates.push(opts.name);
        if (failFirstCreate && rec.creates.length === 1) throw new Error("ETIMEDOUT: create timed out");
        return { id: allocate };
      },
      listMilestones: async () => {
        const page = pages[Math.min(rec.lists, pages.length - 1)] ?? [];
        rec.lists += 1;
        return page;
      },
    },
  };
  return rec;
}

const noSleep = async (_ms: number) => {};

// ===========================================================================
// AC-STE-608.1 — one pure decision
// ===========================================================================

describe("AC-STE-608.1 — decideMilestoneMint is the one pure decision", () => {
  test("it is exported from milestone_token.ts and decides create on an empty listing", () => {
    expect(typeof (tokenModule as Record<string, unknown>).decideMilestoneMint).toBe("function");
    const d = decide({ mode: "jira", project: "GF", rows: [], title: "Payouts" });
    expect(d.act).toBe("create");
  });

  test("both a title and a join key → NFR-10 refusal", () => {
    refusalOf(() => decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-85", "Payouts")], title: "Payouts", joinKey: "GF-85" }));
  });

  test("neither a title nor a join key → NFR-10 refusal", () => {
    refusalOf(() => decide({ mode: "linear", project: "DPT", rows: [] }));
  });

  test("(control) milestone_token.ts performs no I/O: it imports no fs, no child process, no network", () => {
    const src = readFileSync(join(SRC, "milestone_token.ts"), "utf-8");
    expect(src).not.toMatch(/from "node:(fs|child_process|net|http|https)"/);
    expect(src).not.toMatch(/\bBun\.(spawn|file|write)/);
  });

  test("mintMilestoneEpic consults the decision: a title matching only a Done Epic creates (HEAD joins it)", async () => {
    const rec = epicRecorder([[JIRA_DONE("GF-12", "Payouts")]], "GF-200");
    const r = (await mintMilestoneEpic(rec.provider as never, "GF", "Payouts", { expect: { act: "create" } } as never)) as unknown as Row;
    expect(rec.creates).toEqual(["Payouts"]);
    expect(r.epicKey).toBe("GF-200");
    expect(r.outcome).toBe("created");
  });

  test("mintMilestoneLinear consults the decision: a key join binds a row whose title shares no word (HEAD creates)", async () => {
    const rec = linearRecorder([[{ id: UUID_A, name: "Completely renamed container" }]]);
    const r = (await mintMilestoneLinear(rec.provider, "DPT", "Payouts", {
      expect: { act: "join", via: "key", key: UUID_A, name: "Completely renamed container" },
    } as never)) as unknown as Row;
    expect(rec.creates).toEqual([]);
    expect(r.milestoneUuid).toBe(UUID_A);
    expect(r.milestoneId).toBe("M_550e84");
    expect(r.outcome).toBe("joined");
  });

  test("milestoneAllocationGateSpec consults the decision: a Done-only title match yields a create decision", async () => {
    const spec = (await milestoneAllocationGateSpec({
      specsDir: "/nonexistent",
      mode: "jira",
      project: "GF",
      title: "Payouts",
      rows: [JIRA_DONE("GF-12", "Payouts")],
      shared: false,
    } as never)) as unknown as Row;
    expect((spec.decision as Row | undefined)?.act).toBe("create");
  });
});

// ===========================================================================
// AC-STE-608.2 — join by KEY never compares a title
// ===========================================================================

describe("AC-STE-608.2 — join by key", () => {
  test("Jira: a listed Epic key joins that Epic, whatever its title", () => {
    const d = decide({
      mode: "jira",
      project: "GF",
      rows: [JIRA_OPEN("GF-84", "Other"), JIRA_OPEN("GF-85", "M_GF_85 — Canonical renamed Epic")],
      joinKey: "GF-85",
    });
    expect(d).toMatchObject({ act: "join", via: "key", key: "GF-85", name: "M_GF_85 — Canonical renamed Epic" });
    expect(milestoneIdFromEpicKey(d.key as string)).toBe("M_GF_85");
  });

  test("Linear: a UUID join key joins the row with that identifier", () => {
    const d = decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_B, name: "B" }, { id: UUID_A, name: "Zeta" }], joinKey: UUID_A });
    expect(d).toMatchObject({ act: "join", via: "key", key: UUID_A, name: "Zeta" });
  });

  test("Linear: an M_<6-hex> join key joins the one row deriving that token", () => {
    const d = decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_B, name: "B" }, { id: UUID_A, name: "Zeta" }], joinKey: "M_550e84" });
    expect(d).toMatchObject({ act: "join", via: "key", key: UUID_A, name: "Zeta" });
    expect(milestoneIdFromLinearMilestone(d.key as string)).toBe("M_550e84");
  });

  test("a join key naming no listed row refuses, naming the project and the key — never falls through to create", () => {
    refusalOf(() => decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-84", "Other")], joinKey: "GF-99" }), "GF", "GF-99");
    refusalOf(() => decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_B, name: "B" }], joinKey: "M_550e84" }), "DPT", "M_550e84");
  });

  test("two Linear rows deriving the same M_<6-hex> token refuse as ambiguous, naming both identifiers", () => {
    refusalOf(
      () => decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_A, name: "A" }, { id: UUID_A_TWIN, name: "A twin" }], joinKey: "M_550e84" }),
      UUID_A,
      UUID_A_TWIN,
    );
  });

  test("resolveMilestoneIdentity (jira) joins by key: milestoneId from the key, outcome joined, zero creates", async () => {
    const rec = epicRecorder([[JIRA_OPEN("GF-85", "Renamed")]]);
    const r = (await resolveMilestoneIdentity({
      specsDir: "/nonexistent",
      mode: "jira",
      project: "GF",
      rows: [JIRA_OPEN("GF-85", "Renamed")],
      joinKey: "GF-85",
      provider: rec.provider,
    } as never)) as unknown as Row;
    expect(r.milestoneId).toBe("M_GF_85");
    expect(r.outcome).toBe("joined");
    expect(rec.creates).toEqual([]);
  });

  test("resolveMilestoneIdentity (linear) joins by key: outcome joined, zero createMilestone (HEAD mints)", async () => {
    const rec = linearRecorder([[{ id: UUID_A, name: "Zeta" }]]);
    const r = (await resolveMilestoneIdentity({
      specsDir: "/nonexistent",
      mode: "linear",
      project: "DPT",
      rows: [{ id: UUID_A, name: "Zeta" }],
      joinKey: "M_550e84",
      provider: rec.provider,
    } as never)) as unknown as Row;
    expect(r.milestoneId).toBe("M_550e84");
    expect(r.outcome).toBe("joined");
    expect(rec.creates).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-608.3 — closed containers
// ===========================================================================

describe("AC-STE-608.3 — closed containers", () => {
  test("a title matching only Done Epics decides create and names every excluded key", () => {
    const d = decide({
      mode: "jira",
      project: "GF",
      rows: [JIRA_DONE("GF-12", "Payouts"), JIRA_DONE("GF-31", " payouts "), JIRA_OPEN("GF-40", "Unrelated")],
      title: "Payouts",
    });
    expect(d.act).toBe("create");
    const shown = JSON.stringify(d);
    expect(shown).toContain("GF-12");
    expect(shown).toContain("GF-31");
    expect(shown).not.toContain("GF-40");
  });

  test("an open match beside a closed one joins the open one", () => {
    const d = decide({ mode: "jira", project: "GF", rows: [JIRA_DONE("GF-12", "Payouts"), JIRA_OPEN("GF-50", "Payouts")], title: "Payouts" });
    expect(d).toMatchObject({ act: "join", via: "title", key: "GF-50" });
  });

  test("a join KEY naming a Done Epic refuses; the remedy says to reopen it in the tracker first", () => {
    const msg = refusalOf(() => decide({ mode: "jira", project: "GF", rows: [JIRA_DONE("GF-12", "Payouts")], joinKey: "GF-12" }), "GF-12");
    const remedy = msg.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toMatch(/reopen/i);
  });

  test("a Jira row carrying no status makes the whole decision refuse (title and key alike)", () => {
    const rows = [JIRA_OPEN("GF-50", "Other"), { key: "GF-51", name: "Payouts", labels: [] }];
    refusalOf(() => decide({ mode: "jira", project: "GF", rows, title: "Something else" }), "GF-51");
    refusalOf(() => decide({ mode: "jira", project: "GF", rows, joinKey: "GF-50" }), "GF-51");
  });
});

// ===========================================================================
// AC-STE-608.4 — title leg
// ===========================================================================

describe("AC-STE-608.4 — the title leg", () => {
  test("zero open matches → create", () => {
    expect(decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-40", "Unrelated")], title: "Payouts" }).act).toBe("create");
    expect(decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_B, name: "Unrelated" }], title: "Payouts" }).act).toBe("create");
  });

  test("one match → join via title (Jira and Linear)", () => {
    expect(decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-50", "Payouts")], title: "Payouts" })).toMatchObject({
      act: "join",
      via: "title",
      key: "GF-50",
      name: "Payouts",
    });
    expect(decide({ mode: "linear", project: "DPT", rows: [{ id: UUID_A, name: "Payouts" }], title: "Payouts" })).toMatchObject({
      act: "join",
      via: "title",
      key: UUID_A,
    });
  });

  test("two or more matches refuse with the ambiguous refusal naming every candidate", () => {
    refusalOf(
      () => decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-50", "Payouts"), JIRA_OPEN("GF-51", "PAYOUTS")], title: "Payouts" }),
      "GF-50",
      "GF-51",
    );
  });

  test("the comparison is matchMilestoneTitle: case-and-whitespace drift joins", () => {
    const d = decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-50", "  Waiting   STATES ii ")], title: "Waiting States II" });
    expect(d).toMatchObject({ act: "join", via: "title", key: "GF-50" });
  });
});

// ===========================================================================
// AC-STE-608.6 — the gate sentence and the default
// ===========================================================================

describe("AC-STE-608.6 — default forbidden exactly on a shared title join", () => {
  const spec = (shared: boolean, rows: Row[]) =>
    milestoneAllocationGateSpec({ specsDir: "/nonexistent", mode: "jira", project: "GF", title: "Payouts", rows, shared } as never);

  function gate(defaultValue: unknown) {
    return requireOrRefuse(
      {
        markerPresent: true,
        defaultValue,
        skillName: "/spec-write",
        stepName: "milestone-allocation",
        refusalReason: "a title join in a shared container has no safe default.",
      },
      "milestone-allocation",
      "<unset>",
    );
  }

  test("shared title-join forbidden; unshared title-join allowed; shared create allowed", async () => {
    // Leg 1 — shared title join: no default, the marker cannot apply one.
    const forbidden = await spec(true, [JIRA_OPEN("GF-85", "Payouts")]);
    expect((forbidden.decision as Row | undefined)?.act).toBe("join");
    expect(forbidden.defaultValue).toBeUndefined();
    expect(() => gate(forbidden.defaultValue)).toThrow(RequiresInputRefusedError);

    // Leg 2 — unshared title join: the joined milestone is the default.
    const allowed = await spec(false, [JIRA_OPEN("GF-85", "Payouts")]);
    expect((allowed.decision as Row | undefined)?.act).toBe("join");
    expect(allowed.defaultValue).toBe("M_GF_85");
    expect(gate(allowed.defaultValue)).toEqual({ outcome: "default-applied", value: "M_GF_85" });

    // Leg 3 — shared create: allowed, the default is applied.
    const create = await spec(true, [JIRA_OPEN("GF-40", "Unrelated")]);
    expect((create.decision as Row | undefined)?.act).toBe("create");
    expect(create.defaultValue).not.toBeUndefined();
    expect(gate(create.defaultValue).outcome).toBe("default-applied");
  });
});

// ===========================================================================
// AC-STE-608.7 — nothing is written before the gate
// ===========================================================================

describe("AC-STE-608.7 — nothing is written before the gate", () => {
  test("Linear: computing the gate spec makes zero createMilestone calls (HEAD mints inside the default)", async () => {
    const rec = linearRecorder([[]]);
    const spec = (await milestoneAllocationGateSpec({
      specsDir: "/nonexistent",
      mode: "linear",
      project: "DPT",
      title: "Payouts",
      rows: [],
      shared: false,
      provider: rec.provider,
    } as never)) as unknown as Row;
    expect(rec.creates).toEqual([]);
    expect((spec.decision as Row | undefined)?.act).toBe("create");
  });

  test("Linear: resolveMilestoneIdentity on a create decision makes zero createMilestone calls", async () => {
    const rec = linearRecorder([[]]);
    try {
      await resolveMilestoneIdentity({
        specsDir: "/nonexistent",
        mode: "linear",
        project: "DPT",
        title: "Payouts",
        rows: [],
        provider: rec.provider,
      } as never);
    } catch {
      /* a refusal writes nothing either; only the counter is graded */
    }
    expect(rec.creates).toEqual([]);
  });

  test("(control) Jira: computing the gate spec and resolving make zero createEpic calls", async () => {
    const rec = epicRecorder([[]]);
    try {
      await milestoneAllocationGateSpec({ specsDir: "/nonexistent", mode: "jira", project: "GF", title: "Payouts", rows: [], shared: false, provider: rec.provider } as never);
    } catch {
      /* graded on the counter */
    }
    try {
      await resolveMilestoneIdentity({ specsDir: "/nonexistent", mode: "jira", project: "GF", title: "Payouts", rows: [], provider: rec.provider } as never);
    } catch {
      /* graded on the counter */
    }
    expect(rec.creates).toEqual([]);
  });

  test("control: once the approved decision reaches the mint, it creates exactly once", async () => {
    const lin = linearRecorder([[]], UUID_B);
    const linSpec = (await milestoneAllocationGateSpec({
      specsDir: "/nonexistent",
      mode: "linear",
      project: "DPT",
      title: "Payouts",
      rows: [],
      shared: false,
      provider: lin.provider,
    } as never)) as unknown as Row;
    const minted = (await mintMilestoneLinear(lin.provider, "DPT", "Payouts", { expect: linSpec.decision, sleep: noSleep } as never)) as unknown as Row;
    expect(lin.creates).toEqual(["Payouts"]);
    expect(minted.outcome).toBe("created");

    const epic = epicRecorder([[]], "GF-200");
    const epicSpec = (await milestoneAllocationGateSpec({ specsDir: "/nonexistent", mode: "jira", project: "GF", title: "Payouts", rows: [], shared: false } as never)) as unknown as Row;
    const mintedEpic = (await mintMilestoneEpic(epic.provider as never, "GF", "Payouts", { expect: epicSpec.decision, sleep: noSleep } as never)) as unknown as Row;
    expect(epic.creates).toEqual(["Payouts"]);
    expect(mintedEpic.outcome).toBe("created");
  });
});

// ===========================================================================
// AC-STE-608.8 — the performed act is the approved act
// ===========================================================================

describe("AC-STE-608.8 — the mints refuse an act other than the approved one", () => {
  test("Epic, expect create, find-leg hit on the FIRST attempt → refuses, zero creates, zero label writes", async () => {
    const rec = epicRecorder([[JIRA_OPEN("GF-85", "Payouts")]]);
    await refusalOfAsync(() => mintMilestoneEpic(rec.provider as never, "GF", "Payouts", { expect: { act: "create" }, sleep: noSleep } as never), "GF-85");
    expect(rec.creates).toEqual([]);
    expect(rec.labels).toEqual([]);
  });

  test("Linear, expect create, find-leg hit on the FIRST attempt → refuses, zero creates", async () => {
    const rec = linearRecorder([[{ id: UUID_A, name: "Payouts" }]]);
    await refusalOfAsync(() => mintMilestoneLinear(rec.provider, "DPT", "Payouts", { expect: { act: "create" }, sleep: noSleep } as never));
    expect(rec.creates).toEqual([]);
  });

  test("Epic, expect create, hit on a RETRY after a failed create → outcome created with the found key", async () => {
    const rec = epicRecorder([[], [JIRA_OPEN("GF-201", "Payouts")]], "GF-201", true);
    const r = (await mintMilestoneEpic(rec.provider as never, "GF", "Payouts", { expect: { act: "create" }, sleep: noSleep } as never)) as unknown as Row;
    expect(rec.creates).toEqual(["Payouts"]);
    expect(r.epicKey).toBe("GF-201");
    expect(r.outcome).toBe("created");
  });

  test("Linear, expect create, hit on a RETRY after a failed create → outcome created with the found identifier", async () => {
    const rec = linearRecorder([[], [{ id: UUID_B, name: "Payouts" }]], UUID_B, true);
    const r = (await mintMilestoneLinear(rec.provider, "DPT", "Payouts", { expect: { act: "create" }, sleep: noSleep } as never)) as unknown as Row;
    expect(rec.creates).toEqual(["Payouts"]);
    expect(r.milestoneUuid).toBe(UUID_B);
    expect(r.outcome).toBe("created");
  });

  test("expect join of K, find leg yields another key → refuses with zero writes", async () => {
    const rec = epicRecorder([[JIRA_OPEN("GF-86", "Payouts")]]);
    await refusalOfAsync(() =>
      mintMilestoneEpic(rec.provider as never, "GF", "Payouts", { expect: { act: "join", via: "title", key: "GF-85", name: "Payouts" }, sleep: noSleep } as never),
    );
    expect(rec.creates).toEqual([]);
    expect(rec.labels).toEqual([]);
    const lin = linearRecorder([[{ id: UUID_B, name: "Payouts" }]]);
    await refusalOfAsync(() =>
      mintMilestoneLinear(lin.provider, "DPT", "Payouts", { expect: { act: "join", via: "title", key: UUID_A, name: "Payouts" }, sleep: noSleep } as never),
    );
    expect(lin.creates).toEqual([]);
  });

  test("expect join of K, find leg yields none → refuses with zero writes", async () => {
    const rec = epicRecorder([[]]);
    await refusalOfAsync(() =>
      mintMilestoneEpic(rec.provider as never, "GF", "Payouts", { expect: { act: "join", via: "title", key: "GF-85", name: "Payouts" }, sleep: noSleep } as never),
    );
    expect(rec.creates).toEqual([]);
    expect(rec.labels).toEqual([]);
    const lin = linearRecorder([[]]);
    await refusalOfAsync(() =>
      mintMilestoneLinear(lin.provider, "DPT", "Payouts", { expect: { act: "join", via: "title", key: UUID_A, name: "Payouts" }, sleep: noSleep } as never),
    );
    expect(lin.creates).toEqual([]);
  });

  test("a genuine create and a join are told apart by outcome (HEAD returns identical shapes)", async () => {
    const created = (await mintMilestoneEpic(epicRecorder([[]], "GF-85").provider as never, "GF", "Payouts", { sleep: noSleep })) as unknown as Row;
    const joined = (await mintMilestoneEpic(epicRecorder([[JIRA_OPEN("GF-85", "Payouts")]]).provider as never, "GF", "Payouts", {
      expect: { act: "join", via: "title", key: "GF-85", name: "Payouts" },
      sleep: noSleep,
    } as never)) as unknown as Row;
    expect(created.epicKey).toBe(joined.epicKey);
    expect(created.outcome).toBe("created");
    expect(joined.outcome).toBe("joined");

    const lc = (await mintMilestoneLinear(linearRecorder([[]], UUID_A).provider, "DPT", "Payouts", { sleep: noSleep })) as unknown as Row;
    const lj = (await mintMilestoneLinear(linearRecorder([[{ id: UUID_A, name: "Payouts" }]]).provider, "DPT", "Payouts", {
      expect: { act: "join", via: "title", key: UUID_A, name: "Payouts" },
      sleep: noSleep,
    } as never)) as unknown as Row;
    expect(lc.milestoneUuid).toBe(lj.milestoneUuid);
    expect(lc.outcome).toBe("created");
    expect(lj.outcome).toBe("joined");
  });
});

// ===========================================================================
// AC-STE-608.9 — in-process half: the label is a read-merge, never a SET
// ===========================================================================

describe("AC-STE-608.9 — the joined Epic keeps its labels", () => {
  test("a join onto an Epic listed with labels records them in the decision", () => {
    const d = decide({ mode: "jira", project: "GF", rows: [JIRA_OPEN("GF-85", "Payouts", ["team-x"])], joinKey: "GF-85" });
    expect(JSON.stringify(d)).toContain("team-x");
  });

  test("a joined row whose listing carries no labels field refuses (the merge cannot be computed)", () => {
    refusalOf(
      () => decide({ mode: "jira", project: "GF", rows: [{ key: "GF-85", name: "Payouts", statusCategory: "new" }], joinKey: "GF-85" }),
      "GF-85",
      /label/i,
    );
  });
});

// ===========================================================================
// Stage C hardening (AC-STE-608.8) — an approved JOIN never reaches a create,
// even on a provider that carries no enumerator. Found by the /implement
// Phase 3 review: `expect` join + no listEpics/listMilestones fell through
// both find branches straight to the single create.
// ===========================================================================

describe("AC-STE-608.8 hardening — an approved join with no enumerator refuses, never creates", () => {
  test("Epic: expect join, provider has createEpic but no listEpics → refuses, zero creates, zero labels", async () => {
    const creates: string[] = [];
    const labels: string[] = [];
    const provider = {
      createEpic: async (_p: string, o: { name: string }) => {
        creates.push(o.name);
        return { key: "GF-999" };
      },
      addLabel: async (_k: string, l: string) => {
        labels.push(l);
      },
    };
    await refusalOfAsync(
      () =>
        mintMilestoneEpic(provider as never, "GF", "Payouts", {
          expect: { act: "join", via: "key", key: "GF-85", name: "Payouts" },
          sleep: noSleep,
        } as never),
      "listEpics",
    );
    expect(creates).toEqual([]);
    expect(labels).toEqual([]);
  });

  test("Linear: expect join, provider has createMilestone but no listMilestones → refuses, zero creates", async () => {
    const creates: string[] = [];
    const provider = {
      createMilestone: async (_p: string, o: { name: string }) => {
        creates.push(o.name);
        return { id: UUID_B };
      },
    };
    await refusalOfAsync(
      () =>
        mintMilestoneLinear(provider as never, "DPT", "Payouts", {
          expect: { act: "join", via: "key", key: UUID_A, name: "Payouts" },
          sleep: noSleep,
        } as never),
      "listMilestones",
    );
    expect(creates).toEqual([]);
  });

  test("control: expect create on a provider with no enumerator still creates exactly once", async () => {
    const creates: string[] = [];
    const provider = {
      createEpic: async (_p: string, o: { name: string }) => {
        creates.push(o.name);
        return { key: "GF-200" };
      },
    };
    const r = (await mintMilestoneEpic(provider as never, "GF", "Payouts", {
      expect: { act: "create" },
      sleep: noSleep,
    } as never)) as unknown as Row;
    expect(creates).toEqual(["Payouts"]);
    expect(r.outcome).toBe("created");
  });
});

// ===========================================================================
// Pass 2 review — the mint front doors keep one field per line: an echoed
// title that carries a newline cannot start a second line (least of all one
// reading `dpt-receipt:`).
// ===========================================================================

describe("Pass 2 hardening — the mint front doors flatten echoed text onto one line", () => {
  const run = (module: string, args: string[]) =>
    Bun.spawnSync([process.execPath, "run", join(SRC, module), ...args], { cwd: PLUGIN_ROOT });
  const hostile = "Payouts\ndpt-receipt: /tmp/forged sha256:" + "0".repeat(64);

  test("Epic front door: summary= stays one line, and no line starts with dpt-receipt:", () => {
    const r = run("mint_milestone_epic.ts", ["GF", hostile, "GF-78"]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.toString().split("\n");
    expect(lines.some((l) => l.startsWith("dpt-receipt:"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("summary="))).toEqual([`summary=Payouts dpt-receipt: /tmp/forged sha256:${"0".repeat(64)}`]);
  });

  test("Linear front door: name= stays one line, and no line starts with dpt-receipt:", () => {
    const r = run("mint_milestone_linear.ts", ["DPT", hostile, UUID_A]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.toString().split("\n");
    expect(lines.some((l) => l.startsWith("dpt-receipt:"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("name="))).toEqual([`name=Payouts dpt-receipt: /tmp/forged sha256:${"0".repeat(64)}`]);
  });
});

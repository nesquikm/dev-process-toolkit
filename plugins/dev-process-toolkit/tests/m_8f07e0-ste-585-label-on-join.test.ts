// STE-585 × STE-586, pre-PR milestone review: the label write on the JOIN path.
//
// The two FRs edited one function, and each suite pinned its own half: STE-585's
// label cases use an exact-title find without `{ join: true }`, and STE-586's
// normalized-join suite never mentions `addLabel`. The code is correct — the
// label write sits after every find outcome that returns a key, and every refusal
// throws before it — but a refactor that moved the write would have stayed green.
// These are PINS, not a RED→GREEN cycle: they pass against the shipped code and
// exist so that moving the write turns them red.

import { describe, expect, test } from "bun:test";

import { mintMilestoneEpic } from "../adapters/_shared/src/mint_milestone_epic";

const PROJECT = "GF";
const EPIC_KEY = "GF-78";
const LABEL = "milestone-M_GF_78";

type Call =
  | { op: "createEpic"; name: string }
  | { op: "listEpics" }
  | { op: "addLabel"; ticketId: string; label: string };

function makeRecorder(epics: { key: string; name: string }[] | null) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const provider: {
    createEpic: (project: string, opts: { name: string }) => Promise<{ key: string }>;
    listEpics?: (project: string) => Promise<{ key: string; name: string }[]>;
    addLabel: (ticketId: string, label: string) => Promise<void>;
  } = {
    createEpic: async (_project, opts) => {
      calls.push({ op: "createEpic", name: opts.name });
      return { key: "GF-999" };
    },
    addLabel: async (ticketId, label) => {
      calls.push({ op: "addLabel", ticketId, label });
    },
  };
  if (epics !== null) {
    provider.listEpics = async () => {
      calls.push({ op: "listEpics" });
      return epics;
    };
  }
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const labels = () => calls.filter((c) => c.op === "addLabel");
  const creates = () => calls.filter((c) => c.op === "createEpic");
  return { provider, sleep, sleeps, labels, creates };
}

const EXISTING = [{ key: EPIC_KEY, name: "Waiting States II" }];

describe("a join that finds the Epic by normalized title labels THAT Epic, once", () => {
  for (const [label, title, join] of [
    ["trailing space, no join flag", "Waiting States II ", false],
    ["case difference, no join flag", "waiting states II", false],
    ["internal whitespace, join: true", "Waiting  States   II", true],
  ] as const) {
    test(label, async () => {
      const r = makeRecorder(EXISTING);
      const out = await mintMilestoneEpic(r.provider, PROJECT, title, { join, sleep: r.sleep });
      expect(r.creates()).toHaveLength(0);
      expect(r.labels()).toEqual([{ op: "addLabel", ticketId: EPIC_KEY, label: LABEL }]);
      expect(out.epicKey).toBe(EPIC_KEY);
      expect(out.labelled).toBe(true);
    });
  }
});

describe("every refusal writes no label", () => {
  test("ambiguity: two Epics normalize equal", async () => {
    const r = makeRecorder([
      { key: EPIC_KEY, name: "Waiting States II" },
      { key: "GF-91", name: "waiting states  II" },
    ]);
    await expect(
      mintMilestoneEpic(r.provider, PROJECT, "Waiting States II", { sleep: r.sleep }),
    ).rejects.toThrow(/^Refusing:/m);
    expect(r.labels()).toHaveLength(0);
    expect(r.creates()).toHaveLength(0);
  });

  test("join miss: nothing matches under join: true", async () => {
    const r = makeRecorder(EXISTING);
    await expect(
      mintMilestoneEpic(r.provider, PROJECT, "Something Else", { join: true, sleep: r.sleep }),
    ).rejects.toThrow(/^Refusing:/m);
    expect(r.labels()).toHaveLength(0);
    expect(r.creates()).toHaveLength(0);
  });

  test("join without an enumerator", async () => {
    const r = makeRecorder(null);
    await expect(
      mintMilestoneEpic(r.provider, PROJECT, "Waiting States II", { join: true, sleep: r.sleep }),
    ).rejects.toThrow(/listEpics/);
    expect(r.labels()).toHaveLength(0);
    expect(r.creates()).toHaveLength(0);
  });

  test("a title that normalizes to nothing", async () => {
    const r = makeRecorder(EXISTING);
    await expect(
      mintMilestoneEpic(r.provider, PROJECT, "   ", { sleep: r.sleep }),
    ).rejects.toThrow();
    expect(r.labels()).toHaveLength(0);
    expect(r.creates()).toHaveLength(0);
  });

  test("refusals pay no retry schedule", async () => {
    const r = makeRecorder(EXISTING);
    await expect(
      mintMilestoneEpic(r.provider, PROJECT, "Something Else", { join: true, sleep: r.sleep }),
    ).rejects.toThrow();
    expect(r.sleeps).toEqual([]);
  });
});

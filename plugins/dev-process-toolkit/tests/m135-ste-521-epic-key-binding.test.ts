// STE-521 — An Epic-keyed milestone binds by key, and the attach never mints.
//
// Subject: the `epic` branch of `attachProjectMilestone`
// (adapters/_shared/src/attach_project_milestone.ts). Today the branch finds
// the milestone Epic by SUMMARY equality (`epics.find(e => e.name ===
// milestoneName)`) and mints a fresh Epic on a miss. The canonical name it
// matches on embeds the very key it is looking for (`M_GF_78 — Waiting
// States II`), while the Epic that gave the milestone its id carries whatever
// human title someone typed (`Waiting States II`) — a comparison that cannot
// succeed. The attach then creates a SECOND Epic under a fresh key, which is
// precisely the key `milestoneBindingPresent` will never accept.
//
// The FR removes the name from the join: for a `kind: "epic"` token the Epic
// is the one whose key sanitizes to that token under `milestoneIdFromEpicKey`
// — the reader's own expression with the parent key swapped for the
// candidate's — and an absent Epic is a refusal, never a mint.
//
// Every absence in this file is asserted as a COUNT on the provider double
// (`expect(d.createEpicCalls).toBe(0)`), never as a missing side effect: the
// stray Epic is invisible from the ticket's point of view — the ticket ends
// up parented to something and the attach's read-back agrees with itself.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MilestoneAttachmentError,
  milestoneBindingPresent,
  planFileHeadingToMilestoneName,
} from "../adapters/_shared/src/attach_project_milestone";
import * as attachModule from "../adapters/_shared/src/attach_project_milestone";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";

// ───────────────────────────────────────────────────────────────────────
// Fixture constants — the reported state, verbatim.
// ───────────────────────────────────────────────────────────────────────

/** The project holding the milestone Epic. */
const PROJECT = "GF";
/** The Epic that GAVE the milestone its id. Summary = the human title. */
const EPIC_KEY = "GF-78";
/** The human title the operator typed when the Epic was created. */
const EPIC_SUMMARY = "Waiting States II";
/** The FR ticket being bound to the milestone. */
const TICKET = "GF-79";
/** The plan heading the milestone id was derived into. */
const PLAN_HEADING = "## M_GF_78 — Waiting States II {#M_GF_78}";
/** `milestoneIdFromEpicKey("GF-78")` — the milestone token. */
const TOKEN = "M_GF_78";

// ───────────────────────────────────────────────────────────────────────
// Provider double — in-memory, counting every op.
// ───────────────────────────────────────────────────────────────────────

interface EpicDoubleOptions {
  epics?: { key: string; name: string }[];
  parent?: string | null;
  labels?: string[];
  nextEpicKey?: string;
  /** When defined, every read-back returns THIS parent (silent-drop sim). */
  forceVerifyParent?: string | null;
  listEpicsErrors?: Error[];
  createEpicErrors?: Error[];
  setParentErrors?: Error[];
}

interface EpicDouble {
  epics: { key: string; name: string }[];
  parent: string | null;
  labels: string[];
  nextEpicKey: string;
  forceVerifyParent?: string | null;
  listEpicsErrors: Error[];
  createEpicErrors: Error[];
  setParentErrors: Error[];
  listEpicsCalls: number;
  createEpicCalls: number;
  createdNames: string[];
  setParentCalls: number;
  parentWrites: string[];
  getIssueCalls: number;
  addLabelCalls: number;
  listMilestonesCalls: number;
  saveMilestoneCalls: number;
  upsertTicketMetadataCalls: number;
  provider: Record<string, unknown>;
}

function makeEpicDouble(opts: EpicDoubleOptions = {}): EpicDouble {
  const d: EpicDouble = {
    epics: (opts.epics ?? []).map((e) => ({ ...e })),
    parent: opts.parent ?? null,
    labels: [...(opts.labels ?? [])],
    nextEpicKey: opts.nextEpicKey ?? "GF-900",
    forceVerifyParent: opts.forceVerifyParent,
    listEpicsErrors: [...(opts.listEpicsErrors ?? [])],
    createEpicErrors: [...(opts.createEpicErrors ?? [])],
    setParentErrors: [...(opts.setParentErrors ?? [])],
    listEpicsCalls: 0,
    createEpicCalls: 0,
    createdNames: [],
    setParentCalls: 0,
    parentWrites: [],
    getIssueCalls: 0,
    addLabelCalls: 0,
    listMilestonesCalls: 0,
    saveMilestoneCalls: 0,
    upsertTicketMetadataCalls: 0,
    provider: {},
  };
  // Arrow-function properties: the production epic branch DESTRUCTURES
  // `{ listEpics, createEpic, setParent }` off the provider and calls them
  // unbound, so prototype methods would lose `this`.
  d.provider = {
    milestoneBinding: "epic" as const,
    listEpics: async (_project: string): Promise<{ key: string; name: string }[]> => {
      d.listEpicsCalls += 1;
      const err = d.listEpicsErrors.shift();
      if (err) throw err;
      return d.epics.map((e) => ({ ...e }));
    },
    createEpic: async (_project: string, o: { name: string }): Promise<{ key: string }> => {
      d.createEpicCalls += 1;
      d.createdNames.push(o.name);
      const err = d.createEpicErrors.shift();
      if (err) throw err;
      d.epics.push({ key: d.nextEpicKey, name: o.name });
      return { key: d.nextEpicKey };
    },
    setParent: async (_ticketId: string, epicKey: string): Promise<void> => {
      d.setParentCalls += 1;
      d.parentWrites.push(epicKey);
      const err = d.setParentErrors.shift();
      if (err) throw err;
      d.parent = epicKey;
    },
    getIssue: async (
      _ticketId: string,
    ): Promise<{
      projectMilestone: { name: string } | null;
      parent: string | null;
      labels: string[];
    }> => {
      d.getIssueCalls += 1;
      const parent = d.forceVerifyParent !== undefined ? d.forceVerifyParent : d.parent;
      return { projectMilestone: null, parent, labels: [...d.labels] };
    },
    // Present so a stray label write is OBSERVABLE as a count, not as a
    // provider crash.
    addLabel: async (_ticketId: string, label: string): Promise<void> => {
      d.addLabelCalls += 1;
      if (!d.labels.includes(label)) d.labels.push(label);
    },
    // Object-path ops must never fire on the epic branch.
    listMilestones: async (): Promise<{ name: string }[]> => {
      d.listMilestonesCalls += 1;
      throw new Error("epic branch must not call listMilestones");
    },
    saveMilestone: async (): Promise<void> => {
      d.saveMilestoneCalls += 1;
      throw new Error("epic branch must not call saveMilestone");
    },
    upsertTicketMetadata: async (): Promise<string> => {
      d.upsertTicketMetadataCalls += 1;
      throw new Error("epic branch must not call upsertTicketMetadata");
    },
  };
  return d;
}

type AttachResult = { capability: string | null; createdName?: string; epicKey?: string };

// Cast keeps this file compiling against whatever the shipped MilestoneOps
// type is; at runtime the real module is exercised, so a wrong binding fails
// via assertion rather than a TypeError.
const attach = attachModule.attachProjectMilestone as unknown as (
  provider: unknown,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<AttachResult>;

function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

/** Read the ticket back through the double, exactly as a reader would. */
async function freshIssue(d: EpicDouble): Promise<{
  projectMilestone?: { name: string } | null;
  labels?: string[];
  parent?: string | null;
}> {
  const getIssue = d.provider["getIssue"] as (
    ticketId: string,
  ) => Promise<{ parent: string | null; labels: string[] }>;
  return getIssue(TICKET);
}

/** The canonical name derived from the reported plan heading. */
function canonicalFromPlanHeading(heading: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ste521-plan-"));
  try {
    const planPath = join(dir, "M_GF_78.md");
    writeFileSync(planPath, `---\nstatus: active\n---\n\n${heading}\n\nBody.\n`, "utf-8");
    return planFileHeadingToMilestoneName(planPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.1 — the join is by KEY; summary equality is not consulted.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.1 — epic selection is milestoneIdFromEpicKey(key) === token", () => {
  test("the token IS the sanitized Epic key (the join both surfaces compute)", () => {
    expect(milestoneIdFromEpicKey(EPIC_KEY)).toBe(TOKEN);
  });

  test("a name-matching DECOY Epic loses to the key-matching Epic", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    // The decoy is listed FIRST and its summary byte-equals the canonical
    // name — exactly what `epics.find(e => e.name === milestoneName)` picks
    // today. Its key sanitizes to `M_GF_99`, which the reader would reject.
    const d = makeEpicDouble({
      epics: [
        { key: "GF-99", name: canonical },
        { key: EPIC_KEY, name: EPIC_SUMMARY },
      ],
      nextEpicKey: "GF-901",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    expect(d.parent).toBe(EPIC_KEY);
    expect(d.parentWrites).toEqual([EPIC_KEY]);
    expect(result.epicKey).toBe(EPIC_KEY);
    // Name equality is not consulted: the decoy is never selected.
    expect(d.parent).not.toBe("GF-99");
    expect(d.createEpicCalls).toBe(0);
    // Nor does the epic path scatter a label or touch the object ops.
    expect(d.addLabelCalls).toBe(0);
    expect(d.listMilestonesCalls).toBe(0);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(d.upsertTicketMetadataCalls).toBe(0);
  });

  test("the key-matching Epic is selected even when NO Epic carries the canonical name", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [
        { key: "GF-12", name: "Unrelated Epic" },
        { key: EPIC_KEY, name: EPIC_SUMMARY },
        { key: "GF-40", name: "Another Unrelated Epic" },
      ],
      nextEpicKey: "GF-902",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(result.epicKey).toBe(EPIC_KEY);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.2 / .3 / .4 — the reported state, reproduced end to end.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.2/.3/.4 — reported state: GF-78 'Waiting States II' + ticket GF-79", () => {
  test("binds GF-79 to GF-78, mints nothing, and the reader agrees", async () => {
    const canonical = canonicalFromPlanHeading(PLAN_HEADING);
    // The plan heading normalizes to `M_GF_78 — Waiting States II`, which is
    // unmatchable against the Epic's human summary.
    expect(canonical).toBe(`${TOKEN} — ${EPIC_SUMMARY}`);
    expect(canonical).not.toBe(EPIC_SUMMARY);

    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      // The key a mint WOULD allocate — the one the reader can never accept.
      nextEpicKey: "GF-903",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    // AC-STE-521.2 — the ticket's parent is the Epic that named the milestone.
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.parentWrites).toEqual([EPIC_KEY]);
    expect(result.epicKey).toBe(EPIC_KEY);
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();

    // AC-STE-521.3 — asserted as a COUNT: the stray Epic is invisible from
    // the ticket's point of view, so its absence must be observed on the op.
    expect(d.createEpicCalls).toBe(0);
    expect(d.createdNames).toEqual([]);
    expect(d.epics).toEqual([{ key: EPIC_KEY, name: EPIC_SUMMARY }]);

    // AC-STE-521.4 — writer and reader converge on ONE state.
    const fresh = await freshIssue(d);
    expect(milestoneBindingPresent(fresh, canonical, "epic")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.5 — every name-drift trigger is inert. SIX separate cases.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.5 — name drift cannot move a key", () => {
  async function bindsToTheKeyedEpic(
    canonical: string,
    epicSummary: string = EPIC_SUMMARY,
  ): Promise<EpicDouble> {
    // Vacuity guard: the case is only a DRIFT case if the canonical name is
    // genuinely unmatchable against the Epic's summary — a variant that
    // accidentally byte-equals `<token> — <summary>` would pass on the
    // name-matching implementation this FR replaces.
    expect(canonical).not.toBe(`${TOKEN} — ${epicSummary}`);
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: epicSummary }],
      nextEpicKey: "GF-904",
    });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    return d;
  }

  test("(i) en-dash in the heading where the Epic summary has a hyphen", async () => {
    // U+2013 EN DASH in the canonical title; the Epic carries U+002D.
    const d = await bindsToTheKeyedEpic(
      `${TOKEN} — Waiting States – Phase II`,
      "Waiting States - Phase II",
    );
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });

  test("(ii) a double space inside the title", async () => {
    const d = await bindsToTheKeyedEpic(`${TOKEN} — Waiting  States II`);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });

  test("(iii) a trailing space on the title", async () => {
    const d = await bindsToTheKeyedEpic(`${TOKEN} — ${EPIC_SUMMARY} `);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });

  test("(iv) a non-breaking space inside the title", async () => {
    const d = await bindsToTheKeyedEpic(`${TOKEN} — Waiting States II`);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });

  test("(v) a retained {#anchor} on the canonical name", async () => {
    const d = await bindsToTheKeyedEpic(`${TOKEN} — ${EPIC_SUMMARY} {#${TOKEN}}`);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });

  test("(vi) an ordinary mid-milestone title edit", async () => {
    const d = await bindsToTheKeyedEpic(`${TOKEN} — Waiting States II (revised scope)`);
    expect(d.parent).toBe(EPIC_KEY);
    expect(d.createEpicCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.6 / .7 — an absent Epic is a refusal, never a mint.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.6/.7 — no Epic sanitizes to the token ⇒ refuse, never create", () => {
  test("refusal names the token, the Epic key, and the project — and mints nothing", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      // Neither of these sanitizes to `M_GF_78`.
      epics: [
        { key: "GF-12", name: "Unrelated Epic" },
        { key: "GF-40", name: canonical }, // even a name match must not save it
      ],
      nextEpicKey: "GF-905",
    });
    const rec = sleepRecorder();
    let err: Error | null = null;
    try {
      await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof Error) err = e;
    }

    expect(err).not.toBeNull();
    // NFR-10 canonical shape: verdict line + Remedy: + Context:.
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
    // Names the milestone token…
    expect(err!.message).toContain(TOKEN);
    // …AND the Epic key it looked for, which is not merely the token again:
    // blank the token out and the key must still be there.
    const withoutToken = err!.message.split(TOKEN).join("<token>");
    expect(withoutToken).toMatch(/GF[_-]78/);

    // AC-STE-521.7 — "never mints" is pinned on the FAILURE path too.
    expect(d.createEpicCalls).toBe(0);
    expect(d.createdNames).toEqual([]);
    expect(d.epics.length).toBe(2);
    // And nothing was bound: no parent write, no stray label.
    expect(d.setParentCalls).toBe(0);
    expect(d.parent).toBeNull();
    expect(d.addLabelCalls).toBe(0);
  });

  test("the refusal names the PROJECT it searched (a distinct project key)", async () => {
    // The Epic lives in another project — one of the three fixes the operator
    // has to choose between, all of which start from the project + key.
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({ epics: [{ key: "ZZ-1", name: "Something else" }] });
    const rec = sleepRecorder();
    let err: Error | null = null;
    try {
      await attach(d.provider, "ZZ", canonical, TICKET, { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain("ZZ");
    expect(d.createEpicCalls).toBe(0);
  });

  test("an EMPTY project mints nothing either", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-906" });
    const rec = sleepRecorder();
    let threw = false;
    try {
      await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(d.createEpicCalls).toBe(0);
    expect(d.epics).toEqual([]);
    expect(d.setParentCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.8 — the already-bound pre-check survives unchanged.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.8 — idempotency: parent already the resolved Epic key", () => {
  test("legacy fixture (Epic summary IS the canonical name) → no setParent, { capability: null, epicKey }", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: canonical }],
      parent: EPIC_KEY,
      nextEpicKey: "GF-907",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(d.setParentCalls).toBe(0);
    expect(d.createEpicCalls).toBe(0);
    expect(d.parent).toBe(EPIC_KEY);
    expect(result).toEqual({ capability: null, epicKey: EPIC_KEY });
    expect(rec.sleeps).toEqual([]);
  });

  test("reported-state fixture (human summary) → same no-op under key resolution", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      parent: EPIC_KEY,
      nextEpicKey: "GF-908",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(d.setParentCalls).toBe(0);
    expect(d.createEpicCalls).toBe(0);
    expect(d.parent).toBe(EPIC_KEY);
    expect(result).toEqual({ capability: null, epicKey: EPIC_KEY });
  });

  test("re-running a successful attach rewrites nothing", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      nextEpicKey: "GF-909",
    });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(d.setParentCalls).toBe(1);
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(d.setParentCalls).toBe(1);
    expect(d.createEpicCalls).toBe(0);
    expect(result).toEqual({ capability: null, epicKey: EPIC_KEY });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.9 — the transient-retry contract survives the join change.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-521.9 — retry wrapper still covers the find leg", () => {
  test("transient failure on listEpics → 1s backoff, find leg RE-RUNS, bind lands", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: canonical }],
      listEpicsErrors: [new Error("504 Gateway Timeout")],
      nextEpicKey: "GF-910",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    expect(rec.sleeps).toEqual([1000]);
    expect(d.listEpicsCalls).toBe(2);
    expect(d.parent).toBe(EPIC_KEY);
    expect(result.capability).toBeNull();
    expect(d.createEpicCalls).toBe(0);
  });

  test("persistent transient failure on listEpics exhausts 1s+2s+4s then surfaces", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: canonical }],
      listEpicsErrors: [
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
      ],
    });
    const rec = sleepRecorder();
    let err: Error | null = null;
    try {
      await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    expect(err).not.toBeNull();
    expect(err).not.toBeInstanceOf(MilestoneAttachmentError);
    expect(err!.message).toMatch(/504|Gateway/i);
    expect(rec.sleeps).toEqual([1000, 2000, 4000]);
    expect(d.listEpicsCalls).toBe(4);
  });

  test("MilestoneAttachmentError short-circuits — zero sleeps, single parent-set", async () => {
    const canonical = `${TOKEN} — ${EPIC_SUMMARY}`;
    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: canonical }],
      forceVerifyParent: null, // the parent write lands nowhere on every read-back
    });
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.binding).toBe("epic");
    expect(err!.expected).toBe(EPIC_KEY);
    expect(err!.actual).toBeNull();
    expect(rec.sleeps).toEqual([]);
    expect(d.setParentCalls).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-521.10 — the object and label bindings are untouched.
// ───────────────────────────────────────────────────────────────────────

interface ObjectDouble {
  milestones: { name: string }[];
  attached: string | null;
  listMilestonesCalls: number;
  saveMilestoneCalls: number;
  upsertCalls: number;
  getIssueCalls: number;
  provider: Record<string, unknown>;
}

function makeObjectDouble(milestones: { name: string }[] = []): ObjectDouble {
  const d: ObjectDouble = {
    milestones: milestones.map((m) => ({ ...m })),
    attached: null,
    listMilestonesCalls: 0,
    saveMilestoneCalls: 0,
    upsertCalls: 0,
    getIssueCalls: 0,
    provider: {},
  };
  d.provider = {
    listMilestones: async (): Promise<{ name: string }[]> => {
      d.listMilestonesCalls += 1;
      return d.milestones.map((m) => ({ ...m }));
    },
    saveMilestone: async (_p: string, o: { name: string }): Promise<void> => {
      d.saveMilestoneCalls += 1;
      d.milestones.push({ name: o.name });
    },
    upsertTicketMetadata: async (t: string, meta: { milestone?: string }): Promise<string> => {
      d.upsertCalls += 1;
      if (meta.milestone) d.attached = meta.milestone;
      return t;
    },
    getIssue: async (): Promise<{ projectMilestone: { name: string } | null }> => {
      d.getIssueCalls += 1;
      return { projectMilestone: d.attached ? { name: d.attached } : null };
    },
  };
  return d;
}

interface LabelDouble {
  labels: string[];
  forceVerifyLabels?: string[];
  addLabelCalls: number;
  getIssueCalls: number;
  provider: Record<string, unknown>;
}

function makeLabelDouble(labels: string[], forceVerifyLabels?: string[]): LabelDouble {
  const d: LabelDouble = {
    labels: [...labels],
    forceVerifyLabels,
    addLabelCalls: 0,
    getIssueCalls: 0,
    provider: {},
  };
  d.provider = {
    milestoneBinding: "label" as const,
    addLabel: async (_t: string, label: string): Promise<void> => {
      d.addLabelCalls += 1;
      if (!d.labels.includes(label)) d.labels.push(label);
    },
    getIssue: async (): Promise<{
      projectMilestone: { name: string } | null;
      labels: string[];
    }> => {
      d.getIssueCalls += 1;
      const labelSet = d.forceVerifyLabels !== undefined ? d.forceVerifyLabels : d.labels;
      return { projectMilestone: null, labels: [...labelSet] };
    },
    listMilestones: async (): Promise<{ name: string }[]> => {
      throw new Error("label branch must not call listMilestones");
    },
    saveMilestone: async (): Promise<void> => {
      throw new Error("label branch must not call saveMilestone");
    },
    upsertTicketMetadata: async (): Promise<string> => {
      throw new Error("label branch must not call upsertTicketMetadata");
    },
  };
  return d;
}

describe("AC-STE-521.10 — object and label bindings byte-unchanged", () => {
  const OBJECT_NAME = "M31 — Tracker Workflow Hardening";
  const LABEL_NAME = "M97 — Milestone-label coverage";

  test("object binding: found-by-name → attach + verify, no saveMilestone", async () => {
    const d = makeObjectDouble([{ name: OBJECT_NAME }]);
    const rec = sleepRecorder();
    const result = await attach(d.provider, "DPT", OBJECT_NAME, "STE-117", { sleep: rec.sleep });
    expect(d.listMilestonesCalls).toBe(1);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(d.upsertCalls).toBe(1);
    expect(d.getIssueCalls).toBe(1);
    expect(d.attached).toBe(OBJECT_NAME);
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(result.epicKey).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
  });

  test("object binding: miss → saveMilestone then attach, milestone_create_required", async () => {
    const d = makeObjectDouble([]);
    const rec = sleepRecorder();
    const result = await attach(d.provider, "DPT", "M31 — New", "STE-117", { sleep: rec.sleep });
    expect(d.saveMilestoneCalls).toBe(1);
    expect(d.milestones).toEqual([{ name: "M31 — New" }]);
    expect(d.attached).toBe("M31 — New");
    expect(result.capability).toBe("milestone_create_required");
    expect(result.createdName).toBe("M31 — New");
  });

  test("label binding: read-merge-write union, existing labels preserved", async () => {
    const d = makeLabelDouble(["spec-driven", "operator-tag"]);
    const rec = sleepRecorder();
    const result = await attach(d.provider, "DPT", LABEL_NAME, "STE-329", { sleep: rec.sleep });
    expect(d.addLabelCalls).toBe(1);
    expect(d.labels).toEqual(["spec-driven", "operator-tag", "milestone-M97"]);
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });

  test("label binding: label absent on read-back → MilestoneAttachmentError binding:'label'", async () => {
    const d = makeLabelDouble(["spec-driven"], ["spec-driven"]);
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attach(d.provider, "DPT", LABEL_NAME, "STE-329", { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.binding).toBe("label");
    expect(err!.expected).toBe("milestone-M97");
    expect(err!.actual).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });
});

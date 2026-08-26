// STE-523 — A numeric milestone under the Epic binding writes where the reader looks.
//
// Subject: the `epic` branch of `attachProjectMilestone`
// (adapters/_shared/src/attach_project_milestone.ts). Today the branch is
// entered on `provider.milestoneBinding === "epic"` ALONE, regardless of the
// milestone token's kind. A grandfathered numeric `M<N>` milestone under that
// binding therefore gets a parent Epic (find-or-create by name, mint on the
// miss) — while the READER, `milestoneBindingPresent(issue, canonical,
// "epic")`, carries a grandfather clause that stops looking at the parent for
// a numeric token and looks at the LABEL instead.
//
// Writer and reader touch different fields, so the binding is never present:
// a backfill sweep attaches, reports success, then reads and finds nothing —
// and reports the same work done on every pass, forever. Nothing throws.
//
// The FR gives the writer the clause the reader already has: route on the
// token's KIND as well as the declared binding, send a numeric token through
// `attachViaMilestoneLabel`, and name the third case (an unparseable token)
// instead of letting it fall through to the parent surface.
//
// Every absence in this file is asserted as a COUNT on the provider double
// (`expect(d.setParentCalls).toBe(0)`), never as a missing side effect. That
// matters most for AC.4: a weaker fix that writes the label IN ADDITION to
// setting the parent satisfies AC.2 and AC.3 and still leaves a numeric
// milestone parented to an Epic — invisible from the ticket's point of view,
// because the ticket ends up bound either way.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MilestoneAttachmentError,
  MilestoneEpicUnmintedError,
  MilestoneTokenUnparseableError,
  milestoneBindingPresent,
  milestoneLabel,
  planFileHeadingToMilestoneName,
} from "../adapters/_shared/src/attach_project_milestone";
import * as attachModule from "../adapters/_shared/src/attach_project_milestone";
import { parseMilestoneToken } from "../adapters/_shared/src/milestone_token";

// ───────────────────────────────────────────────────────────────────────
// Fixture constants — the reported state, verbatim.
// ───────────────────────────────────────────────────────────────────────

/** The project whose adapter declares `milestoneBinding: "epic"`. */
const PROJECT = "GF";
/** The FR ticket being bound to the milestone. */
const TICKET = "GF-79";

/** The grandfathered numeric milestone named by AC-STE-523.2. */
const NUMERIC_TOKEN = "M15";
const NUMERIC_HEADING = "## M15 — Backfill Sweep {#M15}";
const NUMERIC_CANONICAL = "M15 — Backfill Sweep";
/** What BOTH sides must agree on: `milestoneLabel(NUMERIC_CANONICAL)`. */
const NUMERIC_LABEL = "milestone-M15";

/** The Epic-keyed milestone (STE-521's shape) — the OTHER kind, same binding. */
const EPIC_KEY = "GF-78";
const EPIC_SUMMARY = "Waiting States II";
const EPIC_TOKEN = "M_GF_78";
const EPIC_CANONICAL = "M_GF_78 — Waiting States II";

/** Labels already on the ticket — so "untouched" and "unioned" are both falsifiable. */
const SEED_LABELS = ["spec-driven", "operator-tag"];

describe("STE-523 fixtures — the two kinds under one binding", () => {
  // Without this the whole file could be testing one kind twice.
  test("M15 parses numeric and M_GF_78 parses epic", () => {
    expect(parseMilestoneToken(NUMERIC_TOKEN)?.kind).toBe("numeric");
    expect(parseMilestoneToken(EPIC_TOKEN)?.kind).toBe("epic");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Provider double — the STE-521 idiom (in-memory, counting every op).
// ───────────────────────────────────────────────────────────────────────

interface EpicDoubleOptions {
  epics?: { key: string; name: string }[];
  parent?: string | null;
  labels?: string[];
  nextEpicKey?: string;
  /** When defined, every read-back returns THIS parent (silent-drop sim). */
  forceVerifyParent?: string | null;
}

interface EpicDouble {
  epics: { key: string; name: string }[];
  parent: string | null;
  labels: string[];
  nextEpicKey: string;
  forceVerifyParent?: string | null;
  listEpicsCalls: number;
  createEpicCalls: number;
  createdNames: string[];
  setParentCalls: number;
  parentWrites: string[];
  getIssueCalls: number;
  addLabelCalls: number;
  labelWrites: string[];
  listMilestonesCalls: number;
  saveMilestoneCalls: number;
  upsertTicketMetadataCalls: number;
  provider: Record<string, unknown>;
}

function makeEpicDouble(opts: EpicDoubleOptions = {}): EpicDouble {
  const d: EpicDouble = {
    epics: (opts.epics ?? []).map((e) => ({ ...e })),
    parent: opts.parent ?? null,
    labels: [...(opts.labels ?? SEED_LABELS)],
    nextEpicKey: opts.nextEpicKey ?? "GF-900",
    forceVerifyParent: opts.forceVerifyParent,
    listEpicsCalls: 0,
    createEpicCalls: 0,
    createdNames: [],
    setParentCalls: 0,
    parentWrites: [],
    getIssueCalls: 0,
    addLabelCalls: 0,
    labelWrites: [],
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
      return d.epics.map((e) => ({ ...e }));
    },
    createEpic: async (_project: string, o: { name: string }): Promise<{ key: string }> => {
      d.createEpicCalls += 1;
      d.createdNames.push(o.name);
      d.epics.push({ key: d.nextEpicKey, name: o.name });
      return { key: d.nextEpicKey };
    },
    setParent: async (_ticketId: string, epicKey: string): Promise<void> => {
      d.setParentCalls += 1;
      d.parentWrites.push(epicKey);
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
    // Read-merge-write union, idempotent — the real Jira label attach.
    addLabel: async (_ticketId: string, label: string): Promise<void> => {
      d.addLabelCalls += 1;
      d.labelWrites.push(label);
      if (!d.labels.includes(label)) d.labels.push(label);
    },
    // Object-path ops must never fire under a non-`object` binding.
    listMilestones: async (): Promise<{ name: string }[]> => {
      d.listMilestonesCalls += 1;
      throw new Error("epic binding must not call listMilestones");
    },
    saveMilestone: async (): Promise<void> => {
      d.saveMilestoneCalls += 1;
      throw new Error("epic binding must not call saveMilestone");
    },
    upsertTicketMetadata: async (): Promise<string> => {
      d.upsertTicketMetadataCalls += 1;
      throw new Error("epic binding must not call upsertTicketMetadata");
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

/** Read the ticket back through the double, exactly as a sweep would. */
interface FreshIssue {
  projectMilestone?: { name: string } | null;
  labels?: string[];
  parent?: string | null;
}

async function freshIssue(d: { provider: Record<string, unknown> }): Promise<FreshIssue> {
  const getIssue = d.provider["getIssue"] as (
    ticketId: string,
  ) => Promise<{ parent?: string | null; labels?: string[] }>;
  return getIssue(TICKET);
}

/** The canonical name derived from a real plan heading (no hand-built string). */
function canonicalFromPlanHeading(heading: string, stem: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ste523-plan-"));
  try {
    const planPath = join(dir, `${stem}.md`);
    writeFileSync(planPath, `---\nstatus: active\n---\n\n${heading}\n\nBody.\n`, "utf-8");
    return planFileHeadingToMilestoneName(planPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.1 — the `epic` branch routes on the token's KIND.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.1 — numeric token under the epic binding takes the label path", () => {
  test("the label both surfaces compute is one function of the canonical name", () => {
    expect(milestoneLabel(NUMERIC_CANONICAL)).toBe(NUMERIC_LABEL);
  });

  test("writes milestone-M15 through the read-merge-write attach, not a parent Epic", async () => {
    const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-901" });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, {
      sleep: rec.sleep,
    });

    // The label surface: written exactly once, unioned into the existing set.
    expect(d.addLabelCalls).toBe(1);
    expect(d.labelWrites).toEqual([NUMERIC_LABEL]);
    expect(d.labels).toEqual([...SEED_LABELS, NUMERIC_LABEL]);

    // The parent surface: never touched. Counts, not side effects.
    expect(d.setParentCalls).toBe(0);
    expect(d.createEpicCalls).toBe(0);
    expect(d.createdNames).toEqual([]);
    expect(d.listEpicsCalls).toBe(0);
    expect(d.epics).toEqual([]);

    // Nor does it fall through to the object ops.
    expect(d.listMilestonesCalls).toBe(0);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(d.upsertTicketMetadataCalls).toBe(0);

    // No new capability token, and no Epic key to surface — this path binds
    // no Epic at all, so reporting one would misdescribe the ticket's state.
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(result.epicKey).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
  });

  test("a numeric milestone that ALREADY carries its label is not re-labelled into a duplicate", async () => {
    const d = makeEpicDouble({ epics: [], labels: [...SEED_LABELS, NUMERIC_LABEL] });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    expect(d.labels).toEqual([...SEED_LABELS, NUMERIC_LABEL]);
    expect(d.setParentCalls).toBe(0);
    expect(d.createEpicCalls).toBe(0);
  });

  test("a name-matching Epic in the project does NOT capture a numeric token", async () => {
    // The strongest form of the defect: an Epic whose summary byte-equals the
    // canonical name is exactly what today's `epics.find(e => e.name === …)`
    // binds to. Kind routing must ignore it.
    const d = makeEpicDouble({
      epics: [{ key: "GF-55", name: NUMERIC_CANONICAL }],
      nextEpicKey: "GF-902",
    });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    expect(d.setParentCalls).toBe(0);
    expect(d.parent).toBeNull();
    expect(d.labels).toContain(NUMERIC_LABEL);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.2 — the non-convergence, reproduced and asserted CLOSED.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.2 — milestoneBindingPresent is TRUE right after the attach returns", () => {
  test("M15 under milestoneBinding:'epic' — writer and reader land on one field", async () => {
    const canonical = canonicalFromPlanHeading(NUMERIC_HEADING, NUMERIC_TOKEN);
    expect(canonical).toBe(NUMERIC_CANONICAL);

    const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-903" });

    // Vacuity guard: the binding must be genuinely ABSENT before the attach,
    // or a fixture that starts bound would make the assertion below free.
    const before = await freshIssue(d);
    expect(milestoneBindingPresent(before, canonical, "epic")).toBe(false);

    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    // The criterion, asserted in the same test as the attach that produced it.
    const fresh = await freshIssue(d);
    expect(milestoneBindingPresent(fresh, canonical, "epic")).toBe(true);

    // …and it is true because the LABEL is there — the surface the reader's
    // grandfather clause actually consults for a numeric token.
    expect(fresh.labels).toContain(NUMERIC_LABEL);
    expect(fresh.parent ?? null).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.3 — a second attach is a no-op. TWO real passes.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.3 — the sweep converges: pass two finds nothing left to do", () => {
  test("two real attaches — predicate stays true, label not duplicated", async () => {
    const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-904" });
    const rec = sleepRecorder();

    // Pass one — the backfill that reported success.
    await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    const afterFirst = await freshIssue(d);
    expect(milestoneBindingPresent(afterFirst, NUMERIC_CANONICAL, "epic")).toBe(true);
    const labelsAfterFirst = [...(afterFirst.labels ?? [])];

    // The reported symptom is a sweep that finds the SAME work outstanding on
    // every pass. Post-fix a sweep reading before pass two already sees the
    // binding present — the work count falls to zero.
    expect(milestoneBindingPresent(afterFirst, NUMERIC_CANONICAL, "epic")).toBe(true);

    // Pass two — through the REAL attach, not a second predicate call. The
    // failure being pinned is a write that does not land where the read looks,
    // so a test that never writes twice cannot see it.
    await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    const afterSecond = await freshIssue(d);

    expect(milestoneBindingPresent(afterSecond, NUMERIC_CANONICAL, "epic")).toBe(true);
    expect(afterSecond.labels).toEqual(labelsAfterFirst);
    expect((afterSecond.labels ?? []).filter((l) => l === NUMERIC_LABEL).length).toBe(1);

    // Nothing accumulated on the parent surface across either pass.
    expect(d.setParentCalls).toBe(0);
    expect(d.createEpicCalls).toBe(0);
    expect(d.parentWrites).toEqual([]);
    expect(d.epics).toEqual([]);
    expect(rec.sleeps).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.4 — setParent call count is ZERO on AC.2's fixture.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.4 — a numeric milestone acquires no parent Epic at all", () => {
  test("AC.2's fixture: setParentCalls === 0 (kills the label-AND-parent fix)", async () => {
    // This is the criterion that separates a real routing change from a fix
    // that writes the label IN ADDITION to setting the parent. That weaker
    // implementation satisfies AC.2 and AC.3 and still leaves the ticket
    // parented to an Epic — so the absence is observed on the OP, where it is
    // visible, rather than on the ticket, where it is not.
    const canonical = canonicalFromPlanHeading(NUMERIC_HEADING, NUMERIC_TOKEN);
    const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-905" });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    expect(d.setParentCalls).toBe(0);
    expect(d.parentWrites).toEqual([]);
    expect(d.parent).toBeNull();
    expect(d.createEpicCalls).toBe(0);

    // The binding is still present — the zero is a routing change, not a
    // silently skipped attach.
    const fresh = await freshIssue(d);
    expect(milestoneBindingPresent(fresh, canonical, "epic")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.5 — the epic-kind path is UNCHANGED, pinned in this same file.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.5 — an epic-kind token still binds by parent, label set untouched", () => {
  test("M_GF_78 binds to GF-78 by key and scatters no label", async () => {
    const canonical = canonicalFromPlanHeading(
      `## ${EPIC_TOKEN} — ${EPIC_SUMMARY} {#${EPIC_TOKEN}}`,
      EPIC_TOKEN,
    );
    expect(canonical).toBe(EPIC_CANONICAL);

    const d = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      nextEpicKey: "GF-906",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    expect(d.setParentCalls).toBe(1);
    expect(d.parentWrites).toEqual([EPIC_KEY]);
    expect(d.parent).toBe(EPIC_KEY);
    expect(result.epicKey).toBe(EPIC_KEY);
    expect(result.capability).toBeNull();
    expect(d.createEpicCalls).toBe(0);

    // The label set is UNTOUCHED — seeded labels intact, no milestone label.
    expect(d.addLabelCalls).toBe(0);
    expect(d.labelWrites).toEqual([]);
    expect(d.labels).toEqual(SEED_LABELS);

    const fresh = await freshIssue(d);
    expect(milestoneBindingPresent(fresh, canonical, "epic")).toBe(true);
  });

  test("SYMMETRY: one binding, two kinds, two surfaces — asserted side by side", async () => {
    // Kind-routing bugs are symmetric by nature; a suite split across files
    // tends to catch only one direction. Both kinds run against the same
    // provider shape in one test, so a routing change that captures BOTH
    // kinds fails here whichever way it leans.
    const epicDouble = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      nextEpicKey: "GF-907",
    });
    const numericDouble = makeEpicDouble({
      epics: [{ key: EPIC_KEY, name: EPIC_SUMMARY }],
      nextEpicKey: "GF-908",
    });
    const rec = sleepRecorder();

    await attach(epicDouble.provider, PROJECT, EPIC_CANONICAL, TICKET, { sleep: rec.sleep });
    await attach(numericDouble.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });

    // Epic kind → parent surface only.
    expect(epicDouble.setParentCalls).toBe(1);
    expect(epicDouble.addLabelCalls).toBe(0);
    // Numeric kind → label surface only.
    expect(numericDouble.setParentCalls).toBe(0);
    expect(numericDouble.addLabelCalls).toBe(1);

    // And each is present under the SAME declared binding.
    expect(milestoneBindingPresent(await freshIssue(epicDouble), EPIC_CANONICAL, "epic")).toBe(true);
    expect(
      milestoneBindingPresent(await freshIssue(numericDouble), NUMERIC_CANONICAL, "epic"),
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.6 — an unparseable leading token refuses, naming the token.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.6 — a malformed token is routed to NEITHER surface", () => {
  // Today these fall through to the epic path, set a parent, and the reader's
  // own `try` swallows the derivation failure into a `false`. Once the writer
  // routes on kind, the third case has to be named.
  const MALFORMED: { token: string; canonical: string }[] = [
    { token: "Mx", canonical: "Mx — Not A Milestone" },
    { token: "M_", canonical: "M_ — Empty Epic Key" },
    { token: "M15-extra", canonical: "M15-extra — Trailing Junk" },
  ];

  for (const { token, canonical } of MALFORMED) {
    test(`"${token}" refuses, names the token, and writes nothing`, async () => {
      // Vacuity guard: the case is only a malformed case if the grammar says so.
      expect(parseMilestoneToken(token)).toBeNull();

      const d = makeEpicDouble({ epics: [], nextEpicKey: "GF-909" });
      const rec = sleepRecorder();
      let err: Error | null = null;
      try {
        await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });
      } catch (e) {
        if (e instanceof Error) err = e;
      }

      expect(err).not.toBeNull();
      // Names the TOKEN, not merely the canonical name it was cut from: blank
      // the whole name out and the token must still be there.
      const withoutName = err!.message.split(canonical).join("<name>");
      expect(withoutName).toContain(token);

      // Neither surface was written — counts, not side effects.
      expect(d.setParentCalls).toBe(0);
      expect(d.createEpicCalls).toBe(0);
      expect(d.addLabelCalls).toBe(0);
      expect(d.listEpicsCalls).toBe(0);
      expect(d.parent).toBeNull();
      expect(d.labels).toEqual(SEED_LABELS);

      // A refusal is a decision, not a transient — it must not pay the
      // 1s+2s+4s backoff schedule before surfacing.
      expect(rec.sleeps).toEqual([]);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.7 — the declared `label` binding is byte-unchanged.
// ───────────────────────────────────────────────────────────────────────

interface LabelDouble {
  labels: string[];
  forceVerifyLabels?: string[];
  addLabelCalls: number;
  labelWrites: string[];
  getIssueCalls: number;
  provider: Record<string, unknown>;
}

function makeLabelDouble(labels: string[], forceVerifyLabels?: string[]): LabelDouble {
  const d: LabelDouble = {
    labels: [...labels],
    forceVerifyLabels,
    addLabelCalls: 0,
    labelWrites: [],
    getIssueCalls: 0,
    provider: {},
  };
  d.provider = {
    milestoneBinding: "label" as const,
    addLabel: async (_t: string, label: string): Promise<void> => {
      d.addLabelCalls += 1;
      d.labelWrites.push(label);
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
      throw new Error("label binding must not call listMilestones");
    },
    saveMilestone: async (): Promise<void> => {
      throw new Error("label binding must not call saveMilestone");
    },
    upsertTicketMetadata: async (): Promise<string> => {
      throw new Error("label binding must not call upsertTicketMetadata");
    },
  };
  return d;
}

describe("AC-STE-523.7 — numeric token under milestoneBinding:'label' is untouched", () => {
  test("read-merge-write union, existing labels preserved, capability null", async () => {
    const d = makeLabelDouble(SEED_LABELS);
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, {
      sleep: rec.sleep,
    });
    expect(d.addLabelCalls).toBe(1);
    expect(d.labelWrites).toEqual([NUMERIC_LABEL]);
    expect(d.labels).toEqual([...SEED_LABELS, NUMERIC_LABEL]);
    expect(d.getIssueCalls).toBe(1);
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(result.epicKey).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
    expect(milestoneBindingPresent(await freshIssue(d), NUMERIC_CANONICAL, "label")).toBe(true);
  });

  test("label absent on read-back → MilestoneAttachmentError binding:'label', zero sleeps", async () => {
    const d = makeLabelDouble(SEED_LABELS, SEED_LABELS);
    const rec = sleepRecorder();
    let err: MilestoneAttachmentError | null = null;
    try {
      await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    } catch (e) {
      if (e instanceof MilestoneAttachmentError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err!.binding).toBe("label");
    expect(err!.expected).toBe(NUMERIC_LABEL);
    expect(err!.actual).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });

  test("CONVERGENCE: the two bindings write the identical label for the same name", async () => {
    // The FR's "intentional reuse rather than accidental duplication": one
    // function decides the string on both sides, so the declared `label`
    // binding and the numeric-under-`epic` path must produce byte-identical
    // label sets from the same canonical name.
    const declared = makeLabelDouble(SEED_LABELS);
    const grandfathered = makeEpicDouble({ epics: [], nextEpicKey: "GF-910" });
    const rec = sleepRecorder();

    await attach(declared.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });
    await attach(grandfathered.provider, PROJECT, NUMERIC_CANONICAL, TICKET, { sleep: rec.sleep });

    expect(grandfathered.labelWrites).toEqual(declared.labelWrites);
    expect(grandfathered.labels).toEqual(declared.labels);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.8 — the refusal fires only on a name that CLAIMS a token.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.8 — a name carrying no token is not a malformed token", () => {
  // AC.6 reads as a universal claim about unparseable leading words. It is
  // not one: a CANONICAL milestone name is `<token> — <title>` (every plan
  // heading normalizes to exactly that em-dash shape), so only a name in that
  // shape asserts its first field is a milestone token. A name NOT in that
  // shape carries no token field at all — STE-377's Epic-FIRST allocation
  // deliberately attaches a pre-key HUMAN TITLE, because the Epic must exist
  // before there is a key to derive an id from. Refusing on it would break
  // claim-on-create and would name a "token" the caller never wrote.
  //
  // The existing AC.6 fixtures are all in the canonical em-dash shape, so the
  // non-refusing side of the boundary is unexercised by them. Both sides are
  // asserted here, and the sharpest pair shares one leading word: `Mx` alone
  // decides nothing — the SHAPE decides.

  const TITLE_SHAPED: { why: string; canonical: string }[] = [
    { why: "unparseable leading word, no em-dash token field", canonical: "Mx Not A Milestone" },
    { why: "a bare one-word name — nothing after the leading word", canonical: "Mx" },
    { why: "STE-377's pre-key human title", canonical: "Concurrent milestone A" },
  ];

  for (const { why, canonical } of TITLE_SHAPED) {
    test(`"${canonical}" (${why}) reaches the by-name surface instead of refusing`, async () => {
      // Vacuity guard: this is only the interesting case if the leading word
      // genuinely fails the grammar. Otherwise the test would be asserting
      // the epic-keyed or numeric routing by accident.
      const leadingWord = canonical.split(/\s/, 1)[0]!;
      expect(parseMilestoneToken(leadingWord)).toBeNull();

      // STE-522 re-point: outcome 4 no longer MINTS on a miss (binding never
      // creates — minting moved to mintMilestoneEpic, which needs no ticket).
      // So the carve-out is pinned by BINDING against a seeded Epic, which is
      // strictly stronger than the old create-on-miss assertion: it proves the
      // name reached the by-NAME surface AND was matched there.
      const d = makeEpicDouble({ epics: [{ key: "GF-911", name: canonical }] });
      const rec = sleepRecorder();
      const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

      // Outcome 4 — find-by-NAME, bind by parent. This is the surface
      // STE-377's Epic-first allocation depends on.
      expect(d.listEpicsCalls).toBe(1);
      expect(d.createEpicCalls).toBe(0);
      expect(result.epicKey).toBe("GF-911");
      expect(d.setParentCalls).toBe(1);
      expect(d.parentWrites).toEqual(["GF-911"]);
      expect(d.parent).toBe("GF-911");

      // It is the PARENT surface, not the label one — a token-less name has
      // no label form at all, so a stray label write here could only be junk.
      expect(d.addLabelCalls).toBe(0);
      expect(d.labelWrites).toEqual([]);
      expect(d.labels).toEqual(SEED_LABELS);

      // A refusal would also have cost the 1s+2s+4s schedule; there is none.
      expect(rec.sleeps).toEqual([]);
    });
  }

  test("BOUNDARY: one leading word `Mx`, two shapes — the canonical one refuses, the title one binds", async () => {
    // The pin that makes the carve-out visible. Both names begin with the
    // same unparseable word, so nothing about `Mx` itself can explain the
    // split: a scope narrowing that quietly widened back to "any unparseable
    // leading word" fails on the second half, and one that dropped the
    // refusal entirely fails on the first.
    const claiming = "Mx — Not A Milestone";
    const titled = "Mx Not A Milestone";
    expect(claiming.startsWith("Mx")).toBe(true);
    expect(titled.startsWith("Mx")).toBe(true);

    // Side one: CLAIMS a token — refuses, writes nothing.
    const refusing = makeEpicDouble({ epics: [], nextEpicKey: "GF-912" });
    const recA = sleepRecorder();
    let err: unknown = null;
    try {
      await attach(refusing.provider, PROJECT, claiming, TICKET, { sleep: recA.sleep });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MilestoneTokenUnparseableError);
    expect(refusing.listEpicsCalls).toBe(0);
    expect(refusing.createEpicCalls).toBe(0);
    expect(refusing.setParentCalls).toBe(0);
    expect(refusing.addLabelCalls).toBe(0);

    // Side two: claims NO token — reaches the by-NAME surface and binds.
    const binding = makeEpicDouble({ epics: [{ key: "GF-913", name: titled }] });
    const recB = sleepRecorder();
    const result = await attach(binding.provider, PROJECT, titled, TICKET, { sleep: recB.sleep });
    expect(result.epicKey).toBe("GF-913");
    expect(binding.listEpicsCalls).toBe(1);
    expect(binding.createEpicCalls).toBe(0);
    expect(binding.setParentCalls).toBe(1);
    expect(binding.addLabelCalls).toBe(0);

    // Side three — the sharpest form of the carve-out, and the one STE-522
    // made available: on an EMPTY project both names refuse, but with
    // DIFFERENT error classes. Same leading word, same empty project, same
    // call: only the token-claim distinguishes them. A carve-out that
    // collapsed would return one class for both.
    const missA = makeEpicDouble({ epics: [] });
    const missB = makeEpicDouble({ epics: [] });
    let errA: unknown = null;
    let errB: unknown = null;
    try {
      await attach(missA.provider, PROJECT, claiming, TICKET, { sleep: recA.sleep });
    } catch (e) {
      errA = e;
    }
    try {
      await attach(missB.provider, PROJECT, titled, TICKET, { sleep: recB.sleep });
    } catch (e) {
      errB = e;
    }
    expect(errA).toBeInstanceOf(MilestoneTokenUnparseableError);
    expect(errB).toBeInstanceOf(MilestoneEpicUnmintedError);
    expect(errA).not.toBeInstanceOf(MilestoneEpicUnmintedError);
    expect(missA.createEpicCalls).toBe(0);
    expect(missB.createEpicCalls).toBe(0);
  });

  test("an EXISTING Epic named by the title is reused — no second Epic minted", async () => {
    // The carve-out's real subject is claim-on-create, whose second pass must
    // find the Epic it minted. If the title-shaped name were ever re-routed,
    // this leg would refuse instead of reusing.
    const canonical = "Concurrent milestone A";
    const d = makeEpicDouble({
      epics: [{ key: "GF-77", name: canonical }],
      nextEpicKey: "GF-914",
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    expect(d.createEpicCalls).toBe(0);
    expect(d.createdNames).toEqual([]);
    expect(result.epicKey).toBe("GF-77");
    expect(d.parentWrites).toEqual(["GF-77"]);
    expect(d.addLabelCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.9 — milestoneBindingPresent NEVER throws.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-523.9 — a token-less name reads as 'binding not present', never as an exception", () => {
  // The predicate's label surface derives its expected label from the
  // canonical name via `milestoneLabel`, which THROWS when the name has no
  // leading M-token. It is called unguarded on the `label` branch and again
  // on the epic branch's grandfathered fallback — so exactly the names AC.8
  // just admitted to the by-name surface blow the reader up when it is asked
  // about them afterwards.
  //
  // This matters beyond tidiness: the archival gate calls this predicate and
  // is contractually forbidden from throwing, so an exception escaping here
  // aborts a whole milestone's archival batch rather than skipping one FR.

  const TOKEN_LESS: { why: string; canonical: string }[] = [
    { why: "STE-377's pre-key human title", canonical: "Concurrent milestone A" },
    { why: "unparseable leading word, title shape", canonical: "Mx Not A Milestone" },
    { why: "a bare one-word name", canonical: "Mx" },
    { why: "the empty name", canonical: "" },
  ];

  for (const { why, canonical } of TOKEN_LESS) {
    test(`"${canonical}" (${why}) — false under BOTH label and epic, no throw`, () => {
      // Vacuity guard: the name must genuinely have no label form, or the
      // assertions below would hold for reasons that have nothing to do with
      // the criterion.
      expect(() => milestoneLabel(canonical)).toThrow();

      // A ticket that is bound to something else entirely — so `false` is a
      // real verdict about THIS milestone, not an artifact of an empty issue.
      const issue = {
        projectMilestone: { name: "M99 — Something Else" },
        parent: "GF-1",
        labels: [...SEED_LABELS, "milestone-M99"],
      };

      expect(milestoneBindingPresent(issue, canonical, "label")).toBe(false);
      expect(milestoneBindingPresent(issue, canonical, "epic")).toBe(false);
      // The third binding never derives a label, and must stay unbothered.
      expect(milestoneBindingPresent(issue, canonical, "object")).toBe(false);
    });
  }

  test("SCOPED: the false is a missing binding, not a blanket false", () => {
    // Kills the cheap fix — wrapping the whole predicate so every call
    // returns `false`. A token-BEARING name must still read its surfaces.
    const bound = { projectMilestone: null, parent: null, labels: [...SEED_LABELS, NUMERIC_LABEL] };
    expect(milestoneBindingPresent(bound, NUMERIC_CANONICAL, "label")).toBe(true);
    expect(milestoneBindingPresent(bound, NUMERIC_CANONICAL, "epic")).toBe(true);

    const unbound = { projectMilestone: null, parent: null, labels: [...SEED_LABELS] };
    expect(milestoneBindingPresent(unbound, NUMERIC_CANONICAL, "label")).toBe(false);
    expect(milestoneBindingPresent(unbound, NUMERIC_CANONICAL, "epic")).toBe(false);
  });

  test("END TO END: attach a token-less name, then ask the reader about it", async () => {
    // The two ACs meet here. AC.8 sends `Concurrent milestone A` to the
    // by-name surface; the very next thing a sweep does is read the binding
    // back. Today that read is where the sweep dies.
    // STE-522 re-point: the Epic is SEEDED rather than minted by the attach
    // (binding never creates any more). The end-to-end shape this test exists
    // for is unchanged and is the point: the attach lands a parent, and the
    // very next read must answer rather than throw.
    const canonical = "Concurrent milestone A";
    const d = makeEpicDouble({ epics: [{ key: "GF-915", name: canonical }] });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, canonical, TICKET, { sleep: rec.sleep });

    const fresh = await freshIssue(d);
    // The parent DID land — the attach is not in question.
    expect(fresh.parent).toBe("GF-915");
    // …and the reader, which cannot derive a label for this name, must say
    // "not present" rather than throw. (A pre-key title has no stable id, so
    // "present" is not something this predicate can honestly report.)
    expect(milestoneBindingPresent(fresh, canonical, "epic")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-523.9 — the scoping half: the guard is READ-SIDE ONLY.
//
// AC.9 absorbs the label-derivation throw inside `milestoneBindingPresent`
// so the archival gate can never be aborted by it. Its stated scope is that
// the WRITE path keeps throwing: an attach that cannot name its label must
// fail loudly rather than write nothing and report success.
//
// That half was unpinned. Measured by the second STE-523 audit: making
// `attachViaMilestoneLabel` catch the throw and return `{ capability }` —
// a write that reports success having written nothing — left ALL 161 tests
// across every attach-consumer file GREEN. The only throw-pin in the repo
// covered `milestoneLabel` the function, not the write path's use of it.
//
// This is the fail-open shape the whole milestone exists to close, so the
// scoping clause gets a pin of its own rather than a sentence.
// ───────────────────────────────────────────────────────────────────────
describe("AC-STE-523.9 — the write path still fails loudly on an unnameable label", () => {
  const tokenless = "Concurrent milestone A"; // pre-key human title: no M-token

  test("a label-binding attach on a token-less name THROWS — it never reports success", async () => {
    let addLabelCalls = 0;
    const provider = {
      milestoneBinding: "label" as const,
      addLabel: async () => {
        addLabelCalls += 1;
      },
      getIssue: async () => ({ labels: [] as string[] }),
      listMilestones: async () => [],
      saveMilestone: async () => {},
      upsertTicketMetadata: async () => "",
    };

    let threw: unknown = null;
    let returned: unknown = "SENTINEL_NOT_OVERWRITTEN";
    try {
      returned = await attachModule.attachProjectMilestone(
        provider as never,
        "DPT",
        tokenless,
        "STE-523",
        { sleep: async () => {} },
      );
    } catch (err) {
      threw = err;
    }

    // The load-bearing assertion: it threw, and therefore never returned a
    // success shape. Asserting only `threw !== null` would still pass on an
    // implementation that threw AFTER reporting; asserting the sentinel
    // survived is what pins "never reports success".
    expect(threw).not.toBeNull();
    expect(returned).toBe("SENTINEL_NOT_OVERWRITTEN");
    expect(String((threw as Error).message)).toContain("no leading M-token");

    // And it wrote nothing — the label could not be named, so none was added.
    expect(addLabelCalls).toBe(0);
  });

  test("the same name is FALSE, not a throw, on the read side — the two halves differ", () => {
    // Same input, same module, opposite contracts. Asserted side by side so a
    // future change that unifies them has to delete one of these two lines.
    expect(milestoneBindingPresent({ labels: [] }, tokenless, "label")).toBe(false);
    expect(() => attachModule.milestoneLabel(tokenless)).toThrow(/no leading M-token/);
  });
});

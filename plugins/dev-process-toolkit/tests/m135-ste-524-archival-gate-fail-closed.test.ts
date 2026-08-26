// STE-524 — The archival gate re-checks the predicate it opened with.
//
// Subject: `assertMilestoneBindingAtArchive`
// (adapters/_shared/src/assert_milestone_binding_at_archive.ts).
//
// THE DEFECT THESE TESTS CLOSED, stated in the past tense because it is fixed:
// the gate opened by asking `milestoneBindingPresent`, and on a miss it
// attached ONCE and then returned `asserted` UNCONDITIONALLY — not because it
// asked again, but because the attach did not throw. The predicate that had
// decided the binding was missing was never consulted a second time, so the
// gate stamped an affirmative verdict on the exact state its own opening
// question called false. It now re-reads and re-asks; that is what is pinned
// below.
//
// A non-throwing attach is a weaker claim than it looks: the attach verifies
// its own write by reading back THE FIELD IT WROTE, which says nothing about
// whether that field is the one the predicate reads. The degrade path makes
// the gap concrete — `epicBindingAvailable: false` writes a milestone LABEL
// while the epic-kind predicate reads `parent`.
//
// FIXTURES ARE STATE, NOT STUBBED VERDICTS. Every scenario drives the gate
// with a provider double holding ONE mutable ticket object: the pre-check, the
// attach's own read-back and the gate's re-check all read whatever the attach
// actually left behind. A double that returned a canned answer to the second
// read would pass these criteria while proving nothing about the ordering —
// which is the whole subject of this FR.
//
// The FR frontmatter parser (`parseFrFrontmatter`) recognises only the BLOCK
// form of `tracker:`; an inline `tracker: {jira: GF-79}` map is IGNORED and
// makes the gate return `vacuous` — and vacuous reads as a pass. Every fixture
// here uses the block form, and every non-vacuous scenario asserts
// `outcome !== "vacuous"` so a fixture regression cannot masquerade as green.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertMilestoneBindingAtArchive,
  MILESTONE_LABEL_ARCHIVE_REFUSED,
  MILESTONE_LABEL_ASSERTED_AT_ARCHIVE,
} from "../adapters/_shared/src/assert_milestone_binding_at_archive";
import {
  attachProjectMilestone,
  milestoneBindingPresent,
  milestoneLabel,
  planFileHeadingToMilestoneName,
  type MilestoneOps,
  type TicketMilestoneView,
} from "../adapters/_shared/src/attach_project_milestone";
import * as attachModuleNamespace from "../adapters/_shared/src/attach_project_milestone";
import { isMilestoneToken, milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";

// ───────────────────────────────────────────────────────────────────────
// Fixture constants
// ───────────────────────────────────────────────────────────────────────

/** Object binding (Linear) — the numeric milestone. */
const OBJ_PROJECT = "DPT";
const OBJ_TICKET = "STE-901";
const OBJ_MILESTONE = "M31";
const OBJ_HEADING = "## M31 — Tracker Workflow Hardening {#M31}";
const OBJ_CANONICAL = "M31 — Tracker Workflow Hardening";
const OBJ_LABEL = "milestone-M31";

/** Epic binding (Jira) — the Epic-KEYED milestone (STE-521's shape). */
const EPIC_PROJECT = "GF";
const EPIC_TICKET = "GF-79";
const EPIC_MILESTONE = "M_GF_78";
const EPIC_HEADING = "## M_GF_78 — Waiting States II {#M_GF_78}";
const EPIC_CANONICAL = "M_GF_78 — Waiting States II";
/** The Epic the milestone id was derived FROM. */
const EPIC_KEY = "GF-78";
/** A FOREIGN Epic — sanitizes to `M_GF_90`, not to the milestone token. */
const FOREIGN_EPIC_KEY = "GF-90";
/** What the degrade writes: `milestoneLabel(EPIC_CANONICAL)`. */
const EPIC_LABEL = "milestone-M_GF_78";

const noSleep = async (): Promise<void> => {};

const MODULE_PATH = join(
  import.meta.dir,
  "..",
  "adapters",
  "_shared",
  "src",
  "assert_milestone_binding_at_archive.ts",
);

// Fixture self-checks: the constants above must actually stand in the
// relationships the ACs describe, or the reproductions below are theatre.
test("fixture self-check — the constants stand in the relationships the ACs name", () => {
  expect(milestoneIdFromEpicKey(EPIC_KEY)).toBe(EPIC_MILESTONE);
  expect(milestoneIdFromEpicKey(FOREIGN_EPIC_KEY)).not.toBe(EPIC_MILESTONE);
  expect(milestoneLabel(EPIC_CANONICAL)).toBe(EPIC_LABEL);
  expect(milestoneLabel(OBJ_CANONICAL)).toBe(OBJ_LABEL);
});

// ───────────────────────────────────────────────────────────────────────
// Repo fixture
// ───────────────────────────────────────────────────────────────────────

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

interface RepoOpts {
  ticket?: string;
  /** FR frontmatter `milestone:` value; `null` omits the key entirely. */
  milestone?: string | null;
  /** Verbatim `tracker:` frontmatter block (BLOCK form — see file header). */
  trackerBlock?: string;
  /** Plan file written at `specs/plan/<planFile>.md`; `null` writes none. */
  planFile?: string | null;
  planHeading?: string;
}

function makeRepo(opts: RepoOpts = {}): { root: string; frPath: string } {
  const root = mkdtempSync(join(tmpdir(), "ste-524-"));
  tmpRoots.push(root);
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const ticket = opts.ticket ?? OBJ_TICKET;
  const milestone = opts.milestone === undefined ? OBJ_MILESTONE : opts.milestone;
  const tracker = opts.trackerBlock ?? `tracker:\n  linear: ${ticket}`;
  const milestoneLine = milestone === null ? "" : `milestone: ${milestone}\n`;
  const frPath = join(root, "specs", "frs", `${ticket}.md`);
  writeFileSync(
    frPath,
    `---\ntitle: Fixture FR\n${milestoneLine}status: active\narchived_at: null\n${tracker}\n---\n\n# ${ticket}: Fixture\n`,
  );
  const planFile = opts.planFile === undefined ? (milestone ?? OBJ_MILESTONE) : opts.planFile;
  if (planFile !== null) {
    writeFileSync(
      join(root, "specs", "plan", `${planFile}.md`),
      `${opts.planHeading ?? OBJ_HEADING}\n\n- [x] task\n`,
    );
  }
  return { root, frPath };
}

function makeObjectRepo(): { root: string; frPath: string } {
  return makeRepo();
}

function makeEpicRepo(): { root: string; frPath: string } {
  return makeRepo({
    ticket: EPIC_TICKET,
    milestone: EPIC_MILESTONE,
    trackerBlock: `tracker:\n  jira: ${EPIC_TICKET}`,
    planHeading: EPIC_HEADING,
  });
}

// ───────────────────────────────────────────────────────────────────────
// Provider double — ONE mutable ticket, read by every leg
// ───────────────────────────────────────────────────────────────────────

interface TicketState {
  projectMilestone: { name: string } | null;
  labels: string[];
  parent: string | null;
}

interface DoubleOpts {
  binding?: "object" | "label" | "epic";
  ticket?: Partial<TicketState>;
  epics?: { key: string; name: string }[];
  milestones?: { name: string }[];
  /** Omitted ⇒ the optional probe is ABSENT on the provider. */
  epicAvailable?: boolean;
  /** Omitted ⇒ the optional `supports` probe is ABSENT on the provider. */
  supportsProjectMilestone?: boolean;
  /** `false` ⇒ writes silently do not land (the GB-11 shape). */
  writesLand?: boolean;
  /** 1-based `getIssue` call index that throws instead of returning. */
  getIssueFailsOnCall?: number;
}

interface Double {
  provider: MilestoneOps;
  /** The live ticket every read projects from. */
  ticket: TicketState;
  calls: string[];
  count(op: string): number;
  /** The ticket AS THE PROVIDER WOULD RETURN IT — no call recorded. */
  snapshot(): TicketMilestoneView;
}

function makeDouble(opts: DoubleOpts = {}): Double {
  const ticket: TicketState = {
    projectMilestone: opts.ticket?.projectMilestone ?? null,
    labels: [...(opts.ticket?.labels ?? [])],
    parent: opts.ticket?.parent ?? null,
  };
  const milestones = [...(opts.milestones ?? [])];
  const epics = [...(opts.epics ?? [])];
  const writesLand = opts.writesLand ?? true;
  const calls: string[] = [];
  let getIssueCalls = 0;

  const snapshot = (): TicketMilestoneView => ({
    projectMilestone: ticket.projectMilestone ? { name: ticket.projectMilestone.name } : null,
    labels: [...ticket.labels],
    parent: ticket.parent,
  });

  const provider: MilestoneOps = {
    async listMilestones(project: string) {
      calls.push(`listMilestones(${project})`);
      return milestones.map((m) => ({ name: m.name }));
    },
    async saveMilestone(project: string, o: { name: string }) {
      calls.push(`saveMilestone(${project},${o.name})`);
      milestones.push({ name: o.name });
    },
    async upsertTicketMetadata(ticketId: string, meta: { milestone?: string }) {
      calls.push(`upsertTicketMetadata(${ticketId},${meta.milestone})`);
      if (writesLand && meta.milestone) ticket.projectMilestone = { name: meta.milestone };
      return ticketId;
    },
    async getIssue(ticketId: string) {
      getIssueCalls += 1;
      calls.push(`getIssue(${ticketId})`);
      if (opts.getIssueFailsOnCall !== undefined && getIssueCalls >= opts.getIssueFailsOnCall) {
        throw new Error(`ECONNRESET: socket hang up (getIssue call #${getIssueCalls})`);
      }
      return snapshot();
    },
    async addLabel(ticketId: string, label: string) {
      calls.push(`addLabel(${ticketId},${label})`);
      if (writesLand && !ticket.labels.includes(label)) ticket.labels.push(label);
    },
  };
  if (opts.binding !== undefined) provider.milestoneBinding = opts.binding;
  if (opts.binding === "epic") {
    provider.listEpics = async (project: string) => {
      calls.push(`listEpics(${project})`);
      return epics.map((e) => ({ ...e }));
    };
    provider.setParent = async (ticketId: string, epicKey: string) => {
      calls.push(`setParent(${ticketId},${epicKey})`);
      if (writesLand) ticket.parent = epicKey;
    };
  }
  if (opts.epicAvailable !== undefined) {
    provider.epicBindingAvailable = async (project: string) => {
      calls.push(`epicBindingAvailable(${project})`);
      return opts.epicAvailable!;
    };
  }
  if (opts.supportsProjectMilestone !== undefined) {
    provider.supports = (cap: string) =>
      cap === "project_milestone" ? opts.supportsProjectMilestone! : true;
  }

  return {
    provider,
    ticket,
    calls,
    count: (op: string) => calls.filter((c) => c.startsWith(`${op}(`)).length,
    snapshot,
  };
}

/** Calls that write toward (or enumerate for) an attach attempt. */
function attachSideCalls(d: Double): string[] {
  return d.calls.filter((c) =>
    /^(upsertTicketMetadata|saveMilestone|addLabel|listMilestones|listEpics|setParent)\(/.test(c),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.1 — the verdict is the predicate's answer on a FRESH read
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.1 — after a non-throwing attach the gate re-asks its own predicate", () => {
  test("miss → attach lands → the gate re-fetches the ticket (a THIRD getIssue) and asserts", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("asserted");
    // Ordering is the subject: pre-check read, the attach's write + its own
    // read-back, and then the gate's OWN re-read — after the write, not before.
    const shape = d.calls.map((c) => c.replace(/\(.*/, ""));
    expect(shape).toEqual([
      "getIssue",
      "listMilestones",
      "upsertTicketMetadata",
      "getIssue",
      "getIssue",
    ]);
  });

  test("miss → attach does not throw but the binding is STILL absent → refused, not asserted", async () => {
    // The degrade route: the availability probe says no, so the attach writes
    // the milestone LABEL and returns cleanly, while the epic-kind predicate
    // reads `parent`. The attach is honest; the gate is wrong.
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
  });

  test("the re-check uses the SAME binding and the SAME canonical name as the pre-check", async () => {
    // The final state satisfies the predicate under the `label` binding and
    // fails it under `epic`. A re-check that drifted to the label surface — or
    // to any canonical whose label happened to land — would return `asserted`.
    // The gate's verdict must track `epic` + the plan-heading canonical.
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    const finalState = d.snapshot();
    expect(finalState.labels).toContain(EPIC_LABEL);
    expect(milestoneBindingPresent(finalState, EPIC_CANONICAL, "label")).toBe(true);
    expect(milestoneBindingPresent(finalState, EPIC_CANONICAL, "epic")).toBe(false);
    expect(res.outcome).toBe("refused");
  });

  test("across four states the gate's verdict EQUALS the predicate on the post-attach ticket", async () => {
    interface Leg {
      name: string;
      repo: () => { root: string; frPath: string };
      project: string;
      mode: string;
      canonical: string;
      binding: "object" | "label" | "epic";
      double: () => Double;
    }
    const legs: Leg[] = [
      {
        name: "object: already present",
        repo: makeObjectRepo,
        project: OBJ_PROJECT,
        mode: "linear",
        canonical: OBJ_CANONICAL,
        binding: "object",
        double: () => makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } }),
      },
      {
        name: "object: miss, attach lands",
        repo: makeObjectRepo,
        project: OBJ_PROJECT,
        mode: "linear",
        canonical: OBJ_CANONICAL,
        binding: "object",
        double: () => makeDouble({ milestones: [{ name: OBJ_CANONICAL }] }),
      },
      {
        name: "object: miss, write silently drops",
        repo: makeObjectRepo,
        project: OBJ_PROJECT,
        mode: "linear",
        canonical: OBJ_CANONICAL,
        binding: "object",
        double: () => makeDouble({ milestones: [{ name: OBJ_CANONICAL }], writesLand: false }),
      },
      {
        name: "epic: degraded to the label surface",
        repo: makeEpicRepo,
        project: EPIC_PROJECT,
        mode: "jira",
        canonical: EPIC_CANONICAL,
        binding: "epic",
        double: () =>
          makeDouble({
            binding: "epic",
            epicAvailable: false,
            epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
          }),
      },
    ];
    for (const leg of legs) {
      const { root, frPath } = leg.repo();
      const d = leg.double();
      const res = await assertMilestoneBindingAtArchive(d.provider, leg.project, frPath, {
        projectRoot: root,
        mode: leg.mode,
        sleep: noSleep,
      });
      const present = milestoneBindingPresent(d.snapshot(), leg.canonical, leg.binding);
      expect(`${leg.name}: ${res.outcome}`).toBe(
        `${leg.name}: ${present ? "asserted" : "refused"}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.2 — the duplicate-Epic state refuses
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.2 — duplicate-Epic state (foreign parent, no Epic sanitizes to the token)", () => {
  test("ticket parented to a foreign Epic, project has no Epic for the token → refused", async () => {
    const { root, frPath } = makeEpicRepo();
    // Seeded DIRECTLY: STE-521 removed the mechanism that used to PRODUCE this
    // state (the attach minted a second Epic on the miss), so the state is
    // constructed rather than provoked.
    const d = makeDouble({
      binding: "epic",
      ticket: { parent: FOREIGN_EPIC_KEY },
      epics: [{ key: FOREIGN_EPIC_KEY, name: "Some other Epic" }],
    });
    // The state really is the one AC.2 names.
    expect(milestoneIdFromEpicKey(FOREIGN_EPIC_KEY)).not.toBe(EPIC_MILESTONE);
    expect(
      [{ key: FOREIGN_EPIC_KEY }].some((e) => milestoneIdFromEpicKey(e.key) === EPIC_MILESTONE),
    ).toBe(false);

    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
    // The parent was never rewritten to something that only LOOKS bound.
    expect(d.ticket.parent).toBe(FOREIGN_EPIC_KEY);
    expect(milestoneBindingPresent(d.snapshot(), EPIC_CANONICAL, "epic")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.3 — the degrade route: a SECOND, independent fail-open
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.3 — epicBindingAvailable:false writes a label while the predicate reads parent", () => {
  test("the degrade genuinely runs (probe consulted, label written, NO parent set) and the gate refuses", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      // The Epic EXISTS and matches the token — so a refusal here cannot be
      // mistaken for STE-521's Epic-not-found refusal. The only reason the
      // binding is absent is that the write landed on the label surface.
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    // This is the degrade route and not some other road to the same shape:
    expect(d.calls).toContain(`epicBindingAvailable(${EPIC_PROJECT})`);
    expect(d.calls).toContain(`addLabel(${EPIC_TICKET},${EPIC_LABEL})`);
    expect(d.count("setParent")).toBe(0);
    expect(d.count("listEpics")).toBe(0);
    expect(d.ticket.labels).toContain(EPIC_LABEL);
    expect(d.ticket.parent).toBeNull();
    // …and the attach was HONEST — it did not throw; only the gate can be wrong.
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
  });

  test("the degrade route survives STE-521 and STE-523 — the attach itself reports success", async () => {
    // Driven against attachProjectMilestone DIRECTLY: no refusal, no throw.
    // This is what makes AC.3 the durable pin — a fix that only closes AC.2's
    // route leaves this one open.
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const attachResult = await attachProjectMilestone(
      d.provider,
      EPIC_PROJECT,
      EPIC_CANONICAL,
      EPIC_TICKET,
      { sleep: noSleep },
    );
    expect(attachResult.capability).toBe("milestone_epic_unsupported");
    expect(milestoneBindingPresent(d.snapshot(), EPIC_CANONICAL, "epic")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.4 — anti-vacuity: the happy paths stay green
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.4 — a gate that refused everything must fail here", () => {
  test("object binding already present → asserted, zero attach-side calls", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe(MILESTONE_LABEL_ASSERTED_AT_ARCHIVE);
    expect(attachSideCalls(d)).toEqual([]);
  });

  test("object binding missing then successfully attached → asserted", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe(MILESTONE_LABEL_ASSERTED_AT_ARCHIVE);
    expect(d.ticket.projectMilestone).toEqual({ name: OBJ_CANONICAL });
  });

  test("label binding already present → asserted, zero attach-side calls", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
    const d = makeDouble({ binding: "label", ticket: { labels: ["backend", OBJ_LABEL] } });
    const res = await assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(attachSideCalls(d)).toEqual([]);
  });

  test("label binding missing then successfully attached → asserted", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
    const d = makeDouble({ binding: "label", ticket: { labels: ["backend"] } });
    const res = await assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(d.ticket.labels).toContain(OBJ_LABEL);
  });

  test("epic binding already parented to the milestone Epic → asserted, zero attach-side calls", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      ticket: { parent: EPIC_KEY },
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(attachSideCalls(d)).toEqual([]);
  });

  test("epic binding missing then successfully parented → asserted (the re-check can say YES)", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(d.calls).toContain(`setParent(${EPIC_TICKET},${EPIC_KEY})`);
    expect(d.ticket.parent).toBe(EPIC_KEY);
    expect(res.outcome).toBe("asserted");
    expect(res.token).toBe(MILESTONE_LABEL_ASSERTED_AT_ARCHIVE);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.5 — the refusal says WHICH failure happened
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.5 — 'attach landed, binding still absent' ≠ 'the attach threw'", () => {
  async function landedButAbsentDetail(): Promise<string> {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("refused");
    return res.detail!;
  }

  async function attachThrewDetail(): Promise<string> {
    const { root, frPath } = makeObjectRepo();
    // The write silently drops ⇒ the attach's own read-back disagrees ⇒
    // MilestoneAttachmentError ⇒ the gate's existing "the attach threw" leg.
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }], writesLand: false });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("refused");
    return res.detail!;
  }

  test("the landed-but-absent refusal does not claim the attach failed to land", async () => {
    const detail = await landedButAbsentDetail();
    expect(detail).not.toMatch(/attempt did not land/i);
    // It says what actually happened: the attach landed, the binding is still
    // absent. "still" is the load-bearing word — the state did not change.
    expect(detail).toMatch(/\bstill\b/i);
    expect(detail).toMatch(/attach/i);
  });

  test("the attach-threw refusal keeps its own distinct wording", async () => {
    const detail = await attachThrewDetail();
    expect(detail).toMatch(/did not land|attach (?:failed|threw|raised)/i);
  });

  test("the two details differ, and both keep the NFR-10 canonical shape", async () => {
    const landed = await landedButAbsentDetail();
    const threw = await attachThrewDetail();
    expect(landed).not.toBe(threw);
    for (const detail of [landed, threw]) {
      expect(detail).toMatch(/Remedy:/);
      expect(detail).toMatch(/Context:/);
    }
    expect(landed).toContain(EPIC_TICKET);
    expect(threw).toContain(OBJ_TICKET);
  });

  test("a non-mismatch attach failure still threads its raw cause (unchanged third case)", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
    d.provider.upsertTicketMetadata = async () => {
      throw new Error("503 Service Unavailable");
    };
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("refused");
    expect(res.detail).toContain("attach attempt failed");
    expect(res.detail).toContain("503 Service Unavailable");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.6 — the extra read costs exactly ONE getIssue, on the miss leg only
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.6 — cost, pinned as a call count", () => {
  test("already-present path: exactly ONE getIssue — unchanged from today's", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(d.count("getIssue")).toBe(1);
  });

  test("miss-then-attach path: exactly ONE more getIssue than the attach itself performs", async () => {
    // The baseline is MEASURED, not guessed: the same double, driven straight
    // through attachProjectMilestone, records how many reads the attach owns.
    const baseline = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
    await attachProjectMilestone(
      baseline.provider,
      OBJ_PROJECT,
      OBJ_CANONICAL,
      OBJ_TICKET,
      { sleep: noSleep },
    );
    const attachReads = baseline.count("getIssue");
    expect(attachReads).toBeGreaterThan(0);

    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    // 1 pre-check + the attach's own reads + exactly 1 added re-check.
    expect(d.count("getIssue")).toBe(1 + attachReads + 1);
  });

  test("epic already-present path also stays at ONE getIssue", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      ticket: { parent: EPIC_KEY },
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(d.count("getIssue")).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.7 — the vacuous paths are unchanged
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.7 — vacuity: zero tracker calls, still vacuous", () => {
  test("mode: none → vacuous, zero tracker calls, FR file untouched", async () => {
    const { root, frPath } = makeObjectRepo();
    const before = readFileSync(frPath, "utf-8");
    const d = makeDouble();
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "none",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
    expect(readFileSync(frPath, "utf-8")).toBe(before);
  });

  test("adapter without the project_milestone capability → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ supportsProjectMilestone: false });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
  });

  test("FR with no tracker binding (`tracker: {}`) → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: "tracker: {}" });
    const d = makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
  });

  test("FR with no milestone: frontmatter → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeRepo({ milestone: null, planFile: OBJ_MILESTONE });
    const d = makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
  });

  test("missing plan file → vacuous, zero tracker calls (probe #27 owns that diagnostic)", async () => {
    const { root, frPath } = makeRepo({ planFile: null });
    const d = makeDouble();
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
  });

  test("heading-less plan file → vacuous, zero tracker calls", async () => {
    const { root, frPath } = makeRepo({ planHeading: "# No milestone token here" });
    const d = makeDouble();
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("vacuous");
    expect(d.calls).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.8 — the module records WHY it must fail closed
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.8 — the fail-closed rationale is written on the gate's own surface", () => {
  const source = (): string => readFileSync(MODULE_PATH, "utf-8");

  // Asserted as booleans rather than `expect(source()).toMatch(...)` so a
  // failure names the missing sentence instead of dumping the whole module.
  test("the module says it must fail closed", () => {
    expect(/fail[- ]clos(?:e|ed|ing)/i.test(source())).toBe(true);
  });

  test("the module names the verifying probe's non-active skip", () => {
    const src = source();
    const idx = src.search(/non-active|not active/i);
    expect(idx).toBeGreaterThan(-1);
    // The three facts must sit together, not scattered: the probe that
    // verifies this binding, the non-active skip, and archiving as the
    // transition that makes an FR non-active.
    const window = src.slice(Math.max(0, idx - 600), idx + 600);
    expect(window).toMatch(/tracker_project_milestone_attached|probe #26/);
    // NOT `/archiv/i` — this module is NAMED assert_milestone_binding_at_archive
    // and the words "archival boundary" appear nearby regardless, so that
    // pattern could not fail and pinned nothing. What the AC actually requires
    // is the CAUSAL link: archiving is the transition that makes an FR
    // non-active, which is why this gate is the last reader.
    expect(window).toMatch(
      /archiv\w*\s+(?:is|makes)[^.]*non-active|non-active[^.]*\barchiv/i,
    );
  });

  test("the module says the archival boundary is the LAST read of that binding", () => {
    const said =
      /last read|last moment|no downstream reader|nothing (?:re)?(?:visits|reads|looks)/i.test(
        source(),
      );
    expect(said).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.9 — the gate still NEVER throws
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-524.9 — every added path converts to a refusal, never a throw", () => {
  test("the post-attach re-read throws → refused (a milestone-group batch skips only this FR)", async () => {
    const { root, frPath } = makeObjectRepo();
    // Calls 1 (pre-check) and 2 (the attach's read-back) succeed; the gate's
    // OWN re-read is the third and it dies. Before this FR that third call was
    // never made and the gate sailed past on a non-throwing attach.
    const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }], getIssueFailsOnCall: 3 });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
    expect(res.detail).toContain(OBJ_TICKET);
    expect(res.detail).toMatch(/Remedy:/);
    expect(d.count("getIssue")).toBe(3);
  });

  test("the pre-check read throwing still refuses (unchanged), with no attach attempted", async () => {
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ getIssueFailsOnCall: 1 });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("refused");
    expect(res.detail).toContain("ticket fetch failed");
    expect(attachSideCalls(d)).toEqual([]);
  });

  test("no scenario in this file ever rejects — the batch is never aborted", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epicAvailable: false,
      getIssueFailsOnCall: 3,
      epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
    });
    const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
      projectRoot: root,
      mode: "jira",
      sleep: noSleep,
    }).catch((err: unknown) => ({ threw: err }));
    expect(res).not.toHaveProperty("threw");
    expect((res as { outcome: string }).outcome).toBe("refused");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.10 — the "never throws" contract holds from the FIRST line
// ═══════════════════════════════════════════════════════════════════════
//
// AC.9 pins the contract from the FETCH onward. AC.10 pins the stretch
// BEFORE it: the gate derives the expected label with
//
//     const expected = binding === "label" ? milestoneLabel(canonical) : canonical;
//
// after the plan-heading parse and before both the fetch and the predicate.
// `milestoneLabel` THROWS on a canonical name carrying no leading M-token, so
// under the `label` binding a token-less name escapes as an exception from a
// helper whose whole documented contract is that it returns a verdict —
// aborting a milestone-group archival batch instead of skipping one FR.
//
// HONEST SCOPE, STATED SO A LATER READER IS NOT MISLED. Measured below, not
// assumed: `planFileHeadingToMilestoneName` — the ONLY producer of `canonical`
// in production — cannot emit a token-less name. Its grammar
// (`plan_heading.ts` over `MILESTONE_TOKEN_SOURCE`) either matches a heading
// whose leading token satisfies `isMilestoneToken`, or matches nothing and
// throws, which the gate already converts to `vacuous`. So this is HARDENING
// AT THE CONTRACT BOUNDARY, not the repair of a live crash — exactly the
// framing STE-523 AC.9 used for its sibling guard, and exactly what AC.10's
// own text claims. It is worth doing because the module's comment already
// promises the helper NEVER throws, a promise its first line did not keep.
//
// Because no plan file can drive the line, the gate is reached through the
// one seam that exists: the derivation module is swapped for the duration of
// a single call, so the gate is the REAL gate and only its name source is
// substituted. The swap is reverted in a `finally` and re-asserted at the end
// of this block, so no assertion above or in any sibling file inherits it.

/** A pre-key human title — the token-less shape STE-523 AC.8 carves out. */
const TOKENLESS_CANONICAL = "Waiting States II";

const ATTACH_MODULE_SPECIFIER = "../adapters/_shared/src/attach_project_milestone";
/** The REAL namespace, captured before any swap. */
const REAL_ATTACH_MODULE = { ...attachModuleNamespace };

/** Run `fn` with the plan-heading derivation forced to return `name`. */
async function withCanonical<T>(name: string, fn: () => Promise<T>): Promise<T> {
  mock.module(ATTACH_MODULE_SPECIFIER, () => ({
    ...REAL_ATTACH_MODULE,
    planFileHeadingToMilestoneName: () => name,
  }));
  try {
    return await fn();
  } finally {
    mock.module(ATTACH_MODULE_SPECIFIER, () => REAL_ATTACH_MODULE);
  }
}

afterAll(() => {
  mock.module(ATTACH_MODULE_SPECIFIER, () => REAL_ATTACH_MODULE);
});

describe("AC-STE-524.10 — the label derivation before the fetch is guarded", () => {
  test("the hazard is real: milestoneLabel THROWS on a token-less name", () => {
    // Isolation half — if this ever stopped throwing, every assertion below
    // would pass for the wrong reason.
    expect(() => milestoneLabel(TOKENLESS_CANONICAL)).toThrow(/no leading M-token/);
    expect(isMilestoneToken(TOKENLESS_CANONICAL.split(/\s/, 1)[0]!)).toBe(false);
  });

  test("MEASURED: the plan-heading parser cannot emit a token-less name", async () => {
    // This is the claim that makes AC.10 hardening rather than a live-crash
    // repair, so it is measured rather than asserted in prose. Every heading
    // the parser ADMITS yields a leading token milestoneLabel accepts; every
    // heading it rejects reaches the gate as `vacuous`, never as a throw.
    const admitted = [
      "## M31 — Tracker Workflow Hardening {#M31}",
      "# M31 — Legacy H1 form",
      "## M31: Legacy colon form",
      "## M_GF_78 — Waiting States II {#M_GF_78}",
      "## M_GF-78 — Hyphenated Epic key",
      "##   M31   —   Loose whitespace  ",
    ];
    const rejected = [
      "## Waiting States II — no token at all",
      "# No milestone token here",
      "## M — bare M",
      "## M_ — empty epic key",
      "## M5-extra — trailing junk",
      "## m31 — lowercase",
    ];
    for (const planHeading of admitted) {
      const { root } = makeRepo({
        trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}`,
        planHeading,
      });
      const canonical = planFileHeadingToMilestoneName(
        join(root, "specs", "plan", `${OBJ_MILESTONE}.md`),
      );
      expect(`${planHeading} ⇒ tokened`).toBe(
        `${planHeading} ⇒ ${isMilestoneToken(canonical.split(/\s/, 1)[0]!) ? "tokened" : "TOKEN-LESS"}`,
      );
      // …and therefore the derivation the gate performs cannot throw on it.
      expect(() => milestoneLabel(canonical)).not.toThrow();
    }
    for (const planHeading of rejected) {
      const { root, frPath } = makeRepo({
        trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}`,
        planHeading,
      });
      const d = makeDouble({ binding: "label" });
      const res = await assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      });
      expect(`${planHeading} ⇒ ${res.outcome}`).toBe(`${planHeading} ⇒ vacuous`);
      expect(d.calls).toEqual([]);
    }
  });

  test("label binding + token-less canonical → a VERDICT, never an exception", async () => {
    // The contract, stated at its weakest and most load-bearing: the helper
    // returns. Before the guard landed this REJECTED with `milestoneLabel:
    // "Waiting States II" has no leading M-token` before the fetch was ever
    // reached — an exception escaping a helper contracted never to throw.
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
    const d = makeDouble({ binding: "label" });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }).catch((err: unknown) => ({ threw: err instanceof Error ? err.message : String(err) })),
    );
    expect(res).not.toHaveProperty("threw");
    expect(typeof (res as { outcome?: string }).outcome).toBe("string");
  });

  test("that verdict is a REFUSAL — not `vacuous`, which would silently pass", async () => {
    // A name the gate cannot work with is NOT "nothing to check". Reporting
    // it as vacuous would make an unusable milestone name read as a clean
    // archival, which is the fail-open this whole FR exists to close.
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
    const d = makeDouble({ binding: "label" });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }),
    );
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
    // The guard sits BEFORE the fetch, so nothing is asked of the tracker and
    // nothing is written — the FR is skipped, not half-archived.
    expect(d.calls).toEqual([]);
  });

  test("the refusal NAMES the unusable canonical name (and keeps the NFR-10 shape)", async () => {
    const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
    const d = makeDouble({ binding: "label" });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }),
    );
    expect(res.outcome).toBe("refused");
    const detail = res.detail!;
    expect(detail).toContain(TOKENLESS_CANONICAL);
    expect(detail).toContain(OBJ_TICKET);
    expect(detail).toMatch(/Remedy:/);
    expect(detail).toMatch(/Context:/);
    // …and it says WHY, so the operator is not sent to the wrong diagnosis:
    // the milestone NAME is unusable, not the tracker write.
    expect(detail).not.toMatch(/attempt did not land/i);
    expect(detail).toMatch(/token/i);
  });

  test("SCOPE: object binding does not derive a label — it reaches the fetch unchanged", async () => {
    // A guard that refused every binding at line one would break this. The
    // object route carries the canonical name through verbatim, so a
    // token-less name is a perfectly ordinary (if odd) milestone name there.
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ ticket: { projectMilestone: { name: TOKENLESS_CANONICAL } } });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
        projectRoot: root,
        mode: "linear",
        sleep: noSleep,
      }),
    );
    expect(d.count("getIssue")).toBe(1);
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("asserted");
    expect(res.detail).toContain(TOKENLESS_CANONICAL);
  });

  // AMENDED by AC.10's post-audit clause. This test previously asserted the
  // OPPOSITE — "epic does not derive a label, so it too reaches the fetch" —
  // and the audit showed what reaching the fetch actually costs: under `epic`
  // a token-less name skips the guard, the attach matches an Epic BY NAME and
  // sets a parent, the re-check still reads false, and the operator is handed
  // the landed-but-absent remedy (told to set a parent that is already
  // correct) while the real fault is the milestone NAME. The guard covers
  // every binding that NEEDS the token; `object` alone is exempt. The full
  // three-binding pin, and the reproduction of the misdirection this replaces,
  // live in the "AC-STE-524.10 (AMENDED)" block at the foot of this file.
  test("SCOPE: epic NEEDS the token too — it refuses before the fetch", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }],
    });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }).catch((err: unknown) => ({ threw: err instanceof Error ? err.message : String(err) })),
    );
    expect(res).not.toHaveProperty("threw");
    expect((res as { outcome: string }).outcome).not.toBe("vacuous");
    expect((res as { outcome: string }).outcome).toBe("refused");
    // Nothing was asked of the tracker, so no parent could have been written.
    expect(d.calls).toEqual([]);
    expect(d.ticket.parent).toBeNull();
  });

  test("the seam is fully reverted — a real plan file still drives the real gate", async () => {
    // Guards the guard's own test machinery: if the swap leaked, every
    // assertion in this file after it would be measuring a fiction.
    expect(attachModuleNamespace.planFileHeadingToMilestoneName).toBe(
      REAL_ATTACH_MODULE.planFileHeadingToMilestoneName,
    );
    const { root, frPath } = makeObjectRepo();
    const d = makeDouble({ ticket: { projectMilestone: { name: OBJ_CANONICAL } } });
    const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
      projectRoot: root,
      mode: "linear",
      sleep: noSleep,
    });
    expect(res.outcome).toBe("asserted");
    expect(res.detail).toContain(OBJ_CANONICAL);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.11 — each refusal route carries a remedy that fits ITS cause
// ═══════════════════════════════════════════════════════════════════════
//
// The gate refuses on SIX distinct routes and emitted ONE shared `Remedy:`
// line for all of them. Three of the six are misdirected by it, two of those
// dangerously:
//
//   - the ticket FETCH failed — nothing is known to be missing, the binding
//     may be perfectly fine, and "attach it manually" invites a DUPLICATE
//     WRITE;
//   - the post-attach RE-READ failed — the attach probably landed, so the
//     same duplicate-write risk applies;
//   - the attach landed and the binding is STILL absent — the live instance
//     is the degrade, where the attach wrote a milestone LABEL while the epic
//     predicate reads `parent`. The shared line USED TO send the operator to
//     `--backfill-milestone-labels`, which rewrites the label already there
//     and never touches the parent: it told them to repeat the thing that had
//     just failed. Per-route remedies replaced it; these tests hold that.
//
// Advising an action that risks a duplicate write is the defect class this
// milestone exists to close, so the remedy is not decoration here. Every
// route is driven through the REAL gate and asserted on the returned
// `detail` — a remedy table unit-tested in isolation would stop being a pin
// about what an operator actually sees.
//
// THE EXHAUSTIVENESS PIN IS THE LOAD-BEARING ONE, so the route set is read
// OUT OF THE MODULE — the exported `ARCHIVE_REFUSAL_REMEDIES` map plus the
// `route=` token its Context line carries — and never retyped here. A
// hand-copied list is exactly the drift this AC is about. A seventh route
// added later fails these pins three ways: a registry entry with no scenario
// breaks the set equality; an inline literal remedy breaks the "all remedy
// prose lives in the registry" pin; re-using another route's id breaks the
// raised-exactly-once pin.

type GateResult = Awaited<ReturnType<typeof assertMilestoneBindingAtArchive>>;

/** One refusal route, as the gate actually reported it. */
interface RouteCase {
  scenario: string;
  detail: string;
  /** The route id the module itself stamped into the Context line. */
  route: string;
  /** The route's `Remedy:` line, minus the prefix. */
  remedy: string;
}

/**
 * The route→remedy registry the gate must export. Read through a namespace
 * import so a module that does not export it yet fails THIS assertion with a
 * readable message, rather than failing to load and reddening the whole file.
 */
async function remedyRegistry(): Promise<Record<string, string>> {
  const mod = (await import(
    "../adapters/_shared/src/assert_milestone_binding_at_archive"
  )) as Record<string, unknown>;
  const registry = mod.ARCHIVE_REFUSAL_REMEDIES;
  const shape =
    registry !== null && typeof registry === "object" && !Array.isArray(registry)
      ? "a route→remedy map"
      : `NOT EXPORTED (got ${String(registry)}) — the gate offers no enumeration seam`;
  expect(`ARCHIVE_REFUSAL_REMEDIES is ${shape}`).toBe(
    "ARCHIVE_REFUSAL_REMEDIES is a route→remedy map",
  );
  return registry as Record<string, string>;
}

function routeOf(scenario: string, detail: string): string {
  const m = /(?:^|[,\s])route=([A-Za-z0-9_]+)/.exec(detail);
  expect(`${scenario}: ${m ? "route= named" : `NO route= token in\n${detail}`}`).toBe(
    `${scenario}: route= named`,
  );
  return m![1]!;
}

function remedyOf(scenario: string, detail: string): string {
  const line = detail.split("\n").find((l) => l.startsWith("Remedy: "));
  expect(`${scenario}: ${line ? "has a Remedy line" : `NO Remedy line in\n${detail}`}`).toBe(
    `${scenario}: has a Remedy line`,
  );
  return line!.slice("Remedy: ".length);
}

/**
 * A registry entry may interpolate context (`{planFile}`); the emitted line
 * must match it everywhere else, verbatim.
 */
function matchesTemplate(actual: string, template: string): boolean {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = template.split(/\{[A-Za-z0-9_]+\}/).map(escape);
  return new RegExp(`^${parts.join("[^\\n]*")}$`).test(actual);
}

/** The six routes, each provoked as a STATE and driven through the real gate. */
const routeDrivers: { scenario: string; run: () => Promise<GateResult> }[] = [
  {
    scenario: "1. the canonical name is unusable (no milestone token)",
    run: async () => {
      const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
      const d = makeDouble({ binding: "label" });
      const res = await withCanonical(TOKENLESS_CANONICAL, () =>
        assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
          projectRoot: root,
          mode: "jira",
          sleep: noSleep,
        }),
      );
      // Refuses BEFORE any tracker call — nothing is known about the binding.
      expect(d.calls).toEqual([]);
      return res;
    },
  },
  {
    scenario: "2. the ticket FETCH failed",
    run: async () => {
      const { root, frPath } = makeObjectRepo();
      const d = makeDouble({ getIssueFailsOnCall: 1 });
      const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
        projectRoot: root,
        mode: "linear",
        sleep: noSleep,
      });
      // Nothing was attached and nothing is known to be missing.
      expect(attachSideCalls(d)).toEqual([]);
      return res;
    },
  },
  {
    scenario: "3. the attach threw MilestoneAttachmentError (binding mismatch)",
    run: async () => {
      const { root, frPath } = makeObjectRepo();
      const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }], writesLand: false });
      const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
        projectRoot: root,
        mode: "linear",
        sleep: noSleep,
      });
      expect(d.count("upsertTicketMetadata")).toBeGreaterThan(0);
      return res;
    },
  },
  {
    scenario: "4. the attach threw something else (network exhaustion, auth)",
    run: async () => {
      const { root, frPath } = makeObjectRepo();
      const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }] });
      d.provider.upsertTicketMetadata = async () => {
        throw new Error("503 Service Unavailable");
      };
      const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
        projectRoot: root,
        mode: "linear",
        sleep: noSleep,
      });
      expect(res.detail).toContain("503 Service Unavailable");
      return res;
    },
  },
  {
    scenario: "5. the post-attach RE-READ failed",
    run: async () => {
      const { root, frPath } = makeObjectRepo();
      const d = makeDouble({ milestones: [{ name: OBJ_CANONICAL }], getIssueFailsOnCall: 3 });
      const res = await assertMilestoneBindingAtArchive(d.provider, OBJ_PROJECT, frPath, {
        projectRoot: root,
        mode: "linear",
        sleep: noSleep,
      });
      // The attach itself reported success — the write probably landed.
      expect(d.ticket.projectMilestone).toEqual({ name: OBJ_CANONICAL });
      return res;
    },
  },
  {
    scenario: "6. the attach LANDED but the binding is still absent (epic degrade)",
    run: async () => {
      const { root, frPath } = makeEpicRepo();
      const d = makeDouble({
        binding: "epic",
        epicAvailable: false,
        epics: [{ key: EPIC_KEY, name: "Waiting States II" }],
      });
      const res = await assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      });
      // The label the backfill would rewrite is ALREADY there; the parent the
      // predicate reads is not. That is why the shared remedy misfires.
      expect(d.ticket.labels).toContain(EPIC_LABEL);
      expect(d.ticket.parent).toBeNull();
      return res;
    },
  },
];

let routeCasesCache: RouteCase[] | null = null;

async function routeCases(): Promise<RouteCase[]> {
  if (routeCasesCache) return routeCasesCache;
  const cases: RouteCase[] = [];
  for (const driver of routeDrivers) {
    const res = await driver.run();
    expect(`${driver.scenario}: ${res.outcome}`).toBe(`${driver.scenario}: refused`);
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
    const detail = res.detail!;
    cases.push({
      scenario: driver.scenario,
      detail,
      route: routeOf(driver.scenario, detail),
      remedy: remedyOf(driver.scenario, detail),
    });
  }
  routeCasesCache = cases;
  return cases;
}

/** The one case whose scenario string starts with `n.` — kept honest below. */
async function routeCase(n: number): Promise<RouteCase> {
  const cases = await routeCases();
  const found = cases.find((c) => c.scenario.startsWith(`${n}.`));
  expect(found ? "found" : `no scenario ${n}`).toBe("found");
  return found!;
}

const ADVISES_MANUAL = /manual/i;
const ADVISES_BACKFILL = /backfill/i;

describe("AC-STE-524.11 — six routes, six remedies, enumerated from the module", () => {
  test("all six routes refuse, each stamping a DISTINCT route id, in NFR-10 shape", async () => {
    const cases = await routeCases();
    expect(cases).toHaveLength(6);
    for (const c of cases) {
      expect(`${c.scenario}: ${c.detail.startsWith(`${MILESTONE_LABEL_ARCHIVE_REFUSED}:`)}`).toBe(
        `${c.scenario}: true`,
      );
      expect(c.detail).toMatch(/\nRemedy: /);
      expect(c.detail).toMatch(/\nContext: /);
    }
    const ids = cases.map((c) => c.route);
    expect(`${ids.join(",")} (${new Set(ids).size} distinct)`).toBe(
      `${ids.join(",")} (6 distinct)`,
    );
  });

  test("every emitted remedy is the registry's entry for the route the gate stamped", async () => {
    const registry = await remedyRegistry();
    for (const c of await routeCases()) {
      const template = registry[c.route];
      expect(`${c.scenario}: ${template === undefined ? "UNREGISTERED" : "registered"}`).toBe(
        `${c.scenario}: registered`,
      );
      expect(
        `${c.scenario}: ${matchesTemplate(c.remedy, template!) ? "matches" : `"${c.remedy}" ≠ "${template}"`}`,
      ).toBe(`${c.scenario}: matches`);
    }
  });

  test("no single line covers the set — all six remedies differ", async () => {
    const cases = await routeCases();
    const remedies = cases.map((c) => c.remedy);
    expect(`${new Set(remedies).size} distinct remedies`).toBe("6 distinct remedies");
  });

  // ── the dangerous half: the two routes where a manual attach or a backfill
  // would risk a DUPLICATE WRITE. Asserted as ABSENCES, individually.

  test("route 2 (fetch failed) never advises a manual attach or a backfill", async () => {
    const c = await routeCase(2);
    // Nothing is known to be missing — the binding may be perfectly fine.
    expect(`fetch-failed remedy advises manual attach: ${ADVISES_MANUAL.test(c.remedy)}`).toBe(
      "fetch-failed remedy advises manual attach: false",
    );
    expect(`fetch-failed remedy advises backfill: ${ADVISES_BACKFILL.test(c.remedy)}`).toBe(
      "fetch-failed remedy advises backfill: false",
    );
    // What it must say instead: restore tracker access, then re-run.
    expect(c.remedy).toMatch(/re-?run/i);
    expect(c.remedy).toMatch(/access|auth|connect|reach|tracker/i);
  });

  test("route 5 (re-read failed) never advises a manual attach or a backfill", async () => {
    const c = await routeCase(5);
    // The attach probably LANDED — the same duplicate-write risk applies.
    expect(`re-read-failed remedy advises manual attach: ${ADVISES_MANUAL.test(c.remedy)}`).toBe(
      "re-read-failed remedy advises manual attach: false",
    );
    expect(`re-read-failed remedy advises backfill: ${ADVISES_BACKFILL.test(c.remedy)}`).toBe(
      "re-read-failed remedy advises backfill: false",
    );
    expect(c.remedy).toMatch(/re-?run/i);
  });

  test("route 6 (landed but absent) does not send the operator back to the backfill", async () => {
    const c = await routeCase(6);
    // The backfill rewrites the label already present and never touches the
    // parent: advising it is advising the operator to repeat the failure.
    expect(`landed-but-absent remedy advises backfill: ${ADVISES_BACKFILL.test(c.remedy)}`).toBe(
      "landed-but-absent remedy advises backfill: false",
    );
    // It says what actually happened instead: the binding asked for is not
    // the binding that landed.
    expect(c.remedy).toMatch(/land|wrote|written/i);
    expect(c.remedy).toMatch(/not the|different|differs|instead|rather than/i);
  });

  // ── the three that FIT, asserted individually so "distinct" cannot be
  // satisfied by six equally wrong lines.

  test("route 1 (unusable name) points at the plan heading, not at the tracker", async () => {
    const c = await routeCase(1);
    expect(c.remedy).toMatch(/heading/i);
    expect(c.remedy).toMatch(/token/i);
    expect(`unusable-name remedy advises backfill: ${ADVISES_BACKFILL.test(c.remedy)}`).toBe(
      "unusable-name remedy advises backfill: false",
    );
  });

  test("route 3 (binding mismatch) keeps the attach-it-yourself advice that FITS it", async () => {
    const c = await routeCase(3);
    expect(c.remedy).toMatch(/manual|backfill/i);
  });

  test("route 4 (attach threw) tells the operator to clear the failure and retry", async () => {
    const c = await routeCase(4);
    expect(c.remedy).toMatch(/re-?run|retry|manual|backfill/i);
  });

  // ── EXHAUSTIVENESS: the set, not the members.

  test("EXHAUSTIVE: the registry's routes are EXACTLY the routes exercised here", async () => {
    // The trap this AC asks for: a seventh route registered without a remedy
    // of its own — or with one nothing drives — fails HERE rather than
    // silently inheriting another route's line.
    const registry = await remedyRegistry();
    const registered = Object.keys(registry).sort();
    const exercised = (await routeCases()).map((c) => c.route).sort();
    expect(`registered: ${registered.join(",")}`).toBe(`registered: ${exercised.join(",")}`);
  });

  test("EXHAUSTIVE: every registry entry is non-empty and raised exactly once", async () => {
    // Enumerated from the module's own source: each route id appears twice —
    // once where its remedy is registered, once where that route is raised.
    // A seventh route that re-uses an existing id shows THREE occurrences.
    const registry = await remedyRegistry();
    const src = readFileSync(MODULE_PATH, "utf-8");
    for (const [route, remedy] of Object.entries(registry)) {
      expect(`${route}: ${typeof remedy === "string" && remedy.trim().length > 20}`).toBe(
        `${route}: true`,
      );
      const occurrences = (
        src.match(new RegExp(`(?<![A-Za-z0-9_])${route}(?![A-Za-z0-9_])`, "g")) ?? []
      ).length;
      expect(`${route} appears ${occurrences}× in the module`).toBe(
        `${route} appears 2× in the module`,
      );
    }
  });

  test("EXHAUSTIVE: no remedy prose is written inline — every one comes from the registry", async () => {
    // The other half of the trap: an inline `Remedy: <prose>` would let a new
    // route bypass the registry entirely and never be counted. Every
    // `Remedy:` literal in the module must hand straight over to an
    // interpolation (or end its literal there).
    const src = readFileSync(MODULE_PATH, "utf-8");
    const literals = [...src.matchAll(/Remedy:[^\n]*/g)].map((m) => m[0]);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      const inlined = !/^Remedy:\s*(\$\{|["'`])/.test(literal);
      expect(`${JSON.stringify(literal.slice(0, 60))} inlines prose: ${inlined}`).toBe(
        `${JSON.stringify(literal.slice(0, 60))} inlines prose: false`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.10 (AMENDED) — the guard covers EVERY binding that needs the
// token; `object` is the only exemption
// ═══════════════════════════════════════════════════════════════════════
//
// Scoped to `label` alone, the unusable-canonical-name guard left a LIVE
// MISDIRECTION, which this FR's audit demonstrated on shipped code:
//
//   1. under `epic` a token-less canonical CLAIMS NO TOKEN, so it is not the
//      Epic-KEYED route at all — it is the pre-key HUMAN-TITLE route, which
//      matches an Epic BY NAME (`e.name === milestoneName`);
//   2. the guard does not fire (it asked only about `label`); the pre-check
//      reads false, because the epic predicate falls through to the label
//      surface whose derivation throws and is absorbed as `false`;
//   3. the attach finds the Epic by name and SETS THE PARENT — honestly, and
//      without throwing;
//   4. the re-check reads false again, for the same reason as (2);
//   5. so the gate refuses through `attach_landed_binding_absent`, whose
//      remedy is "set the parent Epic on the ticket directly" — and the parent
//      is ALREADY correct. The operator is sent to fix the one thing that is
//      not broken while the real fault is the milestone NAME.
//
// The guard therefore covers every binding that NEEDS the token. `object`
// compares `projectMilestone.name` against the canonical name verbatim and
// needs no token at all, so it is the single exemption — and it is what stops
// this pin being satisfiable by a guard that refuses every binding at line one.

/** The three bindings, and whether each NEEDS a milestone token. */
const TOKEN_NEEDED: { binding: "object" | "label" | "epic"; needsToken: boolean }[] = [
  { binding: "object", needsToken: false },
  { binding: "label", needsToken: true },
  { binding: "epic", needsToken: true },
];

describe("AC-STE-524.10 (amended) — every binding that needs the token is guarded", () => {
  test("the hazard is real: under `epic` a token-less name reaches the by-NAME attach and SETS a parent", async () => {
    // Isolation half. Driven against attachProjectMilestone DIRECTLY, so this
    // records what the attach does regardless of what the gate decides — if
    // the by-NAME arm ever stopped setting a parent, the misdirection below
    // would have evaporated and the guard's epic leg would be pinning nothing.
    expect(isMilestoneToken(TOKENLESS_CANONICAL.split(/\s/, 1)[0]!)).toBe(false);
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }],
    });
    const attachResult = await attachProjectMilestone(
      d.provider,
      EPIC_PROJECT,
      TOKENLESS_CANONICAL,
      EPIC_TICKET,
      { sleep: noSleep },
    );
    // This is the by-NAME arm and not one of its neighbours: no availability
    // probe exists on this double (so it is not the degrade), the Epic
    // enumeration ran (so it is not the label surface), and the name claims
    // no token (so it is not the Epic-KEYED match).
    expect(d.count("epicBindingAvailable")).toBe(0);
    expect(d.calls).toContain(`listEpics(${EPIC_PROJECT})`);
    expect(d.count("addLabel")).toBe(0);
    expect(d.calls).toContain(`setParent(${EPIC_TICKET},${EPIC_KEY})`);
    expect(attachResult.capability).toBeNull();
    expect(d.ticket.parent).toBe(EPIC_KEY);
    // …and the predicate the gate re-asks STILL says no. That gap is the
    // misdirection: the landed-but-absent remedy tells the operator to set a
    // parent that is already set.
    expect(milestoneBindingPresent(d.snapshot(), TOKENLESS_CANONICAL, "epic")).toBe(false);
  });

  test("epic + token-less canonical → refused, with ZERO tracker calls and NO parent written", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }],
    });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }),
    );
    expect(res.outcome).not.toBe("vacuous");
    expect(res.outcome).toBe("refused");
    expect(res.token).toBe(MILESTONE_LABEL_ARCHIVE_REFUSED);
    // The guard sits before the fetch, so the whole tracker conversation the
    // previous test recorded — listEpics, setParent — never happens.
    expect(d.calls).toEqual([]);
    expect(d.count("setParent")).toBe(0);
    expect(d.ticket.parent).toBeNull();
  });

  test("the epic refusal takes the SAME route as the label refusal — read out of both details", async () => {
    // The route vocabulary is the implementation's; both ids are read back out
    // of the emitted `Context:` line and compared to each other, never to a
    // literal typed here.
    const labelRun = async (): Promise<GateResult> => {
      const { root, frPath } = makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` });
      const d = makeDouble({ binding: "label" });
      return withCanonical(TOKENLESS_CANONICAL, () =>
        assertMilestoneBindingAtArchive(d.provider, "DST", frPath, {
          projectRoot: root,
          mode: "jira",
          sleep: noSleep,
        }),
      );
    };
    const epicRun = async (): Promise<GateResult> => {
      const { root, frPath } = makeEpicRepo();
      const d = makeDouble({
        binding: "epic",
        epics: [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }],
      });
      return withCanonical(TOKENLESS_CANONICAL, () =>
        assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
          projectRoot: root,
          mode: "jira",
          sleep: noSleep,
        }),
      );
    };
    const labelRes = await labelRun();
    const epicRes = await epicRun();
    expect(labelRes.outcome).toBe("refused");
    expect(epicRes.outcome).toBe("refused");
    const labelRoute = routeOf("label + token-less name", labelRes.detail!);
    const epicRoute = routeOf("epic + token-less name", epicRes.detail!);
    expect(`epic route = ${epicRoute}`).toBe(`epic route = ${labelRoute}`);

    // …and it is a REGISTERED route carrying the unusable-name remedy, not a
    // route invented at the new call site.
    const registry = await remedyRegistry();
    expect(`${epicRoute} registered: ${epicRoute in registry}`).toBe(
      `${epicRoute} registered: true`,
    );
    const epicRemedy = remedyOf("epic + token-less name", epicRes.detail!);
    expect(
      `${matchesTemplate(epicRemedy, registry[epicRoute]!) ? "matches" : `"${epicRemedy}"`}`,
    ).toBe("matches");
    // It points at the plan heading the operator must fix, naming THIS FR's
    // plan file — not at a tracker repair.
    expect(epicRemedy).toContain(`specs/plan/${EPIC_MILESTONE}.md`);
    expect(epicRemedy).toMatch(/heading/i);
  });

  test("the epic refusal is NOT the landed-but-absent one — the misdirection is gone", async () => {
    const { root, frPath } = makeEpicRepo();
    const d = makeDouble({
      binding: "epic",
      epics: [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }],
    });
    const res = await withCanonical(TOKENLESS_CANONICAL, () =>
      assertMilestoneBindingAtArchive(d.provider, EPIC_PROJECT, frPath, {
        projectRoot: root,
        mode: "jira",
        sleep: noSleep,
      }),
    );
    expect(res.outcome).toBe("refused");
    const route = routeOf("epic + token-less name", res.detail!);
    // Route 6 is the one the audit found this state landing on. Its id is read
    // out of the degrade scenario the AC.11 drivers already exercise.
    const degrade = await routeCase(6);
    expect(`epic token-less route === landed-but-absent route: ${route === degrade.route}`).toBe(
      "epic token-less route === landed-but-absent route: false",
    );
    // And the operator is told what is actually wrong: the NAME.
    expect(res.detail!).toContain(TOKENLESS_CANONICAL);
    expect(res.detail!).toMatch(/token/i);
    expect(res.detail!).not.toMatch(/still absent/i);
  });

  test("ANTI-VACUITY: object is the ONLY exemption — it still reaches the fetch and asserts", async () => {
    // The matrix is the whole claim in one place: a guard that refused every
    // binding at line one satisfies the two rows above and fails here, and a
    // guard scoped back to `label` fails the epic row.
    const verdicts: string[] = [];
    for (const { binding, needsToken } of TOKEN_NEEDED) {
      const isEpic = binding === "epic";
      const { root, frPath } = isEpic
        ? makeEpicRepo()
        : binding === "label"
          ? makeRepo({ trackerBlock: `tracker:\n  jira: ${OBJ_TICKET}` })
          : makeObjectRepo();
      const d = makeDouble({
        binding: binding === "object" ? undefined : binding,
        // The object route's ticket is genuinely bound to the token-less name,
        // so its `asserted` is earned rather than accidental.
        ticket:
          binding === "object" ? { projectMilestone: { name: TOKENLESS_CANONICAL } } : undefined,
        epics: isEpic ? [{ key: EPIC_KEY, name: TOKENLESS_CANONICAL }] : undefined,
      });
      const project = isEpic ? EPIC_PROJECT : binding === "label" ? "DST" : OBJ_PROJECT;
      const res = await withCanonical(TOKENLESS_CANONICAL, () =>
        assertMilestoneBindingAtArchive(d.provider, project, frPath, {
          projectRoot: root,
          mode: binding === "object" ? "linear" : "jira",
          sleep: noSleep,
        }),
      );
      expect(res.outcome).not.toBe("vacuous");
      verdicts.push(`${binding} (needsToken=${needsToken}): ${res.outcome}, ${d.calls.length} calls`);
    }
    expect(verdicts).toEqual([
      "object (needsToken=false): asserted, 1 calls",
      "label (needsToken=true): refused, 0 calls",
      "epic (needsToken=true): refused, 0 calls",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-524.11 (AMENDED) — exhaustiveness over refusal SITES, not route ids
// ═══════════════════════════════════════════════════════════════════════
//
// The id-based pins above (each id appearing exactly twice; the registry's key
// set equalling the exercised set) are defeatable, and the audit defeated
// them: WIDENING an existing branch's condition, or EXTRACTING one refusal
// into a helper called from two places, adds a new CAUSE with no new id
// literal. Every id-based pin stays green while the new cause inherits a
// remedy written for a different fault — which is exactly how one shared line
// came to cover six causes in the first place.
//
// THE COUNTING RULE, stated so the next reader can judge it:
//
//   A refusal SITE is a `return` statement in the body of
//   `assertMilestoneBindingAtArchive` ITSELF — not in a closure it declares —
//   whose value is a refusal verdict.
//
//   Every such `return` is CLASSIFIED, and an unclassifiable one FAILS rather
//   than being silently dropped. Classification never matches on a helper's
//   NAME: a return is `vacuous` / `asserted` / `refused` according to the
//   outcome literal or the exported verdict token that its expression
//   mentions, and when the expression is a bare call the CALLEE'S BODY is
//   resolved and read the same way. So renaming `refused` to anything at all
//   leaves the count untouched, and so does any amount of reflow — the source
//   is scanned with comments and string contents blanked out at preserved
//   offsets, never line by line.
//
// PROVEN, not asserted: the rule is re-run below on three mutants of the real
// module source — one with a refusal site duplicated (the shape both defeats
// above produce: a second site raising an id already registered), one with the
// shared refusal builder renamed, and one reflowed. The duplicate must count
// SEVEN; the other two must still count SIX.

/** Comments blanked, and (in `skeleton`) string contents too — offsets preserved. */
function blankNoise(src: string): { code: string; skeleton: string } {
  const code = src.split("");
  const skel = src.split("");
  const blank = (buf: string[], from: number, to: number): void => {
    for (let k = from; k < to && k < buf.length; k++) if (buf[k] !== "\n") buf[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blank(code, i, j);
      blank(skel, i, j);
      i = j;
      continue;
    }
    if (c === "/" && n === "*") {
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(src.length, j + 2);
      blank(code, i, j);
      blank(skel, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      blank(skel, i + 1, Math.min(j, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }
    i++;
  }
  return { code: code.join(""), skeleton: skel.join("") };
}

/** Index just past the bracket at `open`'s matching close. */
function balancedEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Index of the `;` (or closing bracket) that ends a `return` expression. */
function expressionEnd(skel: string, from: number): number {
  let depth = 0;
  for (let i = from; i < skel.length; i++) {
    const c = skel[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0) return i;
      depth--;
    } else if (c === ";" && depth === 0) return i;
  }
  return skel.length;
}

type Verdict = "vacuous" | "asserted" | "refused";

/** Which verdict a piece of source produces — by outcome literal or token. */
function verdictFromText(text: string): Verdict | null {
  const hits: Verdict[] = [];
  if (/outcome\s*:\s*"vacuous"/.test(text)) hits.push("vacuous");
  if (
    /outcome\s*:\s*"asserted"/.test(text) ||
    text.includes("MILESTONE_LABEL_ASSERTED_AT_ARCHIVE")
  ) {
    hits.push("asserted");
  }
  if (
    /outcome\s*:\s*"refused"/.test(text) ||
    text.includes("MILESTONE_LABEL_ARCHIVE_REFUSED")
  ) {
    hits.push("refused");
  }
  return hits.length === 1 ? hits[0]! : null;
}

/** The body text of a module-level `function NAME(...)` / `const NAME = ...`. */
function functionBodyOf(name: string, code: string, skel: string): string | null {
  const re = new RegExp(
    `(?:^|[^\\w$])(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`,
  );
  const m = re.exec(skel);
  if (!m) return null;
  const open = skel.indexOf("{", m.index + m[0].length);
  if (open < 0) return null;
  return code.slice(open, balancedEnd(skel, open));
}

interface SiteScan {
  /** Every classified `return` in the gate's own body. */
  returns: { verdict: Verdict | null; expr: string; start: number; end: number }[];
  refusalSites: number;
  unclassified: string[];
}

/** Apply the counting rule to a copy of the module source. */
function scanRefusalSites(src: string): SiteScan {
  const { code, skeleton } = blankNoise(src);
  const decl = skeleton.indexOf("function assertMilestoneBindingAtArchive");
  if (decl < 0) throw new Error("scanRefusalSites: the gate function was not found");
  const params = skeleton.indexOf("(", decl);
  const bodyOpen = skeleton.indexOf("{", balancedEnd(skeleton, params));
  const bodyEnd = balancedEnd(skeleton, bodyOpen);
  const body = skeleton.slice(bodyOpen, bodyEnd);

  // Closures declared INSIDE the gate return their own shapes, not verdicts.
  const nested: [number, number][] = [];
  for (const m of body.matchAll(/=>\s*\{/g)) {
    const open = bodyOpen + m.index + m[0].length - 1;
    nested.push([open, balancedEnd(skeleton, open)]);
  }
  for (const m of body.matchAll(/(?:^|[^\w$])function\b/g)) {
    const open = skeleton.indexOf("{", bodyOpen + m.index + m[0].length);
    if (open >= 0 && open < bodyEnd) nested.push([open, balancedEnd(skeleton, open)]);
  }

  const returns: SiteScan["returns"] = [];
  for (const m of body.matchAll(/\breturn\b/g)) {
    const at = bodyOpen + m.index;
    if (nested.some(([a, b]) => at > a && at < b)) continue;
    const start = at + "return".length;
    const end = expressionEnd(skeleton, start);
    const expr = code.slice(start, end).trim();
    let verdict = verdictFromText(expr);
    if (verdict === null) {
      const call = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(expr);
      const callee = call ? functionBodyOf(call[1]!, code, skeleton) : null;
      if (callee !== null) verdict = verdictFromText(callee);
    }
    returns.push({ verdict, expr, start: at, end: end + 1 });
  }
  return {
    returns,
    refusalSites: returns.filter((r) => r.verdict === "refused").length,
    unclassified: returns.filter((r) => r.verdict === null).map((r) => r.expr.slice(0, 80)),
  };
}

describe("AC-STE-524.11 (amended) — the exhaustiveness pin counts SITES", () => {
  const source = (): string => readFileSync(MODULE_PATH, "utf-8");

  test("every `return` in the gate's own body classifies — nothing is silently dropped", () => {
    // The count below is only trustworthy if the rule leaves no residue. A
    // return the rule cannot place fails HERE, naming itself, rather than
    // quietly lowering or raising the site count.
    const scan = scanRefusalSites(source());
    expect(`unclassified: ${scan.unclassified.join(" | ")}`).toBe("unclassified: ");
    expect(scan.returns.length).toBeGreaterThan(scan.refusalSites);
    // The gate really does return all three verdicts — a scan that had lost
    // the body and found nothing would otherwise read as a clean pass.
    for (const verdict of ["vacuous", "asserted", "refused"] as Verdict[]) {
      expect(`${verdict} returns: ${scan.returns.some((r) => r.verdict === verdict)}`).toBe(
        `${verdict} returns: true`,
      );
    }
  });

  test("EXHAUSTIVE BY SITE: refusal sites === ARCHIVE_REFUSAL_REMEDIES entries", async () => {
    const registry = await remedyRegistry();
    const scan = scanRefusalSites(source());
    expect(`${scan.refusalSites} refusal sites`).toBe(
      `${Object.keys(registry).length} refusal sites`,
    );
  });

  test("the rule is FALSIFIABLE: a hypothetical seventh site counts seven", async () => {
    // The mutant is built from the module's OWN text — the first refusal
    // statement is duplicated in place — so it reproduces the shape both
    // id-based defeats produce: a second site whose route id is already
    // registered. No new id literal appears, so every id-based pin above
    // stays green; this one must not.
    const src = source();
    const first = scanRefusalSites(src).returns.find((r) => r.verdict === "refused");
    expect(first ? "found a refusal site to duplicate" : "NO refusal site found").toBe(
      "found a refusal site to duplicate",
    );
    const stmt = src.slice(first!.start, first!.end);
    const mutant = `${src.slice(0, first!.start)}${stmt}\n    ${src.slice(first!.start)}`;
    const registry = await remedyRegistry();
    expect(`mutant sites: ${scanRefusalSites(mutant).refusalSites}`).toBe(
      `mutant sites: ${Object.keys(registry).length + 1}`,
    );
    expect(scanRefusalSites(mutant).unclassified).toEqual([]);
  });

  test("the rule is NOT brittle: renaming the shared refusal builder still counts six", async () => {
    // Classification resolves the callee's BODY, never its name, so this is a
    // rename the pin must survive.
    const src = source();
    const renamed = src.replace(/\brefused\s*\(/g, "denied(");
    expect(renamed).not.toBe(src);
    const registry = await remedyRegistry();
    const scan = scanRefusalSites(renamed);
    expect(scan.unclassified).toEqual([]);
    expect(`renamed sites: ${scan.refusalSites}`).toBe(
      `renamed sites: ${Object.keys(registry).length}`,
    );
  });

  test("the rule is NOT brittle: reflowing the module still counts six", async () => {
    const src = source();
    const registry = await remedyRegistry();
    for (const [label, reflowed] of [
      ["blank-lined", src.replace(/\n/g, "\n\n")],
      ["re-indented", src.replace(/^/gm, "  ")],
    ] as [string, string][]) {
      const scan = scanRefusalSites(reflowed);
      expect(`${label}: ${scan.unclassified.join(" | ")}`).toBe(`${label}: `);
      expect(`${label} sites: ${scan.refusalSites}`).toBe(
        `${label} sites: ${Object.keys(registry).length}`,
      );
    }
  });
});

// M_8f07e0 STE-585 — the minted milestone Epic carries its milestone label.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-09-10, on the
// M_8f07e0 branch after STE-584 landed):
//
//   * `adapters/_shared/src/mint_milestone_epic.ts` returns
//     `{ epicKey, milestoneId }` and never calls a label op. Its provider type
//     is `Pick<MilestoneOps, "createEpic" | "listEpics">` — `addLabel` is not
//     even reachable from it.
//   * The Jira listing reader counts an Epic only when its SUMMARY leads with a
//     milestone token, and the mint creates the Epic under its human title
//     alone — so a freshly minted Epic is invisible to the Epic leg, and with
//     no label written it is invisible to the label leg too.
//   * `adapters/jira.md` says "It scatters no `milestone-<M-token>` label"
//     (`grep -c 'It scatters no'` = 1 at HEAD, measured).
//   * `CANONICAL_CAPABILITY_KEYS.length` is 45 at HEAD (measured).
//   * The mint front door prints exactly four lines at HEAD (measured):
//     `summary=Waiting States II`, `epicKey=GF-78`, `milestoneId=M_GF_78`,
//     `plan=specs/plan/M_GF_78.md`.
//
// TEST STRATEGY.
//
//   * Every provider op is a RECORDING double; assertions are on call counts
//     and arguments, never on the module's source text (FR ## Testing).
//   * `opts.sleep` is always injected as a recorder, so "the label write sits
//     outside the retry" is observed as zero sleeps with a rejecting addLabel
//     (a plain Error IS retried by `retryTransient`, so a label write moved
//     inside the retry would record sleeps here).
//   * AC.6/AC.7 are a real ROUND TRIP: the label the mint actually handed to
//     `addLabel` is what gets fed into the shipped `listMilestones` reader —
//     not a literal typed into the test (the literal is asserted alongside).
//   * AC.8/AC.9 locate each `adapters/jira.md` section by its `## ` heading
//     (ending at the next `## `), never by line number.
//   * AC.11 SPAWNS the front door as a subprocess; it is never imported.
//
// DELIBERATE OMISSIONS.
//
//   * AC.10 is a non-regression pin: it is GREEN at HEAD by design (45 today).
//   * AC.4 is an ordering guard (label after derivation): the "zero addLabel
//     calls on a refused key" half is trivially true at HEAD, where no label
//     op is ever called.
//   * AC.11's "read off the recorded label argument" is an implementation
//     property no subprocess can observe without reading source text; only
//     the printed line is pinned.
//   * AC.12 (full `bun test`, zero failures, skip count 15) is a gate command,
//     not something a test file can assert about the run it is part of.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { mintMilestoneEpic } from "../adapters/_shared/src/mint_milestone_epic";
import { listMilestones } from "../adapters/jira/src/list_milestones";

const pluginRoot = join(import.meta.dir, "..");
const MINT_MODULE = join(pluginRoot, "adapters", "_shared", "src", "mint_milestone_epic.ts");
const JIRA_DOC = join(pluginRoot, "adapters", "jira.md");

// ───────────────────────────────────────────────────────────────────────
// Fixture constants — a real Jira-shaped mint.
// ───────────────────────────────────────────────────────────────────────

const PROJECT = "GF";
const TITLE = "Waiting States II";
const EPIC_KEY = "GF-78";
const MILESTONE_ID = "M_GF_78";
const LABEL = "milestone-M_GF_78";

// ───────────────────────────────────────────────────────────────────────
// Recording provider double.
// ───────────────────────────────────────────────────────────────────────

type Call =
  | { op: "createEpic"; project: string; name: string }
  | { op: "listEpics"; project: string }
  | { op: "addLabel"; ticketId: string; label: string };

interface RecorderOptions {
  createKey?: string;
  epics?: { key: string; name: string }[];
  withListEpics?: boolean;
  withAddLabel?: boolean;
  addLabelRejects?: boolean;
}

function makeRecorder(o: RecorderOptions = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const provider: {
    createEpic?: (project: string, opts: { name: string }) => Promise<{ key: string }>;
    listEpics?: (project: string) => Promise<{ key: string; name: string }[]>;
    addLabel?: (ticketId: string, label: string) => Promise<void>;
  } = {
    createEpic: async (project: string, opts: { name: string }) => {
      calls.push({ op: "createEpic", project, name: opts.name });
      return { key: o.createKey ?? EPIC_KEY };
    },
  };
  if (o.withListEpics) {
    provider.listEpics = async (project: string) => {
      calls.push({ op: "listEpics", project });
      return o.epics ?? [];
    };
  }
  if (o.withAddLabel ?? true) {
    provider.addLabel = async (ticketId: string, label: string) => {
      calls.push({ op: "addLabel", ticketId, label });
      if (o.addLabelRejects) throw new Error("Jira 503: label write timed out");
    };
  }
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const addLabelCalls = () =>
    calls.filter((c): c is Extract<Call, { op: "addLabel" }> => c.op === "addLabel");
  const createCalls = () => calls.filter((c) => c.op === "createEpic");
  return { calls, sleeps, provider, sleep, addLabelCalls, createCalls };
}

// ───────────────────────────────────────────────────────────────────────
// Mint behaviour — AC.1 … AC.5
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-585.1 — the mint writes the milestone label on the Epic it created", () => {
  test("exactly one addLabel(GF-78, milestone-M_GF_78), after the create, and labelled: true", async () => {
    const r = makeRecorder();
    const result = await mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep });

    expect(r.addLabelCalls()).toEqual([{ op: "addLabel", ticketId: EPIC_KEY, label: LABEL }]);
    // The label is written on the key the create allocated — so after it.
    expect(r.calls.map((c) => c.op)).toEqual(["createEpic", "addLabel"]);
    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: true });
    expect(r.sleeps).toEqual([]);
  });

  test("the label derives from the sanitized id, not the raw key", async () => {
    const r = makeRecorder({ createKey: "DPT-500" });
    const result = await mintMilestoneEpic(r.provider as never, "DPT", TITLE, { sleep: r.sleep });

    expect(r.addLabelCalls()).toEqual([{ op: "addLabel", ticketId: "DPT-500", label: "milestone-M_DPT_500" }]);
    expect(result).toEqual({ epicKey: "DPT-500", milestoneId: "M_DPT_500", labelled: true });
  });
});

describe("AC-STE-585.2 — a failed label write never fails the mint, and is never retried", () => {
  test("rejecting addLabel ⇒ resolves labelled: false, one addLabel call, zero sleeps", async () => {
    const r = makeRecorder({ addLabelRejects: true });

    const result = await mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep });

    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: false });
    expect(r.addLabelCalls()).toEqual([{ op: "addLabel", ticketId: EPIC_KEY, label: LABEL }]);
    expect(r.addLabelCalls().length).toBe(1);
    // A plain Error IS transient to retryTransient — a label write inside the
    // retry would have slept and re-created. Outside it: zero sleeps, one create.
    expect(r.sleeps).toEqual([]);
    expect(r.createCalls().length).toBe(1);
  });
});

describe("AC-STE-585.3 — a provider carrying only createEpic still mints", () => {
  test("no addLabel op ⇒ resolves with labelled: false", async () => {
    const r = makeRecorder({ withAddLabel: false });
    expect(r.provider.addLabel).toBeUndefined();

    const result = await mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep });

    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: false });
    expect(r.createCalls().length).toBe(1);
    expect(r.sleeps).toEqual([]);
  });
});

describe("AC-STE-585.4 — an unsanitizable key refuses before any label is written", () => {
  test('createEpic → key "" rejects with the derivation\'s own refusal; zero addLabel calls', async () => {
    const r = makeRecorder({ createKey: "" });

    await expect(mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep })).rejects.toThrow(
      /milestoneIdFromEpicKey: Epic key "" does not sanitize to a well-formed `M_<epic-key>` milestone id/,
    );
    expect(r.addLabelCalls()).toEqual([]);
    expect(r.createCalls().length).toBe(1);
  });
});

describe("AC-STE-585.5 — a found Epic is labelled, not re-created", () => {
  test("listEpics carries the title ⇒ createEpic ×0, addLabel ×1 with the FOUND key", async () => {
    const r = makeRecorder({
      withListEpics: true,
      // If the create were reached it would allocate GF-99 — a key that must
      // then NOT appear on the label call.
      createKey: "GF-99",
      epics: [
        { key: "GF-12", name: "Some Other Milestone" },
        { key: EPIC_KEY, name: TITLE },
      ],
    });

    const result = await mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep });

    expect(r.createCalls()).toEqual([]);
    expect(r.addLabelCalls()).toEqual([{ op: "addLabel", ticketId: EPIC_KEY, label: LABEL }]);
    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: true });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round trip through the shipped reader — AC.6, AC.7
// ───────────────────────────────────────────────────────────────────────

/** Mint once and return the label the mint actually handed to addLabel. */
async function mintedLabel(): Promise<string | undefined> {
  const r = makeRecorder();
  await mintMilestoneEpic(r.provider as never, PROJECT, TITLE, { sleep: r.sleep });
  const labels = r.addLabelCalls();
  expect(labels.length).toBe(1);
  return labels[0]?.label;
}

const labelPage = (labels: string[]) => async (_page: number) => ({ issues: [{ labels }], isLast: true });

describe("AC-STE-585.6 — the minted label round-trips through listMilestones", () => {
  test("the recorded label reads back as [{ name: M_GF_78 }]; malformed neighbours read back as []", async () => {
    const written = await mintedLabel();
    expect(written).toBe(LABEL);

    expect(await listMilestones(labelPage([written as string]))).toEqual([{ name: MILESTONE_ID }]);

    // Negative controls, same test: the reader's exact anchor still rejects them.
    for (const bad of ["milestone-M_", "milestone-M5-extra", "xmilestone-M5"]) {
      expect({ label: bad, listed: await listMilestones(labelPage([bad])) }).toEqual({ label: bad, listed: [] });
    }
  });
});

describe("AC-STE-585.7 — the same milestone through both legs is deduped, not double-counted", () => {
  test("recorded label + Epic { GF-78, 'M_GF_78 — Waiting States II' } ⇒ exactly one entry", async () => {
    const written = await mintedLabel();
    expect(written).toBe(LABEL);

    const listed = await listMilestones(labelPage([written as string]), {
      fetchEpicPage: async (_page: number) => ({
        epics: [{ key: EPIC_KEY, summary: `${MILESTONE_ID} — ${TITLE}` }],
        isLast: true,
      }),
    });

    expect(listed).toEqual([{ name: MILESTONE_ID }]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Prose — AC.8, AC.9 (graded on the NAMED file, sections by heading)
// ───────────────────────────────────────────────────────────────────────

/** The body of the `## <prefix>…` section, up to (not including) the next `## ` heading. */
function section(doc: string, headingPrefix: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${headingPrefix}`));
  if (start < 0) throw new Error(`jira.md: no section headed "## ${headingPrefix}"`);
  const rel = lines.slice(start + 1).findIndex((l) => l.startsWith("## "));
  const end = rel < 0 ? lines.length : start + 1 + rel;
  return lines.slice(start, end).join("\n");
}

/** Whitespace-normalized sentences (hard-wrapped markdown joined first). */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The paragraph that opens with `leadIn`, up to the next blank line. */
function paragraph(text: string, leadIn: string): string {
  const at = text.indexOf(leadIn);
  if (at < 0) throw new Error(`jira.md: no paragraph opening with "${leadIn}"`);
  const rest = text.slice(at);
  const blank = rest.search(/\n\s*\n/);
  return blank < 0 ? rest : rest.slice(0, blank);
}

const jiraDoc = () => readFileSync(JIRA_DOC, "utf-8");

describe("AC-STE-585.8 — adapters/jira.md stops contradicting the code", () => {
  test("`It scatters no` occurs 0 times in the file (1 at v2.81.0)", () => {
    const hits = jiraDoc().split("It scatters no").length - 1;
    expect(hits).toBe(0);
  });

  test("## Project Milestone carries a sentence naming `milestone-M_` AND the mint, on the Epic", () => {
    const body = section(jiraDoc(), "Project Milestone");
    const hits = sentences(body).filter(
      (s) => s.includes("milestone-M_") && /\bmint/i.test(s) && /\bEpic\b/.test(s),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("the per-FR attach (`parent`) paragraph still states no label is written on the FR ticket", () => {
    const body = section(jiraDoc(), "Project Milestone");
    const membership = paragraph(body, "**Membership");
    // A REWORDING that keeps the ticket-level truth — never a deletion.
    const hits = sentences(membership).filter(
      (s) =>
        /\b(no|never|not|nothing)\b/i.test(s) &&
        /\blabel\b/i.test(s) &&
        /\b(FR|ticket|Task)\b/.test(s),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-585.9 — the label leg names why it sees an Epic's label", () => {
  test("step 2 of ## Milestone Listing carries `labels IS NOT EMPTY` and the absent-issuetype clause", () => {
    const body = section(jiraDoc(), "Milestone Listing");
    const lines = body.split("\n");
    const s2 = lines.findIndex((l) => /^2\.\s/.test(l));
    expect(s2).toBeGreaterThanOrEqual(0);
    const relEnd = lines.slice(s2 + 1).findIndex((l) => /^(3\.\s|\S)/.test(l) && !/^\s/.test(l));
    const step2 = lines.slice(s2, relEnd < 0 ? lines.length : s2 + 1 + relEnd).join("\n");

    expect(step2).toMatch(/Label leg/i);
    expect(step2).toContain("labels IS NOT EMPTY");
    const clause = sentences(step2).filter(
      (s) =>
        /issuetype/i.test(s) &&
        /\b(no|without|absent|absence|not|omits?|lacks?)\b/i.test(s) &&
        /\bEpic/.test(s) &&
        /\blabel/i.test(s),
    );
    expect(clause.length).toBeGreaterThanOrEqual(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.10 — no new capability key
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-585.10 — no new capability key", () => {
  test("CANONICAL_CAPABILITY_KEYS.length is still 45", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(45);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.11 — the front door stays a preview (spawned, never imported)
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-585.11 — the front door prints the label and writes nothing", () => {
  test("exit 0, the four existing lines unchanged and in order, plus label=milestone-M_GF_78", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ste-585-door-"));
    try {
      const run = spawnSync("bun", ["run", MINT_MODULE, PROJECT, TITLE, EPIC_KEY], {
        cwd,
        encoding: "utf-8",
      });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);

      const lines = run.stdout.split("\n").filter((l) => l.length > 0);
      const existing = [
        `summary=${TITLE}`,
        `epicKey=${EPIC_KEY}`,
        `milestoneId=${MILESTONE_ID}`,
        `plan=specs/plan/${MILESTONE_ID}.md`,
      ];
      // The four existing lines, byte-unchanged and in their original order.
      expect(lines.filter((l) => existing.includes(l))).toEqual(existing);
      // Exactly one added line: the label.
      expect(lines.filter((l) => l.startsWith("label="))).toEqual([`label=${LABEL}`]);
      expect(lines.length).toBe(5);

      // It writes nothing: the working directory it ran in is still empty.
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Stage C hardening (post-audit) — AC.8 pinned the label sentence but not its
// restriction. Prose that later claimed the attach ALSO writes the label would
// have stayed green, so the mint-time-only restriction is pinned by name.
// ===========================================================================

describe("Stage C hardening — the Epic label is written at mint time only", () => {
  test("## Project Milestone names the restriction `at mint time only`", () => {
    const body = section(jiraDoc(), "Project Milestone");
    expect(body).toMatch(/at mint time only/i);
  });
});

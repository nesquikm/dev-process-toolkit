// M_79b1f6 / STE-592 — the executing Epic mint prose names its label step and
// its join mode.
//
// THE DEFECT, measured on the live tree at authoring time (2026-09-10):
//
//   * `skills/spec-write/SKILL.md` line 177 is ONE line of 11,370 characters,
//     lines 176 and 178 blank, the file 358 split-lines. Its Jira Epic-first
//     branch says the mint returns `{ epicKey, milestoneId }` — two fields —
//     while `mintMilestoneEpic` returns three: `{ epicKey, milestoneId,
//     labelled }`. The line never says "label" at all: the `milestone-M_<key>`
//     label the mint writes after deriving the id, outside its retry, is
//     missing.
//   * Its no-enumerator sentence (near character 10,564, after the STE-580
//     tail "no Epic is ever created off the Jira path.", which ends at exactly
//     character 9,675) describes a refusal that only `{ join: true }` raises,
//     while never naming that mode. Without it, a provider with no `listEpics`
//     MINTS — the helper refuses only in join mode.
//   * `adapters/jira.md` already says both: the "Epic label — at mint time
//     only." paragraph names `milestone-M_<key>` and `labelled`, and "Joining,
//     never minting." names `{ join: true }`.
//
// THREE KINDS OF CHECK, labelled at each block:
//
//   PRESENCE PINS (must be RED before the fix): AC.1, AC.2 and the line-177
//   half of AC.6. They catch the clause being ABSENT or DELETED. They do not
//   catch a model misreading it, because no fixture drives /spec-write and
//   records what it does with the line. Each one is scoped to the Jira
//   Epic-first branch of line 177 or to the text after the STE-580 tail, never
//   to the whole 11,000-character line. Each label matcher also runs against
//   `adapters/jira.md`, which must match (the known positive), so a matcher
//   that could never match cannot pass as a real RED.
//
//   BEHAVIOUR PINS (REGRESSION, expected GREEN before the fix): the prose must
//   describe what `mintMilestoneEpic` actually does, so the helper is driven
//   on a recording fake provider: its return keys, the label string and its
//   ordering, a throwing label write, and `{ join: true }` without
//   `listEpics`. Each carries a control showing it can fail.
//
//   STRUCTURAL PINS (REGRESSION, expected GREEN before the fix): AC.3, AC.4,
//   AC.5 and the adapter half of AC.6 — line and token budgets, the
//   reachability probe, and the STE-580 suite run in a child `bun test`.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mintMilestoneEpic } from "../adapters/_shared/src/mint_milestone_epic";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

// ===========================================================================
// Paths and measured constants.
// ===========================================================================

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const JIRA_DOC = join(pluginRoot, "adapters", "jira.md");
const STE_580_SUITE_REL = "tests/m_840a06-ste-580-second-repo-joins.test.ts";
const STE_580_SUITE = join(pluginRoot, STE_580_SUITE_REL);

/** Measured: `body.split("\n").length`. The rewrite is in place. */
const SPLIT_LINES = 358;
/** Measured: sixteen `<dir>/<file>.ts` paths on line 177. */
const MODULE_PATHS_ON_LINE_177 = 16;
/** Measured: STE tokens in the file, and across skills/**\/*.md. */
const STE_TOKENS_IN_FILE = 54;
const STE_TOKENS_IN_SKILLS_TREE = 245;
/** Measured: the first characters of line 111. */
const LINE_111_PREFIX = "   **Milestone attachment (any adapter with `project_milestone: true`";

/** The STE-580 tail. The no-enumerator sentence sits after it. */
const STE_580_TAIL = "no Epic is ever created off the Jira path.";
const JIRA_BRANCH_START = "**Jira Epic-first branch";
const JIRA_BRANCH_END = "**Tracker-less minted branch";

const LABEL_LITERAL = "`milestone-M_<key>`";
const JOIN_LITERAL = "`{ join: true }`";
const TRIPLE_LITERAL = "`{ epicKey, milestoneId, labelled }`";
const PAIR_LITERAL = "`{ epicKey, milestoneId }`";

const MODULE_PATH_RE = /[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\.ts\b/g;

// The three label-step matchers (AFTER_DERIVATION_RE, OUTSIDE_RETRY_RE,
// NEVER_FAILS_MINT_RE) are each run against `adapters/jira.md` as a known
// positive, so none of them can be RED merely because it can never match.
// WITHOUT_MODE_RE has no jira.md positive — jira.md words that fact
// differently — so its positive is the AC.2 pin on line 177 itself, and its
// negative control is the real Linear branch, like the other three.
const AFTER_DERIVATION_RE = /\bafter\b[^.]{0,60}(\bderiv|\bid\b|`milestoneId`)/i;
const OUTSIDE_RETRY_RE = /\boutside\b[^.]{0,40}\bretry\b/i;
const NEVER_FAILS_MINT_RE = /\blabel write\b[^.]{0,40}\bnever fails the mint\b/i;
const WITHOUT_MODE_RE = /\bwithout (that|this|the join|join)\b[^.]{0,20}\bmode\b/i;

// ===========================================================================
// Readers.
// ===========================================================================

const read = (p: string): string => readFileSync(p, "utf-8");
const collapse = (s: string): string => s.replace(/\s+/g, " ");

function splitLines(): string[] {
  return read(SPEC_WRITE_SKILL).split("\n");
}

function line177(): string {
  const line = splitLines()[176];
  expect(line, "line 177 must exist, since it holds the allocation guard").toBeString();
  return line as string;
}

/**
 * Split prose into sentences at a terminal mark followed by whitespace. A
 * `.ts` path is followed by a backtick, not whitespace, so it does not split.
 * The abbreviations `e.g.` / `i.e.` are protected first, so they do not split
 * either.
 */
function sentences(text: string): string[] {
  const guarded = text.replace(/\b(e\.g|i\.e)\./g, (m) => m.replace(/\./g, "․"));
  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/․/g, "."))
    .filter((s) => s.trim().length > 0);
}

/** The Jira Epic-first branch of line 177: its own start to the next branch. */
function jiraBranch(): string {
  const line = line177();
  const start = line.indexOf(JIRA_BRANCH_START);
  const end = line.indexOf(JIRA_BRANCH_END);
  expect(start, `line 177 must still carry "${JIRA_BRANCH_START}"`).toBeGreaterThan(-1);
  expect(end, `line 177 must still carry "${JIRA_BRANCH_END}" after the Jira branch`).toBeGreaterThan(
    start,
  );
  return line.slice(start, end);
}

/** Every sentence of the Jira branch that mentions a label (incl. `labelled`). */
function labelPassage(): string {
  return sentences(jiraBranch())
    .filter((s) => /\blabel/i.test(s))
    .join(" ");
}

/** The Jira-branch sentences that name the `milestone-M_<key>` label itself. */
function labelSentences(): string {
  return sentences(jiraBranch())
    .filter((s) => s.includes(LABEL_LITERAL))
    .join(" ");
}

/** Line 177 after the STE-580 tail. The no-enumerator sentence lives here. */
function afterTail(): string {
  const line = line177();
  const idx = line.indexOf(STE_580_TAIL);
  expect(idx, `line 177 must still carry the STE-580 tail "${STE_580_TAIL}"`).toBeGreaterThan(-1);
  return line.slice(idx + STE_580_TAIL.length);
}

/**
 * The no-enumerator sentence: the post-tail sentence naming both `listEpics`
 * and `{ join: true }`. When no sentence names both (today's tree), it falls
 * back to the first post-tail `listEpics` sentence. That is today's
 * no-enumerator sentence, so each element below reports its OWN miss instead
 * of all failing on one lookup.
 */
function noEnumeratorSentence(): string {
  const withEnum = sentences(afterTail()).filter((s) => s.includes("listEpics"));
  expect(withEnum.length, "line 177 after the STE-580 tail must name `listEpics`").toBeGreaterThan(0);
  return withEnum.find((s) => s.includes(JOIN_LITERAL)) ?? (withEnum[0] as string);
}

/** One `**Bold lead.**` paragraph of adapters/jira.md, whitespace collapsed. */
function jiraParagraph(lead: string): string {
  const body = read(JIRA_DOC).replace(/\r\n/g, "\n");
  const start = body.indexOf(lead);
  expect(start, `adapters/jira.md must carry the "${lead}" paragraph`).toBeGreaterThan(-1);
  const end = body.indexOf("\n\n", start);
  return collapse(body.slice(start, end === -1 ? body.length : end));
}

const EPIC_LABEL_LEAD = "**Epic label — at mint time only.**";
const JOINING_LEAD = "**Joining, never minting.**";

function steTokenCount(body: string): number {
  return (body.match(/STE-\d+/g) ?? []).length;
}

/** The returned-field lists the prose spells as `returning `{ … }``. */
function proseReturnFieldSets(text: string): string[][] {
  return [...text.matchAll(/\breturn\w*\s+`\{([^}`]*)\}`/g)].map((m) =>
    (m[1] as string)
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .sort(),
  );
}

// ===========================================================================
// Recording fake provider for mintMilestoneEpic.
// ===========================================================================

const PROJECT = "GF";
const TITLE = "Waiting States II";
const EPIC_KEY = "GF-78";
const MILESTONE_ID = "M_GF_78";
const LABEL = "milestone-M_GF_78";

type Call =
  | { op: "createEpic"; project: string; name: string }
  | { op: "listEpics"; project: string }
  | { op: "addLabel"; ticketId: string; label: string };

interface FakeOptions {
  createKey?: string;
  withListEpics?: boolean;
  epics?: { key: string; name: string }[];
  withAddLabel?: boolean;
  addLabelThrows?: boolean;
  /** Throw a plain (transient) Error on the first N createEpic calls. */
  createFailsTimes?: number;
}

function makeFake(o: FakeOptions = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let createFailures = o.createFailsTimes ?? 0;
  const provider: {
    createEpic?: (project: string, opts: { name: string }) => Promise<{ key: string }>;
    listEpics?: (project: string) => Promise<{ key: string; name: string }[]>;
    addLabel?: (ticketId: string, label: string) => Promise<void>;
  } = {
    createEpic: async (project, opts) => {
      calls.push({ op: "createEpic", project, name: opts.name });
      if (createFailures > 0) {
        createFailures -= 1;
        throw new Error("Jira 504: create timed out");
      }
      return { key: o.createKey ?? EPIC_KEY };
    },
  };
  if (o.withListEpics) {
    provider.listEpics = async (project) => {
      calls.push({ op: "listEpics", project });
      return o.epics ?? [];
    };
  }
  if (o.withAddLabel ?? true) {
    provider.addLabel = async (ticketId, label) => {
      calls.push({ op: "addLabel", ticketId, label });
      if (o.addLabelThrows) throw new Error("Jira 503: label write timed out");
    };
  }
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const ops = () => calls.map((c) => c.op);
  const count = (op: Call["op"]) => calls.filter((c) => c.op === op).length;
  const labelCalls = () =>
    calls.filter((c): c is Extract<Call, { op: "addLabel" }> => c.op === "addLabel");
  return { calls, sleeps, provider, sleep, ops, count, labelCalls };
}

async function mintResult(o: FakeOptions = {}) {
  const fake = makeFake(o);
  const result = await mintMilestoneEpic(fake.provider, PROJECT, TITLE, { sleep: fake.sleep });
  return { fake, result };
}

// ===========================================================================
// AC-STE-592.1 — PRESENCE PINS (RED before the fix).
// The Jira branch of line 177 names the three-field return and the label step.
// ===========================================================================

describe("AC-STE-592.1 — the Jira mint description returns three fields and writes the label (PRESENCE)", () => {
  test("the Jira branch spells the return as `{ epicKey, milestoneId, labelled }`", () => {
    expect(
      jiraBranch(),
      "the helper returns THREE fields; the executing prose must name all three",
    ).toContain(TRIPLE_LITERAL);
  });

  test("the Jira branch no longer spells the two-field return `{ epicKey, milestoneId }`", () => {
    expect(
      jiraBranch(),
      "the two-field form is the defect: no mint ever returns just the pair",
    ).not.toContain(PAIR_LITERAL);
  });

  test("every returned-field list the Jira branch spells equals the helper's actual keys", async () => {
    const { result } = await mintResult();
    const actual = Object.keys(result).sort();
    const spelled = proseReturnFieldSets(jiraBranch());
    expect(spelled.length, "the Jira branch must spell the mint's return at least once").toBeGreaterThan(0);
    for (const fields of spelled) {
      expect(fields, "the prose names what the code returns, no more and no less").toEqual(actual);
    }
  });

  test("the Jira branch names the `milestone-M_<key>` label", () => {
    expect(
      labelSentences(),
      "the executing prose never mentions the label the mint writes on the Epic",
    ).toContain(LABEL_LITERAL);
  });

  test("the label sentence says the label is written AFTER the id is derived", () => {
    const s = labelSentences();
    expect(s, "no sentence of the Jira branch names the label yet").toContain(LABEL_LITERAL);
    expect(s, `the label step follows the derivation. Read: ${JSON.stringify(s)}`).toMatch(
      AFTER_DERIVATION_RE,
    );
  });

  test("the label sentence says the write sits OUTSIDE the retry", () => {
    const s = labelSentences();
    expect(s, "no sentence of the Jira branch names the label yet").toContain(LABEL_LITERAL);
    expect(s, `the label write is not re-paid on the backoff. Read: ${JSON.stringify(s)}`).toMatch(
      OUTSIDE_RETRY_RE,
    );
  });

  test("the label passage says a failed label write never fails the mint", () => {
    const p = labelPassage();
    expect(p, `the swallowed rejection must be stated. Read: ${JSON.stringify(p)}`).toMatch(
      NEVER_FAILS_MINT_RE,
    );
  });
});

// ===========================================================================
// AC-STE-592.2 — PRESENCE PINS (RED before the fix).
// The no-enumerator sentence ties the refusal to `{ join: true }`.
// ===========================================================================

describe("AC-STE-592.2 — the no-enumerator refusal belongs to the join call (PRESENCE)", () => {
  test("the no-enumerator sentence names `{ join: true }`", () => {
    const s = noEnumeratorSentence();
    expect(s, `the refusal is raised only in join mode. Read: ${JSON.stringify(s)}`).toContain(
      JOIN_LITERAL,
    );
  });

  test("the sentence says the refusal is raised by the join call", () => {
    const s = noEnumeratorSentence();
    expect(s, `Read: ${JSON.stringify(s)}`).toContain(JOIN_LITERAL);
    expect(s, "the refusal is attributed to the join CALL").toMatch(/\bjoin call\b/i);
    expect(s, "…and it is still a refusal").toMatch(/refus/i);
  });

  test("the sentence says the join call never creates", () => {
    const s = noEnumeratorSentence();
    expect(s, `Read: ${JSON.stringify(s)}`).toMatch(/\bnever creates\b/i);
  });

  test("the sentence says that without that mode a provider carrying no `listEpics` would mint", () => {
    const s = noEnumeratorSentence();
    expect(s).toContain("listEpics");
    expect(s, `the default mode MINTS without an enumerator. Read: ${JSON.stringify(s)}`).toMatch(
      WITHOUT_MODE_RE,
    );
    expect(s).toMatch(/\bwould mint\b/i);
  });
});

// ===========================================================================
// AC-STE-592.6 — line 177 half: PRESENCE PINS (RED before the fix).
// Adapter half: REGRESSION PINS (GREEN before the fix).
// ===========================================================================

describe("AC-STE-592.6 — line 177 and adapters/jira.md agree", () => {
  test("PRESENCE: line 177's Jira branch names the `milestone-M_<key>` label", () => {
    expect(jiraBranch()).toContain(LABEL_LITERAL);
  });

  test("PRESENCE: line 177 after the STE-580 tail names `{ join: true }`", () => {
    expect(afterTail()).toContain(JOIN_LITERAL);
  });

  test("REGRESSION: jira.md's Epic-label paragraph names `milestone-M_<key>` and `labelled`", () => {
    const p = jiraParagraph(EPIC_LABEL_LEAD);
    expect(p).toContain(LABEL_LITERAL);
    expect(p).toContain("`labelled`");
  });

  test("REGRESSION: jira.md's joining paragraph names `{ join: true }` and that a join never creates", () => {
    const p = jiraParagraph(JOINING_LEAD);
    expect(p).toContain(JOIN_LITERAL);
    expect(p).toMatch(/\bnever creates\b/i);
  });

  test("CONTROL: every label-step matcher matches jira.md, the known positive", () => {
    const para = jiraParagraph(EPIC_LABEL_LEAD);
    const labelled = sentences(para)
      .filter((s) => s.includes(LABEL_LITERAL))
      .join(" ");
    expect(labelled).toMatch(AFTER_DERIVATION_RE);
    expect(labelled).toMatch(OUTSIDE_RETRY_RE);
    expect(para).toMatch(NEVER_FAILS_MINT_RE);
  });

  test("CONTROL: the matchers do not fire on retry prose that describes no label step", () => {
    // Line 177's Linear branch describes a retry and a derivation and no label.
    // If the matchers fired here, they could not tell the label step apart.
    const line = line177();
    const linear = line.slice(line.indexOf("**Linear tracker-first branch"), line.indexOf(JIRA_BRANCH_START));
    expect(linear, "the negative control's subject still names a retry").toMatch(/\bretry\b/);
    expect(linear).not.toMatch(OUTSIDE_RETRY_RE);
    expect(linear).not.toMatch(NEVER_FAILS_MINT_RE);
    expect(linear).not.toMatch(AFTER_DERIVATION_RE);
    expect(linear).not.toMatch(WITHOUT_MODE_RE);
  });
});

// ===========================================================================
// Stage C hardening (round 1). PRESENCE pin, dry-run FALSE against the pre-fix
// tree. Line 177 said the joining repo "never issues a second
// `mintMilestoneEpic` call", then had it make the join call `{ join: true }`,
// which IS a `mintMilestoneEpic` call made in join mode. The sentence the
// STE-580 suite reads must say the join call is that repo's only such call.
// ===========================================================================

describe("Stage C hardening — line 177 does not contradict itself about the joining repo's mint call", () => {
  test("PRESENCE: the first post-tail sentence naming `mintMilestoneEpic` names the join call, and no 'never issues a second' claim remains", () => {
    const tail = afterTail();
    const sentence = sentences(tail).find((s) => s.includes("mintMilestoneEpic"));
    expect(sentence, "no post-tail sentence names mintMilestoneEpic").toBeDefined();
    expect(sentence!).toMatch(/\bjoin\b/i);
    expect(tail).not.toMatch(/never issues a second `mintMilestoneEpic` call/);
  });
});

// ===========================================================================
// BEHAVIOUR PINS (REGRESSION, GREEN before the fix).
// The prose must describe what mintMilestoneEpic actually does.
// ===========================================================================

describe("BEHAVIOUR — mintMilestoneEpic returns { epicKey, milestoneId, labelled }", () => {
  test("a plain mint returns exactly the three keys, with the label landed", async () => {
    const { result } = await mintResult();
    expect(Object.keys(result).sort()).toEqual(["epicKey", "labelled", "milestoneId"]);
    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: true });
  });

  test("CONTROL: a provider with no addLabel still returns three keys, with labelled false", async () => {
    const { result, fake } = await mintResult({ withAddLabel: false });
    expect(Object.keys(result).sort()).toEqual(["epicKey", "labelled", "milestoneId"]);
    expect(result.labelled, "labelled is a measured flag, not a constant").toBe(false);
    expect(fake.count("addLabel")).toBe(0);
  });
});

describe("BEHAVIOUR — the label is `milestone-M_<key>`, written after the id is derived", () => {
  test("the label written is milestone-M_<key>, on the Epic's own key", async () => {
    const { result, fake } = await mintResult();
    expect(fake.labelCalls()).toEqual([{ op: "addLabel", ticketId: EPIC_KEY, label: LABEL }]);
    expect(fake.labelCalls()[0]?.label, "the label carries the DERIVED id").toBe(
      `milestone-${result.milestoneId}`,
    );
  });

  test("a second key derives its own label (the `<key>` is the sanitized Epic key)", async () => {
    const { result, fake } = await mintResult({ createKey: "PROJ-500" });
    expect(result.milestoneId).toBe("M_PROJ_500");
    expect(fake.labelCalls().map((c) => c.label)).toEqual(["milestone-M_PROJ_500"]);
  });

  test("the create comes first and the label write last", async () => {
    const { fake } = await mintResult();
    expect(fake.ops()).toEqual(["createEpic", "addLabel"]);
  });

  test("a key that refuses to derive never gets a label; CONTROL: a valid key does", async () => {
    const refused = makeFake({ createKey: "" });
    await expect(
      mintMilestoneEpic(refused.provider, PROJECT, TITLE, { sleep: refused.sleep }),
    ).rejects.toThrow(/milestoneIdFromEpicKey/);
    expect(refused.count("createEpic"), "the create did run: the refusal is at derivation").toBe(1);
    expect(refused.count("addLabel"), "no id, so no label: the write is AFTER the derivation").toBe(0);

    const control = makeFake();
    await mintMilestoneEpic(control.provider, PROJECT, TITLE, { sleep: control.sleep });
    expect(control.count("addLabel"), "the same fake labels a key that derives").toBe(1);
  });
});

describe("BEHAVIOUR — a label write that throws never fails the mint", () => {
  test("a throwing addLabel leaves the mint successful with labelled false, never retried", async () => {
    const { result, fake } = await mintResult({ addLabelThrows: true });
    expect(result).toEqual({ epicKey: EPIC_KEY, milestoneId: MILESTONE_ID, labelled: false });
    expect(fake.count("addLabel"), "tried once").toBe(1);
    expect(fake.count("createEpic"), "no second Epic").toBe(1);
    expect(fake.sleeps, "zero backoff: the label write sits outside the retry").toEqual([]);
  });

  test("CONTROL: the same fake with a non-throwing addLabel reports labelled true", async () => {
    const { result } = await mintResult({ addLabelThrows: false });
    expect(result.labelled).toBe(true);
  });

  test("CONTROL: the sleep recorder does observe the retry, so zero sleeps above is a measurement", async () => {
    const { result, fake } = await mintResult({ createFailsTimes: 1 });
    expect(fake.sleeps.length, "one transient create failure pays one backoff step").toBe(1);
    expect(fake.count("createEpic")).toBe(2);
    expect(result.labelled).toBe(true);
  });
});

describe("BEHAVIOUR — `{ join: true }` without listEpics refuses and creates nothing", () => {
  test("join mode with no enumerator refuses: zero creates, zero labels, zero sleeps", async () => {
    const fake = makeFake({ withListEpics: false });
    await expect(
      mintMilestoneEpic(fake.provider, PROJECT, TITLE, { sleep: fake.sleep, join: true }),
    ).rejects.toThrow(/listEpics[\s\S]*a join never creates/);
    expect(fake.count("createEpic"), "a join never creates").toBe(0);
    expect(fake.count("addLabel")).toBe(0);
    expect(fake.sleeps).toEqual([]);
  });

  test("CONTROL: the same call without join mode mints", async () => {
    const fake = makeFake({ withListEpics: false });
    const result = await mintMilestoneEpic(fake.provider, PROJECT, TITLE, { sleep: fake.sleep });
    expect(fake.count("createEpic"), "without `{ join: true }` a provider with no listEpics mints").toBe(1);
    expect(result.epicKey).toBe(EPIC_KEY);
  });

  test("CONTROL: join mode WITH an enumerator and a match joins, still creating nothing", async () => {
    const fake = makeFake({ withListEpics: true, epics: [{ key: "GF-12", name: TITLE }] });
    const result = await mintMilestoneEpic(fake.provider, PROJECT, TITLE, {
      sleep: fake.sleep,
      join: true,
    });
    expect(result.epicKey, "the refusal above is about the missing op, not join mode itself").toBe("GF-12");
    expect(fake.count("createEpic")).toBe(0);
  });
});

// ===========================================================================
// AC-STE-592.3 — STRUCTURAL PINS (REGRESSION, GREEN before the fix).
// ===========================================================================

describe("AC-STE-592.3 — an in-place rewrite of one line (STRUCTURAL)", () => {
  test("the file measures exactly 358 split-lines", () => {
    expect(splitLines().length).toBe(SPLIT_LINES);
  });

  test("line 177 is one line with blank neighbours, and it is the allocation guard", () => {
    const lines = splitLines();
    expect(lines[175], "line 176 is blank").toBe("");
    expect(lines[177], "line 178 is blank; a wrapped rewrite would push prose here").toBe("");
    expect(line177().length, "line 177 carries the guard, not a blank").toBeGreaterThan(0);
    expect(line177(), "subject control: this is the line holding the Jira branch").toContain(
      JIRA_BRANCH_START,
    );
  });

  test("the milestone-attachment paragraph stays on line 111", () => {
    expect(splitLines()[110]?.startsWith(LINE_111_PREFIX)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-592.4 — STRUCTURAL PINS (REGRESSION, GREEN before the fix).
// ===========================================================================

describe("AC-STE-592.4 — no new STE token, no new module path, no raised pin (STRUCTURAL)", () => {
  test("spec-write/SKILL.md stays at 54 STE tokens", () => {
    expect(steTokenCount(read(SPEC_WRITE_SKILL))).toBe(STE_TOKENS_IN_FILE);
  });

  test("the skills/**/*.md tree stays at 245 STE tokens", () => {
    const skillsRoot = join(pluginRoot, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(skillsRoot)) {
      files += 1;
      total += steTokenCount(read(join(skillsRoot, rel)));
    }
    expect(files, "the walk is non-vacuous").toBeGreaterThan(20);
    expect(total).toBe(STE_TOKENS_IN_SKILLS_TREE);
  });

  test("line 177 carries exactly 16 module paths", () => {
    expect((line177().match(MODULE_PATH_RE) ?? []).length).toBe(MODULE_PATHS_ON_LINE_177);
  });

  test("the AWAITED reachability probe equals the shipped pin, with ok true", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(typeof report.orderedUnreachable, "the probe must be AWAITED, not a promise").toBe("number");
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN}`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 120_000);
});

// ===========================================================================
// AC-STE-592.5 — STRUCTURAL PINS (REGRESSION, GREEN before the fix).
// ===========================================================================

describe("AC-STE-592.5 — the STE-580 suite stays green, its constants unedited (STRUCTURAL)", () => {
  test("the suite is unedited against main", () => {
    const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: pluginRoot });
    expect(git(["rev-parse", "--verify", "--quiet", "main"]).exitCode, "control: main resolves").toBe(0);
    expect(
      git(["cat-file", "-e", `main:plugins/dev-process-toolkit/${STE_580_SUITE_REL}`]).exitCode,
      "control: the suite exists on main, so the diff below is not against nothing",
    ).toBe(0);
    const diff = git(["diff", "--quiet", "main", "--", STE_580_SUITE_REL]);
    expect(diff.exitCode, "exit 0 = no difference; exit 1 = edited").toBe(0);
  });

  test("the suite's constants are still the ones it shipped with", () => {
    const body = read(STE_580_SUITE);
    expect(body).toContain("const SPLIT_LINES_AT_HEAD = 358;");
    expect(body).toContain("const LINE_177_LEN_AT_HEAD = 9675;");
    expect(body).toContain("const MODULE_PATHS_ON_LINE_177_AT_HEAD = 16;");
    expect(body).toContain(`const HEAD_TAIL = "${STE_580_TAIL}";`);
  });

  test("the suite passes in a child `bun test`", () => {
    const child = Bun.spawnSync([process.execPath, "test", STE_580_SUITE_REL], {
      cwd: pluginRoot,
      env: process.env,
    });
    const out = child.stdout.toString() + child.stderr.toString();
    const passed = Number.parseInt(out.match(/(\d+) pass/)?.[1] ?? "0", 10);
    expect(passed, `the child ran tests at all. Output tail: ${out.slice(-600)}`).toBeGreaterThan(0);
    expect(out, `Output tail: ${out.slice(-600)}`).toMatch(/\b0 fail\b/);
    expect(child.exitCode).toBe(0);
  }, 300_000);
});

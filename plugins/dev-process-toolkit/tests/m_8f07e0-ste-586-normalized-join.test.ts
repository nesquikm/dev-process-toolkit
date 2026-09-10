// M_8f07e0 STE-586 — a join cannot mint: normalized title matching with a
// near-miss refusal, in BOTH mint modules.
//
// WHAT IS BROKEN at authoring time (2026-09-10, M_8f07e0 branch):
//
//   * `mint_milestone_epic.ts` finds an existing Epic with
//     `.find((epic) => epic.name === title)` and `mint_milestone_linear.ts`
//     with `.find((m) => m.name === title)` — byte equality. A trailing space,
//     a case difference or a doubled space misses, and the mint CREATES a
//     duplicate on a board with no delete tool.
//   * `.find` returns the FIRST exact hit, so two existing milestones that
//     normalize equal never refuse — one is silently picked.
//   * Neither module accepts `opts.join`; there is no mode under which the
//     create op is guaranteed not to run.
//   * `milestone_token.ts` exports no `normalizeMilestoneTitle`.
//
// TEST STRATEGY.
//
//   * Every drift case runs BOTH modules inside the SAME test and asserts them
//     in ONE `toEqual` over a `{ epic, linear }` record, so a fix that reaches
//     only one module reds the case (and the failure diff shows both halves).
//   * Every provider op is a RECORDING double. The create count is the
//     assertion that matters: zero for every join and every refusal, exactly
//     one for the genuine miss (AC.5 — the proof the fix is not "never mint").
//   * `opts.sleep` is always a recorder. The listing doubles return the SAME
//     page on every call, and a refusal thrown as a plain Error INSIDE the
//     retry is treated as transient by `retryTransient` — so it would be
//     re-listed, re-refused and would RECORD SLEEPS. Zero sleeps therefore
//     proves the refusal is raised once, outside the retry (AC.7).
//   * AC.13 pairs a list holding the exact title with a create op that
//     records and then THROWS: a find leg moved into the retry's failure path
//     would call create once, sleep, and only then find — caught by the
//     create count and the sleep count, not by the returned identity.
//   * The normalizer is read through a namespace import so a missing export
//     reds its own cases instead of failing the whole file at link time.
//   * AC.14 SPAWNS the Linear front door; it is never imported.
//
// DELIBERATE OMISSIONS.
//
//   * AC.15's second clause (full `bun test`: zero failures, skip count 15) is
//     a gate command, not something a test file can assert about the run it is
//     part of. Only the reachability-probe clause is pinned here.
//   * Non-regression pins (AC.4, AC.5, AC.10's negative control, AC.12's
//     `resolveMilestoneIdentity` half, AC.13, AC.14, AC.15) are GREEN at HEAD
//     by design — they guard the fix, they do not drive it.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeTitleForCompare } from "../adapters/_shared/src/create_idempotency_probe";
import {
  mintMilestoneEpic,
  type MintMilestoneEpicOptions,
  type MintMilestoneEpicProvider,
  type MintedMilestoneEpic,
} from "../adapters/_shared/src/mint_milestone_epic";
import {
  mintMilestoneLinear,
  type MintMilestoneLinearOptions,
  type MintMilestoneLinearProvider,
  type MintedMilestoneLinear,
} from "../adapters/_shared/src/mint_milestone_linear";
import * as milestoneToken from "../adapters/_shared/src/milestone_token";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { resolveMilestoneIdentity } from "../adapters/_shared/src/resolve_milestone_identity";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const SRC = join(pluginRoot, "adapters", "_shared", "src");
const EPIC_MODULE = join(SRC, "mint_milestone_epic.ts");
const LINEAR_MODULE = join(SRC, "mint_milestone_linear.ts");
const TOKEN_MODULE = join(SRC, "milestone_token.ts");

// ───────────────────────────────────────────────────────────────────────
// Fixture constants.
// ───────────────────────────────────────────────────────────────────────

const JIRA_PROJECT = "GF";
const LINEAR_PROJECT = "DPT";

const EXISTING_TITLE = "Waiting States II";
const EXISTING_EPIC_KEY = "GF-78";
const NEW_EPIC_KEY = "GF-99";

const EXISTING_UUID = "550e8400-e29b-41d4-a716-446655440000";
const EXISTING_LINEAR_ID = "M_550e84";
const NEW_UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NEW_LINEAR_ID = "M_7c9e66";

// AC.6 near-miss sibling pair.
const SIBLING_TITLE = "waiting states  II";
const SIBLING_EPIC_KEY = "GF-91";
const SIBLING_UUID = "a1b2c3d4-0000-4000-8000-000000000001";

const EXISTING_EPICS = [{ key: EXISTING_EPIC_KEY, name: EXISTING_TITLE }];
const EXISTING_LINEAR = [{ name: EXISTING_TITLE, id: EXISTING_UUID }];

// ───────────────────────────────────────────────────────────────────────
// Recording doubles.
// ───────────────────────────────────────────────────────────────────────

interface Recorder {
  /** Names handed to the create op, in call order. */
  creates: string[];
  /** Number of enumeration calls. */
  lists: number;
}

/**
 * `existing === null` ⇒ the provider carries NO listEpics op at all.
 * `createThrows` ⇒ the create op records its call and then throws a plain
 * Error (which `retryTransient` treats as transient).
 */
function epicDouble(
  existing: { key: string; name: string }[] | null,
  opts: { createThrows?: boolean } = {},
): { provider: MintMilestoneEpicProvider; rec: Recorder } {
  const rec: Recorder = { creates: [], lists: 0 };
  const provider: MintMilestoneEpicProvider = {
    createEpic: async (_project: string, o: { name: string }) => {
      rec.creates.push(o.name);
      if (opts.createThrows) throw new Error("createEpic must not be called in this case");
      return { key: NEW_EPIC_KEY };
    },
  };
  if (existing !== null) {
    provider.listEpics = async (_project: string) => {
      rec.lists += 1;
      return existing.map((e) => ({ ...e }));
    };
  }
  return { provider, rec };
}

function linearDouble(
  existing: { name: string; id?: string }[] | null,
  opts: { createThrows?: boolean } = {},
): { provider: MintMilestoneLinearProvider; rec: Recorder } {
  const rec: Recorder = { creates: [], lists: 0 };
  const provider: MintMilestoneLinearProvider = {
    createMilestone: async (_project: string, o: { name: string }) => {
      rec.creates.push(o.name);
      if (opts.createThrows) throw new Error("createMilestone must not be called in this case");
      return { id: NEW_UUID };
    },
  };
  if (existing !== null) {
    provider.listMilestones = async (_project: string) => {
      rec.lists += 1;
      return existing.map((m) => ({ ...m }));
    };
  }
  return { provider, rec };
}

function sleepRecorder(): { sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// The options literals carry `join`, which the shipped option types do not
// declare yet; the casts keep this file valid on both sides of the fix.
function epicOpts(o: { sleep: (ms: number) => Promise<void>; join?: boolean }): MintMilestoneEpicOptions {
  return o as MintMilestoneEpicOptions;
}
function linearOpts(o: { sleep: (ms: number) => Promise<void>; join?: boolean }): MintMilestoneLinearOptions {
  return o as MintMilestoneLinearOptions;
}

/** Run one mint in each module over its own fresh doubles. */
async function mintBoth(
  title: string,
  opts: {
    epics?: { key: string; name: string }[] | null;
    linear?: { name: string; id?: string }[] | null;
    join?: boolean;
    createThrows?: boolean;
  } = {},
) {
  const epic = epicDouble(opts.epics === undefined ? EXISTING_EPICS : opts.epics, {
    createThrows: opts.createThrows,
  });
  const linear = linearDouble(opts.linear === undefined ? EXISTING_LINEAR : opts.linear, {
    createThrows: opts.createThrows,
  });
  const epicSleep = sleepRecorder();
  const linearSleep = sleepRecorder();
  const epicJoin = opts.join === undefined ? {} : { join: opts.join };
  const epicResult = await settle<MintedMilestoneEpic>(
    mintMilestoneEpic(epic.provider, JIRA_PROJECT, title, epicOpts({ sleep: epicSleep.sleep, ...epicJoin })),
  );
  const linearResult = await settle<MintedMilestoneLinear>(
    mintMilestoneLinear(
      linear.provider,
      LINEAR_PROJECT,
      title,
      linearOpts({ sleep: linearSleep.sleep, ...epicJoin }),
    ),
  );
  return { epic, linear, epicSleep, linearSleep, epicResult, linearResult };
}

/** A compact, comparable view of one module's outcome. */
function view<T>(r: Settled<T>, pick: (v: T) => Record<string, unknown>): Record<string, unknown> {
  return r.ok ? { resolved: pick(r.value) } : { threw: r.error.message };
}

const epicIdentity = (v: MintedMilestoneEpic) => ({ epicKey: v.epicKey, milestoneId: v.milestoneId });
const linearIdentity = (v: MintedMilestoneLinear) => ({
  milestoneUuid: v.milestoneUuid,
  milestoneId: v.milestoneId,
});

/** Assert a JOIN onto the existing identity in BOTH modules, zero creates, zero sleeps. */
async function expectJoinBoth(title: string, join?: boolean): Promise<void> {
  const r = await mintBoth(title, join === undefined ? {} : { join });
  expect({
    epic: {
      outcome: view(r.epicResult, epicIdentity),
      creates: r.epic.rec.creates.length,
      sleeps: r.epicSleep.sleeps.length,
    },
    linear: {
      outcome: view(r.linearResult, linearIdentity),
      creates: r.linear.rec.creates.length,
      sleeps: r.linearSleep.sleeps.length,
    },
  }).toEqual({
    epic: {
      outcome: { resolved: { epicKey: EXISTING_EPIC_KEY, milestoneId: "M_GF_78" } },
      creates: 0,
      sleeps: 0,
    },
    linear: {
      outcome: { resolved: { milestoneUuid: EXISTING_UUID, milestoneId: EXISTING_LINEAR_ID } },
      creates: 0,
      sleeps: 0,
    },
  });
}

/** NFR-10 refusal shape: the three labelled lines. */
function nfr10Shape(message: string): { refusing: boolean; remedy: boolean; context: boolean } {
  return {
    refusing: message.includes("Refusing:"),
    remedy: message.includes("Remedy:"),
    context: message.includes("Context:"),
  };
}

const NFR10_OK = { refusing: true, remedy: true, context: true };

function messageOf<T>(r: Settled<T>): string {
  return r.ok ? `<resolved: ${JSON.stringify(r.value)}>` : r.error.message;
}

// ───────────────────────────────────────────────────────────────────────
// AC.1 – AC.5 — drift triggers join; a genuine miss still mints.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.1..5 — normalized find leg, both modules", () => {
  test("AC-STE-586.1: a trailing-space title joins in both modules (zero creates)", async () => {
    await expectJoinBoth("Waiting States II ");
  });

  test("AC-STE-586.2: a case difference joins in both modules (zero creates)", async () => {
    await expectJoinBoth("waiting states II");
  });

  test("AC-STE-586.3: internal whitespace joins in both modules (zero creates)", async () => {
    await expectJoinBoth("Waiting  States   II");
  });

  test("AC-STE-586.4: the byte-identical control still joins in both modules (zero creates)", async () => {
    await expectJoinBoth(EXISTING_TITLE);
  });

  test("AC-STE-586.5: a genuine miss still mints exactly once in both modules, under the raw title", async () => {
    const r = await mintBoth("Something Else");
    expect({
      epic: { outcome: view(r.epicResult, epicIdentity), createNames: r.epic.rec.creates },
      linear: { outcome: view(r.linearResult, linearIdentity), createNames: r.linear.rec.creates },
    }).toEqual({
      epic: {
        outcome: { resolved: { epicKey: NEW_EPIC_KEY, milestoneId: "M_GF_99" } },
        createNames: ["Something Else"],
      },
      linear: {
        outcome: { resolved: { milestoneUuid: NEW_UUID, milestoneId: NEW_LINEAR_ID } },
        createNames: ["Something Else"],
      },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.6 / AC.7 — ambiguity refuses, names both candidates, raised once.
// ───────────────────────────────────────────────────────────────────────

const AMBIGUOUS_EPICS = [
  { key: EXISTING_EPIC_KEY, name: EXISTING_TITLE },
  { key: SIBLING_EPIC_KEY, name: SIBLING_TITLE },
];
const AMBIGUOUS_LINEAR = [
  { name: EXISTING_TITLE, id: EXISTING_UUID },
  { name: SIBLING_TITLE, id: SIBLING_UUID },
];

describe("AC-STE-586.6/7 — two normalizing candidates refuse", () => {
  test("AC-STE-586.6: ambiguity throws in NFR-10 shape naming both candidates, zero creates, both modules", async () => {
    const r = await mintBoth(EXISTING_TITLE, { epics: AMBIGUOUS_EPICS, linear: AMBIGUOUS_LINEAR });
    const epicMsg = messageOf(r.epicResult);
    const linearMsg = messageOf(r.linearResult);
    expect({
      epic: {
        threw: !r.epicResult.ok,
        shape: nfr10Shape(epicMsg),
        names: {
          [EXISTING_EPIC_KEY]: epicMsg.includes(EXISTING_EPIC_KEY),
          [SIBLING_EPIC_KEY]: epicMsg.includes(SIBLING_EPIC_KEY),
          [EXISTING_TITLE]: epicMsg.includes(EXISTING_TITLE),
          [SIBLING_TITLE]: epicMsg.includes(SIBLING_TITLE),
        },
        creates: r.epic.rec.creates.length,
      },
      linear: {
        threw: !r.linearResult.ok,
        shape: nfr10Shape(linearMsg),
        names: {
          [EXISTING_UUID]: linearMsg.includes(EXISTING_UUID),
          [SIBLING_UUID]: linearMsg.includes(SIBLING_UUID),
          [EXISTING_TITLE]: linearMsg.includes(EXISTING_TITLE),
          [SIBLING_TITLE]: linearMsg.includes(SIBLING_TITLE),
        },
        creates: r.linear.rec.creates.length,
      },
    }).toEqual({
      epic: {
        threw: true,
        shape: NFR10_OK,
        names: {
          [EXISTING_EPIC_KEY]: true,
          [SIBLING_EPIC_KEY]: true,
          [EXISTING_TITLE]: true,
          [SIBLING_TITLE]: true,
        },
        creates: 0,
      },
      linear: {
        threw: true,
        shape: NFR10_OK,
        names: {
          [EXISTING_UUID]: true,
          [SIBLING_UUID]: true,
          [EXISTING_TITLE]: true,
          [SIBLING_TITLE]: true,
        },
        creates: 0,
      },
    });
  });

  test("AC-STE-586.7: the ambiguity refusal records ZERO sleeps in both modules (raised once, outside the retry)", async () => {
    const r = await mintBoth(EXISTING_TITLE, { epics: AMBIGUOUS_EPICS, linear: AMBIGUOUS_LINEAR });
    expect({
      epic: { threw: !r.epicResult.ok, sleeps: r.epicSleep.sleeps, lists: r.epic.rec.lists },
      linear: { threw: !r.linearResult.ok, sleeps: r.linearSleep.sleeps, lists: r.linear.rec.lists },
    }).toEqual({
      epic: { threw: true, sleeps: [], lists: 1 },
      linear: { threw: true, sleeps: [], lists: 1 },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.8 / AC.9 / AC.10 — join mode.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.8..10 — { join: true } never calls the create op", () => {
  // A title whose normalized key is visibly distinct from its raw spelling.
  const MISS_TITLE = "Something  Else";
  const MISS_KEY = "something else";

  test("AC-STE-586.8: join with no match refuses in NFR-10 shape naming project, title and normalized key; zero creates, both modules", async () => {
    const r = await mintBoth(MISS_TITLE, { join: true });
    const epicMsg = messageOf(r.epicResult);
    const linearMsg = messageOf(r.linearResult);
    expect({
      epic: {
        threw: !r.epicResult.ok,
        shape: nfr10Shape(epicMsg),
        project: epicMsg.includes(JIRA_PROJECT),
        title: epicMsg.includes(MISS_TITLE),
        normalizedKey: epicMsg.includes(MISS_KEY),
        creates: r.epic.rec.creates.length,
        sleeps: r.epicSleep.sleeps.length,
      },
      linear: {
        threw: !r.linearResult.ok,
        shape: nfr10Shape(linearMsg),
        project: linearMsg.includes(LINEAR_PROJECT),
        title: linearMsg.includes(MISS_TITLE),
        normalizedKey: linearMsg.includes(MISS_KEY),
        creates: r.linear.rec.creates.length,
        sleeps: r.linearSleep.sleeps.length,
      },
    }).toEqual({
      epic: {
        threw: true,
        shape: NFR10_OK,
        project: true,
        title: true,
        normalizedKey: true,
        creates: 0,
        sleeps: 0,
      },
      linear: {
        threw: true,
        shape: NFR10_OK,
        project: true,
        title: true,
        normalizedKey: true,
        creates: 0,
        sleeps: 0,
      },
    });
  });

  test("AC-STE-586.9: join with a normalizing match returns the existing identity, zero creates, both modules", async () => {
    await expectJoinBoth("waiting states II ", true);
  });

  test("AC-STE-586.10: join without the enumerator refuses naming listEpics / listMilestones, zero creates", async () => {
    const r = await mintBoth("X", { epics: null, linear: null, join: true });
    const epicMsg = messageOf(r.epicResult);
    const linearMsg = messageOf(r.linearResult);
    expect({
      epic: {
        threw: !r.epicResult.ok,
        shape: nfr10Shape(epicMsg),
        namesOp: epicMsg.includes("listEpics"),
        creates: r.epic.rec.creates.length,
      },
      linear: {
        threw: !r.linearResult.ok,
        shape: nfr10Shape(linearMsg),
        namesOp: linearMsg.includes("listMilestones"),
        creates: r.linear.rec.creates.length,
      },
    }).toEqual({
      epic: { threw: true, shape: NFR10_OK, namesOp: true, creates: 0 },
      linear: { threw: true, shape: NFR10_OK, namesOp: true, creates: 0 },
    });
  });

  test("AC-STE-586.10 (negative control): the same enumerator-less providers WITHOUT join mint exactly once", async () => {
    const r = await mintBoth("X", { epics: null, linear: null });
    expect({
      epic: { outcome: view(r.epicResult, epicIdentity), creates: r.epic.rec.creates },
      linear: { outcome: view(r.linearResult, linearIdentity), creates: r.linear.rec.creates },
    }).toEqual({
      epic: { outcome: { resolved: { epicKey: NEW_EPIC_KEY, milestoneId: "M_GF_99" } }, creates: ["X"] },
      linear: {
        outcome: { resolved: { milestoneUuid: NEW_UUID, milestoneId: NEW_LINEAR_ID } },
        creates: ["X"],
      },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.11 — one normalizer, one home.
// ───────────────────────────────────────────────────────────────────────

type Normalizer = (title: string) => string;

function normalizer(): Normalizer | undefined {
  const candidate = (milestoneToken as unknown as Record<string, unknown>).normalizeMilestoneTitle;
  return typeof candidate === "function" ? (candidate as Normalizer) : undefined;
}

describe("AC-STE-586.11 — normalizeMilestoneTitle lives in milestone_token.ts", () => {
  test("normalizeMilestoneTitle is exported from milestone_token.ts as a function", () => {
    expect(typeof (milestoneToken as unknown as Record<string, unknown>).normalizeMilestoneTitle).toBe(
      "function",
    );
  });

  test("milestone_token.ts imports normalizeTitleForCompare from create_idempotency_probe", () => {
    const src = readFileSync(TOKEN_MODULE, "utf-8");
    expect(src).toMatch(
      /import\s*\{[^}]*\bnormalizeTitleForCompare\b[^}]*\}\s*from\s*["']\.\/create_idempotency_probe["']/,
    );
  });

  test("its output composes normalizeTitleForCompare (NFC first, en-US fold last) over every drift class", () => {
    const norm = normalizer();
    const samples = [
      "Waiting States II ",
      "waiting states II",
      "Waiting  States   II",
      "Waiting States II",
      "Release – Notes",
      "Heading Title {#anchor}",
      "Cafe\u0301 Milestone", // NFD: e + combining acute
      "WAITING STATES II",
    ];
    expect(norm).toBeDefined();
    expect(samples.map((s) => norm!(s))).toEqual(
      samples.map((s) => normalizeTitleForCompare(s.normalize("NFC")).toLocaleLowerCase("en-US")),
    );
    // The fold itself, spelled out: `I` → `i` under en-US.
    expect(norm!("WAITING STATES II")).toBe("waiting states ii");
  });

  test("a no-break space normalizes equal to a plain space (a rule inherited, not re-written)", () => {
    const norm = normalizer();
    expect(norm).toBeDefined();
    expect("Waiting\u00a0States II").not.toBe("Waiting States II"); // fixture really carries U+00A0
    expect(norm!("Waiting\u00a0States II")).toBe(norm!("Waiting States II"));
    // NFC first: decomposed and precomposed spellings meet.
    expect(norm!("Cafe\u0301 Milestone")).toBe(norm!("Caf\u00e9 Milestone"));
  });

  test("neither mint module case-folds on its own: zero toLowerCase / toLocaleLowerCase hits", () => {
    const hits = [EPIC_MODULE, LINEAR_MODULE].flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => /toLocaleLowerCase|toLowerCase/.test(l.text)),
    );
    expect(hits).toEqual([]);
  });

  test("both mint modules import normalizeMilestoneTitle from ./milestone_token", () => {
    const importRe =
      /import\s*\{[^}]*\bnormalizeMilestoneTitle\b[^}]*\}\s*from\s*["']\.\/milestone_token["']/;
    expect({
      epic: importRe.test(readFileSync(EPIC_MODULE, "utf-8")),
      linear: importRe.test(readFileSync(LINEAR_MODULE, "utf-8")),
    }).toEqual({ epic: true, linear: true });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.12 — the empty-title guard survives.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.12 — a title that normalizes empty refuses before any tracker call", () => {
  test('"   " throws before ANY list or create call, both modules', async () => {
    const r = await mintBoth("   ");
    expect({
      epic: { threw: !r.epicResult.ok, lists: r.epic.rec.lists, creates: r.epic.rec.creates.length },
      linear: { threw: !r.linearResult.ok, lists: r.linear.rec.lists, creates: r.linear.rec.creates.length },
    }).toEqual({
      epic: { threw: true, lists: 0, creates: 0 },
      linear: { threw: true, lists: 0, creates: 0 },
    });
  });

  test('resolveMilestoneIdentity (mode "linear", title "") still throws its existing refusal, zero creates', async () => {
    const specsDir = mkdtempSync(join(tmpdir(), "ste-586-specs-"));
    try {
      const linear = linearDouble(EXISTING_LINEAR);
      const result = await settle(
        resolveMilestoneIdentity({
          specsDir,
          mode: "linear",
          project: LINEAR_PROJECT,
          title: "",
          provider: linear.provider,
        }),
      );
      expect({
        threw: !result.ok,
        message: messageOf(result).includes(
          "resolveMilestoneIdentity: refusing to mint a Linear milestone without a project and a human title",
        ),
        lists: linear.rec.lists,
        creates: linear.rec.creates.length,
      }).toEqual({ threw: true, message: true, lists: 0, creates: 0 });
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.13 — the first-attempt find leg keeps minting idempotent.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.13 — the find leg runs on the FIRST attempt", () => {
  test("exact title + a create op that throws if called ⇒ existing identity, zero creates, zero sleeps, both modules", async () => {
    const r = await mintBoth(EXISTING_TITLE, { createThrows: true });
    expect({
      epic: {
        outcome: view(r.epicResult, epicIdentity),
        creates: r.epic.rec.creates.length,
        sleeps: r.epicSleep.sleeps.length,
      },
      linear: {
        outcome: view(r.linearResult, linearIdentity),
        creates: r.linear.rec.creates.length,
        sleeps: r.linearSleep.sleeps.length,
      },
    }).toEqual({
      epic: {
        outcome: { resolved: { epicKey: EXISTING_EPIC_KEY, milestoneId: "M_GF_78" } },
        creates: 0,
        sleeps: 0,
      },
      linear: {
        outcome: { resolved: { milestoneUuid: EXISTING_UUID, milestoneId: EXISTING_LINEAR_ID } },
        creates: 0,
        sleeps: 0,
      },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.14 — the Linear front door is unchanged.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.14 — the Linear mint front door", () => {
  const EXPECTED_LINES = [
    "name=Tracker-First Linear Milestones",
    `milestoneUuid=${EXISTING_UUID}`,
    `milestoneId=${EXISTING_LINEAR_ID}`,
    `plan=specs/plan/${EXISTING_LINEAR_ID}.md`,
  ];

  test("the four expected lines are the ones the module header documents", () => {
    const src = readFileSync(LINEAR_MODULE, "utf-8");
    expect(EXPECTED_LINES.map((l) => src.includes(`//   ${l}\n`))).toEqual([true, true, true, true]);
  });

  test("spawned, it exits 0 and prints exactly those four lines", () => {
    const run = spawnSync(
      "bun",
      [
        "run",
        "adapters/_shared/src/mint_milestone_linear.ts",
        LINEAR_PROJECT,
        "Tracker-First Linear Milestones",
        EXISTING_UUID,
      ],
      { cwd: pluginRoot, encoding: "utf-8" },
    );
    expect({
      status: run.status,
      stderr: run.stderr,
      lines: run.stdout.replace(/\n$/, "").split("\n"),
    }).toEqual({ status: 0, stderr: "", lines: EXPECTED_LINES });
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC.15 — reachability pin holds.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-586.15 — module reachability", () => {
  test(
    "runModuleReachabilityProbe reports orderedUnreachable === ORDERED_UNREACHABLE_PIN with ok: true",
    async () => {
      const report = await runModuleReachabilityProbe(repoRoot);
      expect({ orderedUnreachable: report.orderedUnreachable, ok: report.ok }).toEqual({
        orderedUnreachable: ORDERED_UNREACHABLE_PIN,
        ok: true,
      });
    },
    60_000,
  );
});

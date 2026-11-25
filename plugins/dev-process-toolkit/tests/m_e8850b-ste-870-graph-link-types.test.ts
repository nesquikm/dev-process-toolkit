// STE-870 (M_e8850b) — the tracker gate reads the target of every graph link.
//
// One leg table, two graders: every payload runs through the SHIPPED `.sh`
// wrapper of the write gate, and the same record through the live grader.
// The known relationship types are two exported sets of atlassian_call.ts:
// GRAPH_ITEM_TARGET_TYPES and GRAPH_OTHER_TARGET_TYPES.
//
// Every refuse leg has a permit twin. An unknown-type leg carries an OWNED
// object, so only the type can refuse it. Invented keys and sites only.

import { cpSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { CLOUD, JIRA, PLUGIN_ROOT, Transcript, cleanupTemps, gate, graderRel, hookModuleRel, makeWorld, moduleRel, permitProblem, refusalProblem, show, tempDir, type Run, type World } from "./_m_b2fdc0_ste729_fixture";
import { buildPassingBundle, clone, serverPrefix, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";
import * as atlassianCall from "../adapters/_shared/src/atlassian_call";

setDefaultTimeout(120_000);

type Obj = Record<string, unknown>;

const LINKS = "jira-work-item-links-jira-work-item";
const BLOCKS = "jira-work-item-blocks-jira-work-item";
const REMOTE = "jira-work-item-links-jira-work-item-remote-link";
const PROJECT = "jira-work-item-tracks-atlassian-project";
const GOAL = "jira-work-item-contributes-to-atlassian-goal";
const ITEM_TYPES = [LINKS, BLOCKS];
const OTHER_TYPES = [REMOTE, PROJECT, GOAL];
const KNOWN = [...ITEM_TYPES, ...OTHER_TYPES];

const V1 = "addTeamworkGraphContext";
const V2 = "addGraphContext";
const ABSENT = Symbol("absent");

const CALL_REL = moduleRel("atlassian_call.ts");

// ------------------------------------------------------------------ legs

interface Keys {
  own: string;
  foreign: string;
  foreign2: string;
}
interface Leg {
  ac: string;
  title: string;
  tool: string;
  input: (k: Keys) => Obj;
  refuse: boolean;
  /** For an unknown-type refusal: the type's text, when it has one. */
  names?: string;
}

const link = (object: unknown, target: unknown, type: unknown): Obj => ({
  objectIdentifier: object,
  targetObjectIdentifier: target,
  ...(type === ABSENT ? {} : { relationshipType: type }),
});

/** The leg sent by its own tool, and wrapped in executeWrite. */
function bothWays(ac: string, title: string, tool: string, input: (k: Keys) => Obj, refuse: boolean, names?: string): Leg[] {
  return [
    { ac, title: `direct ${tool}: ${title}`, tool, input: (k) => ({ cloudId: CLOUD, ...input(k) }), refuse, names },
    { ac, title: `wrapped ${tool}: ${title}`, tool: "executeWrite", input: (k) => ({ name: tool, inputs: input(k), cloudId: CLOUD }), refuse, names },
  ];
}

const UNKNOWN: Array<[title: string, type: unknown, names?: string]> = [
  ["an invented type", "jira-work-item-duplicates-jira-work-item", "jira-work-item-duplicates-jira-work-item"],
  ["a short name", "zz-links", "zz-links"],
  ["an object-prototype name", "constructor", "constructor"],
  ["no type", ABSENT],
  ["undefined", undefined],
  ["null", null],
  ["the empty string", ""],
  ["a number", 4217],
  ["a boolean", true],
  ["an object", { type: LINKS }],
  ["an array holding a valid item type", [LINKS]],
  ["an array holding a valid other type", [GOAL]],
  ...KNOWN.flatMap((t): Array<[string, unknown, string]> => [
    [`${t} in upper case`, t.toUpperCase(), t.toUpperCase()],
    [`${t} with a trailing space`, `${t} `, t],
    [`${t} with a leading space`, ` ${t}`, t],
  ]),
  [`${LINKS} with a trailing newline`, `${LINKS}\n`, LINKS],
];

const AC1: Leg[] = [
  ...UNKNOWN.flatMap(([title, type, names]) => bothWays("AC-STE-870.1", `${title}, owned object and foreign target`, V1, (k) => link(k.own, k.foreign, type), true, names)),
  ...bothWays("AC-STE-870.1", "an invented type, both sides owned", V1, (k) => link(k.own, k.own, "zz-links"), true, "zz-links"),
  ...bothWays("AC-STE-870.1", "an invented type, owned object and no target", V1, (k) => ({ objectIdentifier: k.own, relationshipType: "zz-links" }), true, "zz-links"),
  ...bothWays("AC-STE-870.1", "an invented type, an object of no declared project", V1, (k) => link("OTHER-1", k.foreign, "zz-links"), true, "zz-links"),
  ...KNOWN.flatMap((t) => bothWays("AC-STE-870.1", `TWIN — ${t} spelled exactly, owned object`, V1, (k) => link(k.own, k.foreign, t), false)),
];

const browse = (key: string): string => `https://${CLOUD}/browse/${key}`;

const AC2: Leg[] = ITEM_TYPES.flatMap((t) => [
  ...bothWays("AC-STE-870.2", `${t}: owned object`, V1, (k) => link(k.own, k.foreign, t), false),
  ...bothWays("AC-STE-870.2", `${t}: owned target`, V1, (k) => link(k.foreign, k.own, t), false),
  ...bothWays("AC-STE-870.2", `${t}: owned target by its browse URL`, V1, (k) => link(k.foreign, browse(k.own), t), false),
  ...bothWays("AC-STE-870.2", `${t}: no owned side`, V1, (k) => link(k.foreign2, k.foreign, t), true),
  ...bothWays("AC-STE-870.2", `${t}: owned object, numeric target`, V1, (k) => link(k.own, "10101", t), true),
  ...bothWays("AC-STE-870.2", `${t}: owned object, no target`, V1, (k) => ({ objectIdentifier: k.own, relationshipType: t }), true),
  ...bothWays("AC-STE-870.2", `${t}: ARI object, owned target`, V1, (k) => link("ari:cloud:jira:x:issue/10101", k.own, t), true),
]);

const AC3: Leg[] = OTHER_TYPES.flatMap((t) => [
  ...([
    ["a foreign key", (k) => k.foreign],
    ["a foreign browse URL", (k) => browse(k.foreign)],
    ["another project's key", () => "ATLAS-20426"],
    ["an ARI", () => "ari:cloud:townsquare:9f3c0000:goal/42"],
    ["a web page", () => "https://example.invalid/runbook"],
    ["a numeric id", () => "10101"],
    ["plain text", () => "some goal"],
    ["the empty string", () => ""],
  ] as Array<[string, (k: Keys) => string]>).flatMap(([what, target]) => bothWays("AC-STE-870.3", `${t}: owned object, target ${what}`, V1, (k) => link(k.own, target(k), t), false)),
  ...bothWays("AC-STE-870.3", `${t}: unowned object, web page target`, V1, (k) => link(k.foreign, "https://example.invalid/runbook", t), true),
  ...bothWays("AC-STE-870.3", `${t}: unowned object, owned key as target`, V1, (k) => link(k.foreign, k.own, t), true),
  ...bothWays("AC-STE-870.3", `${t}: unowned object, owned browse URL as target`, V1, (k) => link(k.foreign, browse(k.own), t), true),
  ...bothWays("AC-STE-870.3", `${t}: unresolvable object, owned key as target`, V1, (k) => link("10101", k.own, t), true),
]);

const AC4: Leg[] = [
  ...OTHER_TYPES.flatMap((t) => bothWays("AC-STE-870.4", `${t}, owned object`, V2, (k) => link(k.own, "ATLAS-20426", t), true)),
  ...UNKNOWN.flatMap(([title, type]) => bothWays("AC-STE-870.4", `${title}, owned object`, V2, (k) => link(k.own, k.foreign, type), true)),
  ...ITEM_TYPES.flatMap((t) => [
    ...bothWays("AC-STE-870.4", `${t}: owned object`, V2, (k) => link(k.own, k.foreign, t), false),
    ...bothWays("AC-STE-870.4", `${t}: owned target`, V2, (k) => link(k.foreign, k.own, t), false),
    ...bothWays("AC-STE-870.4", `${t}: no owned side`, V2, (k) => link(k.foreign2, k.foreign, t), true),
    ...bothWays("AC-STE-870.4", `${t}: owned object, unresolvable target`, V2, (k) => link(k.own, "10101", t), true),
    ...bothWays("AC-STE-870.4", `${t}: a key the v1 rules have no name for`, V2, (k) => ({ ...link(k.own, k.foreign, t), relationships: [] }), true),
  ]),
  // The v2 key list never reaches v1: its schema is recorded and the gate reads its fields.
  ...bothWays("AC-STE-870.4", "CONTROL — v1 keeps permitting a key only v2 refuses", V1, (k) => ({ ...link(k.own, k.foreign, LINKS), relationships: [] }), false),
];

const LEGS = [...AC1, ...AC2, ...AC3, ...AC4];
const word = (l: Leg): string => (l.refuse ? "REFUSE" : "PERMIT");

// --------------------------------------------------------------- runners

const HOOK_KEYS: Keys = { own: "PROJ-112", foreign: "PROJ-5", foreign2: "PROJ-6" };
let w: World;
beforeAll(() => {
  w = makeWorld({ boundFr: HOOK_KEYS.own });
});
afterAll(cleanupTemps);

const askHook = (l: Pick<Leg, "tool" | "input">, root = PLUGIN_ROOT, world = w): Promise<Run> =>
  gate(root, JIRA(l.tool), l.input(HOOK_KEYS), new Transcript(), world.root);

/** Whether the grader at `root` reports the leg's call, appended to S13, as an ungated write. */
async function graderFlags(l: Pick<Leg, "tool" | "input">, root = PLUGIN_ROOT): Promise<boolean> {
  const b: LiveBundle = clone(buildPassingBundle("jira"));
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const own = `${b.run.container}-890`;
  b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key: own, milestone: null });
  const keys: Keys = { own, foreign: `${b.run.container}-9001`, foreign2: `${b.run.container}-9002` };
  const c: ToolCall = {
    ref: `${s.sessionId}:toolu_870`,
    at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
    name: serverPrefix("jira", s.root) + l.tool,
    input: l.input(keys),
    result: { isError: false, text: "", exitCode: null, items: [], lastPage: null },
    sidechain: false,
  };
  s.calls.push(c);
  const g = (await import(join(root, graderRel))) as unknown as { gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Array<{ code: string; detail?: string }> } };
  return g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest }).findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${c.ref}:`));
}

// ----------------------------------------------------------------- tests

describe("AC-STE-870.1 / .2 / .3 / .4 — the hook's verdict, through the .sh wrapper", () => {
  for (const l of LEGS) {
    test(`${l.ac}: ${word(l)} — hook — ${l.title}`, async () => {
      const r = await askHook(l);
      expect(l.refuse ? refusalProblem(r) : permitProblem(r), show(r)).toBeNull();
    });
  }
});

describe("AC-STE-870.1 — the refusal names the type and lists the known types", () => {
  for (const l of AC1.filter((x) => x.refuse)) {
    test(`AC-STE-870.1: ${l.title}`, async () => {
      const r = await askHook(l);
      expect(r.exitCode, show(r)).toBe(2);
      expect(r.stderr).toContain("relationshipType");
      if (l.names !== undefined) expect(r.stderr).toContain(l.names);
      // Word-bounded: the remote-link type must not stand in for the item type it starts with.
      const listed = KNOWN.filter((t) => new RegExp(`(?<![\\w-])${t}(?![\\w-])`).test(r.stderr));
      expect(listed).toEqual(KNOWN);
    });
  }
  test("AC-STE-870.1: a non-string type's value is named", async () => {
    const r = await askHook({ tool: V1, input: (k) => ({ cloudId: CLOUD, ...link(k.own, k.foreign, 4217) }) });
    expect(r.stderr).toContain("4217");
  });
});

describe("AC-STE-870.5 — the live grader gives the hook's verdict on each payload", () => {
  for (const l of LEGS) {
    test(`AC-STE-870.5: ${word(l)} — grader — ${l.title}`, async () => {
      expect(await graderFlags(l)).toBe(l.refuse);
    });
  }
});

/** The `.ts` files under `dir`, as paths relative to the plugin root. */
function sources(dir: string): string[] {
  return readdirSync(join(PLUGIN_ROOT, dir), { recursive: true, encoding: "utf-8" })
    .filter((p) => p.endsWith(".ts") && !p.includes("node_modules"))
    .map((p) => join(dir, p));
}
const quotedCount = (src: string, type: string): number => [...src.matchAll(new RegExp(`(["'\`])${type}\\1`, "g"))].length;

describe("AC-STE-870.5 — one shared constant holds the known types", () => {
  const exported = (name: string): string[] => [...((atlassianCall as unknown as Record<string, Iterable<string> | undefined>)[name] ?? [])].sort();

  test("AC-STE-870.5: GRAPH_ITEM_TARGET_TYPES is the two item-to-item types", () => {
    expect(exported("GRAPH_ITEM_TARGET_TYPES")).toEqual([...ITEM_TYPES].sort());
  });
  test("AC-STE-870.5: GRAPH_OTHER_TARGET_TYPES is the three other types", () => {
    expect(exported("GRAPH_OTHER_TARGET_TYPES")).toEqual([...OTHER_TYPES].sort());
  });
  for (const type of KNOWN) {
    test(`AC-STE-870.5: ${type} is spelled once in the shipped code, in the translator`, () => {
      const files = [...sources("adapters"), ...sources("templates")];
      expect(files).toContain(CALL_REL);
      expect(files).toContain(graderRel);
      expect(files).toContain(hookModuleRel);
      const copies = files.map((f) => [f, quotedCount(readFileSync(join(PLUGIN_ROOT, f), "utf-8"), type)] as const).filter(([, n]) => n > 0);
      expect(copies).toEqual([[CALL_REL, 1]]);
    });
  }
});

describe("AC-STE-870.6 — with no declared target the hook is silent", () => {
  const SAMPLE = LEGS.filter((l) => !l.title.startsWith("wrapped") || l.ac === "AC-STE-870.1");
  let unshared: World;
  let linear: World;
  beforeAll(() => {
    unshared = makeWorld({ boundFr: HOOK_KEYS.own, unshared: true });
    linear = makeWorld({ linear: true, unshared: true });
  });
  const silent = async (l: Leg, world: World): Promise<void> => {
    const r = await askHook(l, PLUGIN_ROOT, world);
    expect({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  };
  for (const l of SAMPLE) test(`AC-STE-870.6: unshared Jira repository — ${l.ac} ${l.title}`, () => silent(l, unshared));
  for (const l of AC1.filter((x) => x.refuse && x.title.startsWith("direct"))) test(`AC-STE-870.6: unshared Linear repository — ${l.title}`, () => silent(l, linear));
});

// --------------------------------------------------------------- mutants

/** A copy of the plugin's code with `from` replaced by `to` in `rel`, which must hold it exactly once. */
function mutantPlugin(m?: { rel: string; from: string; to: string }): string {
  const root = tempDir("ste870-plugin");
  for (const d of ["adapters", "templates", "hooks"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
  if (m) {
    const path = join(root, m.rel);
    const src = readFileSync(path, "utf-8");
    expect(src.split(m.from).length - 1, `${m.rel} holds the mutated text once`).toBe(1);
    writeFileSync(path, src.replace(m.from, () => m.to));
    expect(readFileSync(path, "utf-8")).not.toBe(src);
  }
  return root;
}

const UNKNOWN_LEG: Pick<Leg, "tool" | "input"> = { tool: V1, input: (k) => ({ cloudId: CLOUD, ...link(k.own, k.foreign, "zz-links") }) };
const FLAG_PERMIT: Pick<Leg, "tool" | "input"> = { tool: V1, input: (k) => ({ cloudId: CLOUD, ...link(k.own, k.foreign, LINKS) }) };

describe("AC-STE-870.7 — removing the unknown-type refusal turns a named test red", () => {
  test('AC-STE-870.7: hook refusal removed → "REFUSE — hook — direct addTeamworkGraphContext: a short name" fails', async () => {
    const control = mutantPlugin();
    const before = await askHook(UNKNOWN_LEG, control);
    expect(refusalProblem(before), show(before)).toBeNull();
    const mutant = mutantPlugin({
      rel: hookModuleRel,
      from: `if (call.tool === "addTeamworkGraphContext" && call.unplaced.length > 0) {`,
      to: `if (false) {`,
    });
    const after = await askHook(UNKNOWN_LEG, mutant);
    expect(permitProblem(after), show(after)).toBeNull();
    const known = await askHook(FLAG_PERMIT, mutant);
    expect(permitProblem(known), show(known)).toBeNull();
  });

  test('AC-STE-870.7: grader refusal removed → "REFUSE — grader — direct addTeamworkGraphContext: a short name" fails', async () => {
    expect(await graderFlags(UNKNOWN_LEG, mutantPlugin())).toBe(true);
    const mutant = mutantPlugin({
      rel: graderRel,
      from: `if (tool === "addTeamworkGraphContext" && unplaced.length > 0) return`,
      to: `if (false) return`,
    });
    expect(await graderFlags(UNKNOWN_LEG, mutant)).toBe(false);
    expect(await graderFlags(FLAG_PERMIT, mutant)).toBe(false);
  });
});

describe("AC-STE-870.5 — the hook and the grader both read the translator's constant", () => {
  for (const type of KNOWN) {
    const owned: Pick<Leg, "tool" | "input"> = { tool: V1, input: (k) => ({ cloudId: CLOUD, ...link(k.own, k.foreign, type) }) };
    test(`AC-STE-870.5: ${type} taken out of the constant → the hook and the grader refuse it`, async () => {
      const control = mutantPlugin();
      const permit = await askHook(owned, control);
      expect(permitProblem(permit), show(permit)).toBeNull();
      expect(await graderFlags(owned, control)).toBe(false);
      const mutant = mutantPlugin({ rel: CALL_REL, from: `"${type}"`, to: `"zz-removed"` });
      const r = await askHook(owned, mutant);
      expect(refusalProblem(r), show(r)).toBeNull();
      expect(await graderFlags(owned, mutant)).toBe(true);
    });
  }
});

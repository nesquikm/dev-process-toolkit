// STE-729 (M_b2fdc0) — AC-STE-729.10: the mutation battery.
//
// Removing any one of epic_edit.ts's checks (a)-(e) (check (e), the plan's
// `container_origin: minted`, added by AC-STE-729.12), or — in the hook AND in
// the grader — the field restriction, the consent rule, the tool-name rule or
// the verdict rule, must turn at least one NAMED leg red.
//
// Each row copies the plugin's adapters/ and templates/ (real files) plus its
// manifest to a temporary directory, applies ONE sited mutation with
// `mutateInRegion` (the anchor must occur exactly once in the file), and drives
// the row's named legs — the very legs the main suites run, from
// tests/_m_b2fdc0_ste729_fixture.ts — against the copy. A row is KILLED only
// when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - at least one of its named legs belongs to the guard's own category
//     (a check's twin for (a)-(d); a `(fields)`/`(input)` twin for the field
//     restriction; `(consent)` for consent; `(tool name)` for the tool-name
//     rule; `(verdict)` for the verdict rule);
//   - the family's permit legs still PASS on the mutant, so a mutation that
//     breaks loading (every leg refusing) is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `find` / `replace`
// are null until the shipped code exists. Site each row against the shipped
// code with ONE exact anchor and a replacement that removes only that check
// (e.g. `if (!fieldsOnlyDescriptionOrSummary(input)) return false;` → ``).
// A null row FAILS, naming itself — the battery never passes vacuously. The
// guard ids, sides and kill categories below are fixed by AC-STE-729.10 and
// must not be edited to make a row pass.
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import {
  EPIC,
  OTHER_EPIC,
  PLUGIN_ROOT,
  cleanupTemps,
  epicEditLegs,
  epicEditPermitProblem,
  epicEditRefusalProblem,
  fetchedTicketLegs,
  graderEpicEditLegs,
  graderFetchLegs,
  graderRel,
  hookModuleRel,
  makeWorld,
  moduleRel,
  permitProblem,
  refusalProblem,
  runEpicEdit,
  show,
  tempDir,
  type WorldOpts,
} from "./_m_b2fdc0_ste729_fixture";

setDefaultTimeout(600_000);

// ------------------------------------------------------------------ legs

type Family = "module" | "gate" | "grader";

interface Leg {
  name: string;
  family: Family;
  permit: boolean;
  /** null when the leg holds on `pluginRoot`, else why it does not. */
  check: (pluginRoot: string) => Promise<string | null>;
}

function moduleLeg(name: string, opts: WorldOpts, key: string, permit: boolean, needles: RegExp[] = []): Leg {
  return {
    name: `module ${name}`,
    family: "module",
    permit,
    check: async (pluginRoot) => {
      const w = makeWorld(opts);
      const r = runEpicEdit(pluginRoot, w, key);
      const p = permit ? epicEditPermitProblem(r, w, key) : epicEditRefusalProblem(r, w, needles);
      return p === null ? null : `${p}\n${show(r)}`;
    },
  };
}

const MODULE_LEGS: Leg[] = [
  moduleLeg("PERMIT — every check holds", {}, EPIC, true),
  moduleLeg("TWIN (a) — the plan is not tracked", { untrackedPlan: true }, EPIC, false),
  moduleLeg("TWIN (a) — the key's milestone is not planned", {}, OTHER_EPIC, false),
  moduleLeg("TWIN (b) — the indexed plan carries another milestone", { planMilestone: "M_PROJ_999" }, EPIC, false),
  moduleLeg("TWIN (c) — the working-tree frontmatter differs from the index", { driftWorkingTree: true }, EPIC, false),
  moduleLeg("TWIN (d) — the binding is Linear", { linear: true }, EPIC, false),
  moduleLeg("TWIN (e) — the plan carries no container_origin", { containerOrigin: null }, EPIC, false),
  moduleLeg("TWIN (e) — the plan carries container_origin: joined", { containerOrigin: "joined" }, EPIC, false),
  moduleLeg("TWIN (e) — the plan carries container_origin: maybe", { containerOrigin: "maybe" }, EPIC, false),
  // v3.4.0 fix round 1, M1: the plan is read from HEAD, and HEAD = index = working tree for that path.
  moduleLeg("TWIN (head) — the plan is only staged, in no commit", { stagedOnlyPlan: true }, EPIC, false, [/is in no commit: HEAD of .* holds no /]),
  moduleLeg("TWIN (head) — container_origin: minted is only staged (HEAD says joined)", { containerOrigin: "joined", stagedOrigin: "minted" }, EPIC, false, [/in the git index or the working tree differs from HEAD/]),
  moduleLeg("TWIN (head) — the working tree differs from HEAD (body only)", { bodyDrift: "worktree" }, EPIC, false),
  moduleLeg("TWIN (head) — the index differs from HEAD (staged body edit)", { bodyDrift: "index" }, EPIC, false),
];

const GATE_LEGS: Leg[] = [...epicEditLegs(), ...fetchedTicketLegs()].map((l) => ({
  name: `gate ${l.name}`,
  family: "gate" as const,
  permit: l.expect === "permit",
  check: async (pluginRoot: string) => {
    const r = await l.run(pluginRoot);
    const p = l.expect === "permit" ? permitProblem(r) : refusalProblem(r);
    return p === null ? null : `${p}\n${show(r)}`;
  },
}));

const GRADER_LEGS: Leg[] = [...graderEpicEditLegs(), ...graderFetchLegs()].map((l) => ({
  name: `grader ${l.name}`,
  family: "grader" as const,
  permit: l.expect === "gated",
  check: async (pluginRoot: string) => {
    const r = await l.run(pluginRoot);
    return r.ungated === (l.expect === "ungated") ? null : `ungated=${r.ungated}, expected ${l.expect}`;
  },
}));

const ALL_LEGS = new Map<string, Leg>([...MODULE_LEGS, ...GATE_LEGS, ...GRADER_LEGS].map((l) => [l.name, l]));

// ------------------------------------------------------------------ rows

type Side = "module" | "hook" | "grader";

interface Row {
  id: string;
  guard: string;
  side: Side;
  /** Relative to the plugin root. */
  file: string;
  /** The exact anchor (occurs exactly once in `file`); null until sited. */
  find: string | null;
  replace: string | null;
  /** Full leg names (as in ALL_LEGS) the row turns red. */
  kills: string[];
}

/** The kill category each guard's row must hit (fixed by AC-STE-729.10). */
const CATEGORY: Readonly<Record<string, RegExp>> = {
  "check-a": /^module TWIN \(a\)/,
  "check-b": /^module TWIN \(b\)/,
  "check-c": /^module TWIN \(c\)/,
  "check-d": /^module TWIN \(d\)/,
  "check-e": /^module TWIN \(e\)/,
  "head-read": /^module TWIN \(head\)/,
  "head-equal": /^module TWIN \(head\)/,
  field: /^(gate|grader) TWIN \((fields|input)\)/,
  consent: /^(gate|grader) TWIN \(consent\)/,
  "tool-name": /^(gate|grader) TWIN \(tool name\)/,
  verdict: /^(gate|grader) TWIN \(verdict\)/,
};

const FAMILY_OF: Readonly<Record<Side, Family>> = { module: "module", hook: "gate", grader: "grader" };

const EPIC_EDIT_FILE = moduleRel("epic_edit.ts");

/**
 * IMPLEMENTER: site `find` / `replace` (and, if you like, add kill legs) for
 * every row. Do not change `id`, `side` or remove a row.
 */
const ROWS: Row[] = [
  { id: "check-a", guard: "epic_edit.ts (a): the git index tracks the plan", side: "module", file: EPIC_EDIT_FILE, find: "  const rel = candidates.find((c) => tracked(projectRoot, c));\n  if (rel === undefined) {\n    throw new EpicEditRefusal(\n      `${milestone} (from ${epicKey}) has no plan tracked by the git index of ${projectRoot} — neither ${candidates.join(\" nor \")} is tracked`,\n      `edit ${epicKey} only from the repository that planned ${milestone}, with its plan committed`,\n      context,\n    );\n  }\n  const planContext = `${context}, plan=${rel}`;\n\n  // (b) the plan, read from HEAD, carries `milestone: <M>`.\n  const planBody = headBlob(projectRoot, rel);", replace: "  const rel = candidates.find((c) => existsSync(join(projectRoot, c)));\n  if (rel === undefined) {\n    throw new EpicEditRefusal(\n      `${milestone} (from ${epicKey}) has no plan tracked by the git index of ${projectRoot} — neither ${candidates.join(\" nor \")} is tracked`,\n      `edit ${epicKey} only from the repository that planned ${milestone}, with its plan committed`,\n      context,\n    );\n  }\n  const planContext = `${context}, plan=${rel}`;\n\n  // (b) the plan, read from HEAD, carries `milestone: <M>`.\n  const planBody = headBlob(projectRoot, rel) ?? readFileSync(join(projectRoot, rel), \"utf-8\");", kills: ["module TWIN (a) — the plan is not tracked"] },
  { id: "check-b", guard: "epic_edit.ts (b): the indexed plan carries milestone: <M>", side: "module", file: EPIC_EDIT_FILE, find: "if (indexFrontmatter.milestone !== milestone) {", replace: "if (false) {", kills: ["module TWIN (b) — the indexed plan carries another milestone"] },
  { id: "check-c", guard: "epic_edit.ts (c): index and working-tree frontmatter agree", side: "module", file: EPIC_EDIT_FILE, find: "if (diskFrontmatter === null || JSON.stringify(diskFrontmatter) !== JSON.stringify(indexFrontmatter)) {", replace: "if (false) {", kills: ["module TWIN (c) — the working-tree frontmatter differs from the index"] },
  { id: "check-d", guard: "epic_edit.ts (d): the binding is Jira mode", side: "module", file: EPIC_EDIT_FILE, find: "if (mode !== \"jira\") {", replace: "if (false) {", kills: ["module TWIN (d) — the binding is Linear"] },
  { id: "check-e", guard: "epic_edit.ts (e): the indexed plan carries container_origin: minted (AC-STE-729.12)", side: "module", file: EPIC_EDIT_FILE, find: "if (origin !== \"minted\") {", replace: "if (false) {", kills: ["module TWIN (e) — the plan carries no container_origin", "module TWIN (e) — the plan carries container_origin: joined"] },
  // head-read drops the "container_origin: minted is only staged" leg: check (c) refuses it before (e) on both copies, so it is equivalent by construction.
  { id: "head-read", guard: "epic_edit.ts (M1): the plan is read from HEAD (git show HEAD:<rel> / git ls-tree HEAD), never the index alone", side: "module", file: EPIC_EDIT_FILE, find: "import { equalsHead, headBlob, tracked } from \"./epic_close\";", replace: "import { equalsHead, indexBlob as headBlob, tracked } from \"./epic_close\";", kills: ["module TWIN (head) — the plan is only staged, in no commit"] },
  { id: "head-equal", guard: "epic_edit.ts (M1): the index and the working tree both equal HEAD for the plan's path", side: "module", file: EPIC_EDIT_FILE, find: "const headEqual = equalsHead(projectRoot, rel);", replace: "const headEqual = true;", kills: ["module TWIN (head) — the working tree differs from HEAD (body only)", "module TWIN (head) — the index differs from HEAD (staged body edit)"] },
  { id: "field", guard: "hook: the Epic edit carries description/summary only", side: "hook", file: hookModuleRel, find: "  if (!isTextOnlyEdit(call.input)) return false;\n", replace: "", kills: ["gate TWIN (fields) — fields also carries labels"] },
  { id: "consent", guard: "hook: the `Edit <KEY>` AskUserQuestion answer after the announcement", side: "hook", file: hookModuleRel, find: "if (answeredAfter(ctx.parsed, { line: a.line, act: \"join\", key, title: null }, label)) return true;", replace: "return true;", kills: ["gate TWIN (consent) — no AskUserQuestion answer after the receipt"] },
  { id: "tool-name", guard: "hook: only a get-ticket tool_result proves ownership", side: "hook", file: hookModuleRel, find: "if (b.is_error === true || !fetches.has(b.tool_use_id)) continue;", replace: "if (b.is_error === true || !(fetches.has(b.tool_use_id) || resultText(b.content).trim().startsWith(\"{\"))) continue;", kills: ["gate TWIN (tool name) — the same answer echoed by Bash → refused"] },
  { id: "verdict", guard: "hook: only an owned (or adopted unowned) verdict permits", side: "hook", file: hookModuleRel, find: "if (verdict === \"owned\") return true;", replace: "return true;", kills: ["gate TWIN (verdict) — foreign-repo: the answer carries the sibling's tag demo-fe → refused"] },
  { id: "field", guard: "grader: the Epic edit carries description/summary only", side: "grader", file: graderRel, find: "isTextOnlyEdit(c.input) &&\n", replace: "", kills: ["grader TWIN (fields) — fields also carries labels"] },
  { id: "consent", guard: "grader: the `Edit <KEY>` answer after the announcement", side: "grader", file: graderRel, find: "return latest;\n            });\n          const permitted", replace: "return true;\n            });\n          const permitted", kills: ["grader TWIN (consent) — no answer"] },
  { id: "tool-name", guard: "grader: only a get-ticket result proves ownership", side: "grader", file: graderRel, find: "if (p.sidechain !== c.sidechain || !p.name.startsWith(\"mcp__\") || bareTool(p.name) !== GET_TICKET_TOOLS[tracker]) continue;\n              if (p.result.isError || !subjectKeys(p).includes(k)) continue;", replace: "if (p.sidechain !== c.sidechain) continue;\n              if (p.result.isError || !(subjectKeys(p).includes(k) || (p.result.items?.length ?? 0) > 0)) continue;", kills: ["grader TWIN (tool name) — the same item from a Bash call"] },
  { id: "verdict", guard: "grader: only an owned (or adopted unowned) verdict permits", side: "grader", file: graderRel, find: "if (newest.labels.includes(b.roots[s.root].tag)) return true;", replace: "return true;", kills: ["grader TWIN (verdict) — foreign-repo: the sibling root's tag"] },
];

const REQUIRED: ReadonlyArray<[string, Side]> = [
  ["check-a", "module"],
  ["check-b", "module"],
  ["check-c", "module"],
  ["check-d", "module"],
  ["check-e", "module"],
  ["head-read", "module"],
  ["head-equal", "module"],
  ...(["field", "consent", "tool-name", "verdict"] as const).flatMap((g) => [
    [g, "hook"] as [string, Side],
    [g, "grader"] as [string, Side],
  ]),
];

// ------------------------------------------------------------------ copies

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

/** A copy of the plugin's runtime tree (adapters/, templates/, manifest) as real files. */
function copyPlugin(label: string): string {
  const copy = join(tempDir(`mut-${label}`), "plugin");
  mkdirSync(copy, { recursive: true });
  for (const d of ["adapters", "templates", ".claude-plugin"]) cpSync(join(PLUGIN_ROOT, d), join(copy, d), { recursive: true, dereference: true });
  return copy;
}

let statusBefore = "";
let pristine = "";
beforeAll(() => {
  statusBefore = porcelain();
  pristine = copyPlugin("pristine");
});
afterAll(() => {
  cleanupTemps();
});

// ------------------------------------------------------------------ tests

describe("AC-STE-729.10 — the battery's shape: every guard has a sited row on every required side", () => {
  test("every required (guard, side) pair has a row, and every row names known legs of its own family", () => {
    for (const [id, side] of REQUIRED) expect({ id, side, present: ROWS.some((r) => r.id === id && r.side === side) }).toEqual({ id, side, present: true });
    for (const r of ROWS) {
      for (const k of r.kills) {
        const leg = ALL_LEGS.get(k);
        expect({ row: `${r.id}/${r.side}`, leg: k, known: leg !== undefined }).toEqual({ row: `${r.id}/${r.side}`, leg: k, known: true });
        expect({ row: `${r.id}/${r.side}`, leg: k, family: leg?.family }).toEqual({ row: `${r.id}/${r.side}`, leg: k, family: FAMILY_OF[r.side] });
        expect({ row: `${r.id}/${r.side}`, leg: k, permit: leg?.permit }).toEqual({ row: `${r.id}/${r.side}`, leg: k, permit: false });
      }
      expect({ row: `${r.id}/${r.side}`, inCategory: r.kills.some((k) => CATEGORY[r.id]!.test(k)) }).toEqual({ row: `${r.id}/${r.side}`, inCategory: true });
    }
  });

  test("CONTROL — the unmutated copy passes every leg the battery uses", async () => {
    const used = new Set(ROWS.flatMap((r) => r.kills));
    for (const l of ALL_LEGS.values()) if (l.permit) used.add(l.name);
    const failures: string[] = [];
    for (const name of used) {
      const p = await ALL_LEGS.get(name)!.check(pristine);
      if (p !== null) failures.push(`${name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-729.10 — removing one guard turns a named leg red", () => {
  for (const row of ROWS) {
    test(`${row.side} ${row.id} — ${row.guard}`, async () => {
      if (row.find === null || row.replace === null) {
        throw new Error(`row ${row.side}/${row.id} is not sited: set find/replace against the shipped ${row.file} (one exact anchor, removing only this check)`);
      }
      const mutant = copyPlugin(`${row.side}-${row.id}`);
      const target = join(mutant, row.file);
      if (!existsSync(target)) throw new Error(`row ${row.side}/${row.id}: ${row.file} does not exist`);
      const doc = readFileSync(target, "utf-8");
      writeFileSync(target, mutateInRegion(doc, 0, doc.length, row.find, row.replace, { label: `${row.side}/${row.id} in ${row.file}` }));

      // Not a load error: the family's permit legs still hold on the mutant.
      const family = FAMILY_OF[row.side];
      for (const l of ALL_LEGS.values()) {
        if (l.family !== family || !l.permit) continue;
        const p = await l.check(mutant);
        if (p !== null) throw new Error(`row ${row.side}/${row.id}: the mutant broke the permit leg "${l.name}" (a load error or an over-wide mutation, not a kill):\n${p}`);
      }
      // Killed: every named leg holds on the pristine copy and fails on the mutant.
      for (const k of row.kills) {
        const leg = ALL_LEGS.get(k)!;
        const before = await leg.check(pristine);
        if (before !== null) throw new Error(`row ${row.side}/${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await leg.check(mutant);
        if (after === null) throw new Error(`row ${row.side}/${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});

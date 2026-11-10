// STE-731 (M_b2fdc0) — AC-STE-731.7: the mutation battery.
//
// Removing the path limit from any ONE of the three lock commits (claimLock,
// releaseLock, cleanupStaleLocks) must turn at least one NAMED leg red.
//
// Each row copies adapters/_shared/src (real files) to a temporary directory,
// applies ONE sited mutation to the copy's local_provider.ts with
// `mutateInRegion` (the anchor must occur exactly once), dynamically imports
// the mutant LocalProvider and drives the row's named legs — the very legs the
// main suite runs, from tests/_m_b2fdc0_ste731_fixture.ts. A row is KILLED only
// when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - at least one named leg is the FOREIGN twin of the row's own method;
//   - the row's NO-FOREIGN twin still PASSES on the mutant, so a mutation that
//     breaks loading or the commit itself is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `find` / `replace`
// are null until the shipped code exists. Site each row against the shipped
// local_provider.ts with ONE exact anchor and a replacement that removes only
// that commit's path limit (e.g. the `--only -- ${lockPath}` tail → ``).
// A null row FAILS, naming itself — the battery never passes vacuously. The
// row ids, methods and kill legs below are fixed by AC-STE-731.7.
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import {
  EXACT_LEGS,
  METHODS,
  PLUGIN_ROOT,
  SHAPES,
  cleanupTemps,
  observe,
  onlyLockProblem,
  tempDir,
  type Method,
  type ProviderCtor,
} from "./_m_b2fdc0_ste731_fixture";

setDefaultTimeout(300_000);

const PROVIDER_REL = "adapters/_shared/src/local_provider.ts";

interface Leg {
  name: string;
  method: Method;
  permit: boolean;
  check: (ctor: ProviderCtor) => Promise<string | null>;
}

const LEGS: Leg[] = METHODS.flatMap((method) => [
  {
    name: `${method} NO-FOREIGN twin`,
    method,
    permit: true,
    check: async (ctor: ProviderCtor) => onlyLockProblem(await observe(ctor, method, [], "mut-clean")),
  },
  {
    name: `${method} FOREIGN twin`,
    method,
    permit: false,
    check: async (ctor: ProviderCtor) => onlyLockProblem(await observe(ctor, method, SHAPES, "mut-foreign")),
  },
]);
const LEG = new Map(LEGS.map((l) => [l.name, l]));

interface Row {
  id: Method;
  guard: string;
  /** The exact anchor in local_provider.ts (occurs exactly once); null until sited. */
  find: string | null;
  replace: string | null;
  kills: string[];
}

/** IMPLEMENTER: site `find` / `replace` for every row. Do not change `id` or `kills`. */
const ROWS: Row[] = [
  { id: "claim", guard: "claimLock commits only its lock path", find: "git commit -q --only -m ${subject} -m ${`branch: ${branch}`} -- ${lockPath}`", replace: "git commit -q -m ${subject} -m ${`branch: ${branch}`}`", kills: ["claim FOREIGN twin"] },
  { id: "release", guard: "releaseLock commits only its lock path", find: " --only -- ${lockPath}`", replace: "`", kills: ["release FOREIGN twin"] },
  { id: "cleanup", guard: "cleanupStaleLocks commits only its lock paths", find: " --only -- ${lockPaths}`", replace: "`", kills: ["cleanup FOREIGN twin"] },
];

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

/** A copy of adapters/_shared/src with (optionally) one mutation, and its LocalProvider. */
async function providerFrom(label: string, mutate?: (doc: string) => string): Promise<ProviderCtor> {
  const root = join(tempDir(`mut-${label}`), "plugin");
  mkdirSync(join(root, "adapters", "_shared"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "adapters", "_shared", "src"), join(root, "adapters", "_shared", "src"), { recursive: true, dereference: true });
  const target = join(root, PROVIDER_REL);
  if (mutate) writeFileSync(target, mutate(readFileSync(target, "utf-8")));
  const mod = (await import(target)) as { LocalProvider: ProviderCtor };
  return mod.LocalProvider;
}

let statusBefore = "";
let pristine: ProviderCtor;
beforeAll(async () => {
  statusBefore = porcelain();
  pristine = await providerFrom("pristine");
});
afterAll(() => cleanupTemps());

describe("AC-STE-731.7 — the battery's shape", () => {
  test("one row per lock commit, each naming its own method's FOREIGN twin", () => {
    expect(ROWS.map((r) => r.id).sort()).toEqual([...METHODS].sort());
    for (const r of ROWS) {
      for (const k of r.kills) expect({ row: r.id, leg: k, known: LEG.has(k), permit: LEG.get(k)?.permit }).toEqual({ row: r.id, leg: k, known: true, permit: false });
      expect({ row: r.id, own: r.kills.includes(`${r.id} FOREIGN twin`) }).toEqual({ row: r.id, own: true });
    }
  });

  test("CONTROL — the unmutated copy passes every leg", async () => {
    const failures: string[] = [];
    for (const l of LEGS) {
      const p = await l.check(pristine);
      if (p !== null) failures.push(`${l.name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-731.7 — removing one commit's path limit turns a named leg red", () => {
  for (const row of ROWS) {
    test(`${row.id} — ${row.guard}`, async () => {
      if (row.find === null || row.replace === null) {
        throw new Error(`row ${row.id} is not sited: set find/replace against the shipped ${PROVIDER_REL} (one exact anchor, removing only this commit's path limit)`);
      }
      const find = row.find;
      const replace = row.replace;
      const mutant = await providerFrom(`row-${row.id}`, (doc) => mutateInRegion(doc, 0, doc.length, find, replace, { label: `${row.id} in ${PROVIDER_REL}` }));
      const clean = await LEG.get(`${row.id} NO-FOREIGN twin`)!.check(mutant);
      if (clean !== null) throw new Error(`row ${row.id}: the mutant broke the NO-FOREIGN twin (a load error or an over-wide mutation, not a kill):\n${clean}`);
      for (const k of row.kills) {
        const before = await LEG.get(k)!.check(pristine);
        if (before !== null) throw new Error(`row ${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await LEG.get(k)!.check(mutant);
        if (after === null) throw new Error(`row ${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }
});

// ------------------------------------------------------------ L3 — the exact-branch rule
//
// Reintroducing a loose branch comparison in claimLock — the held lock read by
// substring, or the remote ref read by suffix — must turn a named exact-branch
// leg red while the row's exact-branch control still passes on the mutant.

const EXACT = new Map(EXACT_LEGS.map((l) => [l.name, l]));

interface ExactRow {
  id: string;
  guard: string;
  /** The exact anchor in local_provider.ts (occurs exactly once); null until sited. */
  find: string | null;
  replace: string | null;
  control: string;
  kills: string[];
}

/** IMPLEMENTER: site `find` / `replace` for every row. Do not change `id`, `control` or `kills`. */
const EXACT_ROWS: ExactRow[] = [
  {
    id: "exact-local",
    guard: "a held lock is already-ours only when its branch: line IS the claimed branch",
    find: "if (extractBranch(existing) === branch) {",
    replace: "if (existing.includes(`branch: ${branch}`)) {",
    control: "local: a lock held by feat/a is already-ours for feat/a",
    kills: ["local: a lock held by feat/a-2 is taken-elsewhere for feat/a"],
  },
  {
    id: "exact-remote",
    guard: "a remote lock is ours only on <remote>/<the claimed branch> exactly",
    find: "if (ownRefs.has(branch)) continue;",
    replace: "if (branch.endsWith(`/${claimedBranch}`)) continue;",
    control: "remote: a lock on origin/feat/a is not taken for feat/a",
    kills: ["remote: a lock on origin/x/feat/a is taken-elsewhere for feat/a"],
  },
];

describe("L3 — loosening the exact-branch rule turns a named leg red", () => {
  test("the battery's shape: every named leg exists; controls permit, kills do not", () => {
    for (const r of EXACT_ROWS) {
      expect({ row: r.id, control: EXACT.get(r.control)?.permit }).toEqual({ row: r.id, control: true });
      for (const k of r.kills) expect({ row: r.id, leg: k, permit: EXACT.get(k)?.permit }).toEqual({ row: r.id, leg: k, permit: false });
    }
  });

  test("CONTROL — the unmutated copy passes every exact-branch leg", async () => {
    const failures: string[] = [];
    for (const l of EXACT_LEGS) {
      const p = await l.check(pristine);
      if (p !== null) failures.push(`${l.name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });

  for (const row of EXACT_ROWS) {
    test(`${row.id} — ${row.guard}`, async () => {
      if (row.find === null || row.replace === null) {
        throw new Error(`row ${row.id} is not sited: set find/replace against the shipped ${PROVIDER_REL} (one exact anchor that loosens only this comparison)`);
      }
      const find = row.find;
      const replace = row.replace;
      const mutant = await providerFrom(`row-${row.id}`, (doc) => mutateInRegion(doc, 0, doc.length, find, replace, { label: `${row.id} in ${PROVIDER_REL}` }));
      const control = await EXACT.get(row.control)!.check(mutant);
      if (control !== null) throw new Error(`row ${row.id}: the mutant broke its control "${row.control}" (a load error or an over-wide mutation, not a kill):\n${control}`);
      for (const k of row.kills) {
        const before = await EXACT.get(k)!.check(pristine);
        if (before !== null) throw new Error(`row ${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await EXACT.get(k)!.check(mutant);
        if (after === null) throw new Error(`row ${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});

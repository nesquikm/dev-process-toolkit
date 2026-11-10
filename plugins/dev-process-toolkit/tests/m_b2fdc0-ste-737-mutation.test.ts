// STE-737 (M_b2fdc0) — AC-STE-737.4: the mutation battery.
//
// Removing the subfolder search, or removing the Rust warning, must turn a
// NAMED leg red. Each row copies adapters/_shared/src to a temporary directory,
// applies ONE sited mutation to the copy's signature_extractor.ts with
// `mutateInRegion` (the anchor must occur exactly once), dynamically imports
// the mutant and runs the row's named legs — the very legs the main suite runs,
// from tests/_m_b2fdc0_ste737_fixture.ts. A row is KILLED only when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - every root-tsconfig leg (AC-STE-737.3) still PASSES on the mutant, so a
//     mutation that breaks loading or extraction is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `find` / `replace`
// are null until the shipped code exists. Site each row against the shipped
// signature_extractor.ts with ONE exact anchor and a replacement that removes
// only that behaviour. A null row FAILS, naming itself — the battery never
// passes vacuously. Row ids and kill legs are fixed by AC-STE-737.4.
//
// The real tree is never mutated: `git status --porcelain` over
// adapters/_shared/src is compared before and after (scoped there because other
// FRs edit the rest of the tree in parallel).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { mutateInRegion } from "./_sited-mutation";
import {
  PLUGIN_ROOT,
  ROOT_CASES,
  cleanupTemps,
  extractorFrom,
  rustAtRootWarns,
  rustOneLevelDownWarns,
  sameAsV330,
  shippedSource,
  subdirTsIsRead,
  subdirsReadInNameOrder,
  v330Source,
  type Extract,
} from "./_m_b2fdc0_ste737_fixture";

setDefaultTimeout(300_000);

const LEGS: Record<string, (e: Extract) => string | null> = {
  "subfolder tsconfig is read": subdirTsIsRead,
  "two subfolders read in name order": subdirsReadInNameOrder,
  "Rust at the root warns": rustAtRootWarns,
  "Rust one folder down warns": rustOneLevelDownWarns,
};

interface Row {
  id: string;
  guard: string;
  /** The exact anchor in signature_extractor.ts (occurs exactly once); null until sited. */
  find: string | null;
  replace: string | null;
  kills: string[];
}

/** IMPLEMENTER: site `find` / `replace` for every row. Do not change `id` or `kills`. */
const ROWS: Row[] = [
  {
    id: "subdir-search",
    guard: "detectStacks searches one folder down when the root has no tsconfig.json",
    find: 'if (existsSync(join(dir, "tsconfig.json"))) roots.push(dir);',
    replace: "",
    kills: ["subfolder tsconfig is read", "two subfolders read in name order"],
  },
  {
    id: "rust-warning",
    guard: "a Cargo.toml with no other stack gets the Rust warning",
    find: "const cargo = findCargoToml(projectRoot);",
    replace: "const cargo: string | null = null;",
    kills: ["Rust at the root warns", "Rust one folder down warns"],
  },
];

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "adapters/_shared/src"], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

let statusBefore = "";
let pristine: Extract;
let v330: Extract;
beforeAll(async () => {
  statusBefore = porcelain();
  pristine = await extractorFrom("pristine");
  v330 = await extractorFrom("v330", v330Source());
});
afterAll(() => cleanupTemps());

describe("AC-STE-737.4 — the battery's shape", () => {
  test("one row per behaviour, each killing only known legs", () => {
    expect(ROWS.map((r) => r.id)).toEqual(["subdir-search", "rust-warning"]);
    for (const r of ROWS) for (const k of r.kills) expect({ row: r.id, leg: k, known: k in LEGS }).toEqual({ row: r.id, leg: k, known: true });
  });

  test("CONTROL — the unmutated copy passes every leg", () => {
    const failures: string[] = [];
    for (const [name, leg] of Object.entries(LEGS)) {
      const p = leg(pristine);
      if (p !== null) failures.push(`${name}: ${p}`);
    }
    for (const c of ROOT_CASES) {
      const p = sameAsV330(pristine, v330, c);
      if (p !== null) failures.push(p);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-737.4 — removing the behaviour turns a named leg red", () => {
  for (const row of ROWS) {
    test(`${row.id} — ${row.guard}`, async () => {
      if (row.find === null || row.replace === null) {
        throw new Error(`row ${row.id} is not sited: set find/replace against the shipped signature_extractor.ts (one exact anchor, removing only this behaviour)`);
      }
      const find = row.find;
      const replace = row.replace;
      const src = shippedSource();
      const mutant = await extractorFrom(`row-${row.id}`, mutateInRegion(src, 0, src.length, find, replace, { label: `${row.id} in signature_extractor.ts` }));
      for (const c of ROOT_CASES) {
        const p = sameAsV330(mutant, v330, c);
        if (p !== null) throw new Error(`row ${row.id}: the mutant broke a root-tsconfig leg (a load error or an over-wide mutation, not a kill):\n${p}`);
      }
      for (const k of row.kills) {
        const before = LEGS[k]!(pristine);
        if (before !== null) throw new Error(`row ${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = LEGS[k]!(mutant);
        if (after === null) throw new Error(`row ${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real adapters/_shared/src was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});

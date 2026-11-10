// STE-736 (M_b2fdc0) — AC-STE-736.6: removing any one fix turns its test red.
//
// Each row copies the shipped surfaces (adapters/_shared/src, .claude-plugin,
// docs/settings-reference.md, skills/visual-check/SKILL.md) to a temporary
// plugin root, applies ONE sited mutation with `mutateInRegion` (the anchor must
// occur exactly once in the row's file) and runs the row's named legs — the very
// legs the main suites run, from tests/_m_b2fdc0_ste736_fixture.ts — against the
// copy. A row is KILLED only when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - the row's SANITY check still passes on the mutant, so a mutation that
//     breaks loading is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `find` / `replace`
// are null until the shipped fix exists. Site each row against the shipped file
// with ONE exact anchor and a replacement that removes only that fix (restoring
// the pre-fix behaviour). A null row FAILS, naming itself — the battery never
// passes vacuously. Row ids, files and kill legs are fixed by AC-STE-736.6.
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import { LEGS, LEG_BY_NAME, PLUGIN_ROOT, cleanupTemps, tempDir, tree } from "./_m_b2fdc0_ste736_fixture";

setDefaultTimeout(300_000);

const COPIED = ["adapters/_shared/src", ".claude-plugin", "docs/settings-reference.md", "skills/visual-check/SKILL.md"];

type Sanity = (root: string) => Promise<string | null>;

const SANITY: Record<string, Sanity> = {
  rewrite: async (root) => LEG_BY_NAME.get("AC.1 active plans and requirements keep today's form")!.check(root),
  settings: async (root) => {
    const mod = await import(join(root, "adapters/_shared/src/project_settings.ts"));
    for (const files of [
      { "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\nverification:\n  verify_mode: blocking\n' },
      { "CLAUDE.md": "# Fake\n\n## Verification\n\nverify_mode: blocking\n" },
    ]) {
      try {
        mod.loadProjectSettings(tree("sanity-settings", files));
      } catch (e) {
        return `the mutant refuses verify_mode: blocking: ${(e as Error).message}`;
      }
    }
    return null;
  },
  probe: async (root) => {
    const mod = await import(join(root, "adapters/_shared/src/socratic_first_turn_post_hoc_drift.ts"));
    return mod.inspectCommit("chore(specs): write FR STE-9041", "") === "violation" ? null : "the mutant no longer flags the singular subject";
  },
  text: async () => null,
};

interface Row {
  id: string;
  ac: string;
  /** The file the fix lives in, relative to the plugin root. */
  file: string;
  /** Exact anchor in `file` (occurs exactly once); null until sited. */
  find: string | null;
  replace: string | null;
  sanity: keyof typeof SANITY;
  kills: string[];
}

/** IMPLEMENTER: site `find` / `replace` for every row. Do not change `id`, `file` or `kills`. */
const ROWS: Row[] = [
  {
    id: "ac1-depth",
    ac: "AC-STE-736.1",
    file: "adapters/_shared/src/spec_archive/rewrite_links.ts",
    find: "const planDir = dirname(absPath);",
    replace: "const planDir = join(dirname(absPath), \"..\");",
    sanity: "rewrite",
    kills: ["AC.1 archived plan FR links resolve after milestone archival"],
  },
  {
    id: "ac2-repair",
    ac: "AC-STE-736.2",
    file: "adapters/_shared/src/spec_archive/rewrite_links.ts",
    find: "const relativeLink = !/^[a-z]+:/i.test(target) && !target.startsWith(\"/\");",
    replace: "const relativeLink = !/^[a-z]+:/i.test(target) && !target.startsWith(\"/\") && !target.includes(\"frs/archive/\");",
    sanity: "rewrite",
    kills: ["AC.2 v3.3.0-shape broken link is repaired on a re-run"],
  },
  {
    id: "ac3-settings",
    ac: "AC-STE-736.3",
    file: "adapters/_shared/src/project_settings.ts",
    find: "; use \\`blocking\\` for a check that blocks the commit`,",
    replace: "`,",
    sanity: "settings",
    kills: ["AC.3 settings loader refuses `required` and says to use `blocking`"],
  },
  {
    id: "ac3-legacy",
    ac: "AC-STE-736.3",
    file: "adapters/_shared/src/project_settings_legacy.ts",
    find: "; use \"blocking\" for a check that blocks the commit'",
    replace: "'",
    sanity: "settings",
    kills: ["AC.3 legacy loader refuses `required` and says to use `blocking`"],
  },
  {
    id: "ac3-docs",
    ac: "AC-STE-736.3",
    file: "docs/settings-reference.md",
    find: "- `verify_mode` value `required` is refused, as is any value outside `advisory` | `blocking` | `manual`; use `blocking` for a check that blocks the commit.\n",
    replace: "",
    sanity: "text",
    kills: ["AC.3 settings-reference says `required` is refused and `blocking` is the value"],
  },
  {
    id: "ac4-plural",
    ac: "AC-STE-736.4",
    file: "adapters/_shared/src/socratic_first_turn_post_hoc_drift.ts",
    find: "write FRs?\\b/",
    replace: "write FR\\b/",
    sanity: "probe",
    kills: ["AC.4 probe #45 checks a plural `write FRs` subject", "AC.4 probe #45 flags a plural-subject HEAD commit with no marker"],
  },
  {
    id: "ac5-skill",
    ac: "AC-STE-736.5",
    file: "skills/visual-check/SKILL.md",
    find: "If the browser helper refuses a loopback or private address (such as `localhost`, `127.0.0.1` or `192.168.x.x`), reach the dev server another way: use a non-loopback address the helper accepts (for example a tunnel URL), or drive the page through the Chrome browser tools instead.\n\n",
    replace: "",
    sanity: "text",
    kills: ["AC.5 visual-check §1 names a route around a loopback refusal"],
  },
];

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

/** A copy of the shipped surfaces with (optionally) one mutation applied to `file`. */
function pluginCopy(label: string, file?: string, mutate?: (doc: string) => string): string {
  const root = join(tempDir(`mut-${label}`), "plugin");
  for (const rel of COPIED) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(PLUGIN_ROOT, rel), join(root, rel), { recursive: true, dereference: true });
  }
  if (file && mutate) {
    const target = join(root, file);
    writeFileSync(target, mutate(readFileSync(target, "utf-8")));
  }
  return root;
}

let statusBefore = "";
let pristine = "";
beforeAll(() => {
  statusBefore = porcelain();
  pristine = pluginCopy("pristine");
});
afterAll(() => cleanupTemps());

describe("AC-STE-736.6 — the battery's shape", () => {
  test("one row per fix site, every AC .1 to .5 covered, every kill leg known and of its own AC", () => {
    expect([...new Set(ROWS.map((r) => r.ac))].sort()).toEqual(["AC-STE-736.1", "AC-STE-736.2", "AC-STE-736.3", "AC-STE-736.4", "AC-STE-736.5"]);
    for (const r of ROWS) {
      expect(r.kills.length).toBeGreaterThan(0);
      for (const k of r.kills) expect({ row: r.id, leg: k, ac: LEG_BY_NAME.get(k)?.ac }).toEqual({ row: r.id, leg: k, ac: r.ac });
    }
  });

  test("CONTROL — the unmutated copy passes every leg and every sanity check", async () => {
    const failures: string[] = [];
    for (const l of LEGS) {
      const p = await l.check(pristine);
      if (p !== null) failures.push(`${l.name}: ${p}`);
    }
    for (const [name, s] of Object.entries(SANITY)) {
      const p = await s(pristine);
      if (p !== null) failures.push(`sanity ${name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-736.6 — removing one fix turns a named leg red", () => {
  for (const row of ROWS) {
    test(`${row.id} — ${row.file}`, async () => {
      if (row.find === null || row.replace === null) {
        throw new Error(`row ${row.id} is not sited: set find/replace against the shipped ${row.file} (one exact anchor, removing only this fix)`);
      }
      const find = row.find;
      const replace = row.replace;
      const mutant = pluginCopy(`row-${row.id}`, row.file, (doc) => mutateInRegion(doc, 0, doc.length, find, replace, { label: `${row.id} in ${row.file}` }));
      const sane = await SANITY[row.sanity]!(mutant);
      if (sane !== null) throw new Error(`row ${row.id}: the mutant fails its sanity check (a load error or an over-wide mutation, not a kill):\n${sane}`);
      for (const k of row.kills) {
        const before = await LEG_BY_NAME.get(k)!.check(pristine);
        if (before !== null) throw new Error(`row ${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await LEG_BY_NAME.get(k)!.check(mutant);
        if (after === null) throw new Error(`row ${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});

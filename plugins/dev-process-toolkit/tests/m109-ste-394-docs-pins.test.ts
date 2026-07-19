// M109 STE-394 — the doc-surface half: the retired stale-plugin advisory and
// the 68 → 69 probe-count recalibration.
//
// AC map:
//   AC-STE-394.6 — the structurally-inert stale-plugin advisory is deleted from
//                  `skills/upgrade/SKILL.md` as a WHOLE UNIT (prose line + its
//                  fenced advisory block), the surrounding Step 1 prose is
//                  re-keyed in the same edit (the heading and the
//                  "Both … Neither refuses" sentence both become false with one
//                  advisory left), and the "code still running can re-create
//                  the state" concession is PRESERVED in the surviving prose.
//                  A retired-literal ABSENT tripwire pins
//                  `Advisory: installed plugin v`, vacuous-passing when the
//                  file is absent.
//   AC-STE-394.7 — probe-count pins bump 68 → 69 at every enumerated surface:
//                  README.md's `N numbered` + `layers N probes` tokens, the new
//                  `69. **upgrade_staleness**` entry in gate-check SKILL.md,
//                  and the three pinned test files.
//
// Shape precedent: `tests/m108-ste-393-docs-pins.test.ts`, whose own README
// pins this FR re-keys.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");

const upgradeSkillPath = join(PLUGIN_ROOT, "skills", "upgrade", "SKILL.md");
const gateCheckSkillPath = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const readmePath = join(REPO_ROOT, "README.md");

const read = (path: string): string => readFileSync(path, "utf-8");

// ---------------------------------------------------------------------------
// AC-STE-394.6 — the stale-plugin advisory is gone, as a whole unit
// ---------------------------------------------------------------------------

describe("AC-STE-394.6 — retired-literal ABSENT tripwire", () => {
  test("`Advisory: installed plugin v` appears nowhere in the upgrade skill", () => {
    // Vacuous-pass when the file is absent (downstream consumers ship no
    // plugin skills tree) — the tripwire guards a file, it does not demand one.
    if (!existsSync(upgradeSkillPath)) return;
    expect(read(upgradeSkillPath)).not.toContain("Advisory: installed plugin v");
  });

  test("the fenced advisory block's second line is gone too — deleted as a UNIT", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    expect(body).not.toContain("Migrations may be re-broken by the older code still running");
    // The whole prose lead-in goes with it.
    expect(body).not.toContain("**Stale plugin.**");
  });

  test("no surviving prose compares the installed plugin against the newest `introduced_in`", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    const paragraphs = body.split(/\n\s*\n/);
    const comparisons = paragraphs.filter(
      (p) =>
        p.includes("introduced_in") &&
        /installed plugin|plugin manifest|older than/i.test(p),
    );
    expect(comparisons).toEqual([]);
  });
});

describe("AC-STE-394.6 — Step 1 prose is re-keyed in the same edit", () => {
  test("the Step 1 heading no longer claims a plural set of advisories", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const heading = read(upgradeSkillPath)
      .split("\n")
      .find((l) => /^## Step 1\b/.test(l));
    expect(heading).toBeDefined();
    expect(heading!).not.toMatch(/advisories/i);
    expect(heading!).toMatch(/advisory/i);
  });

  test("the `Both … Neither refuses` sentence is gone", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    expect(body).not.toContain("Both advisories below");
    expect(body).not.toContain("Neither refuses");
  });

  test("the surviving Step 1 prose still says warn-only and still continues the run", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    const step1 = body.slice(
      body.indexOf("## Step 1"),
      body.indexOf("## Step 2"),
    );
    expect(step1.length).toBeGreaterThan(0);
    expect(step1).toMatch(/warn-only/);
    expect(step1).toMatch(/continue/i);
  });

  test("the blanket `.dpt/` advisory — the one that survives — is intact", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    expect(body).toContain("Advisory: root .gitignore line");
    expect(body).toContain("Blanket `.dpt/` ignore.");
  });
});

describe("AC-STE-394.6 — the re-creation concession is PRESERVED, not deleted with the advisory", () => {
  test("the surviving prose still concedes that running code can re-create migrated state", () => {
    if (!existsSync(upgradeSkillPath)) return;
    const body = read(upgradeSkillPath);
    expect(body).toMatch(/re-create/i);
    const paragraphs = body.split(/\n\s*\n/);
    const concession = paragraphs.filter(
      (p) => /re-create/i.test(p) && /(state|clean)/i.test(p),
    );
    expect(concession.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-394.7 — probe-count pins bump 68 → 69 at every pinned surface
// ---------------------------------------------------------------------------

describe("AC-STE-394.7 — README probe-count pins move 68 → 69", () => {
  const readme = (): string => read(readmePath);

  test("the Features bullet counts 69 numbered probes", () => {
    expect(readme()).toMatch(/\b69\b\s+numbered `\/gate-check` probes/);
  });

  test("the /implement-invokes-/tdd aside counts 69 probes", () => {
    expect(readme()).toMatch(/layers 69 probes/);
  });

  test("no stale `68 numbered` / `layers 68 probes` token survives in README", () => {
    const body = readme();
    expect(body).not.toMatch(/\b68\b\s+numbered/);
    expect(body).not.toMatch(/layers 68 probes/);
  });

  test("the `N numbered` token is still unique — one line owns the count", () => {
    const hits = readme()
      .split("\n")
      .filter((l) => /\d+\s+numbered `\/gate-check` probes/.test(l));
    expect(hits.length).toBe(1);
  });
});

describe("AC-STE-394.7 — gate-check SKILL.md gains the #69 entry", () => {
  const skill = (): string => read(gateCheckSkillPath);

  test("the highest numbered probe is now 69", () => {
    const numbers = [...skill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThan(0);
    expect(Math.max(...numbers)).toBe(69);
  });

  test("#69 is `upgrade_staleness` and sits directly after #68 `migration_coverage`", () => {
    const body = skill();
    expect(body).toMatch(/^69\.\s+\*\*`?upgrade_staleness`?\*\*/m);
    const i68 = body.search(/^68\.\s+\*\*`?migration_coverage`?\*\*/m);
    const i69 = body.search(/^69\.\s+\*\*`?upgrade_staleness`?\*\*/m);
    expect(i68).toBeGreaterThanOrEqual(0);
    expect(i69).toBeGreaterThan(i68);
  });

  test("the #69 entry declares severity and names its module + test coverage", () => {
    const block = skill().match(
      /^69\.\s+\*\*`?upgrade_staleness`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(block).not.toBeNull();
    const text = block![0];
    expect(text).toMatch(/adapters\/_shared\/src\/upgrade_staleness\.ts/);
    expect(text).toMatch(/Severity:\s*(warning|notes)/i);
    expect(text).toMatch(/tests\/gate-check-upgrade-staleness\.test\.ts/);
    // The probe is warn-only: the entry must say it never fails the gate.
    expect(text).toMatch(/NOTES|never (fails|blocks)/i);
  });

  test("README and gate-check SKILL.md agree on the probe count", () => {
    const numbers = [...skill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    const counted = read(readmePath).match(/(\d+) numbered `\/gate-check` probes/);
    expect(counted).not.toBeNull();
    expect(Number(counted![1])).toBe(Math.max(...numbers));
  });
});

describe("AC-STE-394.7 — the three pinned test files carry the 69-form pin", () => {
  const testFile = (name: string): string => read(join(PLUGIN_ROOT, "tests", name));

  test("tests/gate-check-spec-write-next-line-doc.test.ts pins 69", () => {
    const body = testFile("gate-check-spec-write-next-line-doc.test.ts");
    expect(body).toContain('"69 numbered"');
    expect(body).toContain("layers 69 probes");
    expect(body).toContain("toBe(69)");
  });

  test("tests/gate-check-public-surface-count-drift.test.ts pins 69", () => {
    const body = testFile("gate-check-public-surface-count-drift.test.ts");
    expect(body).toContain("\\b69\\b.*numbered");
    expect(body).toContain("\\b69\\b\\s+probes");
  });

  test("tests/m108-ste-393-docs-pins.test.ts pins 69", () => {
    const body = testFile("m108-ste-393-docs-pins.test.ts");
    expect(body).toContain("\\b69\\b\\s+numbered");
    expect(body).toContain("layers 69 probes");
  });
});

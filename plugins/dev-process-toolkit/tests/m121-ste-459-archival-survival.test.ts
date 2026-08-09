// STE-459 — M121's milestone-scoped test files must survive their own archival.
//
// Found by performing the archive, not by any test that asked the question:
// archiving M121's FRs and plan took the gate from 7047/15/0 to 7030/18/14.
// Fourteen assertions failed loudly and three went SILENTLY vacuous behind
// guards written to tolerate a plugin-only checkout that ships no `specs/` —
// archival is byte-indistinguishable from that case at the only signal those
// guards consult, so the suite reported GREEN with three fewer things checked.
//
// This file is the durable half. The six edits fix M121; the detector below is
// what stops M122's first milestone-scoped test file repeating it, because the
// live-then-archive conditional is a convention whose only documentation was
// its own prior call sites (`m108-ste-393-docs-pins.test.ts:99`,
// `m114-ste-416-linear-checkbox-doc-accuracy.test.ts:203`).
//
// Scope is deliberately `tests/m121-*.test.ts` and NOT `tests/*.ts`: widening
// it is the obvious next step and is recorded as open at
// `specs/notes/follow-ups.md` § 0s rather than smuggled in here.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = import.meta.dir;

// ═════════════════════════════ the detector ════════════════════════════════

export interface LiveOnlyBinding {
  readonly dir: "frs" | "plan";
  readonly basename: string;
}

/**
 * Every `specs/frs/<x>.md` / `specs/plan/<x>.md` path BOUND by `source` for
 * which `source` names no archived counterpart.
 *
 * Two literal spellings are recognised because the repo uses both — the
 * one-segment form `join(ROOT, "specs/frs/STE-446.md")` and the split form
 * `join(ROOT, "specs", "plan", "M121.md")`.
 *
 * Quote characters are `"` and `'` ONLY, never a backtick. That exclusion is
 * load-bearing rather than incidental: sibling suites name spec paths inside
 * backticked PROSE in comments (`m121-ste-448-mode-none-leg.test.ts:740` is
 * one), and a comment mentioning an artifact is not a binding to it. Matching
 * backticks would make this detector fire on documentation.
 */
export function liveOnlySpecBindings(source: string): LiveOnlyBinding[] {
  const found = new Map<string, LiveOnlyBinding>();

  const record = (dir: string, basename: string): void => {
    if (dir !== "frs" && dir !== "plan") return;
    const archivedSlash = `specs/${dir}/archive/${basename}`;
    const archivedSplit = new RegExp(
      `["']specs["']\\s*,\\s*["']${dir}["']\\s*,\\s*["']archive["']\\s*,\\s*["']${escapeRe(basename)}["']`,
    );
    if (source.includes(archivedSlash) || archivedSplit.test(source)) return;
    found.set(`${dir}/${basename}`, { dir, basename });
  };

  const slashForm = /["']specs\/(frs|plan)\/([A-Za-z0-9_.\-]+\.md)["']/g;
  for (const m of source.matchAll(slashForm)) record(m[1]!, m[2]!);

  const splitForm =
    /["']specs["']\s*,\s*["'](frs|plan)["']\s*,\s*["']([A-Za-z0-9_.\-]+\.md)["']/g;
  for (const m of source.matchAll(splitForm)) record(m[1]!, m[2]!);

  return [...found.values()];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════════════ AC-STE-459.6 — the ban ════════════════════════════

describe("AC-STE-459.6 — no milestone-scoped test file binds a live-only spec path", () => {
  const files = readdirSync(TESTS_DIR)
    .filter((n) => /^m121-.*\.test\.ts$/.test(n))
    .sort();

  test("the glob is non-empty — the ban has subjects", () => {
    // Non-vacuity first. A ban that iterates nothing is satisfied by deleting
    // its subject, which is Pattern 31 rider 1 and the shape this milestone
    // exists to remove.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    test(`${name} names the archived counterpart of every spec path it binds`, () => {
      const src = readFileSync(join(TESTS_DIR, name), "utf8");
      const violations = liveOnlySpecBindings(src);
      expect(
        violations.map((v) => `specs/${v.dir}/${v.basename}`).join(", "),
      ).toBe("");
    });
  }

  test("the detector FIRES on the pre-fix shape — both literal spellings", () => {
    // The falsifiability witness, in memory, so it stands whatever the tree
    // looks like. These two strings are the exact forms the six files carried
    // before STE-459.
    const preFixSlash = `const FR_PATH = join(REPO_ROOT, "specs/frs/STE-446.md");`;
    expect(liveOnlySpecBindings(preFixSlash)).toEqual([
      { dir: "frs", basename: "STE-446.md" },
    ]);

    const preFixSplit = `const PLAN_PATH = join(REPO_ROOT, "specs", "plan", "M121.md");`;
    expect(liveOnlySpecBindings(preFixSplit)).toEqual([
      { dir: "plan", basename: "M121.md" },
    ]);
  });

  test("the detector is SILENT on the fixed shape — both literal spellings", () => {
    // The other direction. A detector that fires on everything would pass the
    // test above and prove nothing.
    const fixedSlash = `
      const FR_ACTIVE = join(REPO_ROOT, "specs/frs/STE-446.md");
      const FR_ARCHIVED = join(REPO_ROOT, "specs/frs/archive/STE-446.md");
      const FR_PATH = existsSync(FR_ACTIVE) ? FR_ACTIVE : FR_ARCHIVED;`;
    expect(liveOnlySpecBindings(fixedSlash)).toEqual([]);

    const fixedSplit = `
      const P_A = join(REPO_ROOT, "specs", "plan", "M121.md");
      const P_B = join(REPO_ROOT, "specs", "plan", "archive", "M121.md");
      const PLAN_PATH = existsSync(P_A) ? P_A : P_B;`;
    expect(liveOnlySpecBindings(fixedSplit)).toEqual([]);
  });

  test("a backticked prose mention in a comment is NOT a binding", () => {
    // Guards the one exclusion this detector makes, so a later widening of the
    // quote class cannot silently start flagging documentation.
    const prose =
      "// The authorizing amendment to `specs/frs/STE-448.md` lands ahead of this file.";
    expect(liveOnlySpecBindings(prose)).toEqual([]);
  });
});

// ══════════ AC-STE-459.7 — the six READ the artifact, not skip it ══════════

/**
 * The six files STE-459 repaired, with the artifacts each one binds.
 *
 * Listed explicitly rather than derived: the point of this block is to prove
 * the named repairs resolve to something real, and deriving the list from the
 * same source the detector reads would make it agree with itself.
 */
const REPAIRED: ReadonlyArray<{
  readonly file: string;
  readonly artifacts: ReadonlyArray<{ active: string; archived: string }>;
}> = [
  {
    file: "m121-ste-445-derivation-falsifiability.test.ts",
    artifacts: [
      { active: "specs/plan/M121.md", archived: "specs/plan/archive/M121.md" },
    ],
  },
  {
    file: "m121-ste-446-leg-set-authority.test.ts",
    artifacts: [
      { active: "specs/frs/STE-446.md", archived: "specs/frs/archive/STE-446.md" },
    ],
  },
  {
    file: "m121-ste-452-termination-harness.test.ts",
    artifacts: [
      { active: "specs/frs/STE-452.md", archived: "specs/frs/archive/STE-452.md" },
    ],
  },
  {
    file: "m121-ste-457-mode-none-claim-instruction.test.ts",
    artifacts: [
      { active: "specs/frs/STE-457.md", archived: "specs/frs/archive/STE-457.md" },
      { active: "specs/plan/M121.md", archived: "specs/plan/archive/M121.md" },
    ],
  },
  {
    file: "m121-ste-455-plan-id-equality-correction.test.ts",
    artifacts: [
      { active: "specs/frs/STE-448.md", archived: "specs/frs/archive/STE-448.md" },
    ],
  },
  {
    file: "m121-ste-458-capture-artifact-identity.test.ts",
    artifacts: [
      { active: "specs/frs/STE-458.md", archived: "specs/frs/archive/STE-458.md" },
    ],
  },
];

describe("AC-STE-459.7 — every repaired binding resolves to a real artifact", () => {
  for (const { file, artifacts } of REPAIRED) {
    for (const { active, archived } of artifacts) {
      test(`${file} → ${active} resolves and is non-empty`, () => {
        // Recompute the same conditional the file under repair computes. If the
        // artifact is at neither path, the file's assertions are running against
        // `null` — a fix that stops failing because its guard skips more cleanly
        // is not a fix, and this is what tells the two apart.
        const activeAbs = join(REPO_ROOT, active);
        const archivedAbs = join(REPO_ROOT, archived);
        const resolved = existsSync(activeAbs) ? activeAbs : archivedAbs;

        expect(existsSync(resolved)).toBe(true);
        expect(readFileSync(resolved, "utf8").trim().length).toBeGreaterThan(0);
      });

      test(`${file} → ${active} lives at exactly one of the two paths`, () => {
        // Both present would mean an archive that copied instead of moving, and
        // the conditional would silently prefer the stale live copy.
        const present = [active, archived].filter((p) =>
          existsSync(join(REPO_ROOT, p)),
        );
        expect(present.length).toBe(1);
      });
    }
  }
});

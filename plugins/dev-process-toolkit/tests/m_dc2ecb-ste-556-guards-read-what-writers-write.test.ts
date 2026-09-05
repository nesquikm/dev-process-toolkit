// STE-556 (M_dc2ecb) — the guards read what the writers write, and the docs
// stop overclaiming.
//
// MEASURED at e683bb9:
//
//   probe #9b, codename mutation:
//     '**Latest shipped release:** **v2.80.0 ("Onward")**.'                → []
//     '**Latest shipped release:** **v2.80.0 ("CompletelyWrongCodename")**.' → []
//   Byte-identical. The matcher captured the version alone and swallowed the
//   codename inside `[^\n]*`.
//
//   probe #9b, in-flight token: the private `\bM(\d+)\b` matched nothing on
//   `In-flight milestone: M_dc2ecb`, so the check silently declined to run.
//
//   inferBump([Added, Fixed, Fixed, Removed])
//     → "minor bump: milestone shipped 4 additive FRs"   (one additive FR)
//
//   release_surface_agreement, over a fixture of this milestone's own
//   post-release tree (README naming M_dc2ecb, CHANGELOG carrying v2.80.1,
//   plan stamped shipped_in):
//     parseReadmeLatest        → null
//     findMilestonesForRelease → []
//     violations               → [{ field: "latest_line" }]
//   That is exit 1 from the door /ship-milestone runs before `git add`, so
//   the first milestone minted under M139's tracker-first scheme could not
//   complete its own release ceremony. Discovered during delivery, 2026-09-05.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  checkReleaseSurfaceAgreement,
  findMilestonesForRelease,
  parseReadmeLatest,
} from "../adapters/_shared/src/release_surface_agreement";
import { findVersionFreshnessDrift, runRootHygiene } from "../adapters/_shared/src/root_hygiene";
import { inferBump } from "../adapters/_shared/src/version_bump";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const ROOT_HYGIENE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "root_hygiene.ts");
const SURFACE_AGREEMENT = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "release_surface_agreement.ts",
);
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const SHIP_REFERENCE = join(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");
const REPO_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");

const read = (path: string): string => readFileSync(path, "utf-8");

const dirs: string[] = [];
function makeRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-556-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function importMutant(
  modulePath: string,
  from: string,
  to: string,
  tag: string,
): Promise<Record<string, unknown>> {
  const original = read(modulePath);
  expect(original).toContain(from);
  const mutated = original.replace(from, to);
  expect(mutated).not.toBe(original);
  const path = join(dirname(modulePath), `__mutant_${tag}_${process.pid}_${Date.now()}.ts`);
  writeFileSync(path, mutated);
  try {
    return (await import(path)) as Record<string, unknown>;
  } finally {
    rmSync(path, { force: true });
  }
}

// ---------------------------------------------------------------------------
// AC-STE-556.1 / .2 / .3 — probe #9b grades the codename
// ---------------------------------------------------------------------------

const CHANGELOG = '# Changelog\n\n## [2.80.0] — 2026-09-04 — "Onward"\n\n- x\n';

/** A tree with one Overview line and one CHANGELOG, both under our control. */
function hygieneFixture(overviewLine: string, changelog = CHANGELOG): string {
  return makeRoot({
    "plugin.json": '{ "version": "2.80.0" }\n',
    "CHANGELOG.md": changelog,
    "specs/requirements.md": `# Requirements\n\n## 1. Overview\n\n${overviewLine}\n\n## 2. Next\n`,
  });
}

function drifts(root: string): ReturnType<typeof findVersionFreshnessDrift> {
  return findVersionFreshnessDrift(
    join(root, "specs"),
    join(root, "plugin.json"),
    join(root, "CHANGELOG.md"),
  );
}

describe("AC-STE-556.1 — the codename is captured and compared", () => {
  test("the unmutated line is clean", () => {
    expect(drifts(hygieneFixture('**Latest shipped release:** **v2.80.0 ("Onward")**.'))).toEqual(
      [],
    );
  });

  test("a mutated codename reds, naming both sides", () => {
    const found = drifts(
      hygieneFixture('**Latest shipped release:** **v2.80.0 ("CompletelyWrongCodename")**.'),
    );
    expect(found.map((d) => d.kind)).toEqual(["codename-mismatch"]);
    expect(found[0]!.message).toContain("CompletelyWrongCodename");
    expect(found[0]!.message).toContain("Onward");
    // Reported against the line it read, not against the file at large.
    expect(found[0]!.line).toBe(5);
  });

  test("the version check is unchanged by the widening", () => {
    const found = drifts(hygieneFixture('**Latest shipped release:** **v1.2.3 ("Onward")**.'));
    expect(found.map((d) => d.kind)).toContain("version-mismatch");
  });

  test("runRootHygiene carries the same verdict through", () => {
    const root = hygieneFixture('**Latest shipped release:** **v2.80.0 ("Wrong")**.');
    const report = runRootHygiene(
      join(root, "specs"),
      join(root, "plugin.json"),
      join(root, "CHANGELOG.md"),
    );
    expect(report.freshness.map((d) => d.kind)).toEqual(["codename-mismatch"]);
  });
});

describe("AC-STE-556.2 — the codename check is vacuous where the surface is not", () => {
  test("a line with no codename produces no codename drift", () => {
    expect(drifts(hygieneFixture("Latest shipped release: v2.80.0"))).toEqual([]);
  });

  test("an unquoted parenthetical is not read as a codename", () => {
    // `v1.0.0 (2026-01-01)` is a date. Reading it as a codename would red a
    // project that never had one.
    expect(drifts(hygieneFixture("Latest shipped release: v2.80.0 (2026-09-04)"))).toEqual([]);
  });

  test("a CHANGELOG with no entry for the declared version produces no codename drift", () => {
    const root = hygieneFixture(
      '**Latest shipped release:** **v2.80.0 ("Anything")**.',
      '# Changelog\n\n## [1.0.0] — 2026-01-01 — "Older"\n\n- x\n',
    );
    expect(drifts(root).map((d) => d.kind)).not.toContain("codename-mismatch");
  });

  test("an absent CHANGELOG produces no codename drift", () => {
    const root = makeRoot({
      "plugin.json": '{ "version": "2.80.0" }\n',
      "specs/requirements.md":
        '# Requirements\n\n## 1. Overview\n\n**Latest shipped release:** **v2.80.0 ("Onward")**.\n\n## 2. Next\n',
    });
    expect(
      findVersionFreshnessDrift(
        join(root, "specs"),
        join(root, "plugin.json"),
        join(root, "CHANGELOG.md"),
      ),
    ).toEqual([]);
  });
});

describe("AC-STE-556.3 — one reader owns the CHANGELOG answer", () => {
  test("root_hygiene consumes findChangelogEntry rather than parsing again", () => {
    const src = read(ROOT_HYGIENE);
    expect(src).toContain("findChangelogEntry");
    expect(src).toContain("./release_surface_agreement");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-556.4 — the in-flight token follows the union grammar
// ---------------------------------------------------------------------------

function inFlightFixture(token: string, livePlans: string[]): string {
  const files: Record<string, string> = {
    "plugin.json": '{ "version": "2.80.0" }\n',
    "CHANGELOG.md": CHANGELOG,
    "specs/requirements.md":
      "# Requirements\n\n## 1. Overview\n\n" +
      '**Latest shipped release:** **v2.80.0 ("Onward")**.\n' +
      `In-flight milestone: ${token}\n\n## 2. Next\n`,
  };
  for (const plan of livePlans) files[`specs/plan/${plan}.md`] = `---\nmilestone: ${plan}\n---\n`;
  return makeRoot(files);
}

describe("AC-STE-556.4 — an M_<key> in-flight claim is read", () => {
  test("naming a live plan is green", () => {
    expect(drifts(inFlightFixture("M_dc2ecb", ["M_dc2ecb"]))).toEqual([]);
  });

  test("naming no plan reds with the same kind its numeric sibling produces", () => {
    const epic = drifts(inFlightFixture("M_dc2ecb", []));
    const numeric = drifts(inFlightFixture("M143", []));
    expect(epic.map((d) => d.kind)).toEqual(["in-flight-missing-plan"]);
    expect(numeric.map((d) => d.kind)).toEqual(["in-flight-missing-plan"]);
    expect(epic[0]!.message).toContain("M_dc2ecb");
  });

  test("the numeric leg is unchanged", () => {
    expect(drifts(inFlightFixture("M143", ["M143"]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-556.5 — the two "cannot happen" claims
// ---------------------------------------------------------------------------

const ABSOLUTE_CLAIM = "cannot happen";

describe("AC-STE-556.5 — the absolute claim is gone and stays gone", () => {
  test("neither surface promises the bug class cannot happen", () => {
    expect(read(REPO_CLAUDE_MD)).not.toContain(ABSOLUTE_CLAIM);
    expect(read(SHIP_SKILL)).not.toContain(ABSOLUTE_CLAIM);
  });

  test("both surfaces still say what the block actually guarantees", () => {
    // Not merely deleted: the replacement has to carry the true statement, or
    // a reader loses the guarantee along with the overclaim.
    for (const path of [REPO_CLAUDE_MD, SHIP_SKILL]) {
      const src = read(path);
      expect(src).toContain("Release Files");
      expect(src.toLowerCase()).toContain("by hand");
    }
  });

  test("the tripwire fires when the wording returns", () => {
    // Verified on a fixture copy rather than by trusting the predicate.
    const mutated = read(SHIP_SKILL).replace(
      "Dogfoods the Release Checklist",
      `Partial-update bugs ${ABSOLUTE_CLAIM}. Dogfoods the Release Checklist`,
    );
    expect(mutated).toContain(ABSOLUTE_CLAIM);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-556.6 / .7 — the minor rationale counts additive FRs
// ---------------------------------------------------------------------------

describe("AC-STE-556.6 — the minor rationale counts what it names", () => {
  test("a mixed milestone reports its ADDITIVE count", () => {
    const result = inferBump({
      currentVersion: "1.2.3",
      frs: [
        { title: "a", changelogCategory: "Added" },
        { title: "b", changelogCategory: "Fixed" },
        { title: "c", changelogCategory: "Fixed" },
        { title: "d", changelogCategory: "Removed" },
      ],
    });
    expect(result.version).toBe("1.3.0");
    expect(result.rationale).toBe("minor bump: milestone shipped 1 additive FRs");
    // The measured HEAD sentence, asserted absent.
    expect(result.rationale).not.toContain("4 additive");
  });

  test("an all-additive milestone is byte-identical to today", () => {
    const result = inferBump({
      currentVersion: "1.2.3",
      frs: [
        { title: "a", changelogCategory: "Added" },
        { title: "b", changelogCategory: "Changed" },
        { title: "c", changelogCategory: "Added" },
      ],
    });
    expect(result.rationale).toBe("minor bump: milestone shipped 3 additive FRs");
  });

  test("the empty and patch labels are untouched", () => {
    expect(inferBump({ currentVersion: "1.2.3", frs: [] }).rationale).toBe(
      "default minor bump (no FRs in milestone)",
    );
    expect(
      inferBump({
        currentVersion: "1.2.3",
        frs: [
          { title: "a", changelogCategory: "Fixed" },
          { title: "b", changelogCategory: "Removed" },
        ],
      }).rationale,
    ).toBe("patch bump: milestone contains only fix-class FRs (2)");
  });
});

describe("AC-STE-556.7 — the reference doc matches what the module emits", () => {
  test("it describes the additive count, not the total", () => {
    const doc = read(SHIP_REFERENCE);
    expect(doc).toContain("minor bump: milestone shipped N additive FRs");
    expect(doc).toContain("ADDITIVE");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-556.8 / .9 / .10 — the release guard reads the union grammar
// ---------------------------------------------------------------------------

const EPIC_README =
  'Latest: **v2.80.1 — "Ceremony"** (M_dc2ecb, release ceremony integrity: prose.)\n';
const EPIC_CHANGELOG =
  '# Changelog\n\n## [2.80.1] — 2026-09-05 — "Ceremony"\n\n- x\n\n' +
  '## [2.80.0] — 2026-09-04 — "Onward"\n\n- y\n';
const EPIC_PLANS = [
  {
    path: "specs/plan/archive/M_dc2ecb.md",
    text: "---\nmilestone: M_dc2ecb\nshipped_in: v2.80.1\n---\n",
  },
];

describe("AC-STE-556.8 — this milestone's own post-release tree grades clean", () => {
  test("the banner parses under the union grammar", () => {
    expect(parseReadmeLatest(EPIC_README)).toEqual({
      version: "2.80.1",
      codename: "Ceremony",
      milestone: "M_dc2ecb",
    });
  });

  test("the plan's M_<key> stamp resolves the release", () => {
    expect(findMilestonesForRelease(EPIC_PLANS, "2.80.1")).toEqual(["M_dc2ecb"]);
  });

  test("the plan-FILENAME fallback also reads the union grammar", () => {
    expect(
      findMilestonesForRelease(
        [{ path: "specs/plan/archive/M_dc2ecb.md", text: "---\nshipped_in: v2.80.1\n---\n" }],
        "2.80.1",
      ),
    ).toEqual(["M_dc2ecb"]);
  });

  test("the whole check returns no violations", () => {
    expect(checkReleaseSurfaceAgreement(EPIC_README, EPIC_CHANGELOG, EPIC_PLANS, "2.80.1")).toEqual(
      [],
    );
  });

  test("the numeric leg is unchanged", () => {
    const readme = 'Latest: **v2.80.1 — "Ceremony"** (M143, prose.)\n';
    const plans = [
      { path: "specs/plan/archive/M143.md", text: "---\nmilestone: M143\nshipped_in: v2.80.1\n---\n" },
    ];
    expect(checkReleaseSurfaceAgreement(readme, EPIC_CHANGELOG, plans, "2.80.1")).toEqual([]);
  });

  test("a genuine disagreement still fires under the union grammar", () => {
    // Isolation: the widening must not turn the check vacuous.
    const readme = 'Latest: **v2.80.1 — "WrongName"** (M_dc2ecb, prose.)\n';
    const fields = checkReleaseSurfaceAgreement(readme, EPIC_CHANGELOG, EPIC_PLANS, "2.80.1").map(
      (v) => v.field,
    );
    expect(fields).toEqual(["codename"]);
  });
});

describe("AC-STE-556.9 — the canonical ordering is total over the union", () => {
  const plans = [
    { path: "a.md", text: "---\nmilestone: M_zeta\nshipped_in: v9.9.9\n---\n" },
    { path: "b.md", text: "---\nmilestone: M143\nshipped_in: v9.9.9\n---\n" },
    { path: "c.md", text: "---\nmilestone: M_alpha\nshipped_in: v9.9.9\n---\n" },
    { path: "d.md", text: "---\nmilestone: M9\nshipped_in: v9.9.9\n---\n" },
  ];

  test("numeric ids descend first, then epic keys descend", () => {
    expect(findMilestonesForRelease(plans, "9.9.9")).toEqual(["M143", "M9", "M_zeta", "M_alpha"]);
  });

  test("the order does not depend on the input order", () => {
    const reversed = [...plans].reverse();
    expect(findMilestonesForRelease(reversed, "9.9.9")).toEqual(
      findMilestonesForRelease(plans, "9.9.9"),
    );
  });
});

describe("AC-STE-556.10 — the consumer audit covers the guard", () => {
  test("release_surface_agreement is registered in the STE-335 AC-7 list", () => {
    const audit = read(join(PLUGIN_ROOT, "adapters", "_shared", "src", "milestone_token.test.ts"));
    expect(audit).toContain('"release_surface_agreement.ts"');
  });

  test("and the module really does consume the shared matcher", () => {
    expect(read(SURFACE_AGREEMENT)).toContain("milestone_token");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-556.11 — falsifiability
// ---------------------------------------------------------------------------

describe("AC-STE-556.11 — each repair is load-bearing", () => {
  test("dropping the codename comparison restores the blind probe", async () => {
    const mutant = await importMutant(
      ROOT_HYGIENE,
      "if (entry !== null && entry.codename !== declaredCodename) {",
      "if (false && entry !== null && entry.codename !== declaredCodename) {",
      "ste556_codename",
    );
    const find = mutant.findVersionFreshnessDrift as typeof findVersionFreshnessDrift;
    const root = hygieneFixture('**Latest shipped release:** **v2.80.0 ("Wrong")**.');
    expect(
      find(join(root, "specs"), join(root, "plugin.json"), join(root, "CHANGELOG.md")),
    ).toEqual([]);
  });

  test("restoring the private numeric in-flight token makes the check silent again", async () => {
    const mutant = await importMutant(
      ROOT_HYGIENE,
      "const inFlightRe = new RegExp(String.raw`In-flight milestone:[^\\n]*\\b(${MILESTONE_TOKEN_SOURCE})\\b`);",
      "const inFlightRe = /In-flight milestone:[^\\n]*\\b(M\\d+)\\b/;",
      "ste556_inflight",
    );
    const find = mutant.findVersionFreshnessDrift as typeof findVersionFreshnessDrift;
    const root = inFlightFixture("M_dc2ecb", []);
    // The mutant does not FAIL on the missing plan — it declines to read the
    // claim at all, which is what made the defect invisible.
    expect(find(join(root, "specs"), join(root, "plugin.json"), join(root, "CHANGELOG.md"))).toEqual(
      [],
    );
  });

  test("restoring the private numeric banner token breaks this milestone's ceremony", async () => {
    const mutant = await importMutant(
      SURFACE_AGREEMENT,
      "(?<milestone>${MILESTONE_TOKEN_SOURCE})",
      "(?<milestone>M\\\\d+)",
      "ste556_banner",
    );
    const check = mutant.checkReleaseSurfaceAgreement as typeof checkReleaseSurfaceAgreement;
    expect(check(EPIC_README, EPIC_CHANGELOG, EPIC_PLANS, "2.80.1").map((v) => v.field)).toEqual([
      "latest_line",
    ]);
  });

  test("restoring the NaN sort loses the epic ordering", async () => {
    const mutant = await importMutant(
      SURFACE_AGREEMENT,
      "return found.sort(compareMilestonesDescending);",
      "return found.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));",
      "ste556_sort",
    );
    const find = mutant.findMilestonesForRelease as typeof findMilestonesForRelease;
    const plans = [
      { path: "a.md", text: "---\nmilestone: M_alpha\nshipped_in: v9.9.9\n---\n" },
      { path: "b.md", text: "---\nmilestone: M143\nshipped_in: v9.9.9\n---\n" },
    ];
    // `Number("_alpha")` is NaN, so the comparator orders nothing and the
    // numeric id does not come first.
    expect(find(plans, "9.9.9")).toEqual(["M_alpha", "M143"]);
  });

  test("restoring the total-count label reproduces the false rationale", async () => {
    const mutant = await importMutant(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "version_bump.ts"),
      "`minor bump: milestone shipped ${additive} additive FRs`",
      "`minor bump: milestone shipped ${count} additive FRs`",
      "ste556_additive",
    );
    const infer = mutant.inferBump as typeof inferBump;
    expect(
      infer({
        currentVersion: "1.2.3",
        frs: [
          { title: "a", changelogCategory: "Added" },
          { title: "b", changelogCategory: "Fixed" },
          { title: "c", changelogCategory: "Fixed" },
          { title: "d", changelogCategory: "Removed" },
        ],
      }).rationale,
    ).toBe("minor bump: milestone shipped 4 additive FRs");
  });
});

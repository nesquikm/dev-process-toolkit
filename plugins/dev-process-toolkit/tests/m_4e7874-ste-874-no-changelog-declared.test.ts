// M_4e7874 / STE-874 — probe #63 does not resolve ship stamps against a
// CHANGELOG the project never declared.
//
// THE DEFECT, stated once: `runPlanShipCoherenceProbe` checked every
// `shipped_in: v<X.Y.Z>` stamp against CHANGELOG.md headings without asking
// whether the project's declared release files hold a changelog at all. A
// project that keeps no changelog, and says so, failed on every archived plan
// with `corrupt_stamp`, and nothing could clear it.
//
// THE CONTRACT these tests build to:
//
//   * Release files READABLE and holding NO `kind: changelog` entry (either
//     home: `release.files` in specs/settings.yaml, or the legacy CLAUDE.md
//     `## Release Files` block): the heading lookup is skipped, the stamp is
//     counted, and ONE notes row carries the count and the reason.
//   * Release files that DECLARE a changelog, or that are missing or
//     unreadable: today's behaviour, byte for byte in kind — a stamp with no
//     heading is `corrupt_stamp`, and no skipped-stamps row appears.
//   * The stamp's own format, unshipped debt, the `unreleased` rule, parked
//     plans, the sibling leg and the release-surface leg are untouched.
//
// Every fixture is a mkdtemp tree with invented names, removed in `afterAll`.
//
// Filter by AC with `bun test -t "AC-STE-874.N"`.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { GATE_PROBES, runGateProbes } from "../adapters/_shared/src/gate_probe_runner";
import {
  runPlanShipCoherenceProbe,
  type PlanShipCoherenceReport,
} from "../adapters/_shared/src/plan_ship_coherence";
import { readReleaseFiles } from "../adapters/_shared/src/release_config";
import { classifyResume } from "../adapters/_shared/src/resume_classifier";
import { commitAll, git } from "./_span_fixture";

// The epic-close door spawns git and bun; under full-suite load that exceeds 5 s.
setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const EPIC_CLOSE_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "epic_close.ts");

// ===========================================================================
// Fixture helpers.
// ===========================================================================

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tempRoot(label: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `ste874-${label}-`)));
  ROOTS.push(root);
  return root;
}

function writeAt(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

const PROSE_MD = "# Fixture project\n\nNothing but prose here.\n";

interface ReleaseEntry {
  path: string;
  kind: string;
  field?: string;
}

const JSON_ENTRY: ReleaseEntry = { path: "package.json", kind: "json", field: "version" };
const YAML_ENTRY: ReleaseEntry = { path: "pubspec.yaml", kind: "yaml", field: "version" };
const CHANGELOG_ENTRY: ReleaseEntry = { path: "CHANGELOG.md", kind: "changelog" };

/** A settings file: the header, then `release.files` (omitted when `files` is undefined), then `extra` lines. */
function settingsYaml(files: readonly ReleaseEntry[] | undefined, extra: string[] = []): string {
  return [
    "schema_version: 1",
    'min_dpt_version: "2.0.0"',
    ...(files === undefined ? [] : [`release: ${JSON.stringify({ files })}`]),
    ...extra,
    "",
  ].join("\n");
}

/** A legacy CLAUDE.md whose `## Release Files` section body is `block`, verbatim. */
function legacyMd(block: string[], docs: string[] = []): string {
  return ["# Fixture project", "", ...docs, "## Release Files", "", ...block, "", "## Other", "", "prose", ""].join("\n");
}

/** The fenced payload for `entries`, as the legacy parser reads it. */
function legacyBlock(entries: readonly ReleaseEntry[]): string[] {
  return [
    "```yaml",
    "files:",
    ...entries.flatMap((e) => [
      `  - path: ${e.path}`,
      `    kind: ${e.kind}`,
      ...(e.field === undefined ? [] : [`    field: ${e.field}`]),
    ]),
    "```",
  ];
}

type Home = "settings" | "legacy";
const HOMES: readonly Home[] = ["settings", "legacy"];

/** The non-changelog entry each home's fixtures declare (two kinds, so neither is special-cased). */
const OTHER_ENTRY: Record<Home, ReleaseEntry> = { settings: JSON_ENTRY, legacy: YAML_ENTRY };

/** Declare `entries` as the project's release files in `home`. */
function declareReleaseFiles(root: string, home: Home, entries: readonly ReleaseEntry[]): void {
  if (home === "settings") {
    writeAt(root, "specs/settings.yaml", settingsYaml(entries));
    writeAt(root, "CLAUDE.md", PROSE_MD);
  } else {
    writeAt(root, "CLAUDE.md", legacyMd(legacyBlock(entries)));
  }
}

/** A project whose readable release files hold NO changelog-kind entry. */
function noChangelogProject(label: string, home: Home): string {
  const root = tempRoot(label);
  declareReleaseFiles(root, home, [OTHER_ENTRY[home]]);
  return root;
}

/** The twin: the same project, also declaring a changelog-kind file. */
function changelogProject(label: string, home: Home): string {
  const root = tempRoot(label);
  declareReleaseFiles(root, home, [OTHER_ENTRY[home], CHANGELOG_ENTRY]);
  return root;
}

/** Write an archived plan; `lines` are extra frontmatter lines, verbatim. */
function archivedPlan(root: string, milestone: string, lines: string[], body: string[] = []): void {
  writeAt(
    root,
    `specs/plan/archive/${milestone}.md`,
    [
      "---",
      `milestone: ${milestone}`,
      "status: archived",
      "archived_at: 2026-10-21T00:00:00Z",
      ...lines,
      "---",
      "",
      `# ${milestone}`,
      "",
      ...body,
    ].join("\n"),
  );
}

const changelogWith = (...headings: Array<[version: string, codename: string]>): string =>
  ["# Changelog", "", ...headings.flatMap(([v, c]) => [`## [${v}] — 2026-10-01 — "${c}"`, "", "- something", ""])].join("\n");

// Milestones and stamps are chosen so that no bare `1` or `3` appears in any
// of them: the count assertions below look for the count as a standalone token.
const M_A = "M52";
const M_B = "M54";
const M_C = "M56";
const STAMP_A = "v8.2.0";
const STAMP_B = "v8.4.0";
const STAMP_C = "v8.6.0";

const describeReport = (r: PlanShipCoherenceReport): string =>
  [...r.violations.map((v) => `VIOLATION ${v.kind}: ${v.reason}`), ...r.notes.map((n) => `NOTE ${n}`)].join("\n") || "(clean)";

const kinds = (r: PlanShipCoherenceReport): string[] => r.violations.map((v) => v.kind);

/** The notes rows that speak about a changelog — the skipped-stamps row and nothing else in these fixtures. */
const changelogNotes = (r: PlanShipCoherenceReport): string[] => r.notes.filter((n) => /changelog/i.test(n));

/** `n` as a standalone token: not a digit inside a version, a milestone id or a path. */
const standalone = (n: number): RegExp => new RegExp(String.raw`(?<![\w.\-/])${n}(?![\w.\-/])`);

/** The row says the reason: a negation, about a changelog. */
const NEGATION_RE = /\b(no|not|none|never|without|neither)\b/i;

/** What the release-files reader returns for `root`, or the error it throws. */
function declared(root: string): ReleaseEntry[] | Error {
  try {
    return readReleaseFiles(root, () => readFileSync(join(root, "CLAUDE.md"), "utf-8")) as ReleaseEntry[];
  } catch (e) {
    return e as Error;
  }
}

// ===========================================================================
// AC-STE-874.1 — no changelog declared ⇒ no violation for an unresolved stamp
// ===========================================================================

describe("AC-STE-874.1 — a readable declaration without a changelog skips the heading lookup", () => {
  for (const home of HOMES) {
    test(`AC-STE-874.1: ${home} home, no CHANGELOG.md on disk — a well-formed stamp reports no violation`, async () => {
      const root = noChangelogProject(`ac1-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      // The fixture is the case the AC names: readable, and no changelog kind.
      expect(declared(root)).toEqual([OTHER_ENTRY[home]]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
    });

    test(`AC-STE-874.1: ${home} home, a CHANGELOG.md with other headings only — still no violation`, async () => {
      const root = noChangelogProject(`ac1-stray-${home}`, home);
      writeAt(root, "CHANGELOG.md", changelogWith(["7.0.0", "Elsewhere"]));
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  }

  test("AC-STE-874.1: a declaration of several non-changelog kinds (json + regex) reports no violation", async () => {
    const root = tempRoot("ac1-multi");
    writeAt(
      root,
      "CLAUDE.md",
      legacyMd([
        "```yaml",
        "files:",
        "  - path: package.json",
        "    kind: json",
        "    field: version",
        "  - path: README.md",
        "    kind: regex",
        "    pattern: 'Release (?<version>\\d+\\.\\d+\\.\\d+)'",
        "    replace: 'Release {version}'",
        "```",
      ]),
    );
    const entries = declared(root);
    expect(Array.isArray(entries) ? entries.map((e) => e.kind) : entries).toEqual(["json", "regex"]);
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.violations, describeReport(report)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-874.2 — exactly one notes row: the count, and the reason
// ===========================================================================

describe("AC-STE-874.2 — one notes row names how many stamps were not resolved and why", () => {
  for (const home of HOMES) {
    test(`AC-STE-874.2: ${home} home, one stamped plan — exactly one row, carrying the count 1 and the reason`, async () => {
      const root = noChangelogProject(`ac2-one-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.notes.length, describeReport(report)).toBe(1);
      const row = report.notes[0]!;
      expect(row).toMatch(/changelog/i);
      expect(row).toMatch(NEGATION_RE);
      expect(row).toMatch(standalone(1));
      expect(row).not.toMatch(standalone(3));
    });

    test(`AC-STE-874.2: ${home} home, three stamped plans — still exactly one row, carrying the count 3`, async () => {
      const root = noChangelogProject(`ac2-three-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      archivedPlan(root, M_B, [`shipped_in: ${STAMP_B}`]);
      archivedPlan(root, M_C, [`shipped_in: ${STAMP_C}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.notes.length, describeReport(report)).toBe(1);
      const row = report.notes[0]!;
      expect(row).toMatch(/changelog/i);
      expect(row).toMatch(NEGATION_RE);
      expect(row).toMatch(standalone(3));
      expect(row).not.toMatch(standalone(1));
    });
  }

  test("AC-STE-874.2: the row is one per report, beside the parked row, never one per plan", async () => {
    const root = noChangelogProject("ac2-mixed", "settings");
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    archivedPlan(root, M_B, [`shipped_in: ${STAMP_B}`]);
    archivedPlan(root, M_C, ["shipped_in: null", "ship_state: parked"]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.notes, describeReport(report)).toContain(`parked milestones: ${M_C}`);
    const rows = changelogNotes(report);
    expect(rows.length, describeReport(report)).toBe(1);
    // Two stamps were skipped; the parked plan carries no stamp and is not counted.
    expect(rows[0]!).toMatch(standalone(2));
    expect(report.notes.length, describeReport(report)).toBe(2);
  });

  test("AC-STE-874.2: a stamp whose heading happens to exist in a stray CHANGELOG.md is still counted, not looked up", async () => {
    const root = noChangelogProject("ac2-stray-hit", "settings");
    writeAt(root, "CHANGELOG.md", changelogWith([STAMP_A.slice(1), "Stray"]));
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.violations, describeReport(report)).toEqual([]);
    const rows = changelogNotes(report);
    expect(rows.length, describeReport(report)).toBe(1);
    expect(rows[0]!).toMatch(standalone(1));
  });

  for (const home of HOMES) {
    test(`AC-STE-874.2: ${home} home, zero stamped plans — no row is shown`, async () => {
      const root = noChangelogProject(`ac2-zero-${home}`, home);
      mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(report.notes, describeReport(report)).toEqual([]);
    });
  }

  test("AC-STE-874.2: zero stamped plans beside a parked plan — the parked row alone", async () => {
    const root = noChangelogProject("ac2-zero-parked", "legacy");
    archivedPlan(root, M_A, ["shipped_in: null", "ship_state: parked"]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.notes, describeReport(report)).toEqual([`parked milestones: ${M_A}`]);
  });
});

// ===========================================================================
// AC-STE-874.3 — the regression pair
// ===========================================================================

describe("AC-STE-874.3 — Regression: only a non-changelog file declared passes; the changelog twin still fails", () => {
  for (const home of HOMES) {
    test(`AC-STE-874.3: Regression — ${home} home listing only a non-changelog file, stamp with no CHANGELOG heading, passes`, async () => {
      const root = noChangelogProject(`ac3-pass-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual([]);
    });

    test(`AC-STE-874.3: twin — ${home} home declaring a changelog-kind file, same missing heading, fails corrupt_stamp`, async () => {
      const root = changelogProject(`ac3-fail-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const entries = declared(root);
      expect(Array.isArray(entries) ? entries.map((e) => e.kind) : entries).toContain("changelog");
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.violations[0]!.reason).toContain(STAMP_A);
      expect(report.violations[0]!.reason).toContain(`specs/plan/archive/${M_A}.md`);
      // The lookup ran, so nothing was skipped and nothing is noted.
      expect(report.notes, describeReport(report)).toEqual([]);
    });

    test(`AC-STE-874.3: twin — ${home} home declaring a changelog whose CHANGELOG.md lacks the heading fails corrupt_stamp`, async () => {
      const root = changelogProject(`ac3-fail-other-${home}`, home);
      writeAt(root, "CHANGELOG.md", changelogWith(["7.0.0", "Elsewhere"]));
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.notes, describeReport(report)).toEqual([]);
    });
  }
});

// ===========================================================================
// AC-STE-874.4 — everything else is unchanged
// ===========================================================================

describe("AC-STE-874.4 — the other legs are unchanged under a no-changelog declaration", () => {
  for (const home of HOMES) {
    test(`AC-STE-874.4: ${home} home — a malformed stamp (3.1) still fails corrupt_stamp`, async () => {
      const root = noChangelogProject(`ac4-malformed-${home}`, home);
      archivedPlan(root, M_A, ["shipped_in: 3.1"]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.violations[0]!.reason).toContain("malformed shipped_in stamp");
      expect(report.violations[0]!.reason).toContain("observed: 3.1");
    });

    test(`AC-STE-874.4: ${home} home — a version without the leading v still fails corrupt_stamp`, async () => {
      const root = noChangelogProject(`ac4-nov-${home}`, home);
      archivedPlan(root, M_A, ["shipped_in: 8.2.0"]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
    });

    test(`AC-STE-874.4: ${home} home — an archived plan with neither stamp nor park is still unshipped debt`, async () => {
      const root = noChangelogProject(`ac4-debt-${home}`, home);
      archivedPlan(root, M_A, ["shipped_in: null"]);
      archivedPlan(root, M_B, []);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["unshipped_debt", "unshipped_debt"]);
    });

    test(`AC-STE-874.4: ${home} home — \`unreleased\` without changelog_unversioned still fails corrupt_stamp`, async () => {
      const root = noChangelogProject(`ac4-unreleased-${home}`, home);
      archivedPlan(root, M_A, ["shipped_in: unreleased"]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.violations[0]!.reason).toContain("observed: unreleased");
    });

    test(`AC-STE-874.4: ${home} home — a parked plan still passes with the parked row`, async () => {
      const root = noChangelogProject(`ac4-parked-${home}`, home);
      archivedPlan(root, M_A, ["shipped_in: null", "ship_state: parked"]);
      archivedPlan(root, M_B, ["ship_state: parked"]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(report.notes, describeReport(report)).toEqual([`parked milestones: ${M_A}, ${M_B}`]);
    });
  }

  test("AC-STE-874.4: a malformed stamp fails beside a well-formed one that passes", async () => {
    const root = noChangelogProject("ac4-malformed-mixed", "settings");
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    archivedPlan(root, M_B, ["shipped_in: vNext"]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
    expect(report.violations[0]!.file).toContain(`${M_B}.md`);
  });

  test("AC-STE-874.4: sibling leg — a stamped spanning plan is still handed to it under a no-changelog declaration", async () => {
    const root = noChangelogProject("ac4-sibling", "settings");
    // A flow list is a malformed `spans_repos:` declaration: the sibling leg's own row.
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`, "spans_repos: [alder-web, alder-api]"]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(kinds(report), describeReport(report)).toEqual(["sibling_unshipped"]);
    expect(report.violations[0]!.reason).toContain("malformed spans_repos");
  });

  test("AC-STE-874.4: sibling leg — the same plan under a declared changelog with its heading reports the same row", async () => {
    const root = changelogProject("ac4-sibling-twin", "settings");
    writeAt(root, "CHANGELOG.md", changelogWith([STAMP_A.slice(1), "Fixture"]));
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`, "spans_repos: [alder-web, alder-api]"]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(kinds(report), describeReport(report)).toEqual(["sibling_unshipped"]);
    expect(report.violations[0]!.reason).toContain("malformed spans_repos");
    expect(report.notes, describeReport(report)).toEqual([]);
  });

  test("AC-STE-874.4: release-surface leg — a README banner that disagrees with the CHANGELOG entry still reports surface_disagreement", async () => {
    const root = noChangelogProject("ac4-surface", "settings");
    writeAt(root, "CHANGELOG.md", changelogWith([STAMP_A.slice(1), "Right"]));
    writeAt(root, "README.md", `# Fixture\n\nSee the history. Latest: **${STAMP_A} — "Wrong"** (${M_A}, a sentence.)\n`);
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(kinds(report), describeReport(report)).toEqual(["surface_disagreement"]);
    expect(report.violations[0]!.reason).toContain("codename");
  });

  for (const home of HOMES) {
    test(`AC-STE-874.4: ${home} home declaring a changelog — a stamp whose heading exists passes with no row`, async () => {
      const root = changelogProject(`ac4-resolves-${home}`, home);
      writeAt(root, "CHANGELOG.md", changelogWith([STAMP_A.slice(1), "Fixture"]));
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(report.notes, describeReport(report)).toEqual([]);
    });
  }
});

describe("AC-STE-874.4 — missing or unreadable release files keep today's behaviour", () => {
  /** Each tree's release files cannot be read; `build` writes everything but the plan. */
  const UNREADABLE: Array<{ label: string; slug: string; build: (root: string) => void }> = [
    {
      label: "no settings file and no `## Release Files` block (prose CLAUDE.md)",
      slug: "none-prose",
      build: (root) => writeAt(root, "CLAUDE.md", PROSE_MD),
    },
    {
      label: "no settings file and no CLAUDE.md at all",
      slug: "none-bare",
      build: () => {},
    },
    {
      label: "settings file with no `release` section",
      slug: "settings-absent",
      build: (root) => {
        writeAt(root, "specs/settings.yaml", settingsYaml(undefined));
        writeAt(root, "CLAUDE.md", PROSE_MD);
      },
    },
    {
      label: "settings file whose `release.files` has zero entries",
      slug: "settings-zero",
      build: (root) => {
        writeAt(root, "specs/settings.yaml", settingsYaml([]));
        writeAt(root, "CLAUDE.md", PROSE_MD);
      },
    },
    {
      label: "settings file with an entry of an invalid kind",
      slug: "settings-badkind",
      build: (root) => {
        writeAt(root, "specs/settings.yaml", settingsYaml([{ path: "setup.cfg", kind: "ini", field: "version" }]));
        writeAt(root, "CLAUDE.md", PROSE_MD);
      },
    },
    {
      label: "settings file with an entry missing its `kind`",
      slug: "settings-nokind",
      build: (root) => {
        writeAt(root, "specs/settings.yaml", `${settingsYaml(undefined)}release: {"files": [{"path": "package.json"}]}\n`);
        writeAt(root, "CLAUDE.md", PROSE_MD);
      },
    },
    {
      label: "settings file that is not valid YAML",
      slug: "settings-broken",
      build: (root) => {
        writeAt(root, "specs/settings.yaml", `${settingsYaml(undefined)}release: {"files": [\n`);
        writeAt(root, "CLAUDE.md", PROSE_MD);
      },
    },
    {
      label: "legacy block with no fence around its payload",
      slug: "legacy-nofence",
      build: (root) => writeAt(root, "CLAUDE.md", legacyMd(legacyBlock([YAML_ENTRY]).slice(1, -1))),
    },
    {
      label: "legacy block whose fence never closes",
      slug: "legacy-unclosed",
      build: (root) =>
        writeAt(root, "CLAUDE.md", ["# Fixture project", "", "## Release Files", "", ...legacyBlock([YAML_ENTRY]).slice(0, -1), ""].join("\n")),
    },
    {
      label: "legacy block with zero entries",
      slug: "legacy-zero",
      build: (root) => writeAt(root, "CLAUDE.md", legacyMd(["```yaml", "files: []", "```"])),
    },
    {
      label: "legacy block with an entry of an invalid kind",
      slug: "legacy-badkind",
      build: (root) => writeAt(root, "CLAUDE.md", legacyMd(legacyBlock([{ path: "setup.cfg", kind: "ini" }]))),
    },
    {
      label: "legacy block with a json entry missing its `field`",
      slug: "legacy-nofield",
      build: (root) => writeAt(root, "CLAUDE.md", legacyMd(legacyBlock([{ path: "package.json", kind: "json" }]))),
    },
  ];

  for (const { label, slug, build } of UNREADABLE) {
    test(`AC-STE-874.4: ${label} — a stamp with no CHANGELOG heading still fails corrupt_stamp, with no skipped-stamps row`, async () => {
      const root = tempRoot(`ac4-${slug}`);
      build(root);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      // The fixture is what it claims: the reader that exists today refuses it.
      expect(declared(root)).toBeInstanceOf(Error);
      const report = await runPlanShipCoherenceProbe(root);
      expect(kinds(report), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.violations[0]!.reason).toContain(`has no matching ## [${STAMP_A.slice(1)}] heading`);
      expect(report.notes, describeReport(report)).toEqual([]);
    });
  }

  test("AC-STE-874.4: missing release files — a stamp whose heading exists still passes with no row", async () => {
    const root = tempRoot("ac4-none-resolves");
    writeAt(root, "CLAUDE.md", PROSE_MD);
    writeAt(root, "CHANGELOG.md", changelogWith([STAMP_A.slice(1), "Fixture"]));
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.violations, describeReport(report)).toEqual([]);
    expect(report.notes, describeReport(report)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-874.5 — the readers of this probe's verdict agree with it
// ===========================================================================

describe("AC-STE-874.5 — every reader of the probe's stamp-versus-CHANGELOG verdict agrees on the AC.3 pair", () => {
  // ---- the resume classifier ------------------------------------------------

  /** The AC.3 tree, plus what the classifier reads: a tasks section and the FR directories. */
  function resumeTree(root: string): void {
    archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`], ["## Tasks", "", "- [x] task one", ""]);
    mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  }

  for (const home of HOMES) {
    test(`AC-STE-874.5: resume classifier, ${home} home, no changelog declared — the shipped milestone carries no coherence violation`, async () => {
      const root = noChangelogProject(`ac5-resume-pass-${home}`, home);
      resumeTree(root);
      const c = await classifyResume(root, M_A);
      expect(c.state).toBe("shipped");
      expect(c.shippedIn).toBe(STAMP_A);
      expect(c.shipCoherenceViolations).toEqual([]);
    });

    test(`AC-STE-874.5: resume classifier, ${home} home, changelog declared — the same milestone still carries the corrupt-stamp message`, async () => {
      const root = changelogProject(`ac5-resume-fail-${home}`, home);
      resumeTree(root);
      const c = await classifyResume(root, M_A);
      expect(c.shipCoherenceViolations.length).toBe(1);
      expect(c.shipCoherenceViolations[0]!).toContain("(corrupt stamp)");
      expect(c.shipCoherenceViolations[0]!).toContain(STAMP_A);
    });
  }

  // ---- the gate probe runner (row #63) ----------------------------------------

  const PROBE_63 = GATE_PROBES.filter((e) => e.n === 63);

  test("AC-STE-874.5: gate probe runner — the table holds exactly one probe #63, plan_ship_coherence", () => {
    expect(PROBE_63.map((e) => e.id)).toEqual(["plan_ship_coherence"]);
  });

  for (const home of HOMES) {
    test(`AC-STE-874.5: gate probe runner, ${home} home, no changelog declared — row #63 does not fail`, async () => {
      const root = noChangelogProject(`ac5-runner-pass-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const run = await runGateProbes(root, PROBE_63);
      expect(run.rows.length).toBe(1);
      expect(run.rows[0]!).toContain("probe #63 plan_ship_coherence");
      expect(run.rows[0]!).not.toContain("fail");
      expect(run.exitCode).toBe(0);
    });

    test(`AC-STE-874.5: gate probe runner, ${home} home, changelog declared — row #63 still fails with one violation`, async () => {
      const root = changelogProject(`ac5-runner-fail-${home}`, home);
      archivedPlan(root, M_A, [`shipped_in: ${STAMP_A}`]);
      const run = await runGateProbes(root, PROBE_63);
      expect(run.rows).toEqual(["probe #63 plan_ship_coherence: fail (1)"]);
      expect(run.exitCode).toBe(1);
    });
  }

  // ---- the Epic close door ----------------------------------------------------

  const EPIC = "QZ-52";
  const EPIC_MILESTONE = "M_QZ_52";
  const CHILD = "QZ-53";
  const SESSION = "s-874-close";
  const RECEIPT_PREFIX = "dpt-receipt: ";

  interface DoorRun {
    exitCode: number;
    stdout: string;
    stderr: string;
  }

  const show = (r: DoorRun): string => `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

  /**
   * The AC.3 tree as a committed repository that planned and shipped the
   * Epic's milestone, with one done child; then the REAL epic_close.ts door.
   */
  function closeEpicIn(root: string): DoorRun {
    archivedPlan(root, EPIC_MILESTONE, [`shipped_in: ${STAMP_A}`]);
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
    const scratch = tempRoot("ac5-close-scratch");
    const listing = join(scratch, "children.json");
    writeFileSync(
      listing,
      JSON.stringify({
        issues: [
          {
            key: CHILD,
            fields: {
              summary: `Child ${CHILD}`,
              status: { name: "Done", statusCategory: { key: "done" } },
              issuetype: { name: "Task" },
              project: { key: "QZ" },
              labels: [],
              parent: { key: EPIC },
            },
          },
        ],
        isLast: true,
      }),
    );
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.CLAUDE_PROJECT_DIR;
    env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
    env.CLAUDE_CODE_SESSION_ID = SESSION;
    const p = Bun.spawnSync([process.execPath, "run", EPIC_CLOSE_PATH, root, EPIC, "--children", listing], {
      cwd: scratch,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
  }

  for (const home of HOMES) {
    test(`AC-STE-874.5: epic close, ${home} home, no changelog declared — the shipped milestone's Epic closes`, () => {
      const root = noChangelogProject(`ac5-close-pass-${home}`, home);
      const run = closeEpicIn(root);
      expect(run.stderr, show(run)).not.toContain("corrupt stamp");
      expect(run.exitCode, show(run)).toBe(0);
      expect(run.stdout.split("\n").filter((l) => l.startsWith(RECEIPT_PREFIX)).length, show(run)).toBe(1);
    });

    test(`AC-STE-874.5: epic close, ${home} home, changelog declared — the close is still refused on the corrupt stamp`, () => {
      const root = changelogProject(`ac5-close-fail-${home}`, home);
      const run = closeEpicIn(root);
      expect(run.exitCode, show(run)).not.toBe(0);
      expect(run.stderr, show(run)).toContain(`has no matching ## [${STAMP_A.slice(1)}] heading`);
      expect(run.stdout, show(run)).not.toContain(RECEIPT_PREFIX);
    });
  }
});

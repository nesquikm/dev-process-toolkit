// STE-546 (M141) — CORRECTION ROUND.
//
// The milestone-level spec-review audit found six defects in the shipped
// implementation of STE-546 plus one false statement in its own ceremony prose.
// Each was reproduced against the tree before this file was written; the
// measurements are recorded at the head of each section rather than quoted.
//
// The three test-internal corrections (an over-broad slice, a one-sided ordering
// pin, an unmeasured byte claim) are applied IN PLACE in
// `tests/m141-ste-546-surface-agreement.test.ts`. This file carries the
// mutation proof for the two region extractors those pins now share, so a
// corrected pin is not merely narrower but still able to fail for its real
// reason — and, for the ordering pin, able to fail in the direction the old
// form could not see.
//
// ---------------------------------------------------------------------------
// RED-state until the following land:
//
//   G1  `runReleaseSurfaceAgreement` must go vacuous on a project that declares
//       `changelog_ci_owned: true`. Measured: `release_config.ts` skips every
//       `kind: changelog` entry for such a project, so after the bump there is
//       no `## [<newVersion>]` heading; the step-7 agreement check then returns
//       a `field: "changelog"` row and exits 1, and `skills/ship-milestone`
//       aborts the release before `git add`. A CI-owned CHANGELOG is a surface
//       the consumer never adopted — the FR's own Requirement forbids failing
//       them for it.
//
//   G2  A CHANGELOG whose NEWEST heading carries no codename must not produce a
//       `version` row. Measured: `parseChangelogEntries` requires `— "Codename"`
//       while probe #63's sibling reader `readChangelogVersions` does not, so
//       the probe derives its subject from an OLDER release and accuses a
//       perfectly current README of being stale. Three false rows, measured.
//       The OUTCOME is pinned, not a remedy: unifying the grammar and treating
//       an unparseable newest entry as vacuity both satisfy these legs.
//
//   G6  Probe #63's documented vacuity clause says "at least one plan carrying
//       a `shipped_in:` stamp"; the implementation additionally rejects the
//       `shipped_in: null` template sentinel. Edit the row IN PLACE.
//
//   EXIT  `skills/ship-milestone/SKILL.md` documents exit 0 as covering "no
//       entry matching that version". Measured FALSE — the door exits 1. The
//       leg below captures the real exit codes from a subprocess and holds the
//       prose to them; either side may move.
//
// BUDGETS re-measured this session, by this file where it can:
//   skills/gate-check/SKILL.md      353 lines by split("\n") against a 354 cap
//                                   → ONE line of headroom, not two.
//   skills/ship-milestone/SKILL.md  281 lines against a 358 cap.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkReleaseSurfaceAgreement,
  runReleaseSurfaceAgreement,
  type AgreementViolation,
} from "../adapters/_shared/src/release_surface_agreement";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { DISK_SECTION_BANNER, checkPortion, shipCeremonyWindow } from "./_release_surface_regions";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const MODULE_KEY = "adapters/_shared/src/release_surface_agreement.ts";
const MODULE = join(PLUGIN_ROOT, MODULE_KEY);
const RELEASE_CONFIG = join(PLUGIN_ROOT, "adapters", "_shared", "src", "release_config.ts");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const SIBLING_TEST = join(PLUGIN_ROOT, "tests", "m141-ste-546-surface-agreement.test.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

const fieldsOf = (rows: AgreementViolation[]): string[] => rows.map((r) => r.field).sort();
const describeRows = (rows: AgreementViolation[]): string =>
  rows.map((r) => `  - ${r.field}: ${r.detail}`).join("\n") || "  (none)";

// ---------------------------------------------------------------------------
// Fixture vocabulary — one-condition deltas, built from named parts.
// ---------------------------------------------------------------------------

const banner = (version: string, codename: string, milestone: string): string =>
  `Latest: **v${version} — "${codename}"** (${milestone}, a sentence about the release.)`;

const readmeWith = (latestLine: string): string =>
  ["# Fixture", "", "## Release Notes", "", `See CHANGELOG.md for history. ${latestLine}`, ""].join(
    "\n",
  );

const readmeNoBanner = ["# Fixture", "", "A project that never adopted the banner.", ""].join("\n");

/** `codename: null` writes a heading in the grammar probe #63's sibling reader accepts. */
const heading = (version: string, date: string, codename: string | null): string =>
  codename === null ? `## [${version}] — ${date}` : `## [${version}] — ${date} — "${codename}"`;

interface Entry {
  readonly version: string;
  readonly date: string;
  readonly codename: string | null;
}

const changelogWith = (...entries: Entry[]): string =>
  [
    "# Changelog",
    "",
    ...entries.flatMap((e) => [heading(e.version, e.date, e.codename), "", "### Changed", "", "- something", ""]),
  ].join("\n");

const planText = (milestone: string, shippedIn: string): string =>
  ["---", `milestone: ${milestone}`, "status: archived", `shipped_in: ${shippedIn}`, "---", "", `# ${milestone}`, ""].join(
    "\n",
  );

const RELEASE_FILES_BLOCK = [
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: plugin.json",
  "    kind: json",
  "    field: version",
  "  - path: CHANGELOG.md",
  "    kind: changelog",
  "  - path: README.md",
  "    kind: regex",
  `    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — '`,
  "    replace: 'Latest: **v{version} — '",
  "```",
  "",
].join("\n");

const docsBlock = (ciOwned: boolean): string =>
  ["## Docs", "", "user_facing_mode: false", "packages_mode: false", `changelog_ci_owned: ${ciOwned}`, ""].join("\n");

const dirs: string[] = [];

function writeInto(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, body);
  }
}

interface ProjectSpec {
  readonly readme: string;
  readonly changelog: string;
  readonly version: string;
  /** `undefined` writes NO `## Docs` block at all; `null` writes no CLAUDE.md at all. */
  readonly changelogCiOwned?: boolean | null;
  readonly archivePlans?: Record<string, string>;
}

function makeProject(spec: ProjectSpec): string {
  const root = mkdtempSync(join(tmpdir(), "ste-546-corr-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "plugin.json": JSON.stringify({ name: "fixture", version: spec.version }, null, 2) + "\n",
    "README.md": spec.readme,
    "CHANGELOG.md": spec.changelog,
  };
  if (spec.changelogCiOwned !== null) {
    files["CLAUDE.md"] = [
      "# Fixture project",
      "",
      spec.changelogCiOwned === undefined ? "" : docsBlock(spec.changelogCiOwned),
      RELEASE_FILES_BLOCK,
    ].join("\n");
  }
  for (const [m, text] of Object.entries(spec.archivePlans ?? {})) {
    files[`specs/plan/archive/${m}.md`] = text;
  }
  writeInto(root, files);
  return root;
}

function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function spawn(script: string, args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? -1,
  };
}

const runDoor = (...args: string[]): Run => spawn(MODULE, args);

/** Runs the real bump — the same command `skills/ship-milestone` step 7 runs. */
function applyBump(root: string, version: string, codename: string): Run {
  return spawn(RELEASE_CONFIG, [
    root,
    version,
    "--codename",
    codename,
    "--date",
    "2026-02-02",
    "--body",
    "- something",
    "--test-count",
    "10,0,0",
  ]);
}

// ===========================================================================
// G1 — a CI-owned CHANGELOG is a surface the consumer never adopted
// ===========================================================================
//
// MEASURED before this file existed, on a fixture declaring
// `changelog_ci_owned: true`:
//
//     rewrote plugin.json
//     rewrote README.md
//     skipped CHANGELOG.md (changelog_ci_owned: true)
//     $ bun run release_surface_agreement.ts <root> 2.0.0
//     changelog: CHANGELOG.md has no `## [2.0.0] — <date> — "<Codename>"` heading, …
//     exit=1
//
// `skills/ship-milestone/SKILL.md`: "On exit `1`, abort before `git add`". So a
// consumer whose CI owns the CHANGELOG cannot complete a release at all.

interface CiFixture {
  readonly root: string;
  readonly bump: Run;
}

/** Builds the pre-bump tree, then runs the real bump — the ceremony, in miniature. */
function bumpedProject(changelogCiOwned: boolean | undefined | null): CiFixture {
  const root = makeProject({
    version: "1.9.0",
    changelogCiOwned,
    readme: readmeWith(banner("1.9.0", "Old", "M10")),
    changelog: changelogWith({ version: "1.9.0", date: "2026-01-01", codename: "Old" }),
    archivePlans: { M10: planText("M10", "v1.9.0") },
  });
  return { root, bump: applyBump(root, "2.0.0", "New") };
}

describe("G1 — `changelog_ci_owned: true` is vacuity, not a violation", () => {
  test("the fixture is the shape the defect needs: the bump really skips the CHANGELOG", () => {
    // Control. Without this, the vacuity leg below could pass on a tree whose
    // CHANGELOG the bump had happily written — i.e. on nothing.
    const { root, bump } = bumpedProject(true);
    expect(bump.exitCode, `${bump.stdout}\n${bump.stderr}`).toBe(0);
    expect(bump.stdout).toContain("skipped CHANGELOG.md");
    expect(read(join(root, "CHANGELOG.md"))).not.toContain("## [2.0.0]");
    expect(read(join(root, "README.md"))).toContain("Latest: **v2.0.0 — ");
    cleanup();
  });

  test("the agreement check yields ZERO rows on a CI-owned project", async () => {
    const { root } = bumpedProject(true);
    const rows = await runReleaseSurfaceAgreement(root, "2.0.0");
    expect(
      rows,
      "a project whose CI owns the CHANGELOG is failed for a surface it never adopted:\n" +
        describeRows(rows),
    ).toEqual([]);
    cleanup();
  });

  test("the ceremony's own door exits 0 there, so the release can be committed", () => {
    const { root } = bumpedProject(true);
    const run = runDoor(root, "2.0.0");
    expect(
      run.exitCode,
      "exit 1 aborts /ship-milestone before `git add`, so a CI-owned consumer cannot " +
        `release at all:\n${run.stdout}${run.stderr}`,
    ).toBe(0);
    cleanup();
  });

  test("probe #63 stays silent on that same tree", async () => {
    // The probe calls `runReleaseSurfaceAgreement(projectRoot)` with no version,
    // so it grades the bumped banner against the newest entry the CI-owned
    // CHANGELOG still carries — the PREVIOUS release. Same defect, gate-side.
    const { root } = bumpedProject(true);
    const { violations } = await runPlanShipCoherenceProbe(root);
    const surface = violations.filter((v) => v.reason.includes("release surfaces disagree"));
    expect(
      surface.map((v) => v.reason),
      "the gate accuses a CI-owned consumer of a stale banner",
    ).toEqual([]);
    cleanup();
  });

  test("POSITIVE CONTROL — with `changelog_ci_owned: false` a stale banner is still a violation", async () => {
    // The fix must not be "go silent whenever the changelog is missing". Here the
    // bump DID write `## [2.0.0] — … — "New"` while the README's `kind: regex`
    // entry rewrote the version only: the shipped defect, undimmed.
    const { root, bump } = bumpedProject(false);
    expect(bump.stdout, bump.stderr).toContain("rewrote CHANGELOG.md");
    const rows = await runReleaseSurfaceAgreement(root, "2.0.0");
    expect(fieldsOf(rows), describeRows(rows)).toContain("codename");
    expect(runDoor(root, "2.0.0").exitCode).not.toBe(0);
    cleanup();
  });

  test("POSITIVE CONTROL — a NON-CI project with no entry for the version still reports `changelog`", async () => {
    const root = makeProject({
      version: "1.9.0",
      changelogCiOwned: false,
      readme: readmeWith(banner("2.0.0", "New", "M11")),
      changelog: changelogWith({ version: "1.9.0", date: "2026-01-01", codename: "Old" }),
      archivePlans: { M10: planText("M10", "v1.9.0") },
    });
    const rows = await runReleaseSurfaceAgreement(root, "2.0.0");
    expect(fieldsOf(rows), describeRows(rows)).toContain("changelog");
    cleanup();
  });

  test("POSITIVE CONTROL — a `## Docs` block that is absent entirely behaves as `false`", async () => {
    const { root } = bumpedProject(undefined);
    const rows = await runReleaseSurfaceAgreement(root, "2.0.0");
    expect(fieldsOf(rows), describeRows(rows)).toContain("codename");
    cleanup();
  });

  test("a project with NO CLAUDE.md at all is still graded, not crashed and not silenced", async () => {
    // The CI declaration lives in CLAUDE.md, which a graded tree need not have.
    // Reading it must not turn "no manifest" into either a throw or a free pass.
    const root = makeProject({
      version: "2.0.0",
      changelogCiOwned: null,
      readme: readmeWith(banner("2.0.0", "Prior", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    const rows = await runReleaseSurfaceAgreement(root, "2.0.0");
    expect(fieldsOf(rows), describeRows(rows)).toEqual(["codename"]);
    cleanup();
  });
});

// ===========================================================================
// G2 — divergent CHANGELOG grammars make probe #63 accuse the wrong surface
// ===========================================================================
//
// MEASURED on a changelog whose newest heading is `## [2.0.0] — 2026-02-02`
// (no codename) over an older `## [1.9.0] — … — "Old"`, with a README that
// correctly names v2.0.0:
//
//     version:   README "Latest:" names v2.0.0; the release being graded is v1.9.0.
//     codename:  … v1.9.0's CHANGELOG entry is "Old".
//     milestone: … v2.0.0 shipped M10.       ← three FALSE rows
//
// Probe #63's own archive walk reads `## [2.0.0]` fine (`readChangelogVersions`
// accepts a codename-less heading); only the agreement half cannot see it.

const CODENAMELESS_NEWEST = changelogWith(
  { version: "2.0.0", date: "2026-02-02", codename: null },
  { version: "1.9.0", date: "2026-01-01", codename: "Old" },
);

function codenamelessProject(): string {
  return makeProject({
    version: "2.0.0",
    changelogCiOwned: false,
    readme: readmeWith(banner("2.0.0", "New", "M11")),
    changelog: CODENAMELESS_NEWEST,
    archivePlans: { M11: planText("M11", "v2.0.0"), M10: planText("M10", "v1.9.0") },
  });
}

describe("G2 — a codename-less newest heading is not evidence the README is stale", () => {
  test("the fixture really is the divergent-grammar shape (text-level, remedy-agnostic)", () => {
    // Asserted on the RAW TEXT, not on `parseChangelogEntries`: unifying the
    // grammar is one of the legitimate remedies, and this control must survive it.
    const headings = CODENAMELESS_NEWEST.split("\n").filter((l) => l.startsWith("## ["));
    expect(headings[0]).toBe("## [2.0.0] — 2026-02-02");
    expect(headings[0]).not.toContain('"');
    expect(headings[1]).toContain('"Old"');
    // And probe #63's sibling reader accepts it — the disagreement is real.
    expect(/^##\s*\[(\d+\.\d+\.\d+)\]/.exec(headings[0]!)?.[1]).toBe("2.0.0");
  });

  test("no false `version` row: the README is current, the CHANGELOG is merely behind", async () => {
    const root = codenamelessProject();
    const rows = await runReleaseSurfaceAgreement(root);
    expect(
      fieldsOf(rows),
      "the check derived its subject from an OLDER release and accused the README of " +
        `naming a version it does not:\n${describeRows(rows)}`,
    ).not.toContain("version");
    cleanup();
  });

  test("probe #63 emits no stale-banner accusation there either", async () => {
    const root = codenamelessProject();
    const { violations } = await runPlanShipCoherenceProbe(root);
    const accusations = violations.filter((v) => v.reason.includes("disagree on version"));
    expect(accusations.map((v) => v.reason)).toEqual([]);
    cleanup();
  });

  test("POSITIVE CONTROL — a genuinely stale banner over a well-formed CHANGELOG still fires", async () => {
    // The fix cannot be "stop emitting `version` rows". Same two releases, both
    // codenamed, README left behind on the older one.
    const root = makeProject({
      version: "2.0.0",
      changelogCiOwned: false,
      readme: readmeWith(banner("1.9.0", "Old", "M10")),
      changelog: changelogWith(
        { version: "2.0.0", date: "2026-02-02", codename: "New" },
        { version: "1.9.0", date: "2026-01-01", codename: "Old" },
      ),
      archivePlans: { M11: planText("M11", "v2.0.0"), M10: planText("M10", "v1.9.0") },
    });
    const rows = await runReleaseSurfaceAgreement(root);
    expect(fieldsOf(rows), describeRows(rows)).toContain("version");
    cleanup();
  });

  test("POSITIVE CONTROL — the in-memory check still grades a named version by match", () => {
    // Guards the `version` comparison itself, independent of subject derivation.
    const rows = checkReleaseSurfaceAgreement(
      readmeWith(banner("1.9.0", "Old", "M10")),
      changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      [{ path: "specs/plan/archive/M11.md", text: planText("M11", "v2.0.0") }],
      "2.0.0",
    );
    expect(fieldsOf(rows)).toContain("version");
  });
});

// ===========================================================================
// EXIT CODES — the ceremony prose, held to what the door really returns
// ===========================================================================
//
// `skills/ship-milestone/SKILL.md` step 7: "Exit `0`: … or the check is vacuous
// (no banner, or no entry matching that version, or no plan stamped with it)."
//
// MEASURED: the middle clause is FALSE. A banner present, plans stamped, and no
// `## [<version>]` heading returns a `field: "changelog"` row and exits 1. The
// legs below capture each condition's exit code from a SUBPROCESS — never
// transcribed — and hold the sentence to it. Either side may move: delete the
// clause, or make the door vacuous there.

const EXIT_ZERO_SENTENCE_RE = /^Exit `0`:.*$/m;

function exitZeroSentence(): string {
  const m = EXIT_ZERO_SENTENCE_RE.exec(read(SHIP_SKILL).replace(/\r\n/g, "\n"));
  if (m === null) {
    throw new Error(
      "no `Exit `0`:` sentence in skills/ship-milestone/SKILL.md — the prose this leg " +
        "grades does not exist, so a passing verdict would be vacuous.",
    );
  }
  return m[0]!;
}

/** Vacuity condition 1: the README carries no banner marker. */
const noBannerRoot = (): string =>
  makeProject({
    version: "2.0.0",
    changelogCiOwned: false,
    readme: readmeNoBanner,
    changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
    archivePlans: { M11: planText("M11", "v2.0.0") },
  });

/** The disputed clause: banner and stamps present, no entry for the graded version. */
const noEntryRoot = (): string =>
  makeProject({
    version: "1.9.0",
    changelogCiOwned: false,
    readme: readmeWith(banner("2.0.0", "New", "M11")),
    changelog: changelogWith({ version: "1.9.0", date: "2026-01-01", codename: "Old" }),
    archivePlans: { M10: planText("M10", "v1.9.0") },
  });

/** Vacuity condition 3: no plan carries a real shipped stamp. */
const noStampRoot = (): string =>
  makeProject({
    version: "2.0.0",
    changelogCiOwned: false,
    readme: readmeWith(banner("2.0.0", "Prior", "M11")),
    changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
    archivePlans: { M11: planText("M11", "null") },
  });

describe("the documented exit codes, graded against a real subprocess", () => {
  test("the sentence exists and names at least one vacuity condition", () => {
    const sentence = exitZeroSentence();
    expect(sentence).toMatch(/vacuous/i);
    expect(sentence).toMatch(/no banner|no plan stamped|no entry/i);
  });

  test("`no banner` — documented exit 0, and the door agrees", () => {
    const run = runDoor(noBannerRoot(), "2.0.0");
    expect(/no banner/i.test(exitZeroSentence())).toBe(run.exitCode === 0);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    cleanup();
  });

  test("`no plan stamped with it` — documented exit 0, and the door agrees", () => {
    // `shipped_in: null` is the template sentinel, so no plan carries a REAL
    // stamp: vacuity condition 3, on a tree whose banner is otherwise stale.
    const run = runDoor(noStampRoot(), "2.0.0");
    expect(/no plan stamped/i.test(exitZeroSentence())).toBe(run.exitCode === 0);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    cleanup();
  });

  test("`no entry matching that version` — the prose must match the measured exit code", () => {
    const run = runDoor(noEntryRoot(), "2.0.0");
    const claimed = /no entry matching that version/i.test(exitZeroSentence());
    expect(
      claimed,
      `skills/ship-milestone/SKILL.md documents this condition as exit 0; the door exited ` +
        `${run.exitCode}. Either drop the clause or make the door vacuous there.\n` +
        `stdout=${run.stdout}\nstderr=${run.stderr}`,
    ).toBe(run.exitCode === 0);
    cleanup();
  });

  test("`no <projectRoot>` — documented exit 2, and the door agrees", () => {
    const run = runDoor();
    expect(run.exitCode).toBe(2);
    expect(exitZeroSentence()).toMatch(/Exit `2`/);
  });
});

// ===========================================================================
// G6 — probe #63's vacuity sentence omits the `shipped_in: null` sentinel
// ===========================================================================

function probe63Row(): string {
  const line = read(GATE_SKILL)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((l) => l.startsWith("63. "));
  if (line === undefined) {
    throw new Error("no `63. ` row in skills/gate-check/SKILL.md — the probe register moved.");
  }
  return line;
}

describe("G6 — the documented vacuity contract names the template sentinel", () => {
  test("the row extractor found the right row (control)", () => {
    expect(probe63Row()).toContain("plan_ship_coherence");
    expect(probe63Row()).toContain("runReleaseSurfaceAgreement");
  });

  test("the row states that `shipped_in: null` is not a stamp", () => {
    expect(
      probe63Row(),
      "probe #63's row promises vacuity on 'at least one plan carrying a `shipped_in:` " +
        "stamp'; the implementation additionally rejects the `shipped_in: null` template " +
        "sentinel, so a consumer reading the row cannot predict the probe's behaviour.",
    ).toMatch(/shipped_in:\s*null/);
  });

  test("BEHAVIOURAL CONTROL — the sentinel really does buy vacuity", async () => {
    const root = makeProject({
      version: "2.0.0",
      changelogCiOwned: false,
      readme: readmeWith(banner("2.0.0", "Prior", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "null") },
    });
    expect(await runReleaseSurfaceAgreement(root, "2.0.0")).toEqual([]);
    cleanup();
  });

  test("BEHAVIOURAL CONTROL — the same tree with a REAL stamp is a violation (one-condition delta)", async () => {
    const root = makeProject({
      version: "2.0.0",
      changelogCiOwned: false,
      readme: readmeWith(banner("2.0.0", "Prior", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    expect(fieldsOf(await runReleaseSurfaceAgreement(root, "2.0.0"))).toEqual(["codename"]);
    cleanup();
  });

  test("the NFR-1 line cap still holds after the in-place edit", () => {
    const lines = read(GATE_SKILL).split("\n").length;
    expect(lines, `skills/gate-check/SKILL.md is ${lines} lines by split("\\n")`).toBeLessThanOrEqual(354);
  });
});

// ===========================================================================
// G3 — the `parseChangelogTop` pin, bounded to its stated subject
// ===========================================================================
//
// The pin in the sibling file sliced from `checkReleaseSurfaceAgreement` to EOF
// and forbade `parseChangelogTop(` in all of it — swallowing
// `runReleaseSurfaceAgreement` and the `import.meta.main` door, where "the
// newest entry" is the CORRECT default for a caller that names no version.
// MEASURED consequence: the disk entry inlines
// `parseChangelogEntries(changelog)[0]?.version` longhand rather than calling
// the helper, and `parseChangelogTop` now has ZERO production callers.
//
// The pin is now bounded at `DISK_SECTION_BANNER`. These legs prove the bounded
// form still fails for its real reason, and no longer fails for the other one.

const INSIDE_CHECK_ANCHOR = "  if (!hasReleaseBanner(readme)) return [];";
const BELOW_BANNER_ANCHOR = '  const readme = await readOrEmpty("README.md");';

function injectOnce(source: string, anchor: string, inserted: string): string {
  const parts = source.split(anchor);
  if (parts.length !== 2) {
    throw new Error(
      `injectOnce: anchor matched ${parts.length - 1} times (expected exactly 1): ${anchor}. ` +
        "A mutation that misses its site manufactures evidence for an assertion never exercised.",
    );
  }
  return `${parts[0]}${anchor}\n${inserted}${parts[1]}`;
}

describe("G3 — the position pin is bounded to `checkReleaseSurfaceAgreement`", () => {
  test("the real module passes the bounded pin", () => {
    expect(checkPortion(read(MODULE))).not.toContain("parseChangelogTop(");
  });

  test("FALSIFIABLE — re-pointing the CHECK at the topmost entry still reds it", () => {
    const mutated = injectOnce(
      read(MODULE),
      INSIDE_CHECK_ANCHOR,
      "  const top = parseChangelogTop(changelog);\n  void top;",
    );
    expect(
      checkPortion(mutated).includes("parseChangelogTop("),
      "the bounded pin cannot see a positional lookup inside the very function it names",
    ).toBe(true);
  });

  test("SUBJECT — a positional default in the DISK entry is not this pin's business", () => {
    // The wrong-subject half. `runReleaseSurfaceAgreement` defaulting to the
    // newest entry is correct behaviour; the to-EOF form condemned it, which is
    // why the disk entry inlines the lookup longhand today.
    const mutated = injectOnce(
      read(MODULE),
      BELOW_BANNER_ANCHOR,
      "  void parseChangelogTop;",
    );
    expect(checkPortion(mutated)).not.toContain("parseChangelogTop(");
    // …and the form it replaces WOULD have condemned it. Both halves asserted,
    // or "narrower" is a claim about nothing.
    const toEof = mutated.slice(mutated.indexOf("export function checkReleaseSurfaceAgreement"));
    expect(toEof).toContain("parseChangelogTop");
  });

  test("the end bound cannot silently vanish — a missing banner ABORTS", () => {
    const withoutBanner = read(MODULE).replace(DISK_SECTION_BANNER, "// (banner removed)");
    expect(() => checkPortion(withoutBanner)).toThrow(/end bound/);
  });

  test("the sibling pin uses the shared extractor, not a private copy", () => {
    // Same subject, one implementation. A mutation proof of a LOCAL copy proves
    // nothing about the pin in the other file.
    expect(read(SIBLING_TEST)).toContain("_release_surface_regions");
    expect(read(SIBLING_TEST)).toContain("checkPortion(read(MODULE))");
  });
});

// ===========================================================================
// G4 — the ordering pin now carries BOTH bounds
// ===========================================================================
//
// The old form asserted only that SOME `release_surface_agreement` reference sat
// below `=== Apply? [y/N] ===`. An edit moving the check below `git add` — wrong
// in the other direction, and the one that would let a disagreeing release be
// committed — passed it unchanged.

const WRITE_LINE = "bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/release_config.ts <projectRoot> <newVersion>";
const CHECK_LINE =
  "bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/release_surface_agreement.ts <projectRoot> <newVersion>";
const STAGE_LINE = "`git add` the expected-modified set and create a single commit.";
const APPROVAL_LINE = "=== Apply? [y/N] ===";

/** A synthetic ceremony carrying the four anchors in a chosen order. */
const ceremony = (...body: string[]): string =>
  ["# Ship", "", "bun run .../release_config.ts <projectRoot> <newVersion> --dry-run", "", APPROVAL_LINE, "", ...body, ""].join(
    "\n",
  );

const oldPinVerdict = (skill: string): boolean => {
  const lines = skill.replace(/\r\n/g, "\n").split("\n");
  const approval = lines.findIndex((l) => l.includes(APPROVAL_LINE));
  return lines.some((l, i) => l.includes("release_surface_agreement") && i > approval);
};

const newPinVerdict = (skill: string): boolean => {
  const w = shipCeremonyWindow(skill);
  return w.agreementLines.some((i) => i > w.write && i < w.stage);
};

describe("G4 — the check sits after the write AND before `git add`", () => {
  test("the shipped ceremony satisfies both bounds", () => {
    const w = shipCeremonyWindow(read(SHIP_SKILL));
    expect(w.agreementLines.some((i) => i > w.write && i < w.stage)).toBe(true);
  });

  test("the write bound resolves to the REAL rewrite, not the step-4 preview", () => {
    const lines = read(SHIP_SKILL).replace(/\r\n/g, "\n").split("\n");
    const w = shipCeremonyWindow(read(SHIP_SKILL));
    expect(lines[w.write]).not.toContain("--dry-run");
    // …and a dry-run invocation really does exist earlier, so the exclusion is
    // doing work rather than describing a file that has only one invocation.
    expect(lines.slice(0, w.write).some((l) => l.includes("release_config.ts") && l.includes("--dry-run"))).toBe(true);
  });

  test("the stage bound resolves to the staging step, not the prose about it", () => {
    const lines = read(SHIP_SKILL).replace(/\r\n/g, "\n").split("\n");
    const w = shipCeremonyWindow(read(SHIP_SKILL));
    expect(lines[w.stage]!.startsWith("`git add` the expected-modified set")).toBe(true);
    // Prose mentioning `git add` sits ABOVE the check; a bare-substring bound
    // would have resolved there and inverted the whole assertion.
    expect(lines.slice(0, w.stage).filter((l) => l.includes("git add")).length).toBeGreaterThan(0);
  });

  test("FALSIFIABLE (before the write) — the check above the rewrite reds", () => {
    const skill = ceremony(CHECK_LINE, "", WRITE_LINE, "", STAGE_LINE);
    expect(newPinVerdict(skill)).toBe(false);
  });

  test("FALSIFIABLE (after the commit) — the check below `git add` reds, where the old form did not", () => {
    const skill = ceremony(WRITE_LINE, "", STAGE_LINE, "", CHECK_LINE);
    expect(newPinVerdict(skill)).toBe(false);
    expect(
      oldPinVerdict(skill),
      "the old one-sided form is supposed to be BLIND here — if it also reds, this leg is " +
        "not measuring the gap it claims to close",
    ).toBe(true);
  });

  test("the correct order passes the synthetic ceremony too (isolation control)", () => {
    expect(newPinVerdict(ceremony(WRITE_LINE, "", CHECK_LINE, "", STAGE_LINE))).toBe(true);
  });

  test("an absent staging step ABORTS rather than passing vacuously", () => {
    expect(() => shipCeremonyWindow(ceremony(WRITE_LINE, "", CHECK_LINE))).toThrow(/staging instruction/);
  });

  test("the sibling pin uses the shared window, not a private copy", () => {
    expect(read(SIBLING_TEST)).toContain("shipCeremonyWindow(read(SHIP_SKILL))");
  });
});

// ===========================================================================
// G5 — the AC.8 section may not claim a measurement it does not perform
// ===========================================================================
//
// The section comment said "the final leg measures the original's bytes"; the
// leg was three substring sniffs. Harmless — the mutants run on a cpSync'd copy
// — but a false claim about what a test measures is the failure mode this repo
// keeps re-landing.

const AC8_BANNER = "AC-STE-546.8 — falsifiability by mutation";

function ac8Section(): string {
  const source = read(SIBLING_TEST).replace(/\r\n/g, "\n");
  const at = source.indexOf(AC8_BANNER);
  if (at === -1) throw new Error(`no \`${AC8_BANNER}\` section in ${SIBLING_TEST}`);
  return source.slice(at);
}

describe("G5 — the byte claim is measured, not asserted", () => {
  test("the section does claim a byte measurement (control — the implication is not vacuous)", () => {
    expect(ac8Section()).toMatch(/byte-identical|the original's bytes/);
  });

  test("and it performs one: a real Buffer comparison against the bytes captured at load", () => {
    const section = ac8Section();
    const claims = /byte-identical|the original's bytes/.test(section);
    const performs = /\.equals\(\s*MODULE_BYTES_AT_LOAD\s*\)/.test(section);
    expect(
      !claims || performs,
      "the AC.8 section claims the final leg measures the original's bytes, but no leg " +
        "compares them; three substring sniffs would pass over a file rewritten anywhere else.",
    ).toBe(true);
  });

  test("the capture happens at module load, before any mutation leg runs", () => {
    const source = read(SIBLING_TEST).replace(/\r\n/g, "\n");
    const capture = source.indexOf("const MODULE_BYTES_AT_LOAD");
    const firstMutant = source.indexOf("function makeMutant");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstMutant);
  });
});

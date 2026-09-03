// STE-546 (M141) — grade release-surface agreement AFTER the bump, not before.
//
// MEASURED against 41cb1e8 + the landed STE-545 door, by this file rather than
// quoted from the FR:
//
//   adapters/_shared/src/release_surface_agreement.ts
//       `import.meta.main` occurrences: 0
//       non-test consumers:             0
//       `checkReleaseSurfaceAgreement` locates its changelog entry with
//       `parseChangelogTop` — the TOPMOST heading, by position.
//
// A detector that is written, tested against the shipped line, and wired to
// nothing. The check that DOES run in the ceremony fires before the version is
// bumped, at the one moment when both surfaces still describe the previous
// release honestly — so agreement is guaranteed by construction rather than
// checked. That is why it never fired while a release shipped under the
// previous release's codename.
//
// ---------------------------------------------------------------------------
// THE CONTRACT THIS FILE DEFINES
// ---------------------------------------------------------------------------
//
// New/changed exports on `adapters/_shared/src/release_surface_agreement.ts`:
//
//   RELEASE_BANNER_MARKER: string
//       The literal that decides "this project adopted the banner at all".
//
//   hasReleaseBanner(readme: string): boolean
//       Marker presence — NOT parse success. AC.5 turns on the difference.
//
//   findChangelogEntry(changelog: string, version: string): ChangelogEntry | null
//       Locates by VERSION MATCH. Position is not consulted.
//
//   checkReleaseSurfaceAgreement(readme, changelog, plans, version): AgreementViolation[]
//       Gains a fourth parameter: the version being released. Returns `[]`
//       when any of the three vacuity conditions is absent.
//
//       The fourth parameter is the SUBJECT of every comparison, not a hint:
//       the `version` field grades the README banner against `version` itself,
//       and the `codename`/`milestone` fields grade it against the entry and
//       the plans that `version` resolves to. MEASURED consequence — on the
//       AC.3 fixture the shipped, position-based code returns
//       `["version", "codename", "milestone"]` where the by-version contract
//       returns `[]`; grading the banner's version against the LOCATED ENTRY's
//       version instead would leave the `version` row behind and red that leg.
//
//   runReleaseSurfaceAgreement(projectRoot: string): Promise<AgreementViolation[]>
//       Reads README.md, CHANGELOG.md and every `specs/plan/**.md` (live AND
//       archive) under `projectRoot`. The disk-level entry both production
//       callers share.
//
//   if (import.meta.main) — a command-line door:
//       bun run adapters/_shared/src/release_surface_agreement.ts <projectRoot> [version]
//       exit 0 when the surfaces agree or the check is vacuous; non-zero, with
//       each violation printed, when they disagree; NFR-10 canonical refusal on
//       a missing <projectRoot>.
//
// Production caller: probe #63 `plan_ship_coherence` EXTENDS to carry the
// agreement rows (AC.6) — no probe #83, because a new probe id moves sixty
// pinned sites across fifteen files.
//
// ---------------------------------------------------------------------------
// RED-state until the above lands. Two collateral edits ride with it:
//
//   * `tests/release-surface-agreement.test.ts` calls
//     `checkReleaseSurfaceAgreement(readme, changelog, plans)` at seven sites;
//     each needs the fourth argument. The implementer updates them.
//   * `skills/gate-check/SKILL.md` sits at 352 lines against the 354-line NFR-1
//     cap pinned by `tests/m108-ste-393-docs-pins.test.ts:194`, and the
//     `skills/` tree is at EXACTLY its 246-of-246 `STE-<N>` token ceiling. Edit
//     probe #63's row IN PLACE and carry no new `STE-<N>` token into it.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  RELEASE_BANNER_MARKER,
  checkReleaseSurfaceAgreement,
  findChangelogEntry,
  hasReleaseBanner,
  parseChangelogEntries,
  parseReadmeLatest,
  runReleaseSurfaceAgreement,
  type AgreementViolation,
  type PlanText,
} from "../adapters/_shared/src/release_surface_agreement";
import { bumpFile, parseReleaseFiles } from "../adapters/_shared/src/release_config";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { consumerFiles } from "./_module_consumers";
import { checkPortion, shipCeremonyWindow } from "./_release_surface_regions";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const MODULE_KEY = "adapters/_shared/src/release_surface_agreement.ts";
const MODULE = join(PLUGIN_ROOT, MODULE_KEY);
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

const read = (path: string): string => readFileSync(path, "utf-8");

// ---------------------------------------------------------------------------
// Fixture vocabulary — every surface is BUILT from named parts, so a fixture
// that differs from its sibling by exactly one condition differs in the source
// too. Four of the ACs below turn on one-condition deltas.
// ---------------------------------------------------------------------------

const banner = (version: string, codename: string, milestone: string): string =>
  `Latest: **v${version} — "${codename}"** (${milestone}, a sentence about the release.)`;

const readmeWith = (latestLine: string): string =>
  ["# Fixture", "", "## Release Notes", "", `See CHANGELOG.md for history. ${latestLine}`, ""].join(
    "\n",
  );

interface Entry {
  readonly version: string;
  readonly date: string;
  readonly codename: string;
}

const changelogWith = (...entries: Entry[]): string =>
  [
    "# Changelog",
    "",
    ...entries.flatMap((e) => [
      `## [${e.version}] — ${e.date} — "${e.codename}"`,
      "",
      "### Changed",
      "",
      "- something",
      "",
    ]),
  ].join("\n");

const planText = (milestone: string, shippedIn: string): string =>
  ["---", `milestone: ${milestone}`, "status: archived", `shipped_in: ${shippedIn}`, "---", "", `# ${milestone}`, ""].join(
    "\n",
  );

const archivedPlan = (milestone: string, shippedIn: string): PlanText => ({
  path: `specs/plan/archive/${milestone}.md`,
  text: planText(milestone, shippedIn),
});

// ---------------------------------------------------------------------------
// On-disk project fixtures
// ---------------------------------------------------------------------------

const RELEASE_FILES_BLOCK = [
  "# Fixture project",
  "",
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: plugin.json",
  "    kind: json",
  "    field: version",
  "  - path: README.md",
  "    kind: regex",
  `    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — '`,
  "    replace: 'Latest: **v{version} — '",
  "```",
  "",
].join("\n");

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
  /** `specs/plan/<M>.md` — live plans, exempt from probe #63's archive walk. */
  readonly livePlans?: Record<string, string>;
  /** `specs/plan/archive/<M>.md`. */
  readonly archivePlans?: Record<string, string>;
}

function makeProject(spec: ProjectSpec): string {
  const root = mkdtempSync(join(tmpdir(), "ste-546-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "CLAUDE.md": RELEASE_FILES_BLOCK,
    "plugin.json": JSON.stringify({ name: "fixture", version: spec.version }, null, 2) + "\n",
    "README.md": spec.readme,
    "CHANGELOG.md": spec.changelog,
  };
  for (const [m, text] of Object.entries(spec.livePlans ?? {})) files[`specs/plan/${m}.md`] = text;
  for (const [m, text] of Object.entries(spec.archivePlans ?? {})) {
    files[`specs/plan/archive/${m}.md`] = text;
  }
  writeInto(root, files);
  return root;
}

function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const fieldsOf = (rows: AgreementViolation[]): string[] => rows.map((r) => r.field).sort();
const describeRows = (rows: AgreementViolation[]): string =>
  rows.map((r) => `  - ${r.field}: ${r.detail}`).join("\n") || "  (none)";

// ===========================================================================
// AC-STE-546.1 — the module gains a door AND a production caller
// ===========================================================================

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runDoor(...args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", MODULE, ...args], {
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

describe("AC-STE-546.1 — an entry point, and something that calls it", () => {
  test("the module carries an `import.meta.main` door", () => {
    expect(
      read(MODULE).includes("if (import.meta.main)"),
      `${MODULE_KEY} carries no \`import.meta.main\` guard: the surface-agreement ` +
        `detector cannot be run, which is the state this FR exists to leave behind.`,
    ).toBe(true);
  });

  test("importing it stays side-effect-free — the guard is what gates the run", () => {
    const proc = Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify(MODULE)});`], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("");
  });

  test("the door runs over an agreeing project and exits zero", () => {
    const root = makeProject({
      version: "2.0.0",
      readme: readmeWith(banner("2.0.0", "New", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    const run = runDoor(root, "2.0.0");
    expect(run.exitCode, `stdout=${run.stdout}\nstderr=${run.stderr}`).toBe(0);
    cleanup();
  });

  test("the door exits non-zero over a disagreeing project and NAMES the field", () => {
    const root = makeProject({
      version: "2.0.0",
      // Version bumped, codename left behind — the shipped defect in miniature.
      readme: readmeWith(banner("2.0.0", "Prior", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    const run = runDoor(root, "2.0.0");
    expect(run.exitCode, `the door reported agreement:\n${run.stdout}`).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/codename/i);
    cleanup();
  });

  test("a missing <projectRoot> refuses in the NFR-10 canonical shape", () => {
    const run = runDoor();
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/^Remedy: \S/m);
    expect(run.stderr).toMatch(/^Context: \S/m);
    const first = run.stderr.split("\n").find((l) => l.trim() !== "") ?? "";
    expect(first.startsWith("Remedy:")).toBe(false);
    expect(first.startsWith("Context:")).toBe(false);
  });

  test("the consumer walk itself works — control for the zero-hit claim it retires", () => {
    // A "there are now consumers" assertion is worthless if the walk cannot
    // find consumers for a module that plainly has them.
    expect(consumerFiles("adapters/_shared/src/plan_ship_coherence.ts").length).toBeGreaterThan(0);
  });

  test("a NON-TEST file references the module — the door has a caller", () => {
    const consumers = consumerFiles(MODULE_KEY);
    expect(
      consumers.length,
      `${MODULE_KEY} still has zero non-test consumers: every test over it measures ` +
        `something that cannot ship.`,
    ).toBeGreaterThan(0);
    expect(
      consumers,
      `the production caller is not probe #63. AC-STE-546.6 registers the check by ` +
        `EXTENDING plan_ship_coherence; consumers found: ${consumers.join(", ")}`,
    ).toContain("adapters/_shared/src/plan_ship_coherence.ts");
  });
});

// ===========================================================================
// AC-STE-546.2 — THE LOAD-BEARING LEG: one tree, both moments
// ===========================================================================
//
// The pre-bump pass is the whole point. A leg that only asserted the post-bump
// failure would be satisfied by the shipped code running where it always ran,
// and would demonstrate nothing about the defect being fixed.

/** The pre-bump tree: v1.0.0 "Prior" shipped as M10, and everything agrees. */
function preBumpProject(): string {
  return makeProject({
    version: "1.0.0",
    readme: readmeWith(banner("1.0.0", "Prior", "M10")),
    changelog: changelogWith({ version: "1.0.0", date: "2026-01-01", codename: "Prior" }),
    archivePlans: { M10: planText("M10", "v1.0.0") },
    // M11 is the milestone about to ship: live, unstamped, exempt from the
    // archive walk exactly as a mid-ceremony plan is.
    livePlans: { M11: ["---", "milestone: M11", "status: active", "shipped_in: null", "---", "", "# M11", ""].join("\n") },
  });
}

/**
 * Applies the REAL release bump to the tree, through the shipped writer:
 * `parseReleaseFiles` + `bumpFile`, driven off the fixture's own
 * `## Release Files` block. Nothing here hand-edits the README.
 *
 * This is the mechanism that produces the stale banner: the README entry is
 * `kind: regex` whose replacement stops at the em-dash, so the version is
 * rewritten and the codename and milestone are not.
 */
function applyBump(root: string): void {
  const entries = parseReleaseFiles(read(join(root, "CLAUDE.md")));
  expect(entries.length, "the fixture's `## Release Files` block parsed to nothing").toBeGreaterThan(
    0,
  );
  for (const entry of entries) {
    const abs = join(root, entry.path);
    writeFileSync(
      abs,
      bumpFile(entry, read(abs), {
        newVersion: "2.0.0",
        codename: "New",
        date: "2026-02-02",
        changelogBody: "### Changed\n\n- something",
        testCount: { total: 1, failures: 0, errors: 0 },
      }),
    );
  }
  // The CHANGELOG is not in this fixture's block (the bumper's changelog kind
  // is STE-545's subject, not this FR's), so the new section is written the way
  // the ceremony writes it — newest first.
  writeFileSync(
    join(root, "CHANGELOG.md"),
    changelogWith(
      { version: "2.0.0", date: "2026-02-02", codename: "New" },
      { version: "1.0.0", date: "2026-01-01", codename: "Prior" },
    ),
  );
  // …and the plan is stamped, as `stampShippedIn` does.
  writeFileSync(
    join(root, "specs", "plan", "M11.md"),
    ["---", "milestone: M11", "status: active", "shipped_in: v2.0.0", "---", "", "# M11", ""].join(
      "\n",
    ),
  );
}

describe("AC-STE-546.2 — the same tree passes before the bump and fails after it", () => {
  test("PRE-BUMP: the check is clean — which is why running here caught nothing", async () => {
    const root = preBumpProject();
    const rows = await runReleaseSurfaceAgreement(root);
    expect(
      rows,
      `the pre-bump moment is not clean, so this fixture cannot demonstrate the ` +
        `guaranteed-agreement property the FR is about:\n${describeRows(rows)}`,
    ).toEqual([]);
    cleanup();
  });

  test("POST-BUMP: the SAME tree, bumped by the real writer, fires", async () => {
    const root = preBumpProject();
    expect(await runReleaseSurfaceAgreement(root)).toEqual([]);

    applyBump(root);

    // The bump did what the FR says it does: version rewritten, codename and
    // milestone left describing the previous release.
    const readme = read(join(root, "README.md"));
    expect(readme).toContain("Latest: **v2.0.0 — ");
    expect(readme).toContain('"Prior"');
    expect(readme).toContain("(M10,");

    const rows = await runReleaseSurfaceAgreement(root);
    expect(
      rows.length,
      "the post-bump tree carries a banner naming v2.0.0 with v1.0.0's codename and " +
        "milestone, and the check reported agreement",
    ).toBeGreaterThan(0);
    expect(fieldsOf(rows)).toContain("codename");
    expect(fieldsOf(rows)).toContain("milestone");
    cleanup();
  });

  test("the ceremony orders the check AFTER the write and BEFORE `git add`", () => {
    // BOTH bounds. "Below the approval gate" alone was satisfied by an edit that
    // moved the check below the COMMIT too — wrong in the other direction, and
    // silently green. The window this AC names is the one between the real
    // (non-dry-run) release-file rewrite and the staging step.
    const window = shipCeremonyWindow(read(SHIP_SKILL));
    expect(
      window.agreementLines.length,
      "skills/ship-milestone/SKILL.md never mentions the agreement check at all, so the " +
        "detector runs nowhere in the ceremony",
    ).toBeGreaterThan(0);

    expect(
      window.agreementLines.some((i) => i > window.write && i < window.stage),
      "no reference to the agreement check sits in the window between the release-file " +
        `write (line ${window.write + 1}) and \`git add\` (line ${window.stage + 1}); the ` +
        "check must run where the surfaces CAN disagree and still early enough to abort " +
        `before anything is staged. Seen at lines: ${window.agreementLines.map((i) => i + 1).join(", ")}`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-546.3 — located by version match, never by position
// ===========================================================================

const NOT_ON_TOP = changelogWith(
  { version: "2.0.0", date: "2026-02-02", codename: "Top" },
  { version: "1.5.0", date: "2026-01-15", codename: "Mid" },
  { version: "1.0.0", date: "2026-01-01", codename: "Prior" },
);

describe("AC-STE-546.3 — the entry is found by matching the released version", () => {
  test("the control: the topmost entry really is a DIFFERENT entry", () => {
    const entries = parseChangelogEntries(NOT_ON_TOP);
    expect(entries[0]!.version).toBe("2.0.0");
    expect(entries[0]!.codename).toBe("Top");
    expect(entries.map((e) => e.version)).toContain("1.5.0");
  });

  test("findChangelogEntry reaches an entry that is not on top", () => {
    const hit = findChangelogEntry(NOT_ON_TOP, "1.5.0");
    expect(hit, "the second entry is unreachable — the lookup is still positional").not.toBeNull();
    expect(hit!.codename).toBe("Mid");
    expect(hit!.version).toBe("1.5.0");
  });

  test("findChangelogEntry tolerates a leading `v` on either side", () => {
    expect(findChangelogEntry(NOT_ON_TOP, "v1.5.0")?.codename).toBe("Mid");
  });

  test("findChangelogEntry returns null for a version with no entry", () => {
    expect(findChangelogEntry(NOT_ON_TOP, "9.9.9")).toBeNull();
  });

  test("the whole check grades the matched entry, and the topmost would say otherwise", () => {
    // README describes v1.5.0 "Mid" (M15) — TRUE of the entry that matches, and
    // FALSE of the topmost. Position-based location inverts this verdict, which
    // is exactly what makes the leg falsifiable.
    const readme = readmeWith(banner("1.5.0", "Mid", "M15"));
    const plans = [archivedPlan("M15", "v1.5.0"), archivedPlan("M20", "v2.0.0")];

    const byVersion = checkReleaseSurfaceAgreement(readme, NOT_ON_TOP, plans, "1.5.0");
    expect(
      byVersion,
      `v1.5.0's own entry says "Mid" and the README says "Mid":\n${describeRows(byVersion)}`,
    ).toEqual([]);

    // The control: the same README graded against the TOP release is wrong on
    // both fields, so "clean" above is a claim about the lookup and not about a
    // check that never runs.
    const againstTop = checkReleaseSurfaceAgreement(readme, NOT_ON_TOP, plans, "2.0.0");
    expect(againstTop.length).toBeGreaterThan(0);
  });

  test("an entry that is not on top is still GRADED, not merely found", () => {
    const readme = readmeWith(banner("1.5.0", "Top", "M15"));
    const rows = checkReleaseSurfaceAgreement(
      readme,
      NOT_ON_TOP,
      [archivedPlan("M15", "v1.5.0")],
      "1.5.0",
    );
    expect(fieldsOf(rows)).toContain("codename");
  });

  test("`parseChangelogTop` is no longer what the check consults", () => {
    // BOUNDED to the leg's stated subject: `checkReleaseSurfaceAgreement`, and
    // nothing after it. Slicing to EOF also swallowed `runReleaseSurfaceAgreement`
    // and the `import.meta.main` door, where "the newest entry" is the CORRECT
    // default for a caller that names no version — so the to-EOF form failed for
    // a reason the leg never claimed. The end bound is the banner that opens the
    // disk-level section; `checkPortion` in
    // `tests/m141-ste-546-corrections.test.ts` mutation-proves both directions.
    expect(
      checkPortion(read(MODULE)).includes("parseChangelogTop("),
      "checkReleaseSurfaceAgreement still calls parseChangelogTop — the entry is located " +
        "by position, which is the defect AC-STE-546.3 closes",
    ).toBe(false);
  });
});

// ===========================================================================
// AC-STE-546.4 — vacuity is a CONJUNCTION of three conditions
// ===========================================================================

const AGREEING_CHANGELOG = changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" });
const STALE_README = readmeWith(banner("2.0.0", "Prior", "M11"));
const STAMPED_PLANS = [archivedPlan("M11", "v2.0.0")];
const UNSTAMPED_PLANS = [archivedPlan("M11", "null"), archivedPlan("M12", "null")];
const UNPARSEABLE_CHANGELOG = ["# Changelog", "", "## Unreleased", "", "- a bullet", ""].join("\n");
const NO_BANNER_README = ["# Fixture", "", "## Release Notes", "", "See CHANGELOG.md.", ""].join(
  "\n",
);

describe("AC-STE-546.4 — all three conditions, or zero rows", () => {
  test("ALL THREE PRESENT: the check actually runs (the anti-vacuity control)", () => {
    // Without this leg the three below could all pass on a check that never
    // runs at all — the classic way a vacuity guard silences its own subject.
    const rows = checkReleaseSurfaceAgreement(
      STALE_README,
      AGREEING_CHANGELOG,
      STAMPED_PLANS,
      "2.0.0",
    );
    expect(
      rows.length,
      "the fully-populated fixture carries a genuinely stale banner and reported nothing",
    ).toBeGreaterThan(0);
    expect(fieldsOf(rows)).toContain("codename");
  });

  test("condition 1 absent — no banner literal in the README — yields ZERO rows", () => {
    const rows = checkReleaseSurfaceAgreement(
      NO_BANNER_README,
      AGREEING_CHANGELOG,
      STAMPED_PLANS,
      "2.0.0",
    );
    expect(
      rows,
      `a project that never adopted the banner is failed for a surface it does not have:\n` +
        describeRows(rows),
    ).toEqual([]);
  });

  test("condition 2 absent — no parseable changelog heading — yields ZERO rows", () => {
    const rows = checkReleaseSurfaceAgreement(
      STALE_README,
      UNPARSEABLE_CHANGELOG,
      STAMPED_PLANS,
      "2.0.0",
    );
    expect(
      rows,
      `a non-toolkit CHANGELOG format is reported as a changelog violation before the ` +
        `banner is ever examined:\n${describeRows(rows)}`,
    ).toEqual([]);
  });

  test("condition 3 absent — no plan carries a shipped stamp — yields ZERO rows", () => {
    const rows = checkReleaseSurfaceAgreement(
      STALE_README,
      AGREEING_CHANGELOG,
      UNSTAMPED_PLANS,
      "2.0.0",
    );
    expect(
      rows,
      `a project that has not run the ship ceremony is reported as a milestone ` +
        `violation:\n${describeRows(rows)}`,
    ).toEqual([]);
  });

  test("an EMPTY plan set is the same case as an unstamped one", () => {
    expect(checkReleaseSurfaceAgreement(STALE_README, AGREEING_CHANGELOG, [], "2.0.0")).toEqual([]);
  });

  test("`shipped_in: null` is not a stamp — the sentinel does not satisfy condition 3", () => {
    // A substring sniff for `shipped_in:` would call the template sentinel a
    // stamp and re-open every leg above.
    expect(UNSTAMPED_PLANS[0]!.text).toContain("shipped_in: null");
    expect(checkReleaseSurfaceAgreement(STALE_README, AGREEING_CHANGELOG, UNSTAMPED_PLANS, "2.0.0")).toEqual(
      [],
    );
  });

  test("the conditions are independent: restoring each one alone restores the rows", () => {
    // Three one-condition deltas from the SAME silent fixture, so "zero rows"
    // above is attributable to the condition named and to nothing else.
    const silent = { readme: NO_BANNER_README, changelog: UNPARSEABLE_CHANGELOG, plans: UNSTAMPED_PLANS };
    expect(
      checkReleaseSurfaceAgreement(silent.readme, silent.changelog, silent.plans, "2.0.0"),
    ).toEqual([]);
    expect(
      checkReleaseSurfaceAgreement(STALE_README, AGREEING_CHANGELOG, STAMPED_PLANS, "2.0.0").length,
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-546.5 — present-but-wrong is a violation; absent is not
// ===========================================================================

// Carries the marker, fails the full parse: no quoted codename, no `(M<N>`.
const MANGLED_README = readmeWith("Latest: **v2.0.0 - Broken banner, M11");

describe("AC-STE-546.5 — the marker decides, not parse success", () => {
  test("the marker is exported and is what the predicate reads", () => {
    expect(typeof RELEASE_BANNER_MARKER).toBe("string");
    expect(RELEASE_BANNER_MARKER.length).toBeGreaterThan(0);
    expect(NO_BANNER_README).not.toContain(RELEASE_BANNER_MARKER);
    expect(STALE_README).toContain(RELEASE_BANNER_MARKER);
    expect(MANGLED_README).toContain(RELEASE_BANNER_MARKER);
  });

  test("hasReleaseBanner separates the two READMEs the parser cannot", () => {
    // Both of these parse to null. Only one of them is a project that adopted
    // the banner, and conflating them is the bug.
    expect(parseReadmeLatest(NO_BANNER_README)).toBeNull();
    expect(parseReadmeLatest(MANGLED_README)).toBeNull();
    expect(hasReleaseBanner(NO_BANNER_README)).toBe(false);
    expect(hasReleaseBanner(MANGLED_README)).toBe(true);
  });

  test("banner ABSENT — skip, zero rows", () => {
    expect(
      checkReleaseSurfaceAgreement(NO_BANNER_README, AGREEING_CHANGELOG, STAMPED_PLANS, "2.0.0"),
    ).toEqual([]);
  });

  test("banner PRESENT but unparseable — one `latest_line` violation", () => {
    const rows = checkReleaseSurfaceAgreement(
      MANGLED_README,
      AGREEING_CHANGELOG,
      STAMPED_PLANS,
      "2.0.0",
    );
    expect(
      rows.length,
      "a mangled banner is silently treated as an absent one, so a broken release line " +
        "reads as agreement",
    ).toBeGreaterThan(0);
    expect(fieldsOf(rows)).toContain("latest_line");
  });

  test("banner PRESENT and parseable but disagreeing — field-level violations", () => {
    const rows = checkReleaseSurfaceAgreement(
      STALE_README,
      AGREEING_CHANGELOG,
      STAMPED_PLANS,
      "2.0.0",
    );
    expect(fieldsOf(rows)).toContain("codename");
    expect(fieldsOf(rows)).not.toContain("latest_line");
  });

  test("through the disk entry: an absent banner is silent, a mangled one is not", async () => {
    const absent = makeProject({
      version: "2.0.0",
      readme: NO_BANNER_README,
      changelog: AGREEING_CHANGELOG,
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    const mangled = makeProject({
      version: "2.0.0",
      readme: MANGLED_README,
      changelog: AGREEING_CHANGELOG,
      archivePlans: { M11: planText("M11", "v2.0.0") },
    });
    expect(await runReleaseSurfaceAgreement(absent)).toEqual([]);
    expect((await runReleaseSurfaceAgreement(mangled)).length).toBeGreaterThan(0);
    cleanup();
  });
});

// ===========================================================================
// AC-STE-546.6 — registered by EXTENDING probe #63, not by adding #83
// ===========================================================================

const gateSkill = (): string => read(GATE_SKILL).replace(/\r\n/g, "\n");

/** Row `n`'s block: from its `n. **` line up to the next numbered row. */
function probeRow(n: number): string {
  const lines = gateSkill().split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${n}\\. \\*\\*`).test(l));
  expect(start, `no \`${n}. **\` row in skills/gate-check/SKILL.md`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\d+\. \*\*/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("AC-STE-546.6 — the probe count and its pinned sites do not move", () => {
  test("the numbered probe list is still contiguous 1..82", () => {
    const numbers = [...gateSkill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(
      numbers.length,
      "the probe count moved — a new probe id drags sixty pinned sites across fifteen files",
    ).toBe(82);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 82 }, (_, i) => i + 1));
  });

  test("no `83.` row was registered", () => {
    expect(gateSkill()).not.toMatch(/^83\. \*\*/m);
  });

  test("README's two probe-count sentences still say 82", () => {
    const readme = read(join(REPO_ROOT, "README.md"));
    const line = (re: RegExp): string =>
      readme.split("\n").find((l) => re.test(l)) ?? "";
    expect(line(/numbered `\/gate-check` probes/)).toMatch(/\b82\b/);
    expect(line(/which layers \d+ probes on top/)).toMatch(/\b82\b\s+probes/);
  });

  test("row #63 is still plan_ship_coherence and still names its runner", () => {
    const row = probeRow(63);
    expect(row).toMatch(/^63\. \*\*`plan_ship_coherence`\*\*/m);
    expect(row).toContain("runPlanShipCoherenceProbe(projectRoot)");
    expect(row).toContain("adapters/_shared/src/plan_ship_coherence.ts");
  });

  test("the agreement check is registered INSIDE row #63", () => {
    const row = probeRow(63);
    expect(
      row.includes("release_surface_agreement"),
      "probe #63's row does not mention the release-surface agreement check, so the " +
        "widened scope is undocumented — or was registered as a new probe elsewhere",
    ).toBe(true);
  });

  test("the module is named in NO other probe row", () => {
    const body = gateSkill();
    const rows = [...body.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    const elsewhere = rows.filter((n) => n !== 63 && probeRow(n).includes("release_surface_agreement"));
    expect(
      elsewhere,
      `the agreement check is registered under probe row(s) ${elsewhere.join(", ")} as well as #63`,
    ).toEqual([]);
  });

  test("probe #63 emits the agreement rows over a disagreeing tree", async () => {
    const root = makeProject({
      version: "2.0.0",
      readme: readmeWith(banner("2.0.0", "Prior", "M10")),
      changelog: changelogWith(
        { version: "2.0.0", date: "2026-02-02", codename: "New" },
        { version: "1.0.0", date: "2026-01-01", codename: "Prior" },
      ),
      archivePlans: { M10: planText("M10", "v1.0.0"), M11: planText("M11", "v2.0.0") },
    });
    const report = await runPlanShipCoherenceProbe(root);
    expect(
      report.violations.length,
      "probe #63 sees a banner naming v2.0.0 with the previous release's codename and " +
        "milestone and reports nothing — the check is registered nowhere that runs",
    ).toBeGreaterThan(0);
    expect(report.violations.some((v) => /codename/i.test(v.reason))).toBe(true);
    cleanup();
  });

  test("probe #63's pre-existing legs are untouched — an agreeing tree is clean", async () => {
    const root = makeProject({
      version: "2.0.0",
      readme: readmeWith(banner("2.0.0", "New", "M11")),
      changelog: changelogWith(
        { version: "2.0.0", date: "2026-02-02", codename: "New" },
        { version: "1.0.0", date: "2026-01-01", codename: "Prior" },
      ),
      archivePlans: { M10: planText("M10", "v1.0.0"), M11: planText("M11", "v2.0.0") },
    });
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.violations, describeRowsOfProbe(report.violations)).toEqual([]);
    cleanup();
  });

  test("probe #63 still fails a corrupt shipped_in stamp (no regression)", async () => {
    const root = makeProject({
      version: "2.0.0",
      readme: readmeWith(banner("2.0.0", "New", "M11")),
      changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
      archivePlans: { M11: planText("M11", "v2.0.0"), M12: planText("M12", "v9.9.9") },
    });
    const report = await runPlanShipCoherenceProbe(root);
    expect(report.violations.some((v) => v.reason.includes("9.9.9"))).toBe(true);
    cleanup();
  });
});

function describeRowsOfProbe(rows: { reason: string }[]): string {
  return rows.map((r) => `  - ${r.reason}`).join("\n") || "  (none)";
}

// ===========================================================================
// AC-STE-546.7 — the documented vacuity contract matches the widened scope
// ===========================================================================

/** The vacuity sentence probe #63's row shipped with, before the widening. */
const OLD_VACUITY_SENTENCE = "Vacuous when `specs/plan/archive/` is absent or empty.";

describe("AC-STE-546.7 — the row's vacuity contract is rewritten, not left behind", () => {
  test("the control: the scan CAN see a plain vacuity sentence elsewhere in the file", () => {
    // Without this, the two assertions below would pass on a broken search.
    const hits = [...gateSkill().matchAll(/Vacuous when/g)];
    expect(hits.length, "no probe row in the file says `Vacuous when` at all").toBeGreaterThan(1);
  });

  test("row #63 no longer promises the old, narrower silence", () => {
    expect(
      probeRow(63).includes(OLD_VACUITY_SENTENCE),
      "probe #63 still promises silence on an empty archive alone. That condition no " +
        "longer governs every leg: the agreement check runs on a repo with an empty " +
        "archive whenever the banner, the changelog and a shipped stamp are all present.",
    ).toBe(false);
  });

  test("row #63 states the widened vacuity conditions", () => {
    const row = probeRow(63);
    expect(row).toMatch(/[Vv]acuous/);
    // The three conditions, each named. Wording is free; the subjects are not.
    expect(row, "the row's vacuity contract does not name the README banner").toMatch(
      /banner|Latest:/,
    );
    expect(row, "the row's vacuity contract does not name the changelog condition").toMatch(
      /CHANGELOG|changelog/,
    );
    expect(row, "the row's vacuity contract does not name the shipped-stamp condition").toMatch(
      /shipped[_ ]in|shipped stamp/,
    );
  });

  test("the row still names a test file, per the STE-82 authoring contract", () => {
    expect(probeRow(63)).toMatch(/tests\/[a-z0-9-]+\.test\.ts/);
  });
});

// ===========================================================================
// AC-STE-546.8 — falsifiability by mutation
// ===========================================================================
//
// The mutation is applied to a COPY of the whole `adapters/_shared/src` tree,
// never to the file on disk. Same evidence, none of the risk: a crash between
// "mutate" and "restore" cannot leave a corrupt module behind. The final leg
// measures the original's bytes — a real `Buffer` comparison against the bytes
// captured at module load, below, before any test in this file has run. Three
// substring sniffs used to stand in for that comparison while the comment
// claimed one, which is a false claim about what a test measures.

const MODULE_BYTES_AT_LOAD = readFileSync(MODULE);
//
// A mutant that never applied reads exactly like a pin that holds, so every
// mutation below ABORTS when its anchor is absent or ambiguous.

interface Mutant {
  /** Absolute path of the mutated copy, importable. */
  readonly path: string;
  /** The mutated source, for diagnostics. */
  readonly source: string;
}

function makeMutant(apply: (source: string) => string): Mutant {
  const dir = mkdtempSync(join(tmpdir(), "ste-546-mutant-"));
  dirs.push(dir);
  const srcCopy = join(dir, "src");
  cpSync(SRC_DIR, srcCopy, { recursive: true });
  const target = join(srcCopy, "release_surface_agreement.ts");
  const before = read(target);
  const after = apply(before);
  if (after === before) {
    throw new Error("makeMutant: the mutation produced identical bytes — it did not apply");
  }
  writeFileSync(target, after);
  return { path: target, source: after };
}

/** Replace the sole match of `re`, aborting on zero or multiple matches. */
function spliceOnce(source: string, re: RegExp, replace: (m: RegExpMatchArray) => string, what: string): string {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const matches = [...source.matchAll(global)];
  if (matches.length !== 1) {
    throw new Error(
      `spliceOnce: ${what} matched ${matches.length} times (expected exactly 1). ` +
        `A mutation that misses its site manufactures evidence of falsifiability for an ` +
        `assertion that was never exercised. Pattern: ${re}`,
    );
  }
  const m = matches[0]!;
  const at = m.index!;
  return source.slice(0, at) + replace(m) + source.slice(at + m[0].length);
}

type CheckFn = (
  readme: string,
  changelog: string,
  plans: PlanText[],
  version: string,
) => AgreementViolation[];

async function loadCheck(path: string): Promise<CheckFn> {
  const mod = (await import(pathToFileURL(path).href)) as {
    checkReleaseSurfaceAgreement: CheckFn;
  };
  return mod.checkReleaseSurfaceAgreement;
}

// A fixture whose ONLY disagreement is the codename, so "goes green" is a
// statement about the comparison being reverted and about nothing else.
const CODENAME_ONLY_STALE = {
  readme: readmeWith(banner("2.0.0", "Prior", "M11")),
  changelog: changelogWith({ version: "2.0.0", date: "2026-02-02", codename: "New" }),
  plans: [archivedPlan("M11", "v2.0.0")],
  version: "2.0.0",
};

describe("AC-STE-546.8 — reverting the comparison turns the stale fixture green", () => {
  test("the fixture is stale in exactly one field (the isolation control)", () => {
    const rows = checkReleaseSurfaceAgreement(
      CODENAME_ONLY_STALE.readme,
      CODENAME_ONLY_STALE.changelog,
      CODENAME_ONLY_STALE.plans,
      CODENAME_ONLY_STALE.version,
    );
    expect(fieldsOf(rows)).toEqual(["codename"]);
  });

  test("MUTANT: with the codename comparison reverted the stale fixture is GREEN", async () => {
    const mutant = makeMutant((source) =>
      spliceOnce(
        source,
        /(\w+)\.codename\s*!==\s*(\w+)\.codename/,
        (m) => `${m[1]}.codename === ${m[2]}.codename`,
        "the codename inequality comparison " +
          "(keep it locally expressed as `<a>.codename !== <b>.codename` so it can be mutated)",
      ),
    );
    const mutated = await loadCheck(mutant.path);
    const rows = mutated(
      CODENAME_ONLY_STALE.readme,
      CODENAME_ONLY_STALE.changelog,
      CODENAME_ONLY_STALE.plans,
      CODENAME_ONLY_STALE.version,
    );
    expect(
      rows,
      "the mutant STILL reports the stale codename, so the assertion above is not " +
        "measuring the comparison it claims to:\n" + describeRows(rows),
    ).toEqual([]);
  });

  test("RESTORED: the unmutated module reds on the same fixture again", () => {
    const rows = checkReleaseSurfaceAgreement(
      CODENAME_ONLY_STALE.readme,
      CODENAME_ONLY_STALE.changelog,
      CODENAME_ONLY_STALE.plans,
      CODENAME_ONLY_STALE.version,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(fieldsOf(rows)).toContain("codename");
  });

  test("the mutant's inverse also holds — it fires where the original is silent", async () => {
    // Isolation, the other half: a mutation that made the check return `[]`
    // unconditionally would satisfy the leg above. This one must still be a
    // COMPARISON, just the wrong one.
    const mutant = makeMutant((source) =>
      spliceOnce(
        source,
        /(\w+)\.codename\s*!==\s*(\w+)\.codename/,
        (m) => `${m[1]}.codename === ${m[2]}.codename`,
        "the codename inequality comparison",
      ),
    );
    const mutated = await loadCheck(mutant.path);
    const agreeing = readmeWith(banner("2.0.0", "New", "M11"));
    expect(
      checkReleaseSurfaceAgreement(agreeing, CODENAME_ONLY_STALE.changelog, CODENAME_ONLY_STALE.plans, "2.0.0"),
    ).toEqual([]);
    expect(
      mutated(agreeing, CODENAME_ONLY_STALE.changelog, CODENAME_ONLY_STALE.plans, "2.0.0").length,
      "the mutant is silent on BOTH fixtures — it deleted the check rather than reverting it",
    ).toBeGreaterThan(0);
    cleanup();
  });

  test("the module on disk is byte-identical to what it was before the mutations", () => {
    // The "restore" half, MEASURED: byte-for-byte against the buffer captured at
    // module load. The three substring sniffs that used to stand here would pass
    // over a file the mutants had rewritten anywhere else in it.
    const now = readFileSync(MODULE);
    expect(
      now.equals(MODULE_BYTES_AT_LOAD),
      `${MODULE_KEY} changed on disk while the mutation legs ran: ` +
        `${MODULE_BYTES_AT_LOAD.length} bytes at load, ${now.length} now. The mutants are ` +
        "supposed to write only to a cpSync'd copy.",
    ).toBe(true);
    // Control: the capture is of the real module, not of an empty or wrong file.
    expect(MODULE_BYTES_AT_LOAD.toString("utf-8")).toContain(
      "export function checkReleaseSurfaceAgreement",
    );
    expect(MODULE_BYTES_AT_LOAD.toString("utf-8")).toContain("if (import.meta.main)");
  });

  test("AC.3's lookup is load-bearing too: reverting it to the top flips the verdict", async () => {
    // Not AC.8's leg — the direction is clean→red rather than stale→green — but
    // the by-version lookup deserves its own mutant, or "found by match" is a
    // claim about a code path no test can distinguish from position.
    const mutant = makeMutant((source) =>
      spliceOnce(
        source,
        /export function findChangelogEntry\(\s*(\w+)\s*:[^,]+,\s*\w+\s*:[^)]*\)\s*:[^{]*\{/,
        (m) => `${m[0]}\n  return parseChangelogEntries(${m[1]})[0] ?? null;`,
        "the findChangelogEntry declaration " +
          "(expected `export function findChangelogEntry(changelog: string, version: string): …`)",
      ),
    );
    const mutated = await loadCheck(mutant.path);
    const readme = readmeWith(banner("1.5.0", "Mid", "M15"));
    const plans = [archivedPlan("M15", "v1.5.0"), archivedPlan("M20", "v2.0.0")];

    expect(checkReleaseSurfaceAgreement(readme, NOT_ON_TOP, plans, "1.5.0")).toEqual([]);
    expect(
      mutated(readme, NOT_ON_TOP, plans, "1.5.0").length,
      "re-pointing the lookup at the topmost entry changed nothing, so the by-version " +
        "location is not what produced the clean verdict",
    ).toBeGreaterThan(0);
    cleanup();
  });
});

// ===========================================================================
// Dogfood — this repo's two release surfaces agree right now
// ===========================================================================

describe("dogfood — the live tree is clean", () => {
  test("README v2.75.1 \"Namesake\" (M138) matches the CHANGELOG entry it names", async () => {
    const rows = await runReleaseSurfaceAgreement(REPO_ROOT);
    expect(rows, describeRows(rows)).toEqual([]);
  });

  test("probe #63 over the live tree is clean", async () => {
    const report = await runPlanShipCoherenceProbe(REPO_ROOT);
    expect(report.violations, describeRowsOfProbe(report.violations)).toEqual([]);
  });

  test("the dogfood is not vacuous — all three conditions hold on this repo", () => {
    const readme = read(join(REPO_ROOT, "README.md"));
    const changelog = read(join(REPO_ROOT, "CHANGELOG.md"));
    expect(hasReleaseBanner(readme)).toBe(true);
    expect(parseChangelogEntries(changelog).length).toBeGreaterThan(0);
    expect(read(join(REPO_ROOT, "specs", "plan", "archive", "M138.md"))).toContain(
      "shipped_in: v2.75.1",
    );
  });
});

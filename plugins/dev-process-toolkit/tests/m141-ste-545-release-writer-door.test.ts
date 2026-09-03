// STE-545 (M141) — the release-file writer gets a front door, and the
// CHANGELOG's closing line stops being optional.
//
// MEASURED against 41cb1e8, by this file rather than quoted from the FR:
//
//   adapters/_shared/src/release_config.ts   `import.meta.main` occurrences: 0
//                                            non-test importers:             0
//                                            probe #81: 3 refs, all DESCRIPTIVE,
//                                                       all `reachable: false`
//
// The module that rewrites every release file cannot be run, so the write step
// is carried out by hand — and the closing line it is supposed to emit
// (`Total test count at release: <N> tests, <F> failures, <E> errors.`) is
// therefore typed from memory. It was typed wrong three times across one
// release.
//
// THE ORDERING IS THE DESIGN. A guard inside a function nobody calls changes
// nothing, so the door comes first and the guard rides behind it. Shipping the
// guard alone would pass its own tests and change nothing about the release
// that motivated it.
//
// ---------------------------------------------------------------------------
// THE COMMAND-LINE CONTRACT THIS FILE DEFINES
// ---------------------------------------------------------------------------
//
//     bun run adapters/_shared/src/release_config.ts <projectRoot> <newVersion> \
//         [--codename <name>] [--date <YYYY-MM-DD>] [--body <text>] \
//         [--test-count <total>,<failures>,<errors>]
//
// It reads `<projectRoot>/CLAUDE.md`, parses the `## Release Files` block,
// rewrites each listed file per its declared `kind`, and prints one line per
// rewritten path. Every refusal path — an absent block, a missing version, a
// `changelog` entry with no count — writes the NFR-10 canonical shape to
// stderr and exits non-zero, writing nothing.
//
// `--test-count` is FORWARDED, never re-measured here: see the AC.6 block for
// the measurement that makes forwarding necessary rather than stylistic.
//
// ---------------------------------------------------------------------------
// RED-state until:
//   1. `release_config.ts` gains an `if (import.meta.main)` block in the shape
//      its sibling `test_count_parser.ts` already carries;
//   2. `BumpOptions` carries `testCount` and `bumpChangelog` renders the
//      closing line from it as the last line of the new section;
//   3. the `changelog` kind refuses without a count;
//   4. `renderClosingLine` is promoted out of `tests/m132-ste-508-skip-parsing.test.ts`
//      into `adapters/_shared/src/test_count_parser.ts` and the M132 suite
//      imports the promoted one;
//   5. `skills/ship-milestone/SKILL.md`'s write step orders that door instead
//      of describing the module.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectGate } from "../adapters/_shared/src/capture_skip_baseline";
import { readDocsConfig } from "../adapters/_shared/src/docs_config";
import {
  ORDERED_UNREACHABLE_PIN,
  classifyReferenceLine,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  bumpChangelog,
  bumpFile,
  parseReleaseFiles,
  renderUnifiedDiff,
  type ReleaseFile,
} from "../adapters/_shared/src/release_config";
// AC-STE-545.5 — the ONE renderer. Imported, never re-declared: a second copy
// here would reproduce the exact drift this AC exists to close.
import { renderClosingLine } from "../adapters/_shared/src/test_count_parser";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const RELEASE_CONFIG_KEY = "adapters/_shared/src/release_config.ts";
const RELEASE_CONFIG = join(PLUGIN_ROOT, RELEASE_CONFIG_KEY);
const TEST_COUNT_PARSER = join(PLUGIN_ROOT, "adapters", "_shared", "src", "test_count_parser.ts");
const CAPTURE_SKIP_BASELINE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "capture_skip_baseline.ts",
);
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const M132_SUITE = join(PLUGIN_ROOT, "tests", "m132-ste-508-skip-parsing.test.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

const dirs: string[] = [];
function makeRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-545-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runDoor(...args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", RELEASE_CONFIG, ...args], {
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

/**
 * The NFR-10 canonical shape, asserted structurally rather than by wording:
 * a one-line verdict, then `Remedy:`, then `Context:` naming the skill.
 */
function expectCanonicalRefusal(run: Run): void {
  expect(run.exitCode, `expected a non-zero exit; stdout=${run.stdout}`).not.toBe(0);
  expect(run.stderr).toMatch(/^Remedy: \S/m);
  expect(run.stderr).toMatch(/^Context: .*skill=ship-milestone/m);
  // A verdict line precedes the remedy — a bare `Remedy:` is not the shape.
  const first = run.stderr.split("\n").find((l) => l.trim() !== "") ?? "";
  expect(first.startsWith("Remedy:")).toBe(false);
  expect(first.startsWith("Context:")).toBe(false);
}

const CLAUDE_MD_JSON_AND_REGEX = [
  "# Fixture",
  "",
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: pkg.json",
  "    kind: json",
  "    field: version",
  "  - path: README.md",
  "    kind: regex",
  `    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — '`,
  "    replace: 'Latest: **v{version} — '",
  "```",
  "",
  "## Something Else",
  "",
].join("\n");

const CLAUDE_MD_CHANGELOG = [
  "# Fixture",
  "",
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: CHANGELOG.md",
  "    kind: changelog",
  "```",
  "",
].join("\n");

const CHANGELOG_FIXTURE = [
  "# Changelog",
  "",
  "## [1.0.0] — 2026-01-01 — \"Prior\"",
  "",
  "### Added",
  "",
  "- something",
  "",
].join("\n");

// ===========================================================================
// AC-STE-545.1 — the door exists, runs, prints a usable result, and refuses
// ===========================================================================

describe("AC-STE-545.1 — release_config.ts carries a command-line front door", () => {
  test("the sibling has one (the control that proves the shape exists)", () => {
    expect(read(TEST_COUNT_PARSER)).toContain("if (import.meta.main)");
  });

  test("the release-file writer has one too", () => {
    expect(
      read(RELEASE_CONFIG).includes("if (import.meta.main)"),
      `${RELEASE_CONFIG_KEY} carries no \`import.meta.main\` guard, so the ceremony's ` +
        `write step names a module nobody can run and the rewrite is done by hand.`,
    ).toBe(true);
  });

  test("importing it stays side-effect-free — the guard is what gates the run", () => {
    const proc = Bun.spawnSync(["bun", "-e", `await import(${JSON.stringify(RELEASE_CONFIG)});`], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("");
  });

  test("a valid invocation exits zero, prints each rewritten path, and REWRITES it", () => {
    const root = makeRoot({
      "CLAUDE.md": CLAUDE_MD_JSON_AND_REGEX,
      "pkg.json": JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n",
      "README.md": "Latest: **v1.0.0 — Prior**\n",
    });

    const run = runDoor(root, "9.9.9");
    expect(run.exitCode, run.stderr).toBe(0);

    // Prints a usable result: one line naming each rewritten path.
    expect(run.stdout).toContain("pkg.json");
    expect(run.stdout).toContain("README.md");

    // …and the print is not the whole story. The vacuity this leg kills is a
    // door that reports success while writing nothing, so the assertion is on
    // disk, per kind — which is what "dispatching on the release-file kind"
    // has to mean to be worth anything.
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("9.9.9");
    expect(read(join(root, "README.md"))).toContain("Latest: **v9.9.9 — ");
    cleanup();
  });

  test("a malformed invocation refuses in the NFR-10 canonical shape and writes nothing", () => {
    const root = makeRoot({
      "CLAUDE.md": "# Fixture\n\nNo release block here at all.\n",
      "pkg.json": JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n",
    });

    const run = runDoor(root, "9.9.9");
    expectCanonicalRefusal(run);
    // Nothing was rewritten on the refusal path.
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("1.0.0");
    cleanup();
  });

  test("a missing version argument refuses too — the door is not argv-blind", () => {
    const root = makeRoot({
      "CLAUDE.md": CLAUDE_MD_JSON_AND_REGEX,
      "pkg.json": JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n",
      "README.md": "Latest: **v1.0.0 — Prior**\n",
    });
    expectCanonicalRefusal(runDoor(root));
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("1.0.0");
    cleanup();
  });
});

// ===========================================================================
// AC-STE-545.2 — the write step is an ORDER, line-scoped
// ===========================================================================

/**
 * The write step exactly as it shipped at 41cb1e8 — a bare literal, and the
 * falsifiability control for the leg below.
 *
 * The shipped classifier is line-scoped (probe #81, departure 2), so the whole
 * question is whether THIS line carries an order phrase. It does not, and the
 * assertion below would be worthless if it could not tell the two apart.
 */
const DESCRIPTIVE_WRITE_STEP_AS_SHIPPED =
  "Read the host project's `## Release Files` block from `CLAUDE.md` via " +
  "`parseReleaseFiles(content)` from `adapters/_shared/src/release_config.ts`. " +
  "The block declares every path that gets rewritten on this release; no path " +
  "is hard-coded in this skill body.";

describe("AC-STE-545.2 — the ship-milestone write step orders the door", () => {
  test("the descriptive form it replaces scores `descriptive` (the control)", () => {
    expect(classifyReferenceLine(DESCRIPTIVE_WRITE_STEP_AS_SHIPPED)).toBe("descriptive");
  });

  test("the shipped write step now scores `ordered` and names the door", () => {
    const lines = read(SHIP_SKILL).replace(/\r\n/g, "\n").split("\n");
    const refs = lines.filter((l) => l.includes(RELEASE_CONFIG_KEY));
    expect(refs.length, `${SHIP_SKILL} names no ${RELEASE_CONFIG_KEY} reference at all`).toBeGreaterThan(0);

    const ordered = refs.filter((l) => classifyReferenceLine(l) === "ordered");
    expect(
      ordered.length,
      `every ${RELEASE_CONFIG_KEY} reference in skills/ship-milestone/SKILL.md still reads as a ` +
        `description. The write step must ORDER the entry point:\n` +
        refs.map((l) => `  - ${l.slice(0, 160)}`).join("\n"),
    ).toBeGreaterThan(0);

    // An order is executable or it is prose wearing a verb: the ordered line
    // carries the invocation, not just an imperative mood.
    expect(ordered.some((l) => l.includes("bun run"))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-545.3 — the closing line is rendered from a supplied count
// ===========================================================================

const COUNT_A = { total: 9340, failures: 0, errors: 0 };
const COUNT_B = { total: 7, failures: 1, errors: 2 };
const BODY = "### Fixed\n\n- something broke and is now fixed";

/** The new section: from its `## [` header up to the next one (or the end). */
function newSectionOf(content: string, version: string): string {
  const start = content.indexOf(`## [${version}]`);
  expect(start, `no \`## [${version}]\` section in the rewritten CHANGELOG`).toBeGreaterThanOrEqual(0);
  const rest = content.slice(start + 4);
  const next = rest.search(/^##\s+\[/m);
  return next === -1 ? content.slice(start) : content.slice(start, start + 4 + next);
}

function lastNonEmptyLine(section: string): string {
  const lines = section.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
  return lines[lines.length - 1] ?? "";
}

describe("AC-STE-545.3 — bumpChangelog renders the closing line from BumpOptions", () => {
  test("the closing line is the last line of the new section, byte-for-byte", () => {
    const out = bumpChangelog(CHANGELOG_FIXTURE, "2.0.0", "Doorway", "2026-09-03", BODY, COUNT_A);
    const section = newSectionOf(out, "2.0.0");
    expect(lastNonEmptyLine(section)).toBe(renderClosingLine(COUNT_A));
    // Exactly once — a second copy inside the section is drift in miniature.
    expect(section.split(renderClosingLine(COUNT_A)).length - 1).toBe(1);
    // The prior section is untouched.
    expect(out).toContain('## [1.0.0] — 2026-01-01 — "Prior"');
  });

  test("the value comes from the count, never from a literal typed into the module", () => {
    const a = newSectionOf(
      bumpChangelog(CHANGELOG_FIXTURE, "2.0.0", "Doorway", "2026-09-03", BODY, COUNT_A),
      "2.0.0",
    );
    const b = newSectionOf(
      bumpChangelog(CHANGELOG_FIXTURE, "2.0.0", "Doorway", "2026-09-03", BODY, COUNT_B),
      "2.0.0",
    );
    expect(lastNonEmptyLine(a)).toBe(renderClosingLine(COUNT_A));
    expect(lastNonEmptyLine(b)).toBe(renderClosingLine(COUNT_B));
    expect(lastNonEmptyLine(a)).not.toBe(lastNonEmptyLine(b));
  });

  test("the module does not carry its own copy of the sentence", () => {
    // Positive control for the scan below: the token IS present in the promoted
    // renderer's own module, so a zero hit here would be a broken search.
    expect(read(TEST_COUNT_PARSER)).toContain("Total test count at release");
    expect(
      read(RELEASE_CONFIG),
      `${RELEASE_CONFIG_KEY} spells the closing line itself instead of calling the one renderer`,
    ).not.toContain("Total test count at release");
  });

  test("bumpFile forwards the count through to the rendered section", () => {
    const entry: ReleaseFile = { path: "CHANGELOG.md", kind: "changelog" };
    const out = bumpFile(entry, CHANGELOG_FIXTURE, {
      newVersion: "2.0.0",
      codename: "Doorway",
      date: "2026-09-03",
      changelogBody: BODY,
      testCount: COUNT_B,
    });
    expect(lastNonEmptyLine(newSectionOf(out, "2.0.0"))).toBe(renderClosingLine(COUNT_B));
  });
});

// ===========================================================================
// AC-STE-545.4 — the `changelog` kind refuses without a count
// ===========================================================================

describe("AC-STE-545.4 — no section can be written without a count", () => {
  const entry: ReleaseFile = { path: "CHANGELOG.md", kind: "changelog" };
  const complete = {
    newVersion: "2.0.0",
    codename: "Doorway",
    date: "2026-09-03",
    changelogBody: BODY,
    testCount: COUNT_A,
  };

  test("the positive control — the same call WITH a count succeeds", () => {
    expect(() => bumpFile(entry, CHANGELOG_FIXTURE, complete)).not.toThrow();
    expect(bumpFile(entry, CHANGELOG_FIXTURE, complete)).toContain(renderClosingLine(COUNT_A));
  });

  test("omitting the count refuses", () => {
    const { testCount: _dropped, ...withoutCount } = complete;
    expect(() => bumpFile(entry, CHANGELOG_FIXTURE, withoutCount)).toThrow();
  });

  test("the three companions it already demanded still refuse (no regression)", () => {
    const { codename: _c, ...noCodename } = complete;
    const { date: _d, ...noDate } = complete;
    const { changelogBody: _b, ...noBody } = complete;
    expect(() => bumpFile(entry, CHANGELOG_FIXTURE, noCodename)).toThrow();
    expect(() => bumpFile(entry, CHANGELOG_FIXTURE, noDate)).toThrow();
    expect(() => bumpFile(entry, CHANGELOG_FIXTURE, noBody)).toThrow();
  });

  test("the non-changelog kinds are unaffected — the refusal is not blanket", () => {
    const json: ReleaseFile = { path: "pkg.json", kind: "json", field: "version" };
    expect(bumpFile(json, `{"version": "1.0.0"}\n`, { newVersion: "2.0.0" })).toContain("2.0.0");
  });

  test("through the door: a changelog entry with no --test-count refuses and writes nothing", () => {
    const root = makeRoot({
      "CLAUDE.md": CLAUDE_MD_CHANGELOG,
      "CHANGELOG.md": CHANGELOG_FIXTURE,
    });
    const run = runDoor(root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY);
    expectCanonicalRefusal(run);
    expect(read(join(root, "CHANGELOG.md"))).toBe(CHANGELOG_FIXTURE);
    cleanup();
  });

  test("through the door: the same invocation WITH --test-count writes the section", () => {
    const root = makeRoot({
      "CLAUDE.md": CLAUDE_MD_CHANGELOG,
      "CHANGELOG.md": CHANGELOG_FIXTURE,
    });
    const run = runDoor(
      root,
      "2.0.0",
      "--codename",
      "Doorway",
      "--date",
      "2026-09-03",
      "--body",
      BODY,
      "--test-count",
      `${COUNT_A.total},${COUNT_A.failures},${COUNT_A.errors}`,
    );
    expect(run.exitCode, run.stderr).toBe(0);
    const written = read(join(root, "CHANGELOG.md"));
    expect(lastNonEmptyLine(newSectionOf(written, "2.0.0"))).toBe(renderClosingLine(COUNT_A));
    cleanup();
  });
});

// ===========================================================================
// AC-STE-545.5 — exactly ONE renderer, and the M132 suite consumes it
// ===========================================================================

/** Every `.ts` under the plugin's own source and test trees. */
function pluginTsFiles(): string[] {
  const out: string[] = [];
  for (const tree of ["adapters", "tests", "scripts"]) {
    const dir = join(PLUGIN_ROOT, tree);
    for (const rel of new Glob("**/*.ts").scanSync({ cwd: dir, absolute: true })) {
      out.push(rel);
    }
  }
  return out;
}

/** Files under the walk whose content matches `re`, as plugin-relative keys. */
function filesMatching(re: RegExp): string[] {
  const hits: string[] = [];
  for (const abs of pluginTsFiles()) {
    if (re.test(read(abs))) hits.push(abs.slice(PLUGIN_ROOT.length + 1).split("\\").join("/"));
  }
  return hits.sort();
}

describe("AC-STE-545.5 — one renderer for the closing line", () => {
  test("the promoted renderer is exported from test_count_parser.ts and works", () => {
    expect(typeof renderClosingLine).toBe("function");
    expect(renderClosingLine(COUNT_B)).toBe(
      "Total test count at release: 7 tests, 1 failures, 2 errors.",
    );
  });

  test("the M132 suite imports it rather than declaring its own", () => {
    const suite = read(M132_SUITE);
    expect(suite).toMatch(/renderClosingLine/);
    expect(
      suite,
      "tests/m132-ste-508-skip-parsing.test.ts still declares its own renderClosingLine",
    ).not.toMatch(/(?:function|const|let|var)\s+renderClosingLine\b/);
    expect(suite).toMatch(/import\s*\{[^}]*\brenderClosingLine\b[^}]*\}\s*from\s*["'][^"']*test_count_parser["']/s);
  });

  test("the walk itself is not empty — the control for the two zero-hit claims", () => {
    // A zero-hit scan is a claim about the SEARCH. Run the same walk, over the
    // same files, for a token known to be present in several of them: if this
    // came back empty the two assertions below would pass on a broken walker.
    const present = filesMatching(/Total test count at release/);
    expect(pluginTsFiles().length).toBeGreaterThan(100);
    expect(present).toContain("adapters/_shared/src/test_count_parser.ts");
    expect(present.length).toBeGreaterThan(1);
  });

  test("no second DEFINITION of the renderer exists in the tree", () => {
    expect(filesMatching(/(?:function|const|let|var)\s+renderClosingLine\b/)).toEqual([
      "adapters/_shared/src/test_count_parser.ts",
    ]);
  });

  test("no second INTERPOLATION of the sentence exists in the tree", () => {
    // A copy that avoided the name `renderClosingLine` would escape the scan
    // above; the sentence being built from values is the shape that matters.
    expect(filesMatching(/Total test count at release: \$\{/)).toEqual([
      "adapters/_shared/src/test_count_parser.ts",
    ]);
  });
});

// ===========================================================================
// AC-STE-545.6 — the count is FORWARDED, because re-detection here is empty
// ===========================================================================

describe("AC-STE-545.6 — re-detecting the gate at the write step would yield nothing", () => {
  test("gate detection against the PLUGIN directory returns nothing", () => {
    expect(
      detectGate(PLUGIN_ROOT),
      "plugins/dev-process-toolkit carries none of the four stack markers, so a " +
        "re-detection at the write boundary silently yields an empty count",
    ).toBeNull();
  });

  test("gate detection against the REPOSITORY ROOT returns the bun command", () => {
    expect(detectGate(REPO_ROOT)).toEqual({ stack: "bun", command: ["bun", "test"] });
  });

  test("the ordered write step HANDS the count over rather than leaving it to be found", () => {
    // The two legs above are the reason this one exists: a re-detection at the
    // write boundary would be asked about the plugin directory and answer
    // nothing. So the order itself must carry the count.
    const ordered = read(SHIP_SKILL)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((l) => l.includes(RELEASE_CONFIG_KEY) && classifyReferenceLine(l) === "ordered");
    expect(
      ordered.some((l) => /--test-count/.test(l)),
      "the ordered write step does not forward a test count, so the closing line " +
        "is still whatever the operator types from memory:\n" +
        ordered.map((l) => `  - ${l.slice(0, 160)}`).join("\n"),
    ).toBe(true);
  });

  test("the writer forwards rather than measures: it never calls detectGate", () => {
    // Positive control for the spelling — the token IS present where the
    // detector is actually used, so the zero hit below is about the writer.
    expect(read(CAPTURE_SKIP_BASELINE)).toContain("detectGate(");
    expect(
      read(RELEASE_CONFIG),
      `${RELEASE_CONFIG_KEY} re-detects the gate instead of being handed the count the ` +
        `ceremony already measured — and detection answers differently per directory`,
    ).not.toContain("detectGate(");
  });
});

// ===========================================================================
// AC-STE-545.7 — the door flips the class without moving the pin
// ===========================================================================

/**
 * `ORDERED_UNREACHABLE_PIN` as it stood at 41cb1e8 — a bare literal on purpose.
 *
 * BARE, never read back out of the module: a "before" assigned from the same
 * import the "after" comes from is a mirror of the implementation and could
 * never disagree with it, which is the one thing a pin exists to do. Both
 * numbers below keep that property.
 */
const PIN_BEFORE_THE_DOOR = 133;

/**
 * The pin as it stands now — bare, for the same reason.
 *
 * THE DOOR DID NOT MOVE IT. That is what AC-STE-545.7 claims and it held: the
 * entry point plus the reworded write step flipped this module's three shipped
 * references from descriptive-and-unreachable to ordered-and-REACHABLE, and the
 * pin counts neither of those. Measured at 133 with the door landed.
 *
 * It fell by two afterwards, for a LATER and separate reason: closing the
 * `changelog_ci_owned` defect — the ordered writer did not honour the skip the
 * skill body promises — made `release_config.ts` import `./docs_config`.
 * `release_config.ts` now carries `import.meta.main`, and reachability is
 * transitive, so the two ordered references to `docs_config.ts` named below
 * stopped naming a module nothing runnable reaches.
 *
 * 133 → 131 is a LOWERING, the direction the probe module's own doc-comment
 * sanctions: two more orders in this repo are carryable than were before.
 * Re-measured here by running the probe over a pristine 41cb1e8 tree beside
 * the working tree and diffing the two ordered-unreachable SETS, not by
 * trusting either number: the set difference is exactly these two references
 * (the other four deltas are the same four `ship-milestone/SKILL.md` orders at
 * line numbers the prose edit shifted).
 */
const PIN_NOW = 131;

const DOCS_CONFIG_KEY = "adapters/_shared/src/docs_config.ts";

/**
 * The two references the drop is MADE OF, named so the number cannot drift
 * away from its cause. Surfaces are plugin-relative, matching the probe's own
 * record keys once `PLUGIN_ROOT` is stripped.
 */
const FLIPPED_BY_THE_DOCS_CONFIG_IMPORT = [
  { surface: "skills/docs/SKILL.md", line: 23 },
  { surface: "skills/implement/SKILL.md", line: 221 },
] as const;

describe("AC-STE-545.7 — probe #81 stays put while the class flips", () => {
  test("the pin sits at the measured count", () => {
    expect(ORDERED_UNREACHABLE_PIN).toBe(PIN_NOW);
  });

  test("the pin only ever FELL, and by exactly the number of references named as the cause", () => {
    expect(
      PIN_NOW,
      "the pin was RAISED — that ships one more order nobody can carry out",
    ).toBeLessThan(PIN_BEFORE_THE_DOOR);
    expect(
      PIN_BEFORE_THE_DOOR - PIN_NOW,
      "the drop is bigger than the references this file can account for",
    ).toBe(FLIPPED_BY_THE_DOCS_CONFIG_IMPORT.length);
  });

  test("the probe over the working tree is green at that count", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.records.length).toBeGreaterThan(0);
    expect(report.orderedUnreachable).toBe(PIN_NOW);
    expect(report.ok).toBe(true);
  });

  test("every release_config.ts reference is now REACHABLE, and one of them is an order", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const refs = report.records.filter((r) => r.module.endsWith(RELEASE_CONFIG_KEY));
    expect(refs.length, "probe #81 sees no reference to the release-file writer").toBeGreaterThan(0);

    const unreachable = refs.filter((r) => !r.reachable);
    expect(
      unreachable,
      `still unreachable: ${unreachable.map((r) => `${r.surface}:${r.line}`).join(", ")}`,
    ).toEqual([]);

    expect(
      refs.some((r) => r.refClass === "ordered"),
      `no reference to ${RELEASE_CONFIG_KEY} reads as an order: ` +
        refs.map((r) => `${r.surface}:${r.line} (${r.refClass})`).join(", "),
    ).toBe(true);

    // THE DURABLE FORM OF THE AC'S CLAIM, independent of what the global total
    // happens to be: this module contributes ZERO to the class the pin counts.
    // That is the whole reason the door and the rewording had to land in one
    // commit — reworded prose without a door turns these into ordered-and-
    // unreachable and reds the probe.
    const contribution = refs.filter((r) => r.refClass === "ordered" && !r.reachable);
    expect(
      contribution.length,
      `${RELEASE_CONFIG_KEY} contributes to the pinned class: ` +
        contribution.map((r) => `${r.surface}:${r.line}`).join(", "),
    ).toBe(0);

    // Isolation control: "reachable" here is a verdict about this module, not a
    // blanket one. The probe still counts orders nobody can carry out.
    expect(
      report.orderedUnreachable,
      "the probe reports NO unreachable orders anywhere — a leg that cannot fail",
    ).toBeGreaterThan(0);
  });

  test("the two-count drop is attributable: the named docs_config orders are reachable THROUGH the door", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const docsRefs = report.records.filter((r) => r.module.endsWith(DOCS_CONFIG_KEY));

    for (const named of FLIPPED_BY_THE_DOCS_CONFIG_IMPORT) {
      const hit = docsRefs.find(
        (r) => r.surface.endsWith(named.surface) && r.line === named.line,
      );
      expect(hit, `probe #81 no longer sees ${named.surface}:${named.line}`).toBeDefined();
      expect(hit!.refClass, `${named.surface}:${named.line} is no longer an order`).toBe("ordered");
      expect(
        hit!.reachable,
        `${named.surface}:${named.line} is unreachable again — the pin at ${PIN_NOW} is stale`,
      ).toBe(true);
    }

    // WHY they are reachable, read from source rather than asserted in prose:
    // docs_config.ts has no door of its own, so its reachability is purely
    // transitive, and release_config.ts is the importer that supplies it.
    const docsConfigSource = read(join(PLUGIN_ROOT, DOCS_CONFIG_KEY));
    expect(
      docsConfigSource.includes("import.meta.main"),
      "docs_config.ts grew its own entry point — the drop is no longer attributable to the door",
    ).toBe(false);

    const doorSource = read(RELEASE_CONFIG);
    expect(doorSource).toContain("import.meta.main");
    expect(
      doorSource,
      "the door no longer imports docs_config — the two orders above lose their only runnable reacher",
    ).toContain('from "./docs_config"');
  });
});

// ===========================================================================
// CORRECTION ROUND — three defects the AC-STE-545.2 rewrite introduced
// ===========================================================================
//
// The seven ACs above are green. Ordering the writer, however, moved the FIRST
// BYTE WRITTEN from step 7 (after approval) to step 4 (before the diff is even
// rendered), and carried two pieces of prose along that no longer hold:
//
//   D1  write-before-approval. The door writes unconditionally; step 6 still
//       prints `=== Apply? [y/N] ===` and step 8's decline path promises only
//       "no staging, no commit". A declined run now leaves a bumped version and
//       a written CHANGELOG section on disk. Before this FR nothing reached the
//       disk until step 7.
//   D2  `changelog_ci_owned: true` is an unimplemented promise. The step-4
//       prose still says the changelog kind is "Skipped entirely" for such a
//       project; the module carries zero references to `changelog_ci_owned` or
//       `readDocsConfig`. With AC.4's new guard the CI-owned project does not
//       merely get its CHANGELOG rewritten — it is REFUSED outright, where it
//       previously skipped.
//   D3  three wrong step references. The new step-4 prose sources the counts
//       from "step 3" three times. `### 3` is "Prompt for codename", which
//       measures nothing; the counts come from PRE-FLIGHT refusal #3.
//
// RED until: the door takes `--dry-run`, honours `changelog_ci_owned`, and the
// step-4 prose orders the preview while the real write is ordered after the
// step-6 gate.

const DOCS_CONFIG = join(PLUGIN_ROOT, "adapters", "_shared", "src", "docs_config.ts");

/** The one-line verdict a refusal opens with, above its Remedy/Context pair. */
function verdictLine(run: Run): string {
  return (run.stderr.split("\n").find((l) => l.trim() !== "") ?? "").trim();
}

/** Byte-exact contents of the named files, for before/after comparison. */
function snapshot(root: string, rels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of rels) out[rel] = read(join(root, rel));
  return out;
}

const CLAUDE_MD_ALL_THREE_KINDS = [
  "# Fixture",
  "",
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: pkg.json",
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

/** The same block, with a `## Docs` section declaring `changelog_ci_owned`. */
function claudeMdWithDocs(changelogCiOwned: string | null): string {
  const docs =
    changelogCiOwned === null
      ? []
      : [
          "## Docs",
          "",
          "user_facing_mode: false",
          "packages_mode: false",
          `changelog_ci_owned: ${changelogCiOwned}`,
          "",
        ];
  return [CLAUDE_MD_ALL_THREE_KINDS, ...docs].join("\n");
}

const PKG_JSON = JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n";
const README = "Latest: **v1.0.0 — Prior**\n";

function threeKindFixture(claudeMd: string): string {
  return makeRoot({
    "CLAUDE.md": claudeMd,
    "pkg.json": PKG_JSON,
    "CHANGELOG.md": CHANGELOG_FIXTURE,
    "README.md": README,
  });
}

const THREE_KIND_FILES = ["pkg.json", "CHANGELOG.md", "README.md"];
const COUNT_ARG = `${COUNT_A.total},${COUNT_A.failures},${COUNT_A.errors}`;

// ---------------------------------------------------------------------------
// D1 — nothing reaches the disk before the operator approves
// ---------------------------------------------------------------------------

describe("D1 — the door previews under --dry-run and writes nothing", () => {
  test("the positive control: WITHOUT --dry-run the same invocation does write", () => {
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const before = snapshot(root, THREE_KIND_FILES);

    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG,
    );
    expect(run.exitCode, run.stderr).toBe(0);

    const after = snapshot(root, THREE_KIND_FILES);
    // All three kinds actually changed — so "unchanged" below is a real claim.
    for (const rel of THREE_KIND_FILES) expect(after[rel]).not.toBe(before[rel]);
    cleanup();
  });

  test("--dry-run computes every rewrite, prints them, and leaves the tree byte-identical", () => {
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const before = snapshot(root, THREE_KIND_FILES);

    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG, "--dry-run",
    );
    expect(run.exitCode, run.stderr).toBe(0);

    // It PRINTS what it would rewrite — every path the real run touches.
    for (const rel of THREE_KIND_FILES) expect(run.stdout).toContain(rel);
    // …and says so as a preview rather than reporting a write that never
    // happened. Any of the honest markers satisfies this; the wording is free.
    expect(
      /\b(would|dry[- ]?run|preview)/i.test(run.stdout),
      `--dry-run reports its output as if it had written:\n${run.stdout}`,
    ).toBe(true);

    // THE CLAIM: not one byte moved. Measured on disk, not read off a flag.
    expect(snapshot(root, THREE_KIND_FILES)).toEqual(before);
    cleanup();
  });

  test("--dry-run refuses a count-less changelog with the SAME verdict as the real run", () => {
    // A preview that ACCEPTS input the real run rejects is worse than no
    // preview: the operator approves a diff the write step then refuses. The
    // pin is verdict EQUALITY rather than "some refusal happened" — refusing
    // because `--dry-run` itself was misparsed would satisfy the weaker form
    // while previewing nothing.
    const real = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const dry = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const args = ["2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY];

    const realRun = runDoor(real, ...args);
    const dryRun = runDoor(dry, ...args, "--dry-run");
    expectCanonicalRefusal(realRun);
    expectCanonicalRefusal(dryRun);
    expect(
      verdictLine(dryRun),
      `--dry-run refuses for a different reason than the real run does:\n` +
        `  real: ${verdictLine(realRun)}\n  dry : ${verdictLine(dryRun)}`,
    ).toBe(verdictLine(realRun));
    expect(read(join(dry, "CHANGELOG.md"))).toBe(CHANGELOG_FIXTURE);
    cleanup();
  });

  test("--dry-run refuses an absent `## Release Files` block, with that same verdict", () => {
    const files = { "CLAUDE.md": "# Fixture\n\nNo release block here at all.\n", "pkg.json": PKG_JSON };
    const realRun = runDoor(makeRoot(files), "9.9.9");
    const dryRoot = makeRoot(files);
    const dryRun = runDoor(dryRoot, "9.9.9", "--dry-run");
    expectCanonicalRefusal(realRun);
    expectCanonicalRefusal(dryRun);
    expect(verdictLine(dryRun)).toBe(verdictLine(realRun));
    expect(JSON.parse(read(join(dryRoot, "pkg.json"))).version).toBe("1.0.0");
    cleanup();
  });

  test("the ceremony orders the PREVIEW at step 4 and the write only after approval", () => {
    const lines = read(SHIP_SKILL).replace(/\r\n/g, "\n").split("\n");
    const headingIdx = (re: RegExp): number => lines.findIndex((l) => re.test(l));

    const step4 = headingIdx(/^###\s+4\./);
    const step5 = headingIdx(/^###\s+5\./);
    expect(step4, "no `### 4.` heading in skills/ship-milestone/SKILL.md").toBeGreaterThanOrEqual(0);
    expect(step5).toBeGreaterThan(step4);

    const approval = lines.findIndex((l) => l.includes("=== Apply? [y/N] ==="));
    expect(approval, "no `=== Apply? [y/N] ===` gate in the skill body").toBeGreaterThan(step5);

    const orders = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes(RELEASE_CONFIG_KEY) && classifyReferenceLine(l) === "ordered");
    expect(orders.length, "the skill orders the writer nowhere at all").toBeGreaterThan(0);

    const inStep4 = orders.filter(({ i }) => i > step4 && i < step5);
    expect(inStep4.length, "step 4 no longer orders the writer at all").toBeGreaterThan(0);
    expect(
      inStep4.every(({ l }) => l.includes("--dry-run")),
      "step 4 orders a real WRITE before the step-6 approval gate — a declined run " +
        "leaves a bumped version and a written CHANGELOG section on disk:\n" +
        inStep4.map(({ i, l }) => `  ${i + 1}: ${l.slice(0, 160)}`).join("\n"),
    ).toBe(true);

    const afterApproval = orders.filter(({ i, l }) => i > approval && !l.includes("--dry-run"));
    expect(
      afterApproval.length,
      "nothing after the approval gate orders the real write, so the preview is the " +
        "only thing the ceremony ever runs and no release file is ever rewritten:\n" +
        orders.map(({ i, l }) => `  ${i + 1}: ${l.slice(0, 160)}`).join("\n"),
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D2 — `changelog_ci_owned: true` is honoured, not merely promised
// ---------------------------------------------------------------------------

describe("D2 — the writer honours changelog_ci_owned", () => {
  test("the control: readDocsConfig reads the fixture's declaration", () => {
    const root = threeKindFixture(claudeMdWithDocs("true"));
    expect(readDocsConfig(join(root, "CLAUDE.md")).changelogCiOwned).toBe(true);
    const off = threeKindFixture(claudeMdWithDocs("false"));
    expect(readDocsConfig(join(off, "CLAUDE.md")).changelogCiOwned).toBe(false);
    cleanup();
  });

  test("with it true, the changelog is skipped — and NOT refused for a missing count", () => {
    const root = threeKindFixture(claudeMdWithDocs("true"));
    const before = snapshot(root, THREE_KIND_FILES);

    // No --test-count at all: for a CI-owned CHANGELOG there is no section to
    // put one in, so AC.4's guard must not fire on an entry that is skipped.
    const run = runDoor(root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY);
    expect(
      run.exitCode,
      `a CI-owned CHANGELOG project cannot run the release writer at all:\n${run.stderr}`,
    ).toBe(0);

    const after = snapshot(root, THREE_KIND_FILES);
    expect(
      after["CHANGELOG.md"],
      "the CHANGELOG was rewritten even though CI owns it",
    ).toBe(before["CHANGELOG.md"]!);
    expect(run.stdout).toContain("CHANGELOG.md");
    expect(/skip/i.test(run.stdout), `the skip is silent:\n${run.stdout}`).toBe(true);

    // The positive control that keeps this from passing by skipping EVERYTHING:
    // every other kind in the same run still got rewritten.
    expect(JSON.parse(after["pkg.json"]!).version).toBe("2.0.0");
    expect(after["README.md"]).toContain("Latest: **v2.0.0 — ");
    cleanup();
  });

  test("with it false, today's behaviour is unchanged — missing count still refuses", () => {
    const root = threeKindFixture(claudeMdWithDocs("false"));
    const before = snapshot(root, THREE_KIND_FILES);
    expectCanonicalRefusal(
      runDoor(root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY),
    );
    expect(snapshot(root, THREE_KIND_FILES)).toEqual(before);
    cleanup();
  });

  test("with it false and a count supplied, the changelog IS rewritten", () => {
    const root = threeKindFixture(claudeMdWithDocs("false"));
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG,
    );
    expect(run.exitCode, run.stderr).toBe(0);
    const written = read(join(root, "CHANGELOG.md"));
    expect(lastNonEmptyLine(newSectionOf(written, "2.0.0"))).toBe(renderClosingLine(COUNT_A));
    cleanup();
  });

  test("an ABSENT `## Docs` section behaves exactly as false", () => {
    const root = threeKindFixture(claudeMdWithDocs(null));
    const before = snapshot(root, THREE_KIND_FILES);
    expectCanonicalRefusal(
      runDoor(root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY),
    );
    expect(snapshot(root, THREE_KIND_FILES)).toEqual(before);
    cleanup();
  });

  test("a malformed declaration refuses rather than being read as false", () => {
    // The leg that kills a substring sniff for `changelog_ci_owned: true`:
    // `readDocsConfig` throws `MalformedDocsConfigError` on anything but the
    // lowercase literals, and the door must surface that, not swallow it.
    expect(read(DOCS_CONFIG)).toContain("MalformedDocsConfigError");
    const root = threeKindFixture(claudeMdWithDocs("yes"));
    const before = snapshot(root, THREE_KIND_FILES);
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG,
    );
    expectCanonicalRefusal(run);
    expect(snapshot(root, THREE_KIND_FILES)).toEqual(before);
    cleanup();
  });

  test("the promise in the skill body is one the module can keep", () => {
    // The prose has claimed the skip since before the door existed. Either the
    // module implements it or the sentence comes out — this pins the first.
    expect(read(SHIP_SKILL)).toContain("changelog_ci_owned");
    expect(
      read(RELEASE_CONFIG),
      `${RELEASE_CONFIG_KEY} never reads the docs config, so the skip promised by ` +
        `skills/ship-milestone/SKILL.md is made by prose alone`,
    ).toContain("readDocsConfig");
  });
});

// ---------------------------------------------------------------------------
// D3 — step 4 points at the run that actually measured the counts
// ---------------------------------------------------------------------------

/** One `### N.` section of the skill body, up to the next `##`/`###` heading. */
function shipSkillSection(re: RegExp): string {
  const lines = read(SHIP_SKILL).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => re.test(l));
  expect(start, `no heading matching ${re} in skills/ship-milestone/SKILL.md`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###?\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("D3 — the counts are attributed to the pre-flight gate run, not to `### 3`", () => {
  test("the control: the measurement lives in the PRE-FLIGHT test-gate refusal", () => {
    const preflight = shipSkillSection(/^## Pre-flight refusals/);
    expect(preflight).toMatch(/Test gate red/);
    expect(preflight).toMatch(/TestCount/);
    expect(preflight).toMatch(/test_count_parser/);
  });

  test("the control: `### 3` measures nothing — it prompts for a codename", () => {
    const three = shipSkillSection(/^###\s+3\./);
    expect(three).toMatch(/codename/i);
    expect(
      /TestCount|parseTestOutput|test count/i.test(three),
      "`### 3` does measure test counts after all — then the shipped pointers were right " +
        "and this whole block is wrong:\n" + three,
    ).toBe(false);
  });

  test("the control: step 4 does talk about where the counts came from", () => {
    // Without this, the scan below could pass on a step 4 that dropped the
    // attribution entirely rather than corrected it.
    const four = shipSkillSection(/^###\s+4\./);
    expect(four).toMatch(/--test-count/);
    expect(four).toMatch(/count/i);
  });

  test("step 4 no longer sources the counts from `step 3`", () => {
    const four = shipSkillSection(/^###\s+4\./);
    const hits = four.split("\n").filter((l) => /\bstep 3\b/i.test(l));
    expect(
      hits,
      "step 4 sources the release counts from `step 3`, and the document's own " +
        "convention resolves a bare `step N` to `### N` — which is \"Prompt for " +
        "codename\" and measures nothing. The counts come from pre-flight refusal #3:\n" +
        hits.map((l) => `  - ${l.trim().slice(0, 160)}`).join("\n"),
    ).toEqual([]);
  });

  test("step 4 names the pre-flight test-gate run where it sources the counts", () => {
    // An alternation, not a single blessed wording: any pointer that lands the
    // reader on the pre-flight gate run satisfies this. What is NOT enough is
    // the phrase appearing anywhere in step 4 — the section already opens with
    // an unrelated "Migration-coverage pre-flight", so the pointer has to sit
    // on a line that is actually talking about the counts.
    const four = shipSkillSection(/^###\s+4\./);
    const countLines = four.split("\n").filter((l) => /count/i.test(l));
    expect(countLines.length, "step 4 says nothing about the counts at all").toBeGreaterThan(0);
    expect(
      countLines.some((l) => /pre-?flight|refusal #?3|test[- ]gate/i.test(l)),
      "no line in step 4 attributes the counts to the run that measured them, so the " +
        "reader has no way to find the number the closing line is supposed to carry:\n" +
        countLines.map((l) => `  - ${l.trim().slice(0, 160)}`).join("\n"),
    ).toBe(true);
  });

  test("the targeted scan leaves step 4's CORRECT back-references alone", () => {
    // `### 2` really is where the version comes from. A blanket \"no step N\"
    // rule would have flagged this too, and would have been the wrong fix.
    const four = shipSkillSection(/^###\s+4\./);
    expect(four).toMatch(/\bstep 2\b/);
  });
});

// ===========================================================================
// CORRECTION ROUND 2 — eight defects a second audit found in round 1's fixes
// ===========================================================================
//
// MEASURED against the working tree by running the door as a subprocess and
// reading the two shipped prose surfaces, not quoted from the audit:
//
//   E1  docs/ship-milestone-reference.md:132-134 still carries
//       "## Dry run (deferred decision from M20 brainstorm)" and says
//       `--dry-run` "is intentionally not shipped". Step 4 orders it.
//   E2  `--dry-run` prints `would rewrite pkg.json (dry-run)` and nothing
//       more; step 6 promises "a single unified diff" and renders
//       `=== Proposed diff (N files, M lines) ===`. NOTHING produces those
//       hunks — the computed new content is discarded at the end of the
//       preview, so the operator approves release-file hunks that no step
//       generated, which is the hand-work AC.2 exists to remove.
//   E3  step 7 applies the rewrites BEFORE `requireCommittableBranch`, whose
//       `declined` leg "rolls back staging via `git reset HEAD <paths>`" —
//       nothing is staged yet, and the bumped files stay on disk. A re-run
//       then reads the bumped version at step 2 and double-bumps. Same class
//       as D1, one gate later.
//   E4  step 6 offers `e` to edit the proposed CHANGELOG entry; step 7 says
//       "Same arguments as the preview", so an edited body has no route into
//       the command and is silently discarded.
//   E5  step 4 quotes `Remedy: add a \`## Release Files\` block to CLAUDE.md
//       (run /setup or copy from examples/<stack>/release.yml). Context:
//       skill=ship-milestone`. MEASURED, the door prints
//       `Remedy: fix the \`## Release Files\` block in CLAUDE.md (or the
//       offending file) and re-run; nothing was written.` and
//       `Context: root=…, version=…, skill=ship-milestone`.
//   E6  `readDocsConfig` finds its section with `l === "## Docs"` after a bare
//       `split("\n")`, so a CRLF CLAUDE.md yields `"## Docs\r"`, no match, and
//       all-false — the CHANGELOG is rewritten despite `changelog_ci_owned:
//       true`. MEASURED, `parseFilesYaml` is not CRLF-clean either: it
//       normalizes `\r\n` pairs but the fenced payload's LAST line keeps an
//       orphan `\r`, `.` never matches a line terminator, so that line is
//       dropped and the entry refuses with "missing required field `kind`".
//       Prior art: the 2026-07-26 CRLF/BOM sweep across 16 frontmatter
//       readers.
//   E7  the argv loop enumerates only BOOLEAN_FLAGS; any other `--`-prefixed
//       token is stored and ignored, consuming the following value. MEASURED:
//       `--dryrun --codename Zed` printed `rewrote v.json`, exited 0, and left
//       `2.0.0` on disk. For a flag whose whole purpose is "nothing reaches
//       disk", failing open on a misspelling is the wrong default.
//   E8  the refusal envelope ends "nothing was written." but is emitted from a
//       catch that also covers the real-mode write loop. MEASURED: with entry
//       2 of 2 unwritable, entry 1 was rewritten to 2.0.0 and the envelope
//       still said nothing was written. The same envelope also misdirects on a
//       MalformedDocsConfigError, telling the operator to fix the
//       `## Release Files` block when the offending block is `## Docs`.

const SHIP_REFERENCE = join(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");

/** Lines of a file, CRLF-normalized — the same treatment the legs above use. */
function linesOf(path: string): string[] {
  return read(path).replace(/\r\n/g, "\n").split("\n");
}

// ---------------------------------------------------------------------------
// E1 — the reference stops declaring a shipped flag unshipped
// ---------------------------------------------------------------------------

/**
 * The reference's dry-run section exactly as it stands — bare literals, and
 * the falsifiability controls for the two detectors below. A detector that
 * cannot flag THIS text is not a detector.
 */
const REFERENCE_DRY_RUN_BODY_AS_SHIPPED =
  "`--dry-run` is intentionally not shipped. The human-approval gate (step 6) " +
  "already functions as a dry run: the user sees the full diff and can refuse. " +
  "An explicit `--dry-run` flag remains on the deferred-decisions list; add " +
  "when dogfooding surfaces the need.";

const REFERENCE_DRY_RUN_HEADING_AS_SHIPPED = "## Dry run (deferred decision from M20 brainstorm)";

const DEFERRAL_LANGUAGE =
  /\b(not shipped|unshipped|not implemented|deferred|deferred-decisions|not yet (?:shipped|implemented))\b/i;

/** A line that names the flag AND calls it unshipped. */
function declaresFlagUnshipped(line: string): boolean {
  return /--dry-run/.test(line) && DEFERRAL_LANGUAGE.test(line);
}

/** A heading that files a "Dry run" section under deferred decisions. */
function headingDefersDryRun(line: string): boolean {
  return /^#{1,6}\s/.test(line) && /dry[- ]?run/i.test(line) && DEFERRAL_LANGUAGE.test(line);
}

describe("E1 — the reference does not declare the shipped --dry-run unshipped", () => {
  test("the control: both detectors flag the text as it shipped", () => {
    expect(declaresFlagUnshipped(REFERENCE_DRY_RUN_BODY_AS_SHIPPED)).toBe(true);
    expect(headingDefersDryRun(REFERENCE_DRY_RUN_HEADING_AS_SHIPPED)).toBe(true);
  });

  test("the isolation control: neither detector flags a line that merely uses the flag", () => {
    // Without this pair the legs below would pass by flagging everything —
    // or, worse, would demand the reference never mention `--dry-run` at all.
    const orderly =
      "`--dry-run` here because nothing may reach disk before the step-6 approval; " +
      "step 7 runs the same line without it.";
    expect(declaresFlagUnshipped(orderly)).toBe(false);
    expect(headingDefersDryRun("## Dry run")).toBe(false);
  });

  test("the flag really is shipped — the ceremony orders it", () => {
    // The reason the reference is wrong rather than merely stale: the shipped
    // skill body runs the flag it says does not exist.
    expect(read(SHIP_SKILL)).toContain("--dry-run");
    expect(read(RELEASE_CONFIG)).toContain('"--dry-run"');
  });

  test("no line of the reference calls the flag unshipped", () => {
    const hits = linesOf(SHIP_REFERENCE).filter(declaresFlagUnshipped);
    expect(
      hits,
      "docs/ship-milestone-reference.md tells the reader `--dry-run` is not shipped, " +
        "while skills/ship-milestone/SKILL.md step 4 orders it:\n" +
        hits.map((l) => `  - ${l.trim().slice(0, 160)}`).join("\n"),
    ).toEqual([]);
  });

  test("no heading of the reference files the flag under deferred decisions", () => {
    const hits = linesOf(SHIP_REFERENCE).filter(headingDefersDryRun);
    expect(
      hits,
      "docs/ship-milestone-reference.md still carries a deferred-decision heading for " +
        "a flag that shipped:\n" + hits.map((l) => `  - ${l.trim()}`).join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E2 — the approval diff has a producer
// ---------------------------------------------------------------------------

/** A real unified diff, for calibrating the detectors below. */
const SYNTHETIC_UNIFIED_DIFF = [
  "--- a/pkg.json",
  "+++ b/pkg.json",
  "@@ -1,3 +1,3 @@",
  " {",
  '-  "version": "1.0.0"',
  '+  "version": "2.0.0"',
  " }",
].join("\n");

/** The round-1 preview output, verbatim — the thing that is NOT a diff. */
const PREVIEW_OUTPUT_AS_SHIPPED = "would rewrite pkg.json (dry-run)\n";

function hasHunkHeader(text: string): boolean {
  return /^@@ +-\d+(?:,\d+)? +\+\d+(?:,\d+)? +@@/m.test(text);
}
function hasFileHeaders(text: string): boolean {
  return /^--- +\S/m.test(text) && /^\+\+\+ +\S/m.test(text);
}
/** Added / removed body lines, excluding the `+++` / `---` file headers. */
function diffBodyLines(text: string, sign: "+" | "-"): string[] {
  const header = sign === "+" ? "+++" : "---";
  return text
    .split("\n")
    .filter((l) => l.startsWith(sign) && !l.startsWith(header));
}

describe("E2 — --dry-run emits the unified diff step 6 asks the operator to approve", () => {
  test("the control: the detectors read a real diff, and reject the round-1 output", () => {
    expect(hasHunkHeader(SYNTHETIC_UNIFIED_DIFF)).toBe(true);
    expect(hasFileHeaders(SYNTHETIC_UNIFIED_DIFF)).toBe(true);
    expect(diffBodyLines(SYNTHETIC_UNIFIED_DIFF, "+").length).toBe(1);
    expect(diffBodyLines(SYNTHETIC_UNIFIED_DIFF, "-").length).toBe(1);

    expect(hasHunkHeader(PREVIEW_OUTPUT_AS_SHIPPED)).toBe(false);
    expect(hasFileHeaders(PREVIEW_OUTPUT_AS_SHIPPED)).toBe(false);
  });

  test("the preview prints recognisable unified-diff hunks for every changed path", () => {
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const before = snapshot(root, THREE_KIND_FILES);

    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG, "--dry-run",
    );
    expect(run.exitCode, run.stderr).toBe(0);

    expect(
      hasHunkHeader(run.stdout),
      "`--dry-run` prints no `@@` hunk header, so step 6's `=== Proposed diff " +
        "(N files, M lines) ===` has no producer and the operator approves " +
        "release-file hunks nothing generated:\n" + run.stdout,
    ).toBe(true);
    expect(
      hasFileHeaders(run.stdout),
      `the preview carries no per-file \`---\`/\`+++\` headers:\n${run.stdout}`,
    ).toBe(true);

    // It holds BOTH sides in memory, so both sides must reach the operator.
    const added = diffBodyLines(run.stdout, "+").join("\n");
    const removed = diffBodyLines(run.stdout, "-").join("\n");
    expect(added, `no added lines carrying the new version:\n${run.stdout}`).toContain("2.0.0");
    expect(removed, `no removed lines carrying the old version:\n${run.stdout}`).toContain("1.0.0");
    expect(added).toContain(renderClosingLine(COUNT_A));

    // Still a preview: the diff is what changes, not the tree.
    expect(snapshot(root, THREE_KIND_FILES)).toEqual(before);
    cleanup();
  });

  test("the diff is computed, not templated — two versions give two different diffs", () => {
    const args = (v: string) =>
      [v, "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY,
       "--test-count", COUNT_ARG, "--dry-run"] as const;
    const a = runDoor(threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS), ...args("2.0.0"));
    const b = runDoor(threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS), ...args("3.1.4"));
    expect(a.exitCode, a.stderr).toBe(0);
    expect(b.exitCode, b.stderr).toBe(0);
    expect(diffBodyLines(a.stdout, "+").join("\n")).toContain("2.0.0");
    expect(diffBodyLines(b.stdout, "+").join("\n")).toContain("3.1.4");
    expect(a.stdout).not.toBe(b.stdout);
    cleanup();
  });

  test("a skipped entry contributes no hunk — the diff describes what would change", () => {
    const root = threeKindFixture(claudeMdWithDocs("true"));
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--dry-run",
    );
    expect(run.exitCode, run.stderr).toBe(0);
    expect(
      diffBodyLines(run.stdout, "+").join("\n"),
      "the preview shows CHANGELOG additions for a project whose CI owns the CHANGELOG",
    ).not.toContain(renderClosingLine(COUNT_A));
    // Positive control: the run still diffs the entries it WOULD rewrite.
    expect(hasHunkHeader(run.stdout), run.stdout).toBe(true);
    cleanup();
  });

  test("step 6 says where the release-file half of the diff comes from", () => {
    const step6 = shipSkillSection(/^###\s+6\./);
    // The control: step 6 really is the section that renders a diff.
    expect(step6).toContain("=== Proposed diff");

    const sourced = step6
      .split("\n")
      .filter((l) => /diff|hunk/i.test(l) && /step[- ]?4|preview|--dry-run/i.test(l));
    expect(
      sourced.length,
      "step 6 renders `=== Proposed diff (N files, M lines) ===` without naming anything " +
        "that produces the release-file hunks. Step 4's `--dry-run` holds both sides in " +
        "memory; if the prose does not route them here, the operator approves a diff the " +
        "ceremony assembles by hand:\n" + step6,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// E3 — the branch gate runs BEFORE the first byte is written
// ---------------------------------------------------------------------------

describe("E3 — a declined branch gate cannot leave bumped files on disk", () => {
  test("the control: the ceremony has an approval gate, a branch gate, and a real write", () => {
    const lines = linesOf(SHIP_SKILL);
    expect(lines.findIndex((l) => l.includes("=== Apply? [y/N] ==="))).toBeGreaterThanOrEqual(0);
    expect(lines.findIndex((l) => l.includes("requireCommittableBranch"))).toBeGreaterThanOrEqual(0);
    const realWrites = lines.filter(
      (l) =>
        l.includes(RELEASE_CONFIG_KEY) &&
        classifyReferenceLine(l) === "ordered" &&
        !l.includes("--dry-run"),
    );
    expect(realWrites.length, "the ceremony never orders a real write at all").toBeGreaterThan(0);
  });

  test("the branch gate is ordered before the rewrites it would otherwise have to undo", () => {
    const lines = linesOf(SHIP_SKILL);
    const approval = lines.findIndex((l) => l.includes("=== Apply? [y/N] ==="));
    const branchGate = lines.findIndex((l) => l.includes("requireCommittableBranch"));
    const realWrite = lines.findIndex(
      (l, i) =>
        i > approval &&
        l.includes(RELEASE_CONFIG_KEY) &&
        classifyReferenceLine(l) === "ordered" &&
        !l.includes("--dry-run"),
    );
    expect(realWrite, "no real write is ordered after the approval gate").toBeGreaterThan(approval);
    expect(branchGate, "no branch gate in the skill body").toBeGreaterThan(approval);

    expect(
      branchGate,
      `skills/ship-milestone/SKILL.md orders the release-file rewrites at line ${realWrite + 1} ` +
        `and the branch gate at line ${branchGate + 1}. The gate's \`declined\` leg rolls back ` +
        `STAGING (\`git reset HEAD <paths>\`) — nothing is staged yet and the bumped files stay ` +
        `on disk, so a re-run reads the already-bumped version at step 2 and double-bumps, ` +
        `inserting a second CHANGELOG section. The write depends on nothing the gate produces.`,
    ).toBeLessThan(realWrite);
  });

  test("the decline path says what happens to the release files, not only to staging", () => {
    const step7 = shipSkillSection(/^###\s+7\./);
    // The control: the decline leg is described at all.
    expect(step7).toMatch(/declined/);
    const declineLines = step7.split("\n").filter((l) => /declined/.test(l));
    expect(
      declineLines.some((l) => /before .*rewrite|no release file|nothing (?:is )?(?:rewritten|written)|before any (?:file )?(?:is )?(?:re)?written/i.test(l)),
      "the `declined` leg promises only a staging rollback. With the write ordered above it " +
        "that promise is false for every release file:\n" +
        declineLines.map((l) => `  - ${l.trim().slice(0, 200)}`).join("\n"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E4 — the `e` edit-in-loop is routed, or it is gone
// ---------------------------------------------------------------------------

/** Step 7's hand-off sentence as it shipped — the control for `routesEdit`. */
const STEP_7_HANDOFF_AS_SHIPPED =
  "Same arguments as the preview, so what lands on disk is what the operator approved. " +
  "A refusal here aborts before the commit.";

/** A line that routes an edited body into the write command. */
function routesEditedBody(line: string): boolean {
  return /--body/.test(line) && /\bedit(?:ed|s|ing)?\b/i.test(line);
}

/** A surface that offers the `e` option at the approval prompt. */
function offersEditOption(text: string): boolean {
  return /`e`/.test(text) && /\$EDITOR|edit/i.test(text);
}

describe("E4 — an edited CHANGELOG entry has somewhere to go", () => {
  test("the control: `routesEditedBody` rejects the shipped hand-off and accepts a routed one", () => {
    expect(routesEditedBody(STEP_7_HANDOFF_AS_SHIPPED)).toBe(false);
    expect(
      routesEditedBody(
        "If the operator edited the entry at step 6, the edited body is what `--body` carries here.",
      ),
    ).toBe(true);
  });

  test("the control: `offersEditOption` reads the shipped step-6 sentence", () => {
    expect(
      offersEditOption(
        "The user can type `e` to open `$EDITOR` on the proposed CHANGELOG entry, then re-prompt.",
      ),
    ).toBe(true);
    expect(offersEditOption("Accept case-insensitive `y` / `yes` as approval.")).toBe(false);
  });

  test("if step 6 offers `e`, step 7 says what the edited body does", () => {
    const step6 = shipSkillSection(/^###\s+6\./);
    const step7 = shipSkillSection(/^###\s+7\./);
    const offered = offersEditOption(step6);
    const routed = step7.split("\n").some(routesEditedBody);
    expect(
      offered && !routed,
      "step 6 offers `e` to edit the proposed CHANGELOG entry, but step 7 re-runs the writer " +
        "with the same arguments as the preview, so the edited body is silently discarded. " +
        "Either the ceremony says the edit is what `--body` carries on the step-7 run, or the " +
        "option comes out:\n--- step 6 ---\n" + step6 + "\n--- step 7 ---\n" + step7,
    ).toBe(false);
  });

  test("the skill body and the reference agree about whether the option exists", () => {
    // Surface parity: this repo's standing drift class. Whichever resolution
    // lands, the two surfaces must land together — a reference that documents
    // an `e` the skill no longer offers is the same defect in the mirror.
    const step6 = shipSkillSection(/^###\s+6\./);
    const referenceOffers = linesOf(SHIP_REFERENCE).some(
      (l) => /edit-in-loop/i.test(l) || (offersEditOption(l) && /approval prompt/i.test(l)),
    );
    expect(
      offersEditOption(step6),
      "skills/ship-milestone/SKILL.md and docs/ship-milestone-reference.md disagree about " +
        "whether the `e` edit-in-loop exists",
    ).toBe(referenceOffers);
  });
});

// ---------------------------------------------------------------------------
// E5 — the quoted refusal matches what the door really prints
// ---------------------------------------------------------------------------

/** Every `Remedy:` / `Context:` fragment quoted inside a chunk of prose. */
function quotedEnvelopeFragments(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(Remedy|Context):\s*([^\n`]+)/g)) {
    const body = (m[2] ?? "").trim().replace(/[.\s]+$/, "");
    if (body !== "") out.push(`${m[1]}: ${body}`);
  }
  return out;
}

describe("E5 — step 4 quotes the refusal the door actually emits", () => {
  const noBlockRoot = (): string =>
    makeRoot({
      "CLAUDE.md": "# Fixture\n\nNo release block here at all.\n",
      "pkg.json": PKG_JSON,
    });

  test("the control: the extractor finds the fragments in the text as it shipped", () => {
    const asShipped =
      "Refusals: `MissingReleaseFilesBlockError` and `MalformedReleaseFilesError` both abort " +
      "the run with the canonical NFR-10 shape — Remedy: add a `## Release Files` block to " +
      "CLAUDE.md (run /setup or copy from examples/<stack>/release.yml). Context: " +
      "skill=ship-milestone.";
    const found = quotedEnvelopeFragments(asShipped);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.startsWith("Remedy:"))).toBe(true);
  });

  test("the control: the door does emit a Remedy and a Context on this refusal", () => {
    const run = runDoor(noBlockRoot(), "9.9.9");
    expectCanonicalRefusal(run);
    expect(run.stderr).toMatch(/^Remedy: /m);
    expect(run.stderr).toMatch(/^Context: /m);
    // The isolation control: a fragment the door does NOT print is not found,
    // so "contained in stderr" below is a real test rather than a tautology.
    expect(run.stderr).not.toContain("Remedy: recite this from memory");
    cleanup();
  });

  test("every envelope fragment step 4 quotes appears verbatim in the door's stderr", () => {
    const run = runDoor(noBlockRoot(), "9.9.9");
    expectCanonicalRefusal(run);
    const quoted = quotedEnvelopeFragments(shipSkillSection(/^###\s+4\./));
    const wrong = quoted.filter((frag) => !run.stderr.includes(frag));
    expect(
      wrong,
      "skills/ship-milestone/SKILL.md step 4 quotes a refusal the door never prints. " +
        "Now that the step is executable the quote is checkable, and it is wrong.\n" +
        "quoted:\n" + wrong.map((f) => `  - ${f}`).join("\n") +
        "\nreally printed:\n" + run.stderr.split("\n").map((l) => `  | ${l}`).join("\n"),
    ).toEqual([]);
    cleanup();
  });

  test("the door's Context names the root and the version, and the quote must too", () => {
    const root = noBlockRoot();
    const run = runDoor(root, "9.9.9");
    const context = run.stderr.split("\n").find((l) => l.startsWith("Context: ")) ?? "";
    expect(context).toContain("root=");
    expect(context).toContain("version=9.9.9");
    expect(context).toContain("skill=ship-milestone");

    const quotedContexts = quotedEnvelopeFragments(shipSkillSection(/^###\s+4\./)).filter((f) =>
      f.startsWith("Context:"),
    );
    for (const q of quotedContexts) {
      expect(
        run.stderr.includes(q),
        `step 4 quotes \`${q}\`; the door prints \`${context}\``,
      ).toBe(true);
    }
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// E6 — a CRLF-authored declaration is honoured
// ---------------------------------------------------------------------------

const crlf = (s: string): string => s.replace(/\r?\n/g, "\r\n");
const BOM = "\uFEFF";

describe("E6 — the CI-ownership declaration survives CRLF and BOM", () => {
  test("the control: the LF form reads true, and a false one reads false", () => {
    const root = makeRoot({
      "true.md": "# T\n\n## Docs\n\nchangelog_ci_owned: true\n",
      "false.md": "# T\n\n## Docs\n\nchangelog_ci_owned: false\n",
    });
    expect(readDocsConfig(join(root, "true.md")).changelogCiOwned).toBe(true);
    expect(readDocsConfig(join(root, "false.md")).changelogCiOwned).toBe(false);
    cleanup();
  });

  test("a CRLF-authored declaration reads true", () => {
    const root = makeRoot({ "CLAUDE.md": crlf("# T\n\n## Docs\n\nchangelog_ci_owned: true\n") });
    expect(
      readDocsConfig(join(root, "CLAUDE.md")).changelogCiOwned,
      "`readDocsConfig` matches its heading with `l === \"## Docs\"` after a bare " +
        "`split(\"\\n\")`, so on a CRLF file the line is `\"## Docs\\r\"`, nothing matches, " +
        "and all-false is returned — the CHANGELOG is rewritten despite the project " +
        "declaring that CI owns it. D2 fails OPEN.",
    ).toBe(true);
    cleanup();
  });

  test("a CRLF-authored `false` still reads false — the fix is not `true` on CRLF", () => {
    const root = makeRoot({ "CLAUDE.md": crlf("# T\n\n## Docs\n\nchangelog_ci_owned: false\n") });
    expect(readDocsConfig(join(root, "CLAUDE.md")).changelogCiOwned).toBe(false);
    cleanup();
  });

  test("a BOM ahead of the heading does not hide it", () => {
    // Same reader, same class. MEASURED: a BOM is harmless when `## Docs` is
    // not the first line, and blinding when it is — which is exactly the shape
    // the 2026-07-26 sweep closed across 16 frontmatter readers.
    const root = makeRoot({
      "first.md": BOM + "## Docs\n\nchangelog_ci_owned: true\n",
      "later.md": BOM + "# T\n\n## Docs\n\nchangelog_ci_owned: true\n",
    });
    expect(readDocsConfig(join(root, "later.md")).changelogCiOwned).toBe(true);
    expect(
      readDocsConfig(join(root, "first.md")).changelogCiOwned,
      "a BOM ahead of a leading `## Docs` heading makes the whole section invisible",
    ).toBe(true);
    cleanup();
  });

  test("the OTHER reader of the same file is not CRLF-clean either", () => {
    // `parseFilesYaml` normalizes `\r\n` PAIRS, but the fenced payload's last
    // line keeps an orphan `\r` (the closing fence's `\n` consumed its
    // partner). `.` never matches a line terminator, so `^(\s*)(- )?(.*)$`
    // fails on that line and it is dropped — MEASURED as
    // `entry 0: missing required field \`kind\``.
    const lf = claudeMdWithDocs("true");
    const expected = parseReleaseFiles(lf);
    expect(expected.length, "the LF control parsed nothing — the fixture is wrong").toBeGreaterThan(0);
    expect(
      () => parseReleaseFiles(crlf(lf)),
      "a CRLF CLAUDE.md cannot be released at all: the last key of the last entry is " +
        "silently dropped by the fenced-payload walk",
    ).not.toThrow();
    expect(parseReleaseFiles(crlf(lf))).toEqual(expected);
  });

  test("through the door: a CRLF project with CI-owned CHANGELOG skips it and bumps the rest", () => {
    const root = threeKindFixture(crlf(claudeMdWithDocs("true")));
    const before = snapshot(root, THREE_KIND_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03", "--body", BODY);
    expect(
      run.exitCode,
      `a CRLF-authored project cannot run the release writer at all:\n${run.stderr}`,
    ).toBe(0);

    const after = snapshot(root, THREE_KIND_FILES);
    expect(
      after["CHANGELOG.md"],
      "the CHANGELOG was rewritten on a CRLF project that declared `changelog_ci_owned: true`",
    ).toBe(before["CHANGELOG.md"]!);
    // The positive control that keeps this from passing by skipping everything.
    expect(JSON.parse(after["pkg.json"]!).version).toBe("2.0.0");
    expect(after["README.md"]).toContain("Latest: **v2.0.0 — ");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// E7 — an unknown flag refuses instead of eating the next argument
// ---------------------------------------------------------------------------

/**
 * A fixture with NO `changelog` entry, on purpose.
 *
 * The three-kind fixture would hide this defect: `--dryrun` eats the
 * `--codename` behind it, and the changelog guard then refuses for a missing
 * codename — so the run "refuses and writes nothing" for a reason that has
 * nothing to do with the unknown flag, and the leg passes while the defect
 * stands. MEASURED against a json+regex project, the same invocation printed
 * `rewrote pkg.json`, exited 0, and left the real bump on disk.
 */
function jsonAndRegexFixture(): string {
  return makeRoot({
    "CLAUDE.md": CLAUDE_MD_JSON_AND_REGEX,
    "pkg.json": PKG_JSON,
    "README.md": README,
  });
}
const JSON_AND_REGEX_FILES = ["pkg.json", "README.md"];

describe("E7 — a mistyped flag cannot perform the real write", () => {
  test("the control: the flags the door does know still work, on this same fixture", () => {
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const dry = runDoor(root, "2.0.0", "--dry-run");
    expect(dry.exitCode, dry.stderr).toBe(0);
    expect(snapshot(root, JSON_AND_REGEX_FILES)).toEqual(before);

    // …and the real run on the same fixture does write, so "unchanged" below
    // is a claim about the flag rather than about an inert fixture.
    const real = runDoor(root, "2.0.0");
    expect(real.exitCode, real.stderr).toBe(0);
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("2.0.0");
    cleanup();
  });

  test("`--dryrun` refuses and writes nothing", () => {
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    // Mid-argv, with a token behind it: the shipped loop stores the unknown
    // flag, consumes `--codename`, and proceeds to the REAL write. (Trailing,
    // it falls into the "given with no value" branch instead — the leg at the
    // bottom of this block guards that half.)
    const run = runDoor(root, "2.0.0", "--dryrun", "--codename", "Doorway");
    expectCanonicalRefusal(run);
    expect(
      snapshot(root, JSON_AND_REGEX_FILES),
      "a mistyped `--dryrun` performed the REAL write — the flag whose whole purpose is " +
        "\"nothing reaches disk\" fails open on a misspelling",
    ).toEqual(before);
    cleanup();
  });

  test("the refusal names the flag it did not recognise", () => {
    const root = jsonAndRegexFixture();
    const run = runDoor(root, "2.0.0", "--dryrun", "--codename", "Doorway");
    expect(run.stderr, `the refusal does not say which flag was wrong:\n${run.stderr}`).toContain(
      "--dryrun",
    );
    cleanup();
  });

  test("an unknown flag does not swallow the argument behind it", () => {
    // The shipped loop stores the unknown flag and consumes the NEXT token, so
    // `--dryrun --codename Zed` silently ate `--codename` too and dropped
    // `Zed` into the positionals. Whatever the refusal says, it must not be
    // about a missing codename — that would be a report about argv damage the
    // parser itself caused.
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const run = runDoor(
      root, "2.0.0", "--dryrun", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG,
    );
    expectCanonicalRefusal(run);
    expect(verdictLine(run)).not.toMatch(/codename/i);
    cleanup();
  });

  test("an unknown flag in trailing position already refuses — and must keep doing so", () => {
    // GREEN as shipped, and kept as a regression guard: with nothing behind it
    // the unknown flag falls into the "given with no value" branch. The fix
    // must not trade this refusal away while closing the mid-argv one.
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--dryrun");
    expectCanonicalRefusal(run);
    expect(run.stderr).toContain("--dryrun");
    expect(snapshot(root, JSON_AND_REGEX_FILES)).toEqual(before);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// E8 — the refusal envelope tells the truth
// ---------------------------------------------------------------------------

const CLAUDE_MD_TWO_JSON = [
  "# Fixture",
  "",
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: first.json",
  "    kind: json",
  "    field: version",
  "  - path: second.json",
  "    kind: json",
  "    field: version",
  "```",
  "",
].join("\n");

/** The `Remedy:` line of a refusal, or "" when there is none. */
function remedyLine(run: Run): string {
  return (run.stderr.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "").trim();
}

const CLAIMS_NOTHING_WRITTEN = /nothing (?:was |is )?(?:written|rewritten)/i;

describe("E8 — the envelope claims nothing was written only when nothing was", () => {
  test("the control: on a pre-write refusal the claim is TRUE and must still be made", () => {
    // Without this leg the assertion below is satisfied by deleting the
    // sentence — which loses the operator the one thing it tells them.
    const root = makeRoot({
      "CLAUDE.md": "# Fixture\n\nNo release block here at all.\n",
      "pkg.json": PKG_JSON,
    });
    const run = runDoor(root, "9.9.9");
    expectCanonicalRefusal(run);
    expect(
      CLAIMS_NOTHING_WRITTEN.test(run.stderr),
      `a refusal that genuinely wrote nothing no longer says so:\n${run.stderr}`,
    ).toBe(true);
    expect(read(join(root, "pkg.json"))).toBe(PKG_JSON);
    cleanup();
  });

  test("a write that fails partway through does not report that nothing was written", () => {
    const root = makeRoot({
      "CLAUDE.md": CLAUDE_MD_TWO_JSON,
      "first.json": PKG_JSON,
      "second.json": PKG_JSON,
    });
    // Entry 2 of 2 is unwritable, so the real-mode loop throws AFTER entry 1
    // has already landed. The catch that produces the envelope covers it.
    chmodSync(join(root, "second.json"), 0o444);
    const run = runDoor(root, "2.0.0");
    chmodSync(join(root, "second.json"), 0o644);

    // Precondition, asserted rather than assumed: the write really did fail.
    expect(
      run.exitCode,
      "the second write succeeded, so this leg measured nothing — the fixture's " +
        "read-only bit did not take effect",
    ).not.toBe(0);

    const firstAfter = read(join(root, "first.json"));
    const partial = firstAfter !== PKG_JSON;
    expect(
      !(partial && CLAIMS_NOTHING_WRITTEN.test(run.stderr)),
      "the write loop failed on entry 2 of 2 and left entry 1 rewritten on disk, while the " +
        "refusal envelope told the operator nothing was written. Either the write is atomic " +
        "or the envelope stops claiming what it cannot know.\n" +
        `first.json now: ${firstAfter.trim()}\n${run.stderr}`,
    ).toBe(true);
    cleanup();
  });

  test("the control: a Remedy really does name the offending block", () => {
    const root = makeRoot({
      "CLAUDE.md": "# Fixture\n\nNo release block here at all.\n",
      "pkg.json": PKG_JSON,
    });
    const run = runDoor(root, "9.9.9");
    expect(remedyLine(run)).toContain("## Release Files");
    cleanup();
  });

  test("a malformed `## Docs` block is not blamed on `## Release Files`", () => {
    const root = threeKindFixture(claudeMdWithDocs("yes"));
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", BODY, "--test-count", COUNT_ARG,
    );
    expectCanonicalRefusal(run);
    // The verdict already names the key; the REMEDY is what misdirects.
    expect(run.stderr).toContain("changelog_ci_owned");
    const remedy = remedyLine(run);
    expect(
      remedy,
      `the remedy for a malformed \`## Docs\` block sends the operator to a block that is ` +
        `fine:\n  ${remedy}`,
    ).toContain("## Docs");
    expect(
      /##\s+Release Files/.test(remedy),
      `the remedy still blames \`## Release Files\` for a \`## Docs\` failure:\n  ${remedy}`,
    ).toBe(false);
    cleanup();
  });
});

// ===========================================================================
// PHASE 3 REVIEW ROUND — two findings the correction round left standing
// ===========================================================================

// ---------------------------------------------------------------------------
// F1 — a value flag given no value cannot swallow the flag behind it
// ---------------------------------------------------------------------------
//
// E7 closed HALF of this class. Its `VALUE_FLAGS` branch takes `argv[i + 1]`
// unconditionally, checking only that a token EXISTS — never that the token is
// itself a flag. So the mirror image of the hole E7 fixed was left open:
//
//   MEASURED against the shipped door, on a json-only fixture:
//
//     $ bun run adapters/_shared/src/release_config.ts <root> 2.0.0 \
//           --codename --dry-run
//     rewrote pkg.json
//     exit=0                      # pkg.json is 2.0.0 ON DISK
//
//   and with a value flag as the successor:
//
//     $ ... 2.0.0 --codename --date 2026-01-01
//     rewrote pkg.json            # codename="--date", `--date` never seen
//     exit=0
//
// `--dry-run`'s entire purpose is that nothing reaches disk. Losing it to a
// forgotten value is the same failure mode E7 refused to accept from a
// misspelling, arriving through the other door.
//
// THE RULE THIS BLOCK PINS, and the `--body` decision it records:
//
//   R1  Any value flag whose successor is a RECOGNISED flag (boolean or value)
//       refuses, naming the flag that was given no value. `--body` included:
//       a recognised flag behind it is a flag that would silently stop working.
//   R2  `--codename` / `--date` / `--test-count` additionally refuse on ANY
//       `--`-prefixed successor, recognised or not. A codename, a date and a
//       comma-separated count triple can never legitimately begin with `--`,
//       so there is nothing to trade away, and it closes `--codename --dryrun`.
//   R3  `--body` is FREE TEXT and is the deliberate exception to R2: a value
//       beginning with a dash — a markdown bullet, or even a `--`-prefixed
//       token that is not a recognised flag — is accepted VERBATIM. Refusing
//       those would leave a changelog body starting with a dash unwritable,
//       with no `--` separator to escape it. The choice is recorded here so it
//       is a decision and not an accident.
//   R4  Nothing reaches disk on any of these refusals, asserted by byte-
//       comparing the target files across a REAL subprocess run — never by
//       reading the module for a guard.
//
// The json+regex fixture is used for every refusal leg, for E7's reason: on a
// three-kind fixture the changelog guard refuses for a missing codename all by
// itself, so the leg would pass green while the defect stood.

/** `--codename` in trailing position: refused today, and must stay refused. */
const TRAILING_VALUE_FLAG_ARGS = ["2.0.0", "--codename"] as const;

describe("F1 — a value flag with no value cannot eat the flag behind it", () => {
  test("the control: a value flag with a REAL value still previews, and does not refuse", () => {
    // Without this leg the block below is satisfied by refusing every argv
    // containing two flags — which would take `--dry-run` away entirely.
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "Zed", "--dry-run");
    expect(run.exitCode, `\`--codename Zed --dry-run\` was refused:\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("would rewrite pkg.json (dry-run)");
    expect(run.stderr).not.toContain("Refusing:");
    expect(snapshot(root, JSON_AND_REGEX_FILES)).toEqual(before);
    cleanup();
  });

  test("the control: two value flags with real values, then a boolean, still preview", () => {
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "Zed", "--date", "2026-01-01", "--dry-run");
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain("(dry-run)");
    expect(snapshot(root, JSON_AND_REGEX_FILES)).toEqual(before);
    cleanup();
  });

  test("the control: the same fixture DOES write when the real run is asked for", () => {
    // So every "unchanged" assertion below is a claim about the refusal rather
    // than about a fixture that was never writable.
    const root = jsonAndRegexFixture();
    const run = runDoor(root, "2.0.0", "--codename", "Zed");
    expect(run.exitCode, run.stderr).toBe(0);
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("2.0.0");
    cleanup();
  });

  test("R1 — `--codename --dry-run` refuses and writes nothing", () => {
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "--dry-run");
    expectCanonicalRefusal(run);
    expect(
      snapshot(root, JSON_AND_REGEX_FILES),
      "`--codename` swallowed the `--dry-run` behind it and the door performed the REAL " +
        "write — a preview was asked for and a release landed on disk",
    ).toEqual(before);
    cleanup();
  });

  test("R1 — the refusal names the flag that was given no value", () => {
    const root = jsonAndRegexFixture();
    const run = runDoor(root, "2.0.0", "--codename", "--dry-run");
    expect(
      run.stderr,
      `the refusal does not say which flag was left without a value:\n${run.stderr}`,
    ).toContain("--codename");
    cleanup();
  });

  test("R1 — a VALUE-flag successor is swallowed too: `--codename --date <d>` refuses", () => {
    // MEASURED: codename became the literal string "--date", `--date` was
    // never seen, "2026-01-01" fell through to the positionals, and the run
    // rewrote pkg.json at exit 0.
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "--date", "2026-01-01");
    expectCanonicalRefusal(run);
    expect(run.stderr).toContain("--codename");
    expect(
      snapshot(root, JSON_AND_REGEX_FILES),
      "`--codename` consumed `--date` as its value and the real write went ahead",
    ).toEqual(before);
    cleanup();
  });

  test("R1 — `--body` is not exempt when the successor is a RECOGNISED flag", () => {
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--body", "--dry-run");
    expectCanonicalRefusal(run);
    expect(run.stderr).toContain("--body");
    expect(
      snapshot(root, JSON_AND_REGEX_FILES),
      "`--body` ate the `--dry-run` behind it and the real write went ahead",
    ).toEqual(before);
    cleanup();
  });

  test("R2 — `--codename --dryrun`: an UNRECOGNISED `--` successor refuses too", () => {
    // A codename can never begin with `--`, so the stricter rule costs nothing
    // here and closes the misspelling path E7 refused to leave open.
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, "2.0.0", "--codename", "--dryrun");
    expectCanonicalRefusal(run);
    expect(
      snapshot(root, JSON_AND_REGEX_FILES),
      "a misspelled `--dryrun` behind `--codename` became the codename and the real write ran",
    ).toEqual(before);
    cleanup();
  });

  test("R3 — a `--body` value beginning with a dash is accepted verbatim", () => {
    // The realistic case: a changelog body is markdown, and markdown bodies
    // open with bullets. If this ever refuses, the door cannot write the most
    // ordinary CHANGELOG section there is.
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const body = "- fixed a thing that was broken";
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", body, "--test-count", COUNT_ARG,
    );
    expect(run.exitCode, `a dash-leading \`--body\` value was refused:\n${run.stderr}`).toBe(0);
    expect(read(join(root, "CHANGELOG.md"))).toContain(body);
    cleanup();
  });

  test("R3 — a `--body` value beginning with `--` that is no known flag is accepted", () => {
    // THE RECORDED DECISION. `--body` is free text and takes the R2 carve-out:
    // the successor test for it is known-flag MEMBERSHIP, not a `--` prefix.
    // Flip this leg to a refusal only by changing the rule on purpose.
    const root = threeKindFixture(CLAUDE_MD_ALL_THREE_KINDS);
    const body = "--- a thematic break, not a flag";
    const run = runDoor(
      root, "2.0.0", "--codename", "Doorway", "--date", "2026-09-03",
      "--body", body, "--test-count", COUNT_ARG,
    );
    expect(
      run.exitCode,
      `a \`--\`-leading \`--body\` value that is no recognised flag was refused, leaving ` +
        `such a body unwritable with no escape hatch:\n${run.stderr}`,
    ).toBe(0);
    expect(read(join(root, "CHANGELOG.md"))).toContain(body);
    cleanup();
  });

  test("the trailing-position leg stays green — `--codename` last already refuses", () => {
    // GREEN as shipped, kept as the regression guard the fix must not trade
    // away while closing the mid-argv half.
    const root = jsonAndRegexFixture();
    const before = snapshot(root, JSON_AND_REGEX_FILES);
    const run = runDoor(root, ...TRAILING_VALUE_FLAG_ARGS);
    expectCanonicalRefusal(run);
    expect(run.stderr).toContain("--codename");
    expect(snapshot(root, JSON_AND_REGEX_FILES)).toEqual(before);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// F2 — the renderer either emits the no-newline marker or admits it does not
// ---------------------------------------------------------------------------
//
// `renderUnifiedDiff` never emits `\ No newline at end of file`, so a hunk
// touching a file with no trailing newline is technically an incomplete
// unified diff. Impact is LOW: the diff is rendered for a human to approve
// under `--dry-run` and is never fed to `patch`.
//
// Both resolutions are legitimate, so the OUTCOME is pinned rather than the
// mechanism: emit the marker, or record the limitation in the renderer's own
// docstring. Doing NEITHER fails.

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/** The `/** … *\/` block immediately above a declaration, or "" if none. */
function docstringAbove(source: string, decl: string): string {
  const at = source.indexOf(decl);
  if (at < 0) return "";
  const before = source.slice(0, at);
  const open = before.lastIndexOf("/**");
  return open < 0 ? "" : before.slice(open);
}

describe("F2 — renderUnifiedDiff and the no-newline marker", () => {
  test("the control: the newline-less input really does produce a hunk", () => {
    // Without this the assertion below could pass on empty output — "no marker
    // needed" and "no diff at all" look identical from the outside.
    const rendered = renderUnifiedDiff("f.txt", "alpha\nbravo", "alpha\ncharlie");
    expect(rendered).toContain("@@");
    expect(rendered).toContain("-bravo");
    expect(rendered).toContain("+charlie");
  });

  test("the control: the docstring scan can find something that IS there", () => {
    // A zero-hit scan is a claim about the search. This proves the extractor
    // reaches the right block before the leg below reads a miss as meaningful.
    const doc = docstringAbove(read(RELEASE_CONFIG), "export function renderUnifiedDiff");
    expect(doc, "the docstring above renderUnifiedDiff was not located at all").toContain(
      "correction E2",
    );
  });

  test("either the marker is emitted, or the limitation is recorded in the docstring", () => {
    const rendered = renderUnifiedDiff("f.txt", "alpha\nbravo", "alpha\ncharlie");
    const doc = docstringAbove(read(RELEASE_CONFIG), "export function renderUnifiedDiff");
    const emits = rendered.includes(NO_NEWLINE_MARKER);
    const recorded = /no newline at end of file/i.test(doc);
    expect(
      emits || recorded,
      "a hunk over a file with no trailing newline carries no `\\ No newline at end of " +
        "file` marker, and the renderer's docstring does not admit the omission either. " +
        "Either emit it or say so.\n" +
        `rendered:\n${rendered}`,
    ).toBe(true);
  });

  test("the marker, if emitted, is not emitted where it is unwarranted", () => {
    // Kills the cheap pass: appending the marker unconditionally would satisfy
    // the leg above while making every OTHER diff wrong. Passes untouched
    // under the docstring resolution, which emits no marker at all.
    const rendered = renderUnifiedDiff("f.txt", "alpha\nbravo\n", "alpha\ncharlie\n");
    expect(rendered).toContain("@@");
    expect(
      rendered.includes(NO_NEWLINE_MARKER),
      `both sides end with a newline, yet the hunk claims otherwise:\n${rendered}`,
    ).toBe(false);
  });
});

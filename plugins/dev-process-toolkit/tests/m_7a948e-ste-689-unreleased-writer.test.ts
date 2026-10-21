// STE-689 (M_7a948e) — `release_config.ts <root> unreleased` under
// `changelog_unversioned: true`.
//
// Every case here runs the command-line door against a fixture repo, exactly as
// `/ship-milestone` does, and grades the bytes on disk plus the printed report.
//
//   AC-STE-689.3  only `kind: changelog` is rewritten; every other entry is
//                 reported `skipped <path> (changelog_unversioned: true)` and
//                 left byte-identical; no --codename / --test-count needed.
//   AC-STE-689.4  the body merges into `## [Unreleased]` by `### <Category>`;
//                 an existing subsection is appended to; a missing heading is
//                 created above the topmost `## [X.Y.Z]` (or at the end of the
//                 preamble); every `## [X.Y.Z]` section stays byte-identical.
//   AC-STE-689.5  a second identical run changes nothing.
//   AC-STE-689.6  `unreleased` without the flag, and `X.Y.Z` with it, refuse in
//                 the NFR-10 shape and write nothing.
//   AC-STE-689.7  `--dry-run` reports the same rewrites/skips, writes nothing,
//                 exits 0.
//
// AC-STE-689.10 (mutation): removing the flag check reddens the AC-6 refusals
// and the AC-3 skip report; removing the subsection merge reddens the AC-4
// existing-subsection cases and AC-5.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "release_config.ts");

const DATE = "2026-10-21";

const BODY = [
  "### Added",
  "",
  "- A new feature (STE-1)",
  "",
  "### Fixed",
  "",
  "- A new fix (STE-2)",
  "",
].join("\n");

const PACKAGE_JSON = `{\n  "name": "fixture",\n  "version": "1.2.0"\n}\n`;
const README = "# Fixture\n\nLatest: **v1.2.0** — the current release.\n";

const VERSIONED_TAIL = [
  '## [1.2.0] — 2026-01-01 — "Old"',
  "",
  "### Added",
  "",
  "- An old feature (STE-10)",
  "",
  "Total test count at release: 10 tests, 0 failures, 0 errors.",
  "",
  '## [1.1.0] — 2025-12-01 — "Older"',
  "",
  "### Fixed",
  "",
  "- An old fix (STE-9)",
  "",
].join("\n");

const PREAMBLE = "# Changelog\n\nAll notable changes to this fixture are documented here.\n\n";

function claudeMd(flagLine: string | null): string {
  return [
    "# Fixture",
    "",
    "## Docs",
    "",
    "user_facing_mode: false",
    "packages_mode: false",
    "changelog_ci_owned: false",
    ...(flagLine === null ? [] : [flagLine]),
    "",
    "## Release Files",
    "",
    "```yaml",
    "files:",
    "  - path: package.json",
    "    kind: json",
    "    field: version",
    "  - path: CHANGELOG.md",
    "    kind: changelog",
    "  - path: README.md",
    "    kind: regex",
    "    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+)\\*\\*'",
    "    replace: 'Latest: **v{version}**'",
    "```",
    "",
  ].join("\n");
}

const dirs: string[] = [];
function makeRoot(flagLine: string | null, changelog: string): string {
  const root = mkdtempSync(join(tmpdir(), "ste-689-writer-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "CLAUDE.md": claudeMd(flagLine),
    "package.json": PACKAGE_JSON,
    "README.md": README,
    "CHANGELOG.md": changelog,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runDoor(...args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", DOOR, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return {
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode ?? -1,
  };
}

function runUnreleased(root: string, body = BODY, ...extra: string[]): Run {
  return runDoor(root, "unreleased", "--date", DATE, "--body", body, ...extra);
}

const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf-8");

/** The text of the `## [Unreleased]` section: from its heading to the next `## ` heading. */
function unreleasedSection(changelog: string): string {
  const start = changelog.search(/^## \[Unreleased\]\s*$/m);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = changelog.slice(start);
  const nextRel = rest.slice(1).search(/^## /m);
  return nextRel < 0 ? rest : rest.slice(0, nextRel + 1);
}

/** The `### <Category>` heading an FR line sits under, inside a section. */
function categoryOf(section: string, frLine: string): string | null {
  const lines = section.split("\n");
  const idx = lines.indexOf(frLine);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const m = /^### (\S.*)$/.exec(lines[i]!);
    if (m) return m[1]!.trim();
    if (/^## /.test(lines[i]!)) return null;
  }
  return null;
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("AC-STE-689.3 — under the flag only the changelog entry is rewritten", () => {
  test("json and regex entries are skipped by name and left byte-identical; no codename/test-count needed", () => {
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + VERSIONED_TAIL);
    const run = runUnreleased(root);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    const lines = run.stdout.split("\n").filter((l) => l !== "");
    expect(lines).toContain("rewrote CHANGELOG.md");
    expect(lines).toContain("skipped package.json (changelog_unversioned: true)");
    expect(lines).toContain("skipped README.md (changelog_unversioned: true)");
    expect(lines.some((l) => l.startsWith("rewrote package.json"))).toBe(false);
    expect(lines.some((l) => l.startsWith("rewrote README.md"))).toBe(false);
    expect(read(root, "package.json")).toBe(PACKAGE_JSON);
    expect(read(root, "README.md")).toBe(README);
    expect(read(root, "CHANGELOG.md")).not.toBe(PREAMBLE + VERSIONED_TAIL);
    expect(read(root, "CHANGELOG.md")).toContain("- A new feature (STE-1)");
  });

  test("no versioned `## [unreleased]`-style heading and no test-count line are written", () => {
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + VERSIONED_TAIL);
    const run = runUnreleased(root);
    expect(run.exitCode).toBe(0);
    const after = read(root, "CHANGELOG.md");
    expect(after).not.toMatch(/^## \[unreleased\] —/m);
    expect(count(after, "Total test count at release:")).toBe(count(VERSIONED_TAIL, "Total test count at release:"));
  });
});

describe("AC-STE-689.4 — the body merges into `## [Unreleased]`", () => {
  test("missing heading is created directly above the topmost `## [X.Y.Z]`; versioned sections byte-identical", () => {
    const original = PREAMBLE + VERSIONED_TAIL;
    const root = makeRoot("changelog_unversioned: true", original);
    const run = runUnreleased(root);
    expect(run.exitCode).toBe(0);
    const after = read(root, "CHANGELOG.md");

    expect(after.startsWith(PREAMBLE)).toBe(true);
    expect(after.endsWith(VERSIONED_TAIL)).toBe(true);
    const middle = after.slice(PREAMBLE.length, after.length - VERSIONED_TAIL.length);
    expect(middle.startsWith("## [Unreleased]")).toBe(true);
    // Nothing but the Unreleased section sits between the preamble and 1.2.0.
    expect(count(middle, "\n## ")).toBe(0);
    expect(count(after, "## [Unreleased]")).toBe(1);

    const section = unreleasedSection(after);
    expect(categoryOf(section, "- A new feature (STE-1)")).toBe("Added");
    expect(categoryOf(section, "- A new fix (STE-2)")).toBe("Fixed");
  });

  test("existing `## [Unreleased]` with an existing subsection is appended to, not duplicated", () => {
    const existing = [
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- A pending feature (STE-0)",
      "",
    ].join("\n");
    const original = PREAMBLE + existing + VERSIONED_TAIL;
    const root = makeRoot("changelog_unversioned: true", original);
    const run = runUnreleased(root);
    expect(run.exitCode).toBe(0);
    const after = read(root, "CHANGELOG.md");

    expect(after.startsWith(PREAMBLE)).toBe(true);
    expect(after.endsWith(VERSIONED_TAIL)).toBe(true);
    expect(count(after, "## [Unreleased]")).toBe(1);

    const section = unreleasedSection(after);
    expect(count(section, "### Added")).toBe(1);
    expect(count(section, "### Fixed")).toBe(1);
    expect(categoryOf(section, "- A pending feature (STE-0)")).toBe("Added");
    expect(categoryOf(section, "- A new feature (STE-1)")).toBe("Added");
    expect(categoryOf(section, "- A new fix (STE-2)")).toBe("Fixed");
    // Appended: the pre-existing line keeps its place ahead of the new one.
    expect(section.indexOf("- A pending feature (STE-0)")).toBeLessThan(
      section.indexOf("- A new feature (STE-1)"),
    );
  });

  test("an existing subsection that is not the first one is merged into, too", () => {
    const existing = [
      "## [Unreleased]",
      "",
      "### Changed",
      "",
      "- A pending change (STE-5)",
      "",
      "### Fixed",
      "",
      "- A pending fix (STE-6)",
      "",
    ].join("\n");
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + existing + VERSIONED_TAIL);
    const run = runUnreleased(root);
    expect(run.exitCode).toBe(0);
    const after = read(root, "CHANGELOG.md");
    expect(after.endsWith(VERSIONED_TAIL)).toBe(true);
    const section = unreleasedSection(after);
    expect(count(section, "### Fixed")).toBe(1);
    expect(count(section, "### Changed")).toBe(1);
    expect(count(section, "### Added")).toBe(1);
    expect(categoryOf(section, "- A pending change (STE-5)")).toBe("Changed");
    expect(categoryOf(section, "- A pending fix (STE-6)")).toBe("Fixed");
    expect(categoryOf(section, "- A new fix (STE-2)")).toBe("Fixed");
    expect(categoryOf(section, "- A new feature (STE-1)")).toBe("Added");
  });

  test("no versioned section at all: the Unreleased section lands at the end of the preamble", () => {
    const original = "# Changelog\n\nAll notable changes to this fixture are documented here.\n";
    const root = makeRoot("changelog_unversioned: true", original);
    const run = runUnreleased(root);
    expect(run.exitCode).toBe(0);
    const after = read(root, "CHANGELOG.md");
    const at = after.search(/^## \[Unreleased\]\s*$/m);
    expect(at).toBeGreaterThan(0);
    expect(after.slice(0, at).trimEnd()).toBe(original.trimEnd());
    const section = unreleasedSection(after);
    expect(categoryOf(section, "- A new feature (STE-1)")).toBe("Added");
    expect(categoryOf(section, "- A new fix (STE-2)")).toBe("Fixed");
  });
});

describe("AC-STE-689.5 — the unreleased write is idempotent", () => {
  test("a second identical run leaves the file unchanged (heading created on run 1)", () => {
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + VERSIONED_TAIL);
    expect(runUnreleased(root).exitCode).toBe(0);
    const first = read(root, "CHANGELOG.md");
    const second = runUnreleased(root);
    expect(second.exitCode).toBe(0);
    expect(read(root, "CHANGELOG.md")).toBe(first);
    expect(count(first, "- A new feature (STE-1)")).toBe(1);
    expect(count(first, "- A new fix (STE-2)")).toBe(1);
  });

  test("a second identical run over an existing subsection duplicates no FR line", () => {
    const existing = "## [Unreleased]\n\n### Added\n\n- A pending feature (STE-0)\n\n";
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + existing + VERSIONED_TAIL);
    expect(runUnreleased(root).exitCode).toBe(0);
    const first = read(root, "CHANGELOG.md");
    expect(runUnreleased(root).exitCode).toBe(0);
    const second = read(root, "CHANGELOG.md");
    expect(second).toBe(first);
    expect(count(second, "- A new feature (STE-1)")).toBe(1);
    expect(count(second, "- A pending feature (STE-0)")).toBe(1);
  });
});

describe("AC-STE-689.6 — the version slot and the flag must agree", () => {
  const assertRefusedUntouched = (root: string, run: Run, changelog: string): void => {
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/^Refusing: /m);
    expect(run.stderr).toMatch(/^Remedy: /m);
    expect(run.stderr).toMatch(/^Context: /m);
    expect(run.stderr).toContain("changelog_unversioned");
    expect(run.stdout).not.toMatch(/^rewrote /m);
    expect(read(root, "package.json")).toBe(PACKAGE_JSON);
    expect(read(root, "README.md")).toBe(README);
    expect(read(root, "CHANGELOG.md")).toBe(changelog);
  };

  // Full argv on every refusal case, so the ONLY reason left to refuse is the
  // flag/version disagreement — a missing companion cannot stand in for it.
  const FULL = ["--codename", "Zed", "--date", DATE, "--body", BODY, "--test-count", "10,0,0"];

  test("`unreleased` with the flag absent refuses and writes nothing", () => {
    const changelog = PREAMBLE + VERSIONED_TAIL;
    const root = makeRoot(null, changelog);
    assertRefusedUntouched(root, runDoor(root, "unreleased", ...FULL), changelog);
  });

  test("`unreleased` with the flag `false` refuses and writes nothing", () => {
    const changelog = PREAMBLE + VERSIONED_TAIL;
    const root = makeRoot("changelog_unversioned: false", changelog);
    assertRefusedUntouched(root, runDoor(root, "unreleased", ...FULL), changelog);
  });

  test("an `X.Y.Z` version with the flag `true` refuses and writes nothing", () => {
    const changelog = PREAMBLE + VERSIONED_TAIL;
    const root = makeRoot("changelog_unversioned: true", changelog);
    assertRefusedUntouched(root, runDoor(root, "2.0.0", ...FULL), changelog);
  });

  test("the `X.Y.Z` refusal under the flag holds in --dry-run too", () => {
    const changelog = PREAMBLE + VERSIONED_TAIL;
    const root = makeRoot("changelog_unversioned: true", changelog);
    const run = runDoor(root, "2.0.0", ...FULL, "--dry-run");
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toMatch(/^Refusing: /m);
    expect(run.stdout).not.toMatch(/^would rewrite /m);
    expect(read(root, "CHANGELOG.md")).toBe(changelog);
  });
});

describe("AC-STE-689.7 — --dry-run under the flag", () => {
  test("prints the same rewrites and skips as the real run, writes nothing, exits 0", () => {
    const changelog = PREAMBLE + VERSIONED_TAIL;
    const dryRoot = makeRoot("changelog_unversioned: true", changelog);
    const realRoot = makeRoot("changelog_unversioned: true", changelog);

    const dry = runUnreleased(dryRoot, BODY, "--dry-run");
    expect(dry.stderr).toBe("");
    expect(dry.exitCode).toBe(0);
    expect(read(dryRoot, "CHANGELOG.md")).toBe(changelog);
    expect(read(dryRoot, "package.json")).toBe(PACKAGE_JSON);
    expect(read(dryRoot, "README.md")).toBe(README);

    const real = runUnreleased(realRoot);
    expect(real.exitCode).toBe(0);

    const dryReport = dry.stdout
      .split("\n")
      .flatMap((l) => {
        const rw = /^would rewrite (.+) \(dry-run\)$/.exec(l);
        if (rw) return [`rewrote ${rw[1]}`];
        const sk = /^would skip (.+) \(dry-run\)$/.exec(l);
        if (sk) return [`skipped ${sk[1]}`];
        return [];
      })
      .sort();
    const realReport = real.stdout
      .split("\n")
      .filter((l) => /^(rewrote|skipped) /.test(l))
      .sort();
    expect(realReport).toEqual([
      "rewrote CHANGELOG.md",
      "skipped README.md (changelog_unversioned: true)",
      "skipped package.json (changelog_unversioned: true)",
    ]);
    expect(dryReport).toEqual(realReport);
  });

  test("the dry-run diff shows the Unreleased lines it would add", () => {
    const root = makeRoot("changelog_unversioned: true", PREAMBLE + VERSIONED_TAIL);
    const dry = runUnreleased(root, BODY, "--dry-run");
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("--- a/CHANGELOG.md");
    expect(dry.stdout).toMatch(/^\+## \[Unreleased\]$/m);
    expect(dry.stdout).toMatch(/^\+- A new feature \(STE-1\)$/m);
    expect(dry.stdout).not.toContain("--- a/package.json");
  });
});

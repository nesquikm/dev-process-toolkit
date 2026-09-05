// STE-555 (M_dc2ecb) — the release writer fails loudly rather than silently.
//
// THREE failure modes, each MEASURED at e683bb9 by executing the module:
//
//   1. `optional: true` guarded a missing FILE only. A fixture whose optional
//      regex entry existed but did not match printed
//      `Refusing: to rewrite the release files — bumpRegex: pattern did not
//      match` at rc=1, with the JSON manifest left unwritten. The toolkit's own
//      README entry is exactly that shape: `optional: true` over a
//      hand-maintained banner that always exists.
//
//   2. `bumpChangelog` had no duplicate guard. Identical argv twice: rc=0 both
//      times, two identical `## [1.1.0]` sections. The JSON bumpers being
//      idempotent is what left the doubled CHANGELOG as the only trace.
//
//   3. `bumpRegex` was first-match-only and expanded its template. Measured:
//      `v1.0.0 here and v1.0.0 there` → only the first bumped, success
//      reported; and a `[$&] v{version}` template produced `[v1.0.0] v2.0.0`.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DuplicateChangelogSectionError,
  RegexPatternMissError,
  bumpChangelog,
  bumpRegex,
} from "../adapters/_shared/src/release_config";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const RELEASE_CONFIG = join(PLUGIN_ROOT, "adapters", "_shared", "src", "release_config.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

const dirs: string[] = [];
function makeRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-555-"));
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
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode ?? -1,
  };
}

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

const DOCS_BLOCK = `## Docs

user_facing_mode: false
packages_mode: false
changelog_ci_owned: false
`;

/** A fixture whose regex entry never matches; `optional` is the variable. */
function missFixture(optional: boolean): string {
  return makeRoot({
    "CLAUDE.md": `# Fixture

${DOCS_BLOCK}
## Release Files

\`\`\`yaml
files:
  - path: pkg.json
    kind: json
    field: version
  - path: README.md
    kind: regex
    pattern: 'NO-SUCH-ANCHOR-v(?<version>\\d+\\.\\d+\\.\\d+)'
    replace: 'NO-SUCH-ANCHOR-v{version}'
${optional ? "    optional: true\n" : ""}\`\`\`
`,
    "pkg.json": '{\n  "version": "1.0.0"\n}\n',
    "README.md": "Latest: **v1.0.0**\n",
  });
}

// ---------------------------------------------------------------------------
// AC-STE-555.1 / .2 / .3 — optional guards the MISS, not only the missing file
// ---------------------------------------------------------------------------

describe("AC-STE-555.1 — an optional entry whose pattern misses is skipped", () => {
  test("the run completes, the other entries are written, rc=0", () => {
    const root = missFixture(true);
    const run = runDoor(root, "1.1.0");
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("rewrote pkg.json");
    expect(run.stdout).toContain("skipped README.md (optional, pattern did not match)");
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("1.1.0");
    // The file it declined to rewrite is left exactly as it found it.
    expect(read(join(root, "README.md"))).toBe("Latest: **v1.0.0**\n");
  });
});

describe("AC-STE-555.2 — a non-optional miss still refuses", () => {
  // The isolation half of AC.1. If the skip were made unconditional, this leg
  // fails — which is what makes AC.1's pass a statement about `optional` and
  // not merely about the miss.
  test("rc is non-zero and nothing reaches disk", () => {
    const root = missFixture(false);
    const before = read(join(root, "pkg.json"));
    const run = runDoor(root, "1.1.0");
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("bumpRegex: pattern did not match");
    expect(run.stderr).toContain("nothing was written.");
    expect(read(join(root, "pkg.json"))).toBe(before);
  });
});

describe("AC-STE-555.3 — the preview reports the same skip", () => {
  test("--dry-run names it in the shape the other skips use", () => {
    const root = missFixture(true);
    const run = runDoor(root, "1.1.0", "--dry-run");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("would skip README.md (optional, pattern did not match) (dry-run)");
    // A preview writes nothing, skip or no skip.
    expect(JSON.parse(read(join(root, "pkg.json"))).version).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-555.4 / .5 / .6 — a version is inserted once
// ---------------------------------------------------------------------------

const PRIOR_CHANGELOG = '# Changelog\n\n## [1.0.0] — 2026-01-01 — "Prior"\n\n- prior\n';

describe("AC-STE-555.4 — bumpChangelog refuses a version already present", () => {
  test("the refusal names the version", () => {
    const once = bumpChangelog(PRIOR_CHANGELOG, "1.1.0", "Second", "2026-02-02", "- new\n", {
      total: 1,
      failures: 0,
      errors: 0,
    });
    let thrown: unknown;
    try {
      bumpChangelog(once, "1.1.0", "Second", "2026-02-02", "- new\n", {
        total: 1,
        failures: 0,
        errors: 0,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DuplicateChangelogSectionError);
    expect((thrown as Error).message).toContain("1.1.0");
  });

  test("a version the file does not carry still inserts", () => {
    const out = bumpChangelog(PRIOR_CHANGELOG, "1.1.0", "Second", "2026-02-02", "- new\n", {
      total: 1,
      failures: 0,
      errors: 0,
    });
    expect(out.match(/^## \[1\.1\.0\]/gm)?.length).toBe(1);
  });
});

function doubleRunFixture(): string {
  return makeRoot({
    "CLAUDE.md": `# Fixture

${DOCS_BLOCK}
## Release Files

\`\`\`yaml
files:
  - path: pkg.json
    kind: json
    field: version
  - path: CHANGELOG.md
    kind: changelog
\`\`\`
`,
    "pkg.json": '{\n  "version": "1.0.0"\n}\n',
    "CHANGELOG.md": PRIOR_CHANGELOG,
  });
}

const DOUBLE_RUN_ARGS = [
  "1.1.0",
  "--codename",
  "Second",
  "--date",
  "2026-02-02",
  "--body",
  "### Fixed\n\n- x\n",
  "--test-count",
  "10,0,0",
];

describe("AC-STE-555.5 — the double run leaves one section", () => {
  test("first run zero, second run non-zero, exactly one section on disk", () => {
    const root = doubleRunFixture();
    const first = runDoor(root, ...DOUBLE_RUN_ARGS);
    expect(first.exitCode).toBe(0);

    const second = runDoor(root, ...DOUBLE_RUN_ARGS);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr).toContain("already carries");

    // Counted on disk. The exit code is precisely what was already wrong.
    const sections = read(join(root, "CHANGELOG.md")).match(/^## \[1\.1\.0\]/gm) ?? [];
    expect(sections.length).toBe(1);
  });
});

describe("AC-STE-555.6 — the refused second run writes nothing", () => {
  test("every release file is byte-identical across the refusal", () => {
    const root = doubleRunFixture();
    expect(runDoor(root, ...DOUBLE_RUN_ARGS).exitCode).toBe(0);

    const before = {
      pkg: read(join(root, "pkg.json")),
      changelog: read(join(root, "CHANGELOG.md")),
    };
    const second = runDoor(root, ...DOUBLE_RUN_ARGS);
    expect(second.exitCode).not.toBe(0);
    // The envelope's claim, graded against the tree rather than against itself.
    expect(second.stderr).toContain("nothing was written.");
    expect(read(join(root, "pkg.json"))).toBe(before.pkg);
    expect(read(join(root, "CHANGELOG.md"))).toBe(before.changelog);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-555.7 / .8 / .9 — every occurrence, written literally
// ---------------------------------------------------------------------------

const VERSION_PATTERN = "v(?<version>\\d+\\.\\d+\\.\\d+)";

describe("AC-STE-555.7 — every occurrence is rewritten", () => {
  test("a two-occurrence fixture leaves neither behind", () => {
    const out = bumpRegex("v1.0.0 here and v1.0.0 there\n", VERSION_PATTERN, "v{version}", "2.0.0");
    expect(out).toBe("v2.0.0 here and v2.0.0 there\n");
    expect(out).not.toContain("v1.0.0");
  });
});

describe("AC-STE-555.8 — the replace template is written literally", () => {
  test("$&, $1, $`, $' and $$ land as those characters", () => {
    const out = bumpRegex("v1.0.0\n", VERSION_PATTERN, "[$& $1 $` $' $$] v{version}", "2.0.0");
    expect(out).toBe("[$& $1 $` $' $$] v2.0.0\n");
    // The measured HEAD expansion, asserted absent by its exact output.
    expect(out).not.toContain("[v1.0.0]");
  });
});

describe("AC-STE-555.9 — the no-match detection is not stateful", () => {
  test("identical calls answer identically", () => {
    const first = bumpRegex("v1.0.0\n", VERSION_PATTERN, "v{version}", "2.0.0");
    const second = bumpRegex("v1.0.0\n", VERSION_PATTERN, "v{version}", "2.0.0");
    expect(second).toBe(first);
  });

  test("a genuine miss throws by class, both times", () => {
    for (const _ of [0, 1]) {
      expect(() => bumpRegex("nothing here\n", VERSION_PATTERN, "v{version}", "2.0.0")).toThrow(
        RegexPatternMissError,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-555.10 — falsifiability
// ---------------------------------------------------------------------------

describe("AC-STE-555.10 — each repair is load-bearing", () => {
  test("removing the duplicate guard restores the doubled section", async () => {
    const mutant = await importMutant(
      RELEASE_CONFIG,
      "if (hasChangelogSection(content, version)) {",
      "if (false && hasChangelogSection(content, version)) {",
      "ste555_dup",
    );
    const bump = mutant.bumpChangelog as typeof bumpChangelog;
    const count = { total: 1, failures: 0, errors: 0 };
    const once = bump(PRIOR_CHANGELOG, "1.1.0", "Second", "2026-02-02", "- new\n", count);
    const twice = bump(once, "1.1.0", "Second", "2026-02-02", "- new\n", count);
    expect(twice.match(/^## \[1\.1\.0\]/gm)?.length).toBe(2);
  });

  test("dropping the g flag restores first-match-only", async () => {
    const mutant = await importMutant(
      RELEASE_CONFIG,
      'const re = new RegExp(pattern, "g");',
      "const re = new RegExp(pattern);",
      "ste555_flag",
    );
    const bump = mutant.bumpRegex as typeof bumpRegex;
    expect(bump("v1.0.0 here and v1.0.0 there\n", VERSION_PATTERN, "v{version}", "2.0.0")).toContain(
      "and v1.0.0 there",
    );
  });

  test("restoring the string replacement restores the $& expansion", async () => {
    const mutant = await importMutant(
      RELEASE_CONFIG,
      "return content.replace(re, () => rendered);",
      "return content.replace(re, rendered);",
      "ste555_literal",
    );
    const bump = mutant.bumpRegex as typeof bumpRegex;
    expect(bump("v1.0.0\n", VERSION_PATTERN, "[$&] v{version}", "2.0.0")).toBe("[v1.0.0] v2.0.0\n");
  });

  test("making the skip unconditional breaks the non-optional refusal", async () => {
    // The mutation AC.2 exists to catch: `optional` stops being read, so a
    // required surface silently stops being written.
    const original = read(RELEASE_CONFIG);
    const from = "if (error instanceof RegexPatternMissError && entry.optional) {";
    expect(original).toContain(from);
    const path = join(dirname(RELEASE_CONFIG), `__mutant_ste555_skip_${process.pid}.ts`);
    writeFileSync(
      path,
      original.replace(from, "if (error instanceof RegexPatternMissError) {"),
    );
    try {
      const root = missFixture(false);
      const proc = Bun.spawnSync(["bun", "run", path, root, "1.1.0"], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      expect(new TextDecoder().decode(proc.stdout)).toContain("skipped README.md");
    } finally {
      rmSync(path, { force: true });
    }
  });
});

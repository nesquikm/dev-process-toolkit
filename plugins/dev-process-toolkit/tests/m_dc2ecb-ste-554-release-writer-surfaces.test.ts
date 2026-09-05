// STE-554 (M_dc2ecb) — the release writer writes every surface it claims to write.
//
// MEASURED at e683bb9, by executing the module rather than reading it:
//
//   bumpFile({kind:"regex", replace:'… "{codename}"'}, readme,
//            {newVersion:"2.81.0", codename:"Ceremony"})
//     → 'Latest: **v2.81.0 — "{codename}"** (M143, paragraph).'
//
// The six characters `{codename}` reached the output. `bumpRegex` substituted
// `{version}` alone and `bumpFile`'s regex arm called it with `opts.newVersion`
// only — dropping a codename `BumpOptions` has always carried and the changelog
// arm has always consumed.
//
//   grep -c requirements plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md → 0
//
// `specs/requirements.md`'s `Latest shipped release:` line was in no writer's
// set and named in no skill step, so probe #9b red every release commit by
// construction until a human amended the file. That hand-edit was required on
// all five releases of the 2026-09-04 program.
//
// The two are one defect wearing two shapes: a surface the ceremony claims to
// own, that the ceremony does not write.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  MissingCodenameError,
  bumpFile,
  bumpRegex,
  parseReleaseFiles,
  type ReleaseFile,
} from "../adapters/_shared/src/release_config";
import { findVersionFreshnessDrift } from "../adapters/_shared/src/root_hygiene";
import { checkReleaseSurfaceAgreement } from "../adapters/_shared/src/release_surface_agreement";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const RELEASE_CONFIG = join(PLUGIN_ROOT, "adapters", "_shared", "src", "release_config.ts");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const REPO_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");

/** NFR-1's per-skill line cap, counted the way the cap's own suite counts. */
const SKILL_LINE_CAP = 358;

const read = (path: string): string => readFileSync(path, "utf-8");

const dirs: string[] = [];
function makeRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-554-"));
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

/**
 * Import a one-line MUTANT of a shipped module.
 *
 * The mutant is written INTO the module's own directory, because the module
 * resolves its imports relatively and a copy anywhere else would fail to load
 * for a reason that has nothing to do with the mutation. The substitution is
 * asserted to have applied before the import: a mutation that never landed
 * reads as a passing test, which is the trap M124 shipped.
 */
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

const README_ENTRY: ReleaseFile = {
  path: "README.md",
  kind: "regex",
  pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — "(?<codename>[^"]+)"',
  replace: 'Latest: **v{version} — "{codename}"',
};
const README_BEFORE = 'Latest: **v2.80.0 — "Onward"** (M143, chains that continue: a paragraph.)\n';

// ---------------------------------------------------------------------------
// AC-STE-554.1 / .2 / .3 / .4 — the codename reaches the regex writer
// ---------------------------------------------------------------------------

describe("AC-STE-554.1 — bumpRegex renders {codename}", () => {
  test("a codename-naming template puts the codename on disk", () => {
    const out = bumpRegex(
      README_BEFORE,
      README_ENTRY.pattern!,
      README_ENTRY.replace!,
      "2.81.0",
      "Ceremony",
    );
    expect(out).toContain('Latest: **v2.81.0 — "Ceremony"**');
    // The measured HEAD failure, asserted absent by its exact shape: the
    // placeholder itself reaching the output.
    expect(out).not.toContain("{codename}");
  });
});

describe("AC-STE-554.2 — bumpFile's regex arm forwards opts.codename", () => {
  // The defect was in the ARM. A test that reached `bumpRegex` directly would
  // have passed for the whole of its life, so the pair below is what pins it:
  // through `bumpFile` it succeeds, and the same call with no codename in hand
  // refuses. Stop forwarding and the first leg becomes the second.
  test("through bumpFile the codename lands; without one the writer refuses", () => {
    const out = bumpFile(README_ENTRY, README_BEFORE, {
      newVersion: "2.81.0",
      codename: "Ceremony",
    });
    expect(out).toContain('"Ceremony"');

    expect(() =>
      bumpRegex(README_BEFORE, README_ENTRY.pattern!, README_ENTRY.replace!, "2.81.0"),
    ).toThrow(MissingCodenameError);
  });
});

describe("AC-STE-554.3 — a {codename} template with no codename refuses", () => {
  test("refuses by class, and writes no literal placeholder", () => {
    let thrown: unknown;
    try {
      bumpFile(README_ENTRY, README_BEFORE, { newVersion: "2.81.0" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MissingCodenameError);
    expect((thrown as Error).message).toContain("{codename}");
  });
});

describe("AC-STE-554.4 — a template naming no codename is unaffected", () => {
  test("byte-identical with and without a codename supplied", () => {
    const entry: ReleaseFile = {
      path: "README.md",
      kind: "regex",
      pattern: "Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — ",
      replace: "Latest: **v{version} — ",
    };
    const without = bumpFile(entry, README_BEFORE, { newVersion: "2.81.0" });
    const with_ = bumpFile(entry, README_BEFORE, { newVersion: "2.81.0", codename: "Ceremony" });
    expect(without).toBe(with_);
    // And the pre-STE-554 output is preserved exactly: everything past the
    // em-dash survives, which is the shipped behaviour consumers depend on.
    expect(without).toBe('Latest: **v2.81.0 — "Onward"** (M143, chains that continue: a paragraph.)\n');
  });
});

// ---------------------------------------------------------------------------
// AC-STE-554.5 / .6 — specs/requirements.md gets a writer
// ---------------------------------------------------------------------------

describe("AC-STE-554.5 — the block declares specs/requirements.md", () => {
  test("this repository's ## Release Files carries it, capturing version AND codename", () => {
    const entries = parseReleaseFiles(read(REPO_CLAUDE_MD));
    const entry = entries.find((e) => e.path === "specs/requirements.md");
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("regex");
    expect(entry!.pattern).toContain("(?<version>");
    expect(entry!.pattern).toContain("(?<codename>");
    expect(entry!.replace).toContain("{version}");
    expect(entry!.replace).toContain("{codename}");
  });

  test("the entry's pattern matches the line as it stands in this tree", () => {
    const entry = parseReleaseFiles(read(REPO_CLAUDE_MD)).find(
      (e) => e.path === "specs/requirements.md",
    )!;
    const requirements = read(join(REPO_ROOT, "specs", "requirements.md"));
    // A declared entry whose pattern misses is now SKIPPED rather than fatal
    // (STE-555), so the declaration alone no longer proves the surface is
    // written. This leg is what proves it.
    expect(new RegExp(entry.pattern!).test(requirements)).toBe(true);
  });

  test("the README entry captures the codename too", () => {
    const entry = parseReleaseFiles(read(REPO_CLAUDE_MD)).find((e) => e.path === "README.md")!;
    expect(entry.pattern).toContain("(?<codename>");
    expect(new RegExp(entry.pattern!).test(read(join(REPO_ROOT, "README.md")))).toBe(true);
  });
});

const FIXTURE_CLAUDE_MD = `# Fixture

## Docs

user_facing_mode: false
packages_mode: false
changelog_ci_owned: false

## Release Files

\`\`\`yaml
files:
  - path: plugin.json
    kind: json
    field: version
  - path: CHANGELOG.md
    kind: changelog
  - path: README.md
    kind: regex
    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — "(?<codename>[^"]+)"'
    replace: 'Latest: **v{version} — "{codename}"'
    optional: true
  - path: specs/requirements.md
    kind: regex
    pattern: '\\*\\*Latest shipped release:\\*\\* \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) \\("(?<codename>[^"]+)"\\)\\*\\*'
    replace: '**Latest shipped release:** **v{version} ("{codename}")**'
\`\`\`
`;

function releaseFixture(milestone: string): string {
  return makeRoot({
    "CLAUDE.md": FIXTURE_CLAUDE_MD,
    "plugin.json": '{\n  "version": "2.80.0"\n}\n',
    "CHANGELOG.md": '# Changelog\n\n## [2.80.0] — 2026-09-04 — "Onward"\n\n- prior\n',
    "README.md": `Latest: **v2.80.0 — "Onward"** (${milestone}, prior release prose.)\n`,
    "specs/requirements.md":
      '# Requirements\n\n## 1. Overview\n\n**Latest shipped release:** **v2.80.0 ("Onward")**.\n\n## 2. Next\n',
    // The stamp /ship-milestone step 7 writes; present here because the
    // agreement check reads it and the writer never produces it.
    [`specs/plan/archive/${milestone}.md`]: `---\nmilestone: ${milestone}\nshipped_in: v2.80.1\n---\n`,
  });
}

function shipFixture(root: string): Run {
  return runDoor(
    root,
    "2.80.1",
    "--codename",
    "Ceremony",
    "--date",
    "2026-09-05",
    "--body",
    "### Fixed\n\n- the writer writes every surface (STE-554)\n",
    "--test-count",
    "11764,0,0",
  );
}

describe("AC-STE-554.6 — a release run rewrites the requirements line unaided", () => {
  test("the writer bumps it, and probe #9b then passes on a tree no hand touched", () => {
    const root = releaseFixture("M143");
    const run = shipFixture(root);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("rewrote specs/requirements.md");

    const after = read(join(root, "specs", "requirements.md"));
    expect(after).toContain('**Latest shipped release:** **v2.80.1 ("Ceremony")**');

    // The probe, run for real over the result. Asserting the rewrite alone
    // would pass on a line the probe still rejects — which is the state this
    // FR exists to end.
    const drifts = findVersionFreshnessDrift(
      join(root, "specs"),
      join(root, "plugin.json"),
      join(root, "CHANGELOG.md"),
    );
    expect(drifts).toEqual([]);
  });

  test("without the entry, the same run leaves the line stale and the probe reds", () => {
    // Isolation: the entry is what does the work, not the rest of the ceremony.
    const root = releaseFixture("M143");
    writeFileSync(
      join(root, "CLAUDE.md"),
      FIXTURE_CLAUDE_MD.slice(0, FIXTURE_CLAUDE_MD.indexOf("  - path: specs/requirements.md")) +
        "```\n",
    );
    const run = shipFixture(root);
    expect(run.exitCode).toBe(0);
    expect(read(join(root, "specs", "requirements.md"))).toContain('v2.80.0 ("Onward")');
    const drifts = findVersionFreshnessDrift(
      join(root, "specs"),
      join(root, "plugin.json"),
      join(root, "CHANGELOG.md"),
    );
    expect(drifts.map((d) => d.kind)).toContain("version-mismatch");
  });
});

describe("AC-STE-554.7 — the README codename stops needing a hand edit", () => {
  test("bump, then grade: no codename violation survives the run", async () => {
    const root = releaseFixture("M143");
    expect(shipFixture(root).exitCode).toBe(0);

    const violations = checkReleaseSurfaceAgreement(
      read(join(root, "README.md")),
      read(join(root, "CHANGELOG.md")),
      [
        {
          path: "specs/plan/archive/M143.md",
          text: read(join(root, "specs", "plan", "archive", "M143.md")),
        },
      ],
      "2.80.1",
    );
    expect(violations.map((v) => v.field)).not.toContain("codename");
    expect(violations).toEqual([]);
  });

  test("with the codename dropped from the arm, the codename row returns", async () => {
    // Mutation on the SHIPPED module: the arm stops forwarding. The template
    // then names a placeholder with nothing to fill it, so the writer refuses
    // — which is the designed refusal (AC.3), and is itself the proof that the
    // forward is load-bearing. A silent stale codename is no longer reachable.
    const mutant = await importMutant(
      RELEASE_CONFIG,
      "return bumpRegex(content, file.pattern!, file.replace!, opts.newVersion, opts.codename);",
      "return bumpRegex(content, file.pattern!, file.replace!, opts.newVersion);",
      "ste554_arm",
    );
    const bumpFileMutant = mutant.bumpFile as typeof bumpFile;
    expect(() =>
      bumpFileMutant(README_ENTRY, README_BEFORE, { newVersion: "2.81.0", codename: "Ceremony" }),
    ).toThrow(/\{codename\}/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-554.8 / .9 — the skill names the surface, within its budget
// ---------------------------------------------------------------------------

describe("AC-STE-554.8 — the ceremony can see the requirements surface", () => {
  test("skills/ship-milestone/SKILL.md names it", () => {
    // Measured at e683bb9: zero occurrences. A reader following the skill
    // could not learn the surface existed.
    const occurrences = read(SHIP_SKILL).split("requirements").length - 1;
    expect(occurrences).toBeGreaterThan(0);
  });
});

describe("AC-STE-554.9 — the skill stays inside the NFR-1 cap", () => {
  test("counted by split, the way the cap's own suite counts", () => {
    const lines = read(SHIP_SKILL).split("\n").length;
    expect(lines).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});

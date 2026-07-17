// M108 STE-391 AC-STE-391.8 + AC-STE-391.9 — docs, count pins, the
// upgrade-reference doc, and the scoped STE-384 drift-allow-list carve-out.
//
// AC.9's "full gate green" is validated by the gate itself at the end of the
// FR; the deterministic proxies live here — the live-tree count pins that the
// calibration snapshots must agree with once `skills/upgrade/` ships.
//
// The retired literals composed in the fixture bodies below are deliberate —
// this is a `.test.ts` decoy under the STE-384 carve-out.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findRetiredLiterals } from "./_dpt-path-drift";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const UPGRADE_REFERENCE = join(PLUGIN_ROOT, "docs", "upgrade-reference.md");
const DRIFT_HELPER = join(PLUGIN_ROOT, "tests", "_dpt-path-drift.ts");

const tmpRoots: string[] = [];

function makeFixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-391-pins-"));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function cleanup(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// AC-STE-391.8 — docs/upgrade-reference.md
// ---------------------------------------------------------------------------

describe("AC-STE-391.8 — docs/upgrade-reference.md documents the registry contract", () => {
  const doc = (): string => readFileSync(UPGRADE_REFERENCE, "utf-8");

  test("the reference exists", () => {
    expect(existsSync(UPGRADE_REFERENCE)).toBe(true);
  });

  test("it documents the entry contract fields", () => {
    const body = doc();
    expect(body).toContain("introduced_in");
    expect(body).toMatch(/MigrationEntry|migration entry/i);
    expect(body).toMatch(/\bdetect\b/);
    expect(body).toMatch(/\bapply\b/);
  });

  test("it documents detector purity", () => {
    const body = doc();
    expect(body).toMatch(/pure|purity|never mutates|no side effects/i);
    expect(body).toMatch(/deterministic/i);
    expect(body).toMatch(/network-free|no network/i);
  });

  test("it documents kind semantics — script vs assisted", () => {
    const body = doc();
    expect(body).toMatch(/script/i);
    expect(body).toMatch(/assisted/i);
  });

  test("it documents the approval rails", () => {
    const body = doc();
    expect(body).toMatch(/approval/i);
    expect(body).toMatch(/diff preview/i);
    expect(body).toMatch(/never auto-appl|requires_explicit_approval/i);
  });

  test("it is an entry-authoring guide, not just a spec dump", () => {
    expect(doc()).toMatch(/authoring|adding a new entry|add a new entry|new migration entry/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.8 — count pins: 16 → 17 user-invocable at every pinned surface
// ---------------------------------------------------------------------------

describe("AC-STE-391.8 — README count pins move 16 → 17", () => {
  const readme = (): string => readFileSync(join(REPO_ROOT, "README.md"), "utf-8");

  test("no stale 16-user-invocable token survives", () => {
    expect(readme()).not.toMatch(/16 user-invo/);
  });

  test("the lifecycle prose counts 17 user-invoked skills", () => {
    expect(readme()).toMatch(/17 user-invo/);
  });

  test("the structure block counts 24 (17 + 7)", () => {
    expect(readme()).toMatch(/24\s*\(17\s*\+\s*7\)/);
  });

  test("the skills table carries a /upgrade row", () => {
    expect(readme()).toMatch(/^\|\s*`\/upgrade`/m);
  });
});

describe("AC-STE-391.8 — CLAUDE.md structure block counts move 16 → 17", () => {
  const claudeMd = (): string => readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf-8");

  test("the skills line counts 24 slash commands (17 user-invocable + 7 dispatch)", () => {
    expect(claudeMd()).toMatch(/24\s+slash commands\s+\(17\s+user-invocable\s+\+\s+7\s+dispatch/);
  });

  test("no stale 16-user-invocable token survives", () => {
    expect(claudeMd()).not.toMatch(/16\s+user-invocable/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.9 — live-tree ground truth the pins must agree with
// ---------------------------------------------------------------------------

// `user-invocable: false` is a frontmatter field, and a SKILL.md body may also
// quote it while documenting the fork contract — gate-check, spec-review, and
// tdd all do. Only the frontmatter declaration decides dispatch-only status, so
// the read is fenced to the leading `---` block.
const declaresDispatchOnly = (body: string): boolean => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
  return /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatter);
};

describe("AC-STE-391.9 — skills/ ground truth: 24 dirs, 17 user-invocable", () => {
  const skillDirs = (): string[] =>
    readdirSync(SKILLS_DIR).filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory());

  test("24 skill directories, upgrade among them", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBe(24);
    expect(dirs).toContain("upgrade");
  });

  test("exactly 17 skills are user-invocable (no `user-invocable: false`), upgrade among them", () => {
    const userInvocable = skillDirs().filter(
      (dir) => !declaresDispatchOnly(readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8")),
    );
    expect(userInvocable.length).toBe(17);
    expect(userInvocable).toContain("upgrade");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.8 — the STE-384 drift allow-list carve-out, scoped + non-vacuous
// ---------------------------------------------------------------------------

describe("AC-STE-391.8 — legacy_paths.ts and skills/upgrade/SKILL.md are exempt", () => {
  test("a retired literal inside migrations/legacy_paths.ts does not trip the gate", () => {
    const root = makeFixtureTree({
      "adapters/_shared/src/migrations/legacy_paths.ts":
        'export const LEGACY_LOCKS_DIR = ".dpt-locks";\nexport const LEGACY_LEDGER_DIR = ".dev-process";\n',
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanup();
  });

  test("a retired literal inside skills/upgrade/SKILL.md does not trip the gate", () => {
    const root = makeFixtureTree({
      "skills/upgrade/SKILL.md":
        "Removes the retired `.dpt-locks/` folder and the `.dev-process/` ledger dir.\n",
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanup();
  });
});

describe("AC-STE-391.8 — the carve-out is SCOPED: the tripwire still fires elsewhere", () => {
  test("a sibling entry module in the SAME migrations dir still fires", () => {
    const root = makeFixtureTree({
      "adapters/_shared/src/migrations/entries/m104_legacy_state.ts":
        'const dir = ".dpt-locks";\n',
    });
    const survivors = findRetiredLiterals([root]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.file).toBe(
      join(root, "adapters", "_shared", "src", "migrations", "entries", "m104_legacy_state.ts"),
    );
    cleanup();
  });

  test("another skill's SKILL.md still fires", () => {
    const root = makeFixtureTree({
      "skills/setup/SKILL.md": "Append `.dev-process/` to the project's `.gitignore`.\n",
    });
    expect(findRetiredLiterals([root]).map((s) => s.line)).toEqual([1]);
    cleanup();
  });

  test("the two exemptions differ from their firing twins ONLY by path — the carve-out is the variable", () => {
    const body = 'const legacy = ".dpt-locks";\n';
    const holds = makeFixtureTree({ "adapters/_shared/src/migrations/legacy_paths.ts": body });
    const fires = makeFixtureTree({ "adapters/_shared/src/migrations/index.ts": body });
    expect(findRetiredLiterals([holds])).toEqual([]);
    expect(findRetiredLiterals([fires]).map((s) => s.line)).toEqual([1]);
    cleanup();
  });
});

describe("AC-STE-391.8 — every new exemption states WHY, naming this FR", () => {
  test("the drift helper's comments name STE-391 and both carved-out paths", () => {
    const comments = readFileSync(DRIFT_HELPER, "utf-8")
      .split("\n")
      .filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(comments).toMatch(/STE-391/);
    expect(comments).toMatch(/legacy_paths\.ts/);
    expect(comments).toMatch(/skills\/upgrade\/SKILL\.md/);
  });
});

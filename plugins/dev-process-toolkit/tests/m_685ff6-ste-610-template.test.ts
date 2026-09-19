// STE-610 (M_685ff6) — the shipped prose and template of the span writer.
//
// AC-STE-610.7 — the plan template's `spans_repos` example uses placeholders
//   (`<this-repo-tag>: .`, `<sibling-repo-tag>: ../<sibling-directory>`) and
//   names the `--declare` command. Pasting the example verbatim into both roots
//   of a fixture is refused by refusal #4 from both roots, as unlocatable.
//   Pasting the HEAD example verbatim into the sibling is refused by STE-609's
//   one-self rule (a control on this branch: STE-609 already landed it).
// AC-STE-610.4 (prose) — `skills/spec-write/SKILL.md` line 177 orders the
//   `--declare` step right after the plan file is written, within STE-608's
//   line-177 budgets: no new module path to a module without a front door.
// AC-STE-610.6 (prose) — the offer surfaces run refusal #4 with `--offer`; the
//   release run names `--children`.
//
// Real git roots (GIT_ENV), torn down in a `finally`.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitAll, git } from "./_span_fixture";
import {
  PLUGIN_ROOT,
  REPO_ROOT,
  boundClaudeMd,
  describeRun,
  shipGateDoor,
  writeFr,
  writePlan,
} from "./_sibling_state_fixture";

const PLAN_TEMPLATE = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");
const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const MILESTONE = "M_GF_610";

const read = (p: string): string => readFileSync(p, "utf-8").replace(/\r\n?/g, "\n");

/** The one HTML comment of the plan template documenting `spans_repos`. */
function spanningComment(): string {
  const blocks = [...read(PLAN_TEMPLATE).matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
  const hits = blocks.filter((b) => b.includes("`spans_repos`") && /sibling/i.test(b));
  expect(hits.length, "expected exactly one spanning comment in the plan template").toBe(1);
  return hits[0]!;
}

/** The comment's example declaration, entry by entry, exactly as written. */
function templateExample(): Record<string, string> {
  const ls = spanningComment().split("\n");
  const at = ls.findIndex((l) => l.trim() === "spans_repos:");
  expect(at, "the spanning comment carries no `spans_repos:` example").toBeGreaterThan(-1);
  const indent = ls[at]!.length - ls[at]!.trimStart().length;
  const entries: Record<string, string> = {};
  for (const l of ls.slice(at + 1)) {
    if (l.trim() === "" || l.length - l.trimStart().length <= indent) break;
    const m = /^\s+(\S+):\s+(\S+)\s*$/.exec(l);
    expect(m, `example line \`${l}\` is not \`name: path\``).not.toBeNull();
    entries[m![1]!] = m![2]!;
  }
  expect(Object.keys(entries).length, "the example declares no entries").toBeGreaterThan(0);
  return entries;
}

/** The HEAD example, verbatim. */
const HEAD_EXAMPLE = { "glacy-app-fe": ".", "glacy-app-be": "../glacy-app-be" };

/**
 * Two toolkit-managed git roots named `glacy-app-fe` and `glacy-app-be`, side by
 * side under one parent, each holding one archived FR bound to the milestone.
 */
function withNamedPair<T>(body: (fe: string, be: string) => T): T {
  const parent = mkdtempSync(join(tmpdir(), "dpt-610-paste-"));
  try {
    const roots = ["glacy-app-fe", "glacy-app-be"].map((name, i) => {
      const root = join(parent, name);
      mkdirSync(root, { recursive: true });
      git(root, "init", "-q", "-b", "main");
      boundClaudeMd(root);
      writeFr(root, `STE-9610${i}`, MILESTONE, "archived");
      commitAll(root, "fixture: toolkit-managed root");
      return root;
    });
    return body(roots[0]!, roots[1]!);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// ===========================================================================
// AC-STE-610.7 — the template cannot resolve to self
// ===========================================================================

describe("AC-STE-610.7 — the template's example is placeholders and names --declare", () => {
  test("the example uses `<this-repo-tag>: .` and `<sibling-repo-tag>: ../<sibling-directory>` (red on HEAD)", () => {
    expect(templateExample()).toEqual({
      "<this-repo-tag>": ".",
      "<sibling-repo-tag>": "../<sibling-directory>",
    });
  });

  test("the comment names the --declare command as the way to write the key (red on HEAD)", () => {
    expect(spanningComment()).toContain("--declare");
  });

  test("pasting the template example verbatim into both roots is refused by refusal #4 from both roots, as unlocatable (red on HEAD)", () => {
    const example = templateExample();
    withNamedPair((fe, be) => {
      const planFe = writePlan(fe, "live", MILESTONE, example);
      const planBe = writePlan(be, "live", MILESTONE, example);
      commitAll(be, "fixture: pasted example");
      for (const [root, plan] of [
        [fe, planFe],
        [be, planBe],
      ] as const) {
        const r = shipGateDoor(root, plan, MILESTONE);
        expect(r.status, describeRun(r)).toBe(1);
        expect(r.stdout, describeRun(r)).toBe("");
        expect(r.stderr, describeRun(r)).toContain("unlocatable");
      }
    });
  }, 30_000);

  test("(control) pasting the HEAD example verbatim into the sibling is refused by STE-609's one-self rule", () => {
    withNamedPair((fe, be) => {
      const planFe = writePlan(fe, "live", MILESTONE, HEAD_EXAMPLE);
      writePlan(be, "live", MILESTONE, HEAD_EXAMPLE);
      commitAll(be, "fixture: HEAD example pasted into the sibling");
      const r = shipGateDoor(fe, planFe, MILESTONE);
      expect(r.status, describeRun(r)).toBe(1);
      expect(r.stderr, describeRun(r)).toContain("entries name the invoking repository");
    });
  }, 30_000);

  test("(control) the key is still documented in a comment and never scaffolded as a live key", () => {
    const text = read(PLAN_TEMPLATE);
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    expect(frontmatter).not.toMatch(/^spans_repos:/m);
    expect(spanningComment()).toContain("spans_repos:");
  });
});

// ===========================================================================
// AC-STE-610.4 (prose) — line 177 orders the declare step
// ===========================================================================

const MODULE_PATH_RE = /[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\.ts\b/g;
/** The commit STE-610 builds on: line 177's module paths before this FR. */
const BASE = "9acc1af";

function line177(): string {
  return read(SPEC_WRITE).split("\n")[176] ?? "";
}

describe("AC-STE-610.4 — spec-write line 177 orders --declare right after the plan file is written", () => {
  test("line 177 names --declare after a plan-file write (red on HEAD)", () => {
    const l = line177();
    const declare = l.indexOf("--declare");
    expect(declare, "line 177 never names --declare").toBeGreaterThan(-1);
    const write = l.search(/write the plan file/i);
    expect(write, "line 177 never orders a plan-file write").toBeGreaterThan(-1);
    expect(declare, "--declare is ordered before any plan file is written").toBeGreaterThan(write);
  });

  test("(control) every module path new to line 177 names a module with a front door", () => {
    const base = git(REPO_ROOT, "show", `${BASE}:plugins/dev-process-toolkit/skills/spec-write/SKILL.md`)
      .replace(/\r\n?/g, "\n")
      .split("\n")[176]!;
    const before = new Set(base.match(MODULE_PATH_RE) ?? []);
    const added = [...new Set(line177().match(MODULE_PATH_RE) ?? [])].filter((p) => !before.has(p));
    for (const p of added) {
      const file = join(PLUGIN_ROOT, "adapters", "_shared", "src", p.split("/").pop()!);
      expect(existsSync(file), `${p} names no module`).toBe(true);
      expect(read(file), `${p} has no front door`).toContain("import.meta.main");
    }
  });
});

// ===========================================================================
// AC-STE-610.6 (prose) — the offer surfaces pass --offer; the release --children
// ===========================================================================

const SHIP = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const OFFER_SURFACES = [
  join(PLUGIN_ROOT, "skills", "pr", "SKILL.md"),
  join(PLUGIN_ROOT, "skills", "spec-archive", "SKILL.md"),
  join(PLUGIN_ROOT, "skills", "implement", "SKILL.md"),
];

/** Every `sibling_release.ts …` command in `text`, up to its closing backtick. */
const commands = (text: string): string[] => text.match(/sibling_release\.ts[^`]*/g) ?? [];

describe("AC-STE-610.6 — the offer surfaces run refusal #4 with --offer; the release with --children", () => {
  test("the release candidate list in /ship-milestone passes --offer (red on HEAD)", () => {
    const line = read(SHIP)
      .split("\n")
      .find((l) => l.startsWith("Before offering a candidate, run the sibling release gate"));
    expect(line, "the candidate-list line moved").toBeDefined();
    const cmds = commands(line!);
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) expect(c).toContain("--offer");
  });

  for (const surface of OFFER_SURFACES) {
    const rel = surface.slice(PLUGIN_ROOT.length + 1);
    test(`${rel} runs every sibling_release.ts command with --offer (red on HEAD)`, () => {
      const cmds = commands(read(surface));
      expect(cmds.length, `${rel} no longer names the front door`).toBeGreaterThan(0);
      for (const c of cmds) expect(c, `${rel}: ${c}`).toContain("--offer");
    });
  }

  test("refusal #4 in /ship-milestone names --children for the release run (red on HEAD)", () => {
    const line = read(SHIP)
      .split("\n")
      .find((l) => l.startsWith("4. **Sibling not provably idle**"));
    expect(line, "refusal #4's line moved").toBeDefined();
    expect(line!).toContain("--children");
  });
});

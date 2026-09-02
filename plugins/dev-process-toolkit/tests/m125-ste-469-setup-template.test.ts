// M125 / STE-469 — "/setup --template flow: analyze-and-ask reuse selection
// via dispatch child skill".
//
// RED-first pins for the new NON-user-invocable `skills/setup-template/SKILL.md`
// dispatch child (STE-395 menu-exile precedent: `user-invocable: false`, NO
// `context: fork`, NO paired `agent:` — the second forkless dispatch child
// after `upgrade`), the `--template` dispatch line in `skills/setup/SKILL.md`,
// the count surfaces (skills 26→27, dispatch children 8→9, user-invocable
// stays 18), smoke fixture group 13 (headless refusal), the skills/ STE-token
// ceiling held at EXACTLY 246, and `docs/setup-template-reference.md`.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31, house precedent
// `m124-ste-466-best-practices-skill.test.ts`):
//   * count pins are LINE-SCOPED to the exact lines probe #57 reads (CLAUDE.md
//     line 15) and mirror the probe's own regexes.
//   * on-disk ground truth (27 dirs / 18 user-invocable / 9 internal) is
//     OBSERVED via `readdirSync` + the fenced-frontmatter predicate copied
//     verbatim from `m108-ste-391-docs-pins.test.ts`.
//   * the NFR-1 measure is `content.split("\n").length <= 358` — setup sits at
//     357/358, so the flag line spends its last headroom; the cap is pinned
//     here as the FR's own AC number (AC-STE-469.6 "setup ≤358").
//   * the skills/ STE-token ceiling sits at ZERO headroom (246/246) — pinned
//     to EXACT equality, and the new SKILL body to zero tracker-ID tokens.
//   * analyzer invocation: the child must run the STE-468 module VIA BUN, not
//     re-derive it. The house path-portability idiom for bun-running adapters
//     modules from a SKILL is `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/...`
//     (see skills/implement/SKILL.md best-practices select leg) — a
//     user-absolute path in shipped prose would be a portability defect, so
//     the pin demands the `${CLAUDE_PLUGIN_ROOT}` form.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
} from "../adapters/_shared/src/smoke_fixture_groups";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SETUP_SKILL = join(SKILLS_DIR, "setup", "SKILL.md");
const CHILD_SKILL = join(SKILLS_DIR, "setup-template", "SKILL.md");
const REFERENCE_DOC = join(PLUGIN_ROOT, "docs", "setup-template-reference.md");
const SKILL_ANATOMY = join(PLUGIN_ROOT, "docs", "skill-anatomy.md");
const FIXTURE_GROUPS_MODULE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "smoke_fixture_groups.ts",
);

const README = join(REPO_ROOT, "README.md");
const CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");
const TESTING_SPEC = join(REPO_ROOT, "specs", "testing-spec.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

// AC-STE-469.5's canonical machine-readable refusal marker, byte-for-byte.
const REFUSAL_MARKER = "<dpt:requires-input-refused>v1</dpt:requires-input-refused>";

// AC-STE-469.6's NFR-1 measure: setup ≤358 INCLUDING the flag line, and the
// child under the same canonical cap.
const SKILL_LINE_CAP = 358;

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

const setup = (): string => mustRead(SETUP_SKILL);
const child = (): string => mustRead(CHILD_SKILL);

// Fenced-frontmatter read, verbatim from m108-ste-391-docs-pins.test.ts —
// only the frontmatter block decides menu visibility; SKILL bodies may quote
// `user-invocable: false` in prose.
const frontmatterOf = (body: string): string =>
  /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";

const declaresNonUserInvocable = (body: string): boolean =>
  /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatterOf(body));

const skillDirs = (): string[] =>
  readdirSync(SKILLS_DIR).filter((name) =>
    statSync(join(SKILLS_DIR, name)).isDirectory(),
  );

const skillBody = (dir: string): string =>
  readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8");

// Namespace-token counter, copied from
// shipped-prose-no-internal-namespace.test.ts:24-40 — same walk, same regex.
function countNamespaceTokens(dir: string): number {
  let count = 0;
  function walk(d: string) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const body = readFileSync(p, "utf-8");
      const matches = body.match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
      count += matches.length;
    }
  }
  walk(dir);
  return count;
}

// The single line of `body` matching `anchor` (uniqueness asserted) —
// content-anchored per the gate-check-public-surface-count-drift idiom.
function onlyLine(body: string, anchor: RegExp): string {
  const hits = body.split("\n").filter((line) => anchor.test(line));
  expect({ anchor: String(anchor), hits: hits.length }).toEqual({
    anchor: String(anchor),
    hits: 1,
  });
  return hits[0]!;
}

// The `#### Fixture group 13 …` block of the smoke SKILL: heading line through
// the last line before the next heading (any #-level) or EOF.
function group13Block(): string {
  const body = mustRead(SMOKE_SKILL);
  const heading =
    /^#### Fixture group 13 — STE-469 .+\(Linear \+ Jira \+ tracker-less\)$/m.exec(
      body,
    );
  expect({ group13Heading: heading !== null }).toEqual({ group13Heading: true });
  const start = heading!.index;
  const rest = body.slice(start + heading![0]!.length);
  const next = /^#{1,4} /m.exec(rest);
  return heading![0]! + (next ? rest.slice(0, next.index) : rest);
}

// ---------------------------------------------------------------------------
// AC-STE-469.1 — the --template flag, the dispatch child, the counts
// ---------------------------------------------------------------------------

describe("AC-STE-469.1 — /setup dispatches --template to the setup-template child", () => {
  test("skills/setup/SKILL.md carries a dispatch line naming both `--template` and `setup-template`", () => {
    const hits = setup()
      .split("\n")
      .filter((line) => line.includes("--template") && line.includes("setup-template"));
    expect({ dispatchLines: hits.length > 0, sample: hits[0] ?? null }).toEqual({
      dispatchLines: true,
      sample: hits[0] ?? null,
    });
  });

  test("skills/setup/SKILL.md stays within the NFR-1 cap (≤358 including the flag line)", () => {
    expect(setup().split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("skills/setup-template/SKILL.md exists", () => {
    expect({ path: CHILD_SKILL, exists: existsSync(CHILD_SKILL) }).toEqual({
      path: CHILD_SKILL,
      exists: true,
    });
  });

  test("the child is menu-exiled: `user-invocable: false` in the frontmatter", () => {
    expect(declaresNonUserInvocable(child())).toBe(true);
  });

  test("the child stays MODEL-invocable and forkless: no disable-model-invocation, no context: fork, no agent: key", () => {
    const frontmatter = frontmatterOf(child());
    expect(frontmatter).not.toContain("disable-model-invocation");
    expect(frontmatter).not.toMatch(/^context:\s*fork\s*$/m);
    expect(frontmatter).not.toMatch(/^agent:/m);
  });
});

describe("AC-STE-469.1 — on-disk ground truth: 27 skill dirs, 18 user-invocable, 9 internal", () => {
  test("27 skill directories, setup-template among them", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBe(27);
    expect(dirs).toContain("setup-template");
  });

  test("exactly 18 user-invocable and 9 non-user-invocable, setup-template among the 9", () => {
    const dirs = skillDirs();
    const userInvocable = dirs.filter((dir) => !declaresNonUserInvocable(skillBody(dir)));
    expect(userInvocable.length).toBe(18);
    expect(dirs.length - userInvocable.length).toBe(9);
    expect(userInvocable).not.toContain("setup-template");
  });

  test("the forkless dispatch-child set is exactly [setup-template, upgrade] (STE-395 precedent)", () => {
    const forkless = skillDirs()
      .filter((dir) => {
        const frontmatter = frontmatterOf(skillBody(dir));
        return (
          /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatter) &&
          !/^context:\s*fork\s*$/m.test(frontmatter)
        );
      })
      .sort();
    expect(forkless).toEqual(["setup-template", "upgrade"]);
  });
});

describe("AC-STE-469.1 — count surfaces re-key to the 27 (18 + 9) forms", () => {
  test("README: `Nine additional skills`, its enumeration naming setup-template", () => {
    const body = mustRead(README);
    expect(body).toMatch(/Nine additional skills/);
    const line = onlyLine(body, /^Nine additional skills/);
    expect(line).toContain("setup-template");
  });

  test("README repo-tree skills row reads `27 (18 + 9)` with `(18 user-invocable + 9 internal forks)`", () => {
    const rows = mustRead(README)
      .split("\n")
      .filter((l) => l.includes("── skills/"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatch(/27\s*\(18\s*\+\s*9\)/);
    expect(row).toMatch(/\(18 user-invocable \+ 9 internal forks\)/);
  });

  test("CLAUDE.md line 15 skills row: 27 slash commands (18 user-invocable + 9 dispatch …)", () => {
    const line15 = mustRead(CLAUDE_MD).split("\n")[14] ?? "";
    expect(line15).toMatch(/^├── skills\//);
    expect(line15).toMatch(/27\s+slash commands?/);
    expect(line15).toMatch(/\(18\s+user-invocable\s*\+\s*9\s+dispatch/);
  });

  test("specs/testing-spec.md v2-minimal row: all 27 skills", () => {
    expect(mustRead(TESTING_SPEC)).toMatch(/all 27 skills/);
  });

  test("docs/skill-anatomy.md canonical-example line: the other 26 skills", () => {
    expect(mustRead(SKILL_ANATOMY)).toMatch(/the other 26 skills/);
  });

  // Meta-meta tripwire (house M108→M109→M124 pattern): the shipped
  // ground-truth suite must be RE-KEYED to 27, not left green on 26. The full
  // suite run is the real gate; this names the stalest pin so the implementer
  // cannot forget the legacy suites.
  test("m109-ste-395-delist-upgrade.test.ts re-keys its dir count to 27", () => {
    const src = mustRead(join(import.meta.dir, "m109-ste-395-delist-upgrade.test.ts"));
    expect(src).toContain("expect(dirs.length).toBe(27)");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-469.2 — analyzer via bun + Socratic per-category selection
// ---------------------------------------------------------------------------

describe("AC-STE-469.2 — the child runs analyzeTemplateSource via bun, never re-derived", () => {
  test("the body names analyzeTemplateSource", () => {
    expect(child()).toContain("analyzeTemplateSource");
  });

  test("the analyzer is invoked via bun through the portable plugin-root path", () => {
    // House idiom (skills/implement/SKILL.md): bun-run adapters modules via
    // ${CLAUDE_PLUGIN_ROOT}, never a machine-absolute path.
    expect(child()).toMatch(
      /bun run \$\{CLAUDE_PLUGIN_ROOT\}\/adapters\/_shared\/src\/template_source_analyzer/,
    );
  });
});

describe("AC-STE-469.2 — Socratic per-category reuse selection", () => {
  test("selection runs one category at a time via AskUserQuestion", () => {
    const body = child();
    expect(body).toContain("one category at a time");
    expect(body).toContain("AskUserQuestion");
  });

  test("manifest rows are filtered per-entry", () => {
    expect(child()).toContain("per-entry");
  });

  test("nothing is copied without an explicit selection", () => {
    expect(child()).toContain("explicit selection");
  });

  test("probe #43 auto-scope: the child cites Pattern 26 and the canonical protocol doc", () => {
    const body = child();
    expect(body).toContain("Pattern 26");
    expect(body).toContain("docs/auto-mode-protocol.md");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-469.3 — copy/adapt, unified diff preview, single bootstrap commit
// ---------------------------------------------------------------------------

describe("AC-STE-469.3 — copy/adapt with rewritten names behind ONE diff approval gate", () => {
  test("copied config gets project-identifying names rewritten", () => {
    expect(child()).toContain("project-identifying");
  });

  test("ONE unified diff preview gates the landing", () => {
    expect(child()).toContain("unified diff");
  });

  test("the porcelain pre-flight accounts for the template-copied set", () => {
    expect(child()).toContain("porcelain");
  });

  test("the child never commits itself — the files ride the normal single bootstrap commit", () => {
    // Stays off the branch-gate probe's commit-producing roster: the prose
    // says "bootstrap commit", never a literal `git commit`.
    expect(child()).not.toMatch(/\bgit\s+commit\b/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-469.4 — whole-project mode: full-tree copy + backup first
// ---------------------------------------------------------------------------

describe("AC-STE-469.4 — whole-project mode backs up a non-empty destination", () => {
  test("full-tree copy excludes .git; a filesystem backup precedes the transform", () => {
    const body = child();
    expect(body).toContain(".git");
    expect(body).toContain("backup");
  });

  test("the backup is backup-FIRST, deterministically named, and abort-on-failure", () => {
    const body = child();
    // Ordering: the backup fires before any transform touches the tree.
    expect(body).toMatch(/backup before any transform/i);
    // Deterministic collision-safe naming — the operator's restore path.
    expect(body).toContain("project-backup-<stamp>");
    expect(body).toMatch(/collision-suffixed/);
    // A failed backup aborts pre-mutation; no proceed-anyway branch.
    expect(body).toMatch(/failed backup aborts pre-mutation/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-469.5 — headless refusal with the canonical marker
// ---------------------------------------------------------------------------

describe("AC-STE-469.5 — non-tty stdin refuses with the canonical machine-readable marker", () => {
  test("the refusal is wired through the shared primitive", () => {
    const body = child();
    const wired =
      body.includes("requireOrRefuse") || body.includes("RequiresInputRefusedError");
    expect({ refusalWiring: wired }).toEqual({ refusalWiring: true });
  });

  test("the body carries the refusal marker literal — no carve-out", () => {
    expect(child()).toContain(REFUSAL_MARKER);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-469.6 — meta-test pins: caps, ceiling, fixture group 13, the doc
// ---------------------------------------------------------------------------

describe("AC-STE-469.6 — NFR-1 cap + zero-headroom STE-token ceiling", () => {
  test("skills/setup-template/SKILL.md is within the NFR-1 cap (≤358)", () => {
    expect(child().split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("the child body carries ZERO tracker-namespace tokens", () => {
    const tokens = child().match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
    expect(tokens).toEqual([]);
  });

  test("the skills/ STE-token ceiling stays EXACTLY 246 — new tokens must be offset", () => {
    expect(countNamespaceTokens(SKILLS_DIR)).toBe(246);
  });
});

describe("AC-STE-469.6 — smoke fixture group 13 in the canonical roster", () => {
  test("CANONICAL_FIXTURE_GROUPS has 15 entries numbered 1..15", () => {
    expect(CANONICAL_FIXTURE_GROUPS.length).toBe(15);
    expect(CANONICAL_FIXTURE_GROUPS.map((spec) => spec.group)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  test("entry 13: sut STE-469, the full SMOKE_LEGS roster, a real rationale", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((entry) => entry.group === 13);
    expect({ group13: spec !== undefined }).toEqual({ group13: true });
    expect(spec!.sut).toBe("STE-469");
    expect([...spec!.legs]).toEqual(["linear", "jira", "none"]);
    // The ALIAS, not a parallel literal — reference identity is the observable
    // (house idiom: m123's group-11 pin, m124's group-12 pin). A fresh array
    // with the same values recreates the second-hardcoded-copy failure STE-446
    // exists to have ended, and value equality alone cannot see it.
    expect(spec!.legs).toBe(SMOKE_LEGS as unknown as typeof spec.legs);
    expect(spec!.rationale.trim().split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });

  test("SMOKE_LEGS is untouched — byte-identical source line and value", () => {
    expect([...SMOKE_LEGS]).toEqual(["linear", "jira", "none"]);
    expect(mustRead(FIXTURE_GROUPS_MODULE)).toContain(
      'export const SMOKE_LEGS = ["linear", "jira", "none"] as const;',
    );
  });
});

describe("AC-STE-469.6 — smoke SKILL group-13 block asserts the headless refusal", () => {
  test("the heading announces STE-469 on all three legs", () => {
    // group13Block() itself asserts the heading's existence + annotation.
    expect(group13Block().split("\n")[0]).toContain("Fixture group 13 — STE-469");
  });

  test("the SKILL carries all three footer literals — silence is never a pass", () => {
    const body = mustRead(SMOKE_SKILL);
    expect(body).toContain("STE-469 runtime check: PASS");
    expect(body).toContain("STE-469 runtime check: FAIL");
    expect(body).toContain("STE-469 runtime check: NOT-REACHED");
  });

  test("the block body names the refusal marker it asserts", () => {
    expect(group13Block()).toContain(REFUSAL_MARKER);
  });
});

describe("AC-STE-469.6 — docs/setup-template-reference.md carries the narrative", () => {
  test("the reference doc exists, non-empty, and names the flag, the child, and the analyzer", () => {
    const body = mustRead(REFERENCE_DOC);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain("--template");
    expect(body).toContain("setup-template");
    expect(body).toContain("analyzeTemplateSource");
  });
});

// M124 / STE-466 — "/best-practices management skill + /setup manifest
// seeding".
//
// RED-first pins for the new user-invocable `skills/best-practices/SKILL.md`
// (mirror of the /deps idiom, minus `sync`), the probe-#57 count surfaces
// (user-invocable 17→18, total 25→26), the /setup seeding step (STE-303
// re-entrant diff-approval pattern), and the STE-465 module's exported
// closed-enum consts (`KNOWN_KEYS` / `LIST_KEYS`) the SKILL's validation
// flows consume.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31, house M123 precedent
// `m123-ste-464-deliver-skill.test.ts`):
//   * count pins are LINE-SCOPED to the exact lines probe #57 reads (README
//     line 3, CLAUDE.md line 15) and mirror the probe's own regexes.
//   * the on-disk ground truth (26 dirs / 18 user-invocable) is OBSERVED via
//     `readdirSync` + the fenced-frontmatter predicate copied verbatim from
//     `m108-ste-391-docs-pins.test.ts`.
//   * the NFR-1 line cap is PARSED from `skill-nfr-1-length.test.ts` rather
//     than restated — a legitimate cap bump must not strand this suite on a
//     stale integer while the canonical loop stays authoritative.
//   * the skills/ STE-token ceiling sits at ZERO headroom (246/246, see
//     `shipped-prose-no-internal-namespace.test.ts`), so the new SKILL body
//     and the new /setup section are pinned to carry NO tracker-ID tokens —
//     an absence paired with presence floors on the same extractions.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const BP_SKILL = join(SKILLS_DIR, "best-practices", "SKILL.md");
const SETUP_SKILL = join(SKILLS_DIR, "setup", "SKILL.md");
const SKILL_ANATOMY = join(PLUGIN_ROOT, "docs", "skill-anatomy.md");

const README = join(REPO_ROOT, "README.md");
const CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");
const TECH_SPEC = join(REPO_ROOT, "specs", "technical-spec.md");
const TESTING_SPEC = join(REPO_ROOT, "specs", "testing-spec.md");

const MODULE_PATH_LITERAL = "adapters/_shared/src/best_practices_manifest.ts";

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

const bp = (): string => mustRead(BP_SKILL);
const setup = (): string => mustRead(SETUP_SKILL);

// Fenced-frontmatter read + predicate, verbatim from
// m108-ste-391-docs-pins.test.ts — only the frontmatter block decides menu
// visibility; SKILL bodies may quote `user-invocable: false` in prose.
const declaresNonUserInvocable = (body: string): boolean => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
  return /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatter);
};

const skillDirs = (): string[] =>
  readdirSync(SKILLS_DIR).filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory());

const stripHtmlComments = (content: string): string =>
  content.replace(/<!--[\s\S]*?-->/g, "");

/** The `## <name>` H2 section body, up to the next H2 (or EOF). */
function h2Section(body: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)## ${name}[ \\t]*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = re.exec(body);
  expect({ heading: `## ${name}`, found: m !== null }).toEqual({
    heading: `## ${name}`,
    found: true,
  });
  return m![1]!;
}

/** The /setup best-practices seeding step section (### Nx heading → next ###/##). */
function setupSeedingSection(): string {
  const m = setup().match(
    // Line-anchored: the `### N.`-style heading line itself must name best
    // practices; the section runs to the next ###/## heading (or EOF).
    /^###[ \t]+\d+[a-z]?\.[ \t]+[^\n]*[Bb]est[- ]practices[^\n]*\n[\s\S]*?(?=\n###?#?[ \t]|$(?![\s\S]))/m,
  );
  expect({ seedingStepHeading: m !== null }).toEqual({ seedingStepHeading: true });
  return m![0]!;
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

// ---------------------------------------------------------------------------
// AC-STE-466.1 — skills/best-practices/SKILL.md exists, mirrors /deps
// ---------------------------------------------------------------------------

describe("AC-STE-466.1 — skills/best-practices/SKILL.md exists and is user-invocable", () => {
  test("the skill file exists", () => {
    expect({ path: BP_SKILL, exists: existsSync(BP_SKILL) }).toEqual({
      path: BP_SKILL,
      exists: true,
    });
  });

  test("frontmatter names the skill and carries a description", () => {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(bp())?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: best-practices$/m);
    expect(frontmatter).toMatch(/^description: .+/m);
  });

  test("no `user-invocable: false` in the frontmatter — /best-practices is on the slash menu", () => {
    expect(declaresNonUserInvocable(bp())).toBe(false);
  });
});

describe("AC-STE-466.1 — /deps idiom mirror: router + four subcommand sections", () => {
  test("the four H2 sections exist: add / edit / delete / list", () => {
    const body = bp();
    for (const name of ["add", "edit", "delete", "list"]) {
      expect(body).toMatch(new RegExp(`(?:^|\\n)## ${name}[ \\t]*(?:\\n|$)`));
    }
  });

  test("no `## sync` section — sync is a /deps-only concern (no checkouts here)", () => {
    // Absence paired with a presence floor: the router's Supported list is
    // pinned to exactly the four subcommands below.
    expect(bp()).not.toMatch(/(?:^|\n)## sync\b/);
  });

  test("the subcommand router refuses unknown subcommands with the four-item Supported list", () => {
    const body = bp();
    expect(body).toContain("unknown subcommand");
    expect(body).toMatch(/Supported: add \| edit \| delete \| list\b/);
  });

  test("the manifest path and STE-465 module path are named; YAML is never hand-authored", () => {
    const body = bp();
    expect(body).toContain("specs/best-practices.yaml");
    expect(body).toContain(MODULE_PATH_LITERAL);
    expect(body).toMatch(/[Nn]ever author `specs\/best-practices\.yaml` YAML by hand/);
  });

  test("all mutations route through the module helpers (readManifest/writeManifest/addEntry/removeEntry/findEntry)", () => {
    const body = bp();
    for (const helper of [
      "readManifest",
      "writeManifest",
      "addEntry",
      "removeEntry",
      "findEntry",
    ]) {
      expect(body).toContain(helper);
    }
  });

  test("write flows are commit-producing: branch gate + chore(specs) commit subject", () => {
    const body = bp();
    expect(body).toContain("requireCommittableBranch");
    expect(body).toMatch(/branch_gate_/);
    expect(body).toMatch(/chore\(specs\):[^\n]*best[- ]practices/);
  });
});

describe("AC-STE-466.1 — on-disk ground truth: 27 skill dirs, 18 user-invocable", () => {
  test("27 skill directories, best-practices among them", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBe(27);
    expect(dirs).toContain("best-practices");
  });

  test("exactly 18 skills are user-invocable, best-practices among them; the fork/dispatch set is 9 (M125)", () => {
    const dirs = skillDirs();
    const userInvocable = dirs.filter(
      (dir) => !declaresNonUserInvocable(readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8")),
    );
    expect(userInvocable.length).toBe(18);
    expect(userInvocable).toContain("best-practices");
    expect(dirs.length - userInvocable.length).toBe(9);
  });
});

describe("AC-STE-466.1 — README count surfaces (probe #57's exact lines)", () => {
  const readmeLines = (): string[] => mustRead(README).split("\n");

  test("line 3 pitch reads `18 commands, 8 agents` (probe #57 parses line index 2)", () => {
    const line3 = readmeLines()[2] ?? "";
    expect(line3).toMatch(/18\s+commands?,\s+8\s+agents?/);
  });

  test("the lifecycle prose counts 18 user-invoked skills", () => {
    expect(onlyLine(mustRead(README), /^The toolkit groups its/)).toMatch(
      /\b18 user-invoked skills\b/,
    );
  });

  test("the repo-tree skills row reads `27 (18 + 9)` with `(18 user-invocable + 9 internal forks)`", () => {
    const rows = readmeLines().filter((l) => l.includes("── skills/"));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatch(/27\s+\(18\s*\+\s*9\)/);
    expect(row).toMatch(/\(18 user-invocable \+ 9 internal forks\)/);
  });

  test("`Nine additional skills` — the dispatch count moved with setup-template (M125)", () => {
    expect(mustRead(README)).toMatch(/Nine additional skills/);
  });
});

describe("AC-STE-466.1 — CLAUDE.md count surfaces (probe #57 reads line 15 verbatim)", () => {
  test("line 15 skills row: 27 slash commands (18 user-invocable + 9 dispatch …)", () => {
    const line15 = mustRead(CLAUDE_MD).split("\n")[14] ?? "";
    expect(line15).toMatch(/^├── skills\//);
    expect(line15).toMatch(/27\s+slash commands?/);
    expect(line15).toMatch(/\(18\s+user-invocable\s*\+\s*9\s+dispatch/);
  });

  test("the agents row is untouched: 8 subagent templates", () => {
    expect(mustRead(CLAUDE_MD)).toMatch(/8 subagent templates/);
  });
});

describe("AC-STE-466.1 — remaining count surfaces", () => {
  test("specs/technical-spec.md skills row: 18 user-invocable SKILL.md files", () => {
    expect(mustRead(TECH_SPEC)).toMatch(/18 user-invocable SKILL\.md files/);
  });

  test("specs/testing-spec.md v2-minimal row: all 27 skills", () => {
    expect(mustRead(TESTING_SPEC)).toMatch(/all 27 skills/);
  });

  test("docs/skill-anatomy.md canonical-example line: the other 26 skills", () => {
    const lines = mustRead(SKILL_ANATOMY)
      .split("\n")
      .filter((l) => l.includes("canonical read-only example"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toMatch(/the other 26 skills/);
  });
});

// Meta-meta pins — house M108→M109→M123 pattern: the shipped count-pin
// suites must be RE-KEYED to the new 18 / 26 forms, not deleted and not left
// green on stale numbers. Substring pins sidestep regex double-escaping.
describe("AC-STE-466.1 — shipped count-pin suites re-key to the 18 / 27 forms (M125)", () => {
  const testSrc = (name: string): string => mustRead(join(import.meta.dir, name));

  for (const suite of [
    "gate-check-public-surface-count-drift.test.ts",
    "m109-ste-395-delist-upgrade.test.ts",
    "m123-ste-464-deliver-skill.test.ts",
  ]) {
    test(`${suite} carries the new live-tree literals`, () => {
      const src = testSrc(suite);
      expect(src).toContain("18 commands");
      expect(src).toContain("all 27 skills");
      expect(src).toContain("the other 26 skills");
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-466.2 — Socratic add/edit flows + STE-465-module validation
// ---------------------------------------------------------------------------

describe("AC-STE-466.2 — add and edit flows are Socratic (AskUserQuestion, one per step)", () => {
  test("the add section declares the Socratic flow with AskUserQuestion prompts", () => {
    const add = h2Section(bp(), "add");
    expect(add).toMatch(/Socratic flow/);
    expect(add).toContain("AskUserQuestion");
    expect(add).toMatch(/Bare-prose questions are forbidden/);
  });

  test("the edit section declares the Socratic flow with AskUserQuestion prompts", () => {
    const edit = h2Section(bp(), "edit");
    expect(edit).toMatch(/Socratic flow/);
    expect(edit).toContain("AskUserQuestion");
  });

  test("probe #43 auto-scope: the SKILL carries a Socratic scope trigger", () => {
    // socratic_loop_uses_ask_user_question scopes on `socratic: true`
    // frontmatter OR a `Pattern 26` body citation — the FR requires the
    // probe to pick this SKILL up automatically.
    const raw = bp();
    const inScope =
      /^\s*socratic:\s*true\s*$/m.test(raw) ||
      /\bPattern 26\b/.test(stripHtmlComments(raw));
    expect({ socraticScopeTrigger: inScope }).toEqual({ socraticScopeTrigger: true });
  });

  test("probe #43 requirements: body cites the canonical protocol doc", () => {
    expect(stripHtmlComments(bp())).toContain("docs/auto-mode-protocol.md");
  });
});

describe("AC-STE-466.2 — shape errors refuse; invalid entries are never written", () => {
  test("the SKILL surfaces BestPracticesManifestShapeError verbatim (NFR-10 canonical refusal)", () => {
    const body = bp();
    expect(body).toContain("BestPracticesManifestShapeError");
    expect(body).toMatch(/verbatim/);
    expect(body).toMatch(/NFR-10/);
  });

  test("the write path fails closed — validation refusals abort before writeManifest", () => {
    expect(bp()).toMatch(/fails? closed/);
  });

  test("the STE-465 module exports the closed-enum consts the flows validate against", async () => {
    // Currently module-private — this drives the RED state for the export
    // surface the SKILL's add/edit field prompts consume.
    const mod: Record<string, unknown> = await import(
      "../adapters/_shared/src/best_practices_manifest"
    );
    expect(mod.KNOWN_KEYS).toEqual(["name", "path", "scope", "topics", "notes"]);
    expect(mod.LIST_KEYS).toEqual(["scope", "topics"]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-466.3 — /setup optional seeding step (STE-303 re-entrant pattern)
// ---------------------------------------------------------------------------

describe("AC-STE-466.3 — /setup gains an optional best-practices seeding step", () => {
  test("a numbered step heading names best practices", () => {
    expect(setup()).toMatch(/^###\s+\d+[a-z]?\.\s+[^\n]*[Bb]est[- ]practices/m);
  });

  test("the step names the manifest path and routes writes through the STE-465 module", () => {
    const section = setupSeedingSection();
    expect(section).toContain("specs/best-practices.yaml");
    expect(section).toMatch(/best_practices_manifest/);
  });

  test("re-entrant pattern: existing manifest is the baseline, proposal shown as a unified diff", () => {
    const section = setupSeedingSection();
    expect(section).toMatch(/baseline/i);
    expect(section).toMatch(/unified[- ]diff/i);
  });

  test("the approval gate prompts via AskUserQuestion with approve and cancel branches", () => {
    const section = setupSeedingSection();
    expect(section).toContain("AskUserQuestion");
    expect(section).toMatch(/approve/i);
    expect(section).toMatch(/cancel/i);
  });

  test("cancel keeps the file untouched", () => {
    expect(setupSeedingSection()).toMatch(/untouched/);
  });

  test("the step is optional (opt-in / skippable)", () => {
    expect(setupSeedingSection()).toMatch(/opt-in|optional|skip/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-466.4 — NFR-1 line caps + zero-headroom STE-token ceiling
// ---------------------------------------------------------------------------

describe("AC-STE-466.4 — NFR-1 line cap green on every touched SKILL", () => {
  // Parse the canonical cap from skill-nfr-1-length.test.ts so a legitimate
  // cap bump cannot strand this suite on a stale integer.
  const cap = (): number => {
    const src = mustRead(join(import.meta.dir, "skill-nfr-1-length.test.ts"));
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(src);
    expect({ capParsed: m !== null }).toEqual({ capParsed: true });
    return Number(m![1]);
  };

  test("skills/best-practices/SKILL.md is within the canonical cap", () => {
    expect(bp().split("\n").length).toBeLessThanOrEqual(cap());
  });

  test("skills/setup/SKILL.md stays within the canonical cap after the seeding step", () => {
    expect(setup().split("\n").length).toBeLessThanOrEqual(cap());
  });
});

describe("AC-STE-466.4 — skills/ STE-token ceiling at zero headroom (246/246)", () => {
  test("the new SKILL body carries NO tracker-ID tokens", () => {
    const tokens = bp().match(/\bSTE-\d+\b/g) ?? [];
    expect(tokens).toEqual([]);
  });

  test("the new /setup seeding section carries NO tracker-ID tokens", () => {
    const tokens = setupSeedingSection().match(/\bSTE-\d+\b/g) ?? [];
    expect(tokens).toEqual([]);
  });
});

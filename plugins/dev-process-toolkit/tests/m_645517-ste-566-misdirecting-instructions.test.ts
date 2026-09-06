// STE-566 — instructions that misdirect an author or break a consumer.
//
// Four findings, two of them shipped bugs a documentation audit found rather
// than a test. Every leg here follows the same rule: the assertion reads BOTH
// sides, and where a defect is claimed, the retired form is executed in the
// same leg and measured to fail. A test that only exercises the fix cannot
// tell a fix from a coincidence.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bumpFile,
  bumpRegex,
  parseReleaseFiles,
  RegexPatternMissError,
} from "../adapters/_shared/src/release_config";
import {
  checkMutuallyExclusiveFlagUse,
  extractExclusiveFlags,
  extractStatedInvocations,
} from "../adapters/_shared/src/skill_cross_reference";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const read = (p: string) => readFileSync(p, "utf-8");
const skill = (name: string) => read(join(pluginRoot, "skills", name, "SKILL.md"));

const DOCS_BODY = skill("docs");
const SHIP_REL = "plugins/dev-process-toolkit/skills/ship-milestone/SKILL.md";
const SHIP_BODY = read(join(repoRoot, SHIP_REL));

// ===========================================================================
// AC-STE-566.1 / .2 — the release ceremony states an invocation /docs accepts
// ===========================================================================

describe("AC-STE-566.1 — step 5 is two sequential single-flag invocations", () => {
  test("states --commit and --full separately, in that order", () => {
    expect(SHIP_BODY).toContain("/docs --commit");
    expect(SHIP_BODY).toContain("/docs --full");
    expect(SHIP_BODY.indexOf("/docs --commit")).toBeLessThan(
      SHIP_BODY.indexOf("/docs --full"),
    );
  });

  test("states WHY the order is forced, not merely what it is", () => {
    // `--full` deletes every staged fragment as superseded, so a `--full` that
    // ran first would leave `--commit` nothing to merge. An operator who knows
    // only the order will reverse it the first time it looks arbitrary.
    expect(SHIP_BODY).toMatch(/docs\/\.pending\/[^\n]*supersed/i);
    expect(DOCS_BODY).toMatch(/Delete all `docs\/\.pending\/\*\.md`/);
  });

  test("each invocation has its own non-zero-exit abort leg", () => {
    expect(SHIP_BODY).toMatch(/If either invocation fails/);
    expect(SHIP_BODY).toMatch(/step=<--commit\|--full>/);
    expect(SHIP_BODY).toMatch(/A `--commit` failure aborts before `--full` runs/);
  });
});

describe("AC-STE-566.2 — the composite form is gone from every site", () => {
  test("the literal /docs --commit --full does not occur in the skill", () => {
    expect(SHIP_BODY).not.toContain("/docs --commit --full");
  });

  test("the frontmatter description and the pre-flight set both moved", () => {
    const frontmatter = SHIP_BODY.split("---")[1] ?? "";
    expect(frontmatter).toContain("/docs --commit and /docs --full");
    expect(SHIP_BODY).toMatch(
      /expected-modified set is[^\n]*two `\/docs` invocations in step 5/,
    );
  });
});

// ===========================================================================
// AC-STE-566.3 / .4 — asserted from both sides by one reader
// ===========================================================================

describe("AC-STE-566.3 — the exclusive flag set is DERIVED from /docs", () => {
  test("reads the rule out of the /docs body rather than hardcoding it", () => {
    const flags = extractExclusiveFlags(DOCS_BODY);
    expect(flags).toEqual(["--quick", "--commit", "--full"]);
  });

  test("a fourth flag added to the rule is picked up without a code change", () => {
    const widened = mutate(
      DOCS_BODY,
      /flags --quick, --commit, and --full are mutually exclusive/,
      "flags --quick, --commit, --full, and --preview are mutually exclusive",
    );
    expect(extractExclusiveFlags(widened)).toContain("--preview");
  });

  test("tolerates the bolded prose spelling as well as the refusal literal", () => {
    expect(
      extractExclusiveFlags("The flags --a and --b are **mutually exclusive**:"),
    ).toEqual(["--a", "--b"]);
  });

  test("refuses to grade against an empty rule set instead of passing", () => {
    // A silently empty rule set returns zero violations and reads as green.
    // That is the exact failure shape this module exists to prevent, so the
    // absence of a documented rule must be loud.
    expect(() =>
      checkMutuallyExclusiveFlagUse({
        citedSkillBody: "# docs\n\nNo exclusivity documented here.\n",
        citedSkillName: "docs",
        citingBody: SHIP_BODY,
        citingFile: SHIP_REL,
      }),
    ).toThrow(/no\s+mutually-exclusive flag rule/);
  });

  test("extraction sees every stated form, including headings", () => {
    const found = extractStatedInvocations(
      "### 5. Invoke /docs --commit --full\n\nrun `/docs --quick` per FR\n",
      "docs",
    );
    expect(found.map((f) => f.raw)).toEqual([
      "/docs --commit --full",
      "/docs --quick",
    ]);
    expect(found[0]!.line).toBe(1);
  });

  test("a bare mention makes no flag claim and is not returned", () => {
    expect(extractStatedInvocations("see `/docs` for detail", "docs")).toEqual([]);
  });
});

describe("AC-STE-566.4 — the shipped ceremony reports zero violations", () => {
  const run = (citingBody: string) =>
    checkMutuallyExclusiveFlagUse({
      citedSkillBody: DOCS_BODY,
      citedSkillName: "docs",
      citingBody,
      citingFile: SHIP_REL,
    });

  test("/ship-milestone states nothing /docs refuses", () => {
    expect(run(SHIP_BODY)).toEqual([]);
  });

  test("FALSIFIABILITY — restoring the composite form reds this assertion", () => {
    const regressed = mutate(
      SHIP_BODY,
      /### 5\. Invoke \/docs --commit, then \/docs --full/,
      "### 5. Invoke /docs --commit --full",
    );
    const violations = run(regressed);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.invocation).toBe("/docs --commit --full");
    expect(violations[0]!.reason).toMatch(/--commit \+ --full/);
    expect(violations[0]!.file).toBe(SHIP_REL);
  });
});

// ===========================================================================
// AC-STE-566.5 — the downstream surfaces moved with it
// ===========================================================================

describe("AC-STE-566.5 — downstream surfaces state a form /docs accepts", () => {
  const surfaces: Array<[string, string]> = [
    ["README.md", join(repoRoot, "README.md")],
    ["specs/technical-spec.md", join(repoRoot, "specs", "technical-spec.md")],
    [
      "docs/ship-milestone-reference.md",
      join(pluginRoot, "docs", "ship-milestone-reference.md"),
    ],
    ["docs/workflow-overview.md", join(pluginRoot, "docs", "workflow-overview.md")],
  ];

  for (const [label, path] of surfaces) {
    test(`${label} carries no refused invocation`, () => {
      expect(
        checkMutuallyExclusiveFlagUse({
          citedSkillBody: DOCS_BODY,
          citedSkillName: "docs",
          citingBody: read(path),
          citingFile: label,
        }),
      ).toEqual([]);
    });
  }
});

// ===========================================================================
// AC-STE-566.6 / .7 / .8 — the Kotlin example matches a real gradle.properties
// ===========================================================================

describe("AC-STE-566.6 — the shipped pattern bumps a realistic file", () => {
  const yaml = read(join(pluginRoot, "examples", "kotlin", "release.yml"));
  const entries = parseReleaseFiles(`## Release Files\n\n\`\`\`yaml\n${yaml}\`\`\`\n`);
  const gradle = entries.find((e) => e.path === "gradle.properties")!;
  const RETIRED = String.raw`^version=(?<version>\d+\.\d+\.\d+)`;
  // Gradle's own scaffold leads with these; `version=` is never on line one.
  const REALISTIC =
    "org.gradle.jvmargs=-Xmx2048M\nkotlin.code.style=official\nversion=1.2.3\n";

  test("the entry parses off the shipped file", () => {
    expect(gradle.kind).toBe("regex");
  });

  test("MEASURED — the shipped pattern bumps a version key not on line one", () => {
    expect(bumpFile(gradle, REALISTIC, { newVersion: "1.2.4" })).toBe(
      "org.gradle.jvmargs=-Xmx2048M\nkotlin.code.style=official\nversion=1.2.4\n",
    );
  });

  test("MEASURED — the RETIRED pattern throws on that same input", () => {
    // The finding reproduced as a test, in the same leg as the fix. Without
    // this, "the new pattern works" is indistinguishable from "any pattern
    // would have worked".
    expect(() => bumpRegex(REALISTIC, RETIRED, "version={version}", "1.2.4")).toThrow(
      RegexPatternMissError,
    );
  });

  test("the lookbehind does not widen into other version keys", () => {
    // Deleting the `^` outright would also rewrite `kotlin.version=`, trading
    // one blind spot for a corruption.
    const withSibling = `kotlin.version=2.0.0\nversion=1.2.3\n`;
    expect(bumpFile(gradle, withSibling, { newVersion: "1.2.4" })).toBe(
      "kotlin.version=2.0.0\nversion=1.2.4\n",
    );
  });

  test("AC-STE-566.8 — the line-one case still bumps", () => {
    expect(bumpFile(gradle, "version=1.2.3\nfoo=bar\n", { newVersion: "1.2.4" })).toBe(
      "version=1.2.4\nfoo=bar\n",
    );
  });

  test("AC-STE-566.7 — the entry stays NON-optional", () => {
    // STE-555 made a non-matching OPTIONAL entry skip rather than abort. On a
    // field that must be written, that converts a wrong pattern into a silent
    // non-bump reported as success — worse than the refusal it replaces.
    expect(gradle.optional).toBeFalsy();
  });
});

// ===========================================================================
// AC-STE-566.10 / .11 — the fork patterns that ship are the ones documented
// ===========================================================================

describe("AC-STE-566.10 — skill-anatomy presents both delegation patterns", () => {
  const anatomy = read(join(pluginRoot, "docs", "skill-anatomy.md"));

  test("the false claims are gone", () => {
    for (const claim of [
      "does not exercise",
      "unexercised in this plugin",
      "No skills in this plugin use this frontmatter",
    ]) {
      expect(anatomy).not.toContain(claim);
    }
  });

  test("both patterns are named as shipped, with a rule for picking", () => {
    expect(anatomy).toContain("this plugin ships both");
    expect(anatomy).toMatch(/Whole-skill `context: fork`/);
    expect(anatomy).toMatch(/Explicit `Agent`-tool invocation/);
    expect(anatomy).toMatch(/Which to pick/);
  });

  test("the enforcing probes are named", () => {
    for (const probe of ["#39", "#50", "#51", "#54"]) expect(anatomy).toContain(probe);
  });

  test("the two forkless dispatch-only skills are distinguished", () => {
    // `user-invocable: false` is not a fork marker: /upgrade and setup-template
    // carry it without forking, and an author reading it as one is misdirected.
    expect(anatomy).toMatch(/WITHOUT being fork children/);
  });
});

describe("AC-STE-566.11 — the fork-child count is derived from the tree", () => {
  const anatomy = read(join(pluginRoot, "docs", "skill-anatomy.md"));
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

  const observedForkChildren = () => {
    const base = join(pluginRoot, "skills");
    const { readdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(base).filter((d) => {
      const f = join(base, d, "SKILL.md");
      if (!existsSync(f)) return false;
      const fm = read(f).split("---")[1] ?? "";
      return /^context:\s*fork\s*$/m.test(fm);
    });
  };

  /** Does `doc` state that exactly `n` skills carry the fork frontmatter? */
  const statesForkChildCount = (doc: string, n: number): boolean => {
    const word = WORDS[n];
    if (word === undefined) return false;
    return new RegExp(`\\b${word} shipped skills carry this frontmatter`, "i").test(doc);
  };

  test("the doc's stated count equals the on-disk count", () => {
    const observed = observedForkChildren();
    expect(observed.length).toBeGreaterThan(0);
    expect(statesForkChildCount(anatomy, observed.length)).toBe(true);
  });

  test("every fork child on disk is named in the doc's enumeration", () => {
    for (const name of observedForkChildren()) expect(anatomy).toContain(name);
  });

  test("FALSIFIABILITY — a neighbouring count does not satisfy the check", () => {
    // The check IS the derivation, so the first mutation is on the TREE side:
    // had one more (or one fewer) skill carried the frontmatter, the doc's
    // number would be wrong and this predicate says so.
    const observed = observedForkChildren();
    expect(statesForkChildCount(anatomy, observed.length + 1)).toBe(false);
    expect(statesForkChildCount(anatomy, observed.length - 1)).toBe(false);
  });

  test("FALSIFIABILITY — a doc stating the wrong number is caught", () => {
    const observed = observedForkChildren();
    const wrong = mutate(
      anatomy,
      new RegExp(`${WORDS[observed.length]} shipped skills carry this frontmatter`, "i"),
      `${WORDS[observed.length + 1]} shipped skills carry this frontmatter`,
    );
    expect(statesForkChildCount(wrong, observed.length)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-566.12 — the docs-section write contract, from both sides
// ===========================================================================

describe("AC-STE-566.12 — setup-docs-mode states the shipped write contract", () => {
  const docsMode = read(join(pluginRoot, "docs", "setup-docs-mode.md"));
  const reference = read(join(pluginRoot, "docs", "setup-reference.md"));
  const setupSkill = skill("setup");

  test("the retired 'do not write the section' instruction is gone", () => {
    expect(docsMode).not.toMatch(/do not write the\s*\n?`## Docs` section at all/);
  });

  test("all three surfaces state the same write contract", () => {
    for (const [label, body] of [
      ["setup-docs-mode.md", docsMode],
      ["setup-reference.md", reference],
      ["setup/SKILL.md", setupSkill],
    ] as const) {
      expect(body, label).toMatch(/still emit[\s\S]{0,40}?section with all-false defaults/i);
    }
  });

  test("'absent ≡ all-false' is qualified as a READ-side fallback", () => {
    expect(docsMode).toMatch(/on \*\*read\*\*/i);
    expect(docsMode).toMatch(/READ only/);
    expect(docsMode).toContain("readDocsConfig");
    expect(docsMode).toContain("claudemd-docs-section-present");
  });

  test("the NFR-10 remedy literal is left byte-identical across both docs", () => {
    const literal =
      "Remedy: answer yes to either \"user-facing docs?\" or \"packages API refs?\", " +
      "or decline both to skip docs configuration entirely (the ## Docs section will " +
      "not be written and /docs will be a no-op).";
    expect(docsMode).toContain(literal);
    expect(reference).toContain(literal);
  });
});

// Regression guards for STE-70 — the `/docs` skill file.
//
// Covers AC-STE-70.1 (skill file exists at canonical path + frontmatter),
// AC-STE-70.2 (mutually-exclusive flag refusal shape), AC-STE-70.6
// (DocsConfig gate refusal shape), AC-STE-70.7 (NFR-1 line budget +
// docs-reference.md overflow pointer), AC-STE-70.8 (nav-contract gate
// reference), plus AC-STE-71.7 / AC-STE-72.3 verbatim-constraint wording.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "docs", "SKILL.md");
const referencePath = join(pluginRoot, "docs", "docs-reference.md");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");
const setupDocsModeRefPath = join(pluginRoot, "docs", "setup-docs-mode.md");

describe("STE-70 AC-STE-70.1 — /docs skill exists with canonical frontmatter", () => {
  test("skill file exists at plugins/dev-process-toolkit/skills/docs/SKILL.md", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body.length).toBeGreaterThan(0);
  });

  test("frontmatter name is 'docs' and description advertises the three flags", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toMatch(/^---\nname:\s*docs\n/);
    expect(body).toMatch(/description:[^\n]*--quick[\s\S]*--commit[\s\S]*--full/);
  });
});

describe("STE-70 AC-STE-70.2 — mutually-exclusive flag refusal", () => {
  test("skill body documents the three-flag contract and NFR-10 refusal wording", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("mutually exclusive");
    // NFR-10 remedy cites the three flag names and names the tracker-mode
    // + skill-name context fields.
    expect(body).toContain("--quick");
    expect(body).toContain("--commit");
    expect(body).toContain("--full");
    expect(body).toContain("Remedy: pick exactly one");
    expect(body).toContain("skill=docs");
  });
});

describe("STE-70 AC-STE-70.6 — DocsConfig gate refusal shape", () => {
  test("skill body documents the 'docs generation is not configured' NFR-10 message", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("docs generation is not configured for this project");
    expect(body).toContain("user_facing_mode");
    expect(body).toContain("packages_mode");
  });
});

describe("STE-70 AC-STE-70.7 — NFR-1 budget + reference overflow", () => {
  test("SKILL.md is ≤ 358 lines", () => {
    // NFR-1 is 358 — `specs/requirements.md` and the one
    // `const SKILL_LINE_CAP = 358;` in `tests/skill-nfr-1-length.test.ts`.
    // This pin previously carried a superseded value (351 -> 352 under
    // STE-373 -> 354 under STE-374 -> 358); a pin tighter than the contract
    // reds a change the NFR permits, and one looser is a hole. Repointed by
    // M_8f8e25/STE-558.
    const SKILL_LINE_CAP = 358;
    const body = readFileSync(skillPath, "utf-8");
    const lines = body.split("\n").length;
    expect(lines).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("SKILL.md links to docs-reference.md for the overflow content", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toMatch(/docs\/docs-reference\.md/);
  });

  test("docs-reference.md exists and hosts the LLM prompts + merge algorithm", () => {
    const body = readFileSync(referencePath, "utf-8");
    expect(body).toContain("Quick-fragment prompt");
    expect(body).toContain("Packages-mode prompt");
    expect(body).toContain("Merge algorithm");
  });
});

describe("STE-70 AC-STE-70.8 — nav-contract gate on --commit / --full", () => {
  test("skill references runNavContractProbe on --commit and explicitly bypasses on --full", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("runNavContractProbe");
    // --full path documented as the recovery path that bypasses the nav
    // contract probe.
    expect(body).toMatch(/Bypasses the nav-contract gate|bypass(es)? the nav-contract/i);
  });
});

describe("STE-71 AC-STE-71.7 + STE-72 AC-STE-72.3 — verbatim LLM constraints present", () => {
  test("docs-reference.md contains the ImpactSet verbatim constraint (AC-STE-71.7)", () => {
    const body = readFileSync(referencePath, "utf-8");
    // Key tokens from AC-STE-71.7's prescribed wording.
    expect(body).toContain("Write fragments ONLY for items in this set");
    expect(body).toContain("Reproduce symbol names verbatim");
  });

  test("docs-reference.md contains the SignatureGroundTruth verbatim constraint (AC-STE-72.3)", () => {
    const body = readFileSync(referencePath, "utf-8");
    // Whitespace-normalize so prompt line-wraps don't break substring matches.
    const normalized = body.replace(/\s+/g, " ");
    expect(normalized).toContain("reproduce each signature verbatim");
    expect(normalized).toContain("Do NOT alter signatures");
    expect(normalized).toContain("Do NOT add signatures not in this list");
  });
});

describe("STE-72 AC-STE-72.6 — /setup prompt 2 augmented with probe result", () => {
  test("setup SKILL.md includes the typedoc/ts-morph/stack probe parenthetical on prompt 2", () => {
    const body = readFileSync(setupSkillPath, "utf-8");
    expect(body).toContain("typedoc <detected|not found>");
    expect(body).toContain("ts-morph <bundled>");
    expect(body).toContain("stack: <ts|other>");
  });

  test("setup-docs-mode.md reference mirrors the augmented prompt wording", () => {
    const body = readFileSync(setupDocsModeRefPath, "utf-8");
    expect(body).toContain("typedoc <detected|not found>");
    expect(body).toContain("ts-morph <bundled>");
    // Toolkit-meta `AC-STE-<N>.<M>` literals are scrubbed from doc prose
    // (commit 2069ba4). Assert the conceptual content survives — the prose
    // must still describe the signature-extraction probe and stack hint.
    expect(body).toMatch(/signature-extraction|probe result/i);
    expect(body).toContain("stack: <ts|other>");
  });
});

// ---------------------------------------------------------------------------
// GB-20 — /docs --full must never regenerate from an empty corpus, and every
// /docs run must state which terminal outcome it reached.
//
// Reported upstream from the glacy projects (Jira GB-20 + a secret triage
// gist) and re-verified against this tree on 2026-09-08.
// ---------------------------------------------------------------------------

describe("GB-20 — /docs --full reads the archives and refuses an empty corpus", () => {
  const fullSection = () => {
    const body = readFileSync(skillPath, "utf-8");
    const start = body.indexOf("### 3. `/docs --full`");
    const end = body.indexOf("## Rules", start);
    expect(start, "the --full section vanished").toBeGreaterThan(-1);
    expect(end, "the Rules section vanished").toBeGreaterThan(start);
    return body.slice(start, end);
  };

  test("the gather step names BOTH archive trees, not just the active specs", () => {
    const section = fullSection();
    expect(section).toContain("specs/frs/archive/*.md");
    expect(section).toContain("specs/plan/archive/*.md");
  });

  // The defect in its original wording. A repo whose specs are all archived
  // (glacy-app-be: 0 active FRs, 25 archived, 19 archived plans) regenerated
  // its ENTIRE canonical docs/ tree from nothing — no error, just a plausible
  // 18-file diff behind an approval prompt nobody can eyeball.
  test("the instruction to skip archive/ when gathering --full inputs is GONE", () => {
    const section = fullSection();
    expect(
      section,
      "--full is skipping archive/ again — an all-archived repo regenerates from empty input",
    ).not.toMatch(/Every active spec under[^\n]*skip\s+`archive\/`/);
  });

  test("zero specs is an explicit NFR-10 refusal, not a silent regeneration", () => {
    const section = fullSection();
    expect(section).toContain("refusing to regenerate docs/ from an empty corpus");
    // NFR-10 canonical shape: verdict + Remedy + Context.
    expect(section).toMatch(/Remedy:[^\n]*specs\/frs\/archive\//);
    expect(section).toMatch(/Context:[^\n]*active=<n-active>[^\n]*archived=<n-archived>/);
    expect(section).toContain("Exit non-zero");
  });

  test("the empty-corpus guarantee is a standing rule, not only a step", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("`--full` never regenerates from an empty corpus.");
  });
});

describe("GB-20 — every /docs run states its outcome", () => {
  test("the shared preflight defines the four-outcome docs-run contract", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("docs-run: <outcome> (<flag>) — <detail>");
    for (const outcome of ["`written`", "`no-op`", "`declined`", "`refused`"]) {
      expect(body, `outcome ${outcome} is not defined`).toContain(outcome);
    }
  });

  test("the contract says callers read the line, never the exit code", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("Callers read this line, never the exit code.");
    // The reason the exit code cannot serve: four distinct outcomes share 0.
    expect(body).toMatch(/four outcomes behind one status/);
  });

  test("a run with no outcome line is a failed leg, never an assumed success", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toMatch(/no outcome line MUST be treated by its caller as `refused`/);
  });

  test("each terminal path emits its own outcome", () => {
    const body = readFileSync(skillPath, "utf-8");
    for (const emitted of [
      "docs-run: no-op (--quick)",
      "docs-run: written (--commit)",
      "docs-run: declined (--commit)",
      "docs-run: refused (--full) — empty spec corpus",
      "docs-run: written (--full)",
      "docs-run: declined (--full)",
    ]) {
      expect(body, `terminal path missing its outcome line: ${emitted}`).toContain(emitted);
    }
  });
});

// The producer half is worthless if no consumer reads it — the half-wire trap.
describe("GB-20 — the docs-run outcome reaches its consumers", () => {
  const shipMilestonePath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");
  const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");

  test("/ship-milestone step 5 routes on the outcome, not the exit code", () => {
    const body = readFileSync(shipMilestonePath, "utf-8");
    expect(body).toContain("Grade each leg by its `docs-run:` outcome line, not by its exit code.");
    expect(body).toContain("empty spec corpus");
    expect(body).toMatch(/no `docs-run:` line is treated as `refused`/);
  });

  test("/implement Phase 4b does not report a fragment the run never wrote", () => {
    const body = readFileSync(implementPath, "utf-8");
    expect(body).toContain("`docs-run: no-op` ⇒ append `| Doc fragment | none |");
    expect(body).toMatch(/never by its exit code/);
  });
});

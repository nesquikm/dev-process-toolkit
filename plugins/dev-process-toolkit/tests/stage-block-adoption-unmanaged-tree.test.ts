// PR #76 adversarial review, finding F12 — probe #82 `stage_block_adoption`
// hard-fails a consumer's UNRELATED project-local skills.
//
// RED-state until the managed-ness gate lands in:
//   plugins/dev-process-toolkit/adapters/_shared/src/stage_block_adoption.ts
//
// THE MEASUREMENT (2026-09-01, against v2.75.0 — reproduced by this file):
// `grep -c "toolkit_managed\|isToolkitManaged" stage_block_adoption.ts` = 0.
// `skillCandidates` joins `[".claude", "skills", <stage>, "SKILL.md"]` for
// ELEVEN generic names — setup, deps, implement, upgrade, brainstorm,
// gate-check, report-issue, spec-archive, spec-review, spec-write,
// best-practices. A project that never installed the toolkit but keeps its own
// `.claude/skills/setup/SKILL.md` ("set up the local dev environment") and
// `.claude/skills/deps/SKILL.md` ("update dependencies") collects two
// error-severity GATE FAILED rows ordering it to close `/setup` with a
// ```stage-status-block fence it has never heard of.
//
// THE REFUTER'S POINT, weighed: the shape is pre-existing on main —
// `closing_summary_capability_keys.ts` probes the same `.claude/skills/` root
// for three names. That is an argument the precedent is ALSO wrong, not that
// this is safe; and #82 widens it from three names to eleven and adds an
// ABSENT-FENCE HARD FAILURE where the precedent only checks MUST-emit
// directives. This suite fixes #82 and leaves the precedent to its own finding.
//
// THE SHARED PREDICATE EXISTS FOR EXACTLY THIS CLASS.
// `adapters/_shared/src/toolkit_managed.ts` (`isToolkitManaged`,
// `detectManagedSignals`, `SETUP_MARKER`) is the single implementation of
// "does the toolkit own this tree?", landed by STE-432 after four probes
// open-coded it and drifted apart. Probe #74 `claudemd_probe_managed_guard` is
// the fuse that forces its use — but it selects only modules that RESOLVE a
// CLAUDE.md path, and `stage_block_adoption.ts` resolves none, so the fuse
// structurally cannot catch this module. That is why the omission went
// unnoticed, and it is why this suite pins the routing directly.
//
// CONTRACT PINNED HERE:
//
//   * The `plugins/dev-process-toolkit/skills/<stage>/SKILL.md` candidate is
//     the TOOLKIT'S OWN AUTHORING TREE and is graded unconditionally. A tree
//     carrying it IS the toolkit; no CLAUDE.md is needed to prove it, and the
//     shipped fixtures in `tests/m137-ste-533-stage-block-adoption.test.ts`
//     depend on exactly that.
//   * The `.claude/skills/<stage>/SKILL.md` candidate is a CONSUMER PROJECT's
//     skills directory and is graded only when `isToolkitManaged(projectRoot)`
//     says the toolkit owns the tree.
//   * The decision routes through the SHARED predicate. A private re-derivation
//     is the drift STE-432 exists to prevent.
//   * The skip is REPORTED, never silent: `StageBlockAdoptionReport.skipped`
//     names every project-local surface that went ungraded, so an operator can
//     see the probe declining rather than guess.
//
//   export interface StageBlockAdoptionReport {
//     violations: StageBlockAdoptionViolationRow[];
//     vacuous: boolean;
//     skipped: string[];   // NEW — ungraded `.claude/skills/…` paths, sorted
//   }

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ADOPTING_STAGES,
  exemptSectionsFor,
  runStageBlockAdoptionProbe,
  scanStageBlockAdoption,
} from "../adapters/_shared/src/stage_block_adoption";
import { STAGE_BLOCK_FENCE_BANNER } from "../adapters/_shared/src/stage_status_block";
import {
  SETUP_MARKER,
  detectManagedSignals,
  isToolkitManaged,
} from "../adapters/_shared/src/toolkit_managed";
import { runClaudeMdProbeManagedGuardProbe } from "../adapters/_shared/src/claudemd_probe_managed_guard";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const ADOPTION_MODULE_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "stage_block_adoption.ts",
);

const read = (path: string): string => readFileSync(path, "utf-8");

interface TempRoot {
  root: string;
  cleanup: () => void;
}

function tempProject(files: Record<string, string>): TempRoot {
  const root = mkdtempSync(join(tmpdir(), "f12-unmanaged-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf-8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const consumerSkillRel = (stage: string): string =>
  `.claude/skills/${stage}/SKILL.md`;
const pluginSkillRel = (stage: string): string =>
  `plugins/dev-process-toolkit/skills/${stage}/SKILL.md`;

/**
 * A project-local skill that has NEVER heard of the toolkit: real prose, no
 * fence, no banner. Verbatim the two the review measured, generalised to all
 * eleven names so the fixture is a population rather than an anecdote.
 */
function projectLocalSkill(stage: string): string {
  return [
    "---",
    `name: ${stage}`,
    `description: The team's own ${stage} runbook. Nothing to do with any plugin.`,
    "---",
    "",
    `# ${stage}`,
    "",
    `Run the team's ${stage} steps. Ask an engineer if anything looks off.`,
    "",
  ].join("\n");
}

/** A SKILL.md that HAS adopted the block — the shape probe #82 accepts. */
function adoptedSkillBody(stage: string): string {
  const exempt = exemptSectionsFor(stage).map((e) => e.heading);
  return [
    `# /${stage}`,
    "",
    STAGE_BLOCK_FENCE_BANNER,
    `stage: ${stage}`,
    "```",
    "",
    ...exempt.flatMap((heading) => [heading, "", "- row", ""]),
  ].join("\n");
}

/** Every one of the eleven, project-local and unadopted. */
const elevenProjectLocal = (): Record<string, string> =>
  Object.fromEntries(
    ADOPTING_STAGES.map((s) => [consumerSkillRel(s), projectLocalSkill(s)]),
  );

/** A CLAUDE.md carrying one named managed signal — the shared vocabulary. */
function claudeMd(signal: "setup_marker" | "task_tracking_section" | "docs_section"): string {
  if (signal === "setup_marker") {
    return `${SETUP_MARKER}\n\n# A toolkit-managed project\n`;
  }
  if (signal === "task_tracking_section") {
    return "# A toolkit-managed project\n\n## Task Tracking\n\nmode: linear\n";
  }
  return "# A toolkit-managed project\n\n## Docs\n\nuser_facing_mode: false\n";
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE REPORTED CONSUMER TREE — zero violations
// ═══════════════════════════════════════════════════════════════════════════

describe("F12.1 — a consumer's `.claude/skills/` is NEVER graded", () => {
  // THE CONTRACT CHANGED IN M137 ROUND 4, and it is now definitional rather
  // than conditional. `docs/verification-skills.md` defines
  // `.claude/skills/<name>/SKILL.md` as the skill root of "the consuming
  // project (not in the toolkit)". That namespace is theirs, so this probe does
  // not look in it — managed tree or not.
  //
  // The earlier gate asked `isToolkitManaged` and graded the consumer root on
  // trees that had run `/setup`. It narrowed PR #76's F12 from "any project" to
  // "any project that installed us" and left the defect: a consumer who adopts
  // the toolkit AND owns a skill named `implement` — an ordinary English word,
  // like all eleven — still collected an error-severity row ordering them to
  // close `/implement` with a fence they have never heard of.

  test("THE REPORTED CASE: setup + deps project-local skills yield ZERO violations", async () => {
    const fx = tempProject(elevenProjectLocal());
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("THE CASE THE OLD GATE MISSED: a MANAGED consumer's own skill is still not graded", async () => {
    // This is the regression the round-4 review found, and the reason the gate
    // was replaced rather than tightened. Under the old contract this tree
    // produced eleven error rows; the tree is managed by every signal.
    const fx = tempProject({ ...elevenProjectLocal(), "CLAUDE.md": claudeMd("setup_marker") });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations, "their namespace, their skills").toEqual([]);
      expect(report.vacuous, "nothing of ours is in scope on a consumer tree").toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("all ELEVEN generic names stay silent, managed and unmanaged alike", async () => {
    for (const managed of [false, true]) {
      const files = managed
        ? { ...elevenProjectLocal(), "CLAUDE.md": claudeMd("setup_marker") }
        : elevenProjectLocal();
      const fx = tempProject(files);
      try {
        expect(
          (await runStageBlockAdoptionProbe(fx.root)).violations,
          `managed=${managed} must not change the answer`,
        ).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
  });

  test("a consumer tree is VACUOUS — there was nothing OF OURS in scope", async () => {
    const fx = tempProject(elevenProjectLocal());
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).vacuous).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("the report has NO skipped list — there is no decision to disclose", () => {
    // The old shape named every ungraded consumer surface, because declining to
    // grade a file we might have graded is a decision an operator should see.
    // We make no such decision now: the namespace is not ours, so those files
    // were never in scope to decline. The field and its reporting loop are gone
    // rather than left permanently empty — an always-[] list and a loop that
    // cannot execute are the dead machinery this milestone spent four rounds
    // removing.
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).not.toMatch(/skipped:\s*string\[\]/);
    expect(src).not.toMatch(/for \(const file of report\.skipped\)/);
  });
});

describe("F12.2 — the fixture really does contain would-be-failing skills", () => {
  test("THE DISCRIMINATOR: the same eleven files ARE graded under the plugin root", async () => {
    // Non-vacuity for the whole suite. If these bodies were compliant, every
    // leg above would pass by writing nothing worth catching. Placed under the
    // TOOLKIT'S OWN root, the identical bodies fail — so what parts them is the
    // ROOT, which is exactly the property under test.
    const pluginPlaced: Record<string, string> = {};
    for (const stage of ADOPTING_STAGES) pluginPlaced[pluginSkillRel(stage)] = projectLocalSkill(stage);
    const fx = tempProject(pluginPlaced);
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.vacuous, "the toolkit's own root IS in scope").toBe(false);
      expect(report.violations.length, "and these bodies are genuinely non-compliant")
        .toBe(ADOPTING_STAGES.length);
    } finally {
      fx.cleanup();
    }
  });

  test("EACH of the eleven is individually a would-have-failed surface", async () => {
    for (const stage of ADOPTING_STAGES) {
      const fx = tempProject({ [pluginSkillRel(stage)]: projectLocalSkill(stage) });
      try {
        expect(
          (await runStageBlockAdoptionProbe(fx.root)).violations.length,
          `${stage} must be a real failure when it is OURS`,
        ).toBe(1);
      } finally {
        fx.cleanup();
      }
    }
  });
});

describe("F12.3 — the toolkit's own root is graded, with no ownership question", () => {
  test("the PLUGIN authoring root is graded with NO CLAUDE.md at all", async () => {
    // A tree carrying `plugins/dev-process-toolkit/skills/` IS the toolkit and
    // needs no proof of ownership. This was true before and stays true: it is
    // the reason the probe still works on this repository, which deliberately
    // carries no managed marker of its own.
    const fx = tempProject({ [pluginSkillRel("implement")]: projectLocalSkill("implement") });
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("an ADOPTED plugin skill is clean — the grader is not simply always red", async () => {
    const fx = tempProject({ [pluginSkillRel("implement")]: adoptedSkillBody("implement") });
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a consumer skill beside a plugin skill changes NOTHING", async () => {
    // Both roots present. Only ours is graded, and the count is exactly the
    // plugin surfaces — so the consumer file cannot contribute a row.
    const fx = tempProject({
      [pluginSkillRel("implement")]: projectLocalSkill("implement"),
      [consumerSkillRel("implement")]: projectLocalSkill("implement"),
      "CLAUDE.md": claudeMd("setup_marker"),
    });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file, "the row names OUR file").toContain("plugins/dev-process-toolkit");
    } finally {
      fx.cleanup();
    }
  });

  test("DOGFOOD — probe #82 is still clean and non-vacuous over THIS repository", async () => {
    const report = await runStageBlockAdoptionProbe(REPO_ROOT);
    expect(report.vacuous, "it must still grade the eleven plugin surfaces here").toBe(false);
    expect(report.violations).toEqual([]);
  });
});

describe("F12.4 — the module asks no ownership question at all", () => {
  test("it no longer imports `isToolkitManaged` — the question is gone, not answered", () => {
    // The old suite asserted this module consults the SHARED managed-ness
    // predicate rather than a private copy. That was right while it asked the
    // question. It no longer asks: the consumer root is gone, so there is no
    // ownership decision left to make correctly or incorrectly.
    // Asserted on the IMPORT, not on the identifier appearing anywhere: the
    // module's comments still explain that the shared predicate exists and why
    // this probe no longer needs it, and a bare substring check would forbid
    // the explanation along with the dependency.
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).not.toMatch(/^import .*isToolkitManaged.*$/m);
    expect(src).not.toMatch(/isToolkitManaged\s*\(/);
  });

  test("it re-derives NOTHING: no private CLAUDE.md read, no restated marker", () => {
    // Unchanged in force. The failure this guards is a module answering
    // managed-ness by open-coding it, which is how four probes once drifted.
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).not.toContain("generated by /dev-process-toolkit:setup");
    expect(src).not.toContain('"CLAUDE.md"');
  });

  test("the deletion records WHY in definitional terms, not enumerative ones", () => {
    // "We checked and found none" is an enumeration and enumerations come back
    // short. "That namespace is theirs by documented contract" survives a fork.
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).toContain("not in the toolkit");
    expect(src).toMatch(/definitional/i);
  });
});

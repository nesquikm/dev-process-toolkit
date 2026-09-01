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

describe("F12.1 — a tree the toolkit does not own is never graded", () => {
  test("THE REPORTED CASE: setup + deps project-local skills yield ZERO violations", async () => {
    const fx = tempProject({
      "README.md": "# A project that never installed the toolkit\n",
      [consumerSkillRel("setup")]:
        "# setup\n\nSet up the local dev environment: run `make bootstrap`.\n",
      [consumerSkillRel("deps")]: "# deps\n\nUpdate dependencies: run `npm update`.\n",
    });
    try {
      expect(isToolkitManaged(fx.root)).toBe(false);
      expect(scanStageBlockAdoption(fx.root)).toEqual([]);
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("all ELEVEN generic names stay silent on an unmanaged tree", async () => {
    const fx = tempProject({
      "README.md": "# Not a toolkit project\n",
      ...elevenProjectLocal(),
    });
    try {
      expect(scanStageBlockAdoption(fx.root)).toEqual([]);
      expect((await runStageBlockAdoptionProbe(fx.root)).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an unmanaged tree is VACUOUS — there was nothing in scope to grade", async () => {
    const fx = tempProject({
      "README.md": "# Not a toolkit project\n",
      ...elevenProjectLocal(),
    });
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).vacuous).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("the skip is REPORTED, not silent — every ungraded surface is named", async () => {
    // A silently count-only skip is the M136 defect this repository has already
    // paid for once: a test silenced and a test un-silenced read identically.
    const fx = tempProject({
      "README.md": "# Not a toolkit project\n",
      ...elevenProjectLocal(),
    });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect([...report.skipped].sort()).toEqual(
        [...ADOPTING_STAGES].map(consumerSkillRel).sort(),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("an unmanaged tree with NO skills at all reports nothing skipped", async () => {
    const fx = tempProject({ "README.md": "# empty\n" });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.skipped).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. NON-VACUITY — the spared fixture is one the probe WOULD have failed
// ═══════════════════════════════════════════════════════════════════════════

describe("F12.2 — the unmanaged fixture really does contain failing skills", () => {
  test("THE DISCRIMINATOR: the same eleven files, parted only by CLAUDE.md", async () => {
    // Without this leg, "zero violations" is satisfied by a fixture the probe
    // never had anything to say about, and the gate would measure nothing.
    const files = { "README.md": "# project\n", ...elevenProjectLocal() };

    const unmanaged = tempProject(files);
    let unmanagedCount: number;
    try {
      unmanagedCount = (await runStageBlockAdoptionProbe(unmanaged.root)).violations
        .length;
    } finally {
      unmanaged.cleanup();
    }

    const managed = tempProject({
      ...files,
      "CLAUDE.md": claudeMd("setup_marker"),
    });
    try {
      const report = await runStageBlockAdoptionProbe(managed.root);
      // Every one of the eleven is a surface the probe WOULD have failed.
      expect(report.violations.length).toBe(ADOPTING_STAGES.length);
      expect(
        [...new Set(report.violations.map((v) => v.file))].sort(),
      ).toEqual([...ADOPTING_STAGES].map(consumerSkillRel).sort());
      expect(report.vacuous).toBe(false);
      expect(unmanagedCount).toBe(0);
    } finally {
      managed.cleanup();
    }
  });

  test("EACH of the eleven is individually a would-have-failed surface", async () => {
    // Enumerated, not sampled: a gate keyed on the aggregate could be satisfied
    // by one loud stage while ten others were quietly out of scope.
    let proven = 0;
    for (const stage of ADOPTING_STAGES) {
      const files = {
        "CLAUDE.md": claudeMd("setup_marker"),
        [consumerSkillRel(stage)]: projectLocalSkill(stage),
      };
      const managed = tempProject(files);
      try {
        const report = await runStageBlockAdoptionProbe(managed.root);
        expect({ stage, n: report.violations.length }).toEqual({ stage, n: 1 });
        expect(report.violations[0]!.file).toBe(consumerSkillRel(stage));
        expect(report.violations[0]!.severity).toBe("error");
      } finally {
        managed.cleanup();
      }

      const { "CLAUDE.md": _dropped, ...unmanagedFiles } = files;
      const unmanaged = tempProject({
        "README.md": "# project\n",
        ...unmanagedFiles,
      });
      try {
        const report = await runStageBlockAdoptionProbe(unmanaged.root);
        expect({ stage, n: report.violations.length }).toEqual({ stage, n: 0 });
        expect(report.skipped).toEqual([consumerSkillRel(stage)]);
      } finally {
        unmanaged.cleanup();
      }
      proven += 1;
    }
    expect(proven).toBe(ADOPTING_STAGES.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A MANAGED TREE IS GRADED EXACTLY AS BEFORE
// ═══════════════════════════════════════════════════════════════════════════

describe("F12.3 — a toolkit-managed tree still grades all eleven", () => {
  test("every managed SIGNAL in the shared vocabulary opens the gate", async () => {
    const signals = ["setup_marker", "task_tracking_section", "docs_section"] as const;
    for (const signal of signals) {
      const fx = tempProject({
        "CLAUDE.md": claudeMd(signal),
        ...elevenProjectLocal(),
      });
      try {
        // The fixture really does carry the signal it claims to.
        expect(detectManagedSignals(fx.root)).toContain(signal);
        const report = await runStageBlockAdoptionProbe(fx.root);
        expect({ signal, n: report.violations.length }).toEqual({
          signal,
          n: ADOPTING_STAGES.length,
        });
      } finally {
        fx.cleanup();
      }
    }
  });

  test("an ADOPTED project-local skill on a managed tree stays clean", async () => {
    const fx = tempProject({
      "CLAUDE.md": claudeMd("task_tracking_section"),
      ...Object.fromEntries(
        ADOPTING_STAGES.map((s) => [consumerSkillRel(s), adoptedSkillBody(s)]),
      ),
    });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
      expect(report.vacuous).toBe(false);
      // Graded, therefore not skipped — the two lists are disjoint answers to
      // the same question.
      expect(report.skipped).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the PLUGIN authoring root is graded with NO CLAUDE.md at all", async () => {
    // The toolkit's own source tree IS the toolkit; requiring it to prove
    // ownership of itself would silence the probe on the one tree it was
    // written for, and would redden every shipped fixture in
    // tests/m137-ste-533-stage-block-adoption.test.ts.
    const fx = tempProject({
      [pluginSkillRel("brainstorm")]: projectLocalSkill("brainstorm"),
    });
    try {
      expect(isToolkitManaged(fx.root)).toBe(false);
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toBe(pluginSkillRel("brainstorm"));
      expect(report.vacuous).toBe(false);
      expect(report.skipped).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("BOTH roots are graded together on a managed tree", async () => {
    const fx = tempProject({
      "CLAUDE.md": claudeMd("setup_marker"),
      [pluginSkillRel("setup")]: projectLocalSkill("setup"),
      [consumerSkillRel("setup")]: projectLocalSkill("setup"),
    });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect([...report.violations.map((v) => v.file)].sort()).toEqual(
        [consumerSkillRel("setup"), pluginSkillRel("setup")].sort(),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("DOGFOOD — probe #82 is still clean and non-vacuous over THIS repository", async () => {
    const report = await runStageBlockAdoptionProbe(REPO_ROOT);
    expect(report.violations.map((v) => v.note)).toEqual([]);
    expect(report.vacuous).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE DECISION ROUTES THROUGH THE SHARED PREDICATE
// ═══════════════════════════════════════════════════════════════════════════

describe("F12.4 — managed-ness comes from the shared predicate, not a private copy", () => {
  test("the module imports isToolkitManaged from ./toolkit_managed", () => {
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).toMatch(/from\s+["']\.\/toolkit_managed(?:\.[jt]s)?["']/);
    expect(src).toContain("isToolkitManaged");
  });

  test("it re-derives NOTHING: no private CLAUDE.md read, no restated marker", () => {
    const src = read(ADOPTION_MODULE_SRC);
    // The four drifted probes STE-432 consolidated each carried their own
    // marker literal and their own heading regexes. None of the three may
    // reappear here.
    expect(src).not.toContain(SETUP_MARKER);
    expect(src).not.toMatch(/["']CLAUDE\.md["']/);
    expect(src).not.toMatch(/\^##\\s\+Task Tracking/);
    expect(src).not.toMatch(/\^##\\s\+Docs/);
  });

  test("the shared predicate's OWN answer decides — measured, not just imported", async () => {
    // An import that is never consulted is the vacuous half of every
    // "routes through the shared module" claim. Assert the two agree on a
    // tree the predicate calls managed and on one it does not.
    for (const [managed, extra] of [
      [true, { "CLAUDE.md": claudeMd("docs_section") }],
      [false, { "README.md": "# nope\n" }],
    ] as const) {
      const fx = tempProject({ ...extra, ...elevenProjectLocal() });
      try {
        expect(isToolkitManaged(fx.root)).toBe(managed);
        const graded = (await runStageBlockAdoptionProbe(fx.root)).violations.length > 0;
        expect({ managed, graded }).toEqual({ managed, graded: managed });
      } finally {
        fx.cleanup();
      }
    }
  });

  test("probe #74's fuse stays green over this repository after the change", async () => {
    // The fuse cannot SELECT this module (it resolves no CLAUDE.md path), which
    // is why the omission survived review. Importing the predicate must not
    // break the fuse for the modules it does select.
    const report = await runClaudeMdProbeManagedGuardProbe(REPO_ROOT);
    expect(report.violations.map((v) => v.note)).toEqual([]);
  });

  test("the module records WHY the fuse could not catch it", () => {
    // A defect whose cause is a structural blind spot has to leave the blind
    // spot written down, or the next module in the same class repeats it.
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).toMatch(/claudemd_probe_managed_guard|probe #74/);
  });
});

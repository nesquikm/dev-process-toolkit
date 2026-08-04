// STE-417 AC-STE-417.3 — /gate-check probe #73 `plan_identity_mode_conditional`.
//
// The bimodal plan-frontmatter invariant, the plan-file twin of probe #13:
//   - mode: none      → a MINTED plan (`specs/plan/M_<tail>.md`) MUST carry
//                       `id: fr_<26-char ULID>` — the value `Provider.mintId()`
//                       returned, verbatim, `fr_` prefix included.
//   - mode: <tracker> → NO plan file may carry an `id:` line at all.
//
// Scope reconciliation between AC-STE-417.3 and AC-STE-417.5. AC.3 makes the
// key mandatory in `mode: none`; AC.5 promises existing `M<N>` plan files in a
// tracker-less project "keep resolving, archiving and shipping unchanged
// (coexistence, no migration)". A flat "every mode-none plan needs `id:`" rule
// would hard-fail every pre-existing sequential plan in every tracker-less
// consumer project on upgrade — precisely the migration AC.5 rules out. The
// invariant is therefore scoped to minted (`M_<key>`) plans, exactly as probe
// #68 grandfathers pre-epoch archived plans. The tracker-mode direction stays
// unconditional — no plan of any shape may carry `id:`.
//
// STE-441 RE-KEYED THE SEQUENTIAL CARVE-OUT. It used to be keyed on filename
// SHAPE alone, which could not tell a genuinely legacy `M<N>` plan from one
// mis-named moments ago, so both passed forever. It is now keyed on GIT
// INTRODUCTION PROVENANCE: a sequential plan whose introducing commit predates
// `MINT_EPOCH` is `legacy` and silent, one introduced at or after it (or never
// committed at all) is `fresh` and fails, an unreachable introducing commit is
// an `undecidable` advisory, and `kind: scaffolding` / `kind: legacy` is
// `exempt`. When the project is not a git repository the probe is vacuous for
// that plan — which is the leg the mode-none sequential fixtures BELOW ride,
// since they are bare `mkdtemp` trees with no `.git`. Each of them asserts that
// precondition explicitly, so a passing test can never be read as evidence that
// filename shape still grandfathers anything. The provenance legs themselves
// live in `tests/m119-ste-441-plan-provenance.test.ts`.
//
// SIBLING MODULE, NOT AN EXTENSION. `adapters/_shared/src/identity_mode_conditional.ts`
// documents a deliberate scope-isolation boundary (FR-only walk, zero runtime
// dep on `ulid.ts`); widening it to plan files would violate that boundary, so
// the plan invariant ships as its own module. The boundary is asserted below,
// not merely asserted in prose.
//
// Test-file naming follows the § Probe authoring contract convention:
// `tests/gate-check-<slug>.test.ts`, with both a passing fixture and a firing
// fixture per direction.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import {
  PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY,
  runPlanIdentityModeConditionalProbe,
} from "../adapters/_shared/src/plan_identity_mode_conditional";

const pluginRoot = join(import.meta.dir, "..");
const sharedSrc = join(pluginRoot, "adapters", "_shared", "src");

const VALID_ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const MINTED_PLAN = "M_F4VDTA"; // = milestoneIdFromUlid(VALID_ULID)

interface PlanFixture {
  path: string;
  frontmatter: string[];
  archived?: boolean;
}

interface Project {
  root: string;
  cleanup: () => void;
}

function makeProject(opts: { mode: "none" | "linear" | "jira"; plans: PlanFixture[] }): Project {
  const root = mkdtempSync(join(tmpdir(), "ste417-plan-probe-"));
  const planDir = join(root, "specs", "plan");
  mkdirSync(join(planDir, "archive"), { recursive: true });

  writeFileSync(
    join(root, "CLAUDE.md"),
    opts.mode === "none"
      ? "# Mode-none fixture\n\nNo `## Task Tracking` section → mode: none per Schema L canonical form.\n"
      : `# Tracker-mode fixture\n\n## Task Tracking\n\nmode: ${opts.mode}\nmcp_server: ${opts.mode}\n`,
  );

  for (const plan of opts.plans) {
    const dir = plan.archived === true ? join(planDir, "archive") : planDir;
    writeFileSync(
      join(dir, plan.path),
      ["---", ...plan.frontmatter, "---", "", `# ${plan.path.replace(/\.md$/, "")} — Fixture`, ""].join(
        "\n",
      ),
    );
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const BASE_FM = ["milestone: PLACEHOLDER", "status: active", "archived_at: null"];

function fm(extra: string[] = []): string[] {
  return [...extra, ...BASE_FM];
}

// ---------------------------------------------------------------------------
// mode: none — the minted plan carries the key
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — mode: none, minted plan carries id:", () => {
  test("valid `id: fr_<26-char ULID>` on a minted plan passes clean", async () => {
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm([`id: ${VALID_ULID}`]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a minted plan MISSING id: fires — expected present, actual missing", async () => {
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm() }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain(`${MINTED_PLAN}.md`);
      expect(v.expected).toBe("present");
      expect(v.actual).toBe("missing");
      expect(v.note).toMatch(/specs\/plan\/.*\.md:\d+ — /);
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      p.cleanup();
    }
  });

  test("a minted plan with a MALFORMED id: fires — expected fr_<26-char ULID>", async () => {
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm(["id: fr_BADFORMAT"]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.expected).toMatch(/fr_<26-char ULID>/);
      expect(v.actual).toBe("fr_BADFORMAT");
    } finally {
      p.cleanup();
    }
  });

  test("an ARCHIVED minted plan is walked too — `specs/plan/**`, not just the active dir", async () => {
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm(), archived: true }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain(join("plan", "archive"));
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// tracker mode — the key must be absent, unconditionally
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — tracker mode, no plan may carry id:", () => {
  test("a tracker-mode plan with no id: passes clean", async () => {
    const p = makeProject({
      mode: "linear",
      plans: [{ path: "M101.md", frontmatter: fm() }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("linear");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a tracker-mode plan CARRYING id: fires — expected absent, actual <value>", async () => {
    const p = makeProject({
      mode: "linear",
      plans: [{ path: "M101.md", frontmatter: fm([`id: ${VALID_ULID}`]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("linear");
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M101.md");
      expect(v.expected).toBe("absent");
      expect(v.actual).toBe(VALID_ULID);
      expect(v.note).toMatch(/specs\/plan\/.*\.md:\d+ — /);
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/Remedy:/);
    } finally {
      p.cleanup();
    }
  });

  test("tracker mode rejects id: on an EPIC-keyed plan too — shape-independent", async () => {
    const p = makeProject({
      mode: "jira",
      plans: [{ path: "M_PROJ_500.md", frontmatter: fm([`id: ${VALID_ULID}`]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("jira");
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-417.5 — coexistence, as re-keyed by STE-441: a sequential plan is
// silent because the project has NO GIT PROVENANCE to read, not because of the
// shape of its filename. Both fixtures below assert the `.git`-absent
// precondition, because that — and only that — is why they pass now.
// ---------------------------------------------------------------------------

describe("AC-STE-417.5 — sequential `M<N>` plans in a NON-GIT tracker-less project never fire", () => {
  test("a mode-none sequential plan with no id: passes — the probe is vacuous without git", async () => {
    const p = makeProject({
      mode: "none",
      plans: [
        { path: "M1.md", frontmatter: fm() },
        { path: "M20.md", frontmatter: fm(), archived: true },
      ],
    });
    try {
      // The load-bearing precondition. In a git repository these same two
      // untracked plans classify `fresh` and BOTH fail — see
      // `tests/m119-ste-441-plan-provenance.test.ts`.
      expect(existsSync(join(p.root, ".git"))).toBe(false);
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a mixed NON-GIT tree fires only on the minted plan, never on the sequential one", async () => {
    const p = makeProject({
      mode: "none",
      plans: [
        { path: "M101.md", frontmatter: fm() },
        { path: `${MINTED_PLAN}.md`, frontmatter: fm() },
      ],
    });
    try {
      // The minted leg needs no provenance — it fails on its missing `id:`
      // alone. The sequential leg is silent only because there is no `.git`.
      expect(existsSync(join(p.root, ".git"))).toBe(false);
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain(`${MINTED_PLAN}.md`);
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Probe hygiene: severity, vacuity, and the scope-isolation boundary
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — probe hygiene", () => {
  test("severity is error — a regression hard-fails, it does not slip through as NOTES", async () => {
    expect(PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY).toBe("error");
    const p = makeProject({ mode: "none", plans: [] });
    try {
      expect((await runPlanIdentityModeConditionalProbe(p.root)).severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("vacuous-pass when specs/plan/ is absent (consumer project without plans)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste417-noplan-probe-"));
    try {
      writeFileSync(join(root, "CLAUDE.md"), "# No specs tree\n");
      const report = await runPlanIdentityModeConditionalProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("non-plan files under specs/plan/ are ignored (PLAN_FILENAME_RE gates the walk)", async () => {
    const p = makeProject({ mode: "none", plans: [] });
    try {
      writeFileSync(join(p.root, "specs", "plan", "README.md"), "# not a plan\n");
      writeFileSync(join(p.root, "specs", "plan", "notes.txt"), "id: fr_whatever\n");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("CRLF frontmatter is scanned, not silently skipped (false-negative guard)", async () => {
    // A `---\r\n` opener used to fail the frontmatter `startsWith` check, so
    // the whole file scanned as "no frontmatter" and a tracker-mode plan
    // carrying a forbidden `id:` PASSED an error-severity probe.
    const p = makeProject({ mode: "linear", plans: [] });
    try {
      writeFileSync(
        join(p.root, "specs", "plan", `${MINTED_PLAN}.md`),
        `---\r\nmilestone: ${MINTED_PLAN}\r\nid: ${VALID_ULID}\r\nstatus: active\r\n---\r\n\r\n# ${MINTED_PLAN} — Fixture\r\n`,
      );
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
      // Line numbers survive normalization: `---` / `milestone:` / `id:` → 3.
      expect(report.violations[0]!.line).toBe(3);
    } finally {
      p.cleanup();
    }
  });

  test("a CRLF mode-none minted plan MISSING id: still fires", async () => {
    const p = makeProject({ mode: "none", plans: [] });
    try {
      writeFileSync(
        join(p.root, "specs", "plan", `${MINTED_PLAN}.md`),
        `---\r\nmilestone: ${MINTED_PLAN}\r\nstatus: active\r\n---\r\n\r\n# ${MINTED_PLAN} — Fixture\r\n`,
      );
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("present");
    } finally {
      p.cleanup();
    }
  });

  test("bare-\\r (old-Mac) frontmatter is scanned — the CR fold is not CRLF-only", async () => {
    const p = makeProject({ mode: "linear", plans: [] });
    try {
      writeFileSync(
        join(p.root, "specs", "plan", `${MINTED_PLAN}.md`),
        `---\rmilestone: ${MINTED_PLAN}\rid: ${VALID_ULID}\rstatus: active\r---\r`,
      );
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
    } finally {
      p.cleanup();
    }
  });

  test("a UTF-8 BOM does not turn a well-formed minted plan into a false GATE FAILED", async () => {
    // The nastier direction: an unhandled prefix makes the file read as "no
    // frontmatter", so a plan that DOES carry a correct id: gets reported
    // missing. A false positive on an error-severity probe blocks a clean tree.
    const p = makeProject({ mode: "none", plans: [] });
    try {
      writeFileSync(
        join(p.root, "specs", "plan", `${MINTED_PLAN}.md`),
        `﻿---\nmilestone: ${MINTED_PLAN}\nid: ${VALID_ULID}\nstatus: active\n---\n`,
      );
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("duplicate id: keys are refused as ambiguous, not silently first-wins", async () => {
    // `parseFrontmatter` is last-wins; this scan is first-wins. Rather than
    // let the two disagree about a plan's identity, refuse to adjudicate.
    const p = makeProject({
      mode: "none",
      plans: [
        {
          path: `${MINTED_PLAN}.md`,
          frontmatter: [`id: fr_BADFORMAT`, `id: ${VALID_ULID}`, ...BASE_FM],
        },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.expected).toBe("exactly one id: line");
      expect(v.actual).toContain("2 id: lines");
      expect(v.message).toContain("collapse");
    } finally {
      p.cleanup();
    }
  });

  test("the missing-id remedy offers the never-minted escape route", async () => {
    // A hand-authored or ported plan that merely LOOKS minted (`M_A1B2C3`)
    // has no ULID to recover, so "add the minted id" alone is unsatisfiable.
    const p = makeProject({ mode: "none", plans: [{ path: "M_A1B2C3.md", frontmatter: fm() }] });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toContain("If this plan was never minted");
      expect(report.violations[0]!.message).toContain("rename it off the minted");
    } finally {
      p.cleanup();
    }
  });

  test("the probe is a sibling module, not an extension of identity_mode_conditional", () => {
    const planSrc = readFileSync(join(sharedSrc, "plan_identity_mode_conditional.ts"), "utf-8");
    const frSrc = readFileSync(join(sharedSrc, "identity_mode_conditional.ts"), "utf-8");
    // The plan probe owns the plan walk...
    expect(planSrc).toMatch(/"plan"/);
    // ...and probe #13 keeps its FR-only scope + its zero-runtime-dep boundary.
    expect(frSrc).not.toMatch(/"plan"/);
    expect(frSrc).not.toMatch(/from "\.\/ulid"/);
    expect(frSrc).toContain("Zero runtime dep on ulid.ts");
  });

  test("the plan probe rides the shared union matcher, not a private M-regex copy", () => {
    const planSrc = readFileSync(join(sharedSrc, "plan_identity_mode_conditional.ts"), "utf-8");
    expect(planSrc).toContain("milestone_token");
  });
});

// ---------------------------------------------------------------------------
// Phase-3 hardening — gaps the end-of-FR spec audit surfaced
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — the id: must derive its own filename (load-bearing, not decorative)", () => {
  // A well-formed but UNRELATED ULID used to pass clean, leaving the plan's
  // real minted identity unreconstructable. Plan-side twin of the FR-side
  // `id: ≡ filename stem` invariant.
  const OTHER_ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAFZZZZZ"; // 26-char body, derives M_FZZZZZ ≠ M_F4VDTA

  test("a minted plan whose id: derives a DIFFERENT filename fires", async () => {
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm([`id: ${OTHER_ULID}`]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.expected).toBe("an id: the filename derives from");
      // The remedy names BOTH escape routes and the derived filename.
      expect(v.message).toContain("or rename the plan to");
      expect(v.message).toContain(milestoneIdFromUlid(OTHER_ULID));
    } finally {
      p.cleanup();
    }
  });

  test("the matching id: still passes — the check is derivation, not mere presence", async () => {
    expect(milestoneIdFromUlid(VALID_ULID)).toBe(MINTED_PLAN);
    const p = makeProject({
      mode: "none",
      plans: [{ path: `${MINTED_PLAN}.md`, frontmatter: fm([`id: ${VALID_ULID}`]) }],
    });
    try {
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-417.5 — Epic-keyed plans carried over by a jira → none switch are grandfathered", () => {
  // The narrowing that makes this pass: the mode-none requirement is scoped to
  // `milestoneIdFromUlid`'s output range, so ids the minter provably could not
  // have produced are never policed. Without it, a mode transition hard-fails
  // every carried-over plan with a remedy telling the operator to invent a
  // ULID that never existed.
  test("`M_PROJ_500` with no id: passes in mode: none (no ULID ever existed)", async () => {
    const p = makeProject({
      mode: "none",
      plans: [
        { path: "M_PROJ_500.md", frontmatter: fm() },
        { path: "M_DST_49.md", frontmatter: fm(), archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("the narrowing does NOT weaken the minted case in the same tree", async () => {
    const p = makeProject({
      mode: "none",
      plans: [
        { path: "M_PROJ_500.md", frontmatter: fm() },
        { path: `${MINTED_PLAN}.md`, frontmatter: fm() },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain(`${MINTED_PLAN}.md`);
    } finally {
      p.cleanup();
    }
  });

  test("tracker mode stays unconditional — an Epic-keyed plan may still not carry id:", async () => {
    const p = makeProject({
      mode: "jira",
      plans: [{ path: "M_PROJ_500.md", frontmatter: fm([`id: ${VALID_ULID}`]) }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Dogfood: this repo (mode: linear) self-passes
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — the toolkit repo itself is clean under probe #73", () => {
  test("no plan file in this repo carries an id: line", async () => {
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runPlanIdentityModeConditionalProbe(repoRoot);
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  });
});

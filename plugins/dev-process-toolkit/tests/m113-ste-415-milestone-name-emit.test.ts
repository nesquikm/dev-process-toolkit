// M113 / STE-415 — /spec-write emits em-dash canonical milestone names.
//
// The plan-heading parser (`parsePlanHeading`, adapters/_shared/src/plan_heading.ts)
// has normalized both `## M<N>: <title>` and `# M<N> — <title>` to the canonical
// em-dash form since STE-335 (M87). The EMIT side never followed: /spec-write's
// exemplar and `templates/spec-templates/plan.md.template` still scaffold the
// colon separator, and the § 0b milestone-attachment prose only says "the
// canonical milestone name (anchor stripped)". An LLM-emulated consumer reads the
// colon heading by eye and creates the tracker milestone as `M2: Greeting core`,
// while gate-check probe #26 (tracker_project_milestone_attached) byte-compares
// against `parsePlanHeading`'s em-dash output — one character apart, probe #26
// red on an otherwise-clean chain (2026-07-23 conformance run, Linear leg 71/72).
//
// AC-STE-415.1 — § 0b milestone attachment states the created name MUST be the
//   em-dash canonical form, names the colon form as forbidden, and cross-refs
//   `parsePlanHeading` / `adapters/_shared/src/plan_heading.ts` as the SoT.
// AC-STE-415.2 — the SKILL "Stable anchor IDs" exemplar and the plan template
//   emit `## M<N> — <Title> {#M<N>}`; no colon emit site survives; the anchor
//   is retained. (Probe #32's widened `MILESTONE_HEADING_RE` + the plan-template
//   scaffold-count assertion are pinned in
//   tests/gate-check-plan-file-single-milestone.test.ts and
//   tests/plan-template-shape.test.ts respectively.)
// AC-STE-415.3 — the create-side derivation (`planFileHeadingToMilestoneName`)
//   and probe #26's expected name are the SAME shared normalizer's output for a
//   colon-form plan file: both byte-equal `M2 — Greeting core`. Pinning test —
//   the real code path already routes through `parsePlanHeading`, so this is
//   GREEN before implementation by design; it exists so a future "just format
//   the heading here" shortcut on either side cannot reintroduce the drift.
// AC-STE-415.4 — regression guard: the parser stays tolerant of the colon form
//   (emit-side-only change). GREEN before implementation by design.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planFileHeadingToMilestoneName } from "../adapters/_shared/src/attach_project_milestone";
import { parsePlanHeading } from "../adapters/_shared/src/plan_heading";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const planTemplatePath = join(pluginRoot, "templates", "spec-templates", "plan.md.template");
const planHeadingSrcPath = join(pluginRoot, "adapters", "_shared", "src", "plan_heading.ts");
const attachSrcPath = join(pluginRoot, "adapters", "_shared", "src", "attach_project_milestone.ts");
const probe26SrcPath = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "tracker_project_milestone_attached.ts",
);

const EM_DASH = "—";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const skill = read(specWriteSkillPath);
const planTemplate = read(planTemplatePath);

/** Blank-line-delimited paragraph containing `marker` ("" when absent). */
function paragraphContaining(body: string, marker: string): string {
  return body.split(/\n\n+/).find((p) => p.includes(marker)) ?? "";
}

// § 0b step 4 milestone-attachment prose — the LLM-facing create/attach contract.
const milestoneAttachPara = paragraphContaining(skill, "**Milestone attachment (");
// § Stable anchor IDs — the `## M{N}` heading exemplar /spec-write copies.
const anchorIdsPara = paragraphContaining(skill, "**Stable anchor IDs:**");

// A colon emit site: an `## M<N>:` / `## M{N}:` heading exemplar. Matches the
// placeholder forms both surfaces use, NOT the § 0b prose that merely NAMES the
// forbidden `M<N>: <Title>` shape (no `##` heading prefix there).
const COLON_EMIT_RE = /##\s+M[<{]N[>}]\s*:/;

// The two name literals AC-STE-415.1's contract turns on.
const EM_DASH_NAME_RE = new RegExp("`M<N> " + EM_DASH + " <[Tt]itle>`");
const COLON_NAME_RE = /`M<N>: <[Tt]itle>`/;

/** Text within `radius` chars of the first `re` match ("" when absent). */
function windowAround(body: string, re: RegExp, radius = 160): string {
  const m = re.exec(body);
  if (!m) return "";
  return body.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius);
}

// The modality word must govern the literal it applies to. Bare `/MUST/` and
// `/never|forbidden|MUST NOT/` over the whole paragraph are satisfied by
// PRE-EXISTING text elsewhere in § 0b ("the Step 7 closing summary MUST emit",
// "never a plain informational line") and so survive deletion of the em-dash
// clause entirely — see the negative control below.

/** The em-dash name literal is governed by a MUST, in em-dash terms. */
function statesEmDashMust(para: string): boolean {
  const w = windowAround(para, EM_DASH_NAME_RE);
  return w !== "" && /MUST(?!\s+NOT)/.test(w) && /em[- ]dash/i.test(w);
}

/** The colon name literal is governed by a prohibition. */
function statesColonForbidden(para: string): boolean {
  const w = windowAround(para, COLON_NAME_RE);
  return w !== "" && /never|forbidden|MUST NOT/i.test(w);
}

// Negative control: § 0b as it stood BEFORE STE-415 (`git show
// origin/main:…/skills/spec-write/SKILL.md`), condensed to the two decoy
// modality phrases. It carries "MUST emit" and "never a plain informational
// line" but no milestone-name separator clause — the tightened predicates must
// reject it, the loose ones did not.
const PRE_STE_415_PARAGRAPH =
  "**Milestone attachment (any adapter with `project_milestone: true`).** After " +
  "`Provider.sync(spec)` returns, call `planFileHeadingToMilestoneName(...)` to derive the " +
  "canonical milestone name (anchor stripped). Then call `attachProjectMilestone(provider, " +
  "project, canonicalName, ticketId)` to bind the ticket. A **permanent** failure surfaces as " +
  "`MilestoneAttachmentError` (NFR-10 canonical shape) and the Step 7 closing summary MUST " +
  "emit `milestone_attach_failed` as a **loud** warning-severity capability row (never a plain " +
  "informational line) — the FR file is not rolled back. Vacuous on `mode: none`.";

// ---------------------------------------------------------------------------
// AC-STE-415.1 — § 0b milestone attachment: em-dash MUST + colon forbidden +
// parsePlanHeading cross-reference
// ---------------------------------------------------------------------------

describe("AC-STE-415.1 — /spec-write § 0b milestone-attachment name contract", () => {
  test("the milestone-attachment paragraph exists (slice sanity)", () => {
    expect(milestoneAttachPara.length).toBeGreaterThan(0);
    expect(milestoneAttachPara).toContain("attachProjectMilestone(");
  });

  test("states the created milestone name MUST be the em-dash canonical form `M<N> — <Title>`", () => {
    expect(milestoneAttachPara).toMatch(EM_DASH_NAME_RE);
    // The MUST must govern THIS literal, not some other sentence in § 0b.
    expect(statesEmDashMust(milestoneAttachPara)).toBe(true);
  });

  test("names the colon form `M<N>: <Title>` as forbidden at milestone-create time", () => {
    expect(milestoneAttachPara).toMatch(COLON_NAME_RE);
    expect(statesColonForbidden(milestoneAttachPara)).toBe(true);
  });

  test("the pre-STE-415 paragraph fails both predicates (negative control)", () => {
    // The decoy modality words the loose assertions matched are present …
    expect(PRE_STE_415_PARAGRAPH).toMatch(/MUST/);
    expect(PRE_STE_415_PARAGRAPH).toMatch(/never|forbidden|MUST NOT/i);
    // … yet the tightened predicates reject it, so deleting the em-dash /
    // colon-forbidden clause from § 0b turns the two tests above RED.
    expect(statesEmDashMust(PRE_STE_415_PARAGRAPH)).toBe(false);
    expect(statesColonForbidden(PRE_STE_415_PARAGRAPH)).toBe(false);
  });

  test("cross-references parsePlanHeading / adapters/_shared/src/plan_heading.ts as the single source of truth", () => {
    expect(milestoneAttachPara).toContain("parsePlanHeading");
    expect(milestoneAttachPara).toContain("adapters/_shared/src/plan_heading.ts");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-415.2 — em-dash emit sites (SKILL exemplar + plan template)
// ---------------------------------------------------------------------------

describe("AC-STE-415.2 — /spec-write emits `## M<N> — <Title> {#M<N>}`", () => {
  test("the SKILL 'Stable anchor IDs' exemplar carries no `## M{N}:` colon emit site", () => {
    expect(anchorIdsPara.length).toBeGreaterThan(0);
    expect(anchorIdsPara).not.toMatch(COLON_EMIT_RE);
  });

  test("the SKILL exemplar emits the em-dash separator and retains the `{#M{N}}` anchor", () => {
    expect(anchorIdsPara).toMatch(new RegExp("##\\s+M\\{N\\}\\s+" + EM_DASH));
    expect(anchorIdsPara).toContain("{#M{N}}");
  });

  test("the plan template carries no `## M<N>:` colon milestone heading", () => {
    expect(planTemplate).not.toMatch(/^##\s+M<N>\s*:/m);
    expect(planTemplate).not.toMatch(COLON_EMIT_RE);
  });

  test("the plan template scaffolds exactly one `## M<N> — … {#M<N>}` em-dash heading", () => {
    const headings = planTemplate.match(new RegExp("^##\\s+M<N>\\s+" + EM_DASH + "\\s+.*$", "gm")) ?? [];
    expect(headings.length).toBe(1);
    expect(headings[0]!).toContain("{#M<N>}");
  });

  test("the emitted template heading round-trips through parsePlanHeading to the canonical name", () => {
    // Substitute the `<N>` placeholder the way /setup + /spec-write do, then
    // parse: the emitted form must yield the canonical em-dash name verbatim.
    const substituted = planTemplate.replace(/M<N>/g, "M2");
    const canonical = parsePlanHeading(substituted);
    expect(canonical).not.toBeNull();
    expect(canonical!.startsWith(`M2 ${EM_DASH} `)).toBe(true);
    expect(canonical!).not.toContain("{#");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-415.3 — create-side name and probe-#26 expected name are one normalizer
// ---------------------------------------------------------------------------

interface Probe26Fixture {
  root: string;
  planPath: string;
  cleanup: () => void;
}

/** Project fixture: tracker mode + one active FR bound to a colon-form M2 plan. */
function makeProbe26Fixture(planHeading: string): Probe26Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste-415-milestone-name-"));
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    "# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n",
  );
  writeFileSync(
    join(root, "specs", "frs", "STE-1.md"),
    "---\ntitle: t\nmilestone: M2\nstatus: active\narchived_at: null\ntracker:\n  linear: STE-1\ncreated_at: 2026-07-24T00:00:00Z\n---\n\nbody\n",
  );
  const planPath = join(root, "specs", "plan", "M2.md");
  writeFileSync(
    planPath,
    `---\nmilestone: M2\nstatus: active\n---\n\n# Plan\n\n${planHeading}\n\n**Goal:** greet\n`,
  );
  return { root, planPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The canonical name probe #26 expects, recovered from its mismatch reason. */
async function probe26ExpectedName(root: string): Promise<string> {
  const report = await runTrackerProjectMilestoneAttachedProbe(root, {
    getIssue: async () => ({ projectMilestone: { name: "SENTINEL-NOT-THE-CANONICAL-NAME" } }),
  });
  expect(report.violations.length).toBe(1);
  const match = /local: "([^"]+)"/.exec(report.violations[0]!.reason);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("AC-STE-415.3 — colon-form plan heading → one canonical em-dash name", () => {
  test("planFileHeadingToMilestoneName('## M2: Greeting core {#M2}') byte-equals `M2 — Greeting core`", () => {
    const fx = makeProbe26Fixture("## M2: Greeting core {#M2}");
    try {
      const name = planFileHeadingToMilestoneName(fx.planPath);
      expect(name).toBe(`M2 ${EM_DASH} Greeting core`);
      // Byte-level: the separator is U+2014, never `:`.
      expect(name.charCodeAt(3)).toBe(0x2014);
      expect(name).not.toContain(":");
      expect(name).not.toContain("{#");
    } finally {
      fx.cleanup();
    }
  });

  test("the create-side name byte-equals the name probe #26 expects for the same plan file", async () => {
    const fx = makeProbe26Fixture("## M2: Greeting core {#M2}");
    try {
      const createSide = planFileHeadingToMilestoneName(fx.planPath);
      const probeSide = await probe26ExpectedName(fx.root);
      expect(probeSide).toBe(createSide);
      expect(probeSide).toBe(`M2 ${EM_DASH} Greeting core`);
    } finally {
      fx.cleanup();
    }
  });

  test("probe #26 accepts a milestone created with the create-side name (colon-form plan file)", async () => {
    const fx = makeProbe26Fixture("## M2: Greeting core {#M2}");
    try {
      const createSide = planFileHeadingToMilestoneName(fx.planPath);
      const report = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: async () => ({ projectMilestone: { name: createSide } }),
      });
      expect(report.violations).toEqual([]);
      expect(report.advisories).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("probe #26 REJECTS the colon-form name an eyeballed heading would create", async () => {
    const fx = makeProbe26Fixture("## M2: Greeting core {#M2}");
    try {
      const report = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: async () => ({ projectMilestone: { name: "M2: Greeting core" } }),
      });
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).toContain("M2: Greeting core");
      expect(report.violations[0]!.reason).toContain(`M2 ${EM_DASH} Greeting core`);
    } finally {
      fx.cleanup();
    }
  });

  test("an em-dash plan file (the new emit form) derives the identical canonical name", async () => {
    const fx = makeProbe26Fixture(`## M2 ${EM_DASH} Greeting core {#M2}`);
    try {
      const createSide = planFileHeadingToMilestoneName(fx.planPath);
      expect(createSide).toBe(`M2 ${EM_DASH} Greeting core`);
      expect(await probe26ExpectedName(fx.root)).toBe(createSide);
    } finally {
      fx.cleanup();
    }
  });

  test("both sides derive the name through the ONE shared normalizer (no second formatter)", () => {
    const attachSrc = read(attachSrcPath);
    const probeSrc = read(probe26SrcPath);
    const importRe = /import\s*\{[^}]*\bparsePlanHeading\b[^}]*\}\s*from\s*"\.\/plan_heading"/;
    expect(attachSrc).toMatch(importRe);
    expect(probeSrc).toMatch(importRe);
    // Neither side may hand-assemble the canonical name from a separator literal.
    expect(attachSrc).not.toMatch(/\$\{token\}\s*:\s*\$\{title\}/);
    expect(probeSrc).not.toMatch(/\$\{token\}\s*:\s*\$\{title\}/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-415.4 — parser stays colon-tolerant (emit-side-only change).
// Regression guard for an existing invariant — GREEN before implementation.
// ---------------------------------------------------------------------------

describe("AC-STE-415.4 — parsePlanHeading remains tolerant of the colon form", () => {
  const CANONICAL = `M31 ${EM_DASH} Tracker Workflow Hardening`;

  test("STE-335 matrix: {#,##} × {—,:} × {anchor} all canonicalize to em-dash", () => {
    const cases = [
      `# M31 ${EM_DASH} Tracker Workflow Hardening`,
      `# M31 ${EM_DASH} Tracker Workflow Hardening {#M31}`,
      "# M31: Tracker Workflow Hardening",
      "# M31: Tracker Workflow Hardening {#M31}",
      `## M31 ${EM_DASH} Tracker Workflow Hardening`,
      `## M31 ${EM_DASH} Tracker Workflow Hardening {#M31}`,
      "## M31: Tracker Workflow Hardening",
      "## M31: Tracker Workflow Hardening {#M31}",
    ];
    for (const heading of cases) {
      expect(parsePlanHeading(`${heading}\n`)).toBe(CANONICAL);
    }
  });

  test("legacy H1 + em-dash regression still parses", () => {
    expect(parsePlanHeading("# M30 — Stale doc references\n")).toBe("M30 — Stale doc references");
  });

  test("a legacy colon-form plan file still canonicalizes to em-dash on disk", () => {
    const fx = makeProbe26Fixture("## M2: Legacy colon plan {#M2}");
    try {
      expect(planFileHeadingToMilestoneName(fx.planPath)).toBe(`M2 ${EM_DASH} Legacy colon plan`);
    } finally {
      fx.cleanup();
    }
  });

  test("the parser still declares BOTH separators (the change is emit-side only)", () => {
    expect(existsSync(planHeadingSrcPath)).toBe(true);
    const src = read(planHeadingSrcPath);
    expect(src).toContain(`(?:${EM_DASH}|:)`);
  });
});

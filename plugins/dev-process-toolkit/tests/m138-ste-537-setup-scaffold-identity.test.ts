// M138 STE-537 — `/setup` step 8 mints the `mode: none` bootstrap scaffold's
// identity.
//
// THE DEFECT (measured, v2.75.0). Step 8 writes `specs/plan/M1.md` under every
// mode. Under `mode: none` the milestone grammar is MINTED (`M_<6-char
// Crockford tail>`, derived from a `fr_`-prefixed ULID recorded verbatim as
// `id:`), so the bootstrap plan is the one shape that mode never produces —
// and nothing reds on it, because probe #73 exempts `kind: scaffolding` from
// the provenance arm. The mismatch waits silently for the author's first
// `/spec-write`.
//
// This file carries the legs that need a real project tree: the written plan's
// frontmatter, probe #73's disposition of both the new and the old shape, the
// accumulator-order regression the new naming forces, the consume path's
// continuity, and the shipped `/setup` prose.
//
// The pure naming decision is unit-tested beside its module, at
// `adapters/_shared/src/setup_scaffold_plan_identity.test.ts`.
//
// `runPlanIdentityModeConditionalProbe` is ASYNC. Every call below is awaited:
// `.violations` on an un-awaited Promise is `undefined`, and a `.length === 0`
// check on it passes vacuously — a green that means nothing was ever read.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  consumeScaffoldPlan,
  findScaffoldPlan,
  SCAFFOLD_PLAN_KIND,
} from "../adapters/_shared/src/consume_scaffold_plan";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { mintMilestoneId } from "../adapters/_shared/src/mint_milestone_id";
import {
  classifyPlanProvenance,
  EXEMPT_PLAN_KINDS,
  MINT_EPOCH,
  PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY,
  runPlanIdentityModeConditionalProbe,
} from "../adapters/_shared/src/plan_identity_mode_conditional";
import type { MilestoneIdentityMode } from "../adapters/_shared/src/resolve_milestone_identity";
import { ULID_REGEX } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const HELPER_SRC = join(SHARED_SRC, "setup_scaffold_plan_identity.ts");
const SETUP_SKILL = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const NFR1_TEST = join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts");
const SETUP_REFERENCE = join(PLUGIN_ROOT, "docs", "setup-reference.md");
const WORKFLOW_OVERVIEW = join(PLUGIN_ROOT, "docs", "workflow-overview.md");

const read = (path: string): string => readFileSync(path, "utf-8");

/** Comfortably after `MINT_EPOCH` — a plan committed here classifies `fresh`. */
const AFTER_MINT_EPOCH = "2026-08-16T12:00:00Z";

/** A well-formed minted id unrelated to anything the fixtures mint. */
const FOREIGN_ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA"; // derives M_F4VDTA

// ───────────────────────────────────────────────────────────────────────────
// The module under construction — loaded lazily and by absolute path, so a
// missing file reports per-leg rather than collapsing the prose and probe legs
// into one module-load stack trace.
// ───────────────────────────────────────────────────────────────────────────

interface ScaffoldPlanIdentity {
  fileName: string;
  id?: string;
}

interface ScaffoldPlanIdentityModule {
  scaffoldPlanIdentity(
    specsDir: string,
    mode: MilestoneIdentityMode,
    epicKey?: string,
  ): ScaffoldPlanIdentity;
}

async function loadHelper(): Promise<ScaffoldPlanIdentityModule> {
  if (!existsSync(HELPER_SRC)) {
    throw new Error(
      `adapters/_shared/src/setup_scaffold_plan_identity.ts does not exist — /setup step 8 has ` +
        `no mode-conditional name to write the bootstrap plan under, so mode: none keeps getting ` +
        `specs/plan/M1.md.`,
    );
  }
  const mod = (await import(HELPER_SRC)) as Partial<ScaffoldPlanIdentityModule>;
  if (typeof mod.scaffoldPlanIdentity !== "function") {
    throw new Error(`${HELPER_SRC} does not export scaffoldPlanIdentity()`);
  }
  return mod as ScaffoldPlanIdentityModule;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

interface Project {
  root: string;
  specsDir: string;
  planDir: string;
  cleanup: () => void;
}

function makeProject(mode: "none" | "linear" | "jira"): Project {
  const root = mkdtempSync(join(tmpdir(), "ste537-setup-scaffold-"));
  const specsDir = join(root, "specs");
  const planDir = join(specsDir, "plan");
  mkdirSync(join(planDir, "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), `# Fixture project\n\n## Task Tracking\n\nmode: ${mode}\n`);
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  return { root, specsDir, planDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function git(root: string, args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...extraEnv,
    },
  });
}

/**
 * Initialise a repo and commit everything at `at`. The `GIT_AUTHOR_DATE` /
 * `GIT_COMMITTER_DATE` pair is the load-bearing half: `classifyPlanProvenance`
 * dates the INTRODUCING commit, so without a chosen instant the fixture would
 * ride whatever "now" happens to be.
 */
function commitAll(project: Project, at: string): void {
  git(project.root, ["init", "-q", "."]);
  git(project.root, ["config", "user.email", "fixture@example.invalid"]);
  git(project.root, ["config", "user.name", "Fixture"]);
  git(project.root, ["config", "commit.gpgsign", "false"]);
  git(project.root, ["add", "-A"]);
  git(project.root, ["commit", "-q", "-m", "chore: bootstrap dev-process-toolkit"], {
    GIT_AUTHOR_DATE: at,
    GIT_COMMITTER_DATE: at,
  });
}

const SEEDED_MARKER = "verify: bun test src/barrel.test.ts";
const BOOTSTRAP_ROW =
  "| <scaffolding> | Bootstrap (barrel + primary feature shipped pre-toolkit) | n/a |";

/**
 * What step 8 writes, driven off the helper's return — the `id:` line is
 * present exactly when the helper handed one back, so a tracker-mode scaffold
 * cannot acquire the key by accident of the fixture.
 */
function scaffoldSource(identity: ScaffoldPlanIdentity, kind: string = SCAFFOLD_PLAN_KIND): string {
  const token = identity.fileName.replace(/\.md$/, "");
  const fm = ["---", `milestone: ${token}`, "status: active", "archived_at: null"];
  if (identity.id !== undefined) fm.push(`id: ${identity.id}`);
  fm.push(`kind: ${kind}`, "---");
  return [
    ...fm,
    "",
    "# Implementation Plan",
    "",
    `## ${token} — Foundation / Scaffolding {#${token}}`,
    "",
    "**Goal:** bootstrap the detected stack.",
    "",
    "**FR list**",
    "",
    "| FR | Title | Tracker |",
    "|----|-------|---------|",
    BOOTSTRAP_ROW,
    "",
    "**Tasks:**",
    "- [ ] Land the barrel",
    `  ${SEEDED_MARKER}`,
    "",
    "**Gate:** `bun test`",
    "",
  ].join("\n");
}

/** A plain minted plan (no `kind:`) — `/spec-write`'s output shape. */
function mintedPlanSource(milestoneId: string, id: string): string {
  return [
    "---",
    `milestone: ${milestoneId}`,
    "status: active",
    "archived_at: null",
    `id: ${id}`,
    "---",
    "",
    `# ${milestoneId} — Fresh milestone`,
    "",
  ].join("\n");
}

/** Write the step-8 scaffold from the helper's own answer. Returns its path. */
async function writeStep8Scaffold(
  project: Project,
  mode: "none" | "linear" | "jira",
  kind: string = SCAFFOLD_PLAN_KIND,
): Promise<{ identity: ScaffoldPlanIdentity; path: string }> {
  const helper = await loadHelper();
  const identity = helper.scaffoldPlanIdentity(project.specsDir, mode);
  const path = join(project.planDir, identity.fileName);
  writeFileSync(path, scaffoldSource(identity, kind));
  return { identity, path };
}

const activePlans = (project: Project): string[] =>
  readdirSync(project.planDir)
    .filter((n) => n.endsWith(".md"))
    .sort();

/**
 * Everything BELOW the closing `---` of the frontmatter block.
 *
 * The in-place consumption leg compares this across the rewrite: the
 * frontmatter is supposed to change and the body is not, so comparing whole
 * files would be red by design and comparing nothing at all would let a
 * delete-and-recreate implementation through. The `toBeGreaterThan(-1)` guard
 * is the non-vacuity half — a source with no closing fence would otherwise
 * compare two empty strings and pass on both sides.
 */
function bodyBelowFrontmatter(raw: string): string {
  const close = raw.indexOf("\n---\n", 4);
  expect(close).toBeGreaterThan(-1);
  return raw.slice(close + "\n---\n".length);
}

// ───────────────────────────────────────────────────────────────────────────
// Shipped-prose helpers — LINE-SCOPED, never file-wide.
// ───────────────────────────────────────────────────────────────────────────

interface Located {
  line: string;
  index: number;
}

/**
 * The single physical line containing `needle`, with its index.
 *
 * `toHaveLength(1)` FIRST, and that is the non-vacuity guard: a file-wide
 * `not.toContain` is also satisfied when the sentence has simply been deleted,
 * which would retire the claim instead of correcting it.
 */
function soleLine(path: string, needle: string): Located {
  const hits = read(path)
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter((h) => h.line.includes(needle));
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

/** The minted filename shape, as the shipped prose must spell it. */
const MINTED_SHAPE_RE = /specs\/plan\/M_/;
/** A mode qualifier — the thing that makes an `M1.md` mention conditional. */
const MODE_QUALIFIER_RE = /mode: none|tracker mode|tracker-less/;

/** The class-(5) clause of the STE-189 inventory sentence: `(5) …` up to `(6) `. */
function classFiveClause(line: string): string {
  const start = line.indexOf("(5) ");
  expect(start).toBeGreaterThan(-1);
  const end = line.indexOf("(6) ", start);
  expect(end).toBeGreaterThan(start);
  return line.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.1 — step 8 writes the minted name under mode: none
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.1 — the tracker-less bootstrap plan lands at `specs/plan/M_<tail>.md`", () => {
  test("step 8's write produces exactly one plan, and it is not `M1.md`", async () => {
    const project = makeProject("none");
    try {
      const { identity } = await writeStep8Scaffold(project, "none");

      expect(activePlans(project)).toEqual([identity.fileName]);
      expect(activePlans(project)).not.toContain("M1.md");
      expect(identity.fileName).toMatch(/^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/);
    } finally {
      project.cleanup();
    }
  });

  test("POSITIVE CONTROL — the same fixture writes `M1.md` under a tracker mode", async () => {
    const project = makeProject("linear");
    try {
      const { identity } = await writeStep8Scaffold(project, "linear");
      // The step-8 writer CAN still produce M1.md; the none branch simply
      // never asks it to. Without this leg the absence above is uncontrolled.
      expect(activePlans(project)).toEqual(["M1.md"]);
      expect(identity.fileName).toBe("M1.md");
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.2 — the written plan records the minted id verbatim
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.2 — the scaffold's frontmatter carries the full id + `kind: scaffolding`", () => {
  test("`id:` is the minted value verbatim and the filename derives from it", async () => {
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      const fm = parseFrontmatter(read(path));

      // STRICT equality, not `toContain` — a truncated tail satisfies a
      // substring check and leaves the real identity unreconstructable.
      expect(fm["id"]).toBe(identity.id);
      // `fr_` prefix provably present.
      expect(String(fm["id"])).toMatch(ULID_REGEX);
      // The CONSTANT, not the literal: a rename of `SCAFFOLD_PLAN_KIND` must
      // not leave this green against a stale value.
      expect(fm["kind"]).toBe(SCAFFOLD_PLAN_KIND);

      // The self-derivation invariant probe #73 enforces.
      expect(`${milestoneIdFromUlid(String(fm["id"]))}.md`).toBe(basename(path));
    } finally {
      project.cleanup();
    }
  });

  test("the freshly scaffolded tracker-less tree passes probe #73 clean", async () => {
    const project = makeProject("none");
    try {
      await writeStep8Scaffold(project, "none");
      const report = await runPlanIdentityModeConditionalProbe(project.root);

      expect(report.mode).toBe("none");
      expect(report.violations).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("MUTATION — a foreign `id:` on the same file fires the derivation row", async () => {
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      // Precondition: the foreign id really does derive a different filename.
      expect(`${milestoneIdFromUlid(FOREIGN_ULID)}.md`).not.toBe(identity.fileName);

      writeFileSync(path, read(path).replace(`id: ${identity.id!}`, `id: ${FOREIGN_ULID}`));

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.expected).toBe("an id: the filename derives from");
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.3 — the tracker modes are byte-identical to today
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.3 — `mode: linear` / `mode: jira` still scaffold `specs/plan/M1.md`", () => {
  for (const mode of ["linear", "jira"] as const) {
    test(`${mode}: the M1.md scaffold passes probe #73 clean`, async () => {
      const project = makeProject(mode);
      try {
        const { identity, path } = await writeStep8Scaffold(project, mode);
        expect(identity.fileName).toBe("M1.md");
        expect(read(path)).not.toMatch(/^id:/m);

        // PROVENANCE PRECONDITION, asserted rather than assumed. A git-backed,
        // post-epoch `M1.md` fires the jira arm's "an Epic-keyed M_<KEY> plan"
        // row and this `[]` would be a false red; a NON-repo classifies
        // `legacy` at classifyPlanProvenance step 2. Asserted on a NON-exempt
        // source so the scaffold's own `kind:` cannot mask the answer — a later
        // fixture that adds `git init` fails here, loudly, instead of silently
        // inverting the leg below.
        expect(existsSync(join(project.root, ".git"))).toBe(false);
        expect(
          classifyPlanProvenance(project.root, path, "---\nmilestone: M1\nstatus: active\n---\n"),
        ).toBe("legacy");

        const report = await runPlanIdentityModeConditionalProbe(project.root);
        expect(report.mode).toBe(mode);
        expect(report.violations).toEqual([]);
      } finally {
        project.cleanup();
      }
    });

    test(`${mode}: FALSIFIER — an injected \`id:\` on that same M1.md fires "absent"`, async () => {
      const project = makeProject(mode);
      try {
        const { path } = await writeStep8Scaffold(project, mode);
        writeFileSync(path, read(path).replace("status: active", `id: ${FOREIGN_ULID}\nstatus: active`));

        // The tracker arm is git-INDEPENDENT, so this is a real falsifier for
        // the green above under both modes.
        const report = await runPlanIdentityModeConditionalProbe(project.root);
        const absent = report.violations.filter((v) => v.expected === "absent");
        expect(absent).toHaveLength(1);
        expect(absent[0]!.actual).toBe(FOREIGN_ULID);
      } finally {
        project.cleanup();
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.4 + AC-STE-537.6 — the two shipped `/setup` surfaces
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.6 — the step-8 PRODUCER line is pinned in its own right", () => {
  test("the bootstrap-routing line names the mode-conditional filename", () => {
    const producer = soleLine(SETUP_SKILL, "Bootstrap-milestone routing");

    // The STE-197 pins that must survive the edit.
    expect(producer.line).toContain("`kind: scaffolding`");
    expect(producer.line).toContain("`<scaffolding>`");

    // …and the instruction now tells the reader which name to write, per mode.
    expect(producer.line).toContain("`specs/plan/M1.md`");
    expect(producer.line).toMatch(MINTED_SHAPE_RE);
    expect(producer.line).toMatch(MODE_QUALIFIER_RE);
  });

  test("a file-wide check CANNOT stand in for the line-scoped one", () => {
    const producer = soleLine(SETUP_SKILL, "Bootstrap-milestone routing");
    const inventory = soleLine(SETUP_SKILL, "Scaffold deliverables (canonical inventory");
    expect(producer.index).not.toBe(inventory.index);

    // Delete the producing instruction outright and a file-wide substring
    // check on EITHER filename shape still passes, because the downstream
    // inventory sentence carries both. That is precisely why the producer
    // needs a pin of its own.
    const withoutProducer = read(SETUP_SKILL)
      .split("\n")
      .filter((_, i) => i !== producer.index)
      .join("\n");
    expect(withoutProducer).toContain("`specs/plan/M1.md`");
    expect(withoutProducer).toMatch(MINTED_SHAPE_RE);
  });
});

describe("AC-STE-537.4 — the STE-189 class-(5) inventory sentence names both shapes", () => {
  test("the inventory line keeps its STE-481 pins", () => {
    const inv = soleLine(SETUP_SKILL, "Scaffold deliverables (canonical inventory");
    expect(inv.line).toContain("emitted unconditionally");
    expect(inv.line).toContain("The scaffold list is non-negotiable");
  });

  test("class (5) names BOTH filename shapes, under a mode qualifier", () => {
    const inv = soleLine(SETUP_SKILL, "Scaffold deliverables (canonical inventory");
    const clause = classFiveClause(inv.line);

    expect(clause).toContain("`specs/plan/M1.md`");
    expect(clause).toMatch(MINTED_SHAPE_RE);
    expect(clause).toMatch(MODE_QUALIFIER_RE);
  });

  test("the unconditional form is retired — `M1.md` no longer stands alone in class (5)", () => {
    const inv = soleLine(SETUP_SKILL, "Scaffold deliverables (canonical inventory");
    // Today's exact text. Scoped to the ONE line the sole-line selector found,
    // so a delete-the-sentence "fix" fails the selector above instead of
    // sailing through a file-wide `not.toContain`.
    expect(inv.line).not.toContain("(5) `specs/plan/M1.md` plus");
  });

  test("NFR-1 — setup/SKILL.md sits at 358/358 and the edit is net-zero-line", () => {
    // Measured the way the ENFORCING test measures. `wc -l` reports 357 on the
    // same file (it counts terminators, not lines), so a `wc`-shaped assertion
    // would disagree by one against a cap with ZERO headroom.
    expect(read(SETUP_SKILL).split("\n").length).toBe(358);

    // The cap really is 358 and really is measured that way — otherwise the
    // number above is an unanchored magic constant.
    const enforcing = read(NFR1_TEST);
    expect(enforcing).toMatch(/SKILL_LINE_CAP\s*=\s*358\b/);
    expect(enforcing).toContain('body.split("\\n").length');
  });

  test("SIBLING SURFACE — docs/setup-reference.md's bootstrap staging list names both shapes", () => {
    const stage = soleLine(SETUP_REFERENCE, "**Stage the canonical set.**");
    expect(stage.line).toContain("specs/plan/M1.md");
    expect(stage.line).toMatch(MINTED_SHAPE_RE);
    expect(stage.line).toMatch(MODE_QUALIFIER_RE);
  });

  test("SIBLING SURFACE — docs/workflow-overview.md's step-8 artifact row names both shapes", () => {
    const row = soleLine(WORKFLOW_OVERVIEW, "/setup step 8");
    expect(row.line).toContain("specs/plan/M1.md");
    expect(row.line).toMatch(MINTED_SHAPE_RE);
    expect(row.line).toMatch(MODE_QUALIFIER_RE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.5 — green on its own merits, not on the `scaffolding` exemption
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.5 — the minted scaffold does not lean on probe #73's exemption", () => {
  test("harness sanity — the fixture commit instant is genuinely post-epoch", () => {
    expect(Date.parse(AFTER_MINT_EPOCH)).toBeGreaterThan(Date.parse(MINT_EPOCH));
  });

  test("1. baseline — a lone minted scaffold in a post-epoch repo fires nothing", async () => {
    const project = makeProject("none");
    try {
      await writeStep8Scaffold(project, "none");
      commitAll(project, AFTER_MINT_EPOCH);

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations).toEqual([]);
      // The zero-row severity fallback, not a row-derived maximum.
      expect(report.severity).toBe(PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY);
      expect(report.severity).toBe("error");
    } finally {
      project.cleanup();
    }
  });

  test("2. STRUCTURAL — for a minted filename the exemption is UNREACHABLE", async () => {
    const project = makeProject("none");
    try {
      const { path } = await writeStep8Scaffold(project, "none");
      commitAll(project, AFTER_MINT_EPOCH);

      // Called DIRECTLY, the classifier does answer `exempt` on this file…
      expect(classifyPlanProvenance(project.root, path, read(path))).toBe("exempt");

      // …but the probe never asks. `classifyPlanProvenance` is called only
      // inside `if (!isMintedPlanId(basename(file)))`, so a minted name
      // short-circuits before provenance OR `kind:` is consulted at all.
      // Proof: strip the exemption's trigger and the classifier flips to
      // `fresh` — a disposition that WOULD fire the sequential arm — while the
      // probe stays silent regardless.
      const mutated = read(path).replace(`kind: ${SCAFFOLD_PLAN_KIND}`, "kind: bootstrap");
      writeFileSync(path, mutated);
      expect(classifyPlanProvenance(project.root, path, mutated)).toBe("fresh");

      // CORROBORATION ONLY, never the simulated removal: the same mutation
      // also drops the file out of `activeScaffolds`, so on this file it is a
      // no-op in two ways at once. The leg that actually exercises the
      // exemption is #3 below, on the old-shape name where the `!isMintedPlanId`
      // guard is true.
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("3. THE REAL EXEMPTION TEST — on `M1.md`, where the guard is true", async () => {
    // A dedicated tree holding ONLY the old-shape plan, so the co-presence pass
    // cannot contribute a row and the count below is about the exemption alone.
    const project = makeProject("none");
    try {
      const path = join(project.planDir, "M1.md");
      writeFileSync(path, scaffoldSource({ fileName: "M1.md" }, "bootstrap"));
      commitAll(project, AFTER_MINT_EPOCH);

      const fired = await runPlanIdentityModeConditionalProbe(project.root);
      expect(fired.violations).toHaveLength(1);
      expect(fired.violations[0]!.expected).toBe("a minted M_<6-char Crockford> plan");
      expect(fired.violations[0]!.severity).toBe("error");

      // Restore the exempt kind and the SAME run goes silent — the one place
      // in this FR where the exemption changes an outcome, which is also what
      // proves the harness's provenance clock really is post-epoch.
      writeFileSync(path, scaffoldSource({ fileName: "M1.md" }, SCAFFOLD_PLAN_KIND));
      const silent = await runPlanIdentityModeConditionalProbe(project.root);
      expect(silent.violations).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("4. ledger — `EXEMPT_PLAN_KINDS` still carries both values, nothing deleted", () => {
    expect([...EXEMPT_PLAN_KINDS]).toEqual(["scaffolding", "legacy"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Accumulator reorder regression — `planKind` must be tested BEFORE
// `isMintedPlanId`, or a minted-named scaffold accumulates as an active minted
// plan and STE-481's unconsumed-scaffold pass goes permanently blind.
// ═══════════════════════════════════════════════════════════════════════════

describe("the unconsumed-scaffold pass still sees a MINTED-named scaffold", () => {
  test("scaffold + a second minted plan ⇒ exactly one row, naming the SCAFFOLD", async () => {
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      const other = mintMilestoneId(project.specsDir);
      expect(other.milestoneId).not.toBe(identity.fileName.replace(/\.md$/, ""));
      writeFileSync(
        join(project.planDir, `${other.milestoneId}.md`),
        mintedPlanSource(other.milestoneId, other.id),
      );

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.expected).toBe(
        "no active kind: scaffolding plan beside an active minted plan",
      );
      // The row must name the SCAFFOLD, not the other minted plan — a fix that
      // fires but points at the wrong file sends the operator to the file they
      // must keep.
      expect(report.violations[0]!.file).toBe(path);
      expect(basename(report.violations[0]!.file)).toBe(identity.fileName);
    } finally {
      project.cleanup();
    }
  });

  test("ARCHIVE CONTROL — the same pair with the scaffold archived is silent", async () => {
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      const other = mintMilestoneId(project.specsDir);
      writeFileSync(
        join(project.planDir, `${other.milestoneId}.md`),
        mintedPlanSource(other.milestoneId, other.id),
      );

      // ACTIVE-only scope: membership is decided by the file's own directory.
      renameSync(path, join(project.planDir, "archive", identity.fileName));

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Consume-path continuity — `/spec-write`'s tracker-less minted branch still
// finds and consumes a scaffold that already occupies a minted filename.
// ═══════════════════════════════════════════════════════════════════════════

describe("consume-path continuity under the new scaffold naming", () => {
  test("findScaffoldPlan resolves the minted-named scaffold (frontmatter, not filename)", async () => {
    const project = makeProject("none");
    try {
      const { path } = await writeStep8Scaffold(project, "none");
      expect(findScaffoldPlan(project.specsDir)).toBe(path);
    } finally {
      project.cleanup();
    }
  });

  test("a DISTINCT freshly minted identity consumes it, body and all", async () => {
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      const fresh = mintMilestoneId(project.specsDir);
      expect(`${fresh.milestoneId}.md`).not.toBe(identity.fileName);

      const outcome = consumeScaffoldPlan(project.specsDir, {
        milestoneId: fresh.milestoneId,
        id: fresh.id,
      });

      expect(outcome.consumed).toBe(true);
      expect(outcome.from).toBe(path);
      expect(outcome.to).toBe(join(project.planDir, `${fresh.milestoneId}.md`));
      expect(existsSync(path)).toBe(false);
      expect(activePlans(project)).toEqual([`${fresh.milestoneId}.md`]);

      const survivor = read(outcome.to);
      const fm = parseFrontmatter(survivor);
      expect(fm["id"]).toBe(fresh.id); // verbatim, and the OLD id is gone
      expect(fm["kind"]).toBeUndefined();
      expect(fm["milestone"]).toBe(fresh.milestoneId);
      // The seeded body /setup wrote survives — consumed, not recreated.
      expect(survivor).toContain(SEEDED_MARKER);
      expect(survivor).toContain(BOOTSTRAP_ROW);
    } finally {
      project.cleanup();
    }
  });

  test("re-passing the scaffold's OWN identity consumes it IN PLACE", async () => {
    // SUPERSEDED (STE-538 AC.2). This leg used to demand a throw: after STE-537
    // the scaffold already occupies a minted filename, so `to === from`, and the
    // clobber guard fired on it. STE-538 makes that identity the ADOPTED one —
    // routing it into the guard "would refuse the very file it exists to keep" —
    // so the contract is inverted deliberately: consume in place, no rename, no
    // second file. Its sibling leg above still pins the DISTINCT-id rename
    // branch; the two together keep both halves of `consumeScaffoldPlan` covered.
    const project = makeProject("none");
    try {
      const { identity, path } = await writeStep8Scaffold(project, "none");
      const before = read(path);
      const milestoneId = identity.fileName.replace(/\.md$/, "");

      const outcome = consumeScaffoldPlan(project.specsDir, {
        milestoneId,
        id: identity.id!,
      });

      expect(outcome.consumed).toBe(true);
      expect(outcome.from).toBe(path);
      expect(outcome.to).toBe(path);
      expect(outcome.from).toBe(outcome.to);
      // Nothing renamed, nothing created beside it.
      expect(existsSync(path)).toBe(true);
      expect(activePlans(project)).toEqual([identity.fileName]);

      const after = read(path);
      // The body below the frontmatter is BYTE-IDENTICAL — rewritten in place,
      // not delete-and-recreated. A recreating implementation passes the file
      // count and every frontmatter assertion below, and fails here.
      expect(bodyBelowFrontmatter(after)).toBe(bodyBelowFrontmatter(before));
      expect(after).toContain(SEEDED_MARKER);
      expect(after).toContain(BOOTSTRAP_ROW);

      const fm = parseFrontmatter(after);
      // The scaffold marker is consumed…
      expect(fm["kind"]).toBeUndefined();
      expect(after).not.toContain(`kind: ${SCAFFOLD_PLAN_KIND}`);
      // …and the adopted identity survives verbatim, line and all — this is the
      // id that NAMED the file, so re-emitting a normalised copy would make
      // "adoption preserved it" indistinguishable from "adoption rewrote it".
      expect(fm["id"]).toBe(identity.id);
      expect(after).toContain(`id: ${identity.id!}`);
      expect(fm["milestone"]).toBe(milestoneId);
      // Still self-derivable: the filename IS the tail of the recorded id.
      expect(`${milestoneIdFromUlid(String(fm["id"]))}.md`).toBe(basename(path));
    } finally {
      project.cleanup();
    }
  });
});

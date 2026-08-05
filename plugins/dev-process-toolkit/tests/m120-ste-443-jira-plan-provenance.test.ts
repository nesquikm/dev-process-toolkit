// M120 STE-443 — give probe #73 a jira-keyed provenance arm.
//
// The defect: probe #73 is bidirectional but asymmetric. Under `mode: none` a
// freshly created sequential `M<N>` plan is an error, decided by git provenance
// against `MINT_EPOCH`. Under ANY tracker mode the only rule is id-absence, so a
// sequential plan in a Jira project — where the Epic-first path made `M_<KEY>`
// the correct shape — is fully gate-clean. Two consumer projects accumulated
// five such plans with a green gate on every run.
//
// The cause worth naming: the walk branches on `isTracker` (`mode !== "none"`),
// a boolean that lumps together two modes with OPPOSITE expectations. Sequential
// numbering is correct under `mode: linear` by explicit prior decision; it is
// wrong under `mode: jira`. Widening the boolean would turn THIS repository's
// gate red on its own hundred-plus archived sequential plans, so the new arm
// must key on the mode STRING.
//
// AC map:
//   AC-STE-443.1  — `classifyPlanProvenance` takes an optional 4th epoch arg;
//                   omitted ⇒ `MINT_EPOCH`, exactly as today.
//   AC-STE-443.2  — `JIRA_EPIC_EPOCH` = 2026-08-05T00:00:00Z, straddled.
//   AC-STE-443.3  — the branch keys on `mode === "jira"`, never on `isTracker`.
//   AC-STE-443.4  — the four dispositions + NFR-10 canonical message shape.
//   AC-STE-443.5  — the pre-existing id-absence rule still fires under jira;
//                   one plan can violate both and report both.
//   AC-STE-443.6  — exemption reuses `EXEMPT_PLAN_KINDS`, CRLF/BOM included.
//   AC-STE-443.7  — the reported incident, as a REAL temporary git repository.
//   AC-STE-443.8  — cross-mode invariance against RECORDED pre-change lists.
//   AC-STE-443.10 — no new probe is registered; the documented count stays 74.
//
// (AC-STE-443.9 — mutation verification — is a process AC owned by the
// orchestrator, not a test. Tests below that CANNOT fail against the pre-change
// module are labelled `GUARD` with the reason: they pin what must NOT move, so
// passing on both sides is their correct behaviour. Every other test here fails
// against the pre-change module.)
//
// EXPORTS THIS FILE REQUIRES from `plan_identity_mode_conditional.ts`:
//   * `JIRA_EPIC_EPOCH: string` — new.
//   * `classifyPlanProvenance(projectRoot, planPath, rawPlanSource, epoch?)`
//     — a 4th, optional parameter defaulting to `MINT_EPOCH`.
// Both are read through the module NAMESPACE rather than named imports on
// purpose: a named import of a symbol that does not exist yet is a LINK error
// that kills the whole file, which would collapse every mutation-verification
// result into one undifferentiated failure. Reading them off the namespace lets
// each test fail on its own assertion.
//
// FIXTURES ARE REAL GIT REPOSITORIES, per the tracker-less arm's precedent in
// `m119-ste-441-plan-provenance.test.ts`. The signal under test comes from git
// itself, so a mock could not exercise it: every classification below is
// produced by `git commit` with a controlled `GIT_AUTHOR_DATE`, by leaving a
// file untracked, or by severing the introducing commit's object.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  MINT_EPOCH,
  classifyPlanProvenance,
  runPlanIdentityModeConditionalProbe,
} from "../adapters/_shared/src/plan_identity_mode_conditional";
import * as planIdentityModule from "../adapters/_shared/src/plan_identity_mode_conditional";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const PLAN_PROBE_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "plan_identity_mode_conditional.ts",
);
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const README = join(REPO_ROOT, "README.md");

const read = (path: string): string => readFileSync(path, "utf-8");

// ───────────────────────────────────────────────────────────────────────────
// Post-change surface, read without a link-time dependency (see header)
// ───────────────────────────────────────────────────────────────────────────

const MODULE_EXPORTS = planIdentityModule as unknown as Record<string, unknown>;

/** `undefined` against the pre-change module — every use below then fails. */
const JIRA_EPIC_EPOCH = MODULE_EXPORTS["JIRA_EPIC_EPOCH"] as string;

type ClassifyWithEpoch = (
  projectRoot: string,
  planPath: string,
  rawPlanSource: string,
  epoch?: string,
) => string;

/** The 4-argument form AC-STE-443.1 introduces. */
const classifyAgainst = classifyPlanProvenance as unknown as ClassifyWithEpoch;

// ───────────────────────────────────────────────────────────────────────────
// Straddling instants
// ───────────────────────────────────────────────────────────────────────────

// `MINT_EPOCH` — 2026-07-26T00:00:00Z, v2.56.0 "Mint".
const ONE_SECOND_BEFORE_MINT = "2026-07-25T23:59:59Z";
const ONE_SECOND_AFTER_MINT = "2026-07-26T00:00:01Z";

// `JIRA_EPIC_EPOCH` — 2026-08-05T00:00:00Z, this release's ship date. Ten days
// LATER than the mint epoch on purpose: reusing the earlier constant would date
// the boundary two weeks back and flag five plans in two consumer projects that
// cannot be edited — a forced migration through the side door. Every instant
// below therefore sits AFTER the mint epoch, so a probe that quietly compares
// against `MINT_EPOCH` classifies them all `fresh` and fails these tests.
const JIRA_EPOCH_ISO = "2026-08-05T00:00:00Z";
const ONE_SECOND_BEFORE_JIRA = "2026-08-04T23:59:59Z";
const AT_JIRA_EPOCH = JIRA_EPOCH_ISO;
const ONE_SECOND_AFTER_JIRA = "2026-08-05T00:00:01Z";

// The reported incident's two dates, at a wall-clock hour rather than midnight.
const INCIDENT_DAY_BEFORE = "2026-08-04T15:04:05Z";
const INCIDENT_DAY_OF = "2026-08-05T15:04:05Z";

const LONG_BEFORE_EPOCH = "2026-01-01T00:00:00Z";

const VALID_ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const MINTED_PLAN = "M_F4VDTA"; // = milestoneIdFromUlid(VALID_ULID)

// ───────────────────────────────────────────────────────────────────────────
// Fixture plumbing — real temporary git repositories (mirrors STE-441)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run git inside `root` with the ambient user configuration neutralised, so a
 * developer's global `commit.gpgsign`, `core.hooksPath` or `init.templateDir`
 * cannot make these fixtures pass or fail for reasons unrelated to the probe.
 */
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

function commitAt(root: string, iso: string, message: string): void {
  git(root, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

type Mode = "none" | "linear" | "jira";

interface PlanFixture {
  /** Basename, e.g. `M120.md`. */
  name: string;
  archived?: boolean;
  /** Extra frontmatter lines, prepended to the base block. */
  fm?: string[];
  /** Full raw file bytes, overriding the generated body (CRLF / BOM cases). */
  raw?: string;
  /**
   * Author date of the commit that introduces the plan. Omit to leave the plan
   * on disk but never committed.
   */
  committedAt?: string;
}

interface Project {
  root: string;
  cleanup: () => void;
}

function claudeMd(mode: Mode): string {
  return mode === "none"
    ? "# Mode-none fixture\n\nNo `## Task Tracking` section → mode: none per Schema L canonical form.\n"
    : `# Tracker-mode fixture\n\n## Task Tracking\n\nmode: ${mode}\nmcp_server: ${mode}\n`;
}

function planSource(stem: string, extraFm: string[] = []): string {
  return [
    "---",
    ...extraFm,
    `milestone: ${stem}`,
    "status: active",
    "archived_at: null",
    "---",
    "",
    `# ${stem} — Fixture`,
    "",
  ].join("\n");
}

function planRel(plan: PlanFixture): string {
  return plan.archived === true
    ? join("specs", "plan", "archive", plan.name)
    : join("specs", "plan", plan.name);
}

function makeProject(opts: { mode?: Mode; plans: PlanFixture[] }): Project {
  const mode = opts.mode ?? "jira";
  const root = mkdtempSync(join(tmpdir(), "ste443-plan-"));
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMd(mode));
  writeFileSync(join(root, "README.md"), "# Fixture project\n");

  git(root, ["init", "-q", "."]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "--", "CLAUDE.md", "README.md"]);
  commitAt(root, LONG_BEFORE_EPOCH, "chore: fixture base");

  for (const plan of opts.plans) {
    const rel = planRel(plan);
    const stem = plan.name.replace(/\.md$/, "");
    writeFileSync(join(root, rel), plan.raw ?? planSource(stem, plan.fm ?? []));
    if (plan.committedAt !== undefined) {
      git(root, ["add", "--", rel]);
      commitAt(root, plan.committedAt, `chore: add ${plan.name}`);
    }
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Make a plan's introducing commit undiscoverable while the plan stays tracked
 * in HEAD — a severed/pruned object store, the `undecidable` condition.
 *
 * Not the shallow-clone case: a shallow clone answers `git log --diff-filter=A`
 * with its BOUNDARY commit rather than failing, so a plan there classifies
 * `fresh`, never `undecidable`.
 */
function severIntroducingCommit(root: string, rel: string): void {
  writeFileSync(join(root, "README.md"), "# Fixture project\n\nTrailing change.\n");
  git(root, ["add", "--", "README.md"]);
  commitAt(root, ONE_SECOND_AFTER_JIRA, "chore: trailing");

  const sha = git(root, ["log", "--diff-filter=A", "-1", "--format=%H", "--", rel]).trim();
  if (sha.length !== 40) {
    throw new Error(`fixture bug: no introducing commit to sever for ${rel} (got "${sha}")`);
  }
  const objectPath = join(root, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  if (!existsSync(objectPath)) {
    throw new Error(`fixture bug: expected a loose object at ${objectPath}`);
  }
  rmSync(objectPath, { force: true });
}

function classifyIn(root: string, rel: string, epoch?: string): string {
  const abs = join(root, rel);
  return classifyAgainst(root, abs, read(abs), epoch);
}

/** The pre-change 3-argument call, verbatim — no 4th argument reaches it. */
function classifyDefault(root: string, rel: string): string {
  const abs = join(root, rel);
  return classifyPlanProvenance(root, abs, read(abs));
}

const ACTIVE = (name: string): string => join("specs", "plan", name);

/** Every violation's file + note + message, fused — the assertion surface. */
function blobOf(violations: Array<{ file: string; note: string; message: string }>): string {
  return violations.map((v) => `${v.file}\n${v.note}\n${v.message}`).join("\n");
}

interface RecordedRow {
  file: string;
  line: number;
  expected: string;
  actual: string;
  severity: string;
}

/** The report's rows in the recorded shape — POSIX-separated, root-relative. */
function rowsOf(
  root: string,
  violations: Array<{
    file: string;
    line: number;
    expected: string;
    actual: string;
    severity: string;
  }>,
): RecordedRow[] {
  return violations.map((v) => ({
    file: relative(root, v.file).split("\\").join("/"),
    line: v.line,
    expected: v.expected,
    actual: v.actual,
    severity: v.severity,
  }));
}

function contextLineOf(message: string): string {
  return message.split("\n").find((l) => l.startsWith("Context:")) ?? "";
}

function remedyLineOf(message: string): string {
  return message.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.1 — the optional epoch argument
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.1 — classifyPlanProvenance takes an optional epoch, defaulting to MINT_EPOCH", () => {
  test("GUARD — with the argument OMITTED the boundary is MINT_EPOCH, inclusive", () => {
    const p = makeProject({
      mode: "none",
      plans: [
        { name: "M5.md", committedAt: ONE_SECOND_BEFORE_MINT },
        { name: "M6.md", committedAt: MINT_EPOCH },
        { name: "M7.md", committedAt: ONE_SECOND_AFTER_MINT },
      ],
    });
    try {
      expect(classifyDefault(p.root, ACTIVE("M5.md"))).toBe("legacy");
      expect(classifyDefault(p.root, ACTIVE("M6.md"))).toBe("fresh");
      expect(classifyDefault(p.root, ACTIVE("M7.md"))).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — passing MINT_EPOCH explicitly is indistinguishable from omitting it", () => {
    // The default must BE the constant, not a copy that can drift from it.
    const p = makeProject({
      mode: "none",
      plans: [
        { name: "M5.md", committedAt: ONE_SECOND_BEFORE_MINT },
        { name: "M6.md", committedAt: ONE_SECOND_AFTER_MINT },
      ],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M5.md"), MINT_EPOCH)).toBe("legacy");
      expect(classifyIn(p.root, ACTIVE("M6.md"), MINT_EPOCH)).toBe("fresh");
      for (const name of ["M5.md", "M6.md"]) {
        expect(classifyIn(p.root, ACTIVE(name), MINT_EPOCH)).toBe(classifyDefault(p.root, ACTIVE(name)));
      }
    } finally {
      p.cleanup();
    }
  });

  test("an EXPLICIT later epoch moves the boundary — the same plan flips fresh → legacy", () => {
    // The single behavioural claim the whole FR rests on. `M120` arrives on
    // 2026-07-26T00:00:01Z: `fresh` against the mint epoch, `legacy` against a
    // ten-days-later one. A 4th argument that is accepted and then IGNORED
    // returns `fresh` for both and fails here.
    const p = makeProject({
      mode: "none",
      plans: [{ name: "M120.md", committedAt: ONE_SECOND_AFTER_MINT }],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M120.md"))).toBe("fresh");
      expect(classifyIn(p.root, ACTIVE("M120.md"), JIRA_EPOCH_ISO)).toBe("legacy");
    } finally {
      p.cleanup();
    }
  });

  test("an EXPLICIT earlier epoch moves it the other way — legacy → fresh", () => {
    // Both directions, so "the argument shifts the boundary" cannot be
    // satisfied by a one-sided special case.
    const p = makeProject({
      mode: "none",
      plans: [{ name: "M3.md", committedAt: LONG_BEFORE_EPOCH }],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M3.md"))).toBe("legacy");
      expect(classifyIn(p.root, ACTIVE("M3.md"), "2025-01-01T00:00:00Z")).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — the epoch argument does not override the earlier resolution steps", () => {
    // `exempt` and the untracked ⇒ `fresh` catch are decided BEFORE any date
    // comparison, so no epoch can change them. A parameter threaded in at the
    // wrong level would show up here.
    const p = makeProject({
      mode: "none",
      plans: [{ name: "M8.md", fm: ["kind: legacy"], committedAt: ONE_SECOND_AFTER_MINT }, { name: "M9.md" }],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M8.md"), "2025-01-01T00:00:00Z")).toBe("exempt");
      expect(classifyIn(p.root, ACTIVE("M9.md"), "2099-01-01T00:00:00Z")).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.2 — JIRA_EPIC_EPOCH
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.2 — JIRA_EPIC_EPOCH is this release's ship date", () => {
  test("the constant is exactly 2026-08-05T00:00:00Z and parses", () => {
    expect(JIRA_EPIC_EPOCH).toBe("2026-08-05T00:00:00Z");
    expect(Number.isFinite(Date.parse(JIRA_EPIC_EPOCH))).toBe(true);
    expect(Date.parse(JIRA_EPIC_EPOCH)).toBe(Date.parse("2026-08-05T00:00:00.000Z"));
  });

  test("it is a DISTINCT instant from MINT_EPOCH, strictly later", () => {
    // Reusing `MINT_EPOCH` would back-date the boundary ten days and flag the
    // five extant consumer plans this FR exists to grandfather.
    expect(JIRA_EPIC_EPOCH).not.toBe(MINT_EPOCH);
    expect(Date.parse(JIRA_EPIC_EPOCH)).toBeGreaterThan(Date.parse(MINT_EPOCH));
  });

  test("its comment names the ship date and the legacy carve-out it opens", () => {
    // Same documented shape as `MINT_EPOCH`: a `//` comment immediately above
    // the constant saying what the instant IS and what falling either side of
    // it means. Without it the literal is an unexplained magic date.
    const lines = read(PLAN_PROBE_SRC).split("\n");
    const idx = lines.findIndex((l) => /^export const JIRA_EPIC_EPOCH\b/.test(l));
    expect(idx).toBeGreaterThan(0);
    const comment: string[] = [];
    for (let i = idx - 1; i >= 0 && lines[i]!.trimStart().startsWith("//"); i--) {
      comment.unshift(lines[i]!);
    }
    const prose = comment.join("\n");
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).toMatch(/ship(ped)?\s+date|ship date of/i);
    expect(prose).toMatch(/legac/i);
  });

  test("one second BEFORE it is legacy; one second AFTER is fresh", () => {
    const p = makeProject({
      mode: "jira",
      plans: [
        { name: "M118.md", committedAt: ONE_SECOND_BEFORE_JIRA },
        { name: "M119.md", committedAt: ONE_SECOND_AFTER_JIRA },
      ],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M118.md"), JIRA_EPIC_EPOCH)).toBe("legacy");
      expect(classifyIn(p.root, ACTIVE("M119.md"), JIRA_EPIC_EPOCH)).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });

  test("the boundary is INCLUSIVE — a plan introduced exactly at the epoch fails", async () => {
    const p = makeProject({ mode: "jira", plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }] });
    try {
      expect(classifyIn(p.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("fresh");
      // Pinned through the probe too: the classifier alone cannot show that
      // the arm consumes this boundary, and an off-by-one `>` would wave
      // through the very first plan of the new regime.
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.3 — the branch keys on the MODE STRING, not the isTracker boolean
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.3 — mode: linear is untouched; only mode: jira grows the arm", () => {
  const freshSequential: PlanFixture[] = [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }];

  test("the SAME fresh sequential plan is silent under linear and fails under jira", async () => {
    // The whole FR in one assertion pair. A branch keyed on `isTracker` would
    // police both legs identically and redden this repository, which runs
    // `mode: linear` with a hundred-plus sequential plans.
    const linear = makeProject({ mode: "linear", plans: freshSequential });
    const jira = makeProject({ mode: "jira", plans: freshSequential });
    try {
      const linearReport = await runPlanIdentityModeConditionalProbe(linear.root);
      expect(linearReport.mode).toBe("linear");
      expect(linearReport.violations).toEqual([]);

      const jiraReport = await runPlanIdentityModeConditionalProbe(jira.root);
      expect(jiraReport.mode).toBe("jira");
      expect(jiraReport.violations.length).toBe(1);
      expect(jiraReport.violations[0]!.file).toContain("M120.md");
      expect(jiraReport.violations[0]!.severity).toBe("error");
      expect(jiraReport.severity).toBe("error");
    } finally {
      linear.cleanup();
      jira.cleanup();
    }
  });

  test("GUARD — mode: linear stays silent across the whole provenance spread", async () => {
    // GUARD-adjacent, but not vacuous: it pins the exact widening risk. Every
    // one of these plans WOULD raise a row under jira.
    const p = makeProject({
      mode: "linear",
      plans: [
        { name: "M3.md", committedAt: LONG_BEFORE_EPOCH },
        { name: "M118.md", committedAt: ONE_SECOND_BEFORE_JIRA },
        { name: "M119.md", committedAt: AT_JIRA_EPOCH },
        { name: "M120.md" }, // untracked ⇒ `fresh` at any epoch
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("linear");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("an UNTRACKED sequential plan is fresh under jira too — no commit needed", async () => {
    const p = makeProject({ mode: "jira", plans: [{ name: "M120.md" }] });
    try {
      expect(classifyIn(p.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("an EPIC-keyed jira plan is the CORRECT shape and stays silent beside a failing sequential one", async () => {
    // `M_DST_49` is what the Epic-first path produces, so it must never be
    // policed. Paired with a fresh sequential sibling in the same walk, so the
    // silence is proven to be selective rather than global.
    const p = makeProject({
      mode: "jira",
      plans: [
        { name: "M_DST_49.md", committedAt: ONE_SECOND_AFTER_JIRA },
        { name: "M120.md", committedAt: ONE_SECOND_AFTER_JIRA },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain("M120.md");
      expect(blobOf(report.violations)).not.toContain("M_DST_49");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — a MINTED plan under jira is not swept into the sequential arm", async () => {
    // `M_F4VDTA` carries no `id:` (forbidden in tracker mode) and is not a
    // sequential token, so it must produce nothing at all.
    const p = makeProject({
      mode: "jira",
      plans: [{ name: `${MINTED_PLAN}.md`, committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("the source compares the MODE STRING, not the isTracker boolean", () => {
    // The distinction has to live in the code, not in a comment: `isTracker`
    // cannot express "jira but not linear", so a literal `mode === "jira"`
    // comparison must exist.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is the whole point. The module
    // header quotes `mode === "jira"` in prose to explain the choice, so a
    // whole-file grep is satisfied by the COMMENT alone: rewriting the walk to
    // `isTracker && mode !== "linear"` and leaving the header untouched kept
    // this assertion green — verified against exactly that mutant. A pin that
    // survives the regression it names is not a pin, so only executable source
    // may satisfy it.
    const executableSource = read(PLAN_PROBE_SRC)
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(executableSource).toMatch(/mode\s*===\s*"jira"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.4 — the four dispositions under mode: jira
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.4 — fresh ⇒ error, legacy ⇒ nothing, undecidable ⇒ advisory, exempt ⇒ nothing", () => {
  test("FRESH — an error-severity violation in the NFR-10 canonical shape", async () => {
    const p = makeProject({ mode: "jira", plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }] });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.file).toContain("M120.md");
      expect(v.line).toBeGreaterThanOrEqual(1);
      // Verdict line, then `Remedy:`, then `Context:` — the shape this probe's
      // other rows already use.
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/\nRemedy: /);
      expect(v.message).toMatch(/\nContext: /);
      expect(v.note).toMatch(/specs[/\\]plan[/\\].*\.md:\d+ — /);
      expect(v.note).toContain("expected ");
      expect(v.note).toContain("actual ");
    } finally {
      p.cleanup();
    }
  });

  test("FRESH — the row names the jira mode and the epoch it was judged against", async () => {
    // Without the epoch in `Context:` the operator cannot tell WHICH boundary
    // fired — the probe now carries two. The mode-none row already renders
    // `epoch=<MINT_EPOCH>` there, so this is the same key with the other value.
    const p = makeProject({ mode: "jira", plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }] });
    try {
      const v = (await runPlanIdentityModeConditionalProbe(p.root)).violations[0]!;
      expect(contextLineOf(v.message)).toContain("mode=jira");
      expect(v.message).toContain(JIRA_EPOCH_ISO);
      // …and never the tracker-less boundary, which does not apply here.
      expect(v.message).not.toContain(MINT_EPOCH);
    } finally {
      p.cleanup();
    }
  });

  test("LEGACY — silent, beside a fresh sibling that is not", async () => {
    // The positive control is in the SAME walk on purpose: "produces nothing"
    // is trivially true of a probe that produces nothing at all.
    const p = makeProject({
      mode: "jira",
      plans: [
        { name: "M118.md", committedAt: ONE_SECOND_BEFORE_JIRA },
        { name: "M119.md", committedAt: ONE_SECOND_AFTER_JIRA },
      ],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M118.md"), JIRA_EPIC_EPOCH)).toBe("legacy");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain("M119.md");
      expect(blobOf(report.violations)).not.toContain("M118.md");
    } finally {
      p.cleanup();
    }
  });

  test("UNDECIDABLE — one warning-severity advisory whose remedy names `kind: legacy`", async () => {
    const p = makeProject({ mode: "jira", plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }] });
    try {
      severIntroducingCommit(p.root, ACTIVE("M120.md"));
      expect(classifyIn(p.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("undecidable");

      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.severity).toBe("warning");
      expect(remedyLineOf(v.message)).toContain("kind: legacy");
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/\nContext: /);
      // WHICH epoch and WHICH mode judged this row. Without these two the
      // advisory is unpinned to its arm: the row is built by the SHARED
      // `undecidableProvenanceViolation` helper, whose epoch is a caller-
      // supplied parameter, so handing it `MINT_EPOCH` instead of
      // `JIRA_EPIC_EPOCH` would leave the entire suite green while dating the
      // jira advisory ten days early. The `fresh` row already pins both.
      expect(contextLineOf(v.message)).toContain("mode=jira");
      expect(contextLineOf(v.message)).toContain(`epoch=${JIRA_EPIC_EPOCH}`);
      expect(v.note).toMatch(/specs[/\\]plan[/\\].*\.md:\d+ — /);
      // An advisory-only report must not redden a gate the operator cannot fix.
      expect(report.severity).toBe("warning");
    } finally {
      p.cleanup();
    }
  });

  test("EXEMPT — silent, and the identical fixture without the key is not", async () => {
    const exempt = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", fm: ["kind: legacy"], committedAt: AT_JIRA_EPOCH }],
    });
    const control = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH }],
    });
    try {
      expect((await runPlanIdentityModeConditionalProbe(control.root)).violations.length).toBe(1);
      expect((await runPlanIdentityModeConditionalProbe(exempt.root)).violations).toEqual([]);
    } finally {
      exempt.cleanup();
      control.cleanup();
    }
  });

  test("an ARCHIVED fresh sequential jira plan is classified too — the walk spans specs/plan/**", async () => {
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", committedAt: AT_JIRA_EPOCH, archived: true }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain(join("plan", "archive"));
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("severity travels per row — one walk emits an error and an advisory together", async () => {
    // Severing truncates the object graph for every history query, so the
    // `fresh` leg is an UNTRACKED plan: `git ls-files` reads the index and
    // needs no history, so it survives the severed repo intact.
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M118.md", committedAt: AT_JIRA_EPOCH }, { name: "M119.md" }],
    });
    try {
      severIntroducingCommit(p.root, ACTIVE("M118.md"));
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(2);
      expect(report.violations.map((v) => v.severity).sort()).toEqual(["error", "warning"]);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.5 — the arm ADDS a check, it never replaces one
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.5 — the tracker-mode id-absence rule still fires under jira", () => {
  test("GUARD — a jira plan carrying an id: still fails, exactly as before", async () => {
    // Legacy-dated on purpose, so the ONLY row can be the id-absence one.
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M118.md", fm: [`id: ${VALID_ULID}`], committedAt: ONE_SECOND_BEFORE_JIRA }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
      expect(report.violations[0]!.actual).toBe(VALID_ULID);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("a plan that is BOTH fresh-sequential AND id-carrying reports BOTH violations", async () => {
    // The two invariants are independent, so a `continue` that short-circuits
    // the walk after the id row would silently swallow the new one.
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", fm: [`id: ${VALID_ULID}`], committedAt: AT_JIRA_EPOCH }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(2);
      for (const v of report.violations) {
        expect(v.file).toContain("M120.md");
        expect(v.severity).toBe("error");
      }
      const idRow = report.violations.filter((v) => v.expected === "absent");
      const sequentialRow = report.violations.filter((v) => v.expected !== "absent");
      expect(idRow.length).toBe(1);
      expect(sequentialRow.length).toBe(1);
      expect(idRow[0]!.actual).toBe(VALID_ULID);
      expect(sequentialRow[0]!.message).toContain(JIRA_EPOCH_ISO);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — a LEGACY-dated jira plan carrying an id: still reports exactly the one id row", async () => {
    // Guards the other direction of the same short-circuit: the new arm must
    // not suppress the old row when its own verdict is silence.
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M3.md", fm: [`id: ${VALID_ULID}`], committedAt: LONG_BEFORE_EPOCH }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(rowsOf(p.root, report.violations)).toEqual([
        {
          file: "specs/plan/M3.md",
          line: 2,
          expected: "absent",
          actual: VALID_ULID,
          severity: "error",
        },
      ]);
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.6 — exemption reuses EXEMPT_PLAN_KINDS, CRLF/BOM included
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.6 — `kind: scaffolding` / `kind: legacy` exempt a jira plan too", () => {
  for (const kind of ["scaffolding", "legacy"]) {
    test(`a fresh jira plan carrying \`kind: ${kind}\` is exempt, and its control is not`, async () => {
      const exempt = makeProject({
        mode: "jira",
        plans: [{ name: "M120.md", fm: [`kind: ${kind}`], committedAt: ONE_SECOND_AFTER_JIRA }],
      });
      const control = makeProject({
        mode: "jira",
        plans: [{ name: "M120.md", committedAt: ONE_SECOND_AFTER_JIRA }],
      });
      try {
        expect((await runPlanIdentityModeConditionalProbe(control.root)).violations.length).toBe(1);
        expect(classifyIn(exempt.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("exempt");
        expect((await runPlanIdentityModeConditionalProbe(exempt.root)).violations).toEqual([]);
      } finally {
        exempt.cleanup();
        control.cleanup();
      }
    });
  }

  test("CRLF frontmatter is recognised — the same normalizeFrontmatterSource path", async () => {
    // A `\r\n` separator makes a raw scan read the whole file as "no
    // frontmatter", which would silently un-exempt every CRLF plan in a
    // Windows checkout. Asserted against a live control so the pass is real.
    const raw = `---\r\nkind: legacy\r\nmilestone: M120\r\nstatus: active\r\n---\r\n\r\n# M120 — Fixture\r\n`;
    const bare = `---\r\nmilestone: M120\r\nstatus: active\r\n---\r\n\r\n# M120 — Fixture\r\n`;
    const exempt = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", raw, committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    const control = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", raw: bare, committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    try {
      expect((await runPlanIdentityModeConditionalProbe(control.root)).violations.length).toBe(1);
      expect(classifyIn(exempt.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("exempt");
      expect((await runPlanIdentityModeConditionalProbe(exempt.root)).violations).toEqual([]);
    } finally {
      exempt.cleanup();
      control.cleanup();
    }
  });

  test("a BOM-prefixed plan is recognised too", async () => {
    const raw = `\uFEFF---\nkind: scaffolding\nmilestone: M120\nstatus: active\n---\n\n# M120 — Fixture\n`;
    const bare = `\uFEFF---\nmilestone: M120\nstatus: active\n---\n\n# M120 — Fixture\n`;
    const exempt = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", raw, committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    const control = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", raw: bare, committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    try {
      expect((await runPlanIdentityModeConditionalProbe(control.root)).violations.length).toBe(1);
      expect(classifyIn(exempt.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("exempt");
      expect((await runPlanIdentityModeConditionalProbe(exempt.root)).violations).toEqual([]);
    } finally {
      exempt.cleanup();
      control.cleanup();
    }
  });

  test("NON-VACUITY — an unrelated `kind:` value exempts nothing under jira", async () => {
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M120.md", fm: ["kind: feature"], committedAt: ONE_SECOND_AFTER_JIRA }],
    });
    try {
      expect(classifyIn(p.root, ACTIVE("M120.md"), JIRA_EPIC_EPOCH)).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — exactly one exemption allow-list exists, still `scaffolding` + `legacy`", () => {
    // Cannot fail against the pre-change module by construction: it pins that
    // no SECOND exemption key was introduced for the jira arm. A jira-only
    // `kind:` value would fork the vocabulary and leave operators guessing
    // which one clears which advisory.
    const src = read(PLAN_PROBE_SRC);
    const declarations = src.match(/^(?:export )?const \w*EXEMPT\w*\b/gm) ?? [];
    expect(declarations.length).toBe(1);
    const decl = src.match(/const EXEMPT_PLAN_KINDS[^=]*=\s*\[([^\]]*)\]/);
    expect(decl).not.toBeNull();
    expect(decl![1]!.match(/"[^"]+"/g)).toEqual(['"scaffolding"', '"legacy"']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.7 — the reported incident, reproduced
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.7 — two byte-identical jira plans, 2026-08-04 and 2026-08-05", () => {
  function incidentProject(): Project {
    return makeProject({
      mode: "jira",
      plans: [
        { name: "M118.md", committedAt: INCIDENT_DAY_BEFORE },
        { name: "M119.md", committedAt: INCIDENT_DAY_OF },
      ],
    });
  }

  test("GUARD — the two plans are indistinguishable on disk, only provenance differs", () => {
    const p = incidentProject();
    try {
      const before = read(join(p.root, ACTIVE("M118.md"))).replace(/M118/g, "M<N>");
      const after = read(join(p.root, ACTIVE("M119.md"))).replace(/M119/g, "M<N>");
      expect(before).toBe(after);
      // Neither carries an `id:` — so the pre-existing tracker-mode rule, the
      // ONLY plan rule jira had, has nothing to say about either of them.
      expect(before).not.toContain("id:");
    } finally {
      p.cleanup();
    }
  });

  test("the plan from 2026-08-04 stays silent; the one from 2026-08-05 fails", async () => {
    const p = incidentProject();
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("jira");
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M119.md");
      expect(v.severity).toBe("error");
      // The grandfathered plan is named nowhere — the five extant consumer
      // plans this FR must not force-migrate would show up here first.
      expect(blobOf(report.violations)).not.toContain("M118.md");
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — the fixture is a real git repository with real commit dates", () => {
    // Fixture integrity, not behaviour: a mock would let the classification
    // pass without ever exercising the provenance query the FR is about.
    const p = incidentProject();
    try {
      expect(existsSync(join(p.root, ".git"))).toBe(true);
      const introduced = (rel: string): string =>
        git(p.root, ["log", "--diff-filter=A", "-1", "--format=%aI", "--", rel]).trim();
      const before = Date.parse(introduced(ACTIVE("M118.md")));
      const after = Date.parse(introduced(ACTIVE("M119.md")));
      expect(after - before).toBe(86_400_000);
      expect(before).toBeLessThan(Date.parse(JIRA_EPOCH_ISO));
      expect(after).toBeGreaterThanOrEqual(Date.parse(JIRA_EPOCH_ISO));
      // Both sit AFTER the mint epoch, so a probe that reused `MINT_EPOCH`
      // would flag the grandfathered one as well.
      expect(before).toBeGreaterThan(Date.parse(MINT_EPOCH));
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.8 — cross-mode invariance, against RECORDED pre-change values
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One fixture, three modes. The plan set exercises every arm at once: a legacy
 * sequential plan, a fresh sequential plan, a well-formed minted plan carrying
 * its `id:`, and an Epic-keyed plan.
 */
const CROSS_MODE_PLANS: PlanFixture[] = [
  { name: "M3.md", committedAt: LONG_BEFORE_EPOCH },
  { name: "M120.md", committedAt: AT_JIRA_EPOCH },
  { name: `${MINTED_PLAN}.md`, fm: [`id: ${VALID_ULID}`], committedAt: AT_JIRA_EPOCH },
  { name: "M_PROJ_500.md", committedAt: AT_JIRA_EPOCH },
];

// Captured by running the fixture above against the PRE-change module. These
// are literal recorded values, not a re-computation of what the code does now —
// a self-referential comparison (run both modes, assert they match each other)
// would pass against an implementation that broke both identically.
const RECORDED_LINEAR: RecordedRow[] = [
  {
    file: "specs/plan/M_F4VDTA.md",
    line: 2,
    expected: "absent",
    actual: "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA",
    severity: "error",
  },
];

const RECORDED_NONE: RecordedRow[] = [
  {
    file: "specs/plan/M120.md",
    line: 1,
    expected: "a minted M_<6-char Crockford> plan",
    actual: "sequential M120 introduced at or after the mint epoch",
    severity: "error",
  },
];

describe("AC-STE-443.8 — linear and none are byte-identical before and after", () => {
  test("GUARD — mode: linear reproduces its recorded pre-change list exactly", async () => {
    const p = makeProject({ mode: "linear", plans: CROSS_MODE_PLANS });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(rowsOf(p.root, report.violations)).toEqual(RECORDED_LINEAR);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("GUARD — mode: none reproduces its recorded pre-change list exactly", async () => {
    const p = makeProject({ mode: "none", plans: CROSS_MODE_PLANS });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(rowsOf(p.root, report.violations)).toEqual(RECORDED_NONE);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("only the jira leg moves — same fixture, all three modes, one diff", async () => {
    const linear = makeProject({ mode: "linear", plans: CROSS_MODE_PLANS });
    const none = makeProject({ mode: "none", plans: CROSS_MODE_PLANS });
    const jira = makeProject({ mode: "jira", plans: CROSS_MODE_PLANS });
    try {
      expect(rowsOf(linear.root, (await runPlanIdentityModeConditionalProbe(linear.root)).violations)).toEqual(
        RECORDED_LINEAR,
      );
      expect(rowsOf(none.root, (await runPlanIdentityModeConditionalProbe(none.root)).violations)).toEqual(
        RECORDED_NONE,
      );

      // Jira: the recorded id-absence row, PLUS one new row for the fresh
      // sequential plan — and nothing else. The legacy `M3` and the Epic-keyed
      // `M_PROJ_500` stay silent in every mode.
      const jiraRows = rowsOf(jira.root, (await runPlanIdentityModeConditionalProbe(jira.root)).violations);
      expect(jiraRows.length).toBe(RECORDED_LINEAR.length + 1);
      expect(jiraRows).toEqual(expect.arrayContaining(RECORDED_LINEAR));
      const added = jiraRows.filter((r) => !RECORDED_LINEAR.some((k) => k.file === r.file));
      expect(added.length).toBe(1);
      expect(added[0]!.file).toBe("specs/plan/M120.md");
      expect(added[0]!.severity).toBe("error");
      expect(jiraRows.map((r) => r.file)).not.toContain("specs/plan/M3.md");
      expect(jiraRows.map((r) => r.file)).not.toContain("specs/plan/M_PROJ_500.md");
    } finally {
      linear.cleanup();
      none.cleanup();
      jira.cleanup();
    }
  });

  test("GUARD — an unknown mode string is treated as a tracker, never as jira", async () => {
    // `mode: github` is not a mode this toolkit ships, but a hand-edited
    // CLAUDE.md can carry one. It must fall through to the id-absence rule
    // only — a `mode !== "linear"` branch would police it like jira.
    const p = makeProject({ mode: "linear", plans: CROSS_MODE_PLANS });
    try {
      writeFileSync(
        join(p.root, "CLAUDE.md"),
        "# Unknown-tracker fixture\n\n## Task Tracking\n\nmode: github\nmcp_server: github\n",
      );
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("github");
      expect(rowsOf(p.root, report.violations)).toEqual(RECORDED_LINEAR);
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-443.10 — no new probe; the documented count stays 74
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-443.10 — the arm ships inside probe #73, not as a probe #75", () => {
  const skill = (): string => read(GATE_CHECK_SKILL);
  const probeNumbers = (): number[] =>
    [...skill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));

  const row73 = (): string => {
    const hits = skill()
      .split("\n")
      .filter((l) => /^73\. \*\*/.test(l));
    expect(hits.length).toBe(1);
    return hits[0]!;
  };

  test("probe #73's row documents the jira arm and its epoch", () => {
    // The only way to check "documented" — a gate probe whose SKILL row omits
    // an arm is drift, and this arm cannot fire on this repository, so the row
    // is the sole human-readable evidence it exists at all.
    const r = row73();
    expect(r).toMatch(/mode: jira|`jira`/);
    expect(r).toMatch(/JIRA_EPIC_EPOCH|2026-08-05/);
  });

  test("GUARD — the rewritten row adds no line and no STE-N token", () => {
    // `skills/` sits at its STE-token ceiling with zero headroom, and this
    // SKILL is capped at 358 lines by `tests/skill-nfr-1-length.test.ts`.
    expect(skill().split("\n").length).toBeLessThanOrEqual(358);
    expect(row73()).not.toMatch(/\bAC-STE-\d+/);
    expect(row73()).not.toMatch(/\bSTE-\d+/);
  });

  test("GUARD — the highest numbered probe is still 74, with no gap", () => {
    const numbers = probeNumbers();
    expect(Math.max(...numbers)).toBe(74);
    expect(numbers.length).toBe(74);
  });

  test("GUARD — README's two probe-count pins still read 74", () => {
    const body = read(README);
    const featureLine = body.split("\n").filter((l) => /numbered `\/gate-check` probes/.test(l));
    expect(featureLine.length).toBe(1);
    expect(featureLine[0]!).toMatch(/\b74\b.*numbered/);
    const asideLine = body.split("\n").filter((l) => /which layers \d+ probes on top/.test(l));
    expect(asideLine.length).toBe(1);
    expect(asideLine[0]!).toMatch(/\b74\b\s+probes/);
  });

  test("GUARD — the module still exports exactly one probe runner", () => {
    // A second `run*Probe` export would be a new probe in all but registration.
    const runners = read(PLAN_PROBE_SRC).match(/^export async function run\w+Probe\b/gm) ?? [];
    expect(runners).toEqual(["export async function runPlanIdentityModeConditionalProbe"]);
  });

  test("GUARD — exactly one SKILL row references this probe module", () => {
    const rows = skill()
      .split("\n")
      .filter((l) => /^\d+\. \*\*/.test(l) && l.includes("plan_identity_mode_conditional"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.startsWith("73. **")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Post-review addition: the shallow-clone exposure, pinned rather than assumed.
//
// A double review of this milestone confirmed that the jira arm newly extends
// a known tracker-less limitation to a population that was previously immune.
// `git log --diff-filter=A` in a shallow clone answers with the GRAFT BOUNDARY
// commit instead of failing, so a genuinely pre-epoch plan reads as post-epoch
// and hard-fails. Under `mode: none` that was already true and documented; a
// jira project had no arm at all before this milestone, so `--depth 1` CI on
// such a project goes from clean to red.
//
// This is an accepted tradeoff, not a defect being fixed here — the provenance
// query cannot distinguish a boundary date from a real one, and deepening the
// clone from inside a gate probe would break the no-network invariant. What
// was missing was any test recording it, so the next reader could not tell the
// behaviour from an oversight. `kind: legacy` remains the operator's remedy
// and is asserted below so the documented escape hatch is known to work here.
// ---------------------------------------------------------------------------

describe("shallow clone — accepted exposure, pinned", () => {
  /** Clone `src` at depth 1 through a file:// URL, which is what makes it shallow. */
  function shallowClone(src: string): string {
    const dst = mkdtempSync(join(tmpdir(), "m120-shallow-"));
    rmSync(dst, { recursive: true, force: true });
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${src}`, dst], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    return dst;
  }

  /** Push the graft boundary past the epoch — without this the boundary is
   *  pre-epoch and the plan classifies `legacy` for the wrong reason, which is
   *  how a first attempt at this fixture silently proved nothing. */
  function advancePastEpoch(root: string): void {
    for (const day of ["06", "07", "08"]) {
      writeFileSync(join(root, "filler.txt"), `filler ${day}\n`);
      git(root, ["add", "--", "filler.txt"]);
      commitAt(root, `2026-08-${day}T09:00:00Z`, `chore: filler ${day}`);
    }
  }

  test("a pre-epoch jira plan fails at --depth 1 but passes at full depth", async () => {
    const p = makeProject({ mode: "jira", plans: [{ name: "M42.md", committedAt: "2026-07-01T12:00:00Z" }] });
    let shallow: string | null = null;
    try {
      advancePastEpoch(p.root);

      const full = await planIdentityModule.runPlanIdentityModeConditionalProbe(p.root);
      expect(full.violations.filter((v) => v.severity === "error")).toEqual([]);

      shallow = shallowClone(p.root);
      const errs = (
        await planIdentityModule.runPlanIdentityModeConditionalProbe(shallow)
      ).violations.filter((v) => v.severity === "error");
      expect(errs.length).toBe(1);
      // The epoch in the row is the jira one, not the tracker-less one — a
      // shared builder handed the wrong constant would still produce a row.
      expect(errs[0]!.message).toContain(JIRA_EPIC_EPOCH);
    } finally {
      if (shallow !== null) rmSync(shallow, { recursive: true, force: true });
      p.cleanup();
    }
  });

  test("kind: legacy clears it, so the documented remedy works in a shallow clone", async () => {
    const p = makeProject({
      mode: "jira",
      plans: [{ name: "M42.md", fm: ["kind: legacy"], committedAt: "2026-07-01T12:00:00Z" }],
    });
    let shallow: string | null = null;
    try {
      advancePastEpoch(p.root);
      shallow = shallowClone(p.root);
      const r = await planIdentityModule.runPlanIdentityModeConditionalProbe(shallow);
      expect(r.violations).toEqual([]);
    } finally {
      if (shallow !== null) rmSync(shallow, { recursive: true, force: true });
      p.cleanup();
    }
  });
});

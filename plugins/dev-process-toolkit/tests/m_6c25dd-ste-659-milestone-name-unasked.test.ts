// M_6c25dd / STE-659 — "A gate probe keeps milestone-name prompts out of the
// skills".
//
// WHAT THE IMPLEMENTER WRITES.
//
//   adapters/_shared/src/milestone_name_unasked.ts
//     export function runMilestoneNameUnaskedProbe(
//       projectRoot: string,
//       options?: { arms?: { prose?: boolean; plan?: boolean } },
//     ): Report
//
// plus an `if (import.meta.main)` front door (`bun run <module> <projectRoot>`:
// exit 1 and the violation notes on output when anything fails, exit 0 when
// clean), registry row #86 in skills/gate-check/SKILL.md, and the probe-count
// cascade 85 -> 86.
//
// THE CONTRACT (the house shape of probes #84/#85):
//
//   interface Violation {
//     file: string;      // repo-relative to projectRoot
//     line: number;      // 1-based
//     reason: string;
//     note: string;      // `<file>:<line> — <reason>`
//     message: string;   // `milestone_name_unasked: …` + `Remedy:` + `Context:`
//                        // (Context carries `probe=milestone_name_unasked`)
//     severity: "error";
//   }
//   interface Report { violations: Violation[]; notes: string[]; vacuous: boolean }
//
// TWO ARMS, read from the house layout under `projectRoot`:
//
//   * PROSE arm — every `plugins/dev-process-toolkit/skills/**/SKILL.md` under
//     projectRoot, matched against a CLOSED pattern set of prompt shapes that ask
//     the operator for a milestone name / title / codename. A line stating that
//     a name is NEVER asked is not a match.
//   * PLAN arm — every `specs/plan/*.md` (NOT `specs/plan/archive/`) whose
//     frontmatter is `status: active`, read through `readPlanCodename` from
//     `milestone_codename.ts`. A thrown refusal becomes a violation whose note
//     names the plan path and whose reason carries validateCodename's rule.
//     An absent key passes.
//
// THE MUTATION SEAM (AC.4): `options.arms.prose === false` skips the prose arm,
// `options.arms.plan === false` skips the plan arm; both default to true.
//
// The owed export is reached through `owed()`, never a named import, so a
// missing export reds one leg rather than failing module load for the file.
//
// Filter by AC with `bun test -t "AC-STE-659.N"`.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { validateCodename } from "../adapters/_shared/src/milestone_codename";

// ---------------------------------------------------------------------------
// Paths + helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const README = join(REPO_ROOT, "README.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

const PROBE_ID = "milestone_name_unasked";
const MODULE_REL = "adapters/_shared/src/milestone_name_unasked.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const TEST_FILE_REL = "tests/m_6c25dd-ste-659-milestone-name-unasked.test.ts";

const read = (p: string): string => readFileSync(p, "utf-8");

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly note: string;
  readonly message: string;
  readonly severity: string;
}

interface Report {
  readonly violations: readonly Violation[];
  readonly notes: readonly string[];
  readonly vacuous: boolean;
}

interface ProbeOptions {
  readonly arms?: { readonly prose?: boolean; readonly plan?: boolean };
}

type ProbeFn = (projectRoot: string, options?: ProbeOptions) => Report;

async function probe(): Promise<ProbeFn> {
  if (!existsSync(MODULE_ABS)) {
    throw new Error(
      `${MODULE_REL} does not exist — no probe keeps a milestone-name prompt out of the skills`,
    );
  }
  const mod = (await import(MODULE_ABS)) as Record<string, unknown>;
  const fn = mod.runMilestoneNameUnaskedProbe;
  if (typeof fn !== "function") {
    throw new Error(`${MODULE_REL} does not export \`runMilestoneNameUnaskedProbe\``);
  }
  return fn as ProbeFn;
}

/** The house violation shape, asserted in one place. */
function assertHouseShape(v: Violation, fileRel: string): void {
  expect(v.severity).toBe("error");
  expect(v.file).toBe(fileRel);
  expect(v.line).toBeGreaterThan(0);
  expect(v.reason.length).toBeGreaterThan(10);
  expect(v.note).toBe(`${fileRel}:${v.line} — ${v.reason}`);
  expect(v.message.startsWith(`${PROBE_ID}: `)).toBe(true);
  const lines = v.message.split("\n");
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
  expect(v.message).toContain(`probe=${PROBE_ID}`);
}

// ---------------------------------------------------------------------------
// Fixture tree
// ---------------------------------------------------------------------------

const SKILLS_REL = "plugins/dev-process-toolkit/skills";

interface Fixture {
  readonly root: string;
  readonly write: (rel: string, body: string) => void;
  readonly cleanup: () => void;
}

function fixture(slug: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `ste659-${slug}-`));
  return {
    root,
    write: (rel, body) => {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** 1-based line of the first line containing `needle`. Throws when absent. */
function lineOf(body: string, needle: string): number {
  const idx = body.split("\n").findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`fixture does not carry ${JSON.stringify(needle)}`);
  return idx + 1;
}

// --- PROSE fixtures (AC.1) --------------------------------------------------

/** The retired /ship-milestone prompt block, as it shipped before STE-658. */
const RETIRED_SKILL_REL = `${SKILLS_REL}/retired-prompt/SKILL.md`;
const RETIRED_NEEDLE = "Enter milestone codename";
const RETIRED_BODY = [
  "---",
  "name: retired-prompt",
  "---",
  "",
  "### 3. Codename",
  "",
  'If `--codename "<name>"` was passed, validate and use it. Otherwise prompt:',
  "",
  "```",
  'Enter milestone codename (short, memorable — e.g., "Diátaxis"):',
  "```",
  "",
  "Validate: non-empty, ≤ 32 chars, no backticks, no newlines.",
  "",
].join("\n");

const ASK_CODENAME_SKILL_REL = `${SKILLS_REL}/ask-codename/SKILL.md`;
const ASK_CODENAME_NEEDLE = "ask the user for the milestone codename";
const ASK_CODENAME_BODY = [
  "---",
  "name: ask-codename",
  "---",
  "",
  "## Step 4",
  "",
  "Use `AskUserQuestion` to ask the user for the milestone codename.",
  "",
].join("\n");

const ASK_TITLE_SKILL_REL = `${SKILLS_REL}/ask-title/SKILL.md`;
const ASK_TITLE_NEEDLE = "ask the user for the milestone title";
const ASK_TITLE_BODY = [
  "---",
  "name: ask-title",
  "---",
  "",
  "## Step 2",
  "",
  "Some unrelated prose first.",
  "",
  "Use `AskUserQuestion` to ask the user for the milestone title.",
  "",
].join("\n");

/**
 * CLEAN CONTROLS. Each line mentions the subject without prompting for it.
 * The first two are the shipped /spec-write rule's own words: a probe that
 * matched them would red the very sentence that forbids the prompt.
 */
const CLEAN_SKILL_REL = `${SKILLS_REL}/clean-controls/SKILL.md`;
const CLEAN_BODY = [
  "---",
  "name: clean-controls",
  "---",
  "",
  "**Milestone title and codename are composed, never asked.** Compose each milestone's title and its `codename:` frontmatter value from the approved design yourself; neither is ever a question for the user, and both are never asked.",
  "",
  "Use `AskUserQuestion` to ask the user which FR to implement next.",
  "",
  "The milestone codename is read from the plan's `codename:` key.",
  "",
  "Never use `AskUserQuestion` to ask for the milestone codename or title.",
  "",
].join("\n");

function plantProse(fx: Fixture): void {
  fx.write(RETIRED_SKILL_REL, RETIRED_BODY);
  fx.write(ASK_CODENAME_SKILL_REL, ASK_CODENAME_BODY);
  fx.write(ASK_TITLE_SKILL_REL, ASK_TITLE_BODY);
  fx.write(CLEAN_SKILL_REL, CLEAN_BODY);
}

const PROSE_EXPECTED: readonly { file: string; line: number }[] = [
  { file: RETIRED_SKILL_REL, line: lineOf(RETIRED_BODY, RETIRED_NEEDLE) },
  { file: ASK_CODENAME_SKILL_REL, line: lineOf(ASK_CODENAME_BODY, ASK_CODENAME_NEEDLE) },
  { file: ASK_TITLE_SKILL_REL, line: lineOf(ASK_TITLE_BODY, ASK_TITLE_NEEDLE) },
];

// --- PLAN fixtures (AC.2) ---------------------------------------------------

const TOO_LONG = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg"; // 33 characters
const WITH_BACKTICK = "Back`tick";

const planBody = (milestone: string, status: string, codenameLine: string | null): string =>
  [
    "---",
    `milestone: ${milestone}`,
    `status: ${status}`,
    "archived_at: null",
    "migration: none",
    ...(codenameLine === null ? [] : [codenameLine]),
    "---",
    "",
    "# Implementation Plan",
    "",
  ].join("\n");

const PLAN_TOO_LONG_REL = "specs/plan/M_aaaaaa.md";
const PLAN_BACKTICK_REL = "specs/plan/M_bbbbbb.md";
const PLAN_ABSENT_REL = "specs/plan/M_cccccc.md";
const PLAN_VALID_REL = "specs/plan/M_dddddd.md";
const PLAN_ARCHIVED_REL = "specs/plan/archive/M_eeeeee.md";

function plantPlans(fx: Fixture): void {
  fx.write(PLAN_TOO_LONG_REL, planBody("M_aaaaaa", "active", `codename: ${TOO_LONG}`));
  fx.write(PLAN_BACKTICK_REL, planBody("M_bbbbbb", "active", `codename: "${WITH_BACKTICK}"`));
  fx.write(PLAN_ABSENT_REL, planBody("M_cccccc", "active", null));
  fx.write(PLAN_VALID_REL, planBody("M_dddddd", "active", "codename: Unasked"));
  // Archived, active-looking, and INVALID: it must never be read.
  fx.write(PLAN_ARCHIVED_REL, planBody("M_eeeeee", "active", `codename: ${TOO_LONG}`));
}

const proseViolations = (r: Report): Violation[] =>
  r.violations.filter((v) => v.file.startsWith(`${SKILLS_REL}/`));
const planViolations = (r: Report): Violation[] =>
  r.violations.filter((v) => v.file.startsWith("specs/plan/"));

// ===========================================================================
// AC-STE-659.1 — the prose arm
// ===========================================================================

describe("AC-STE-659.1 — a prompt for a milestone name in a skill is a gate failure", () => {
  test("each planted prompt shape is reported once, naming file and line", async () => {
    const run = await probe();
    const fx = fixture("ac1-prose");
    try {
      plantProse(fx);
      const report = run(fx.root);
      const got = proseViolations(report)
        .map((v) => ({ file: v.file, line: v.line }))
        .sort((a, b) => a.file.localeCompare(b.file));
      const want = [...PROSE_EXPECTED].sort((a, b) => a.file.localeCompare(b.file));
      expect(got).toEqual(want);
      for (const v of proseViolations(report)) assertHouseShape(v, v.file);
    } finally {
      fx.cleanup();
    }
  });

  test("the clean controls — including the shipped 'never asked' rule — are NOT matches", async () => {
    const run = await probe();
    const fx = fixture("ac1-controls");
    try {
      fx.write(CLEAN_SKILL_REL, CLEAN_BODY);
      const report = run(fx.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
      // Non-vacuity: the probe saw a skills tree, so a clean verdict is a verdict.
      expect(report.vacuous).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("each shape alone reds the probe — no shape rides on another", async () => {
    const run = await probe();
    for (const [rel, body, needle] of [
      [RETIRED_SKILL_REL, RETIRED_BODY, RETIRED_NEEDLE],
      [ASK_CODENAME_SKILL_REL, ASK_CODENAME_BODY, ASK_CODENAME_NEEDLE],
      [ASK_TITLE_SKILL_REL, ASK_TITLE_BODY, ASK_TITLE_NEEDLE],
    ] as const) {
      const fx = fixture("ac1-alone");
      try {
        fx.write(rel, body);
        const notes = run(fx.root).violations.map((v) => v.note.split(" — ")[0]);
        expect({ rel, notes }).toEqual({ rel, notes: [`${rel}:${lineOf(body, needle)}`] });
      } finally {
        fx.cleanup();
      }
    }
  });

  test("the current tree returns no failure", async () => {
    const run = await probe();
    const report = run(REPO_ROOT);
    expect(report.violations.map((v) => v.note)).toEqual([]);
    expect(report.vacuous).toBe(false);
  });

  test("an empty project is vacuous, never a crash", async () => {
    const run = await probe();
    const fx = fixture("ac1-empty");
    try {
      const report = run(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test(
    "the front door RUNS: exit 1 naming the file over a planted tree, exit 0 over this repo",
    () => {
      const fx = fixture("ac1-door");
      try {
        plantProse(fx);
        const bad = Bun.spawnSync({
          cmd: ["bun", "run", MODULE_ABS, fx.root],
          cwd: PLUGIN_ROOT,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 60_000,
        });
        const badOut = `${bad.stdout.toString()}${bad.stderr.toString()}`;
        expect({ exit: bad.exitCode, names: badOut.includes(RETIRED_SKILL_REL) }).toEqual({
          exit: 1,
          names: true,
        });

        const good = Bun.spawnSync({
          cmd: ["bun", "run", MODULE_ABS, REPO_ROOT],
          cwd: PLUGIN_ROOT,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 60_000,
        });
        expect(good.exitCode).toBe(0);
      } finally {
        fx.cleanup();
      }
    },
    180_000,
  );
});

// ===========================================================================
// AC-STE-659.2 — the plan arm
// ===========================================================================

describe("AC-STE-659.2 — an active plan's invalid codename is a gate failure", () => {
  test("fixture sanity — the planted values really break validateCodename", () => {
    expect(validateCodename(TOO_LONG).ok).toBe(false);
    expect(validateCodename(WITH_BACKTICK).ok).toBe(false);
    expect(validateCodename("Unasked").ok).toBe(true);
  });

  test("each invalid active plan is reported, naming the plan path and the rule", async () => {
    const run = await probe();
    const fx = fixture("ac2-plans");
    try {
      plantPlans(fx);
      const report = run(fx.root);
      const got = planViolations(report).sort((a, b) => a.file.localeCompare(b.file));
      expect(got.map((v) => v.file)).toEqual([PLAN_TOO_LONG_REL, PLAN_BACKTICK_REL]);

      const [tooLong, backtick] = got;
      const tooLongRule = validateCodename(TOO_LONG);
      const backtickRule = validateCodename(WITH_BACKTICK);
      if (tooLongRule.ok || backtickRule.ok) throw new Error("fixture values must be invalid");
      expect(tooLong!.reason).toContain(tooLongRule.reason);
      expect(backtick!.reason).toContain(backtickRule.reason);
      for (const v of got) {
        assertHouseShape(v, v.file);
        expect(v.note.startsWith(`${v.file}:`)).toBe(true);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("an active plan with NO codename key, or a VALID one, is not a failure", async () => {
    const run = await probe();
    const fx = fixture("ac2-clean");
    try {
      fx.write(PLAN_ABSENT_REL, planBody("M_cccccc", "active", null));
      fx.write(PLAN_VALID_REL, planBody("M_dddddd", "active", "codename: Unasked"));
      const report = run(fx.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("archived plans are NOT read — an invalid one there is no failure", async () => {
    const run = await probe();
    const fx = fixture("ac2-archive");
    try {
      plantPlans(fx);
      const report = run(fx.root);
      expect(report.violations.filter((v) => v.file.includes("archive"))).toEqual([]);
      expect(report.violations.some((v) => v.note.includes("M_eeeeee"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("the live repo's active plans pass", async () => {
    const run = await probe();
    expect(planViolations(run(REPO_ROOT)).map((v) => v.note)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-659.3 — registered, and the count cascade moved as one
// ===========================================================================

function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

const liveProbeCount = (): number => probeRegistrationLines().length;

/** The count before this FR registers its probe — the number that must be gone. */
const PREVIOUS_PROBE_COUNT = 85;
/** The count after. */
const EXPECTED_PROBE_COUNT = 86;

/**
 * Every surface pinning the probe count, as `[plugin-relative path or
 * README.md / docs path, template]`. STE-558's table plus the STE-558 suite's
 * own pins and the two docs/workflow-overview.md enumerations.
 */
const PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],

  ["docs/workflow-overview.md", "+ {N} probes"],
  ["docs/workflow-overview.md", "| {N} conformance probes"],

  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`README documents {N} probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`documents {N} numbered /gate-check probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-runnability-declared.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],

  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`layers {N} probes`],

  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`"{N} numbered"`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b.*numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+numbered`],

  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`exactly {N} probes`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-535-plan-narrative-cap.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-535-plan-narrative-cap.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`expect(live).toBe({N});`],

  ["tests/m140-ste-543-external-link-verdicts.test.ts", String.raw`const NEW_PROBE_COUNT = {N};`],
  ["tests/m140-ste-543-external-link-verdicts.test.ts", String.raw`contiguous 1..{N}`],

  ["tests/m141-ste-546-surface-agreement.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/m141-ste-546-surface-agreement.test.ts", String.raw`).toBe({N});`],
  ["tests/m141-ste-546-surface-agreement.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/m_8f8e25-ste-558-scanner-registration.test.ts", String.raw`const NEW_PROBE_COUNT = {N};`],
] as const;

const fill = (template: string, n: number): string => template.split("{N}").join(String(n));

const surfaceAbs = (rel: string): string =>
  rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/"));

describe("AC-STE-659.3 — registered as probe #86, every count pin moved with it", () => {
  test("the registry is contiguous 1..86", () => {
    expect(liveProbeCount()).toBe(EXPECTED_PROBE_COUNT);
    expect(probeRegistrationLines().map((r) => r.number)).toEqual(
      Array.from({ length: EXPECTED_PROBE_COUNT }, (_, i) => i + 1),
    );
  });

  test("probe #86 is `milestone_name_unasked`, in the house idiom", () => {
    const hits = probeRegistrationLines().filter((r) => r.line.includes(MODULE_REL));
    expect(hits.length).toBe(1);
    const row = hits[0]!;
    expect(row.number).toBe(EXPECTED_PROBE_COUNT);
    expect(row.line.startsWith(`${EXPECTED_PROBE_COUNT}. **\`${PROBE_ID}\`**`)).toBe(true);
    expect(row.line).toContain("runMilestoneNameUnaskedProbe(projectRoot)");
    expect(row.line).toContain("**Severity: error**");
    expect(row.line).toContain("readPlanCodename");
    expect(row.line).toContain("vacuous");
    expect(row.line).toContain(TEST_FILE_REL);
  });

  test("the registration's probe id is the one its messages carry", async () => {
    const run = await probe();
    const fx = fixture("ac3-id");
    try {
      plantProse(fx);
      const report = run(fx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      for (const v of report.violations) {
        expect(v.message.startsWith(`${PROBE_ID}: `)).toBe(true);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("EVERY enumerated pin reads 86 — and none still reads 85", () => {
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      const body = read(surfaceAbs(rel));
      if (!body.includes(fill(template, EXPECTED_PROBE_COUNT))) {
        missing.push(`${rel} — ${fill(template, EXPECTED_PROBE_COUNT)}`);
      }
      if (body.includes(fill(template, PREVIOUS_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, PREVIOUS_PROBE_COUNT)}`);
      }
    }
    expect(PINS.length).toBeGreaterThanOrEqual(55);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every named surface EXISTS — a pin on a deleted file is not a pin", () => {
    for (const [rel] of PINS) {
      expect({ rel, exists: existsSync(surfaceAbs(rel)) }).toEqual({ rel, exists: true });
    }
  });

  test("the front-door warning names the NEXT unregistered number (#87), in both places", () => {
    const next = liveProbeCount() + 1;
    expect(next).toBe(EXPECTED_PROBE_COUNT + 1);
    const skill = read(GATE_CHECK_SKILL);
    expect(skill).toContain(`registering probe #${next} will turn probe #81 red`);
    expect(skill).not.toContain("registering probe #86 will turn probe #81 red");
    const m140 = read(surfaceAbs("tests/m140-ste-543-external-link-verdicts.test.ts"));
    expect(m140).toContain(`registering probe #${next} will turn probe #81 red`);
  });

  test("M141's `no NEXT row` tripwire moved to #87", () => {
    const body = read(surfaceAbs("tests/m141-ste-546-surface-agreement.test.ts"));
    expect(body).toContain(String.raw`/^87\. \*\*/m`);
    expect(body).not.toContain(String.raw`/^86\. \*\*/m`);
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-659.4 — mutation control: each arm is load-bearing for its own legs
// ===========================================================================

describe("AC-STE-659.4 — disabling an arm reds exactly that arm's legs", () => {
  test("baseline: both arms on, the combined fixture reds BOTH arms", async () => {
    const run = await probe();
    const fx = fixture("ac4-baseline");
    try {
      plantProse(fx);
      plantPlans(fx);
      const report = run(fx.root, { arms: { prose: true, plan: true } });
      expect(proseViolations(report).length).toBe(PROSE_EXPECTED.length);
      expect(planViolations(report).length).toBe(2);
      // Defaults are both-on: no options is the same verdict.
      expect(run(fx.root).violations.length).toBe(report.violations.length);
    } finally {
      fx.cleanup();
    }
  });

  test("prose arm OFF: the AC.1 legs go red (no prose failures), plan arm unchanged", async () => {
    const run = await probe();
    const fx = fixture("ac4-prose-off");
    try {
      plantProse(fx);
      plantPlans(fx);
      const report = run(fx.root, { arms: { prose: false } });
      // The AC.1 leg's expectation no longer holds — that is the mutation biting.
      expect(proseViolations(report).length).not.toBe(PROSE_EXPECTED.length);
      expect(proseViolations(report)).toEqual([]);
      // Sibling stays green over the same tree.
      expect(planViolations(report).map((v) => v.file).sort()).toEqual(
        [PLAN_TOO_LONG_REL, PLAN_BACKTICK_REL].sort(),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("plan arm OFF: the AC.2 legs go red (no plan failures), prose arm unchanged", async () => {
    const run = await probe();
    const fx = fixture("ac4-plan-off");
    try {
      plantProse(fx);
      plantPlans(fx);
      const report = run(fx.root, { arms: { plan: false } });
      expect(planViolations(report)).toEqual([]);
      expect(
        proseViolations(report)
          .map((v) => v.file)
          .sort(),
      ).toEqual(PROSE_EXPECTED.map((e) => e.file).sort());
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// M_6c25dd Phase 3 hardening (audit findings on AC-STE-659.1): a negation
// clears only the ask it governs, and an AskUserQuestion name prompt is a shape.
// ---------------------------------------------------------------------------

describe("hardening — a negation clears only the ask it governs", () => {
  const SKILL_REL = `${SKILLS_REL}/scoped-negation/SKILL.md`;
  const cases: readonly { body: string; flagged: boolean }[] = [
    { body: "Ask the user for the milestone codename (no backticks).", flagged: true },
    { body: "Use `AskUserQuestion` to request the milestone codename.", flagged: true },
    { body: "Call AskUserQuestion with the milestone title as its only question.", flagged: true },
    { body: "Never ask the user for the milestone codename.", flagged: false },
    { body: "Do not prompt for the milestone title.", flagged: false },
    { body: "Never use `AskUserQuestion` to ask for the milestone codename or title.", flagged: false },
    { body: "Use `AskUserQuestion` to ask the user which FR to implement next.", flagged: false },
  ];

  for (const { body, flagged } of cases) {
    test(`${flagged ? "flags" : "clears"}: ${body}`, async () => {
      const run = await probe();
      const fx = fixture("scoped");
      try {
        fx.write(SKILL_REL, ["---", "name: scoped-negation", "---", "", body, ""].join("\n"));
        const report = await run(fx.root, { arms: { plan: false } });
        const hits = proseViolations(report);
        expect(hits.length, JSON.stringify(hits)).toBe(flagged ? 1 : 0);
        if (flagged) assertHouseShape(hits[0]!, SKILL_REL);
      } finally {
        fx.cleanup();
      }
    });
  }
});

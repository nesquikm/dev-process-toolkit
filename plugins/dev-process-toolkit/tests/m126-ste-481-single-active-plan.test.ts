// M126 STE-481 — one active plan file per tracker-less project after
// `/setup` then `/spec-write`.
//
// THE DEFECT (measured, v2.65.0). `/setup` step 8 scaffolds
// `specs/plan/M1.md` carrying `kind: scaffolding`. `/spec-write`'s
// tracker-less minted branch then mints `M_<short-ULID>` and writes a SECOND
// plan file beside it. The project carries two active plans under two naming
// schemes, and nothing goes red because probe #73's `kind: scaffolding`
// exemption (`EXEMPT_PLAN_KINDS` in `plan_identity_mode_conditional.ts`)
// silences the sequential one — the exemption is what hides the duplicate.
//
// THE DIRECTION PINNED HERE: **CONSUME THE SCAFFOLD AT MINT TIME**, the FR's
// stated preference, not "do not scaffold at all under `mode: none`". Three
// pieces of evidence, all re-measured against the tree:
//
//   1. The seeded content is NOT pure boilerplate. `/setup` step 8 is told to
//      "Pre-fill with concrete values … plan.md: M1 skeleton for the
//      foundation just built, with concrete file paths and gate commands",
//      and the bootstrap-milestone routing writes a single `<scaffolding>` FR
//      row recording the pre-toolkit foundation. Deleting the scaffold on the
//      tracker-less path would throw both away.
//   2. That `<scaffolding>` row is READ downstream —
//      `adapters/_shared/src/plan_only_archival.ts` routes it through
//      plan-only closure (STE-200) and `tracker_local_reconciliation_drift.ts`
//      drops scaffolding plans from drift reporting. It is live vocabulary,
//      not decoration.
//   3. `skills/setup/SKILL.md`'s class-(5) inventory calls `specs/plan/M1.md`
//      a deliverable "emitted unconditionally" and the scaffold list
//      "non-negotiable". Not scaffolding under `mode: none` would falsify that
//      shipped claim — trading one untrue surface (AC.3's complaint) for
//      another — and would need a prose edit to a SKILL.md that is already at
//      358 of its 358-line cap. Consuming leaves that inventory true as
//      written.
//
// THE SHAPE THE IMPLEMENTER MUST BUILD (new module,
// `adapters/_shared/src/consume_scaffold_plan.ts`):
//
//   findScaffoldPlan(specsDir): string | null
//     The single ACTIVE plan under `<specsDir>/plan/` whose frontmatter
//     declares `kind: scaffolding`, or null. `<specsDir>/plan/archive/` is out
//     of scope. `kind:` is read through `normalizeFrontmatterSource`, so
//     CRLF/BOM sources resolve like any other (the recurring blind spot).
//
//   consumeScaffoldPlan(specsDir, identity): ScaffoldConsumption
//     identity is the `{ milestoneId, id? }` that `resolveMilestoneIdentity`
//     returns. `id` is present on the `mode: none` branch ALONE, so gating the
//     consumption on it makes consuming a tracker-mode scaffold structurally
//     impossible rather than merely discouraged.
//       - no `id` (tracker mode)  ⇒ { consumed: false, from: null, to } and
//                                    the scaffold is untouched on disk.
//       - no scaffold             ⇒ { consumed: false, from: null, to } and
//                                    `to` is NOT created — the caller writes a
//                                    fresh plan there.
//       - scaffold + `id`         ⇒ rename in place to `<milestoneId>.md`,
//                                    rewriting frontmatter: `milestone:` to the
//                                    minted token, `id:` recorded verbatim,
//                                    the `kind: scaffolding` line dropped. The
//                                    body below the frontmatter survives
//                                    byte-for-byte — that IS the preservation
//                                    this direction was chosen for.
//       - `<milestoneId>.md` already present ⇒ throw. Never clobber a plan.
//
// AND THE PROBE NARROWING (AC.4). `kind: scaffolding` keeps exempting a lone
// bootstrap plan — retiring it outright would hard-fail every freshly
// bootstrapped project on its own `/setup` output. What it must STOP doing is
// papering over the duplicate: under `mode: none`, an active `kind:
// scaffolding` sequential plan sitting beside an active MINTED plan is an
// unconsumed scaffold and an error-severity violation. Probe #73 keeps its
// number, its identity, and its `kind: legacy` escape hatch.
//
// AC map:
//   AC-STE-481.1 — setup-then-spec-write under `mode: none` ⇒ exactly one
//                  active plan file.
//   AC-STE-481.2 — the survivor is `M_<short-ULID>` carrying the derived
//                  `id:`, and probe #73 reports clean.
//   AC-STE-481.3 — every prose surface describing the plan filename is true
//                  as written after the change (and the two shipped SKILLs at
//                  their line cap stay at it).
//   AC-STE-481.4 — the `kind: scaffolding` exemption is narrowed, not retired.
//   AC-STE-481.5 — restoring the double-write goes RED, through the same
//                  assertion AC.1 passes.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { runPlanIdentityModeConditionalProbe } from "../adapters/_shared/src/plan_identity_mode_conditional";
import { resolveMilestoneIdentity } from "../adapters/_shared/src/resolve_milestone_identity";
import { ULID_REGEX } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const CONSUME_SRC = join(SHARED_SRC, "consume_scaffold_plan.ts");
const SETUP_SKILL = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const PLAN_TEMPLATE = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

const read = (path: string): string => readFileSync(path, "utf-8");

/** NFR-1, counted exactly as `tests/skill-nfr-1-length.test.ts` counts it. */
const SKILL_LINE_CAP = 358;
const skillLines = (path: string): number => read(path).split("\n").length;

/** The `skills/` tracker-token ceiling — measured at 246/246, zero headroom. */
const SKILLS_STE_TOKEN_CEILING = 246;
const NAMESPACE_TOKEN = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;

function countNamespaceTokens(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) total += countNamespaceTokens(p);
    else if (entry.endsWith(".md")) total += (read(p).match(NAMESPACE_TOKEN) ?? []).length;
  }
  return total;
}

// ───────────────────────────────────────────────────────────────────────────
// The module under construction — loaded lazily and by absolute path.
//
// A top-level `import` of a file that does not exist yet fails the WHOLE test
// module, collapsing the prose pins (AC.3) and the probe pins (AC.4) into one
// undifferentiated load error. Loading on demand keeps each AC independently
// reportable while the module is still missing, which is the only way this
// file's RED is readable as an AC map rather than as a single stack trace.
// ───────────────────────────────────────────────────────────────────────────

interface ScaffoldConsumption {
  consumed: boolean;
  /** Absolute path of the consumed scaffold, or null when nothing was consumed. */
  from: string | null;
  /** Absolute path of this milestone's plan file — created only when consumed. */
  to: string;
}

interface ConsumeScaffoldModule {
  findScaffoldPlan(specsDir: string): string | null;
  consumeScaffoldPlan(
    specsDir: string,
    identity: { milestoneId: string; id?: string },
  ): ScaffoldConsumption;
}

async function loadConsumeModule(): Promise<ConsumeScaffoldModule> {
  if (!existsSync(CONSUME_SRC)) {
    throw new Error(
      `${relative(REPO_ROOT, CONSUME_SRC)} does not exist — /spec-write's tracker-less ` +
        `minted branch has nothing to call, so the /setup scaffold is never consumed and ` +
        `specs/plan/ keeps two active plans.`,
    );
  }
  const mod = (await import(CONSUME_SRC)) as Partial<ConsumeScaffoldModule>;
  for (const fn of ["findScaffoldPlan", "consumeScaffoldPlan"] as const) {
    if (typeof mod[fn] !== "function") {
      throw new Error(`${relative(REPO_ROOT, CONSUME_SRC)} does not export ${fn}()`);
    }
  }
  return mod as ConsumeScaffoldModule;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — real temporary projects, and real git repositories where a
// provenance answer is load-bearing (probe #73 dates sequential plans).
// ───────────────────────────────────────────────────────────────────────────

/**
 * A line only `/setup` could have written. Its survival is how "the scaffold
 * was CONSUMED" is told apart from "the scaffold was deleted and a fresh plan
 * written at the minted name" — the two produce an identical file COUNT, so a
 * count-only assertion cannot distinguish the direction this FR chose.
 */
const SEEDED_MARKER = "verify: bun test src/barrel.test.ts";
const BOOTSTRAP_ROW = "| <scaffolding> | Bootstrap (barrel + primary feature shipped pre-toolkit) | n/a |";

/** Mirrors `/setup` step 8's bootstrap-milestone routing (STE-197 AC-STE-197.3). */
function scaffoldPlanSource(): string {
  return [
    "---",
    "milestone: M1",
    "status: active",
    "archived_at: null",
    "kind: scaffolding",
    "---",
    "",
    "# Implementation Plan",
    "",
    "## M1 — Foundation / Scaffolding {#M1}",
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

function mintedPlanSource(identity: { milestoneId: string; id?: string }): string {
  return [
    "---",
    `milestone: ${identity.milestoneId}`,
    "status: active",
    "archived_at: null",
    `id: ${identity.id}`,
    "---",
    "",
    `# ${identity.milestoneId} — Fresh milestone`,
    "",
  ].join("\n");
}

function claudeMd(mode: "none" | "linear" | "jira"): string {
  return `# Fixture project\n\n## Task Tracking\n\nmode: ${mode}\n`;
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

/** Comfortably after `MINT_EPOCH` (2026-07-26) — a plan committed here is `fresh`. */
const AFTER_MINT_EPOCH = "2026-08-16T12:00:00Z";

interface Project {
  root: string;
  specsDir: string;
  cleanup: () => void;
}

/**
 * A project as `/setup` leaves it: `specs/plan/{,archive/}` plus the
 * `kind: scaffolding` bootstrap plan.
 */
function setupProject(opts: {
  mode?: "none" | "linear" | "jira";
  /** Omit the scaffold entirely — a project bootstrapped before step 8 ran. */
  scaffold?: boolean;
  /** Raw override for the scaffold bytes (CRLF / BOM cases). */
  scaffoldRaw?: string;
  /** Initialise a git repo and commit the scaffold at this instant. */
  committedAt?: string;
} = {}): Project {
  const root = mkdtempSync(join(tmpdir(), "ste481-plan-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMd(opts.mode ?? "none"));
  writeFileSync(join(root, "README.md"), "# Fixture\n");

  if (opts.scaffold !== false) {
    writeFileSync(join(specsDir, "plan", "M1.md"), opts.scaffoldRaw ?? scaffoldPlanSource());
  }

  if (opts.committedAt !== undefined) {
    git(root, ["init", "-q", "."]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "Fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: bootstrap dev-process-toolkit"], {
      GIT_AUTHOR_DATE: opts.committedAt,
      GIT_COMMITTER_DATE: opts.committedAt,
    });
  }

  return { root, specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Every ACTIVE plan file — `specs/plan/*.md`, `archive/` deliberately excluded. */
function activePlanFiles(specsDir: string): string[] {
  return readdirSync(join(specsDir, "plan"))
    .filter((n) => n.endsWith(".md"))
    .sort();
}

/**
 * AC-STE-481.1's assertion, extracted so AC.5's mutation leg can prove THE
 * SAME assertion goes red. A pin asserted in one shape and mutated in another
 * proves nothing about the pin.
 */
function assertExactlyOneActivePlan(specsDir: string): string {
  const plans = activePlanFiles(specsDir);
  if (plans.length !== 1) {
    throw new Error(
      `expected exactly one active plan file under specs/plan/, found ${plans.length}: ` +
        `${plans.join(", ")}`,
    );
  }
  return plans[0]!;
}

/**
 * `/spec-write`'s tracker-less minted branch, driven through the real modules:
 * resolve the identity, consume the scaffold if there is one, otherwise write
 * a fresh plan at the minted name. No `claude -p`; every step is a module call.
 */
async function specWriteMint(
  project: Project,
  mod: ConsumeScaffoldModule,
): Promise<{ identity: { milestoneId: string; id?: string }; outcome: ScaffoldConsumption }> {
  const identity = await resolveMilestoneIdentity({ specsDir: project.specsDir, mode: "none" });
  const outcome = mod.consumeScaffoldPlan(project.specsDir, identity);
  if (!outcome.consumed) writeFileSync(outcome.to, mintedPlanSource(identity));
  return { identity, outcome };
}

/** The `M_<6-char Crockford tail>` shape `milestoneIdFromUlid` derives. */
const MINTED_PLAN_RE = /^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/;

function frontmatterOf(raw: string): string {
  const body = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const norm = body.split("\r\n").join("\n");
  const close = norm.indexOf("\n---", 4);
  return close < 0 ? "" : norm.slice(4, close);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-481.1 — exactly one active plan after setup-then-spec-write
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-481.1 — `/setup` then `/spec-write` under `mode: none` leaves ONE active plan", () => {
  test("specs/plan/ holds exactly one active plan file", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      // Precondition: /setup really did leave its scaffold behind.
      expect(activePlanFiles(project.specsDir)).toEqual(["M1.md"]);

      await specWriteMint(project, mod);

      const survivor = assertExactlyOneActivePlan(project.specsDir);
      expect(survivor).not.toBe("M1.md");
    } finally {
      project.cleanup();
    }
  });

  test("the scaffold is CONSUMED, not deleted — its seeded content survives", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      const { outcome } = await specWriteMint(project, mod);

      expect(outcome.consumed).toBe(true);
      expect(outcome.from).toBe(join(project.specsDir, "plan", "M1.md"));
      expect(existsSync(outcome.from!)).toBe(false);
      expect(existsSync(outcome.to)).toBe(true);

      const survivorBody = read(outcome.to);
      // The two things only /setup could have put there. A delete-and-recreate
      // implementation passes the file COUNT and fails here, which is exactly
      // the distinction the FR's chosen direction rests on.
      expect(survivorBody).toContain(SEEDED_MARKER);
      expect(survivorBody).toContain(BOOTSTRAP_ROW);
    } finally {
      project.cleanup();
    }
  });

  test("with no scaffold on disk the caller still gets exactly one plan", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject({ scaffold: false });
    try {
      const { outcome } = await specWriteMint(project, mod);

      expect(outcome.consumed).toBe(false);
      expect(outcome.from).toBeNull();
      assertExactlyOneActivePlan(project.specsDir);
    } finally {
      project.cleanup();
    }
  });

  test("consumeScaffoldPlan does NOT create the target when nothing is consumed", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject({ scaffold: false });
    try {
      const outcome = mod.consumeScaffoldPlan(project.specsDir, {
        milestoneId: "M_F4VDTA",
        id: "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA",
      });
      // Minting names a plan file; it never creates one. The caller writes it.
      expect(outcome.consumed).toBe(false);
      expect(existsSync(outcome.to)).toBe(false);
      expect(activePlanFiles(project.specsDir)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("a scaffold whose frontmatter is CRLF + BOM is still found and consumed", async () => {
    const mod = await loadConsumeModule();
    const raw = `﻿${scaffoldPlanSource().split("\n").join("\r\n")}`;
    const project = setupProject({ scaffoldRaw: raw });
    try {
      expect(mod.findScaffoldPlan(project.specsDir)).toBe(
        join(project.specsDir, "plan", "M1.md"),
      );
      const { outcome } = await specWriteMint(project, mod);
      expect(outcome.consumed).toBe(true);
      assertExactlyOneActivePlan(project.specsDir);
    } finally {
      project.cleanup();
    }
  });

  test("an ARCHIVED scaffolding plan is out of scope — archive/ is not `active`", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject({ scaffold: false });
    try {
      writeFileSync(join(project.specsDir, "plan", "archive", "M1.md"), scaffoldPlanSource());

      expect(mod.findScaffoldPlan(project.specsDir)).toBeNull();
      await specWriteMint(project, mod);
      assertExactlyOneActivePlan(project.specsDir);
      // The archived plan is untouched.
      expect(existsSync(join(project.specsDir, "plan", "archive", "M1.md"))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  test("consuming never clobbers an existing plan at the minted name", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      const taken = join(project.specsDir, "plan", "M_F4VDTA.md");
      writeFileSync(taken, "---\nmilestone: M_F4VDTA\n---\n\n# taken\n");

      expect(() =>
        mod.consumeScaffoldPlan(project.specsDir, {
          milestoneId: "M_F4VDTA",
          id: "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA",
        }),
      ).toThrow();
      expect(read(taken)).toContain("# taken");
      expect(existsSync(join(project.specsDir, "plan", "M1.md"))).toBe(true);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-481.2 — the survivor is the minted form and carries the `id:` key
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-481.2 — the surviving plan is `M_<short-ULID>` carrying its minted `id:`", () => {
  test("the survivor's name is the minted form and derives from the recorded id", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      const { identity } = await specWriteMint(project, mod);
      const survivor = assertExactlyOneActivePlan(project.specsDir);

      expect(survivor).toMatch(MINTED_PLAN_RE);
      expect(survivor).toBe(`${identity.milestoneId}.md`);

      const fm = frontmatterOf(read(join(project.specsDir, "plan", survivor)));
      const idLine = /^id:\s*(\S+)\s*$/m.exec(fm);
      expect(idLine).not.toBeNull();
      const recorded = idLine![1]!;
      expect(recorded).toMatch(ULID_REGEX);
      expect(recorded).toBe(identity.id);
      // The filename IS the 6-char tail of the recorded id — probe #73's rule.
      expect(`${milestoneIdFromUlid(recorded)}.md`).toBe(survivor);
      // And `milestone:` follows the rename rather than still saying `M1`.
      expect(fm).toMatch(new RegExp(`^milestone:\\s*${identity.milestoneId}\\s*$`, "m"));
    } finally {
      project.cleanup();
    }
  });

  test("the consumed plan no longer declares `kind: scaffolding`", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      await specWriteMint(project, mod);
      const survivor = assertExactlyOneActivePlan(project.specsDir);
      const fm = frontmatterOf(read(join(project.specsDir, "plan", survivor)));

      // Not merely "not scaffolding" — the key is gone. A minted plan that kept
      // it would re-enter the exemption the moment anything re-classified it.
      expect(fm).not.toMatch(/^kind:/m);
    } finally {
      project.cleanup();
    }
  });

  test("probe #73 reports zero violations on the post-`/spec-write` tree", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject();
    try {
      await specWriteMint(project, mod);
      const report = await runPlanIdentityModeConditionalProbe(project.root);

      expect(report.mode).toBe("none");
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-481.3 — no surface claims a state the code cannot produce
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-481.3 — the shipped prose about the plan filename is true as written", () => {
  const SMOKE_CLAIM =
    "The plan file's name is mode-dependent: `plan/M1.md` in tracker mode, " +
    "`plan/M_<TAIL>.md` on the tracker-less path";

  test("the smoke-test Phase 4 row still makes a mode-dependent plan-filename claim", () => {
    // `.claude/skills/smoke-test/SKILL.md` is off-limits to this change, so the
    // row is left alone. What is asserted is deliberately NOT the full sentence
    // verbatim: this FR makes the row's tracker-LESS half true and its linear
    // half true, but its tracker half is over-general — the Epic-first jira
    // branch writes `plan/M_<epic-key>.md`, and probe #73's jira arm ERRORS on a
    // fresh sequential `M<N>` plan, so `plan/M1.md` is a state the jira path
    // cannot produce. That falsity predates this FR (it arrived with the jira
    // Epic work), and correcting it belongs with the other deferred smoke-test
    // repairs in the next milestone. Pinning the whole sentence byte-for-byte
    // would turn that correction into a regression — a stale claim actively
    // maintained. So the pin holds only the half this FR is answerable for.
    const body = read(SMOKE_SKILL);
    expect(body).toContain("The plan file's name is mode-dependent");
    expect(body).toContain("`plan/M_<TAIL>.md` on the tracker-less path");
  });

  test("the jira arm names an Epic-keyed plan shape, which is what makes the row over-general", () => {
    // Evidence for the paragraph above, read off the shipped probe rather than
    // asserted in a comment: probe #73's jira arm knows about an Epic-keyed
    // `M_<epic-key>` plan filename. A mode whose canonical plan name is
    // Epic-keyed is a mode for which "`plan/M1.md` in tracker mode" is not true,
    // which is the whole of the deferred correction.
    const probe = read(
      join(PLUGIN_ROOT, "adapters/_shared/src/plan_identity_mode_conditional.ts"),
    );
    expect(probe).toContain("jira");
    expect(probe.toLowerCase()).toContain("epic");
  });

  test("the tracker-mode half of that claim holds: `plan/M1.md` survives", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject({ mode: "linear" });
    try {
      const identity = await resolveMilestoneIdentity({
        specsDir: project.specsDir,
        mode: "linear",
      });
      expect(identity.id).toBeUndefined();

      const outcome = mod.consumeScaffoldPlan(project.specsDir, identity);
      // No minted `id` ⇒ nothing to consume WITH. Tracker mode keeps M1.md.
      expect(outcome.consumed).toBe(false);
      expect(outcome.from).toBeNull();
      expect(existsSync(join(project.specsDir, "plan", "M1.md"))).toBe(true);
      expect(read(join(project.specsDir, "plan", "M1.md"))).toContain("kind: scaffolding");
    } finally {
      project.cleanup();
    }
  });

  test("the tracker-less half holds: the ONLY active plan is `plan/M_<TAIL>.md`", async () => {
    const mod = await loadConsumeModule();
    const project = setupProject({ mode: "none" });
    try {
      await specWriteMint(project, mod);
      expect(activePlanFiles(project.specsDir)).toHaveLength(1);
      expect(activePlanFiles(project.specsDir)[0]).toMatch(MINTED_PLAN_RE);
    } finally {
      project.cleanup();
    }
  });

  test("`/spec-write`'s tracker-less branch names the consumption step + its module", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    const branch = lines.filter((l) => l.includes("Tracker-less minted branch"));
    expect(branch).toHaveLength(1);
    const row = branch[0]!;

    expect(row).toContain("consumeScaffoldPlan");
    expect(row).toContain("adapters/_shared/src/consume_scaffold_plan.ts");
    expect(row).toMatch(/scaffold/i);
  });

  test("`/setup`'s class-(5) inventory still promises `specs/plan/M1.md` unconditionally", () => {
    // The consume direction is chosen precisely so this stays true. A "do not
    // scaffold under mode: none" implementation falsifies it, which is the same
    // untrue-surface defect AC.3 exists to close.
    const body = read(SETUP_SKILL);
    expect(body).toContain("`specs/plan/M1.md`");
    expect(body).toContain("emitted unconditionally");
    expect(body).toContain("The scaffold list is non-negotiable");
  });

  test("the plan template stops promising `kind: scaffolding` silences the probe forever", () => {
    // WHITESPACE-NORMALISED, because the template hard-wraps this sentence
    // across two source lines: a raw `toContain` on the flowing prose can never
    // match and would pass vacuously whether or not the claim was fixed.
    const flowed = read(PLAN_TEMPLATE).replace(/\s+/g, " ");
    expect(flowed).toContain("kind: scaffolding"); // non-vacuity: the subject is here

    // The narrowed exemption makes this sentence false for `scaffolding` (it
    // stays true for `legacy`), so the template must be reworded.
    expect(flowed).not.toContain(
      "`kind: legacy` — or `kind: scaffolding` — in the frontmatter above and the probe goes silent for it permanently",
    );

    // …and reworded to say what now happens: the scaffold is consumed at mint
    // time. Proximity-scoped on purpose — the template already says "consumer
    // migration" in its `migration:` frontmatter comment, ~1.8k characters
    // away, so a bare /consum/ grep would pass on prose about something else.
    const consumeNearScaffold = [...flowed.matchAll(/consum\w*/gi)].some((m) => {
      const at = m.index ?? 0;
      return /scaffold/i.test(flowed.slice(Math.max(0, at - 160), at + 160));
    });
    expect(consumeNearScaffold).toBe(true);
  });

  test("probe #73's gate-check row documents the narrowed exemption", () => {
    const row = read(GATE_CHECK_SKILL)
      .split("\n")
      .find((l) => l.startsWith("73. **`plan_identity_mode_conditional`**"));
    expect(row).toBeDefined();
    expect(row!).toContain("scaffolding");
    expect(row!).toMatch(/consum\w*|unconsumed|no longer exempt|narrow\w*/i);
  });

  test("NFR-1 — every edited SKILL.md stays at or under the 358-line cap", () => {
    // setup + spec-write are AT 358/358: any prose landed there must be
    // net-zero-line, carried on an existing line.
    expect(skillLines(SETUP_SKILL)).toBeLessThanOrEqual(SKILL_LINE_CAP);
    expect(skillLines(SPEC_WRITE_SKILL)).toBeLessThanOrEqual(SKILL_LINE_CAP);
    expect(skillLines(GATE_CHECK_SKILL)).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("the `skills/` tracker-token ceiling is not breached by the new prose", () => {
    // 246/246, zero headroom — new SKILL prose cites modules and probe numbers,
    // never an `STE-<N>` / `AC-STE-<N>` token.
    expect(countNamespaceTokens(join(PLUGIN_ROOT, "skills"))).toBe(SKILLS_STE_TOKEN_CEILING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-481.4 — the `kind: scaffolding` exemption is NARROWED, not retired
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-481.4 — probe #73 no longer papers over an unconsumed scaffold", () => {
  test("an active scaffolding plan beside an active MINTED plan is an error violation", async () => {
    // A real git repo committed AFTER the mint epoch: without the exemption the
    // sequential plan would classify `fresh` anyway, so the fixture cannot pass
    // by accident of provenance.
    const project = setupProject({ committedAt: AFTER_MINT_EPOCH });
    try {
      const id = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
      const milestoneId = milestoneIdFromUlid(id);
      writeFileSync(
        join(project.specsDir, "plan", `${milestoneId}.md`),
        mintedPlanSource({ milestoneId, id }),
      );

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      const rows = report.violations.filter((v) => v.file.endsWith("M1.md"));

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.severity).toBe("error");
      expect(report.severity).toBe("error");
      expect(rows[0]!.message).toMatch(/scaffold/i);
      expect(rows[0]!.note).toContain("specs/plan/M1.md");
    } finally {
      project.cleanup();
    }
  });

  test("a LONE scaffolding plan is still exempt — narrowed, not retired", async () => {
    // Same post-epoch git provenance. Retiring the exemption outright would
    // hard-fail every freshly bootstrapped project on its own /setup output.
    const project = setupProject({ committedAt: AFTER_MINT_EPOCH });
    try {
      expect(activePlanFiles(project.specsDir)).toEqual(["M1.md"]);
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("`kind: legacy` beside a minted plan stays silent — only scaffolding narrows", async () => {
    const project = setupProject({
      committedAt: AFTER_MINT_EPOCH,
      scaffoldRaw: scaffoldPlanSource().replace("kind: scaffolding", "kind: legacy"),
    });
    try {
      const id = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
      const milestoneId = milestoneIdFromUlid(id);
      writeFileSync(
        join(project.specsDir, "plan", `${milestoneId}.md`),
        mintedPlanSource({ milestoneId, id }),
      );

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("an ARCHIVED scaffolding plan beside a minted plan stays silent", async () => {
    const project = setupProject({ scaffold: false, committedAt: AFTER_MINT_EPOCH });
    try {
      const id = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
      const milestoneId = milestoneIdFromUlid(id);
      writeFileSync(join(project.specsDir, "plan", "archive", "M1.md"), scaffoldPlanSource());
      writeFileSync(
        join(project.specsDir, "plan", `${milestoneId}.md`),
        mintedPlanSource({ milestoneId, id }),
      );

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("tracker mode is untouched — M1 scaffolding beside M2 is not policed", async () => {
    const project = setupProject({ mode: "linear", committedAt: AFTER_MINT_EPOCH });
    try {
      writeFileSync(
        join(project.specsDir, "plan", "M2.md"),
        "---\nmilestone: M2\nstatus: active\narchived_at: null\n---\n\n# M2\n",
      );
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.mode).toBe("linear");
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  // The test above names the mode guard but cannot fail on it: its fixture has
  // no MINTED plan, so the co-presence pass finds nothing to pair regardless of
  // what the mode guard says. Removing both `!isTracker` guards left it green.
  // These two legs supply the missing variable — a real `M_<6-char>` plan
  // sitting beside the scaffold, which is exactly the shape that fires under
  // `mode: none` — so silence here is silence about the MODE, not about the
  // fixture being short of an ingredient.
  for (const mode of ["linear", "jira"] as const) {
    test(`mode: ${mode} stays silent even with a minted plan BESIDE the scaffold`, async () => {
      const project = setupProject({ mode, committedAt: AFTER_MINT_EPOCH });
      try {
        const minted = join(project.specsDir, "plan", "M_F4VDTA.md");
        writeFileSync(
          minted,
          "---\nmilestone: M_F4VDTA\nstatus: active\narchived_at: null\nid: fr_01M05MY4CE5DCWW8E26WF4VDTA\n---\n\n# M_F4VDTA\n",
        );
        // Non-vacuity: the ingredient the sibling test lacked is really here.
        expect(basename(minted)).toMatch(MINTED_PLAN_RE);

        const report = await runPlanIdentityModeConditionalProbe(project.root);
        expect(report.mode).toBe(mode);
        // The co-presence row is `mode: none` only. Nothing about this pairing
        // may be reported under a tracker mode.
        expect(
          report.violations
            .map((v) => v.note)
            .filter((n) => n.includes("scaffolding") || n.includes("M1.md")),
        ).toEqual([]);
      } finally {
        project.cleanup();
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-481.5 — the pin goes RED when the double-write is restored
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-481.5 — restoring the double-write fails the same assertion AC.1 passes", () => {
  /**
   * The pre-fix behaviour, reconstructed exactly: `/spec-write` mints and
   * writes a NEW plan file, leaving `/setup`'s scaffold where it is.
   */
  async function restoreDoubleWrite(project: Project): Promise<void> {
    const identity = await resolveMilestoneIdentity({ specsDir: project.specsDir, mode: "none" });
    writeFileSync(
      join(project.specsDir, "plan", `${identity.milestoneId}.md`),
      mintedPlanSource(identity),
    );
  }

  test("two active plan files ⇒ the AC.1 assertion throws", async () => {
    const project = setupProject();
    try {
      await restoreDoubleWrite(project);

      const plans = activePlanFiles(project.specsDir);
      expect(plans).toHaveLength(2);
      expect(plans).toContain("M1.md");

      expect(() => assertExactlyOneActivePlan(project.specsDir)).toThrow(
        /exactly one active plan file/,
      );
    } finally {
      project.cleanup();
    }
  });

  test("the restored double-write also reddens probe #73", async () => {
    const project = setupProject({ committedAt: AFTER_MINT_EPOCH });
    try {
      await restoreDoubleWrite(project);

      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.severity).toBe("error");
      expect(report.violations.some((v) => v.file.endsWith("M1.md"))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  test("and the fixed path, on the identical fixture, is green on both", async () => {
    // The other half of the mutation pair: same starting tree, real consumption
    // instead of the double write. Without this leg the red above could be red
    // for a reason unrelated to the scaffold.
    const mod = await loadConsumeModule();
    const project = setupProject({ committedAt: AFTER_MINT_EPOCH });
    try {
      await specWriteMint(project, mod);

      assertExactlyOneActivePlan(project.specsDir);
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

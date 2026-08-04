// M119 STE-441 — re-key probe #73's grandfathering from filename SHAPE to
// git-introduction PROVENANCE.
//
// The defect: probe #73 scoped its `mode: none` identity requirement to
// `milestoneIdFromUlid`'s output range and grandfathered everything outside it.
// A freshly mis-named sequential `M<N>` plan is byte-identical to a genuinely
// legacy one, so the carve-out passed both — permanently, and silently, for
// exactly the new milestones the probe exists to protect.
//
// The fix classifies every non-minted sequential plan under `mode: none` into
// one of four labels and disposes of each differently:
//
//   fresh       → error-severity violation (the mis-named new plan)
//   legacy      → nothing (the upgrade-safety property, preserved)
//   undecidable → warning-severity advisory naming `kind: legacy`
//   exempt      → nothing (`kind: scaffolding` / `kind: legacy` opt-out)
//
// AC map:
//   AC-STE-441.1  — the four-way classification, a pure function of
//                   (projectRoot, planPath, plan frontmatter).
//   AC-STE-441.2  — the resolution table, including non-git vacuity.
//   AC-STE-441.3  — `kind:` exemption, read through `normalizeFrontmatterSource`.
//   AC-STE-441.4  — dispositions + NFR-10 canonical message shape.
//   AC-STE-441.5  — per-violation `severity`, report severity = max.
//   AC-STE-441.6  — `MINT_EPOCH`, in the `SHIP_DATE_CUTOFF` documented shape.
//   AC-STE-441.7  — the reported incident, as a REAL temporary git repository.
//   AC-STE-441.9  — the bidirectional invariant + duplicate pass survive.
//   AC-STE-441.10 — the SKILL row and the plan template document the change.
//
// EXPORTS THIS FILE REQUIRES from `plan_identity_mode_conditional.ts`:
//   * `MINT_EPOCH: string`
//   * `classifyPlanProvenance(projectRoot, planPath, rawPlanSource)
//        => "fresh" | "legacy" | "undecidable" | "exempt"`
//   * `PlanIdentityModeViolation.severity: "warning" | "error"`
// The existing `PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY` export stays — it is
// the report-level default when there are no violations to take a max over.
//
// FIXTURES ARE REAL GIT REPOSITORIES. A mock cannot exercise a provenance
// signal: the whole point of the change is that the answer comes from git, so
// every classification below is produced by `git commit` with a controlled
// `GIT_AUTHOR_DATE`, by leaving a file untracked, or by severing the
// introducing commit's object from the store.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MINT_EPOCH,
  PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY,
  classifyPlanProvenance,
  runPlanIdentityModeConditionalProbe,
} from "../adapters/_shared/src/plan_identity_mode_conditional";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const PLAN_PROBE_SRC = join(SHARED_SRC, "plan_identity_mode_conditional.ts");
const BOOTSTRAP_PROBE_SRC = join(SHARED_SRC, "setup_bootstrap_commit_subject.ts");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const PLAN_TEMPLATE = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");

const read = (path: string): string => readFileSync(path, "utf-8");

/** The complete classification vocabulary AC-STE-441.1 fixes. Exactly four. */
const CLASSES = ["fresh", "legacy", "undecidable", "exempt"] as const;
type PlanClass = (typeof CLASSES)[number];

/** The two labels that produce neither a violation nor an advisory. */
const SILENT_CLASSES: readonly string[] = ["legacy", "exempt"];

// Straddling instants. `MINT_EPOCH` is 2026-07-26T00:00:00Z — the ship date of
// v2.56.0 "Mint", the release that made sequential tracker-less plans legacy.
const ONE_SECOND_BEFORE_EPOCH = "2026-07-25T23:59:59Z";
const AT_EPOCH = "2026-07-26T00:00:00Z";
const ONE_SECOND_AFTER_EPOCH = "2026-07-26T00:00:01Z";
const LONG_BEFORE_EPOCH = "2026-01-01T00:00:00Z";

const VALID_ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const MINTED_PLAN = "M_F4VDTA"; // = milestoneIdFromUlid(VALID_ULID)

// ───────────────────────────────────────────────────────────────────────────
// Fixture plumbing — real temporary git repositories
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

interface PlanFixture {
  /** Basename, e.g. `M5.md`. */
  name: string;
  archived?: boolean;
  /** Extra frontmatter lines, prepended to the base block. */
  fm?: string[];
  /** Full raw file bytes, overriding the generated body (CRLF / BOM cases). */
  raw?: string;
  /**
   * Author date of the commit that introduces the plan. Omit to leave the plan
   * on disk but never committed; set `staged: true` to add it to the index
   * without committing.
   */
  committedAt?: string;
  staged?: boolean;
}

interface Project {
  root: string;
  cleanup: () => void;
}

function claudeMd(mode: "none" | "linear" | "jira"): string {
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

function makeProject(opts: {
  mode?: "none" | "linear" | "jira";
  /** Initialise a git repository at the project root. Default true. */
  git?: boolean;
  plans: PlanFixture[];
}): Project {
  const mode = opts.mode ?? "none";
  const useGit = opts.git ?? true;
  const root = mkdtempSync(join(tmpdir(), "ste441-plan-"));
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMd(mode));
  writeFileSync(join(root, "README.md"), "# Fixture project\n");

  if (useGit) {
    git(root, ["init", "-q", "."]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "Fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "--", "CLAUDE.md", "README.md"]);
    commitAt(root, LONG_BEFORE_EPOCH, "chore: fixture base");
  }

  for (const plan of opts.plans) {
    const rel = planRel(plan);
    const stem = plan.name.replace(/\.md$/, "");
    writeFileSync(join(root, rel), plan.raw ?? planSource(stem, plan.fm ?? []));
    if (!useGit) continue;
    if (plan.committedAt !== undefined) {
      git(root, ["add", "--", rel]);
      commitAt(root, plan.committedAt, `chore: add ${plan.name}`);
    } else if (plan.staged === true) {
      git(root, ["add", "--", rel]);
    }
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Make a plan's introducing commit undiscoverable while the plan stays tracked
 * in HEAD — a severed/pruned object store.
 *
 * NOT the shallow-clone condition, despite the resemblance. A shallow clone
 * answers `git log --diff-filter=A` with its BOUNDARY commit rather than
 * failing, so a legacy plan there classifies `fresh` and fails the gate; it
 * never reaches `undecidable`. Verified empirically against git 2.55.
 *
 * The commit object that ADDED the plan is unlinked from the object store, so
 * `git log --diff-filter=A` can no longer reach it, while `git ls-files` (the
 * index) and `HEAD:<path>` (the tip tree) both still resolve. A trailing commit
 * is made first so the severed commit is never HEAD itself.
 */
function severIntroducingCommit(root: string, rel: string): void {
  writeFileSync(join(root, "README.md"), "# Fixture project\n\nTrailing change.\n");
  git(root, ["add", "--", "README.md"]);
  commitAt(root, ONE_SECOND_AFTER_EPOCH, "chore: trailing");

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

function classifyIn(root: string, rel: string): string {
  const abs = join(root, rel);
  return classifyPlanProvenance(root, abs, read(abs));
}

/** Every violation's file + note + message, fused — the assertion surface. */
function blobOf(violations: Array<{ file: string; note: string; message: string }>): string {
  return violations.map((v) => `${v.file}\n${v.note}\n${v.message}`).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.6 — MINT_EPOCH
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.6 — MINT_EPOCH is the mint ship date, documented like SHIP_DATE_CUTOFF", () => {
  test("the constant is exactly 2026-07-26T00:00:00Z and parses", () => {
    expect(MINT_EPOCH).toBe("2026-07-26T00:00:00Z");
    expect(Number.isFinite(Date.parse(MINT_EPOCH))).toBe(true);
    expect(Date.parse(MINT_EPOCH)).toBe(Date.parse("2026-07-26T00:00:00.000Z"));
  });

  test("its comment names the ship date and the legacy carve-out it opens", () => {
    // Same documented shape as `SHIP_DATE_CUTOFF`: a `//` comment immediately
    // above the constant saying what the instant IS and what falling either
    // side of it means. Without it the literal is an unexplained magic date.
    const lines = read(PLAN_PROBE_SRC).split("\n");
    const idx = lines.findIndex((l) => /^export const MINT_EPOCH\b/.test(l));
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

  test("the precedent it copies is real — SHIP_DATE_CUTOFF still ships this shape", () => {
    // Non-vacuity guard on the assertion above: if the precedent ever moved,
    // "in the shape already used by SHIP_DATE_CUTOFF" would be an empty claim.
    const src = read(BOOTSTRAP_PROBE_SRC);
    expect(src).toMatch(/^const SHIP_DATE_CUTOFF = "\d{4}-\d{2}-\d{2}T00:00:00Z";$/m);
    expect(src).toMatch(/\/\/[^\n]*ship date/i);
  });

  test("one second BEFORE the epoch is legacy; one second AFTER is fresh", () => {
    const p = makeProject({
      plans: [
        { name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH },
        { name: "M6.md", committedAt: ONE_SECOND_AFTER_EPOCH },
      ],
    });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("legacy");
      expect(classifyIn(p.root, join("specs", "plan", "M6.md"))).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });

  test("the boundary is inclusive — a plan committed AT the epoch is fresh", () => {
    const p = makeProject({ plans: [{ name: "M7.md", committedAt: AT_EPOCH }] });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M7.md"))).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.7 — the reported incident, reproduced
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.7 — two byte-identical sequential plans, opposite sides of the epoch", () => {
  function incidentProject(): Project {
    return makeProject({
      plans: [
        { name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH },
        { name: "M6.md", committedAt: ONE_SECOND_AFTER_EPOCH },
      ],
    });
  }

  test("the two plans are indistinguishable on disk — only provenance differs", () => {
    // This is precisely why the pre-change probe passed BOTH: keyed on filename
    // shape alone, a mis-named plan written moments ago is the same bytes as a
    // plan that has been sitting in the tree since before minting existed.
    const p = incidentProject();
    try {
      const five = read(join(p.root, "specs", "plan", "M5.md")).replace(/M5/g, "M<N>");
      const six = read(join(p.root, "specs", "plan", "M6.md")).replace(/M6/g, "M<N>");
      expect(five).toBe(six);
      // Neither carries an `id:` — the key the pre-change probe would have
      // demanded had it considered them in scope at all.
      expect(five).not.toContain("id:");
    } finally {
      p.cleanup();
    }
  });

  test("after the change the POST-epoch plan fails and the PRE-epoch plan does not", async () => {
    const p = incidentProject();
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M6.md");
      expect(v.severity).toBe("error");
      // The legacy plan is named nowhere in the report — an upgrade-safety
      // regression would show up here first.
      expect(blobOf(report.violations)).not.toContain("M5.md");
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("the fixture is a real git repository with real commit dates", () => {
    // Guards the fixture itself: a mock would let the classification pass
    // without ever exercising the provenance query the FR is about.
    const p = incidentProject();
    try {
      expect(existsSync(join(p.root, ".git"))).toBe(true);
      const introduced = (rel: string): string =>
        git(p.root, ["log", "--diff-filter=A", "-1", "--format=%aI", "--", rel]).trim();
      const five = Date.parse(introduced(join("specs", "plan", "M5.md")));
      const six = Date.parse(introduced(join("specs", "plan", "M6.md")));
      expect(six - five).toBe(2000);
      expect(five).toBeLessThan(Date.parse(MINT_EPOCH));
      expect(six).toBeGreaterThanOrEqual(Date.parse(MINT_EPOCH));
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.1 + AC-STE-441.2 — the classification table
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.2 — not a git repository ⇒ vacuous for that plan", () => {
  test("an untracked-looking sequential plan produces neither violation nor advisory", async () => {
    // The same plan in a git repo classifies `fresh` (see below). Without git
    // there is no provenance to read, and failing here would be the forced
    // migration the whole design avoids.
    const p = makeProject({ git: false, plans: [{ name: "M5.md" }] });
    try {
      expect(existsSync(join(p.root, ".git"))).toBe(false);
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("the classification lands on a silent label, never fresh or undecidable", () => {
    const p = makeProject({ git: false, plans: [{ name: "M5.md" }] });
    try {
      const cls = classifyIn(p.root, join("specs", "plan", "M5.md"));
      expect(CLASSES as readonly string[]).toContain(cls);
      expect(SILENT_CLASSES).toContain(cls);
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-441.2 — untracked and uncommitted plans are fresh", () => {
  test("a plan git does not track cannot predate anything ⇒ fresh", async () => {
    const p = makeProject({ plans: [{ name: "M5.md" }] });
    try {
      expect(git(p.root, ["ls-files", "--", join("specs", "plan", "M5.md")]).trim()).toBe("");
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("a STAGED but never-committed plan is fresh, not undecidable", async () => {
    // The discriminator that matters: `git ls-files` lists a staged path, and
    // `git log --diff-filter=A` is empty for it — exactly the two readings the
    // severed-history case produces. Only the tip tree tells them apart, so a
    // probe that keys `undecidable` off "tracked + no add commit" alone
    // misfiles the earliest, cheapest catch as an advisory.
    const p = makeProject({ plans: [{ name: "M5.md", staged: true }] });
    try {
      const rel = join("specs", "plan", "M5.md");
      expect(git(p.root, ["ls-files", "--", rel]).trim()).not.toBe("");
      expect(git(p.root, ["log", "--diff-filter=A", "-1", "--format=%aI", "--", rel]).trim()).toBe(
        "",
      );
      expect(classifyIn(p.root, rel)).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-441.2 — a git repo with no discoverable introducing commit ⇒ undecidable", () => {
  function severedProject(): Project {
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH }] });
    severIntroducingCommit(p.root, join("specs", "plan", "M5.md"));
    return p;
  }

  test("the plan is still tracked in HEAD, but the add commit is unreachable", () => {
    // The three git readings that define this case, asserted directly — this is
    // what the classifier has to work with, so a fixture that drifted off any
    // of them would silently test a different scenario.
    const p = severedProject();
    try {
      const rel = join("specs", "plan", "M5.md");
      const attempt = (args: string[]): { ok: boolean; out: string } => {
        try {
          return { ok: true, out: git(p.root, args).trim() };
        } catch {
          return { ok: false, out: "" };
        }
      };
      expect(git(p.root, ["ls-files", "--", rel]).trim()).toBe(rel.split("\\").join("/"));
      expect(attempt(["cat-file", "-e", `HEAD:${rel.split("\\").join("/")}`]).ok).toBe(true);
      const provenance = attempt(["log", "--diff-filter=A", "-1", "--format=%aI", "--", rel]);
      expect(provenance.out).toBe("");
    } finally {
      p.cleanup();
    }
  });

  test("it classifies undecidable", () => {
    const p = severedProject();
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("undecidable");
    } finally {
      p.cleanup();
    }
  });

  test("it yields ONE warning-severity advisory and the gate still passes", async () => {
    const p = severedProject();
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("warning");
      // A report whose only violations are advisories does not fail the gate:
      // a repository whose object store cannot answer the provenance query
      // must not go red on plans the operator has no way to date.
      expect(report.severity).toBe("warning");
    } finally {
      p.cleanup();
    }
  });

  test("the advisory's remedy names `kind: legacy` — the permanent way to clear it", async () => {
    const p = severedProject();
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      const message = report.violations[0]!.message;
      const remedy = message.split("\n").find((l) => l.startsWith("Remedy:"));
      expect(remedy).toBeDefined();
      expect(remedy!).toContain("kind: legacy");
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-441.1 — the classification is a pure function of its three inputs", () => {
  test("every fixture resolves to exactly one of the four labels", () => {
    const cases: Array<{ plan: PlanFixture; expected: PlanClass }> = [
      { plan: { name: "M5.md" }, expected: "fresh" },
      { plan: { name: "M6.md", committedAt: ONE_SECOND_AFTER_EPOCH }, expected: "fresh" },
      { plan: { name: "M7.md", committedAt: ONE_SECOND_BEFORE_EPOCH }, expected: "legacy" },
      { plan: { name: "M8.md", fm: ["kind: legacy"] }, expected: "exempt" },
    ];
    const p = makeProject({ plans: cases.map((c) => c.plan) });
    try {
      for (const c of cases) {
        const cls = classifyIn(p.root, planRel(c.plan));
        expect(CLASSES as readonly string[]).toContain(cls);
        expect(cls).toBe(c.expected);
      }
    } finally {
      p.cleanup();
    }
  });

  test("repeated calls agree and nothing on disk moves", () => {
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_AFTER_EPOCH }] });
    try {
      const rel = join("specs", "plan", "M5.md");
      const abs = join(p.root, rel);
      const before = read(abs);
      const statusBefore = git(p.root, ["status", "--porcelain"]);
      const first = classifyPlanProvenance(p.root, abs, before);
      const second = classifyPlanProvenance(p.root, abs, before);
      expect(second).toBe(first);
      expect(first).toBe("fresh");
      expect(read(abs)).toBe(before);
      expect(git(p.root, ["status", "--porcelain"])).toBe(statusBefore);
    } finally {
      p.cleanup();
    }
  });

  test("the answer follows the frontmatter argument, not a re-read of the file", () => {
    // "Pure function of ... the plan's frontmatter" means the third argument is
    // the source of truth for `kind:`. A classifier that quietly re-reads the
    // path would ignore what its caller handed it.
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_AFTER_EPOCH }] });
    try {
      const abs = join(p.root, "specs", "plan", "M5.md");
      expect(classifyPlanProvenance(p.root, abs, read(abs))).toBe("fresh");
      expect(classifyPlanProvenance(p.root, abs, planSource("M5", ["kind: legacy"]))).toBe("exempt");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.3 — the `kind:` exemption
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.3 — `kind: scaffolding` / `kind: legacy` ⇒ exempt, whatever git says", () => {
  for (const kind of ["scaffolding", "legacy"]) {
    test(`an UNTRACKED plan carrying \`kind: ${kind}\` is exempt, not fresh`, async () => {
      const p = makeProject({ plans: [{ name: "M5.md", fm: [`kind: ${kind}`] }] });
      try {
        expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("exempt");
        expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
      } finally {
        p.cleanup();
      }
    });

    test(`a POST-epoch committed plan carrying \`kind: ${kind}\` is exempt`, async () => {
      const p = makeProject({
        plans: [{ name: "M5.md", fm: [`kind: ${kind}`], committedAt: ONE_SECOND_AFTER_EPOCH }],
      });
      try {
        expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("exempt");
        expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
      } finally {
        p.cleanup();
      }
    });
  }

  test("a SEVERED-history plan carrying `kind: legacy` raises no advisory either", async () => {
    // This is the exemption's whole purpose: the operator clears a permanent
    // advisory by declaring the plan legacy once.
    const p = makeProject({
      plans: [{ name: "M5.md", fm: ["kind: legacy"], committedAt: ONE_SECOND_BEFORE_EPOCH }],
    });
    try {
      severIntroducingCommit(p.root, join("specs", "plan", "M5.md"));
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("exempt");
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("CRLF frontmatter is recognised — `kind:` reads through normalizeFrontmatterSource", async () => {
    const raw = `---\r\nkind: legacy\r\nmilestone: M5\r\nstatus: active\r\n---\r\n\r\n# M5 — Fixture\r\n`;
    const p = makeProject({ plans: [{ name: "M5.md", raw }] });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("exempt");
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a BOM-prefixed plan is recognised too", async () => {
    const raw = `\uFEFF---\nkind: legacy\nmilestone: M5\nstatus: active\n---\n\n# M5 — Fixture\n`;
    const p = makeProject({ plans: [{ name: "M5.md", raw }] });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("exempt");
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("NON-VACUITY — an unrelated `kind:` value exempts nothing", async () => {
    // The exemption is a two-value allow-list, not "carries a kind key".
    const p = makeProject({
      plans: [{ name: "M5.md", fm: ["kind: feature"], committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "M5.md"))).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("the module reads `kind:` through the shared normaliser, not a private splitter", () => {
    expect(read(PLAN_PROBE_SRC)).toContain("normalizeFrontmatterSource");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.4 — dispositions and message shape
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.4 — both new messages follow the NFR-10 canonical shape", () => {
  test("the fresh violation carries verdict + Remedy + Context and a file:line note", async () => {
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_AFTER_EPOCH }] });
    try {
      const v = (await runPlanIdentityModeConditionalProbe(p.root)).violations[0]!;
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/\nRemedy: /);
      expect(v.message).toMatch(/\nContext: /);
      expect(v.note).toMatch(/specs[/\\]plan[/\\].*\.md:\d+ — /);
      expect(v.file).toContain("M5.md");
      expect(v.line).toBeGreaterThanOrEqual(1);
    } finally {
      p.cleanup();
    }
  });

  test("the undecidable advisory carries the same three parts", async () => {
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH }] });
    try {
      severIntroducingCommit(p.root, join("specs", "plan", "M5.md"));
      const v = (await runPlanIdentityModeConditionalProbe(p.root)).violations[0]!;
      expect(v.message).toContain("plan_identity_mode_conditional:");
      expect(v.message).toMatch(/\nRemedy: /);
      expect(v.message).toMatch(/\nContext: /);
      expect(v.note).toMatch(/specs[/\\]plan[/\\].*\.md:\d+ — /);
    } finally {
      p.cleanup();
    }
  });

  test("legacy and exempt produce nothing at all — not even a note", async () => {
    const p = makeProject({
      plans: [
        { name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH },
        { name: "M6.md", fm: ["kind: legacy"], committedAt: ONE_SECOND_AFTER_EPOCH },
        { name: "M7.md", fm: ["kind: scaffolding"] },
        { name: "M20.md", committedAt: LONG_BEFORE_EPOCH, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("an ARCHIVED sequential plan is classified too — the walk spans `specs/plan/**`", async () => {
    const p = makeProject({
      plans: [{ name: "M20.md", committedAt: ONE_SECOND_AFTER_EPOCH, archived: true }],
    });
    try {
      expect(classifyIn(p.root, join("specs", "plan", "archive", "M20.md"))).toBe("fresh");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.file).toContain(join("plan", "archive"));
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.5 — per-violation severity, report severity = max
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.5 — severity travels with the violation", () => {
  test("a mixed tree reports both severities and the report takes the maximum", async () => {
    // The `fresh` leg here is an UNTRACKED plan on purpose. Severing a commit
    // truncates the object graph for every path query that would have to walk
    // past it, so a second plan whose provenance came from `git log` would go
    // `undecidable` alongside the first and the report would never be mixed.
    // `git ls-files` reads the index and needs no history, so the untracked
    // leg survives the severed repo intact.
    const p = makeProject({
      plans: [{ name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH }, { name: "M6.md" }],
    });
    try {
      severIntroducingCommit(p.root, join("specs", "plan", "M5.md"));
      expect(git(p.root, ["ls-files", "--", join("specs", "plan", "M6.md")]).trim()).toBe("");
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(2);
      const severities = report.violations.map((v) => v.severity).sort();
      expect(severities).toEqual(["error", "warning"]);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("an advisory-only report does not fail the gate", async () => {
    const p = makeProject({ plans: [{ name: "M5.md", committedAt: ONE_SECOND_BEFORE_EPOCH }] });
    try {
      severIntroducingCommit(p.root, join("specs", "plan", "M5.md"));
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(report.violations.every((v) => v.severity === "warning")).toBe(true);
      expect(report.severity).toBe("warning");
    } finally {
      p.cleanup();
    }
  });

  test("the pre-existing violation rows all carry severity: error", async () => {
    // Every row the probe already emitted is a hard failure and must stay one.
    // Without a per-row severity on THESE, a mixed report's max collapses to
    // whatever the last row happened to set.
    const missingId = makeProject({
      plans: [{ name: `${MINTED_PLAN}.md`, committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    const trackerId = makeProject({
      mode: "linear",
      plans: [{ name: "M101.md", fm: [`id: ${VALID_ULID}`], committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    const duplicate = makeProject({
      plans: [
        { name: "M1.md", committedAt: ONE_SECOND_BEFORE_EPOCH },
        { name: "M1.md", committedAt: ONE_SECOND_BEFORE_EPOCH, archived: true },
      ],
    });
    try {
      for (const p of [missingId, trackerId, duplicate]) {
        const report = await runPlanIdentityModeConditionalProbe(p.root);
        expect(report.violations.length).toBeGreaterThan(0);
        for (const v of report.violations) {
          expect(["error", "warning"]).toContain(v.severity);
          expect(v.severity).toBe("error");
        }
        expect(report.severity).toBe("error");
      }
    } finally {
      missingId.cleanup();
      trackerId.cleanup();
      duplicate.cleanup();
    }
  });

  test("an empty report keeps the module's declared default severity", async () => {
    // There is no maximum to take over zero violations, so the report falls
    // back to the exported constant — which is what the shipped hygiene test
    // in `gate-check-plan-identity-mode-conditional.test.ts` already pins.
    expect(PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY).toBe("error");
    const p = makeProject({ plans: [] });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
      expect(report.severity).toBe(PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY);
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.1 (scope) + AC-STE-441.9 (nothing else moved)
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.1 — the provenance check is scoped to sequential plans in mode: none", () => {
  test("an EPIC-keyed plan committed after the epoch stays grandfathered", async () => {
    // `M_PROJ_500` is carried over by a jira → none transition; it never had a
    // ULID and its operator cannot satisfy any identity remedy. Widening the
    // provenance check to it would be the forced migration this design avoids.
    const p = makeProject({
      plans: [
        { name: "M_PROJ_500.md", committedAt: ONE_SECOND_AFTER_EPOCH },
        { name: "M_DST_49.md", committedAt: ONE_SECOND_AFTER_EPOCH, archived: true },
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

  test("a MINTED plan carrying its id passes whatever its commit date", async () => {
    const p = makeProject({
      plans: [
        {
          name: `${MINTED_PLAN}.md`,
          fm: [`id: ${VALID_ULID}`],
          committedAt: ONE_SECOND_AFTER_EPOCH,
        },
      ],
    });
    try {
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("TRACKER mode never consults provenance — a fresh sequential plan is fine there", async () => {
    const p = makeProject({
      mode: "linear",
      plans: [{ name: "M119.md" }, { name: "M120.md", committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("linear");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-441.9 — the bidirectional invariant and the duplicate pass are untouched", () => {
  test("a minted tracker-less plan MISSING its id still fails, and only for that reason", async () => {
    const p = makeProject({
      plans: [{ name: `${MINTED_PLAN}.md`, committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("present");
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("a tracker-mode plan CARRYING an id still fails", async () => {
    const p = makeProject({
      mode: "linear",
      plans: [{ name: "M101.md", fm: [`id: ${VALID_ULID}`], committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("absent");
    } finally {
      p.cleanup();
    }
  });

  test("the duplicate-token pass still fires on two PRE-epoch sequential plans", async () => {
    // Mode-independent and filename-keyed, so a legacy pair that is silent
    // under the provenance check must still collide exactly once.
    const p = makeProject({
      plans: [
        { name: "M1.md", committedAt: ONE_SECOND_BEFORE_EPOCH },
        { name: "M1.md", committedAt: ONE_SECOND_BEFORE_EPOCH, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("one plan file per milestone token");
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("the duplicate-token pass still fires without git at all", async () => {
    const p = makeProject({
      git: false,
      plans: [{ name: "M1.md" }, { name: "M1.md", archived: true }],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.expected).toBe("one plan file per milestone token");
    } finally {
      p.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-441.10 — the documentation surfaces
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-441.10 — gate-check SKILL.md probe #73 documents the four classifications", () => {
  const row = (): string => {
    const hits = read(GATE_CHECK_SKILL)
      .split("\n")
      .filter((l) => /^73\. \*\*/.test(l));
    expect(hits.length).toBe(1);
    return hits[0]!;
  };

  test("all four labels appear in the row", () => {
    const r = row();
    for (const label of CLASSES) expect(r).toContain(label);
  });

  test("the row names the dispositions: error, advisory/warning, and silence", () => {
    const r = row();
    expect(r).toMatch(/advisor|warning/i);
    expect(r).toContain("kind: legacy");
    expect(r).toContain("kind: scaffolding");
  });

  test("the row keys the carve-out on git provenance and the mint epoch", () => {
    const r = row();
    expect(r).toMatch(/git/i);
    expect(r).toMatch(/MINT_EPOCH|2026-07-26/);
  });

  test("TRIPWIRE — the retired filename-shape claim is gone", () => {
    expect(row()).not.toContain(
      "Legacy sequential `M<N>` plans in a tracker-less project are grandfathered",
    );
  });

  test("the rewritten row adds no line and no STE-N token", () => {
    // `skills/` sits at 246/246 STE tokens with zero headroom, and this SKILL
    // is capped at 358 lines by `tests/skill-nfr-1-length.test.ts`.
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(358);
    expect(row()).not.toMatch(/\bAC-STE-\d+/);
    expect(row()).not.toMatch(/\bSTE-\d+/);
  });
});

describe("AC-STE-441.10 — plan.md.template documents `kind: legacy`", () => {
  test("the template explains the opt-out in a comment", () => {
    const body = read(PLAN_TEMPLATE);
    const comments = body.match(/<!--[\s\S]*?-->/g) ?? [];
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some((c) => c.includes("kind: legacy"))).toBe(true);
  });

  test("it is DOCUMENTED, never scaffolded — a live `kind:` key would exempt every new plan", () => {
    const body = read(PLAN_TEMPLATE);
    const frontmatter = body.slice(0, body.indexOf("\n---", 4));
    expect(frontmatter).not.toMatch(/^kind:/m);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-441.2 regression — the provenance query must be RENAME-AWARE
//
// Surfaced by the end-of-FR spec audit and confirmed empirically against git
// 2.55. `git log --diff-filter=A` scoped to a single path stops at a rename, so
// a plan `git mv`'d into `specs/plan/archive/` reports the ARCHIVE commit's
// date rather than the date it was written. Archival by `git mv` is exactly
// what `/spec-archive` and `/implement` Phase 4 do to every plan they close —
// so without `--follow` every tracker-less consumer that archived a genuinely
// legacy sequential plan would hard-fail on the next gate run, which is the
// forced migration § Requirement declares a hard constraint against, fired by
// the toolkit's own archival step.
// ---------------------------------------------------------------------------

describe("AC-STE-441.2 — archiving a legacy plan does not re-date it", () => {
  test("a pre-epoch plan git-mv'd to archive/ today still classifies legacy", () => {
    const p = makeProject({
      plans: [{ name: "M3.md", committedAt: LONG_BEFORE_EPOCH }],
    });
    try {
      // Precondition: legacy at its original path.
      expect(classifyIn(p.root, join("specs", "plan", "M3.md"))).toBe("legacy");

      // The archival step, verbatim: `git mv` then commit — dated well AFTER
      // the epoch, exactly as a real archive commit landing today would be.
      git(p.root, [
        "mv",
        join("specs", "plan", "M3.md"),
        join("specs", "plan", "archive", "M3.md"),
      ]);
      commitAt(p.root, "2026-08-04T00:00:00Z", "chore(specs): archive M3");

      expect(classifyIn(p.root, join("specs", "plan", "archive", "M3.md"))).toBe("legacy");
    } finally {
      p.cleanup();
    }
  });

  test("the whole-probe report stays clean after that archival", async () => {
    // The classification is what the probe consumes, so pin the consumer too:
    // a re-dated plan would surface an error-severity row and fail the gate.
    const p = makeProject({
      plans: [{ name: "M3.md", committedAt: LONG_BEFORE_EPOCH }],
    });
    try {
      git(p.root, [
        "mv",
        join("specs", "plan", "M3.md"),
        join("specs", "plan", "archive", "M3.md"),
      ]);
      commitAt(p.root, "2026-08-04T00:00:00Z", "chore(specs): archive M3");

      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("archiving does NOT launder a post-epoch mis-named plan into legacy", () => {
    // The fix takes the EARLIER of the plain and `--follow` dates, so a rename
    // can only make a plan look older. Guard the other direction: a plan that
    // was genuinely introduced after the epoch must stay `fresh` once archived,
    // or the repair would double as a way to hide the defect.
    const p = makeProject({
      plans: [{ name: "M4.md", committedAt: ONE_SECOND_AFTER_EPOCH }],
    });
    try {
      git(p.root, [
        "mv",
        join("specs", "plan", "M4.md"),
        join("specs", "plan", "archive", "M4.md"),
      ]);
      commitAt(p.root, "2026-08-04T00:00:00Z", "chore(specs): archive M4");

      expect(classifyIn(p.root, join("specs", "plan", "archive", "M4.md"))).toBe("fresh");
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-441.4 regression — a git that REFUSES is not evidence of freshness
//
// `gitQuery` returns null on any failure. The `log` leg degraded safely to the
// `undecidable` advisory, but the `ls-files` leg degraded to `fresh` ⇒ ERROR,
// so a repository with a `.git` directory but an unusable git (missing binary,
// corrupt index) hard-failed EVERY legacy sequential plan on a condition the
// operator did not cause and cannot fix by editing a plan.
// ---------------------------------------------------------------------------

describe("AC-STE-441.4 — an unusable git degrades to the advisory, not an error", () => {
  test("a corrupt index yields undecidable, never fresh", () => {
    const p = makeProject({
      plans: [{ name: "M3.md", committedAt: LONG_BEFORE_EPOCH }],
    });
    try {
      // Corrupt the index so `git ls-files` exits non-zero while `.git` stays
      // present — the "git refused to answer" condition, not "git said no".
      writeFileSync(join(p.root, ".git", "index"), "not an index\n");
      expect(classifyIn(p.root, join("specs", "plan", "M3.md"))).toBe("undecidable");
    } finally {
      p.cleanup();
    }
  });
});

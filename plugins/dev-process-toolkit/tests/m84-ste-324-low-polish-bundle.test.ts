// STE-324 — M84 LOW polish bundle (10 mechanical fixes).
//
// AC.1: TDD-stage-count drift sweep across 4 files.
// AC.2: covered by adapters/_shared/src/branch_proposal.test.ts.
// AC.3: covered by adapters/_shared/src/release_config.test.ts.
// AC.4: NON_COMMIT_PRODUCING_SKILLS allowlist expanded to 8 entries.
// AC.5: probe #49 module relocates to adapters/_shared/src/; SKILL.md + traceability rewires.
// AC.6: examples/bun-typescript.md probe refs snake_case.
// AC.7: skills/spec-review/SKILL.md description references forked-auditor architecture.
// AC.8: NEW probe verifies `disable-model-invocation: true` allowlist (only `/setup`).
// AC.9: templates/CLAUDE.md.template Workflows section names all 6 missing skills.
// AC.10: specs/notes/jira-smoke-5.md moved under archive/ + README.

import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");

// ---------- AC-STE-324.1 — TDD stage-count drift sweep ----------------------

describe("AC-STE-324.1 — 4-stage TDD architecture canon (per STE-318 / STE-296)", () => {
  test("plugins/{tests,adapters} contain ZERO occurrences of the three legacy drift phrases", () => {
    // The FR canonical refusal grep:
    //   git grep -nE "(orchestrator \+ 3 forked subagents
    //                  |the four skill paths exist \(tdd \+ tdd-write-test \+ tdd-implement \+ tdd-refactor\)
    //                  |orchestrator \+ 3 children)" plugins/dev-process-toolkit/{tests,adapters}
    // should return zero matches after AC.1 lands.
    const result = execSync(
      `git grep -nE "(orchestrator \\+ 3 forked subagents|the four skill paths exist \\(tdd \\+ tdd-write-test \\+ tdd-implement \\+ tdd-refactor\\)|orchestrator \\+ 3 children)" plugins/dev-process-toolkit/tests plugins/dev-process-toolkit/adapters || true`,
      { cwd: REPO_ROOT, encoding: "utf-8" },
    ).trim();
    expect(result).toBe("");
  });

  test("tests/tdd-live-smoke.test.ts comment no longer says `3 forked subagents`", () => {
    const body = readFileSync(join(PLUGIN_ROOT, "tests", "tdd-live-smoke.test.ts"), "utf-8");
    expect(body).not.toMatch(/orchestrator \+ 3 forked subagents/);
  });

  test("adapters/_shared/src/tdd_orchestrator_integrity.ts docstring + L46 no longer say `four skill paths` (tdd + 3 children)", () => {
    const body = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "tdd_orchestrator_integrity.ts"),
      "utf-8",
    );
    // The legacy listing names exactly 4 paths (tdd + 3 children); after AC.1
    // the doctring should reflect the post-STE-296 5-path layout (tdd + 4 children)
    // or otherwise be re-worded to drop the "(a) ... four skill paths" claim.
    expect(body).not.toMatch(
      /the four skill paths exist \(tdd \+ tdd-write-test \+ tdd-implement \+ tdd-refactor\)/,
    );
    // Also covers the L46 echo inside `buildMessage`'s Remedy string.
    expect(body).not.toMatch(/four skill paths existing/);
  });

  test("tests/gate-check-tdd-orchestrator-integrity.test.ts no longer says `orchestrator + 3 children`", () => {
    const body = readFileSync(
      join(PLUGIN_ROOT, "tests", "gate-check-tdd-orchestrator-integrity.test.ts"),
      "utf-8",
    );
    expect(body).not.toMatch(/orchestrator \+ 3 children/);
  });
});

// ---------- AC-STE-324.4 — NON_COMMIT_PRODUCING_SKILLS allowlist -----------

describe("AC-STE-324.4 — NON_COMMIT_PRODUCING_SKILLS expanded to 8 entries", () => {
  test("allowlist includes the four TDD child forks for symmetry", async () => {
    const { NON_COMMIT_PRODUCING_SKILLS } = await import(
      "../adapters/_shared/src/commit_producing_skill_branch_gate"
    );
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("tdd-write-test");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("tdd-implement");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("tdd-refactor");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("tdd-spec-review");
  });

  test("allowlist preserves the four pre-existing entries", async () => {
    const { NON_COMMIT_PRODUCING_SKILLS } = await import(
      "../adapters/_shared/src/commit_producing_skill_branch_gate"
    );
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("report-issue");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("spec-research");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("deps-research");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("spec-review-audit");
  });

  test("allowlist contains exactly 8 entries (no extra drift)", async () => {
    const { NON_COMMIT_PRODUCING_SKILLS } = await import(
      "../adapters/_shared/src/commit_producing_skill_branch_gate"
    );
    expect(NON_COMMIT_PRODUCING_SKILLS).toHaveLength(8);
  });
});

// ---------- AC-STE-324.5 — probe #49 relocation -----------------------------

describe("AC-STE-324.5 — tracker_local_reconciliation_drift probe relocated to adapters/_shared/src/", () => {
  test("new canonical path file exists at adapters/_shared/src/tracker_local_reconciliation_drift.ts", () => {
    const newPath = join(
      PLUGIN_ROOT,
      "adapters",
      "_shared",
      "src",
      "tracker_local_reconciliation_drift.ts",
    );
    expect(existsSync(newPath)).toBe(true);
  });

  test("legacy probe path at skills/gate-check/probes/ is removed", () => {
    const legacyPath = join(
      PLUGIN_ROOT,
      "skills",
      "gate-check",
      "probes",
      "tracker_local_reconciliation_drift.ts",
    );
    expect(existsSync(legacyPath)).toBe(false);
  });

  test("module exports runTrackerLocalReconciliationDriftProbe from the new location", async () => {
    const mod = await import(
      "../adapters/_shared/src/tracker_local_reconciliation_drift"
    );
    expect(typeof mod.runTrackerLocalReconciliationDriftProbe).toBe("function");
  });

  test("skills/gate-check/SKILL.md registration line points at the new path (not the legacy `skills/gate-check/probes/` path)", () => {
    const body = readFileSync(
      join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    // After AC.5, the registration cites the canonical adapters path.
    expect(body).toContain(
      "adapters/_shared/src/tracker_local_reconciliation_drift.ts",
    );
    // And the legacy citation is gone.
    expect(body).not.toContain(
      "skills/gate-check/probes/tracker_local_reconciliation_drift.ts",
    );
  });

  test("specs/requirements.md traceability row at L337 (STE-284) points at the new path", () => {
    const body = readFileSync(join(REPO_ROOT, "specs", "requirements.md"), "utf-8");
    // The traceability row for STE-284 should cite the new canonical location.
    expect(body).toContain(
      "adapters/_shared/src/tracker_local_reconciliation_drift.ts",
    );
    expect(body).not.toContain(
      "skills/gate-check/probes/tracker_local_reconciliation_drift.ts",
    );
  });
});

// ---------- AC-STE-324.6 — bun-typescript example snake_case probe ID -------

describe("AC-STE-324.6 — examples/bun-typescript.md uses snake_case PROBE_ID", () => {
  test("kebab-case `bun-zero-match-placeholder` is fully gone from examples/", () => {
    const result = execSync(
      `git grep -nE "bun-zero-match-placeholder" plugins/dev-process-toolkit/examples/ || true`,
      { cwd: REPO_ROOT, encoding: "utf-8" },
    ).trim();
    expect(result).toBe("");
  });

  test("snake_case `bun_zero_match_placeholder` is referenced in examples/bun-typescript.md", () => {
    const body = readFileSync(
      join(PLUGIN_ROOT, "examples", "bun-typescript.md"),
      "utf-8",
    );
    expect(body).toContain("bun_zero_match_placeholder");
  });
});

// ---------- AC-STE-324.7 — spec-review SKILL.md description ----------------

describe("AC-STE-324.7 — /spec-review description references forked-auditor architecture", () => {
  function readFrontmatterDescription(path: string): string {
    const body = readFileSync(path, "utf-8");
    const m = /^---\n([\s\S]*?)\n---/.exec(body);
    if (!m) throw new Error(`no frontmatter at ${path}`);
    const desc = /^description:\s*(.+)$/m.exec(m[1]!);
    if (!desc) throw new Error(`no description in ${path}`);
    return desc[1]!.trim();
  }

  test("description mentions the forked-auditor architecture (e.g. `spec-review-audit` fork or `spec-reviewer` subagent)", () => {
    const description = readFrontmatterDescription(
      join(PLUGIN_ROOT, "skills", "spec-review", "SKILL.md"),
    );
    // Must surface one of the architectural-pattern tokens introduced by STE-308.
    const mentionsFork =
      description.includes("spec-review-audit") ||
      description.includes("spec-reviewer") ||
      description.includes("fork");
    expect(mentionsFork).toBe(true);
  });

  test("description does NOT carry the novel `[Orchestrator]` tag prefix (not added per AC.7 carve-out)", () => {
    const description = readFrontmatterDescription(
      join(PLUGIN_ROOT, "skills", "spec-review", "SKILL.md"),
    );
    expect(description).not.toContain("[Orchestrator]");
  });

  test("description stays under 200 characters (frontmatter length convention)", () => {
    const description = readFrontmatterDescription(
      join(PLUGIN_ROOT, "skills", "spec-review", "SKILL.md"),
    );
    expect(description.length).toBeLessThan(200);
  });
});

// ---------- AC-STE-324.8 — disable-model-invocation forbidden-flag probe ----

describe("AC-STE-324.8 — disable_model_invocation_allowlist probe (canonical-allowlist shape)", () => {
  test("probe module exists at adapters/_shared/src/disable_model_invocation_allowlist.ts", () => {
    const probePath = join(
      PLUGIN_ROOT,
      "adapters",
      "_shared",
      "src",
      "disable_model_invocation_allowlist.ts",
    );
    expect(existsSync(probePath)).toBe(true);
  });

  test("probe module exports a runDisableModelInvocationAllowlistProbe entry point", async () => {
    const mod = await import(
      "../adapters/_shared/src/disable_model_invocation_allowlist"
    );
    expect(typeof mod.runDisableModelInvocationAllowlistProbe).toBe("function");
  });

  test("probe PASSES on the live plugin tree (only `/setup` carries the flag)", async () => {
    const { runDisableModelInvocationAllowlistProbe } = await import(
      "../adapters/_shared/src/disable_model_invocation_allowlist"
    );
    const r = await runDisableModelInvocationAllowlistProbe(REPO_ROOT);
    // Zero violations expected — `/setup` is the only permitted carrier and the
    // current main branch has no offending edits to `/ship-milestone` or
    // `/spec-archive`.
    expect(r.violations).toEqual([]);
  });

  test("probe FAILS when `disable-model-invocation: true` is present on a composable skill (e.g. /ship-milestone)", async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { runDisableModelInvocationAllowlistProbe } = await import(
      "../adapters/_shared/src/disable_model_invocation_allowlist"
    );
    const root = mkdtempSync(join(tmpdir(), "disable-model-invocation-allowlist-"));
    try {
      const skillsDir = join(root, "plugins", "dev-process-toolkit", "skills");
      mkdirSync(join(skillsDir, "ship-milestone"), { recursive: true });
      mkdirSync(join(skillsDir, "setup"), { recursive: true });
      writeFileSync(
        join(skillsDir, "ship-milestone", "SKILL.md"),
        "---\nname: ship-milestone\ndescription: ship\ndisable-model-invocation: true\n---\n\nBody\n",
      );
      // Setup is allowed to carry the flag.
      writeFileSync(
        join(skillsDir, "setup", "SKILL.md"),
        "---\nname: setup\ndescription: bootstrap\ndisable-model-invocation: true\n---\n\nBody\n",
      );
      const r = await runDisableModelInvocationAllowlistProbe(root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      // The violation must name the offending skill so the operator can locate
      // it without grepping the whole skills tree.
      expect(r.violations.some((v) => v.file.includes("ship-milestone"))).toBe(true);
      // Setup must NOT be flagged (it is the sole permitted carrier).
      expect(r.violations.every((v) => !v.file.endsWith("setup/SKILL.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("probe FAILS when `disable-model-invocation: true` is present on /spec-archive (the other forbidden site)", async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { runDisableModelInvocationAllowlistProbe } = await import(
      "../adapters/_shared/src/disable_model_invocation_allowlist"
    );
    const root = mkdtempSync(join(tmpdir(), "disable-model-invocation-allowlist-"));
    try {
      const skillsDir = join(root, "plugins", "dev-process-toolkit", "skills");
      mkdirSync(join(skillsDir, "spec-archive"), { recursive: true });
      writeFileSync(
        join(skillsDir, "spec-archive", "SKILL.md"),
        "---\nname: spec-archive\ndescription: archive\ndisable-model-invocation: true\n---\n\nBody\n",
      );
      const r = await runDisableModelInvocationAllowlistProbe(root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.violations.some((v) => v.file.includes("spec-archive"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------- AC-STE-324.9 — CLAUDE.md.template Workflows section ------------

describe("AC-STE-324.9 — templates/CLAUDE.md.template Workflows section mentions all 6 missing skills", () => {
  function readTemplate(): string {
    return readFileSync(
      join(PLUGIN_ROOT, "templates", "CLAUDE.md.template"),
      "utf-8",
    );
  }

  test("template mentions /tdd", () => {
    expect(readTemplate()).toContain("/tdd");
  });

  test("template mentions /visual-check", () => {
    expect(readTemplate()).toContain("/visual-check");
  });

  test("template mentions /docs", () => {
    expect(readTemplate()).toContain("/docs");
  });

  test("template mentions /ship-milestone", () => {
    expect(readTemplate()).toContain("/ship-milestone");
  });

  test("template mentions /deps", () => {
    expect(readTemplate()).toContain("/deps");
  });

  test("template mentions /report-issue", () => {
    expect(readTemplate()).toContain("/report-issue");
  });

  test("Feature workflow shows the full chain `/spec-write → /implement → /tdd (auto) → /gate-check → /docs → /ship-milestone → /pr`", () => {
    const body = readTemplate();
    // The chain must be expressed in document order in the Feature line.
    // Use index-of probes so future minor rewording (e.g. swapped arrow glyph)
    // doesn't false-fail the assertion.
    const featureIdx = body.indexOf("Feature");
    expect(featureIdx).toBeGreaterThan(-1);
    const tail = body.slice(featureIdx);
    // All 7 chain tokens must appear in the Feature tail in the canonical order.
    const seq = [
      "/spec-write",
      "/implement",
      "/tdd",
      "/gate-check",
      "/docs",
      "/ship-milestone",
      "/pr",
    ];
    let cursor = 0;
    for (const tok of seq) {
      const found = tail.indexOf(tok, cursor);
      expect(found).toBeGreaterThanOrEqual(cursor);
      cursor = found + tok.length;
    }
  });

  test("grep -cE for the 6 user-callable skill names returns ≥ 6 (AC-STE-324.9 canonical check)", () => {
    // The FR's literal check:
    //   grep -cE "(/tdd|/visual-check|/docs|/ship-milestone|/deps|/report-issue)" \
    //     templates/CLAUDE.md.template
    // returns ≥ 6.
    const count = execSync(
      `grep -cE "(/tdd|/visual-check|/docs|/ship-milestone|/deps|/report-issue)" plugins/dev-process-toolkit/templates/CLAUDE.md.template || true`,
      { cwd: REPO_ROOT, encoding: "utf-8" },
    ).trim();
    expect(Number(count)).toBeGreaterThanOrEqual(6);
  });
});

// ---------- AC-STE-324.10 — jira-smoke-5 archival --------------------------

describe("AC-STE-324.10 — specs/notes/jira-smoke-5.md archived under specs/notes/archive/", () => {
  test("file is gone from specs/notes/ (moved, not copied)", () => {
    expect(existsSync(join(REPO_ROOT, "specs", "notes", "jira-smoke-5.md"))).toBe(false);
  });

  test("file exists at specs/notes/archive/jira-smoke-5.md", () => {
    expect(
      existsSync(join(REPO_ROOT, "specs", "notes", "archive", "jira-smoke-5.md")),
    ).toBe(true);
  });

  test("archived note frontmatter has `status: archived` (was `partial`)", () => {
    const body = readFileSync(
      join(REPO_ROOT, "specs", "notes", "archive", "jira-smoke-5.md"),
      "utf-8",
    );
    expect(body).toMatch(/^status:\s*archived\s*$/m);
    // The old `status: partial` line must no longer be present in the live frontmatter
    // block (it would be a drift signal if both lines coexisted).
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(body);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    expect(fm).not.toMatch(/^status:\s*partial\s*$/m);
  });

  test("archived note frontmatter carries an `archived_at:` ISO-8601 UTC timestamp", () => {
    const body = readFileSync(
      join(REPO_ROOT, "specs", "notes", "archive", "jira-smoke-5.md"),
      "utf-8",
    );
    // The FR specifies `archived_at: 2026-05-21T<commit-time>Z` shape; accept any
    // ISO-8601 instant in the live block (year/month/day still mandatory).
    expect(body).toMatch(/^archived_at:\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\s*$/m);
  });

  test("specs/notes/archive/README.md exists and documents the convention", () => {
    const path = join(REPO_ROOT, "specs", "notes", "archive", "README.md");
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf-8");
    // One-line README, mentions the archival convention's two load-bearing
    // tokens: "smoke" / "conformance" trace and "superseded" / "release" framing.
    expect(body.length).toBeGreaterThan(0);
    expect(body.toLowerCase()).toMatch(/(smoke|conformance)/);
    expect(body.toLowerCase()).toMatch(/(superseded|archive|older)/);
  });

  test("git history is preserved via `git mv` (rename staged in index)", () => {
    // Assert rename detection in the staged index — `git status --porcelain` reports
    // `R <old> -> <new>` for `git mv` (and not `D <old>\n?? <new>` for a copy+delete).
    // We assert on the staged state because tests run pre-commit; after the commit
    // lands, `git log --follow` will continue to traverse the prior path's history
    // (the same rename detection persists in commit history).
    try {
      const status = execSync("git status --porcelain --untracked-files=all", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });
      // Index status `R` (rename) appears on lines like: `R  specs/notes/jira-smoke-5.md -> specs/notes/archive/jira-smoke-5.md`
      // (post-commit, this row disappears — that's the GREEN-after-commit state).
      const archivePath = "specs/notes/archive/jira-smoke-5.md";
      const renamed = status
        .split("\n")
        .some((line) => /^R/.test(line) && line.includes(archivePath));
      const archiveCommitted = !status.split("\n").some((line) =>
        line.includes(archivePath),
      );
      // GREEN if the rename is staged in the index OR the rename has already been
      // committed (archive path no longer appears in `git status`).
      expect(renamed || archiveCommitted).toBe(true);
    } catch (err) {
      throw new Error(`git status --porcelain failed: ${(err as Error).message}`);
    }
  });
});

// ---------- Bundle-level sanity: file presence + non-emptiness -------------

describe("AC-STE-324 bundle sanity — all touched files exist and are non-empty", () => {
  const TOUCHED_FILES = [
    "plugins/dev-process-toolkit/tests/tdd-live-smoke.test.ts",
    "plugins/dev-process-toolkit/adapters/_shared/src/tdd_orchestrator_integrity.ts",
    "plugins/dev-process-toolkit/tests/gate-check-tdd-orchestrator-integrity.test.ts",
    "plugins/dev-process-toolkit/adapters/_shared/src/branch_proposal.ts",
    "plugins/dev-process-toolkit/adapters/_shared/src/release_config.ts",
    "plugins/dev-process-toolkit/adapters/_shared/src/commit_producing_skill_branch_gate.ts",
    "plugins/dev-process-toolkit/examples/bun-typescript.md",
    "plugins/dev-process-toolkit/skills/spec-review/SKILL.md",
    "plugins/dev-process-toolkit/templates/CLAUDE.md.template",
  ];

  for (const rel of TOUCHED_FILES) {
    test(`${rel} exists and is non-empty`, () => {
      const abs = join(REPO_ROOT, rel);
      expect(existsSync(abs)).toBe(true);
      expect(statSync(abs).size).toBeGreaterThan(0);
    });
  }
});

// STE-608 (M_685ff6) — AC.15 / AC.16: probe #73 grows a `mode: linear`
// provenance arm mirroring the `mode: jira` one, dated against the new
// `LINEAR_TRACKER_KEY_EPOCH` (this milestone's release date).
//
// A sequential `M<N>` plan git introduces at or after the epoch is an ERROR
// whose remedy is minting through the decision front door
// (`resolve_milestone_identity.ts`) and renaming to the `M_<6-hex>` filename it
// derives; `kind: legacy` clears a misdated one; an unreachable introducing
// commit is the shared `undecidableProvenanceViolation` warning. Every earlier
// plan is grandfathered — including this repository's 142 archived numeric plans.
//
// Fixtures are REAL git repositories whose commits carry explicit
// GIT_AUTHOR_DATE / GIT_COMMITTER_DATE.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as probeModule from "../adapters/_shared/src/plan_identity_mode_conditional";
import {
  classifyPlanProvenance,
  JIRA_EPIC_EPOCH,
  runPlanIdentityModeConditionalProbe,
} from "../adapters/_shared/src/plan_identity_mode_conditional";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const FR_ID = "STE-608";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** The constant under test, read defensively so every leg reds cleanly while it is absent. */
function linearEpoch(): string {
  const v = (probeModule as unknown as Record<string, unknown>).LINEAR_TRACKER_KEY_EPOCH;
  if (typeof v !== "string") throw new Error("LINEAR_TRACKER_KEY_EPOCH is not exported from plan_identity_mode_conditional.ts");
  return v;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const shift = (at: string, seconds: number): string => iso(Date.parse(at) + seconds * 1000);
const LONG_BEFORE = "2026-01-01T00:00:00Z";

// ------------------------------------------------------------------ fixtures

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0", ...env },
  });
}

function commitAt(root: string, at: string, message: string): void {
  git(root, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
}

function planSource(stem: string, extra: string[] = []): string {
  return ["---", ...extra, `milestone: ${stem}`, "status: active", "archived_at: null", "---", "", `# ${stem} — Fixture`, ""].join("\n");
}

function project(mode: "linear" | "jira" | "none" = "linear"): string {
  const root = mkdtempSync(join(tmpdir(), "ste608-plan-"));
  roots.push(root);
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    mode === "none" ? "# Fixture\n" : `# Fixture\n\n## Task Tracking\n\nmode: ${mode}\nmcp_server: ${mode}\n`,
  );
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  git(root, ["init", "-q", "."]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "--", "CLAUDE.md", "README.md"]);
  commitAt(root, LONG_BEFORE, "chore: base");
  return root;
}

/** Add `specs/plan/<name>` (committed at `at`, or left untracked when `at` is null). */
function addPlan(root: string, name: string, at: string | null, extra: string[] = []): string {
  const rel = join("specs", "plan", name);
  writeFileSync(join(root, rel), planSource(name.replace(/\.md$/, ""), extra));
  if (at !== null) {
    git(root, ["add", "--", rel]);
    commitAt(root, at, `chore: add ${name}`);
  }
  return rel;
}

/** Sever the plan's introducing commit object — the `undecidable` condition. */
function sever(root: string, rel: string, after: string): void {
  writeFileSync(join(root, "README.md"), "# Fixture\n\nTrailing.\n");
  git(root, ["add", "--", "README.md"]);
  commitAt(root, after, "chore: trailing");
  const sha = git(root, ["log", "--diff-filter=A", "-1", "--format=%H", "--", rel]).trim();
  const obj = join(root, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  if (!existsSync(obj)) throw new Error(`fixture bug: no loose object ${obj}`);
  rmSync(obj, { force: true });
}

const remedyOf = (m: string): string => m.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";

// ===========================================================================
// AC-STE-608.15
// ===========================================================================

describe("AC-STE-608.15 — LINEAR_TRACKER_KEY_EPOCH", () => {
  test("exported beside JIRA_EPIC_EPOCH as an ISO instant at midnight UTC, later than JIRA_EPIC_EPOCH", () => {
    const e = linearEpoch();
    expect(e).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(Date.parse(e)).toBeGreaterThan(Date.parse(JIRA_EPIC_EPOCH));
  });

  test(`two-phase: before a CHANGELOG entry lists ${FR_ID}, later than M143's introduction; after, equal to that entry's date`, () => {
    const e = linearEpoch();
    const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf-8");
    const sections = changelog.split(/^(?=## \[)/m);
    const entry = sections.find((s) => s.startsWith("## [") && new RegExp(`\\b${FR_ID}\\b`).test(s));
    if (entry === undefined) {
      const introduced = git(REPO_ROOT, ["log", "--diff-filter=A", "--format=%aI", "--", "specs/plan/M143.md", "specs/plan/archive/M143.md"])
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => Date.parse(l));
      expect(introduced.length).toBeGreaterThan(0);
      expect(Math.min(...introduced)).toBeGreaterThanOrEqual(Date.parse("2026-09-04T00:00:00Z"));
      expect(Date.parse(e)).toBeGreaterThan(Math.min(...introduced));
    } else {
      const date = /^## \[[^\]]+\] — (\d{4}-\d{2}-\d{2})/.exec(entry)?.[1];
      expect(date).toBeDefined();
      expect(e).toBe(`${date}T00:00:00Z`);
    }
  });
});

describe("AC-STE-608.15 — mode: linear forbids a NEW sequential plan", () => {
  async function oneErrorRow(root: string, token: string) {
    const report = await runPlanIdentityModeConditionalProbe(root);
    expect(report.mode).toBe("linear");
    expect(report.violations.length).toBe(1);
    const row = report.violations[0]!;
    expect(row.file).toContain(`${token}.md`);
    expect(row.severity).toBe("error");
    const remedy = remedyOf(row.message);
    expect(remedy).toContain("resolve_milestone_identity.ts");
    expect(remedy).toContain("M_<6-hex>");
    expect(remedy).toContain("kind: legacy");
    expect(remedy).toMatch(/shallow clone/i);
    return row;
  }

  test("a sequential plan committed AT the epoch → exactly one error row", async () => {
    const root = project();
    addPlan(root, "M150.md", linearEpoch());
    await oneErrorRow(root, "M150");
  });

  test("a sequential plan committed AFTER the epoch → exactly one error row", async () => {
    const root = project();
    addPlan(root, "M151.md", shift(linearEpoch(), 3600));
    await oneErrorRow(root, "M151");
  });

  test("an UNTRACKED sequential plan → exactly one error row", async () => {
    const root = project();
    linearEpoch();
    addPlan(root, "M152.md", null);
    await oneErrorRow(root, "M152");
  });

  test("an unreachable introducing commit → one WARNING row through the shared undecidable advisory, never silence", async () => {
    const root = project();
    const rel = addPlan(root, "M153.md", shift(linearEpoch(), 60));
    sever(root, rel, shift(linearEpoch(), 120));
    const report = await runPlanIdentityModeConditionalProbe(root);
    expect(report.violations.length).toBe(1);
    const row = report.violations[0]!;
    expect(row.severity).toBe("warning");
    expect(row.expected).toBe("a discoverable introducing commit");
    expect(row.message).toContain(linearEpoch());
    expect(remedyOf(row.message)).toContain("kind: legacy");
  });
});

// ===========================================================================
// AC-STE-608.16
// ===========================================================================

describe("AC-STE-608.16 — the linear arm permits every old plan", () => {
  test("no row: one second before the epoch, long before, archived-after-epoch with a Summary, post-epoch kind: legacy, post-epoch M_<6-hex>", async () => {
    const e = linearEpoch();
    const root = project();
    addPlan(root, "M140.md", shift(e, -1));
    addPlan(root, "M3.md", LONG_BEFORE);
    // Introduced before the epoch, archived after it in a content-changing commit.
    const rel = addPlan(root, "M141.md", shift(e, -86400));
    const archived = join("specs", "plan", "archive", "M141.md");
    git(root, ["mv", rel, archived]);
    writeFileSync(join(root, archived), readFileSync(join(root, archived), "utf-8") + "\n## Summary\n\nShipped.\n");
    git(root, ["add", "--", archived]);
    commitAt(root, shift(e, 86400), "chore: archive M141");
    addPlan(root, "M160.md", shift(e, 7200), ["kind: legacy"]);
    addPlan(root, "M_550e84.md", shift(e, 7200));
    const report = await runPlanIdentityModeConditionalProbe(root);
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  });

  test("the same fixture WITHOUT the linear arm's grandfathering would fire: a post-epoch sequential sibling reds it (non-vacuity)", async () => {
    const e = linearEpoch();
    const root = project();
    addPlan(root, "M140.md", shift(e, -1));
    addPlan(root, "M161.md", shift(e, 1));
    const report = await runPlanIdentityModeConditionalProbe(root);
    expect(report.violations.map((v) => v.file.split("/").pop())).toEqual(["M161.md"]);
  });

  test("(control) dogfood: the probe over this repository (mode: linear) reports zero rows", async () => {
    const report = await runPlanIdentityModeConditionalProbe(REPO_ROOT);
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  }, 120_000);

  test("dogfood is not vacuous: all 142 archived numeric plans are legacy at the epoch; 52 are fresh at 2026-07-01 (control)", () => {
    const e = linearEpoch();
    const dir = join(REPO_ROOT, "specs", "plan", "archive");
    const numeric = readdirSync(dir).filter((f) => /^M\d+\.md$/.test(f));
    expect(numeric.length).toBe(142);
    const classify = (at: string) =>
      numeric.map((f) => classifyPlanProvenance(REPO_ROOT, join(dir, f), readFileSync(join(dir, f), "utf-8"), at));
    expect(classify(e).every((c) => c === "legacy")).toBe(true);
    expect(classify("2026-07-01T00:00:00Z").filter((c) => c === "fresh").length).toBe(52);
  }, 120_000);
});

// STE-608 (M_685ff6) — AC.13 / AC.14: new numeric milestones are refused in
// tracker mode; old numeric milestones are untouched.
//
// The explicit-`M<N>` door
//   bun run adapters/_shared/src/next_free_milestone_number.ts <specsDir> <M-token>
// reads the CLAUDE.md BESIDE <specsDir> (i.e. `<specsDir>/../CLAUDE.md`). Under
// `mode: jira` or `mode: linear` it refuses any typed number (exit 1, NFR-10 on
// stderr, empty stdout) with a Remedy naming the decision front door
// `resolve_milestone_identity.ts`; under `mode: none` it is byte-identical to HEAD.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { archiveFRWithFlip } from "../adapters/_shared/src/archive_fr";
import { stampShippedIn } from "../adapters/_shared/src/plan_ship_stamp";
import { claudeMd, makeSpanFixture, type SpanFixture } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "next_free_milestone_number.ts");

const fixtures: SpanFixture[] = [];
const tempDirs: string[] = [];
afterAll(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function span(): SpanFixture {
  const f = makeSpanFixture("M8", { repositories: false });
  fixtures.push(f);
  return f;
}

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-608-door-${label}-`)));
  tempDirs.push(d);
  return d;
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function door(specsDir: string, token: string): Run {
  const p = Bun.spawnSync(["bun", "run", DOOR, specsDir, token], { stdout: "pipe", stderr: "pipe", cwd: tempDir("cwd") });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function show(r: Run): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function expectTrackerRefusal(r: Run, mode: string): void {
  if (r.exitCode !== 1) throw new Error(`expected exit 1, got:\n${show(r)}`);
  expect(r.stdout).toBe("");
  const lines = r.stderr.trimEnd().split("\n");
  const verdict = lines[0] ?? "";
  expect(verdict).toContain("M999");
  expect(verdict).toContain(mode);
  const remedy = lines.find((l) => l.startsWith("Remedy:")) ?? "";
  expect(remedy).toContain("resolve_milestone_identity.ts");
  expect(lines.some((l) => l.startsWith("Context:"))).toBe(true);
}

type Declaration = { mode: "jira" | "linear"; shared: boolean };

// Named declareMode, never `declare`: Bun's transpiler reads a bare
// `declare(...)` statement as a TypeScript ambient declaration and erases it.
function declareMode(root: string, d: Declaration): void {
  if (d.mode === "jira") {
    claudeMd(root, d.shared
      ? { mode: "jira", project: "GF", defaultLabels: ["glacy-be"], repoTag: "glacy-be", minDptVersion: "2.87.0" }
      : { mode: "jira", project: "GF" });
  } else {
    claudeMd(root, d.shared
      ? { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["dpt-be"], repoTag: "dpt-be", minDptVersion: "2.87.0" }
      : { mode: "linear", team: "STE", project: "DPT" });
  }
}

/** `next_free_milestone_number.ts <specs> M999` under `mode: none` at HEAD (2c99778), measured over an empty specs tree. */
const HEAD_FREE_OUTPUT = [
  "typed=M999",
  "verdict=free",
  "next-free=M1",
  "  active: (none)",
  "  archived: (none)",
  "  changelog: (none)",
  "  tracker: (none)",
  "  branches: (none)",
  "",
].join("\n");

// ===========================================================================
// AC-STE-608.13
// ===========================================================================

describe("AC-STE-608.13 — a typed M<N> is refused in tracker mode", () => {
  const legs: Declaration[] = [
    { mode: "jira", shared: false },
    { mode: "jira", shared: true },
    { mode: "linear", shared: false },
    { mode: "linear", shared: true },
  ];
  for (const leg of legs) {
    test(`mode: ${leg.mode}, ${leg.shared ? "shared" : "unshared"} → exit 1, NFR-10 naming M999 and the mode, remedy names the decision front door`, () => {
      const f = span();
      declareMode(f.a, leg);
      expectTrackerRefusal(door(join(f.a, "specs"), "M999"), leg.mode);
    });
  }

  test("an unreadable CLAUDE.md beside <specsDir> refuses, never read as mode: none", () => {
    const f = span();
    mkdirSync(join(f.a, "CLAUDE.md"));
    const r = door(join(f.a, "specs"), "M999");
    if (r.exitCode !== 1) throw new Error(`expected exit 1, got:\n${show(r)}`);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Remedy:/m);
    expect(r.stderr).toContain("CLAUDE.md");
  });

  test("a malformed `mode:` refuses, never read as mode: none", () => {
    const f = span();
    writeFileSync(join(f.a, "CLAUDE.md"), "# Fixture\n\n## Task Tracking\n\nmode: jira linear\n\n## Verification\n\nrun_cmd: none\n");
    const r = door(join(f.a, "specs"), "M999");
    if (r.exitCode !== 1) throw new Error(`expected exit 1, got:\n${show(r)}`);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Remedy:/m);
    expect(r.stderr).toMatch(/mode/);
  });

  test("(control) permit twin: mode: none prints verdict=free byte-identical to HEAD", () => {
    const f = span();
    writeFileSync(join(f.a, "CLAUDE.md"), "# Fixture\n\n## Task Tracking\n\nmode: none\n\n## Verification\n\nrun_cmd: none\n");
    const r = door(join(f.a, "specs"), "M999");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(HEAD_FREE_OUTPUT);
  });

  test("docs/workflow-overview.md: the explicit-M<N> door row states the tracker-mode refusal", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "workflow-overview.md"), "utf-8");
    const row = doc.split("\n").find((l) => l.startsWith("| nextFreeMilestoneNumber explicit-"));
    expect(row).toBeDefined();
    expect(row!).toMatch(/tracker[- ]mode[^|]*refus|refus[^|]*tracker[- ]mode|(jira|linear)[^|]*refus/i);
    expect(row!).toContain("resolve_milestone_identity");
  });
});

// ===========================================================================
// AC-STE-608.14 — old numeric milestones are untouched
// ===========================================================================

/** Every file under `root`, as relative path → bytes. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p), readFileSync(p, "utf-8"));
    }
  };
  walk(root);
  return out;
}

/** HEAD's (merge-base) copies of the archival and ship-stamp modules, materialised to a temp dir. */
function baseModules(): { archive: string; stamp: string } {
  const base = execFileSync("git", ["-C", REPO_ROOT, "merge-base", "HEAD", "main"]).toString().trim();
  const dir = tempDir("base-src");
  for (const f of ["archive_fr.ts", "plan_ship_stamp.ts", "frontmatter.ts"]) {
    const bytes = execFileSync("git", ["-C", REPO_ROOT, "show", `${base}:plugins/dev-process-toolkit/adapters/_shared/src/${f}`]);
    writeFileSync(join(dir, f), bytes);
  }
  return { archive: join(dir, "archive_fr.ts"), stamp: join(dir, "plan_ship_stamp.ts") };
}

/** A tracker-mode repo holding an active numeric plan M8 with one FR, and a tracker double whose ticket carries `milestone-M8`. */
function numericWorld(mode: "jira" | "linear"): { root: string; tracker: string } {
  const f = span();
  declareMode(f.a, { mode, shared: true });
  f.planA({});
  f.activeFr(f.a, "GF-8", "M8");
  const tracker = join(f.a, "tracker-double.json");
  writeFileSync(tracker, JSON.stringify({ tickets: [{ key: "GF-8", labels: ["glacy-be", "milestone-M8"] }], labelWrites: [], renames: [] }));
  return { root: f.a, tracker };
}

async function archiveAndShip(root: string, mods: { archive: string; stamp: string } | null): Promise<void> {
  const archive = mods ? ((await import(mods.archive)) as { archiveFRWithFlip: typeof archiveFRWithFlip }).archiveFRWithFlip : archiveFRWithFlip;
  const stamp = mods ? ((await import(mods.stamp)) as { stampShippedIn: typeof stampShippedIn }).stampShippedIn : stampShippedIn;
  // /spec-archive M8: move the FR and the plan under archive/, flip both.
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  cpSync(join(root, "specs", "frs", "GF-8.md"), join(root, "specs", "frs", "archive", "GF-8.md"));
  rmSync(join(root, "specs", "frs", "GF-8.md"));
  cpSync(join(root, "specs", "plan", "M8.md"), join(root, "specs", "plan", "archive", "M8.md"));
  rmSync(join(root, "specs", "plan", "M8.md"));
  await archive(root, "specs/frs/GF-8.md", "2026-09-19T00:00:00Z");
  await archive(root, "specs/plan/archive/M8.md", "2026-09-19T00:00:00Z");
  // /ship-milestone M8: stamp the archived plan.
  await stamp(join(root, "specs", "plan", "archive", "M8.md"), "2.88.0");
}

describe("AC-STE-608.14 — an old numeric plan archives and ships as at HEAD", () => {
  for (const mode of ["jira", "linear"] as const) {
    test(`(control) mode: ${mode} — archive_fr.ts + plan_ship_stamp.ts are byte-identical to HEAD on M8; label and filename unchanged`, async () => {
      const now = numericWorld(mode);
      const head = numericWorld(mode);
      await archiveAndShip(now.root, null);
      await archiveAndShip(head.root, baseModules());
      const a = snapshot(now.root);
      const b = snapshot(head.root);
      expect([...a.keys()]).toEqual([...b.keys()]);
      for (const [k, v] of a) expect(v, k).toBe(b.get(k)!);
      const plan = a.get(join("specs", "plan", "archive", "M8.md"))!;
      expect(plan).toMatch(/^milestone: M8$/m);
      const tracker = JSON.parse(readFileSync(now.tracker, "utf-8")) as { tickets: Array<{ labels: string[] }>; labelWrites: unknown[]; renames: unknown[] };
      expect(tracker.labelWrites).toEqual([]);
      expect(tracker.renames).toEqual([]);
      expect(tracker.tickets[0]!.labels).toContain("milestone-M8");
    });
  }

  test("an archived numeric plan is never read by the refusal: the door's verdict names only the typed token", () => {
    const f = span();
    declareMode(f.a, { mode: "jira", shared: true });
    mkdirSync(join(f.a, "specs", "plan", "archive"), { recursive: true });
    writeFileSync(join(f.a, "specs", "plan", "archive", "M8.md"), "---\nmilestone: M8\nstatus: archived\n---\n\n# M8\n");
    const r = door(join(f.a, "specs"), "M999");
    expectTrackerRefusal(r, "jira");
    expect(r.stderr).not.toMatch(/\bM8\b/);
  });
});

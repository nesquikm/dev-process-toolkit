// M_866092 STE-673 — /gate-check probe `video_tooling_uncommitted` (probe #87).
//
// A warning-only probe: in a video-configured project it reports every path the STE-673 lister returns —
// untracked, modified, renamed or deleted video style and tooling under `.dpt/video/` (never
// `.dpt/video/work/**`, never `.dpt/.env`). It never yields GATE FAILED.
//
// AC map (this file):
//   AC-STE-673.6 — reports each listed path at WARNING severity and never yields GATE FAILED; VACUOUS when
//                  `.dpt/video/config.yaml` is absent; CLEAN (non-vacuous, zero rows) when the list is empty.
//                  The registration (#87) and the probe-count cascade are pinned in
//                  tests/m_866092-ste-673-video-commit-nudge.test.ts.
//   AC-STE-673.7 — the "every row is a warning" test below is the target of the error-severity mutation run
//                  from the m_866092 suite.
//
// Contract pinned here (the house shape of the warning-only probes, e.g. #29 / #37):
//
//   adapters/_shared/src/video_tooling_uncommitted.ts
//     export const PROBE_ID = "video_tooling_uncommitted";
//     export async function runVideoToolingUncommittedProbe(projectRoot: string): Promise<Report>
//       — declared EXACTLY as `export async function runVideoToolingUncommittedProbe(` (mutation seam).
//     interface Violation {
//       file: string;      // the listed path, repo-relative (e.g. `.dpt/video/style.yaml`)
//       reason: string;
//       note: string;      // `<file> — <reason>` (a `:line` suffix on <file> is allowed)
//       message: string;   // `video_tooling_uncommitted: …` + `Remedy:` (names video_commit_nudge.ts) + `Context:`
//                          // (Context carries `probe=video_tooling_uncommitted`)
//       severity: "warning";
//     }
//     interface Report { violations: Violation[]; notes: string[]; vacuous: boolean }
//   plus an `if (import.meta.main)` front door: `bun run <module> <projectRoot>` prints each row and ALWAYS
//   exits 0 (warnings never fail the gate).
//
// The probe reuses `listUncommittedVideoTooling` over `git status --porcelain=v1 -z --untracked-files=all`.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const PROBE_ID = "video_tooling_uncommitted";
const MODULE_REL = "adapters/_shared/src/video_tooling_uncommitted.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const LISTER_ABS = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video", "commit_nudge.ts");

interface Violation {
  readonly file: string;
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

type ProbeFn = (projectRoot: string) => Promise<Report>;

async function probe(): Promise<ProbeFn> {
  if (!existsSync(MODULE_ABS)) {
    throw new Error(`${MODULE_REL} does not exist — no probe reports uncommitted video tooling`);
  }
  const mod = (await import(MODULE_ABS)) as Record<string, unknown>;
  expect(mod.PROBE_ID).toBe(PROBE_ID);
  const fn = mod.runVideoToolingUncommittedProbe;
  if (typeof fn !== "function") throw new Error(`${MODULE_REL} does not export \`runVideoToolingUncommittedProbe\``);
  return fn as ProbeFn;
}

// ---------------------------------------------------------------------------
// fixtures — isolated temp git repositories
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

afterAll(() => {
  for (const root of tmpRoots) {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
    expect(existsSync(root)).toBe(false);
  }
});

const GIT_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

function writeFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A temp git repo with one committed source file. `withConfig` commits `.dpt/video/config.yaml` too. */
function repo(slug: string, withConfig: boolean): string {
  const root = mkdtempSync(join(tmpdir(), `ste673-probe-${slug}-`));
  tmpRoots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "STE-673 Probe");
  git(root, "config", "user.email", "ste673-probe@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  writeFile(join(root, "src", "app.ts"), "export const app = 1;\n");
  if (withConfig) writeFile(join(root, ".dpt", "video", "config.yaml"), "provider: google\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: initial");
  return root;
}

/** Negative fixture: config committed then modified; style untracked; plus excluded and outside noise. */
function plantWarnings(root: string): string[] {
  writeFile(join(root, ".dpt", "video", "config.yaml"), "provider: elevenlabs\n");
  writeFile(join(root, ".dpt", "video", "style.yaml"), "palette: house\n");
  writeFile(join(root, ".dpt", "video", "work", "demo", "out.mp4"), "rendered\n");
  writeFile(join(root, ".dpt", ".env"), "KEY=secret\n");
  writeFile(join(root, "src", "app.ts"), "export const app = 2;\n");
  return [".dpt/video/config.yaml", ".dpt/video/style.yaml"];
}

function runFrontDoor(root: string): { code: number; out: string } {
  const p = Bun.spawnSync([process.execPath, "run", MODULE_ABS, root], {
    cwd: PLUGIN_ROOT,
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return { code: p.exitCode ?? -1, out: `${p.stdout.toString()}\n${p.stderr.toString()}` };
}

// ===========================================================================
// AC-STE-673.6 — negative: one warning per listed path
// ===========================================================================

describe("AC-STE-673.6 — uncommitted video tooling is reported, as warnings", () => {
  test("one row per listed path, in the house warning shape", async () => {
    const run = await probe();
    const root = repo("negative", true);
    const expected = plantWarnings(root);
    const report = await run(root);
    expect(report.vacuous).toBe(false);
    expect(report.violations.map((v) => v.file).sort()).toEqual(expected);
    for (const v of report.violations) {
      expect(v.reason.length).toBeGreaterThan(10);
      expect(v.note.startsWith(v.file)).toBe(true);
      expect(v.note).toContain(` — ${v.reason}`);
      expect(v.message.startsWith(`${PROBE_ID}: `)).toBe(true);
      const lines = v.message.split("\n");
      expect(lines.some((l) => l.startsWith("Remedy: ") && l.includes("video_commit_nudge.ts"))).toBe(true);
      expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
      expect(v.message).toContain(`probe=${PROBE_ID}`);
    }
  });

  test("AC-STE-673.6 every row is a warning — never an error", async () => {
    const run = await probe();
    const root = repo("severity", true);
    plantWarnings(root);
    const report = await run(root);
    // Non-vacuity: there ARE rows to grade.
    expect(report.violations.length).toBe(2);
    expect(report.violations.map((v) => v.severity)).toEqual(["warning", "warning"]);
  });

  test("the probe's rows are exactly the lister's output over the same porcelain", async () => {
    const run = await probe();
    const lister = (await import(LISTER_ABS)) as { listUncommittedVideoTooling: (p: string) => string[] };
    const root = repo("reuse", true);
    plantWarnings(root);
    const porcelain = git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all");
    const report = await run(root);
    expect(report.violations.map((v) => v.file).sort()).toEqual(lister.listUncommittedVideoTooling(porcelain));
  });

  test("excluded paths (.dpt/video/work/**, .dpt/.env) and outside paths are never rows", async () => {
    const run = await probe();
    const root = repo("excluded", true);
    plantWarnings(root);
    const files = (await run(root)).violations.map((v) => v.file);
    expect(files.filter((f) => f.startsWith(".dpt/video/work/") || f === ".dpt/.env" || !f.startsWith(".dpt/video/"))).toEqual([]);
  });

  test(
    "never GATE FAILED: the front door exits 0 with warnings and names each path",
    () => {
      const root = repo("door-warn", true);
      const expected = plantWarnings(root);
      const door = runFrontDoor(root);
      expect(door.code, door.out).toBe(0);
      for (const path of expected) expect(door.out).toContain(path);
      expect(door.out).not.toContain("GATE FAILED");
    },
    120_000,
  );

  test("the front door module carries an `if (import.meta.main)` entry", () => {
    expect(existsSync(MODULE_ABS)).toBe(true);
    expect(readFileSync(MODULE_ABS, "utf-8")).toContain("if (import.meta.main)");
  });
});

// ===========================================================================
// AC-STE-673.6 — vacuous and clean
// ===========================================================================

describe("AC-STE-673.6 — vacuous without a video config, clean with an empty list", () => {
  test("vacuous when .dpt/video/config.yaml is absent — even with untracked video files", async () => {
    const run = await probe();
    const root = repo("vacuous", false);
    writeFile(join(root, ".dpt", "video", "style.yaml"), "palette: house\n");
    const report = await run(root);
    expect(report.vacuous).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  test("vacuous (never a crash) on a directory that is not a git repository and has no video config", async () => {
    const run = await probe();
    const root = mkdtempSync(join(tmpdir(), "ste673-probe-nogit-"));
    tmpRoots.push(root);
    const report = await run(root);
    expect(report.vacuous).toBe(true);
    expect(report.violations).toEqual([]);
  });

  test("HARDEN — a video config outside any git repository yields one note naming the failure, no rows, no throw", async () => {
    const run = await probe();
    const root = mkdtempSync(join(tmpdir(), "ste673-probe-nogit-config-"));
    tmpRoots.push(root);
    writeFile(join(root, ".dpt", "video", "config.yaml"), "provider: google\n");
    const report = await run(root);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain("video_tooling_uncommitted: could not list video tooling");
  });

  test("clean — non-vacuous, zero rows — when the config is committed and nothing is uncommitted", async () => {
    const run = await probe();
    const root = repo("clean", true);
    // Only excluded / outside noise.
    writeFile(join(root, ".dpt", "video", "work", "x", "out.mp4"), "rendered\n");
    writeFile(join(root, ".dpt", ".env"), "KEY=1\n");
    writeFile(join(root, "src", "app.ts"), "export const app = 3;\n");
    const report = await run(root);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
  });

  test(
    "the front door exits 0 on a clean tree",
    () => {
      const root = repo("door-clean", true);
      const door = runFrontDoor(root);
      expect(door.code, door.out).toBe(0);
      expect(door.out).not.toContain(".dpt/video/");
    },
    120_000,
  );

  test("the live repository never yields an error-severity row", async () => {
    const run = await probe();
    const report = await run(REPO_ROOT);
    expect(report.violations.filter((v) => v.severity !== "warning")).toEqual([]);
  });
});

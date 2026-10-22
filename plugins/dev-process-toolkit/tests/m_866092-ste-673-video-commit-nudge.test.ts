// STE-673 — offer to commit the house video style and tooling.
//
//   AC-STE-673.1 — `listUncommittedVideoTooling(porcelain)` (adapters/_shared/src/video/commit_nudge.ts) reads
//                  `git status --porcelain=v1 -z --untracked-files=all` output and returns the SORTED paths
//                  under `.dpt/video/` that are untracked, modified, renamed (new path) or deleted. It never
//                  lists `.dpt/video/work/**`, `.dpt/.env`, or anything outside `.dpt/video/`.
//   AC-STE-673.2 — `bun run adapters/_shared/src/video_commit_nudge.ts <projectRoot>` prints `nothing to commit`
//                  or one path per line, exits 0, and changes nothing (git status before == after).
//   AC-STE-673.3 — `... <projectRoot> --commit` stages exactly the listed paths (deletions included) and makes
//                  ONE commit, subject `chore(video): commit the house style and tooling`; `.dpt/.env` and
//                  `.dpt/video/work/` stay untracked; no push / fetch / remote command runs.
//   AC-STE-673.4 — `--commit` with staged changes OUTSIDE the list refuses in NFR-10 shape (Refusing / Remedy /
//                  Context) naming those paths, and creates no commit.
//   AC-STE-673.5 — skills/video/SKILL.md step 12 orders the nudge: after an approved final cut, run the front
//                  door; when it lists paths ask once (default No) naming them; yes → `--commit`; no → move on;
//                  never push.
//   AC-STE-673.6 — registration half (here): probe #87 `video_tooling_uncommitted` in skills/gate-check/SKILL.md,
//                  every probe-count pin moved 86 → 87, both new modules reachable for probe #81. The probe's
//                  own behaviour (warning / vacuous / clean) is in tests/gate-check-video-tooling-uncommitted.test.ts.
//   AC-STE-673.7 — mutation tests: a lister that keeps `.dpt/video/work/` paths, and a probe that reports at
//                  error severity, each turn a named test red (temp overlay; the working tree is never touched;
//                  an unmutated control passes).
//   AC-STE-673.8 — gate-level (full `bun test` from plugins/dev-process-toolkit: 0 failures, skip identities equal
//                  the trunk baseline by name); no dedicated test here.
//
// Seams pinned here (documented for the implementer):
//
//   adapters/_shared/src/video/commit_nudge.ts
//     export function listUncommittedVideoTooling(porcelain: string): string[]
//       — declared EXACTLY as `export function listUncommittedVideoTooling(`; the AC-STE-673.7 mutation wraps
//         that declaration.
//
//   adapters/_shared/src/video_commit_nudge.ts — the front door (`if (import.meta.main)`):
//       bun run video_commit_nudge.ts <projectRoot>            → list or `nothing to commit`, exit 0, no writes
//       bun run video_commit_nudge.ts <projectRoot> --commit   → stage the listed paths + one commit, never push
//     git is invoked as `git` from PATH (the test puts a logging wrapper first on PATH).
//
//   adapters/_shared/src/video_tooling_uncommitted.ts — the probe (see the gate-check test file):
//       export async function runVideoToolingUncommittedProbe(projectRoot: string): Promise<Report>
//       — declared EXACTLY as `export async function runVideoToolingUncommittedProbe(`; the AC-STE-673.7
//         mutation wraps that declaration.
//
// Temp git repositories run with GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1 so no operator hook,
// signing rule or template leaks in. The real repository's `.dpt/` is never read or written.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mutateInRegion } from "./_sited-mutation";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const README = join(REPO_ROOT, "README.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const VIDEO_SKILL = join(PLUGIN_ROOT, "skills", "video", "SKILL.md");
const THIS_FILE_REL = "tests/m_866092-ste-673-video-commit-nudge.test.ts";
const PROBE_TEST_REL = "tests/gate-check-video-tooling-uncommitted.test.ts";

const LISTER_REL = "adapters/_shared/src/video/commit_nudge.ts";
const DOOR_REL = "adapters/_shared/src/video_commit_nudge.ts";
const PROBE_REL = "adapters/_shared/src/video_tooling_uncommitted.ts";
const LISTER_ABS = join(PLUGIN_ROOT, ...LISTER_REL.split("/"));
const DOOR_ABS = join(PLUGIN_ROOT, ...DOOR_REL.split("/"));
const PROBE_ABS = join(PLUGIN_ROOT, ...PROBE_REL.split("/"));

const PROBE_ID = "video_tooling_uncommitted";
const COMMIT_SUBJECT = "chore(video): commit the house style and tooling";

const read = (p: string): string => readFileSync(p, "utf-8");
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// Dynamic import: a missing module or export reds the test that needs it, not the whole file.
type Lister = (porcelain: string) => string[];
async function lister(): Promise<Lister> {
  if (!existsSync(LISTER_ABS)) throw new Error(`${LISTER_REL} does not exist — no lister for uncommitted video tooling`);
  const mod = (await import(LISTER_ABS)) as Record<string, unknown>;
  const fn = mod.listUncommittedVideoTooling;
  if (typeof fn !== "function") throw new Error(`${LISTER_REL} does not export \`listUncommittedVideoTooling\``);
  return fn as Lister;
}

// ---------------------------------------------------------------------------
// helpers — temp roots, isolated git, the front door
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) {
    rmSync(root, { recursive: true, force: true });
    // Bun's rmSync can silently leave a git-created .git behind.
    if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
    expect(existsSync(root)).toBe(false);
  }
});

function writeFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const ISOLATED_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env as Record<string, string>), ...ISOLATED_GIT_ENV, ...extra };
}

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, env: baseEnv(), stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${p.exitCode}): ${p.stderr.toString()}`);
  return p.stdout.toString();
}

const porcelainOf = (root: string): string => git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all");
const headOf = (root: string): string => git(root, "rev-parse", "HEAD").trim();
const stagedOf = (root: string): string[] =>
  git(root, "diff", "--cached", "--name-only", "-z").split("\0").filter((s) => s.length > 0).sort();
const commitCount = (root: string): number => Number.parseInt(git(root, "rev-list", "--count", "HEAD").trim(), 10);

/** A temp repo with committed video tooling, a committed source file and a bogus remote. */
function videoRepo(slug: string): string {
  const root = makeTmpRoot(`ste673-${slug}-`);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "STE-673 Test");
  git(root, "config", "user.email", "ste673@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  // A remote nobody may touch: any fetch/push against it fails loudly AND is logged by the wrapper.
  git(root, "remote", "add", "origin", join(root, "no-such-remote.git"));
  git(root, "config", "remote.origin.pushurl", join(root, "no-such-pushurl.git"));
  writeFile(join(root, ".dpt", "video", "config.yaml"), "provider: google\n");
  writeFile(join(root, ".dpt", "video", "footage", "clip.mp4"), "fake footage bytes\n");
  writeFile(join(root, "src", "app.ts"), "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: initial");
  return root;
}

/**
 * Plant the mixed working state every front-door test uses. Returns the paths the lister must list.
 *   modified   .dpt/video/config.yaml
 *   deleted    .dpt/video/footage/clip.mp4  (unstaged deletion)
 *   untracked  .dpt/video/scenarios/demo.yaml, .dpt/video/recorders/web.ts
 *   NEVER      .dpt/video/work/demo/out.mp4, .dpt/.env (untracked, NO .gitignore — the lister must exclude them)
 *   outside    src/app.ts modified (unstaged), notes.txt untracked
 */
function plantMixedState(root: string): string[] {
  writeFile(join(root, ".dpt", "video", "config.yaml"), "provider: elevenlabs\n");
  unlinkSync(join(root, ".dpt", "video", "footage", "clip.mp4"));
  writeFile(join(root, ".dpt", "video", "scenarios", "demo.yaml"), "steps: []\n");
  writeFile(join(root, ".dpt", "video", "recorders", "web.ts"), "export {};\n");
  writeFile(join(root, ".dpt", "video", "work", "demo", "out.mp4"), "rendered\n");
  writeFile(join(root, ".dpt", ".env"), "ELEVENLABS_API_KEY=secret\n");
  writeFile(join(root, "src", "app.ts"), "export const app = 2;\n");
  writeFile(join(root, "notes.txt"), "scratch\n");
  return [
    ".dpt/video/config.yaml",
    ".dpt/video/footage/clip.mp4",
    ".dpt/video/recorders/web.ts",
    ".dpt/video/scenarios/demo.yaml",
  ];
}

interface DoorRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runDoor(root: string, args: string[] = [], env: Record<string, string> = {}): DoorRun {
  const p = Bun.spawnSync([process.execPath, "run", DOOR_ABS, root, ...args], {
    cwd: PLUGIN_ROOT,
    env: baseEnv(env),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return { code: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

const outLines = (s: string): string[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** A `git` wrapper first on PATH that logs every invocation's argv, then execs the real git. */
function gitWrapper(): { binDir: string; log: string; env: Record<string, string> } {
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("git is not on PATH");
  const dir = makeTmpRoot("ste673-gitwrap-");
  const binDir = join(dir, "bin");
  const log = join(dir, "git-invocations.log");
  writeFile(log, "");
  writeFile(
    join(binDir, "git"),
    ["#!/bin/bash", `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`, `exec ${JSON.stringify(realGit)} "$@"`, ""].join("\n"),
  );
  chmodSync(join(binDir, "git"), 0o755);
  return { binDir, log, env: { PATH: `${binDir}:${process.env.PATH ?? ""}` } };
}

/** The git subcommand of one logged argv line, skipping global options (`-C <dir>`, `-c <k=v>`, flags). */
function subcommandOf(line: string): string | null {
  const toks = line.split(" ").filter((t) => t.length > 0);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t === "-C" || t === "-c" || t === "--git-dir" || t === "--work-tree" || t === "--namespace") {
      i++;
      continue;
    }
    if (t.startsWith("-")) continue;
    return t;
  }
  return null;
}

const REMOTE_SUBCOMMANDS = new Set(["push", "fetch", "pull", "remote", "ls-remote", "send-pack", "clone"]);

// ===========================================================================
// AC-STE-673.1 — the pure lister
// ===========================================================================

/** A recorded-shape `-z` porcelain fixture: entries are NUL-terminated; a rename carries `new\0old\0`. */
const PORCELAIN_FIXTURE = [
  "?? .dpt/video/style.yaml",
  " M .dpt/video/config.yaml",
  "R  .dpt/video/scenarios/new.yaml",
  ".dpt/video/scenarios/old.yaml", // the rename's ORIGINAL path — never listed
  " D .dpt/video/footage/clip.mp4",
  "D  .dpt/video/music/old-theme.mp3",
  "MM .dpt/video/recorders/web.ts",
  "A  .dpt/video/music/theme.mp3",
  "?? .dpt/video/scenarios/my demo.yaml",
  "?? .dpt/video/workshop.yaml", // starts with "work" but is NOT under work/ — listed
  "?? .dpt/video/work/demo/out.mp4",
  " M .dpt/video/work/demo/edl.json",
  "?? .dpt/video/work/other/voice/seg-01.mp3",
  "?? .dpt/.env",
  "?? .dpt/videos/stray.yaml",
  " M .dpt/skip-baseline.json",
  " M src/app.ts",
  "?? README.md",
  "R  docs/video.md",
  "docs/old-video.md",
]
  .map((e) => `${e}\0`)
  .join("");

const FIXTURE_EXPECTED = [
  ".dpt/video/config.yaml",
  ".dpt/video/footage/clip.mp4",
  ".dpt/video/music/old-theme.mp3",
  ".dpt/video/music/theme.mp3",
  ".dpt/video/recorders/web.ts",
  ".dpt/video/scenarios/my demo.yaml",
  ".dpt/video/scenarios/new.yaml",
  ".dpt/video/style.yaml",
  ".dpt/video/workshop.yaml",
];

// Built by concatenation so the AC-STE-673.7 overlay filter never matches its own mutation tests.
const LISTER_TARGET = "AC-STE-673.1 excludes" + " the work tree";

describe("AC-STE-673.1 — listUncommittedVideoTooling", () => {
  test("lists untracked, modified, renamed (new path) and deleted paths under .dpt/video/, sorted", async () => {
    const list = await lister();
    expect(list(PORCELAIN_FIXTURE)).toEqual(FIXTURE_EXPECTED);
  });

  test(`${LISTER_TARGET}: no .dpt/video/work/** path is ever listed`, async () => {
    const list = await lister();
    const got = list(PORCELAIN_FIXTURE);
    expect(got.filter((p) => p.startsWith(".dpt/video/work/"))).toEqual([]);
    // A work-only status lists nothing.
    const workOnly = ["?? .dpt/video/work/a/b.mp4", " M .dpt/video/work/c.json"].map((e) => `${e}\0`).join("");
    expect(list(workOnly)).toEqual([]);
    // Non-vacuity: the fixture really carries work paths.
    expect(PORCELAIN_FIXTURE).toContain(".dpt/video/work/demo/out.mp4");
  });

  test("never lists .dpt/.env, nor any path outside .dpt/video/", async () => {
    const list = await lister();
    const got = list(PORCELAIN_FIXTURE);
    expect(got).not.toContain(".dpt/.env");
    expect(got.filter((p) => !p.startsWith(".dpt/video/"))).toEqual([]);
    expect(list("?? .dpt/.env\0 M src/app.ts\0?? .dpt/videos/x.yaml\0")).toEqual([]);
  });

  test("a rename lists its NEW path only, and its original path is never parsed as an entry", async () => {
    const list = await lister();
    const got = list("R  .dpt/video/scenarios/new.yaml\0.dpt/video/scenarios/old.yaml\0");
    expect(got).toEqual([".dpt/video/scenarios/new.yaml"]);
    // A rename INTO .dpt/video/ from outside lists the new path; a rename out of it does not.
    expect(list("R  .dpt/video/style.yaml\0docs/style.yaml\0")).toEqual([".dpt/video/style.yaml"]);
  });

  test("an empty status lists nothing", async () => {
    const list = await lister();
    expect(list("")).toEqual([]);
  });

  test("against REAL git porcelain from a temp repository, it lists exactly the planted paths", async () => {
    const list = await lister();
    const root = videoRepo("ac1-real");
    const expected = plantMixedState(root);
    expect(list(porcelainOf(root))).toEqual(expected);
  });
});

// ===========================================================================
// AC-STE-673.2 — the front door, read-only
// ===========================================================================

describe("AC-STE-673.2 — the front door lists and changes nothing", () => {
  test("the front door module exists and carries an `if (import.meta.main)` entry", () => {
    expect(existsSync(DOOR_ABS)).toBe(true);
    expect(read(DOOR_ABS)).toContain("if (import.meta.main)");
  });

  test(
    "prints one listed path per line, exits 0, and leaves git status, index and HEAD unchanged",
    () => {
      const root = videoRepo("ac2-list");
      const expected = plantMixedState(root);
      const before = { status: porcelainOf(root), head: headOf(root), staged: stagedOf(root) };
      const run = runDoor(root);
      expect(run.code, run.stderr).toBe(0);
      expect(outLines(run.stdout)).toEqual(expected);
      const after = { status: porcelainOf(root), head: headOf(root), staged: stagedOf(root) };
      expect(after).toEqual(before);
      expect(after.staged).toEqual([]);
    },
    120_000,
  );

  test(
    "prints `nothing to commit` and exits 0 on a repository with no uncommitted video tooling",
    () => {
      const root = videoRepo("ac2-clean");
      // Only excluded / outside noise — the list is empty.
      writeFile(join(root, ".dpt", "video", "work", "x", "out.mp4"), "rendered\n");
      writeFile(join(root, ".dpt", ".env"), "KEY=1\n");
      writeFile(join(root, "src", "app.ts"), "export const app = 3;\n");
      const before = porcelainOf(root);
      const run = runDoor(root);
      expect(run.code).toBe(0);
      expect(outLines(run.stdout)).toEqual(["nothing to commit"]);
      expect(porcelainOf(root)).toBe(before);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-673.3 — the front door with --commit
// ===========================================================================

describe("AC-STE-673.3 — `--commit` stages exactly the list and makes one commit", () => {
  test(
    "one commit with the pinned subject, whose file list equals the lister's output; excluded paths stay untracked; no remote command",
    async () => {
      const list = await lister();
      const root = videoRepo("ac3-commit");
      const expected = plantMixedState(root);
      const listed = list(porcelainOf(root));
      expect(listed).toEqual(expected);
      const countBefore = commitCount(root);
      const wrap = gitWrapper();

      const run = runDoor(root, ["--commit"], wrap.env);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

      // Exactly one new commit, with the pinned subject.
      expect(commitCount(root)).toBe(countBefore + 1);
      expect(git(root, "log", "-1", "--format=%s").trim()).toBe(COMMIT_SUBJECT);

      // The commit's file list equals the lister's output — the deletion included.
      const committed = git(root, "show", "--no-renames", "--name-only", "--format=", "HEAD")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .sort();
      expect(committed).toEqual(listed);
      expect(committed).toContain(".dpt/video/footage/clip.mp4");
      expect(git(root, "ls-tree", "-r", "--name-only", "HEAD")).not.toContain(".dpt/video/footage/clip.mp4");

      // .dpt/.env and .dpt/video/work/ stay untracked; the unstaged outside edit is not committed.
      const after = porcelainOf(root).split("\0");
      expect(after).toContain("?? .dpt/.env");
      expect(after).toContain("?? .dpt/video/work/demo/out.mp4");
      expect(after).toContain(" M src/app.ts");
      expect(after).toContain("?? notes.txt");
      expect(git(root, "ls-files", ".dpt/.env", ".dpt/video/work").trim()).toBe("");

      // Nothing left to nudge about.
      expect(list(porcelainOf(root))).toEqual([]);

      // No push / fetch / remote command ran — and the wrapper really saw the front door's git calls.
      const invocations = outLines(read(wrap.log));
      expect(invocations.length).toBeGreaterThan(0);
      expect(invocations.map(subcommandOf)).toContain("commit");
      const remote = invocations.filter((l) => REMOTE_SUBCOMMANDS.has(subcommandOf(l) ?? ""));
      expect(remote).toEqual([]);
    },
    120_000,
  );

  test(
    "a video path ALREADY staged is part of the list, so `--commit` proceeds",
    () => {
      const root = videoRepo("ac3-prestaged");
      const expected = plantMixedState(root);
      git(root, "add", ".dpt/video/config.yaml");
      const run = runDoor(root, ["--commit"]);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(git(root, "log", "-1", "--format=%s").trim()).toBe(COMMIT_SUBJECT);
      const committed = git(root, "show", "--no-renames", "--name-only", "--format=", "HEAD")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .sort();
      expect(committed).toEqual(expected);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-673.4 — refusal on staged changes outside the list
// ===========================================================================

describe("AC-STE-673.4 — `--commit` refuses when the index holds staged changes outside the list", () => {
  test(
    "refuses in NFR-10 shape naming the staged outside paths; no commit, nothing staged or unstaged",
    () => {
      const root = videoRepo("ac4-refuse");
      plantMixedState(root);
      git(root, "add", "src/app.ts", "notes.txt");
      const before = { status: porcelainOf(root), head: headOf(root), count: commitCount(root) };

      const run = runDoor(root, ["--commit"]);
      const out = `${run.stdout}\n${run.stderr}`;
      expect(run.code).not.toBe(0);
      const lines = out.split("\n").map((l) => l.trim());
      expect(lines.some((l) => l.startsWith("Refusing:"))).toBe(true);
      expect(lines.some((l) => l.startsWith("Remedy:"))).toBe(true);
      expect(lines.some((l) => l.startsWith("Context:"))).toBe(true);
      expect(out).toContain("src/app.ts");
      expect(out).toContain("notes.txt");

      expect({ head: headOf(root), count: commitCount(root) }).toEqual({ head: before.head, count: before.count });
      expect(porcelainOf(root)).toBe(before.status);
      expect(stagedOf(root)).toEqual(["notes.txt", "src/app.ts"]);
    },
    120_000,
  );

  test(
    "a staged excluded path (.dpt/.env) is also outside the list — refused, never committed",
    () => {
      const root = videoRepo("ac4-env");
      plantMixedState(root);
      git(root, "add", ".dpt/.env");
      const head = headOf(root);
      const run = runDoor(root, ["--commit"]);
      const out = `${run.stdout}\n${run.stderr}`;
      expect(run.code).not.toBe(0);
      expect(out).toContain("Refusing:");
      expect(out).toContain(".dpt/.env");
      expect(headOf(root)).toBe(head);
    },
    120_000,
  );

  test(
    "HARDEN — a commit that fails (a refusing pre-commit hook) refuses in NFR-10 shape and leaves nothing newly staged",
    () => {
      const root = videoRepo("harden-hook");
      plantMixedState(root);
      const hook = join(root, ".git", "hooks", "pre-commit");
      writeFile(hook, "#!/bin/sh\nexit 1\n");
      chmodSync(hook, 0o755);
      const before = { head: headOf(root), staged: stagedOf(root), status: porcelainOf(root) };
      const run = runDoor(root, ["--commit"]);
      const out = `${run.stdout}\n${run.stderr}`;
      expect(run.code).not.toBe(0);
      expect(out).toContain("Refusing:");
      expect(out).toContain("Remedy:");
      expect(out).toContain("Context:");
      expect(out).not.toMatch(/^\s+at /m);
      expect(headOf(root)).toBe(before.head);
      expect(stagedOf(root)).toEqual(before.staged);
      expect(porcelainOf(root)).toBe(before.status);
    },
    120_000,
  );

  test("HARDEN — a project root that is not a git repository refuses in NFR-10 shape, no stack trace", () => {
    const root = makeTmpRoot("ste673-nogit-");
    const run = runDoor(root);
    const out = `${run.stdout}\n${run.stderr}`;
    expect(run.code).not.toBe(0);
    expect(out).toContain("Refusing:");
    expect(out).toContain("Remedy:");
    expect(out).toContain("Context:");
    expect(out).not.toMatch(/^\s+at /m);
  });

  test(
    "HARDEN — a staged rename inside .dpt/video/ is not outside the list: --commit commits it",
    () => {
      const root = videoRepo("ac4-rename");
      git(root, "mv", ".dpt/video/footage/clip.mp4", ".dpt/video/footage/intro.mp4");
      const before = commitCount(root);
      const run = runDoor(root, ["--commit"]);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(commitCount(root)).toBe(before + 1);
      const files = git(root, "show", "--name-status", "--no-renames", "--format=", "HEAD").trim().split("\n").sort();
      expect(files).toEqual(["A\t.dpt/video/footage/intro.mp4", "D\t.dpt/video/footage/clip.mp4"]);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-673.5 — skills/video/SKILL.md step 12
// ===========================================================================

function step12(): string {
  const body = read(VIDEO_SKILL);
  const start = body.indexOf("### 12.");
  if (start < 0) throw new Error("skills/video/SKILL.md has no `### 12.` step");
  const rest = body.slice(start);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}

describe("AC-STE-673.5 — /video step 12 offers the commit after an approved final cut", () => {
  test("step 12 runs the front door AFTER the final-cut approval", () => {
    const s = step12();
    const approval = s.search(/approv/i);
    const door = s.indexOf(DOOR_REL);
    expect(approval).toBeGreaterThanOrEqual(0);
    expect(door, "step 12 does not name the front door").toBeGreaterThan(approval);
    expect(s).toMatch(/bun run/);
  });

  test("when it lists paths, step 12 asks ONCE, default No, naming them; yes → `--commit`; no → move on", () => {
    const s = step12();
    const door = s.indexOf(DOOR_REL);
    const afterDoor = s.slice(door);
    const ask = afterDoor.search(/\bask/i);
    expect(ask, "no ask after the front door").toBeGreaterThan(0);
    expect(afterDoor).toMatch(/\bonce\b/i);
    expect(afterDoor).toMatch(/default[^.\n]{0,40}\bNo\b/);
    expect(afterDoor).toMatch(/\bpaths?\b/i);
    const commitFlag = afterDoor.indexOf("--commit");
    expect(commitFlag, "no `--commit` run after the ask").toBeGreaterThan(ask);
    expect(afterDoor.slice(ask)).toMatch(/move on/i);
  });

  test("step 12 never pushes — every mention of push is a negation", () => {
    const s = step12();
    expect(s).toMatch(/never push/i);
    const mentions = [...s.matchAll(/push/gi)];
    expect(mentions.length).toBeGreaterThan(0);
    for (const m of mentions) {
      const before = s.slice(Math.max(0, m.index! - 30), m.index!);
      expect({ at: s.slice(m.index!, m.index! + 30), negated: /\b(never|not|no|without)\b|n't/i.test(before) }).toEqual({
        at: s.slice(m.index!, m.index! + 30),
        negated: true,
      });
    }
  });
});

// ===========================================================================
// AC-STE-673.6 — registration as probe #87, the count cascade, reachability
// ===========================================================================

function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

/** The count before this FR registers its probe — the number that must be gone. */
// Amended by AC-STE-680.6: probe count 86 -> 87 (the previous count moves with the cascade).
// Amended by AC-STE-693.6: probe count 88 -> 89.
const PREVIOUS_PROBE_COUNT = 88;
/** The count after. */
// Amended by AC-STE-680.6: probe count 87 -> 88.
// Amended by AC-STE-693.6: probe count 88 -> 89.
const EXPECTED_PROBE_COUNT = 89;

/**
 * Every surface pinning the probe count: STE-659's enumerated table (AC-STE-659.3) plus the pins that
 * carry an "Amended by AC-STE-659.3" comment but were not in that table. Each must move 86 → 87 with an
 * "Amended by AC-STE-673.6" comment.
 */
const PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],

  ["docs/workflow-overview.md", "+ {N} probes"],
  ["docs/workflow-overview.md", "| {N} conformance probes"],

  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],

  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],

  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`expect(live).toBe({N});`],

  ["tests/m140-ste-543-external-link-verdicts.test.ts", String.raw`const NEW_PROBE_COUNT = {N};`],

  ["tests/m_685ff6-ste-612-probe25-leg.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m_8f07e0-ste-583-spans-repos.test.ts", String.raw`expect(hits.length).toBe({N});`],
  ["tests/m_2306b6-ste-616-shared-tracker-scenarios.test.ts", String.raw`gm)].length).toBe({N});`],
  ["tests/m_6c25dd-ste-659-milestone-name-unasked.test.ts", String.raw`const EXPECTED_PROBE_COUNT = {N};`],
] as const;

const fill = (template: string, n: number): string => template.split("{N}").join(String(n));
const surfaceAbs = (rel: string): string => (rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/")));

describe("AC-STE-673.6 — registered as probe #87, every count pin moved with it", () => {
  // Amended by AC-STE-680.6: probe count 87 -> 88.
  test("the registry is contiguous 1..89", () => {
    expect(probeRegistrationLines().map((r) => r.number)).toEqual(
      Array.from({ length: EXPECTED_PROBE_COUNT }, (_, i) => i + 1),
    );
  });

  test("probe #87 is `video_tooling_uncommitted`, warning-only, in the house idiom", () => {
    const hits = probeRegistrationLines().filter((r) => r.line.includes(PROBE_REL));
    expect(hits.length).toBe(1);
    const row = hits[0]!;
    // Amended by AC-STE-680.6: probe count 87 -> 88 — this probe keeps its own number #87, no longer the total.
    expect(row.number).toBe(87);
    expect(row.line.startsWith(`87. **\`${PROBE_ID}\`**`)).toBe(true);
    expect(row.line).toContain(`call \`runVideoToolingUncommittedProbe(projectRoot)\` from \`${PROBE_REL}\``);
    expect(row.line).toContain("**Severity: warning**");
    expect(row.line).toMatch(/never[^.]{0,40}GATE FAILED/);
    expect(row.line).toContain(".dpt/video/config.yaml");
    expect(row.line).toContain("vacuous");
    expect(row.line).toContain(PROBE_TEST_REL);
  });

  // Amended by AC-STE-680.6: probe count 87 -> 88.
  // Amended by AC-STE-693.6: probe count 88 -> 89.
  test("EVERY enumerated pin reads 89 — and none still reads 88", () => {
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      const body = read(surfaceAbs(rel));
      if (!body.includes(fill(template, EXPECTED_PROBE_COUNT))) missing.push(`${rel} — ${fill(template, EXPECTED_PROBE_COUNT)}`);
      if (body.includes(fill(template, PREVIOUS_PROBE_COUNT))) stale.push(`${rel} — ${fill(template, PREVIOUS_PROBE_COUNT)}`);
    }
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every named surface EXISTS — a pin on a deleted file is not a pin", () => {
    for (const [rel] of PINS) {
      expect({ rel, exists: existsSync(surfaceAbs(rel)) }).toEqual({ rel, exists: true });
    }
  });

  test("each amended test pin carries an `Amended by AC-STE-673.6` comment", () => {
    const files = [...new Set(PINS.map(([rel]) => rel).filter((rel) => rel.startsWith("tests/")))];
    const without = files.filter((rel) => !read(surfaceAbs(rel)).includes("Amended by AC-STE-673.6"));
    expect(without).toEqual([]);
  });

  // Amended by AC-STE-680.6: the next unregistered number is #89 at 88 live registrations.
  test("the front-door warning names the NEXT unregistered number (#90), in both places", () => {
    const skill = read(GATE_CHECK_SKILL);
    // Amended by AC-STE-693.6: the next unregistered number is #90 at 89 live registrations.
    expect(skill).toContain("registering probe #90 will turn probe #81 red");
    // Amended by AC-STE-693.6: probe count 88 -> 89.
    expect(skill).not.toContain("registering probe #89 will turn probe #81 red");
    const m140 = read(surfaceAbs("tests/m140-ste-543-external-link-verdicts.test.ts"));
    // Amended by AC-STE-693.6: #89 -> #90.
    expect(m140).toContain("registering probe #90 will turn probe #81 red");
  });

  // Amended by AC-STE-680.6: the NEXT-row tripwire moves #88 -> #89.
  test("M141's `no NEXT row` tripwire moved to #90", () => {
    const body = read(surfaceAbs("tests/m141-ste-546-surface-agreement.test.ts"));
    // Amended by AC-STE-693.6: the NEXT-row tripwire moves #89 -> #90.
    expect(body).toContain(String.raw`/^90\. \*\*/m`);
    // Amended by AC-STE-693.6: probe count 88 -> 89.
    expect(body).not.toContain(String.raw`/^89\. \*\*/m`);
  });

  test("the probe module carries an `if (import.meta.main)` entry", () => {
    expect(existsSync(PROBE_ABS)).toBe(true);
    expect(read(PROBE_ABS)).toContain("if (import.meta.main)");
  });

  test("probe #81 grades every reference to the probe module and the front door REACHABLE", async () => {
    const mod = (await import(join(SRC, "module_reachability.ts"))) as {
      runModuleReachabilityProbe: (root: string) => Promise<{
        records: { module: string; reachable: boolean; surface: string; line: number }[];
      }>;
    };
    const report = await mod.runModuleReachabilityProbe(REPO_ROOT);
    for (const rel of [PROBE_REL, DOOR_REL]) {
      const records = report.records.filter((r) => r.module.includes(rel));
      // ANTI-VACUITY: the registration row and step 12 are references; zero means the walk never saw them.
      expect(records.length, `no shipped surface references ${rel}`).toBeGreaterThan(0);
      expect(records.filter((r) => !r.reachable), `${rel} is ordered but unreachable`).toEqual([]);
    }
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-673.7 — mutation tests
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

/**
 * Materialise a temp overlay of the plugin (adapters/_shared/src, both STE-673 suites, the sited-mutation
 * helper), optionally mutate one module IN THE OVERLAY, assert the mutation landed, and run `suiteRel`
 * filtered to `filter`. The working tree is never touched.
 */
function runOverlay(
  suiteRel: string,
  filter: string,
  mutation: { moduleRel: string; find: string; repl: string; marker: string } | null,
): OverlayRun {
  const root = makeTmpRoot("ste673-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(SRC)} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, PROBE_TEST_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_nested_bun_test.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  if (existsSync(join(REPO_ROOT, "node_modules"))) symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  let mutatedSource: string | null = null;
  if (mutation !== null) {
    const target = join(plugin, mutation.moduleRel);
    expect(existsSync(target)).toBe(true);
    const before = readFileSync(target, "utf8");
    const after = mutateInRegion(before, 0, before.length, mutation.find, mutation.repl, {
      label: `${mutation.moduleRel} (whole module)`,
    });
    writeFileSync(target, after);
    // The mutation is asserted APPLIED before the target test runs.
    mutatedSource = readFileSync(target, "utf8");
    expect(mutatedSource).not.toBe(before);
    expect(mutatedSource).toContain(mutation.marker);
    expect(sha256(mutatedSource)).not.toBe(sha256(before));
  }

  const proc = runNestedBunTest([suiteRel, "-t", filter], { cwd: plugin, env: baseEnv() });
  return { code: proc.exitCode, output: `${proc.stdout}\n${proc.stderr}`, mutatedSource };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
/** Summary counts; "(pass)" rows are suppressed in agent sessions, so controls grade on counts. */
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

// The probe suite's target test title, built by concatenation for the same reason as LISTER_TARGET.
const PROBE_TARGET = "AC-STE-673.6 every row" + " is a warning";

describe("AC-STE-673.7 — the lister's exclusion and the probe's severity are mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the work-tree exclusion test",
    () => {
      const run = runOverlay(THIS_FILE_REL, LISTER_TARGET, null);
      // Non-vacuous: a filter matching zero tests also exits 0.
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, LISTER_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "a lister that keeps .dpt/video/work/ paths turns the work-tree exclusion test red",
    () => {
      const marker = "/* MUTATION:STE-673.7:keeps-work */";
      const run = runOverlay(THIS_FILE_REL, LISTER_TARGET, {
        moduleRel: LISTER_REL,
        find: "export function listUncommittedVideoTooling(",
        repl:
          `export function listUncommittedVideoTooling(porcelain: string): string[] { ${marker} ` +
          'const work = porcelain.split("\\0").filter((e) => e.length > 3 && e.slice(3).startsWith(".dpt/video/work/")).map((e) => e.slice(3)); ' +
          "return [...(__unmutated_listUncommittedVideoTooling as any)(porcelain), ...work].sort(); }\n" +
          "function __unmutated_listUncommittedVideoTooling(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, LISTER_TARGET), run.output.slice(-800)).toBe(true);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );

  test(
    "control: the unmutated overlay passes the probe's warning-severity test",
    () => {
      const run = runOverlay(PROBE_TEST_REL, PROBE_TARGET, null);
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, PROBE_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "a probe that reports at error severity turns the warning-severity test red",
    () => {
      const marker = "/* MUTATION:STE-673.7:error-severity */";
      const run = runOverlay(PROBE_TEST_REL, PROBE_TARGET, {
        moduleRel: PROBE_REL,
        find: "export async function runVideoToolingUncommittedProbe(",
        repl:
          `export async function runVideoToolingUncommittedProbe(...a: any[]): Promise<any> { ${marker} ` +
          "const r: any = await (__unmutated_runVideoToolingUncommittedProbe as any)(...a); " +
          'return { ...r, violations: r.violations.map((v: any) => ({ ...v, severity: "error" })) }; }\n' +
          "async function __unmutated_runVideoToolingUncommittedProbe(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, PROBE_TARGET), run.output.slice(-800)).toBe(true);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});

// AC-STE-673.8 — gate-level: the full `bun test` from plugins/dev-process-toolkit reports 0 failures and its
// skip identities equal the trunk baseline by name. Graded by the gate run, not by a test in this file.

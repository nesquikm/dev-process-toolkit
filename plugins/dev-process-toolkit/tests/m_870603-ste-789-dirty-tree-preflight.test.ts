// M_870603 / STE-789 — the conformance loop refuses a dirty tree before it
// spawns, and /smoke-test's pre-flight #4 refusal writes a fresh fail verdict.
//
// WHY THE NEW PRE-FLIGHT IS EXECUTED, NOT GREPPED. The defect STE-789 closes
// is "the loop passed its own checks, spawned three legs, and all three died
// on a dirty tree". A paragraph describing a dirty-tree guard is not a guard,
// so the new pre-flight's fenced bash probe is EXTRACTED from the loop SKILL
// and RUN under bash against a clean and a dirty throwaway git repo. The
// absence assertions ("no pidfile, no log") are kept honest the same way
// m121-ste-447-legs-selector.test.ts keeps them honest: a REACHABILITY ANCHOR
// (the clean repo reaches the continuation and writes the artifacts) and a
// FALSIFIABILITY WITNESS (the probe stripped, the dirty repo reaches it too).
//
// The fence is located by the probe it must run (`git status --porcelain`)
// inside the `## Pre-flight refusals` section — never by a letter or a token
// this file invents. It resolves the toolkit root from its cwd (or from a
// TOOLKIT_ROOT variable, set here to the same directory), so the harness runs
// it with cwd = the temp repo and never touches the shared working tree.
//
// AC-STE-789.1 — the pre-flight runs `git status --porcelain`, refuses in the
//   NFR-10 shape naming the paths, and runs before (c) and before any
//   pidfile/log is written.
// AC-STE-789.2 — the stated anchor count equals the recomputed one, and the
//   new pre-flight contributes an anchor to it.
// AC-STE-789.3 — /smoke-test pre-flight #4 writes the verdict artifact with
//   outcome `fail` before exiting.
// AC-STE-789.4 — the orchestrator's full-suite gate; nothing to pin here.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bashFences, mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");
const SMOKE_SKILL = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

/** Repo-local dogfood skills: absent from an installed plugin, so skip there. */
function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const smoke = readIfPresent(SMOKE_SKILL);
const describeIfLoop = loop ? describe : describe.skip;
const describeIfSmoke = smoke ? describe : describe.skip;

/** The `## Pre-flight refusals` section of the loop SKILL, up to `## Flow`. */
function preflightSection(): string {
  const start = loop!.indexOf("## Pre-flight refusals");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = loop!.indexOf("\n## Flow", start);
  expect(end).toBeGreaterThan(start);
  return loop!.slice(start, end);
}

/** The bash fence in the pre-flight section that runs `git status --porcelain`. */
function dirtyTreeFence(): string {
  return bashFences(preflightSection()).find((f) => /git\b[^\n]*status --porcelain/.test(f)) ?? "";
}

/**
 * The lettered paragraph introducing the new pre-flight: the line starting
 * `(i) ` through the next lettered/numbered refusal paragraph or the anchor
 * summary sentence.
 */
function preflightIParagraph(): string {
  const section = preflightSection();
  const start = section.search(/^\(i\) /m);
  if (start < 0) return "";
  const rest = section.slice(start + 4);
  const next = rest.search(/^\((?:[a-h0])\) |^Each refusal above carries/m);
  return section.slice(start, next < 0 ? undefined : start + 4 + next);
}

/** Stands in for everything the guard must prevent: pidfiles, logs, a spawn. */
const CONTINUATION = `
# --- test-only continuation: everything the dirty-tree pre-flight must prevent
echo $$ > "\${OUTDIR}/iter-1-linear.pid"
: > "\${OUTDIR}/iter-1-linear.log"
echo "SPAWNED"
`;

const COMMITTED = "committed.txt";

/** A throwaway git repo with one committed file; clean on return. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ste789-repo-"));
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(["git", ...args], { cwd: dir, env: gitEnv() });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString()}`);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "ste789");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, COMMITTED), "one\n");
  git("add", COMMITTED);
  git("commit", "-q", "--no-verify", "-m", "seed");
  return dir;
}

/** The process env minus every GIT_* variable, so the temp repo is the repo. */
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  return env;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  artifacts: string[];
}

function runFence(repo: string, fence: string = dirtyTreeFence()): RunResult {
  const outDir = mkdtempSync(join(tmpdir(), "ste789-out-"));
  try {
    const script = `set -u\nOUTDIR=${JSON.stringify(outDir)}\n${fence}\n${CONTINUATION}`;
    const env = { ...gitEnv(), TOOLKIT_ROOT: repo };
    const proc = Bun.spawnSync(["bash", "-c", script], { cwd: repo, env });
    return {
      status: proc.exitCode ?? -1,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      artifacts: readdirSync(outDir).sort(),
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function withRepo<T>(fn: (repo: string) => T): T {
  const repo = makeRepo();
  try {
    return fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// ===========================================================================
// AC-STE-789.1 — the dirty-tree pre-flight, executed.
// ===========================================================================

describeIfLoop("AC-STE-789.1 — the loop refuses a dirty toolkit tree before any spawn", () => {
  test("AC-STE-789.1: the pre-flight section carries a bash fence that runs `git status --porcelain`", () => {
    // Without this every run below would execute an empty fence, which exits
    // 0 and writes nothing — satisfying the refusal tests for the wrong reason.
    const fence = dirtyTreeFence();
    expect(fence).toMatch(/git\b[^\n]*status --porcelain/);
    expect(fence).toContain("exit");
  });

  test("AC-STE-789.1: REACHABILITY ANCHOR — a clean repo passes the probe and reaches the continuation", () => {
    withRepo((repo) => {
      const r = runFence(repo);
      expect(r.stderr).not.toContain("Remedy:");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("SPAWNED");
      expect(r.artifacts).toEqual(["iter-1-linear.log", "iter-1-linear.pid"]);
    });
  });

  test("AC-STE-789.1: an untracked file refuses non-zero, before any pidfile or log", () => {
    withRepo((repo) => {
      writeFileSync(join(repo, "stray-untracked.txt"), "x\n");
      const r = runFence(repo);
      expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain("SPAWNED");
      expect(r.artifacts).toEqual([]);
    });
  });

  test("AC-STE-789.1: the refusal names the offending untracked path", () => {
    withRepo((repo) => {
      writeFileSync(join(repo, "stray-untracked.txt"), "x\n");
      const r = runFence(repo);
      expect(r.stderr).toContain("stray-untracked.txt");
    });
  });

  test("AC-STE-789.1: a modified tracked file refuses too, and is named", () => {
    withRepo((repo) => {
      writeFileSync(join(repo, COMMITTED), "two\n");
      const r = runFence(repo);
      expect(r.status).not.toBe(0);
      expect(r.artifacts).toEqual([]);
      expect(r.stderr).toContain(COMMITTED);
    });
  });

  test("AC-STE-789.1: the refusal is NFR-10 shaped — message, Remedy:, Context: skill=conformance-loop", () => {
    withRepo((repo) => {
      writeFileSync(join(repo, "stray-untracked.txt"), "x\n");
      const lines = runFence(repo).stderr.split("\n").filter((l) => l.trim() !== "");
      const remedy = lines.findIndex((l) => l.startsWith("Remedy:"));
      const context = lines.findIndex((l) => l.startsWith("Context: skill=conformance-loop"));
      expect(remedy).toBeGreaterThan(0); // a message line precedes it
      expect(context).toBeGreaterThan(remedy);
    });
  });

  test("AC-STE-789.1: FALSIFIABILITY WITNESS — with the probe stripped, a dirty repo reaches the spawn", () => {
    withRepo((repo) => {
      writeFileSync(join(repo, "stray-untracked.txt"), "x\n");
      const stripped = mutate(dirtyTreeFence(), /git\b[^\n]*?status --porcelain/, "printf ''");
      const r = runFence(repo, stripped);
      expect(r.status).toBe(0);
      expect(r.artifacts).toEqual(["iter-1-linear.log", "iter-1-linear.pid"]);
    });
  });

  test("AC-STE-789.1: the new pre-flight takes the letter (i) and its fence sits in its paragraph", () => {
    const para = preflightIParagraph();
    expect(para).not.toBe("");
    expect(para).toMatch(/git\b[^\n]*status --porcelain/);
  });

  test("AC-STE-789.1: (i) states it runs before pre-flight (c) and before any pidfile or log", () => {
    const para = preflightIParagraph();
    expect(para).toMatch(/before (?:pre-flight )?\(c\)/);
    expect(para).toMatch(/pidfile/);
    expect(para).toMatch(/\blog\b/);
  });

  test("AC-STE-789.1: the section's refusal roster names (a)–(i), not (a)–(h)", () => {
    const section = preflightSection();
    expect(section).toMatch(/\(0\) plus \(a\)–\(i\)/);
    expect(section).not.toMatch(/\(0\) plus \(a\)–\(h\)/);
  });
});

// ===========================================================================
// AC-STE-789.2 — the anchor count is updated and still derived.
// ===========================================================================

/** Anchor rule shared with m121-ste-447: a mention that ends in ":" introduces a fence. */
function countAnchors(text: string): number {
  return text
    .split("\n")
    .filter((line) => line.includes("NFR-10 canonical refusal") && line.trimEnd().endsWith(":"))
    .length;
}

describeIfLoop("AC-STE-789.2 — the stated refusal-anchor count is updated", () => {
  test("AC-STE-789.2: the new pre-flight (i) contributes exactly one refusal anchor", () => {
    expect(countAnchors(preflightIParagraph())).toBe(1);
  });

  test("AC-STE-789.2: the anchor count named in the prose equals the recomputed count", () => {
    const section = preflightSection();
    const stated = /There are \*\*(\d+) refusal anchors\*\*/.exec(section);
    expect(stated).not.toBeNull();
    expect(countAnchors(section)).toBe(Number(stated![1]));
  });

  test("AC-STE-789.2: the anchor-summary sentence accounts for (i) by letter", () => {
    const summary = /There are \*\*\d+ refusal anchors\*\*[^\n]*/.exec(preflightSection());
    expect(summary).not.toBeNull();
    expect(summary![0]).toContain("(i)");
  });
});

// ===========================================================================
// AC-STE-789.3 — /smoke-test pre-flight #4 writes a fresh fail verdict.
// ===========================================================================

/** The text of /smoke-test pre-flight #4, from its "4. " line to the "5. " line. */
function smokePreflight4(): string {
  const start = smoke!.search(/^4\. \*\*Uncommitted changes in the toolkit repo\.\*\*/m);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = smoke!.slice(start);
  const end = rest.search(/^5\. \*\*/m);
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

describeIfSmoke("AC-STE-789.3 — smoke-test pre-flight #4 writes the verdict artifact on refusal", () => {
  test("AC-STE-789.3: pre-flight #4 names the verdict artifact or its writer", () => {
    expect(smokePreflight4()).toMatch(/smoke_verdict\.ts|dpt-smoke-verdict-<tracker>\.json/);
  });

  test("AC-STE-789.3: pre-flight #4 records outcome `fail`", () => {
    expect(smokePreflight4()).toMatch(/outcome[^\n]*`fail`|--outcome fail/);
  });

  test("AC-STE-789.3: pre-flight #4 writes the verdict BEFORE exiting", () => {
    expect(smokePreflight4()).toMatch(/before (?:it )?exit/i);
  });

  test("AC-STE-789.3: pre-flight #4 ties the write to the final-message self-check's write", () => {
    expect(smokePreflight4()).toMatch(/[Ff]inal-message self-check/);
  });
});

// Pass 2 review (M_870603): with no TOOLKIT_ROOT and no git checkout around the
// working directory, the fence refuses rather than inspecting an empty -C root.
describeIfLoop("AC-STE-789.1 — an unresolved toolkit root refuses", () => {
  test("AC-STE-789.1 — outside any checkout with TOOLKIT_ROOT unset, the fence exits non-zero before the continuation", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste789-noroot-"));
    const outDir = mkdtempSync(join(tmpdir(), "ste789-out-"));
    try {
      const script = `set -u\nOUTDIR=${JSON.stringify(outDir)}\n${dirtyTreeFence()}\n${CONTINUATION}`;
      const env = { ...gitEnv(), GIT_CEILING_DIRECTORIES: tmpdir() };
      delete (env as Record<string, string>).TOOLKIT_ROOT;
      const proc = Bun.spawnSync(["bash", "-c", script], { cwd: dir, env });
      expect(proc.exitCode).not.toBe(0);
      expect(proc.stderr.toString()).toMatch(/Context: skill=conformance-loop, pre-flight=dirty_tree, root=unresolved/);
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

// STE-662 — the skip-baseline capture checks its preconditions FIRST.
//
// AC-STE-662.1 .. AC-STE-662.5. `runCapture` used to run the whole gate (a
// fifteen-minute suite on this repo) and only then let `captureSkipBaseline`
// refuse an off-trunk HEAD or a dirty tree. The fix exports the one precondition
// function from `skip_baseline.ts` and calls it from `runCapture` before the
// gate starts; the late check inside `captureSkipBaseline` stays.
//
// HOW "THE GATE NEVER RAN" IS PROVEN. Each fixture project is a real git repo
// whose detected gate is `bun test` (marker: `package.json`). Its one test file
// writes a MARKER FILE, at an absolute path OUTSIDE the project, the moment the
// runner loads it. A refusal that fired before the gate leaves no marker; a
// refusal that fired after it leaves one. The marker lives outside the project
// so that writing it cannot itself dirty the tree being judged.
//
// THE MODULE ROOT is overridable through `STE662_SRC_ROOT` so the mutation
// battery (`ste-662-mutations.test.ts`, AC-STE-662.10) can run THESE assertions
// against a mutated copy. Unset, it is the shipped `adapters/_shared/src`.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC_ROOT = process.env.STE662_SRC_ROOT ?? resolve(import.meta.dir, "../adapters/_shared/src");

interface CaptureModule {
  runCapture(projectRoot: string): unknown;
}

interface SkipBaselineModule {
  captureSkipBaseline(projectRoot: string, sha: string, skipped: number): unknown;
  resolveTrunkSha(projectRoot: string): string | null;
  [name: string]: unknown;
}

async function loadCapture(): Promise<CaptureModule> {
  return (await import(join(SRC_ROOT, "capture_skip_baseline.ts"))) as CaptureModule;
}

async function loadSkipBaseline(): Promise<SkipBaselineModule> {
  return (await import(join(SRC_ROOT, "skip_baseline.ts"))) as SkipBaselineModule;
}

// ===========================================================================
// Throwaway trees — all under the OS temp dir, none inside this repository.
// ===========================================================================

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste662-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(
    [
      "git",
      "-c", "user.email=t@t.test",
      "-c", "user.name=t",
      "-c", "commit.gpgsign=false",
      "-c", "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

interface Fixture {
  readonly root: string;
  /** Absolute path the gate writes when it runs — outside `root`. */
  readonly marker: string;
  /** The `main` commit. */
  readonly trunkSha: string;
}

/**
 * A real git project standing on `main`, clean, whose detected gate is
 * `bun test` and whose only test file writes `marker` when loaded.
 *
 * `dirtyOnRun` names a file the gate ALSO writes inside the project, so the
 * tree is clean before the gate and dirty after it (AC-STE-662.5).
 */
function makeFixture(label: string, dirtyOnRun?: string): Fixture {
  const root = tempDir(`proj-${label}`);
  const marker = join(tempDir(`marker-${label}`), "gate-ran");

  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: `ste662-${label}`, private: true })}\n`);
  mkdirSync(join(root, "tests"), { recursive: true });
  const body = [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { expect, test } from "bun:test";',
    "",
    `writeFileSync(${JSON.stringify(marker)}, "the gate ran\\n");`,
    dirtyOnRun === undefined
      ? ""
      : `writeFileSync(join(import.meta.dir, "..", ${JSON.stringify(dirtyOnRun)}), "written mid-run\\n");`,
    "",
    'test("one real assertion", () => {',
    "  expect(1 + 1).toBe(2);",
    "});",
    "",
  ].join("\n");
  writeFileSync(join(root, "tests", "marker.test.ts"), body);

  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: fixture"]);
  const trunkSha = git(root, ["rev-parse", "HEAD"]);

  return { root, marker, trunkSha };
}

/** A fixture whose HEAD is one commit AHEAD of `main` — not the trunk commit. */
function offTrunkFixture(label: string): Fixture {
  const fx = makeFixture(label);
  git(fx.root, ["checkout", "-q", "-b", "feat/off-trunk"]);
  writeFileSync(join(fx.root, "ahead.txt"), "one commit past main\n");
  git(fx.root, ["add", "-A"]);
  git(fx.root, ["commit", "-q", "-m", "feat: ahead"]);
  return fx;
}

/** A fixture on the trunk commit with exactly one untracked file. */
function dirtyFixture(label: string, stray: string): Fixture {
  const fx = makeFixture(label);
  writeFileSync(join(fx.root, stray), "untracked\n");
  return fx;
}

function thrownMessage(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

// ===========================================================================
// Source reading — AC-STE-662.1 is a claim about where the condition lives.
// ===========================================================================

const SKIP_BASELINE_SRC = () => readFileSync(join(SRC_ROOT, "skip_baseline.ts"), "utf-8");
const CAPTURE_SRC = () => readFileSync(join(SRC_ROOT, "capture_skip_baseline.ts"), "utf-8");

interface FunctionDecl {
  readonly name: string;
  readonly exported: boolean;
  readonly start: number;
  readonly body: string;
}

/** Every top-level `function NAME(` declaration with its body (to the next column-0 `}`). */
function functionDecls(source: string): FunctionDecl[] {
  const decls: FunctionDecl[] = [];
  for (const match of source.matchAll(/^(export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const start = match.index ?? 0;
    const end = source.indexOf("\n}\n", start);
    decls.push({
      name: match[2] as string,
      exported: match[1] !== undefined,
      start,
      body: source.slice(start, end === -1 ? source.length : end + 2),
    });
  }
  return decls;
}

const HEAD_CONDITION = /\[\s*"rev-parse"\s*,\s*"HEAD"\s*\]/g;
const DIRTY_CONDITION = /(?<!function\s)\boffendingPaths\s*\(/g;

/** The exported precondition function's name, derived from the source. */
function preconditionName(): string {
  const decls = functionDecls(SKIP_BASELINE_SRC());
  const holders = decls.filter((decl) => /\boffendingPaths\s*\(\s*projectRoot/.test(decl.body) && decl.name !== "offendingPaths");
  if (holders.length !== 1) {
    throw new Error(`expected exactly one function holding the dirty-tree condition, found ${holders.map((h) => h.name).join(", ") || "none"}`);
  }
  return (holders[0] as FunctionDecl).name;
}

describe("AC-STE-662.1 — one exported precondition check, called before and after the gate", () => {
  test("skip_baseline.ts holds each condition exactly once, inside ONE exported function", () => {
    const source = SKIP_BASELINE_SRC();
    expect([...source.matchAll(HEAD_CONDITION)].length, "the HEAD condition appears once").toBe(1);
    expect([...source.matchAll(DIRTY_CONDITION)].length, "the dirty-tree condition is evaluated once").toBe(1);

    const name = preconditionName();
    const decl = functionDecls(source).find((d) => d.name === name) as FunctionDecl;
    expect(decl.body).toMatch(HEAD_CONDITION);
    expect(decl.exported, `\`${name}\` must be exported so runCapture can call it`).toBe(true);
  });

  test("captureSkipBaseline calls that function (the late check stays)", () => {
    const name = preconditionName();
    const capture = functionDecls(SKIP_BASELINE_SRC()).find((d) => d.name === "captureSkipBaseline");
    expect(capture, "captureSkipBaseline is a top-level function").toBeDefined();
    expect((capture as FunctionDecl).body).toMatch(new RegExp(`\\b${name}\\s*\\(`));
  });

  test("runCapture imports it from ./skip_baseline and calls it BEFORE the gate runs", () => {
    const name = preconditionName();
    const source = CAPTURE_SRC();

    const importLine = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/skip_baseline"/g)]
      .map((m) => m[1] as string)
      .join(",");
    expect(importLine.split(",").map((s) => s.trim()), `capture_skip_baseline imports \`${name}\``).toContain(name);

    const run = functionDecls(source).find((d) => d.name === "runCapture");
    expect(run, "runCapture is a top-level function").toBeDefined();
    const body = (run as FunctionDecl).body;
    const call = body.search(new RegExp(`\\b${name}\\s*\\(`));
    const gate = body.indexOf("runGateNamingSkips(");
    expect(call, `runCapture calls \`${name}\``).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(call, "the pre-flight call precedes the gate run").toBeLessThan(gate);
  });

  test("no second copy of either condition lives in the capture front door", () => {
    const source = CAPTURE_SRC();
    expect(source).not.toMatch(HEAD_CONDITION);
    expect(source).not.toMatch(/"--porcelain"/);
    expect(source).not.toMatch(/refusing to capture/);
  });

  test("the exported function is callable and refuses a dirty tree with the late check's words", async () => {
    const mod = await loadSkipBaseline();
    const name = preconditionName();
    const fn = mod[name];
    expect(typeof fn).toBe("function");

    const fx = dirtyFixture("export-callable", "stray-export.txt");
    const direct = thrownMessage(() => (fn as (root: string, sha: string) => void)(fx.root, fx.trunkSha));
    const late = thrownMessage(() => mod.captureSkipBaseline(fx.root, fx.trunkSha, 0));
    expect(direct).not.toBeNull();
    expect(direct).toBe(late);
  });
});

describe("AC-STE-662.2 — off-trunk HEAD refuses before the gate runs", () => {
  test("runCapture throws the HEAD-mismatch refusal and the marker file is absent", async () => {
    const { runCapture } = await loadCapture();
    const fx = offTrunkFixture("off-trunk");

    // Precondition of the fixture itself: HEAD is not the trunk commit.
    expect(git(fx.root, ["rev-parse", "HEAD"])).not.toBe(fx.trunkSha);
    expect(existsSync(fx.marker)).toBe(false);

    const message = thrownMessage(() => runCapture(fx.root));
    expect(message, "runCapture must refuse").not.toBeNull();
    expect(message).toContain(`refusing to capture a baseline for ${fx.trunkSha}`);
    expect(message).toMatch(/HEAD here is [0-9a-f]{40}, which is not the sha being captured/);
    expect(existsSync(fx.marker), "the gate must never have run").toBe(false);
  }, 120_000);
});

describe("AC-STE-662.3 — a dirty tree refuses before the gate runs", () => {
  test("runCapture throws the dirty-tree refusal naming the file and the marker file is absent", async () => {
    const { runCapture } = await loadCapture();
    const fx = dirtyFixture("dirty", "stray-untracked.txt");

    expect(git(fx.root, ["rev-parse", "HEAD"])).toBe(fx.trunkSha);

    const message = thrownMessage(() => runCapture(fx.root));
    expect(message, "runCapture must refuse").not.toBeNull();
    expect(message).toContain("working tree is not clean");
    expect(message).toContain("stray-untracked.txt");
    expect(existsSync(fx.marker), "the gate must never have run").toBe(false);
  }, 120_000);
});

describe("AC-STE-662.4 — the early refusal says exactly what the late one says", () => {
  test("HEAD mismatch: runCapture's text is byte-identical to captureSkipBaseline's", async () => {
    const { runCapture } = await loadCapture();
    const mod = await loadSkipBaseline();
    const fx = offTrunkFixture("bytes-head");

    const sha = mod.resolveTrunkSha(fx.root);
    expect(sha).toBe(fx.trunkSha);
    const early = thrownMessage(() => runCapture(fx.root));
    const late = thrownMessage(() => mod.captureSkipBaseline(fx.root, sha as string, 0));
    expect(late).not.toBeNull();
    expect(early).toBe(late);
  }, 120_000);

  test("dirty tree: runCapture's text is byte-identical to captureSkipBaseline's", async () => {
    const { runCapture } = await loadCapture();
    const mod = await loadSkipBaseline();
    const fx = dirtyFixture("bytes-dirty", "stray-bytes.txt");

    const sha = mod.resolveTrunkSha(fx.root);
    expect(sha).toBe(fx.trunkSha);
    const early = thrownMessage(() => runCapture(fx.root));
    const late = thrownMessage(() => mod.captureSkipBaseline(fx.root, sha as string, 0));
    expect(late).not.toBeNull();
    expect(early).toBe(late);
  }, 120_000);
});

describe("AC-STE-662.5 — the late check still fires when the tree turns dirty mid-run", () => {
  test("a gate that dirties the tree passes the pre-flight, runs, and is refused afterwards", async () => {
    const { runCapture } = await loadCapture();
    const fx = makeFixture("late-dirt", "late-dirt.txt");

    // Clean before the run: the pre-flight has nothing to refuse.
    expect(git(fx.root, ["status", "--porcelain", "--untracked-files=normal"])).toBe("");

    const message = thrownMessage(() => runCapture(fx.root));
    expect(message, "the late check must refuse").not.toBeNull();
    expect(message).toContain("working tree is not clean");
    expect(message).toContain("late-dirt.txt");
    expect(existsSync(fx.marker), "the gate DID run — this refusal is the late one").toBe(true);

    // Nothing was minted or written by the refusing capture: the only change
    // in the tree is the file the gate itself wrote.
    expect(git(fx.root, ["status", "--porcelain", "--untracked-files=all"])).toBe("?? late-dirt.txt");
  }, 120_000);
});

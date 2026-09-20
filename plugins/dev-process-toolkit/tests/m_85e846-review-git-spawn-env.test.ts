// M_85e846 review round — the git spawn that ignores the environment it is given.
//
// `gitAliasOf` (adapters/_shared/src/commit_target_repo.ts:416) resolves git
// aliases for the commit recogniser, and reports three states: the alias's
// value, `null` for "no such alias", and `undefined` for "the configuration
// could not be read at all". The third arm is what the recogniser falls back on
// when git is unavailable — and at c71a8e9 it is UNREACHABLE from any test,
// because the spawn omits `env`:
//
//     spawnSync("git", ["-C", dir, "config", "--get", `alias.${name}`], {
//       encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000,
//     });
//
// MEASURED under Bun (the runtime every hook runs on), with `process.env.PATH`
// pointed at a directory holding a stub `git`:
//
//     env omitted      → the REAL git ran (status 1). The PATH was ignored.
//     env: process.env → the stub ran (status 3). The PATH was honoured.
//
// So an omitted `env` makes Bun resolve the binary against the PATH the process
// STARTED with, while everything else about the spawn uses the PATH it was
// given. Two environments in one spawn — and no test can reach the failure arm,
// because no test can make git un-findable.
//
// Its sibling `gitRemotesOf` (adapters/_shared/src/pr_target_repo.ts:132-142)
// already passes `env: process.env`, under a comment naming this exact hazard.
// These are the tests that are impossible today, plus that sibling as the
// control that proves the technique reaches the spawn at all.
//
// PATH IS PROCESS-WIDE, so every clause restores it in `finally`, and these
// clauses live in their own file: nothing here drives a hook wrapper or spawns
// bun, so a stub PATH cannot leak into a suite that does.

import { afterEach, beforeAll, afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Project, SyntaxKind } from "ts-morph";

import { gitAliasOf } from "../adapters/_shared/src/commit_target_repo";
import { gitRemotesOf } from "../adapters/_shared/src/pr_target_repo";

const PLUGIN_ROOT = join(import.meta.dir, "..");

let repo = "";
let stubBin = "";
let REAL_PATH = "";

/** Run `body` with `PATH` replaced, and put the real one back whatever happens. */
function withPath<T>(path: string, body: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    return body();
  } finally {
    process.env.PATH = saved;
  }
}

beforeAll(() => {
  REAL_PATH = process.env.PATH ?? "";
  repo = mkdtempSync(join(tmpdir(), "alias-env-"));
  const run = (...args: string[]): void => {
    const p = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: process.env });
    if (p.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr}`);
  };
  run("init", "-q", "-b", "main");
  run("config", "alias.co", "checkout");

  // A directory whose `git` is a stub that exits 3 — neither 0 (a value) nor
  // 1 (no such alias), so an honest reader must answer "unreadable".
  stubBin = mkdtempSync(join(tmpdir(), "alias-stub-bin-"));
  writeFileSync(join(stubBin, "git"), "#!/bin/sh\nexit 3\n");
  chmodSync(join(stubBin, "git"), 0o755);
});

afterEach(() => {
  // Belt and braces: a clause that threw between the two halves of `withPath`
  // must not hand the next one a stub PATH.
  process.env.PATH = REAL_PATH;
});

afterAll(() => {
  for (const d of [repo, stubBin]) if (d) rmSync(d, { recursive: true, force: true });
});

describe("HS-1 review — `gitAliasOf` runs git in the environment it was given", () => {
  test("git not on the PATH → `undefined` (unreadable), never `null` (no such alias)", () => {
    const answer = withPath("/nonexistent-dir-for-git-lookup", () => gitAliasOf(repo, "co"));
    // `null` here would be the recogniser reporting "this alias is not defined"
    // on a machine where it could not look, which is a silent wrong answer in
    // the one place the commit recogniser resolves what a command really runs.
    expect(answer).toBeUndefined();
  });

  test("a `git` on the PATH that fails in some other way (exit 3) → `undefined`", () => {
    expect(withPath(stubBin, () => gitAliasOf(repo, "co"))).toBeUndefined();
  });

  test("PERMIT SIBLING — with the real PATH, a defined alias answers its value and an undefined one answers `null`", () => {
    expect(gitAliasOf(repo, "co")).toBe("checkout");
    expect(gitAliasOf(repo, "definitely-not-an-alias")).toBeNull();
  });

  // CONTROL — the same two PATHs, asked of the sibling that ALREADY passes
  // `env`. It answers `null` (its own "could not read") under both, which is
  // what proves the stub PATH reaches a spawn at all: without this, the two
  // clauses above could be failing for a reason that has nothing to do with
  // `gitAliasOf`'s spawn options.
  test("CONTROL — `gitRemotesOf`, which passes `env`, already honours both PATHs", () => {
    expect(withPath("/nonexistent-dir-for-git-lookup", () => gitRemotesOf(repo))).toBeNull();
    expect(withPath(stubBin, () => gitRemotesOf(repo))).toBeNull();
    // …and with the real PATH it reads the checkout rather than failing open.
    expect(gitRemotesOf(repo)).toEqual([]);
  });

  // CONTROL — the stub is really what a PATH-honouring spawn would run, so
  // "exit 3" above is a fact about the stub, not a guess.
  test("CONTROL — a spawn that passes `env` runs the stub, and one that omits it does not", () => {
    const args = ["-C", repo, "config", "--get", "alias.co"];
    const measured = withPath(stubBin, () => ({
      passed: spawnSync("git", args, { encoding: "utf8", env: process.env }).status,
      omitted: spawnSync("git", args, { encoding: "utf8" }).status,
    }));
    expect(measured).toEqual({ passed: 3, omitted: 0 });
  });
});

// ---------------------------------------------------------------------------
// The class, not the instance: three `spawnSync("git", …)` sites ship, and two
// of them pass `env`. The odd one out is the defect above. A behavioural clause
// catches the site it names; this one catches the next site someone adds.
// ---------------------------------------------------------------------------

function gitSpawnSites(file: string): Array<{ line: number; passesEnv: boolean }> {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile("x.ts", readFileSync(file, "utf-8"));
  const out: Array<{ line: number; passesEnv: boolean }> = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!/(^|\.)spawnSync$/.test(call.getExpression().getText())) continue;
    const [first, , options] = call.getArguments();
    if (first === undefined || !/^["'`]git["'`]$/.test(first.getText())) continue;
    const text = options?.getText() ?? "";
    out.push({ line: call.getStartLineNumber(), passesEnv: /(^|[{,\s])env\s*[:,}]/.test(text) });
  }
  return out;
}

function shippedTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  for (const dir of ["adapters", "templates", "hooks", "scripts"]) {
    const full = join(PLUGIN_ROOT, dir);
    if (existsSync(full)) walk(full);
  }
  return out;
}

describe("HS-1 review — every shipped git spawn states its environment", () => {
  test("no `spawnSync(\"git\", …)` in the shipped tree omits `env`", () => {
    const offenders: string[] = [];
    for (const file of shippedTsFiles()) {
      for (const site of gitSpawnSites(file)) {
        if (!site.passesEnv) offenders.push(`${file.slice(PLUGIN_ROOT.length + 1)}:${site.line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // CONTROL — the scanner finds sites and can tell the two shapes apart, so the
  // clause above is not an empty list produced by finding nothing at all.
  test("CONTROL — the scanner finds the shipped sites and distinguishes passing from omitting", () => {
    const total = shippedTsFiles().reduce((n, f) => n + gitSpawnSites(f).length, 0);
    expect(total).toBeGreaterThanOrEqual(3);
    const planted = join(tmpdir(), "planted.ts");
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      planted,
      [
        'spawnSync("git", ["status"], { encoding: "utf8" });',
        'spawnSync("git", ["status"], { encoding: "utf8", env: process.env });',
        'spawnSync("bun", ["x"], { encoding: "utf8" });',
      ].join("\n"),
    );
    // Same reader, fed a fixture rather than a file on disk.
    const tmpFile = join(mkdtempSync(join(tmpdir(), "planted-")), "planted.ts");
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(
      tmpFile,
      [
        'spawnSync("git", ["status"], { encoding: "utf8" });',
        'spawnSync("git", ["status"], { encoding: "utf8", env: process.env });',
        'spawnSync("bun", ["x"], { encoding: "utf8" });',
      ].join("\n"),
    );
    expect(gitSpawnSites(tmpFile).map((s) => s.passesEnv)).toEqual([false, true]);
    rmSync(dirname(tmpFile), { recursive: true, force: true });
  });
});

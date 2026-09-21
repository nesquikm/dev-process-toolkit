// AC-STE-601.1 — the shared recogniser `adapters/_shared/src/shell_invocations.ts`.
//
// Contract pinned here (the implementer follows it):
//
//   export interface ShellInvocation {
//     argv: string[];            // after quote removal and wrapper stripping
//     dir: string | null;        // the literal directory it runs in, or null
//     unexpanded: string | null; // the unexpanded word that made `dir` null (STE-597 rules)
//     wrappers: string[];        // the wrapper chain, outermost first (e.g. ["env","time","command"])
//   }
//   export function shellInvocations(
//     command: string,
//     sessionCwd: string,
//     roots?: (dir: string) => string | null,
//   ): ShellInvocation[];
//
// Order is the order the shell would run the simple commands in.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as SI from "../adapters/_shared/src/shell_invocations";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MAP: Record<string, string> = { "/s/a": "/s/a", "/s/b": "/s/b", "/s/b/sub": "/s/b" };
const ROOTS = (d: string): string | null => MAP[d] ?? null;

type Inv = { argv: string[]; dir: string | null; unexpanded: string | null; wrappers: string[] };
const inv = (cmd: string, cwd = "/s/a"): Inv[] =>
  (SI as unknown as { shellInvocations: (c: string, s: string, r?: unknown) => Inv[] }).shellInvocations(cmd, cwd, ROOTS);
const argvs = (cmd: string, cwd = "/s/a"): string[] => inv(cmd, cwd).map((i) => i.argv.join(" "));

describe("AC-STE-601.1 — shell_invocations exports the recogniser", () => {
  test("`shellInvocations` is an exported function", () => {
    expect(typeof (SI as Record<string, unknown>).shellInvocations).toBe("function");
  });

  test("order: every simple command, in the order the shell runs it", () => {
    expect(argvs("cd /s/b && git status; ls -la | wc -l")).toEqual(["cd /s/b", "git status", "ls -la", "wc -l"]);
  });

  test("directory: a `cd` moves the later commands; a subshell scopes it", () => {
    const got = inv("(cd /s/b && git status); git log");
    const status = got.find((i) => i.argv.join(" ") === "git status")!;
    const log = got.find((i) => i.argv.join(" ") === "git log")!;
    expect(status.dir).toBe("/s/b");
    expect(log.dir).toBe("/s/a");
  });

  test("directory: a brace group does not scope the `cd`", () => {
    const got = inv("{ cd /s/b; }; git log");
    expect(got.find((i) => i.argv[0] === "git")!.dir).toBe("/s/b");
  });

  test("directory: an unexpanded `cd` word is named, never guessed", () => {
    const g = inv('cd "$R" && git status').find((i) => i.argv[0] === "git")!;
    expect(g.dir).toBe(null);
    expect(String(g.unexpanded)).toContain("$R");
  });

  test("wrapper chain: `env X=1 time command git -C /s/b commit -m x`", () => {
    const g = inv("env X=1 time command git -C /s/b commit -m x").find((i) => i.argv[0] === "git")!;
    expect(g.argv).toEqual(["git", "-C", "/s/b", "commit", "-m", "x"]);
    expect(g.wrappers).toEqual(["env", "time", "command"]);
  });

  test("CONTROL — an unwrapped command carries an empty wrapper chain", () => {
    expect(inv("git status")[0]!.wrappers).toEqual([]);
  });

  test("quote removal runs before argv0 is read: `\\git` and `\"git\"` are `git`", () => {
    expect(inv("\\git status")[0]!.argv[0]).toBe("git");
    expect(inv('"git" status')[0]!.argv[0]).toBe("git");
  });

  test("nested shells are read recursively, with the shell in the wrapper chain", () => {
    const g = inv("bash -c 'cd /s/b && git status'").find((i) => i.argv[0] === "git")!;
    expect(g.dir).toBe("/s/b");
    expect(g.wrappers).toContain("bash");
  });

  test("substitutions run in the running directory", () => {
    const g = inv("cd /s/b && echo $(git log -1)").find((i) => i.argv[0] === "git")!;
    expect(g.argv).toEqual(["git", "log", "-1"]);
    expect(g.dir).toBe("/s/b");
  });

  test("a heredoc body is data, not commands", () => {
    expect(argvs("cat <<EOF\ngit commit -m x\nEOF\nls")).toEqual(["cat", "ls"]);
  });

  test("depth bound: nesting nine deep neither throws nor loops", () => {
    let s = "git status";
    for (let i = 0; i < 9; i++) s = `bash -c '${s.replace(/'/g, `'\\''`)}'`;
    expect(() => inv(s)).not.toThrow();
    expect(inv(s).some((i) => i.argv[0] === "git")).toBe(false);
    let s3 = "git status";
    for (let i = 0; i < 3; i++) s3 = `bash -c '${s3.replace(/'/g, `'\\''`)}'`;
    expect(inv(s3).some((i) => i.argv[0] === "git")).toBe(true);
  });
});

describe("AC-STE-601.1 — commit_target_repo.ts reads commands through the shared module", () => {
  const src = readFileSync(join(PLUGIN_ROOT, "adapters/_shared/src/commit_target_repo.ts"), "utf8");
  for (const name of ["scanCommand", "tokenize", "readHeredocOperator", "skipHeredocBodies", "readSubstitution", "applyCd"]) {
    test(`declares no \`${name}\``, () => {
      expect(src).not.toMatch(new RegExp(`\\b(function|const|let)\\s+${name}\\b`));
    });
  }
  test("imports from ./shell_invocations", () => {
    expect(src).toMatch(/from\s+["']\.\/shell_invocations(\.ts)?["']/);
  });
  test("CONTROL — the declaration pattern does find a declaration that exists", () => {
    expect(src).toMatch(/\bfunction\s+resolveCommitTarget\b/);
  });
});

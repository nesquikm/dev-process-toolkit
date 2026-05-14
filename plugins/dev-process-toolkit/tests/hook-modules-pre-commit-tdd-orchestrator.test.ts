// STE-290 AC.2 — `_lib/hooks/pre-commit-tdd-orchestrator.ts` per-hook TS module.
//
// Reads stdin, parses via `parseHookPayload`, applies `git commit*`
// command-pattern guard, then runs `git diff --cached --name-only` (filesystem
// call, no `$CLAUDE_STAGED_FILES` env var) to filter for FR-related staged
// files. If FR-related files are staged, delegates to `requireSkillToolUse`
// for the `dev-process-toolkit:tdd` skill.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "_lib",
  "hooks",
  "pre-commit-tdd-orchestrator.ts",
);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let repoDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-mod-tdd-"));
  repoDir = join(tmpRoot, "repo");
  mkdirSync(repoDir, { recursive: true });
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function writeTranscript(entries: unknown[]): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    file,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return file;
}

/**
 * Initialise a temp git repo with the given staged files (path → contents).
 * Each file is written + `git add`-ed so `git diff --cached --name-only`
 * inside the repo will list them.
 */
async function initRepoWithStaged(
  files: Record<string, string>,
): Promise<void> {
  const init = Bun.spawn(["git", "init", "-q", repoDir], { stdout: "pipe", stderr: "pipe" });
  await init.exited;
  // Configure identity locally so commits would work if we ever made one.
  await Bun.spawn(
    ["git", "-C", repoDir, "config", "user.email", "test@example.com"],
  ).exited;
  await Bun.spawn(
    ["git", "-C", repoDir, "config", "user.name", "Test"],
  ).exited;
  for (const [rel, body] of Object.entries(files)) {
    const full = join(repoDir, rel);
    const dir = full.split("/").slice(0, -1).join("/");
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", repoDir, "add", rel]).exited;
  }
}

async function runModule(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: repoDir,
    stdin: new Response(stdinPayload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator module: file exists", () => {
  test("module exists at the documented path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: command-pattern guard early-exits non-`git commit`", () => {
  test("`git status` command → exit 0", async () => {
    await initRepoWithStaged({});
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: staged-file heuristic via `git diff --cached`", () => {
  test("only docs/config staged + git commit → exit 0 even without /tdd tool_use", async () => {
    await initRepoWithStaged({
      "CHANGELOG.md": "# CHANGELOG\n",
      "README.md": "# README\n",
    });
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m docs" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("FR file staged + git commit + /tdd tool_use present → exit 0", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-290.md": "---\ntitle: x\n---\n",
    });
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:tdd" },
      },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("FR file staged + git commit + /tdd tool_use missing → exit non-zero + NFR-10 stderr", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-290.md": "---\ntitle: x\n---\n",
    });
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/tdd/i);
  });

  test("test file staged + git commit + /tdd tool_use missing → exit non-zero", async () => {
    await initRepoWithStaged({
      "src/foo.test.ts": "// test\n",
    });
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m feat" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).not.toBe(0);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: empty stdin fails open", () => {
  test("empty stdin → exit 0", async () => {
    await initRepoWithStaged({});
    const r = await runModule("");
    expect(r.exitCode).toBe(0);
  });
});

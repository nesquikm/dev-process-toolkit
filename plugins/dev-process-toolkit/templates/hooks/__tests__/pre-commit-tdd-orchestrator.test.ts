import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-290 AC.5 — `pre-commit-tdd-orchestrator.sh` integration test.
//
// Drives the bash shim end-to-end via `Bun.spawn({ stdin: ... })`. The
// staged-file heuristic is now resolved through `git diff --cached`
// inside a temp git repo (no `$CLAUDE_STAGED_FILES` env var). Reduced to
// 2 cases (happy + refusal) per AC.5; matrix coverage moves to the unit-
// test suite under `plugins/dev-process-toolkit/tests/`.

const HOOK_PATH = join(
  import.meta.dir,
  "..",
  "process",
  "pre-commit-tdd-orchestrator.sh",
);
const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let repoDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-int-tdd-"));
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

async function initRepoWithStaged(
  files: Record<string, string>,
): Promise<void> {
  await Bun.spawn(["git", "init", "-q", repoDir]).exited;
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

async function runShim(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bash", HOOK_PATH], {
    cwd: repoDir,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
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

describe("AC-STE-290.5 — pre-commit-tdd-orchestrator.sh: end-to-end via stdin payload", () => {
  test("happy: FR file staged + git commit + Skill(/tdd) tool_use → exit 0", async () => {
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
    const r = await runShim(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("refusal: FR file staged + git commit + no Skill tool_use → exit non-zero + NFR-10 stderr", async () => {
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
    const r = await runShim(stdin);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/tdd/i);
  });
});

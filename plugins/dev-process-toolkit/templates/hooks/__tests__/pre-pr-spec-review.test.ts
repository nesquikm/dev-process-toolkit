import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-285 AC-STE-285.2 — `pre-pr-spec-review.sh` Process-category hook.
//
// PreToolUse Bash:`gh pr create*` → require a `Skill(/dev-process-toolkit:spec-review)`
// tool_use in current session; refuse with NFR-10 shape on miss.

const HOOKS_DIR = join(
  import.meta.dir,
  "..",
  "process",
);
const HOOK_PATH = join(HOOKS_DIR, "pre-pr-spec-review.sh");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHook(env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(["bash", HOOK_PATH], {
    env: { ...process.env, ...env },
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

function writeSessionJsonl(entries: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-285-spec-review-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("AC-STE-285.2 — pre-pr-spec-review.sh: file exists with shebang", () => {
  test("hook script exists at the documented path", () => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  test("script starts with a shebang line", () => {
    const content = readFileSync(HOOK_PATH, "utf-8");
    const firstLine = content.split("\n")[0] ?? "";
    expect(firstLine.startsWith("#!")).toBe(true);
  });
});

describe("AC-STE-285.2 — pre-pr-spec-review.sh: happy path (spec-review Skill tool_use present)", () => {
  test("exit 0 when session has a /dev-process-toolkit:spec-review Skill tool_use", async () => {
    const sessionFile = writeSessionJsonl([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:spec-review" },
      },
    ]);
    try {
      const r = await runHook({ CLAUDE_SESSION_FILE: sessionFile });
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-pr-spec-review.sh: miss path (no spec-review Skill tool_use)", () => {
  test("exit non-zero + NFR-10-shape stderr when session has no spec-review tool_use", async () => {
    const sessionFile = writeSessionJsonl([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    try {
      const r = await runHook({ CLAUDE_SESSION_FILE: sessionFile });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("Remedy:");
      expect(r.stderr).toContain("Context:");
      expect(r.stderr).toMatch(/spec-review/);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-pr-spec-review.sh: fail-open when CLAUDE_SESSION_FILE unset", () => {
  test("exit 0 when CLAUDE_SESSION_FILE env var is unset", async () => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_SESSION_FILE;
    const proc = Bun.spawn(["bash", HOOK_PATH], {
      env: cleanEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-285 AC-STE-285.2 — `pre-commit-tdd-orchestrator.sh` Process hook.
//
// PreToolUse Bash:`git commit*` → if FR-related files staged
// (specs/frs/<id>.md or matching test files), require a
// `Skill(/dev-process-toolkit:tdd)` tool_use in current session; refuse with
// NFR-10 shape on miss. **Byte-checkable continuation of STE-283's TDD
// Orchestrator Contract.**

const HOOKS_DIR = join(
  import.meta.dir,
  "..",
  "process",
);
const HOOK_PATH = join(HOOKS_DIR, "pre-commit-tdd-orchestrator.sh");

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
  const dir = mkdtempSync(join(tmpdir(), "ste-285-tdd-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("AC-STE-285.2 — pre-commit-tdd-orchestrator.sh: file exists with shebang", () => {
  test("hook script exists at the documented path", () => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  test("script starts with a shebang line", () => {
    const content = readFileSync(HOOK_PATH, "utf-8");
    const firstLine = content.split("\n")[0] ?? "";
    expect(firstLine.startsWith("#!")).toBe(true);
  });
});

describe("AC-STE-285.2 — pre-commit-tdd-orchestrator.sh: happy path (tdd Skill tool_use present)", () => {
  test("FR file staged AND /tdd Skill tool_use in session → exit 0", async () => {
    const sessionFile = writeSessionJsonl([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:tdd" },
      },
    ]);
    try {
      // Simulate staged FR file via env var the hook can read.
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        CLAUDE_STAGED_FILES: "specs/frs/STE-285.md\nplugins/dev-process-toolkit/skills/setup/install_hooks.ts",
      });
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-commit-tdd-orchestrator.sh: miss path (FR file staged but no /tdd tool_use)", () => {
  test("FR file staged + no /tdd Skill tool_use → exit non-zero + NFR-10 stderr", async () => {
    const sessionFile = writeSessionJsonl([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    try {
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        CLAUDE_STAGED_FILES: "specs/frs/STE-285.md",
      });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("Remedy:");
      expect(r.stderr).toContain("Context:");
      // The contract names /tdd as the required orchestrator.
      expect(r.stderr).toMatch(/tdd/i);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-commit-tdd-orchestrator.sh: skip path (no FR-related files staged)", () => {
  test("only non-FR files staged → exit 0 even with no /tdd tool_use", async () => {
    const sessionFile = writeSessionJsonl([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    try {
      // CHANGELOG / docs-only / config-only commits don't need /tdd.
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        CLAUDE_STAGED_FILES: "CHANGELOG.md\nREADME.md",
      });
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-commit-tdd-orchestrator.sh: fail-open when CLAUDE_SESSION_FILE unset", () => {
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

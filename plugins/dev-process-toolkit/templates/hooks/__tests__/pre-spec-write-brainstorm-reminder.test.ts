import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-285 AC-STE-285.2 — `pre-spec-write-brainstorm-reminder.sh` Process hook.
//
// UserPromptSubmit on `/dev-process-toolkit:spec-write` → if no
// `Skill(/dev-process-toolkit:brainstorm)` tool_use in current session AND
// no resolved tracker ID arg, inject a stderr reminder to consider
// `/brainstorm` first.
//
// This is a reminder hook (not a refusal hook). It MAY exit non-zero to
// signal "advisory", or exit 0 with stderr output, depending on the hook
// type. The contract: when triggered, stderr must contain a brainstorm
// reminder. When not triggered (brainstorm already fired OR tracker ID
// supplied), no reminder appears.

const HOOKS_DIR = join(
  import.meta.dir,
  "..",
  "process",
);
const HOOK_PATH = join(HOOKS_DIR, "pre-spec-write-brainstorm-reminder.sh");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHook(
  env: Record<string, string>,
  stdinPayload: string = "",
): Promise<RunResult> {
  const proc = Bun.spawn(["bash", HOOK_PATH], {
    env: { ...process.env, ...env },
    stdin: stdinPayload ? new Response(stdinPayload).body : "ignore",
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
  const dir = mkdtempSync(join(tmpdir(), "ste-285-bs-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("AC-STE-285.2 — pre-spec-write-brainstorm-reminder.sh: file exists with shebang", () => {
  test("hook script exists at the documented path", () => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  test("script starts with a shebang line", () => {
    const content = readFileSync(HOOK_PATH, "utf-8");
    const firstLine = content.split("\n")[0] ?? "";
    expect(firstLine.startsWith("#!")).toBe(true);
  });
});

describe("AC-STE-285.2 — pre-spec-write-brainstorm-reminder.sh: miss-path triggers reminder", () => {
  test("no brainstorm tool_use AND no tracker ID arg → stderr carries a brainstorm reminder", async () => {
    const sessionFile = writeSessionJsonl([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    try {
      // Greenfield invocation: bare `/dev-process-toolkit:spec-write` with
      // no tracker arg. Surface the user prompt to the hook via env or
      // stdin — both shapes are accepted; we test env-var form.
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        CLAUDE_USER_PROMPT: "/dev-process-toolkit:spec-write",
      });
      // The hook must NOT block (UserPromptSubmit hooks may inject a
      // reminder via stderr but should not refuse the prompt outright).
      // Reminder content: must mention brainstorm.
      expect(r.stderr).toMatch(/brainstorm/i);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-spec-write-brainstorm-reminder.sh: happy path (brainstorm already fired)", () => {
  test("brainstorm Skill tool_use in session → no reminder injected", async () => {
    const sessionFile = writeSessionJsonl([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:brainstorm" },
      },
    ]);
    try {
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        CLAUDE_USER_PROMPT: "/dev-process-toolkit:spec-write",
      });
      // Brainstorm fired ⇒ no reminder ⇒ empty stderr.
      expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

describe("AC-STE-285.2 — pre-spec-write-brainstorm-reminder.sh: happy path (tracker ID arg supplied)", () => {
  test("tracker ID arg in user prompt → no reminder injected (not greenfield)", async () => {
    const sessionFile = writeSessionJsonl([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    try {
      const r = await runHook({
        CLAUDE_SESSION_FILE: sessionFile,
        // Tracker-mode invocation with explicit ticket reference. Heuristic
        // per FR: presence of a tracker-style ID (e.g., STE-123, PROJ-456)
        // marks the FR as non-greenfield, so no reminder is needed.
        CLAUDE_USER_PROMPT: "/dev-process-toolkit:spec-write STE-285",
      });
      expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
    } finally {
      rmSync(sessionFile, { force: true });
    }
  });
});

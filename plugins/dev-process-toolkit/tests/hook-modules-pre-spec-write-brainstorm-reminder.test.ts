// STE-290 AC.2 — `_lib/hooks/pre-spec-write-brainstorm-reminder.ts` per-hook
// TS module.
//
// UserPromptSubmit hook: reads `payload.prompt` directly (NOT a whole-stdin
// grep — STE-285's coincidental-pass false-negative path is eliminated).
// If the prompt invokes `/dev-process-toolkit:spec-write` AND no brainstorm
// Skill tool_use is in the session AND the prompt has no resolved tracker
// ID arg, emit an advisory NFR-10 `Reminder:` block to stderr (exit 0).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  "pre-spec-write-brainstorm-reminder.ts",
);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-mod-bs-"));
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

async function runModule(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
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

describe("AC-STE-290.2 — pre-spec-write-brainstorm-reminder module: file exists", () => {
  test("module exists at the documented path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: triggers on greenfield spec-write", () => {
  test("greenfield /spec-write + no brainstorm tool_use → stderr carries reminder, exit 0", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      prompt: "/dev-process-toolkit:spec-write",
    });
    const r = await runModule(stdin);
    // Advisory hook: must NOT block the prompt.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/brainstorm/i);
    expect(r.stderr).toContain("Reminder:");
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: skips when brainstorm already fired", () => {
  test("brainstorm Skill tool_use in session → no reminder", async () => {
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:brainstorm" },
      },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      prompt: "/dev-process-toolkit:spec-write",
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: skips on tracker-mode invocation", () => {
  test("prompt carries tracker ID (STE-123) → no reminder", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      prompt: "/dev-process-toolkit:spec-write STE-285",
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: skips on non-spec-write prompts", () => {
  test("prompt does not invoke /spec-write → no reminder", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      prompt: "what is the meaning of life",
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: reads payload.prompt only, not whole stdin", () => {
  test("tracker ID present in stdin metadata but NOT in payload.prompt → reminder still fires", async () => {
    // STE-285's whole-stdin grep had a coincidental-pass false-negative path:
    // a tracker ID in any stdin field (e.g., transcript_path containing
    // "STE-285") would suppress the reminder. The new module must read
    // `payload.prompt` directly so only prompt-text matters.
    //
    // Inject a tracker-ish substring into transcript_path (file path) and
    // session_id; payload.prompt stays bare-greenfield. Reminder must fire.
    const file = join(tmpRoot, "STE-285-transcript.jsonl");
    writeFileSync(file, "");
    const stdin = JSON.stringify({
      session_id: "STE-285-session",
      transcript_path: file,
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      prompt: "/dev-process-toolkit:spec-write",
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/brainstorm/i);
  });
});

describe("AC-STE-290.2 — brainstorm-reminder: empty / unparseable stdin fails open", () => {
  test("empty stdin → exit 0, no stderr", async () => {
    const r = await runModule("");
    expect(r.exitCode).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-290 AC.5 — `pre-spec-write-brainstorm-reminder.sh` integration test.
//
// Drives the bash shim end-to-end via `Bun.spawn({ stdin: ... })`. The
// reminder hook reads `payload.prompt` from the stdin JSON (no env var).
// Reduced to 2 cases (happy + refusal) per AC.5; matrix coverage moves to
// the unit-test suite under `plugins/dev-process-toolkit/tests/`.

const HOOK_PATH = join(
  import.meta.dir,
  "..",
  "process",
  "pre-spec-write-brainstorm-reminder.sh",
);
const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-int-bs-"));
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

async function runShim(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bash", HOOK_PATH], {
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

describe("AC-STE-290.5 — pre-spec-write-brainstorm-reminder.sh: end-to-end via stdin payload", () => {
  test("happy: brainstorm Skill tool_use already in session → no reminder, exit 0", async () => {
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
    const r = await runShim(stdin);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/brainstorm.*reminder|consider.*brainstorm|run.*brainstorm/i);
  });

  test("refusal-style reminder: greenfield /spec-write + no brainstorm tool_use → reminder on stderr, exit 0", async () => {
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
    const r = await runShim(stdin);
    // Advisory: never blocks.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/brainstorm/i);
    expect(r.stderr).toContain("Reminder:");
  });
});

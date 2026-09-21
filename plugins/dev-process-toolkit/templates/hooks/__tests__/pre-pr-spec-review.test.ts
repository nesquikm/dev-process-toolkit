import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-290 AC.5 — `pre-pr-spec-review.sh` integration test.
//
// Drives the bash shim end-to-end via `Bun.spawn({ stdin: ... })`. Reduced
// to 2 cases (happy + refusal) per AC.5; matrix coverage moves to the
// unit-test suite under `plugins/dev-process-toolkit/tests/`.

const HOOK_PATH = join(import.meta.dir, "..", "process", "pre-pr-spec-review.sh");
const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-int-spr-"));
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

describe("AC-STE-290.5 — pre-pr-spec-review.sh: end-to-end via stdin payload", () => {
  // STE-615 AC.5 — the happy path gains a FRONT-DOOR-WRITTEN RECEIPT, in a
  // toolkit-managed checkout where the repository leg actually applies, and a
  // sibling below removes that receipt and exits 2. Graded through the shipped
  // shim, not the module, so the wiring is graded end to end.
  test("happy: gh pr create + Skill(/spec-review) + a receipt for that checkout → exit 0", async () => {
    const repo = await managedRepo615("spr-shim-615-permit");
    writeGateReceipt615(repo, "spec-review", SID_615);
    const r = await runShimIn615(repo, payload615(repo, vouchingTranscript615()));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedRepo615("spr-shim-615-forbid");
    writeGateReceipt615(repo, "spec-review", SID_615);
    clearReceipts615(repo, SID_615);
    const r = await runShimIn615(repo, payload615(repo, vouchingTranscript615()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain(repo);
  });

  test("refusal: gh pr create + no Skill tool_use → exit non-zero + NFR-10 stderr", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "gh pr create" },
    });
    const r = await runShim(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/spec-review/);
  });
});

// ---------------------------------------------------------------- STE-615.5
//
// The receipt fixture the two cases above share. It spawns the shipped
// gate-receipt front door rather than composing an envelope here, so a suite
// that went green after the front door broke is not possible.

import { mkdirSync as mkdirSync615 } from "node:fs";
import {
  announcementRecords as announcementRecords615,
  clearReceipts as clearReceipts615,
  forgetAnnouncements as forgetAnnouncements615,
  mintedAnnouncements as mintedAnnouncements615,
  writeGateReceipt as writeGateReceipt615,
  writeManagedClaudeMd as writeManagedClaudeMd615,
} from "../../../tests/_gate_receipt_fixture";

const SID_615 = "s1";

async function managedRepo615(name: string): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync615(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd615(dir);
  forgetAnnouncements615();
  return dir;
}

function vouchingTranscript615(): string {
  return writeTranscript([
    {
      type: "tool_use",
      id: "tu615",
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      name: "Skill",
      input: { skill: "dev-process-toolkit:spec-review" },
    },
    ...announcementRecords615(mintedAnnouncements615()).map((l) => JSON.parse(l) as unknown),
  ]);
}

function payload615(repo: string, transcript: string): string {
  return JSON.stringify({
    session_id: SID_615,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "gh pr create --title foo --body bar" },
  });
}

async function runShimIn615(cwd: string, stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bash", HOOK_PATH], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(stdinPayload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

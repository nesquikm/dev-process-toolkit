import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-290 AC.5 — `pre-commit-gate-check.sh` integration test.
//
// Drives the bash shim end-to-end via `Bun.spawn({ stdin: ... })`. The shim
// is now a 2-line `exec bun run` wrapper around the corresponding TS module.
// Reduced to 2 cases (happy + refusal) per AC.5; matrix coverage moves to
// the unit-test suite under `plugins/dev-process-toolkit/tests/`.

const HOOK_PATH = join(import.meta.dir, "..", "process", "pre-commit-gate-check.sh");
const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-int-gc-"));
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

describe("AC-STE-290.5 — pre-commit-gate-check.sh: end-to-end via stdin payload", () => {
  test("happy: git commit + Skill(/gate-check) tool_use → exit 0", async () => {
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:gate-check" },
      },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runShim(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("refusal: git commit + no Skill tool_use → exit non-zero + NFR-10 stderr", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runShim(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/gate-check/);
  });
});

// ---------------------------------------------------------------- STE-614.13
//
// The shim's "evidence present, proceeds" case, graded where the receipt leg
// applies: a TOOLKIT-MANAGED checkout. The Skill call alone no longer carries a
// commit past this gate, so the proceeds case carries a front-door-written
// receipt, and the sibling with that receipt removed exits 2.
//
// The two STE-290 cases above are left byte-identical on purpose: their fixture
// is `cwd: "/tmp"`, a directory in no toolkit-managed checkout, and
// AC-STE-614.8 says an unmanaged target is decided by the transcript leg alone.
// Making that tree managed would move the case rather than grade it.

import { mkdirSync as mkdirSync614 } from "node:fs";
import {
  clearReceipts as clearReceipts614,
  writeGateReceipt as writeGateReceipt614,
  writeManagedClaudeMd as writeManagedClaudeMd614,
  announcementRecords as announcementRecords614,
  mintedAnnouncements as mintedAnnouncements614
} from "../../../tests/_gate_receipt_fixture";

const SID_614 = "s1";

async function managedRepo614(name: string): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync614(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd614(dir);
  return dir;
}

/**
 * A gate-check Skill call stamped an hour back, so it opens a vouching window
 * the receipt written after it falls inside. A call the transcript cannot place
 * in time vouches for nothing.
 */
function vouchingTranscript614(): string {
  return writeTranscript([
    {
      type: "tool_use",
      id: "tu614",
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      name: "Skill",
      input: { skill: "dev-process-toolkit:gate-check" },
    },
    ...announcementRecords614(mintedAnnouncements614()).map((l) => JSON.parse(l) as unknown),
  ]);
}

async function runShimIn614(cwd: string, stdinPayload: string): Promise<RunResult> {
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

function payload614(repo: string, transcript: string): string {
  return JSON.stringify({
    session_id: SID_614,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: `git -C ${repo} commit -m x` },
  });
}

describe("AC-STE-614.13 — the receipt is load-bearing in this shim suite's proceeds case", () => {
  test("Skill call AND a front-door-written receipt for the target → exit 0, silent", async () => {
    const repo = await managedRepo614("gc-614-permit");
    writeGateReceipt614(repo, "gate-check", SID_614);
    const r = await runShimIn614(repo, payload614(repo, vouchingTranscript614()));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedRepo614("gc-614-forbid");
    writeGateReceipt614(repo, "gate-check", SID_614);
    clearReceipts614(repo, SID_614);
    const r = await runShimIn614(repo, payload614(repo, vouchingTranscript614()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain(repo);
  });
});

// STE-290 AC.2 — `_lib/hooks/pre-pr-spec-review.ts` per-hook TS module.
//
// Reads stdin, parses via `parseHookPayload`, applies `gh pr create*`
// command-pattern guard, then delegates to `requireSkillToolUse` for the
// `dev-process-toolkit:spec-review` skill.

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
  "pre-pr-spec-review.ts",
);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-mod-spr-"));
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

describe("AC-STE-290.2 — pre-pr-spec-review module: file exists", () => {
  test("module exists at the documented path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});

describe("AC-STE-290.2 — pre-pr-spec-review: command-pattern guard early-exits non-`gh pr create`", () => {
  test("`gh pr list` command → exit 0, no enforcement", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "gh pr list" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("`git push` command → exit 0, no enforcement", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-pr-spec-review: empty / unparseable stdin fails open", () => {
  test("empty stdin → exit 0", async () => {
    const r = await runModule("");
    expect(r.exitCode).toBe(0);
  });

  test("malformed JSON stdin → exit 0", async () => {
    const r = await runModule("{not-json");
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-pr-spec-review: end-to-end skill detection on `gh pr create*`", () => {
  // STE-615 AC.5 — the happy path now carries a FRONT-DOOR-WRITTEN RECEIPT.
  //
  // It used to sit in `/tmp`, a directory in no toolkit-managed checkout, where
  // the transcript leg alone decides. That made "evidence present" a claim
  // about the session rather than about the repository the PR is opened from,
  // which is the whole of what this FR changes — so the case moves into a
  // managed checkout, and its sibling below removes the receipt and exits 2.
  test("gh pr create + Skill tool_use present + a receipt for that checkout → exit 0", async () => {
    const repo = await managedRepo615("spr-615-permit");
    writeGateReceipt615(repo, "spec-review", SID_615);
    const r = await runModule(payload615(repo, vouchingTranscript615()));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedRepo615("spr-615-forbid");
    writeGateReceipt615(repo, "spec-review", SID_615);
    clearReceipts615(repo, SID_615);
    const r = await runModule(payload615(repo, vouchingTranscript615()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain(repo);
  });

  test("gh pr create + Skill tool_use missing → exit non-zero + NFR-10 stderr", async () => {
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
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/spec-review/);
  });
});

// ---------------------------------------------------------------- STE-615.5
//
// The fixture the happy path above and its sibling share: a toolkit-managed
// `git init` checkout, a spec-review Skill call stamped an hour back so it
// opens a vouching window, and the announcements the front door printed when it
// wrote the receipt. A receipt nobody announced is a file any Bash call could
// have written, so the transcript has to carry the announcement too.

import { mkdirSync as mkdirSync615 } from "node:fs";
import {
  announcementRecords as announcementRecords615,
  clearReceipts as clearReceipts615,
  forgetAnnouncements as forgetAnnouncements615,
  mintedAnnouncements as mintedAnnouncements615,
  writeGateReceipt as writeGateReceipt615,
  writeManagedClaudeMd as writeManagedClaudeMd615,
} from "./_gate_receipt_fixture";

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

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
  // M142 / STE-548 — written, never staged. The refusal case below means "a
  // TypeScript project staging a test file"; since STE-547 the layout is read
  // off a stack marker, so the fixture has to carry one.
  writeFileSync(
    join(repoDir, "package.json"),
    '{"name":"fixture","version":"0.0.0","private":true}\n',
  );
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

  test("refusal: test file staged + git commit + no Skill tool_use → exit non-zero + NFR-10 stderr", async () => {
    // STE-295 AC.1 narrowed the contract: FR-only commits skip /tdd. The
    // refusal path now exercises a test file (still in the /tdd-required
    // set per the existing classifier).
    await initRepoWithStaged({
      "src/foo.test.ts": "test('x', () => {});\n",
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
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/tdd/i);
  });
});

// ---------------------------------------------------------------- STE-614.13
//
// The shim's "evidence present, proceeds" case, graded where the receipt leg
// applies: a TOOLKIT-MANAGED checkout. The /tdd Skill call alone no longer
// carries a commit past this gate, so the proceeds case carries a
// front-door-written receipt, and the sibling without it exits 2.
//
// The STE-290 happy case above is left byte-identical: its `repoDir` fixture
// carries no toolkit-managed CLAUDE.md, and AC-STE-614.8 decides an unmanaged
// target by the transcript leg alone. Making it managed would move the case
// rather than grade it.

import {
  clearReceipts as clearReceipts614,
  writeGateReceipt as writeGateReceipt614,
  writeManagedClaudeMd as writeManagedClaudeMd614,
  announcementRecords as announcementRecords614,
  mintedAnnouncements as mintedAnnouncements614
} from "../../../tests/_gate_receipt_fixture";

const SID_614 = "s614t";

/** A managed checkout staging the FR + source + test set the classifier calls tdd-required. */
async function managedRepo614(name: string): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd614(dir);
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"fixture","version":"0.0.0","private":true}\n',
  );
  const files: Record<string, string> = {
    "specs/frs/STE-614.md": "---\ntitle: x\nstatus: active\n---\n",
    "src/foo.ts": "export const foo = 1;\n",
    "src/foo.test.ts": "test('x', () => {});\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", dir, "add", rel], { stdout: "pipe", stderr: "pipe" }).exited;
  }
  return dir;
}

/** Stamped an hour back, so the receipt written after it falls inside the window it opens. */
function vouchingTranscript614(): string {
  return writeTranscript([
    {
      type: "tool_use",
      id: "tu614",
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      name: "Skill",
      input: { skill: "dev-process-toolkit:tdd" },
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
  test("/tdd Skill call AND a front-door-written receipt for the target → exit 0, silent", async () => {
    const repo = await managedRepo614("tdd-614-permit");
    writeGateReceipt614(repo, "tdd", SID_614);
    const r = await runShimIn614(repo, payload614(repo, vouchingTranscript614()));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedRepo614("tdd-614-forbid");
    writeGateReceipt614(repo, "tdd", SID_614);
    clearReceipts614(repo, SID_614);
    const r = await runShimIn614(repo, payload614(repo, vouchingTranscript614()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain(repo);
  });
});

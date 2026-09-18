import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { announceReceipt, writeReceipt } from "../../../adapters/_shared/src/tracker_receipts";

// STE-607 — `pre-tracker-write-gate.sh` integration test.
//
// Drives the bash shim end-to-end, the way the harness runs it: `bash <shim>`
// with CLAUDE_PLUGIN_ROOT set and the PreToolUse payload on stdin. The shim is a
// 2-line `exec bun run "${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/…"`
// wrapper like its siblings; the case matrix lives in
// `tests/hook-modules-pre-tracker-write-gate.test.ts`.
//
// CLAUDE_PLUGIN_ROOT points at a STAGED plugin root: its own
// `.claude-plugin/plugin.json` at 2.87.0 (the hook reads its own manifest for
// the running version) with `templates/` and `adapters/` symlinked to the real
// trees, so the shim runs the real entry point whatever version this checkout
// carries.

const HOOK = "pre-tracker-write-gate";
const SHIM_PATH = join(import.meta.dir, "..", "process", `${HOOK}.sh`);
const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");
const SESSION = "s-607-shim";

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let stagedPlugin: string;
let repo: string;

function git(root: string, ...args: string[]): void {
  const p = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=dpt-607",
      "-c",
      "user.email=dpt-607@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      root,
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
}

function writeClaudeMd(root: string, declared: boolean): void {
  const lines = ["# Fixture", "", "## Task Tracking", "", "mode: jira", "mcp_server: atlassian", "", "### Jira", "", "project: GF"];
  if (declared) lines.push("default_labels: [glacy-be]", "repo_tag: glacy-be", "min_dpt_version: 2.87.0");
  lines.push("", "## Verification", "", "run_cmd: none", "");
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

beforeAll(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "ste-607-int-")));
  stagedPlugin = join(tmpRoot, "plugin");
  mkdirSync(join(stagedPlugin, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(stagedPlugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "dev-process-toolkit", version: "2.87.0" }) + "\n",
  );
  symlinkSync(join(PLUGIN_ROOT, "templates"), join(stagedPlugin, "templates"), "dir");
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(stagedPlugin, "adapters"), "dir");
  repo = join(tmpRoot, "be");
  mkdirSync(repo);
  writeClaudeMd(repo, true);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "fixture");
});

afterAll(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

let seq = 0;
function writeTranscript(lines: unknown[]): string {
  seq += 1;
  const file = join(tmpRoot, `transcript-${seq}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

async function runShim(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bash", SHIM_PATH], {
    cwd: tmpRoot,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: stagedPlugin, CLAUDE_CODE_SESSION_ID: SESSION },
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

const CREATE_INPUT = {
  cloudId: "glacy.atlassian.net",
  projectKey: "GF",
  issueTypeName: "Task",
  summary: "BE payout export",
  parent: "GF-85",
  additional_fields: { labels: ["glacy-be"] },
};

function createPayload(cwd: string, transcript: string): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: transcript,
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "mcp__atlassian__createJiraIssue",
    tool_input: CREATE_INPUT,
  });
}

describe("STE-607 — pre-tracker-write-gate.sh: the shim", () => {
  test("is a 2-line `exec bun run` wrapper around _lib/hooks/pre-tracker-write-gate.ts", () => {
    expect(existsSync(SHIM_PATH)).toBe(true);
    const body = readFileSync(SHIM_PATH, "utf-8");
    const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
    expect(trimmed.split("\n").length).toBeLessThanOrEqual(3);
    expect(body).toContain(
      `exec bun run "\${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/${HOOK}.ts"`,
    );
  });
});

describe("STE-607 — pre-tracker-write-gate.sh: end-to-end via stdin payload", () => {
  test("undeclared repository → exit 0, silent", async () => {
    const plain = join(tmpRoot, "plain");
    mkdirSync(plain);
    writeClaudeMd(plain, false);
    git(plain, "init", "-q", "-b", "main");
    const r = await runShim(createPayload(plain, writeTranscript([])));
    expect(r).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("declared repository, create with no receipt → exit 2 + NFR-10 Refusing block", async () => {
    const r = await runShim(createPayload(repo, writeTranscript([])));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain(`hook=${HOOK}`);
  });

  test("declared repository, create with a receipt announced by `decide` → exit 0", async () => {
    const prev = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = SESSION;
    let path: string;
    try {
      path = resolve(
        writeReceipt(repo, {
          kind: "create",
          adapter: "jira",
          container: "GF-85",
          subject: CREATE_INPUT.summary,
          decision: "create",
          evidence: {
            createPayload: {
              project: "GF",
              summary: CREATE_INPUT.summary,
              labels: ["glacy-be"],
              parent: "GF-85",
            },
          },
        }),
      );
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = prev;
    }
    const transcript = writeTranscript([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_607_shim_1",
              name: "Bash",
              input: {
                command: `bun run "${join(PLUGIN_ROOT, "adapters", "_shared", "src", "create_idempotency_probe.ts")}" decide "${repo}" /tmp/page.json --title "BE payout export" --parent GF-85 --attempt fast`,
              },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_607_shim_1",
              type: "tool_result",
              content: `{"outcome":"create","reason":"proven-absent"}\n${announceReceipt(path)}`,
            },
          ],
        },
      },
    ]);
    const r = await runShim(createPayload(repo, transcript));
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
  });
});

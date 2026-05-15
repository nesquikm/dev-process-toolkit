// STE-295 AC-STE-295.1 — pre-commit-tdd-orchestrator carve-out for spec-only commits.
//
// The pre-commit-tdd-orchestrator hook (templates/hooks/_lib/hooks/
// pre-commit-tdd-orchestrator.ts) currently requires `/tdd` whenever the
// staged set contains ANY FR/test-related path. STE-295 AC.1 carves out
// pure-spec commits (FR markdown, milestone plan files, archived FR/plan
// files, requirements/technical/testing-spec roots) so that a commit
// staging ONLY spec files passes without `/tdd`. The carve-out is
// strict: any src/test path in the staged set disables it, so mixed
// spec+src commits still require `/tdd` (preserving STE-290 behavior).
//
// Two test surfaces:
//   1. Pure classifier — `classifyStagedPaths(paths)` returns one of
//      `"spec-only"`, `"tdd-required"`, `"no-fr"`; the hook entrypoint
//      branches off the verdict. The pure function is unit-tested here.
//   2. Integration — spawn the hook binary against a temp git repo with
//      staged files, assert exit code matches the classifier verdict.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyStagedPaths } from "../templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "_lib",
  "hooks",
  "pre-commit-tdd-orchestrator.ts",
);

describe("AC-STE-295.1 — classifyStagedPaths: pure verdict function", () => {
  test("spec-only set: FR markdown alone → 'spec-only'", () => {
    expect(classifyStagedPaths(["specs/frs/STE-295.md"])).toBe("spec-only");
  });

  test("spec-only set: milestone plan file alone → 'spec-only'", () => {
    expect(classifyStagedPaths(["specs/plan/M70.md"])).toBe("spec-only");
  });

  test("spec-only set: archived plan file alone → 'spec-only'", () => {
    expect(classifyStagedPaths(["specs/plan/archive/M69.md"])).toBe(
      "spec-only",
    );
  });

  test("spec-only set: archived FR alone → 'spec-only'", () => {
    expect(classifyStagedPaths(["specs/frs/archive/STE-100.md"])).toBe(
      "spec-only",
    );
  });

  test("spec-only set: requirements.md / technical-spec.md / testing-spec.md → 'spec-only'", () => {
    expect(
      classifyStagedPaths([
        "specs/requirements.md",
        "specs/technical-spec.md",
        "specs/testing-spec.md",
      ]),
    ).toBe("spec-only");
  });

  test("spec-only set: multiple spec files together → 'spec-only'", () => {
    expect(
      classifyStagedPaths([
        "specs/frs/STE-295.md",
        "specs/plan/M70.md",
        "specs/requirements.md",
      ]),
    ).toBe("spec-only");
  });

  test("tdd-required: test file alone → 'tdd-required'", () => {
    expect(classifyStagedPaths(["src/foo.test.ts"])).toBe("tdd-required");
  });

  test("tdd-required: src + test files → 'tdd-required'", () => {
    expect(
      classifyStagedPaths(["src/foo.ts", "src/foo.test.ts"]),
    ).toBe("tdd-required");
  });

  test("tdd-required: __tests__ path → 'tdd-required'", () => {
    expect(
      classifyStagedPaths(["packages/x/__tests__/foo.test.ts"]),
    ).toBe("tdd-required");
  });

  test("tdd-required: mixed FR + src → 'tdd-required' (preserves STE-290 semantics)", () => {
    expect(
      classifyStagedPaths([
        "specs/frs/STE-295.md",
        "src/feature.ts",
      ]),
    ).toBe("tdd-required");
  });

  test("tdd-required: mixed FR + test → 'tdd-required'", () => {
    expect(
      classifyStagedPaths([
        "specs/frs/STE-295.md",
        "tests/foo.test.ts",
      ]),
    ).toBe("tdd-required");
  });

  test("no-fr: pure docs/config (README + CHANGELOG) → 'no-fr'", () => {
    expect(classifyStagedPaths(["README.md", "CHANGELOG.md"])).toBe("no-fr");
  });

  test("no-fr: empty staged set → 'no-fr'", () => {
    expect(classifyStagedPaths([])).toBe("no-fr");
  });
});

// ---------------------------------------------------------------------------
// Integration harness — exercise the hook binary against temp git repos.
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let repoDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-295-tdd-carveout-"));
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
  await Bun.spawn(["git", "init", "-q", repoDir], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  await Bun.spawn([
    "git",
    "-C",
    repoDir,
    "config",
    "user.email",
    "test@example.com",
  ]).exited;
  await Bun.spawn(["git", "-C", repoDir, "config", "user.name", "Test"])
    .exited;
  for (const [rel, body] of Object.entries(files)) {
    const full = join(repoDir, rel);
    const dir = full.split("/").slice(0, -1).join("/");
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", repoDir, "add", rel]).exited;
  }
}

async function runModule(stdinPayload: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: repoDir,
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

describe("AC-STE-295.1 — integration: spec-only commit passes without /tdd", () => {
  test("(a) FR-only commit + git commit + /tdd missing → exit 0 (carve-out fires)", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-295.md": "---\ntitle: x\n---\n",
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
      tool_input: { command: "git commit -m 'chore(specs): write FR'" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("(a') plan-file-only commit + git commit + /tdd missing → exit 0", async () => {
    await initRepoWithStaged({
      "specs/plan/M70.md": "# M70 — Plan\n",
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
      tool_input: { command: "git commit -m 'chore(plan): scope M70'" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-295.1 — integration: test+src still requires /tdd", () => {
  test("(b) src+test staged + git commit + /tdd missing → exit 2", async () => {
    await initRepoWithStaged({
      "src/feature.ts": "export function f() { return 1; }\n",
      "src/feature.test.ts": "// test\n",
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
      tool_input: { command: "git commit -m 'feat: add f'" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
  });
});

describe("AC-STE-295.1 — integration: mixed FR+src still requires /tdd", () => {
  test("(c) FR + src staged + git commit + /tdd missing → exit 2 (carve-out does NOT fire)", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-295.md": "---\ntitle: x\n---\n",
      "src/feature.ts": "export const x = 1;\n",
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
      tool_input: { command: "git commit -m 'feat: mixed'" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
  });

  test("(c') FR + test staged + git commit + /tdd missing → exit 2", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-295.md": "---\ntitle: x\n---\n",
      "tests/foo.test.ts": "// test\n",
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
      tool_input: { command: "git commit -m 'feat: mixed'" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
  });
});

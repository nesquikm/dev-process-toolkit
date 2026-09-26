// STE-290 AC.2 — `_lib/hooks/pre-commit-tdd-orchestrator.ts` per-hook TS module.
//
// Reads stdin, parses via `parseHookPayload`, resolves the repository the
// commit will WRITE TO via `resolveCommitTarget` (STE-597: the bare,
// `cd`-prefixed and `-C` forms alike — never the hook process's own cwd),
// then runs `git diff --cached --name-only` in THAT tree to filter for
// FR-related staged files. If FR-related files are staged, delegates to
// `requireSkillToolUse` for the `dev-process-toolkit:tdd` skill.

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

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let repoDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-mod-tdd-"));
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

/**
 * Initialise a temp git repo with the given staged files (path → contents).
 * Each file is written + `git add`-ed so `git diff --cached --name-only`
 * inside the repo will list them.
 */
async function initRepoWithStaged(
  files: Record<string, string>,
): Promise<void> {
  await initRepoAt(repoDir, files);
}

/**
 * STE-597 — the same fixture builder with the TREE named rather than assumed.
 * The defect this FR closes is a guard reading one tree while the commit writes
 * to another, so the tests need at least two of them.
 */
async function initRepoAt(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const init = Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" });
  await init.exited;
  // Configure identity locally so commits would work if we ever made one.
  await Bun.spawn(
    ["git", "-C", dir, "config", "user.email", "test@example.com"],
  ).exited;
  await Bun.spawn(
    ["git", "-C", dir, "config", "user.name", "Test"],
  ).exited;
  // M142 / STE-548 — written, never staged. See the note in
  // tests/pre-commit-tdd-orchestrator.test.ts: these repos have always meant
  // "a TypeScript project" and, since STE-547, have to carry the marker that
  // makes them one. Staging it would change the staged set under test.
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"fixture","version":"0.0.0","private":true}\n',
  );
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    const parent = full.split("/").slice(0, -1).join("/");
    mkdirSync(parent, { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", dir, "add", rel]).exited;
  }
}

/**
 * STE-360 — commit the currently staged files, then stage `deleteRel` as a
 * DELETION so `git diff --cached --name-only` lists it with no staged
 * additions (the STE-215/STE-222 first-real-test-lands lifecycle).
 */
async function commitStagedThenStageDeletion(deleteRel: string): Promise<void> {
  await Bun.spawn(
    [
      "git",
      "-C",
      repoDir,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "seed",
    ],
    { stdout: "pipe", stderr: "pipe" },
  ).exited;
  await Bun.spawn(["git", "-C", repoDir, "rm", "-q", deleteRel], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
}

/**
 * STE-597 — `procCwd` is the HOOK PROCESS's working directory, which is a
 * different thing from `payload.cwd` (the calling session's directory) and a
 * different thing again from the tree the command names. Before this FR the
 * module read only the first of the three, so the three could not be told
 * apart; every case below varies them independently on purpose.
 */
async function runModule(
  stdinPayload: string,
  procCwd: string = repoDir,
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: procCwd,
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

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator module: file exists", () => {
  test("module exists at the documented path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: command-pattern guard early-exits non-`git commit`", () => {
  test("`git status` command → exit 0", async () => {
    await initRepoWithStaged({});
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: staged-file heuristic via `git diff --cached`", () => {
  test("only docs/config staged + git commit → exit 0 even without /tdd tool_use", async () => {
    await initRepoWithStaged({
      "CHANGELOG.md": "# CHANGELOG\n",
      "README.md": "# README\n",
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
      tool_input: { command: "git commit -m docs" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("FR file staged + git commit + /tdd tool_use present → exit 0", async () => {
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
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("FR-only file staged + git commit + /tdd tool_use missing → exit 0 (STE-295 carve-out)", async () => {
    await initRepoWithStaged({
      "specs/frs/STE-290.md": "---\ntitle: x\n---\n",
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
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("test file staged + git commit + /tdd tool_use missing → exit non-zero", async () => {
    await initRepoWithStaged({
      "src/foo.test.ts": "// test\n",
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
      tool_input: { command: "git commit -m feat" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
  });
});

describe("AC-STE-290.2 — pre-commit-tdd-orchestrator: empty stdin fails open", () => {
  test("empty stdin → exit 0", async () => {
    await initRepoWithStaged({});
    const r = await runModule("");
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// STE-360 — /setup Bun zero-match placeholder exemption.
//
// A staged path is exempt iff (a) its basename is `.placeholder.test.ts` AND
// (b) the staged content carries the "Bun zero-match workaround" marker
// comment OR the path is staged as a deletion. Exempt-only commits pass
// without /tdd evidence; mixed commits (placeholder + any tdd-required file)
// still require it.
// ---------------------------------------------------------------------------

const PLACEHOLDER_MARKER =
  "// generated by /dev-process-toolkit:setup — Bun zero-match workaround (see examples/bun-typescript.md)";

const PLACEHOLDER_BODY = [
  PLACEHOLDER_MARKER,
  'import { expect, test } from "bun:test";',
  "",
  'test("placeholder", () => {',
  "  expect(true).toBe(true);",
  "});",
  "",
].join("\n");

// A real test renamed to `.placeholder.test.ts` WITHOUT the marker — the
// gaming attempt the dual key exists to block.
const MARKERLESS_BODY = [
  'import { expect, test } from "bun:test";',
  "",
  'test("adds two numbers", () => {',
  "  expect(1 + 2).toBe(3);",
  "});",
  "",
].join("\n");

function commitPayloadStdin(transcript: string): string {
  return JSON.stringify({
    session_id: "s1",
    transcript_path: transcript,
    cwd: repoDir,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git commit -m chore" },
  });
}

function transcriptWithoutTddEvidence(): string {
  return writeTranscript([
    { type: "tool_use", name: "Bash", input: { command: "ls" } },
  ]);
}

describe("AC-STE-360.1 — placeholder exemption: exempt-only commits pass without /tdd evidence", () => {
  test("src/.placeholder.test.ts with marker staged alone + /tdd tool_use missing → exit 0", async () => {
    await initRepoWithStaged({
      "src/.placeholder.test.ts": PLACEHOLDER_BODY,
    });
    const r = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(r.exitCode).toBe(0);
  });

  test("placeholder DELETION staged alone + /tdd tool_use missing → exit 0 (STE-215/STE-222 lifecycle)", async () => {
    await initRepoWithStaged({
      "src/.placeholder.test.ts": PLACEHOLDER_BODY,
    });
    await commitStagedThenStageDeletion("src/.placeholder.test.ts");
    const r = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-360.1 — placeholder exemption: dual key blocks gaming, mixed commits still require evidence", () => {
  test("`.placeholder.test.ts` WITHOUT marker staged + /tdd tool_use missing → exit 2 (still tdd-required)", async () => {
    await initRepoWithStaged({
      "src/.placeholder.test.ts": MARKERLESS_BODY,
    });
    const r = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(r.exitCode).toBe(2);
  });

  test("placeholder (with marker) + real FR file staged + /tdd tool_use missing → exit 2", async () => {
    await initRepoWithStaged({
      "src/.placeholder.test.ts": PLACEHOLDER_BODY,
      "specs/frs/STE-360.md": "---\ntitle: x\n---\n",
    });
    const r = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(r.exitCode).toBe(2);
  });

  test("placeholder (with marker) + real test file staged + /tdd tool_use missing → exit 2", async () => {
    await initRepoWithStaged({
      "src/.placeholder.test.ts": PLACEHOLDER_BODY,
      "src/foo.test.ts": "// test\n",
    });
    const r = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// STE-597 — the guard classifies against the repository the commit WRITES TO.
//
// The geometry below IS the defect, built explicitly:
//
//   repo B — the tree the commit writes to. `src/foo.test.ts` STAGED.
//   repo A — the tree the calling session sits in. Nothing staged.
//
// Before this FR the hook read `process.cwd()` for the staged set and matched
// commits with `/^git commit\b/`. So committing B's staged test file from a
// session rooted in A was waved through, and any command that changed directory
// or passed `-C` before committing was not recognised as a commit at all.
//
// AC-STE-597.1 — three shapes recognised, each resolving its target repo.
// AC-STE-597.2 — the verdict does not move with the calling session's directory.
// AC-STE-597.4 — an unresolvable target is an advisory, never a refusal.
// AC-STE-597.5 — each case records which bytes it fails on; see the CONTROL
//   tests, which hold in BOTH directions and prove the exit-2 assertions can
//   go green for a reason other than "this hook refuses everything".
// ---------------------------------------------------------------------------

let repoA: string;
let repoB: string;

/** repo B (target, test file staged) + repo A (session, nothing staged). */
async function buildAB(): Promise<void> {
  repoA = join(tmpRoot, "repo-a");
  repoB = join(tmpRoot, "repo-b");
  await initRepoAt(repoA, {});
  await initRepoAt(repoB, { "src/foo.test.ts": "// test\n" });
}

function payloadFor(
  command: string,
  sessionCwd: string,
  transcript: string,
): string {
  return JSON.stringify({
    session_id: "s1",
    transcript_path: transcript,
    cwd: sessionCwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

function tddEvidenceTranscript(): string {
  return writeTranscript([
    {
      type: "tool_use",
      name: "Skill",
      input: { skill: "dev-process-toolkit:tdd" },
    },
  ]);
}

describe("AC-STE-597.1/2 — staged paths are classified against the resolved target repo", () => {
  test("shape 1 (bare): process cwd = A, payload.cwd = B → exit 2 (B's staged test file is the subject)", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor("git commit -m x", repoB, transcriptWithoutTddEvidence()),
      repoA,
    );
    expect(r.exitCode).toBe(2);
  });

  test("shape 2 (cd-prefixed): `cd <B> && git commit` → exit 2 (the retired matcher saw no commit at all)", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor(`cd ${repoB} && git commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
  });

  test("shape 3 (-C): `git -C <B> commit`, process cwd = A, payload.cwd = A → exit 2", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor(`git -C ${repoB} commit -m x`, repoA, transcriptWithoutTddEvidence()),
      repoA,
    );
    expect(r.exitCode).toBe(2);
  });

  test("CONTROL — all three shapes exit 0 when the /tdd evidence IS present, so the 2s above come from the missing evidence", async () => {
    await buildAB();
    const evidence = tddEvidenceTranscript();
    const bare = await runModule(payloadFor("git commit -m x", repoB, evidence), repoA);
    const cd = await runModule(
      payloadFor(`cd ${repoB} && git commit -m x`, repoB, evidence),
      repoB,
    );
    const dashC = await runModule(
      payloadFor(`git -C ${repoB} commit -m x`, repoA, evidence),
      repoA,
    );
    expect([bare.exitCode, cd.exitCode, dashC.exitCode]).toEqual([0, 0, 0]);
  });

  test("CONTROL — all three shapes exit 0 when the target tree stages only docs, so the 2s track the staged SET", async () => {
    repoA = join(tmpRoot, "repo-a");
    repoB = join(tmpRoot, "repo-b");
    await initRepoAt(repoA, {});
    await initRepoAt(repoB, { "CHANGELOG.md": "# CHANGELOG\n" });
    const t = transcriptWithoutTddEvidence();
    const bare = await runModule(payloadFor("git commit -m x", repoB, t), repoA);
    const cd = await runModule(payloadFor(`cd ${repoB} && git commit -m x`, repoB, t), repoB);
    const dashC = await runModule(payloadFor(`git -C ${repoB} commit -m x`, repoA, t), repoA);
    expect([bare.exitCode, cd.exitCode, dashC.exitCode]).toEqual([0, 0, 0]);
  });

  test("CONTROL — a command that only MENTIONS a commit is not one: `git log --grep='git commit'` → exit 0 with B staged", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor("git log --grep='git commit'", repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-597.2 — identical staged content, same branch: the verdict does not move with the session's directory", () => {
  test("a worktree and its main checkout return the SAME verdict for the same commit target", async () => {
    const main = join(tmpRoot, "wt-main");
    const linked = join(tmpRoot, "wt-linked");
    await initRepoAt(main, {});
    // A commit is required before a worktree can be added.
    await Bun.spawn(
      ["git", "-C", main, "add", "package.json"],
      { stdout: "pipe", stderr: "pipe" },
    ).exited;
    await Bun.spawn(
      ["git", "-C", main, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"],
      { stdout: "pipe", stderr: "pipe" },
    ).exited;
    const branchProc = Bun.spawn(
      ["git", "-C", main, "rev-parse", "--abbrev-ref", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const branch = (await new Response(branchProc.stdout).text()).trim();
    await branchProc.exited;
    const add = Bun.spawn(
      ["git", "-C", main, "worktree", "add", "--force", linked, branch],
      { stdout: "pipe", stderr: "pipe" },
    );
    await add.exited;
    // Same repo, same branch — and the FIXTURE ITSELF is graded, because a
    // worktree that silently failed to materialise would make every assertion
    // below meaningless.
    expect(existsSync(join(linked, ".git"))).toBe(true);
    expect(existsSync(join(linked, "package.json"))).toBe(true);

    // The staged set lives in the LINKED worktree's index — the tree the
    // commit writes to.
    mkdirSync(join(linked, "src"), { recursive: true });
    writeFileSync(join(linked, "src", "foo.test.ts"), "// test\n");
    await Bun.spawn(["git", "-C", linked, "add", "src/foo.test.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const t = transcriptWithoutTddEvidence();
    const cmd = `git -C ${linked} commit -m x`;
    const fromMain = await runModule(payloadFor(cmd, main, t), main);
    const fromWorktree = await runModule(payloadFor(cmd, linked, t), linked);

    // The pairing IS the AC: same staged content, opposite session roots.
    expect(fromMain.exitCode).toBe(fromWorktree.exitCode);
    expect(fromMain.exitCode).toBe(2);
    expect(fromWorktree.exitCode).toBe(2);

    // CONTROL — unstage, and BOTH sessions flip to 0. Without this the
    // equality above would also hold for a hook that refused unconditionally.
    await Bun.spawn(["git", "-C", linked, "reset", "-q", "HEAD", "--", "src/foo.test.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    const cleanMain = await runModule(payloadFor(cmd, main, t), main);
    const cleanWorktree = await runModule(payloadFor(cmd, linked, t), linked);
    expect(cleanMain.exitCode).toBe(cleanWorktree.exitCode);
    expect(cleanMain.exitCode).toBe(0);
  });
});

describe("AC-STE-597.4 — an unresolvable commit target is an advisory, never a refusal", () => {
  test("`cd \"$REPO\" && git commit` → exit 1 + a canonical Reminder naming what could not be determined", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor('cd "$REPO" && git commit -m x', repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    // It NAMES the thing it could not resolve — the unexpanded argument.
    expect(r.stderr).toContain("$REPO");
    // And it is never a refusal.
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("CONTROL — the resolvable sibling of that command emits NO reminder and DOES refuse", async () => {
    // Same staged set, same session, same missing evidence; the only difference
    // is that the cd argument resolves. Without this the assertions above would
    // pass against a hook that printed a reminder on every command.
    await buildAB();
    const r = await runModule(
      payloadFor(`cd ${repoB} && git commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).not.toContain("Reminder:");
    expect(r.stderr).toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.2 (AUDIT) — anchoring at the repository ROOT is deliberate, and
// the consequence must be LOUD.
//
// `resolveStackLayout` now starts at the resolved `repoRoot` and stops at
// `.git`, so a checkout whose ROOT carries no recognised marker verdicts
// `stack-unknown` even when a sub-package carries one. That IS the FR — the
// verdict is a property of the repository, not of whichever directory the
// session happened to sit in, and a resolver that walked up out of the
// checkout would put the session back in charge. But an unheard verdict and a
// bypass are the same thing from the operator's chair, so what is pinned here
// is the NOISE: exit 0 is only acceptable while it comes with a canonical
// reminder that names the project.
// ---------------------------------------------------------------------------

/**
 * A checkout whose ROOT carries no stack marker: the `package.json` lives in a
 * sub-package, and the staged test file lives under it. `rootMarker` promotes
 * the same fixture to a recognised project so the two can be paired.
 */
async function initSubPackageRepo(
  dir: string,
  opts: { rootMarker: boolean },
): Promise<void> {
  mkdirSync(join(dir, "pkg", "src"), { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  // The SUB-PACKAGE is a TypeScript project. The repo root is not one.
  writeFileSync(
    join(dir, "pkg", "package.json"),
    '{"name":"sub","version":"0.0.0","private":true}\n',
  );
  if (opts.rootMarker) {
    writeFileSync(
      join(dir, "package.json"),
      '{"name":"root","version":"0.0.0","private":true}\n',
    );
  }
  writeFileSync(join(dir, "pkg", "src", "foo.test.ts"), "// test\n");
  await Bun.spawn(["git", "-C", dir, "add", "pkg/src/foo.test.ts"], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
}

describe("AC-STE-597.2 — a checkout with no marker at its ROOT verdicts stack-unknown, and says so out loud", () => {
  test("marker only in a sub-package + a test file staged → exit 1 AND a canonical Reminder naming the project", async () => {
    const root = join(tmpRoot, "sub-pkg-markerless");
    await initSubPackageRepo(root, { rootMarker: false });

    const r = await runModule(
      payloadFor(`git -C ${root} commit -m x`, root, transcriptWithoutTddEvidence()),
      root,
    );

    expect(r.exitCode).toBe(1);
    // Exit 0 on its own is indistinguishable from the bypass this FR closed.
    // These three lines are what makes it a verdict instead.
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    // And it names WHICH project could not be identified, so the remedy is
    // actionable rather than a riddle.
    expect(r.stderr).toContain(root);
    // Never a refusal: not knowing the stack is the toolkit's limitation.
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("CONTROL — put the marker at the ROOT and the IDENTICAL staged set refuses, so the exit 0 above is the missing root marker's doing", async () => {
    const root = join(tmpRoot, "sub-pkg-marked");
    await initSubPackageRepo(root, { rootMarker: true });

    const r = await runModule(
      payloadFor(`git -C ${root} commit -m x`, root, transcriptWithoutTddEvidence()),
      root,
    );

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("CONTROL — the marker-less checkout exits 0 SILENTLY with nothing staged, so the Reminder is not printed on every commit", async () => {
    const root = join(tmpRoot, "sub-pkg-empty");
    await initSubPackageRepo(root, { rootMarker: false });
    // Unstage the test file: same marker-less root, empty staged set.
    await Bun.spawn(["git", "-C", root, "reset", "-q"], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const r = await runModule(
      payloadFor(`git -C ${root} commit -m x`, root, transcriptWithoutTddEvidence()),
      root,
    );

    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// STE-598 — the second door, end to end through the shipped entrypoint.
//
// The unit suite in tests/hook-session-lib.test.ts pins the disjunction at the
// library boundary. These cases pin that the ENTRYPOINT actually routes through
// it, and that it hands the proof the SAME `required` set the STE-360 exemption
// already computes — a proof for some other file must not open the door.
//
//   AC-STE-598.1 — the existing trigger is unchanged (neither door ⇒ exit 2).
//   AC-STE-598.2 — a proof naming a DIFFERENT file does not satisfy.
//   AC-STE-598.4 — the refusal names both doors.
// ---------------------------------------------------------------------------

const SESSION_LIB = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "_lib",
  "session.ts",
);

/** Raw JSONL writer under a distinct name, so two transcripts can coexist. */
function writeRawTranscript(name: string, lines: string[]): string {
  const file = join(tmpRoot, name);
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

/** A transcript whose ONLY evidence is a red-before proof covering `paths`. */
async function proofOnlyTranscript(
  name: string,
  paths: string[],
): Promise<string> {
  const { RED_BEFORE_PROOF_MARKER } = await import(SESSION_LIB);
  return writeRawTranscript(name, [
    JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "bun test" } }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `${RED_BEFORE_PROOF_MARKER} ${paths.join(" ")}`,
      },
    }),
  ]);
}

describe("AC-STE-598.1 — a staged test file is satisfied by EITHER door", () => {
  test("staged test file + NEITHER kind of evidence → exit 2 (trigger unchanged)", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(2);
  });

  test("staged test file + a red-before proof NAMING it → exit 0", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const t = await proofOnlyTranscript("proof-covering.jsonl", ["src/foo.test.ts"]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(0);
    // Silent: a passing commit must not print a refusal it then ignores.
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("staged test file + orchestrator evidence ONLY → exit 0 (must not regress)", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const r = await runModule(commitPayloadStdin(tddEvidenceTranscript()));
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-598.2 — the proof is scoped to the paths that raised the requirement", () => {
  test("staged test file + a proof naming a DIFFERENT file → exit 2", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const t = await proofOnlyTranscript("proof-unrelated.jsonl", [
      "src/somethingelse.test.ts",
    ]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("CONTROL — the SAME transcript shape opens the door once it names the staged file, so the exit 2 above is the path's doing", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const t = await proofOnlyTranscript("proof-control.jsonl", ["src/foo.test.ts"]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-598.4 — the end-to-end refusal names both doors", () => {
  test("neither door → the Refusing block names the orchestrator AND the literal proof marker", async () => {
    const { RED_BEFORE_PROOF_MARKER } = await import(SESSION_LIB);
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("dev-process-toolkit:tdd");
    expect(r.stderr).toMatch(/red-before/i);
    expect(r.stderr).toContain(RED_BEFORE_PROOF_MARKER);
  });

  test("CONTROL — a commit that never raised the requirement prints no refusal at all", async () => {
    await initRepoWithStaged({ "README.md": "# readme\n" });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.4 (with AC-STE-598.2) — the refusal names the staged paths that
// raised the requirement, end to end.
//
// The remedy asks for a proof "naming every staged test path it covers" and
// then leaves the operator to work out which those are. The entrypoint already
// computed that exact set — it is the `required` list it handed the guard — so
// withholding it is friction with no purchase behind it, aimed at the one
// audience most likely to reach for the workaround instead.
// ---------------------------------------------------------------------------

describe("AC-STE-598.4 — the refusal hands back the list the operator has to name", () => {
  test("TWO staged test files, neither door → the Refusing block names BOTH of them", async () => {
    await initRepoWithStaged({
      "src/alpha.test.ts": "// test\n",
      "src/beta.test.ts": "// test\n",
    });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("src/alpha.test.ts");
    expect(r.stderr).toContain("src/beta.test.ts");
  });

  test("CONTROL — with only ONE of the two staged, the refusal names that one and NOT the other", async () => {
    // The absent path is a fixture choice, not a reading of the guard: if the
    // assertions above were matching the template rather than the staged set,
    // this one would name a file that was never staged.
    await initRepoWithStaged({ "src/alpha.test.ts": "// test\n" });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("src/alpha.test.ts");
    expect(r.stderr).not.toContain("src/beta.test.ts");
  });

  test("CONTROL — a staged NON-test file alongside the test does not get named as a path the proof must cover", async () => {
    // `required` is the tdd-triggering subset, not the staged set. A refusal
    // that listed the staged set would send the operator to prove a README red.
    await initRepoWithStaged({
      "src/alpha.test.ts": "// test\n",
      "README.md": "# readme\n",
    });
    const r = await runModule(commitPayloadStdin(transcriptWithoutTddEvidence()));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("src/alpha.test.ts");
    expect(r.stderr).not.toContain("README.md");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.1 / AC-STE-598.2 — the SECOND attempt at an identical commit.
//
// Measured on 2026-09-16 against Claude Code 2.1.245. When this hook exits 2,
// Claude Code records the denial as ONE JSONL line in the very transcript the
// hook reads next time, and that line carries the hook's stderr TWICE — as the
// tool_result under `message.content[]` and again under `toolUseResult`. The
// stderr quotes the proof marker in its `Remedy:` line, and the second copy's
// `Refusing:` line names the staged paths. The guard's own refusal therefore
// reads as a red-before proof for the paths it just refused, and the operator
// retrying the SAME commit with nothing changed and nothing run is waved
// through.
//
// This is not a transcription of that transcript: the refusal bytes below are
// produced by RUNNING the shipped entrypoint and capturing what it actually
// printed, then fed back in the real denial shape.
// ---------------------------------------------------------------------------

/**
 * A Claude Code 2.1.245 PreToolUse DENIAL record: one JSONL line carrying
 * `stderr` twice, under `message.content[].content` and under `toolUseResult`.
 */
function denialRecord(stderr: string): string {
  return JSON.stringify({
    parentUuid: "11111111-1111-1111-1111-111111111111",
    isSidechain: false,
    userType: "external",
    cwd: repoDir,
    sessionId: "s1",
    version: "2.1.245",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA",
          type: "tool_result",
          content: stderr,
          is_error: true,
        },
      ],
    },
    uuid: "22222222-2222-2222-2222-222222222222",
    timestamp: "2026-09-16T14:40:56.000Z",
    toolUseResult: stderr,
  });
}

/** The prior turn's Bash tool_use — what the denial record is a result FOR. */
const COMMIT_ATTEMPT_LINE = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA",
        name: "Bash",
        input: { command: "git commit -m chore" },
      },
    ],
  },
});

describe("AC-STE-598.1 — a refused commit, retried identically, is refused again", () => {
  test("refuse once, feed the resulting denial record back as the transcript, retry the SAME commit → still exit 2", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });

    // Attempt one — the real refusal, from the shipped entrypoint.
    const first = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(first.exitCode).toBe(2);
    expect(first.stderr).toContain("Refusing:");
    expect(first.stderr).toContain("src/foo.test.ts");

    // Attempt two — nothing was run, nothing changed; the session has only
    // grown by Claude Code's record of that denial.
    const retry = writeRawTranscript("after-denial.jsonl", [
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
      COMMIT_ATTEMPT_LINE,
      denialRecord(first.stderr),
    ]);
    const second = await runModule(commitPayloadStdin(retry));
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("Refusing:");
  });

  test("CONTROL — with the denial record STILL in the transcript, an honest proof after it opens the door", async () => {
    // Same harness, same record, one line added. If the exit 2 above were an
    // artefact of the fixture rather than of the record, this would fail too.
    const { RED_BEFORE_PROOF_MARKER } = await import(SESSION_LIB);
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });

    const first = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(first.exitCode).toBe(2);

    const retry = writeRawTranscript("after-denial-then-proof.jsonl", [
      COMMIT_ATTEMPT_LINE,
      denialRecord(first.stderr),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: `${RED_BEFORE_PROOF_MARKER} src/foo.test.ts`,
        },
      }),
    ]);
    const second = await runModule(commitPayloadStdin(retry));
    expect(second.exitCode).toBe(0);
    expect(second.stderr).not.toContain("Refusing:");
  });

  test("CONTROL — the denial record from a DIFFERENT path's refusal is no proof for this commit either", async () => {
    // Guards the near-miss fix that bounds the claim but still reads the
    // refusal's own `Refusing:` prose as a claim: this record names
    // src/other.test.ts, and the staged file is src/foo.test.ts.
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const first = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(first.exitCode).toBe(2);
    const foreign = first.stderr.replaceAll("src/foo.test.ts", "src/other.test.ts");
    expect(foreign).not.toContain("src/foo.test.ts");

    const retry = writeRawTranscript("after-foreign-denial.jsonl", [
      COMMIT_ATTEMPT_LINE,
      denialRecord(foreign),
    ]);
    const second = await runModule(commitPayloadStdin(retry));
    expect(second.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.2 — the honest operator, end to end (second audit, MEDIUM).
//
// The claim bound treats a backtick as the end of a proof. A backtick is also
// what an operator types AROUND a path when writing the proof in prose, so the
// careful form is refused and the remedy hands back the form it rejected. These
// cases pin the fix through the SHIPPED ENTRYPOINT, not just the library, and
// re-assert alongside them the self-satisfaction refusal the relaxation could
// plausibly break.
// ---------------------------------------------------------------------------

/** A proof transcript whose paths are each wrapped in their own code span. */
async function inlineCodeProofTranscript(
  name: string,
  paths: string[],
): Promise<string> {
  const { RED_BEFORE_PROOF_MARKER } = await import(SESSION_LIB);
  return writeRawTranscript(name, [
    JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "bun test" } }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `${RED_BEFORE_PROOF_MARKER} ${paths
          .map((p) => `\`${p}\``)
          .join(" ")}`,
      },
    }),
  ]);
}

describe("AC-STE-598.2 — a proof whose paths are in inline-code spans opens the door", () => {
  test("TWO staged test files, each named in its own code span → exit 0", async () => {
    await initRepoWithStaged({
      "src/alpha.test.ts": "// test\n",
      "src/beta.test.ts": "// test\n",
    });
    const t = await inlineCodeProofTranscript("inline-code-two.jsonl", [
      "src/alpha.test.ts",
      "src/beta.test.ts",
    ]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("ONE staged test file named in a code span → exit 0", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const t = await inlineCodeProofTranscript("inline-code-one.jsonl", [
      "src/foo.test.ts",
    ]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
  });

  test("CONTROL — the same code-span form naming a DIFFERENT file is still refused", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const t = await inlineCodeProofTranscript("inline-code-unrelated.jsonl", [
      "src/somethingelse.test.ts",
    ]);
    const r = await runModule(commitPayloadStdin(t));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("RE-ASSERTED — refuse, feed the denial record back, retry the SAME commit → still exit 2 with the backtick no longer terminating", async () => {
    // The clause the previous retry round bought, restated under the
    // relaxation. If widening the claim re-opens self-satisfaction, this is
    // where it shows, at the entrypoint, on bytes the entrypoint printed.
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const first = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(first.exitCode).toBe(2);
    expect(first.stderr).toContain("src/foo.test.ts");

    const retry = writeRawTranscript("relaxed-after-denial.jsonl", [
      COMMIT_ATTEMPT_LINE,
      denialRecord(first.stderr),
    ]);
    const second = await runModule(commitPayloadStdin(retry));
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("Refusing:");
  });

  test("CONTROL — that same denial record followed by a code-span proof DOES open the door", async () => {
    await initRepoWithStaged({ "src/foo.test.ts": "// test\n" });
    const { RED_BEFORE_PROOF_MARKER } = await import(SESSION_LIB);
    const first = await runModule(
      commitPayloadStdin(transcriptWithoutTddEvidence()),
    );
    expect(first.exitCode).toBe(2);

    const retry = writeRawTranscript("relaxed-denial-then-proof.jsonl", [
      COMMIT_ATTEMPT_LINE,
      denialRecord(first.stderr),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: `${RED_BEFORE_PROOF_MARKER} \`src/foo.test.ts\``,
        },
      }),
    ]);
    const second = await runModule(commitPayloadStdin(retry));
    expect(second.exitCode).toBe(0);
    expect(second.stderr).not.toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// STE-597 Phase 3 Stage B (Pass 2) — FINDING B.
//
// `gitOut` spawns `git` with no try/catch. When the subprocess cannot RUN AT
// ALL — `git` missing from PATH, or the resolved repoRoot gone between
// resolution and the spawn — `Bun.spawn` throws synchronously and the hook dies
// with a raw Bun stack trace and exit 1. Every OTHER failure mode in that same
// file (unresolved target, unknown stack, missing transcript) emits a
// deliberate, worded NFR-10 block and exits 0.
//
// A guard that crashes is a guard the operator has to read a stack trace to
// understand, and on a PreToolUse hook a non-zero exit that is not 2 is an
// unexplained interruption. The rule pinned here: when the git subprocess
// cannot run, SAY SO in the canonical three lines and exit 0.
//
// HOW `git` IS MADE UNRUNNABLE: the module is launched by ABSOLUTE path
// (`process.execPath`, the bun binary running this suite) with a `PATH`
// containing exactly one empty directory. Nothing about the machine's real PATH
// contents is assumed — no `git` is renamed, moved or shadowed, and no fixture
// reaches outside `tmpRoot`. The CONTROL below grades that the mechanism
// actually bites, because a `git` that quietly still ran would make every
// clause here vacuous.
// ---------------------------------------------------------------------------

/** An empty directory, used as the entire PATH of a child process. */
function noGitBinDir(): string {
  const dir = join(tmpRoot, "no-git-bin");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The shipped entrypoint, run with `git` unreachable. */
async function runModuleWithoutGit(
  stdinPayload: string,
  procCwd: string,
): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", MODULE_PATH], {
    cwd: procCwd,
    env: {
      PATH: noGitBinDir(),
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
    },
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

describe("AC-STE-597.4 — a git subprocess that cannot RUN speaks NFR-10 instead of crashing", () => {
  test("CONTROL — the crippled PATH really does make `git` unrunnable, and the real one does not", async () => {
    // Without this, every clause below could pass for the wrong reason: a `git`
    // that still resolved would make "the subprocess failed" a claim about
    // nothing.
    const bin = noGitBinDir();
    let threw = false;
    try {
      const crippled = Bun.spawn(["git", "--version"], {
        env: { PATH: bin },
        stdout: "pipe",
        stderr: "pipe",
      });
      await crippled.exited;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const real = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
    expect(await real.exited).toBe(0);
  });

  test("staged test file + no evidence + `git` unrunnable → exit 1 and a canonical Reminder, not a stack trace", async () => {
    await buildAB();
    const r = await runModuleWithoutGit(
      payloadFor(`git -C ${repoB} commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );

    // Exit 1 here is the crash; exit 2 would be a refusal the hook has no
    // grounds for, because it never managed to look at anything.
    expect(r.exitCode).toBe(1);

    // The canonical three lines, byte-stable per STE-286 §104.
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain(
      "Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator",
    );

    // It NAMES what it could not do: run git, in that repository.
    expect(r.stderr).toContain("git");
    expect(r.stderr).toContain(repoB);

    // Never a refusal — a broken toolchain is the toolkit's problem, not the
    // operator's mistake.
    expect(r.stderr).not.toContain("Refusing:");

    // And never a raw Bun crash dump: no stack frames, no runtime banner.
    expect(r.stderr).not.toMatch(/^\s+at /m);
    expect(r.stderr).not.toMatch(/^Bun v/m);
  });

  test("CONTROL — the IDENTICAL payload with `git` runnable behaves exactly as it does today", async () => {
    // Same fixture, same command, same missing evidence; the only difference is
    // that git can run. This is what makes the exit 0 above attributable to the
    // subprocess failure rather than to a hook that had stopped refusing.
    await buildAB();
    const r = await runModule(
      payloadFor(`git -C ${repoB} commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("CONTROL — `git` unrunnable on a NON-commit command exits 0 SILENTLY", async () => {
    // The advisory must track the failed subprocess, not merely "git is
    // missing": a command the guard never needed git for prints nothing.
    await buildAB();
    const r = await runModuleWithoutGit(
      payloadFor("git status", repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("CONTROL — `git` runnable with an EMPTY staged set exits 0 with no Reminder", async () => {
    // The other way the new advisory could be wrong: firing whenever the staged
    // list comes back empty. A successful `git diff --cached` that lists nothing
    // is not a failure and must stay silent.
    repoA = join(tmpRoot, "repo-a");
    repoB = join(tmpRoot, "repo-b");
    await initRepoAt(repoA, {});
    await initRepoAt(repoB, {});
    const r = await runModule(
      payloadFor(`git -C ${repoB} commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// STE-597 Pass 2 ROUND 2 — a `$(...)` in a global-option value made the commit
// INVISIBLE to this hook, end to end.
//
// Measured before this section existed: `git -C $(pwd) commit -m x` resolved to
// `isCommit: false`, because the splitter read the substitution's `(` as a
// subshell opener and tore `git -C $` away from `commit`. This hook early-exits
// on `!isCommit`, so the result was exit 0 in SILENCE — with a test file staged
// and no `/tdd` evidence anywhere in the session. Not the advisory this FR's
// honesty rule promises; nothing at all.
//
// The required behaviour is the one AC-STE-597.4 already specifies for every
// target it cannot place: exit 0, and SAY SO. The refusal is not available here
// because the staged set genuinely cannot be classified — but the silence is
// not available either.
// ---------------------------------------------------------------------------

describe("AC-STE-597.4 — a `$(...)` target is never silence (STE-613: `$(pwd)` now resolves and refuses)", () => {
  test("`git -C $(pwd) commit` with a staged test file and no /tdd evidence → exit 2 (STE-613: the target resolves and the staged test raises the requirement)", async () => {
    await buildAB();
    const r = await runModule(
      payloadFor("git -C $(pwd) commit -m x", repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
    // STE-613: `$(pwd)` is the running directory, so the target resolves and
    // this is an ordinary refusal of a staged test with no /tdd evidence.
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    // A resolved target is never the unresolved-target Reminder.
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("CONTROL — the RESOLVABLE sibling of that command still refuses, with no reminder", async () => {
    // Same fixture, same missing evidence, same `-C` shape; the only difference
    // is that the argument is a literal path. Without this the clause above
    // would also pass against a hook that had become an advisory for every
    // commit — which is the bypass, arriving through the fix.
    await buildAB();
    const r = await runModule(
      payloadFor(`git -C ${repoB} commit -m x`, repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("CONTROL — `git commit -m $(echo hi)` still REFUSES: a computed message is not an unplaceable repository", async () => {
    // The substitution sits after the subcommand, so it says nothing about
    // where the commit lands. A hook that advised here would hand anyone a
    // one-word bypass.
    await buildAB();
    const r = await runModule(
      payloadFor("git commit -m $(echo hi)", repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("CONTROL — `git -C $(pwd) status` is not a commit: exit 0 and SILENT", async () => {
    // The advisory must be pinned to the COMMIT, not to the substitution. A
    // reader that reminded on every `$(...)` it met would start narrating
    // read-only commands, and this clause is what stops the fix from going
    // that way.
    await buildAB();
    const r = await runModule(
      payloadFor("git -C $(pwd) status", repoB, transcriptWithoutTddEvidence()),
      repoB,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-613.6 — the wrong-tree defect, graded through the SHIPPED wrapper.
//
// Two makeSpanFixture checkouts: FE0 (the session's, nothing staged) and B,
// which stages an FR file, a source file and its test behind a pyproject.toml
// stack marker. Every spawn is SERIAL.
// ---------------------------------------------------------------------------

import { afterAll as afterAll613, beforeAll as beforeAll613 } from "bun:test";
import { mkdirSync as mkdirSync613, mkdtempSync as mkdtempSync613, renameSync as renameSync613, rmSync as rmSync613, writeFileSync as writeFileSync613 } from "node:fs";
import { git as git613, makeSpanFixture as makeSpanFixture613, type SpanFixture as SpanFixture613 } from "./_span_fixture";
import { receiptsDirOf as receiptsDirOf613, writeGateReceipt as writeGateReceipt613, announcementRecords as announcementRecords614, mintedAnnouncements as mintedAnnouncements614} from "./_gate_receipt_fixture";

describe("AC-STE-613.6 — cd options, builtin cd and pushd move the commit with them (hook e2e)", () => {
  const WRAPPER613 = join(import.meta.dir, "..", "templates", "hooks", "process", "pre-commit-tdd-orchestrator.sh");
  const PLUGIN613 = join(import.meta.dir, "..");
  const T613 = 300_000;
  let fx613: SpanFixture613;
  let FE0 = "";
  let B613 = "";
  let scratch613 = "";
  let noEvidence613 = "";
  let evidence613 = "";

  function stage613(root: string, files: Record<string, string>): void {
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync613(full.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync613(full, body);
      git613(root, "add", rel);
    }
  }

  // STE-614 vouching — a Skill call carries the record's `timestamp`, as every
  // real transcript line does, because a call the guard cannot place in time
  // opens no window and so vouches for no receipt. Stamped an hour back so the
  // fixture's receipts, written after it, fall inside the window it opens.
  function transcript613(name: string, skills: string[]): string {
    const stamp = new Date(Date.now() - 3_600_000).toISOString();
    const file = join(scratch613, `${name}.jsonl`);
    const entries: unknown[] = [{ type: "tool_use", name: "Bash", input: { command: "ls" } }];
    for (const skill of skills) {
      entries.push({ type: "tool_use", timestamp: stamp, name: "Skill", input: { skill } });
    }
    // A receipt counts only when this session ANNOUNCED it (STE-614 review):
    // the file alone is writable by any Bash call.
    for (const line of announcementRecords614(mintedAnnouncements614())) {
      entries.push(JSON.parse(line) as unknown);
    }
    writeFileSync613(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return file;
  }

  async function run613(command: string, tr: string): Promise<{ exitCode: number; stderr: string }> {
    const payload = JSON.stringify({
      session_id: "s613",
      transcript_path: tr,
      cwd: FE0,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    });
    const proc = Bun.spawn(["/bin/bash", WRAPPER613], {
      cwd: FE0,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN613, CDPATH: "" },
      stdin: new Response(payload).body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { exitCode: await proc.exited, stderr };
  }

  beforeAll613(() => {
    fx613 = makeSpanFixture613("M_ste613");
    FE0 = fx613.a;
    B613 = fx613.b;
    scratch613 = mkdtempSync613(join(tmpdir(), "ste613-hooks-"));
    writeFileSync613(join(B613, "pyproject.toml"), '[project]\nname = "fixture"\nversion = "0.0.0"\n');
    git613(B613, "add", "pyproject.toml");
    git613(B613, "commit", "-q", "-m", "fixture: stack marker");
    // FE0 carries the same stack marker, so a README-only staged set there is
    // classified `no-fr` (exit 0) rather than `stack-unknown` (an exit-1 Reminder).
    writeFileSync613(join(FE0, "pyproject.toml"), '[project]\nname = "fe0"\nversion = "0.0.0"\n');
    git613(FE0, "add", "pyproject.toml");
    git613(FE0, "commit", "-q", "-m", "fixture: stack marker");
    fx613.activeFr(B613, "GF-99", "M_ste613");
    git613(B613, "add", "specs/frs/GF-99.md");
    stage613(B613, { "src/app.py": "def app():\n    return 1\n", "tests/test_app.py": "def test_app():\n    assert True\n" });
    // STE-614 AC.5 / AC.13 — B613 is toolkit-managed, so the PERMIT case needs
    // the /tdd receipt naming B613 alongside its Skill call. The transcript leg
    // alone no longer places a commit in a second checkout. Minted BEFORE the
    // transcripts are written, because a receipt is evidence only when the
    // transcript carries its announcement (STE-614 review).
    writeGateReceipt613(B613, "tdd", "s613");
    noEvidence613 = transcript613("none", []);
    evidence613 = transcript613("tdd", ["dev-process-toolkit:tdd"]);
  });

  afterAll613(() => {
    fx613?.cleanup();
    if (scratch613) rmSync613(scratch613, { recursive: true, force: true });
  });

  const wrongTreeShapes = (): string[] => [
    `pushd ${B613} && git commit -m x`,
    `cd -P ${B613} && git commit -m x`,
    `builtin cd ${B613} && git commit -m x`,
    `cd -- ${B613} && git commit -m x`,
  ];

  test("with no evidence, each of the four shapes exits 2 naming B's staged paths (each exited 0 at HEAD)", async () => {
    for (const cmd of wrongTreeShapes()) {
      const r = await run613(cmd, noEvidence613);
      expect({ cmd, exitCode: r.exitCode }).toEqual({ cmd, exitCode: 2 });
      expect({ cmd, names: r.stderr.includes("test_app.py") }).toEqual({ cmd, names: true });
    }
  }, T613);

  test("PERMIT — the same four commands with /tdd evidence present proceed (no exit 2)", async () => {
    for (const cmd of wrongTreeShapes()) {
      const r = await run613(cmd, evidence613);
      expect({ cmd, exitCode: r.exitCode === 2 }).toEqual({ cmd, exitCode: false });
    }
  }, T613);

  test("PERMIT — `pushd <FE0> && git commit` with only a README staged in FE0 exits 0 silently, no evidence", async () => {
    stage613(FE0, { "README.md": "# fe0\n" });
    try {
      const r = await run613(`pushd ${FE0} && git commit -m x`, noEvidence613);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
    } finally {
      git613(FE0, "reset", "-q", "--", "README.md");
    }
  }, T613);

  test("CONTROL — the unchanged `cd <B> && git commit` exits 2 with no evidence", async () => {
    const r = await run613(`cd ${B613} && git commit -m x`, noEvidence613);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("test_app.py");
  }, T613);

  // STE-614.13 — B613's receipt is load-bearing IN THIS SUITE: the PERMIT case
  // above would still be green on the session-wide rule this milestone retires.
  // The receipts are MOVED aside, not deleted and re-minted, so the restore puts
  // back the very files the front door wrote in `beforeAll613` — a fresh mint
  // would land in a different vouching window. Declared last in this describe so
  // the removal cannot reach a case that runs after it.
  test("SIBLING — the same four shapes with B's receipt moved aside exit 2", async () => {
    const live = receiptsDirOf613(B613, "s613");
    const stash = join(scratch613, "b613-receipts-stashed");
    rmSync613(stash, { recursive: true, force: true });
    renameSync613(live, stash);
    try {
      for (const cmd of wrongTreeShapes()) {
        const r = await run613(cmd, evidence613);
        expect({ cmd, exitCode: r.exitCode }).toEqual({ cmd, exitCode: 2 });
        expect({ cmd, names: r.stderr.includes(B613) }).toEqual({ cmd, names: true });
      }
    } finally {
      renameSync613(stash, live);
    }
  }, T613);

  test("CONTROL — with the receipt back, the four shapes proceed again", async () => {
    for (const cmd of wrongTreeShapes()) {
      const r = await run613(cmd, evidence613);
      expect({ cmd, refused: r.exitCode === 2 }).toEqual({ cmd, refused: false });
    }
  }, T613);
});

// ---------------------------------------------------------------- STE-614.13
//
// The /tdd hook's "evidence present, proceeds" case, on a toolkit-managed
// checkout, now needs the receipt too — and its sibling without it exits 2.

import {
  clearReceipts as clearReceipts614,
  writeGateReceipt as writeGateReceipt614,
  writeManagedClaudeMd as writeManagedClaudeMd614,
} from "./_gate_receipt_fixture";

const SID_614 = "s614t";

async function managedTddRepo(name: string): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  writeManagedClaudeMd614(dir);
  const files: Record<string, string> = {
    "specs/frs/STE-1.md": "---\ntitle: STE-1\nstatus: active\n---\n\n# STE-1\n",
    "src/x.ts": "export const x = 1;\n",
    "src/x.test.ts": "// test\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", dir, "add", rel], { stdout: "pipe", stderr: "pipe" }).exited;
  }
  return dir;
}

function tddVouchingTranscript(): string {
  return writeTranscript([
    {
      type: "assistant",
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      message: {
        content: [
          { type: "tool_use", id: "tu1", name: "Skill", input: { skill: "dev-process-toolkit:tdd" } },
        ],
      },
    },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] } },
    // The receipts this session announced, after the call that vouches for them.
    ...announcementRecords614(mintedAnnouncements614()).map((l) => JSON.parse(l) as unknown),
  ]);
}

async function run614(repo: string, transcript: string): Promise<{ exitCode: number; stderr: string }> {
  const payload = JSON.stringify({
    session_id: SID_614,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: `git -C ${repo} commit -m x` },
  });
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: repo,
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stderr };
}

describe("AC-STE-614.13 — the receipt is load-bearing in the /tdd suite's proceeds case", () => {
  test("/tdd evidence present AND a front-door-written receipt → exit 0, silent", async () => {
    const repo = await managedTddRepo("tdd-614-permit");
    writeGateReceipt614(repo, "tdd", SID_614);
    const r = await run614(repo, tddVouchingTranscript());
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedTddRepo("tdd-614-forbid");
    writeGateReceipt614(repo, "tdd", SID_614);
    clearReceipts614(repo, SID_614);
    const r = await run614(repo, tddVouchingTranscript());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });
});

// D2 (live leg 2, 2026-09-23) — an ARCHIVED FR is not new work.
//
// MEASURED LIVE, and the defect that aborted the leg. `FR_RE` is
// `^specs/frs/.*\.md$`, whose `.*` crosses the `archive/` segment, so filing a
// finished FR — the archive move `/implement` Phase 4 performs — was read as
// staging new work and demanded TDD evidence:
//
//   Refusing: no TDD evidence for the staged test path
//   specs/frs/archive/DST2-4.md: neither a dev-process-toolkit:tdd Skill
//   tool_use nor a red-before proof covering it was found in this session.
//
// Neither remedy can be satisfied for an archived markdown record: there is no
// test to run red and no FR to /tdd. The child met a refusal with no legal path,
// concluded deadlock, and the repoint chained into the same call never ran.
//
// THE CONTRAST IS THE FINDING. Step 1 met a refusal from the tracker-write gate
// for a chained command too — but that one NAMED the offending shape and the
// plain-command form, so the child retried unchained and passed. One refusal
// teaches, the other blocks.
describe("D2 — staging an ARCHIVED FR is bookkeeping, not new work", () => {
  test("archived FR staged BESIDE a non-spec file (the live shape) + no /tdd evidence → exit 0", async () => {
    // The FR-ONLY carve-out must not be what makes this pass: the live commit
    // also staged the binding and the receipts, so the staged set was not
    // FR-only and fell through to the tdd-required classification.
    await initRepoWithStaged({
      "specs/frs/archive/DST2-4.md": "---\ntitle: x\nstatus: archived\narchived_at: 2026-09-23T00:00:00Z\n---\n\n# x\n",
      "CLAUDE.md": "# B\n\n## Task Tracking\n\nmode: jira\n",
      ".dpt/ledger/receipts/s1/r.json": "{}\n",
    });
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    const r = await runModule(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'docs(specs): archive DST2-4'" },
    }));
    expect(r.exitCode, `${r.stdout}\n${r.stderr}`).toBe(0);
  });

  test("PERMIT TWIN — an ACTIVE FR still requires the evidence, so the carve-out is about the archive and nothing else", async () => {
    await initRepoWithStaged({
      "specs/frs/DST2-4.md": "---\ntitle: x\nstatus: active\n---\n\n# x\n",
      "src/thing.ts": "export const a = 1;\n",
      "src/thing.test.ts": "import { test } from \"bun:test\";\ntest(\"a\", () => {});\n",
    });
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    const r = await runModule(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    }));
    expect(r.exitCode, "an active FR staged beside a test still demands TDD evidence").toBe(2);
  });

  test("an archived FR staged BESIDE a real test still requires the evidence — the test is the trigger, not the record", async () => {
    await initRepoWithStaged({
      "specs/frs/archive/DST2-4.md": "---\ntitle: x\nstatus: archived\narchived_at: 2026-09-23T00:00:00Z\n---\n\n# x\n",
      "src/thing.test.ts": "import { test } from \"bun:test\";\ntest(\"a\", () => {});\n",
    });
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    const r = await runModule(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    }));
    expect(r.exitCode).toBe(2);
  });
});

// D2, second half — a refusal that blocks a chain says so.
//
// The live child's repoint sat in the same Bash call as its commits. The hook
// refused the call, the repoint never ran, and nothing in the refusal said that
// — so the child read a blocked commit as a deadlock rather than as "the rest
// of your command did not happen, retry it on its own".
describe("D2 — a refusal that blocks a CHAINED call says the rest did not run", () => {
  const stagedRefusingSet = {
    "specs/frs/DST2-9.md": "---\ntitle: x\nstatus: active\n---\n\n# x\n",
    "src/thing.test.ts": "import { test } from \"bun:test\";\ntest(\"a\", () => {});\n",
  };

  test("a chained command's refusal carries the note", async () => {
    await initRepoWithStaged(stagedRefusingSet);
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    const r = await runModule(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git add -A && git commit -m wip ; bun run repoint.ts" },
    }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr, "it names what else was blocked").toMatch(/blocked the WHOLE command/);
    expect(r.stderr, "and what to do about it").toMatch(/re-run those parts/);
  });

  test("CONTROL — a PLAIN command's refusal does NOT carry it, so the note is about chaining and not decoration", async () => {
    await initRepoWithStaged(stagedRefusingSet);
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    const r = await runModule(JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).not.toMatch(/blocked the WHOLE command/);
  });

  test("the refusal stays a three-line NFR-10 block in both cases", async () => {
    await initRepoWithStaged(stagedRefusingSet);
    const transcript = writeTranscript([{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
    for (const command of ["git commit -m wip", "git add -A && git commit -m wip"]) {
      const r = await runModule(JSON.stringify({
        session_id: "s1",
        transcript_path: transcript,
        cwd: repoDir,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
      }));
      const lines = r.stderr.trim().split("\n").filter((l) => l.trim() !== "");
      expect(lines.length, `${command}: ${r.stderr}`).toBe(3);
      expect(lines[1]!).toMatch(/^Remedy: /);
    }
  });
});

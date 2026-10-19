// STE-676 (M_8b09e6) — a merge or rebase commit is graded on its own changes.
//
// The pre-commit /tdd guard demands evidence for every staged test and FR file.
// During a merge from main that set holds tests main already shipped, so the
// guard refused the merge and offered only a false proof or a bypass. The fix:
// a tdd-required staged path whose index bytes equal the incoming side (a
// MERGE_HEAD / REBASE_HEAD commit) or git's own merge result is WAIVED, with a
// visible `Reminder:` (exit 1). A path edited by hand still needs evidence.
//
// Every behaviour test drives the SHIPPED wrapper
// (templates/hooks/process/pre-commit-tdd-orchestrator.sh) against a real temp
// git repo, with permit and forbid twins per case. A no-evidence transcript is
// used throughout, so a waiver is the only way a commit can get past exit 2.
//
// Reminder contract assumed here: exit 1, exactly one `Reminder:` on stderr,
// every waived path named verbatim, and the matched head named by at least its
// 7-character short sha (a full sha contains it, so either spelling passes).
//
// Secondary unit surface (dynamic import, so the behaviour tests stand alone):
//   adapters/_shared/src/merge_provenance.ts
//     export async function waivedMergePaths(
//       repoRoot: string, paths: string[],
//     ): Promise<Array<{ path: string; head: string }>>
//   — the waived subset of `paths`, each with the head it matched (a commit
//   sha for a head match); `[]` when no merge/rebase is in progress or when the
//   waiver is disabled (unresolvable head, failed git spawn).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { readSpecFile } from "./_spec_tree";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-tdd-orchestrator.sh");
const HOOK_TS = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-commit-tdd-orchestrator.ts");
const READER_TS = join(PLUGIN_ROOT, "adapters", "_shared", "src", "merge_provenance.ts");
const HOOKS_REFERENCE = join(PLUGIN_ROOT, "docs", "hooks-reference.md");

const T = 60_000;

let tmpRoot: string;
let gitEnv: Record<string, string>;
let transcript: string;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "ste-676-merge-waiver-")));
  const globalCfg = join(tmpRoot, "gitconfig");
  writeFileSync(globalCfg, "");
  gitEnv = {
    ...(process.env as Record<string, string>),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalCfg,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
  };
  transcript = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "no evidence of anything here" },
    }) + "\n",
  );
});

afterEach(() => {
  // Bun's rmSync(recursive, force) can silently leave a git-created .git
  // behind; `rm -rf` does not, and the check below says so if it ever does.
  if (tmpRoot && existsSync(tmpRoot)) {
    Bun.spawnSync(["rm", "-rf", tmpRoot]);
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function gitTry(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.quotePath=true", ...args], {
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}

function git(cwd: string, ...args: string[]): string {
  const r = gitTry(cwd, ...args);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.code}) in ${cwd}: ${r.err}`);
  }
  return r.out.trim();
}

function put(dir: string, rel: string, body: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function commitFiles(dir: string, files: Record<string, string>, msg: string): string {
  for (const [rel, body] of Object.entries(files)) {
    put(dir, rel, body);
    git(dir, "add", "--", rel);
  }
  git(dir, "commit", "-q", "-m", msg);
  return git(dir, "rev-parse", "HEAD");
}

function sha(dir: string, ref: string): string {
  return git(dir, "rev-parse", ref);
}

function gitPath(dir: string, name: string): string {
  const p = git(dir, "rev-parse", "--git-path", name);
  return isAbsolute(p) ? p : join(dir, p);
}

/** A repo with a TypeScript stack marker, a `base` commit on `main`. */
function makeRepo(name = "repo"): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  commitFiles(
    dir,
    {
      "package.json": '{"name":"fixture","version":"0.0.0","private":true}\n',
      "README.md": "# fixture\n",
      "src/x.ts": "export const x = 1;\n",
    },
    "base",
  );
  return dir;
}

const lines = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `// ${tag} line ${i + 1}`).join("\n") + "\n";

/**
 * The canonical clean merge: `main` ships `files` (tests), `feature` carries an
 * unrelated source change, and `feature` stops mid-merge of `main`
 * (`--no-commit`) so MERGE_HEAD is present and the shipped tests are staged
 * byte-identical to main's.
 */
function cleanMerge(files: Record<string, string> = { "tests/a.test.ts": "// shipped by main\n" }) {
  const dir = makeRepo();
  git(dir, "checkout", "-q", "-b", "feature");
  commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
  git(dir, "checkout", "-q", "main");
  const mainSha = commitFiles(dir, files, "main ships tests");
  git(dir, "checkout", "-q", "feature");
  git(dir, "merge", "-q", "--no-ff", "--no-commit", "main");
  expect(existsSync(gitPath(dir, "MERGE_HEAD"))).toBe(true);
  return { dir, mainSha };
}

// ---------------------------------------------------------------------------
// hook runner — the shipped wrapper, a PreToolUse payload, a no-evidence log
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHook(
  cwd: string,
  command: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  const payload = JSON.stringify({
    session_id: "ste-676-session",
    transcript_path: transcript,
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const proc = Bun.spawn(["bash", WRAPPER], {
    cwd,
    env: { ...gitEnv, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...extraEnv },
    stdin: new Response(payload).body,
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

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** The waived-commit reminder contract: exit 1, ONE Reminder, paths + heads named. */
function expectWaiverReminder(r: RunResult, paths: string[], heads: string[]): void {
  expect(r.exitCode).toBe(1);
  expect(count(r.stderr, "Reminder:")).toBe(1);
  expect(r.stderr).not.toContain("Refusing:");
  for (const p of paths) expect(r.stderr).toContain(p);
  for (const h of heads) expect(r.stderr).toContain(h.slice(0, 7));
}

/** A refusal naming exactly the hand-edited paths and none of the waived ones. */
function expectRefusal(r: RunResult, named: string[], notNamed: string[] = []): void {
  expect(r.exitCode).toBe(2);
  expect(r.stderr).toContain("Refusing:");
  for (const p of named) expect(r.stderr).toContain(p);
  for (const p of notNamed) expect(r.stderr).not.toContain(p);
}

/** A PATH shim around the real git: logs every invocation, optionally fails some. */
function gitShim(opts: { failIfArgContains?: string } = {}): { env: Record<string, string>; log: string } {
  const bin = join(tmpRoot, "shim-bin");
  mkdirSync(bin, { recursive: true });
  const log = join(tmpRoot, "git-calls.log");
  writeFileSync(log, "");
  const realGit = Bun.which("git", { PATH: process.env.PATH ?? "" }) ?? "/usr/bin/git";
  const fail = opts.failIfArgContains
    ? `for a in "$@"; do case "$a" in *'${opts.failIfArgContains}'*) exit 128;; esac; done\n`
    : "";
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n${fail}exec '${realGit}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  return { env: { PATH: `${bin}:${process.env.PATH ?? ""}` }, log };
}

// ---------------------------------------------------------------------------
// AC-STE-676.1 — MERGE_HEAD: identical-to-head paths are waived, visibly
// ---------------------------------------------------------------------------

describe("AC-STE-676.1 — a path equal to a MERGE_HEAD commit is waived with one Reminder", () => {
  test("[mutation: waiver] clean-merge-waived — plain `git commit` of a clean merge exits 1, not 2", async () => {
    const { dir, mainSha } = cleanMerge();
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/a.test.ts"], [mainSha]);
  }, T);

  test("[mutation: reminder] waived-commit-exits-1-not-0 — the waiver is never silent", async () => {
    const { dir, mainSha } = cleanMerge();
    const r = await runHook(dir, "git commit -m 'merge main'");
    expect(r.exitCode).not.toBe(0);
    expect(r.exitCode).toBe(1);
    expect(count(r.stderr, "Reminder:")).toBe(1);
    expect(r.stderr).toContain("tests/a.test.ts");
    expect(r.stderr).toContain(mainSha.slice(0, 7));
  }, T);

  test("`git merge --continue` concluding the same merge is waived the same way", async () => {
    const { dir, mainSha } = cleanMerge();
    const r = await runHook(dir, "git merge --continue");
    expectWaiverReminder(r, ["tests/a.test.ts"], [mainSha]);
  }, T);

  test("an FR file and a test shipped by main are both waived and both named", async () => {
    const { dir, mainSha } = cleanMerge({
      "tests/a.test.ts": "// shipped by main\n",
      "specs/frs/STE-9.md": "---\ntitle: main fr\n---\n",
    });
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/a.test.ts", "specs/frs/STE-9.md"], [mainSha]);
  }, T);

  test("octopus — every MERGE_HEAD line is a head; each waived path names the head it matched", async () => {
    const dir = makeRepo();
    git(dir, "checkout", "-q", "-b", "side");
    const sideSha = commitFiles(dir, { "tests/b.test.ts": "// shipped by side\n" }, "side ships b");
    git(dir, "checkout", "-q", "main");
    const mainSha = commitFiles(dir, { "tests/a.test.ts": "// shipped by main\n" }, "main ships a");
    git(dir, "checkout", "-q", "-b", "feature", "main~1");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "merge", "-q", "--no-ff", "--no-commit", "main", "side");
    const heads = readFileSync(gitPath(dir, "MERGE_HEAD"), "utf-8").trim().split("\n");
    expect(heads.length).toBe(2);
    const r = await runHook(dir, "git commit -m 'octopus'");
    expectWaiverReminder(r, ["tests/a.test.ts", "tests/b.test.ts"], [mainSha, sideSha]);
  }, T);

  test("a conflict resolved by taking main's side is waived (index equals the head)", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/k.test.ts": "// k base\n" }, "k base");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "tests/k.test.ts": "// k feature\n" }, "feature edits k");
    git(dir, "checkout", "-q", "main");
    const mainSha = commitFiles(dir, { "tests/k.test.ts": "// k main\n" }, "main edits k");
    git(dir, "checkout", "-q", "feature");
    expect(gitTry(dir, "merge", "--no-ff", "--no-commit", "main").code).not.toBe(0);
    git(dir, "checkout", "--theirs", "--", "tests/k.test.ts");
    git(dir, "add", "--", "tests/k.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/k.test.ts"], [mainSha]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.2 — git's own merge result is waived too
// ---------------------------------------------------------------------------

function autoMergeRepo(withConflict: boolean) {
  const dir = makeRepo();
  const base = lines(12, "m");
  const files: Record<string, string> = { "tests/m.test.ts": base };
  if (withConflict) files["tests/k.test.ts"] = "// k base\n";
  commitFiles(dir, files, "m base");
  git(dir, "checkout", "-q", "-b", "feature");
  const featFiles: Record<string, string> = {
    "tests/m.test.ts": base.replace("// m line 12", "// m line 12 (feature)"),
  };
  if (withConflict) featFiles["tests/k.test.ts"] = "// k feature\n";
  commitFiles(dir, featFiles, "feature edits m bottom");
  git(dir, "checkout", "-q", "main");
  const mainFiles: Record<string, string> = {
    "tests/m.test.ts": base.replace("// m line 1\n", "// m line 1 (main)\n"),
  };
  if (withConflict) mainFiles["tests/k.test.ts"] = "// k main\n";
  const mainSha = commitFiles(dir, mainFiles, "main edits m top");
  git(dir, "checkout", "-q", "feature");
  const m = gitTry(dir, "merge", "--no-ff", "--no-commit", "main");
  if (withConflict) {
    expect(m.code).not.toBe(0);
    git(dir, "checkout", "--theirs", "--", "tests/k.test.ts");
    git(dir, "add", "--", "tests/k.test.ts");
  } else {
    expect(m.code).toBe(0);
  }
  const merged = readFileSync(join(dir, "tests/m.test.ts"), "utf-8");
  // The fixture's point: the merged bytes equal NEITHER side.
  expect(merged).toContain("(main)");
  expect(merged).toContain("(feature)");
  return { dir, mainSha };
}

describe("AC-STE-676.2 — a path git auto-merged equals the merge result and is waived", () => {
  test("auto-merged with no conflict (merge-tree fallback) → exit 1, path named", async () => {
    const { dir } = autoMergeRepo(false);
    const r = await runHook(dir, "git commit -m 'merge main'");
    expect(r.exitCode).toBe(1);
    expect(count(r.stderr, "Reminder:")).toBe(1);
    expect(r.stderr).toContain("tests/m.test.ts");
  }, T);

  test("auto-merged beside a conflict taken from main (AUTO_MERGE leg) → exit 1, both named", async () => {
    const { dir, mainSha } = autoMergeRepo(true);
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/m.test.ts", "tests/k.test.ts"], [mainSha]);
  }, T);

  test("forbid twin — the auto-merged file then edited by hand → exit 2, refusal names it", async () => {
    const { dir } = autoMergeRepo(false);
    put(dir, "tests/m.test.ts", readFileSync(join(dir, "tests/m.test.ts"), "utf-8") + "// evil\n");
    git(dir, "add", "--", "tests/m.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/m.test.ts"]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.3 — a hand edit still needs evidence; mixed commits refuse
// ---------------------------------------------------------------------------

describe("AC-STE-676.3 — bytes matching no head and no merge result keep the requirement", () => {
  test("[mutation: hand-edit check] evil-merge-refuses — a shipped test edited mid-merge → exit 2", async () => {
    const { dir } = cleanMerge();
    put(dir, "tests/a.test.ts", "// shipped by main\n// smuggled edit\n");
    git(dir, "add", "--", "tests/a.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
    expect(r.stderr).not.toContain("Reminder:");
  }, T);

  test("mixed commit — one waived + one hand-made test → exit 2 naming only the hand-made one", async () => {
    const { dir } = cleanMerge();
    put(dir, "tests/hand.test.ts", "// written during resolution\n");
    git(dir, "add", "--", "tests/hand.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/hand.test.ts"], ["tests/a.test.ts"]);
  }, T);

  test("a conflict resolved by hand (neither side) → exit 2", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/k.test.ts": "// k base\n" }, "k base");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "tests/k.test.ts": "// k feature\n" }, "feature edits k");
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, { "tests/k.test.ts": "// k main\n" }, "main edits k");
    git(dir, "checkout", "-q", "feature");
    expect(gitTry(dir, "merge", "--no-ff", "--no-commit", "main").code).not.toBe(0);
    put(dir, "tests/k.test.ts", "// k resolved by hand\n");
    git(dir, "add", "--", "tests/k.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/k.test.ts"]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.4 — deletions and incoming renames
// ---------------------------------------------------------------------------

describe("AC-STE-676.4 — deletions absent at a head, and renames at their new path, are waived", () => {
  test("a test deleted on main and staged as deleted → exit 1 naming it", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/old.test.ts": "// old\n" }, "old test");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "checkout", "-q", "main");
    git(dir, "rm", "-q", "--", "tests/old.test.ts");
    git(dir, "commit", "-q", "-m", "main drops old");
    const mainSha = sha(dir, "main");
    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "-q", "--no-ff", "--no-commit", "main");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/old.test.ts"], [mainSha]);
  }, T);

  test("forbid twin — a test deleted by hand mid-merge that every head still has → exit 2", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/keep.test.ts": "// keep\n" }, "keep test");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, { "tests/a.test.ts": "// shipped by main\n" }, "main ships a");
    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "-q", "--no-ff", "--no-commit", "main");
    git(dir, "rm", "-q", "--", "tests/keep.test.ts");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/keep.test.ts"], ["tests/a.test.ts"]);
  }, T);

  test("a rename on the incoming side is waived at its new path", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/r.test.ts": lines(20, "rename") }, "r test");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "checkout", "-q", "main");
    git(dir, "mv", "tests/r.test.ts", "tests/r2.test.ts");
    git(dir, "commit", "-q", "-m", "main renames r");
    const mainSha = sha(dir, "main");
    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "-q", "--no-ff", "--no-commit", "main");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/r2.test.ts"], [mainSha]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.5 — a rebase stop applies the same rule against REBASE_HEAD
// ---------------------------------------------------------------------------

function rebaseStop() {
  const dir = makeRepo();
  commitFiles(dir, { "tests/c.test.ts": "// c base\n" }, "c base");
  git(dir, "checkout", "-q", "-b", "feature");
  const featSha = commitFiles(
    dir,
    { "tests/c.test.ts": "// c feature\n", "tests/new.test.ts": "// new on feature\n" },
    "feature edits c, adds new",
  );
  git(dir, "checkout", "-q", "main");
  commitFiles(dir, { "tests/c.test.ts": "// c main\n" }, "main edits c");
  git(dir, "checkout", "-q", "feature");
  expect(gitTry(dir, "rebase", "main").code).not.toBe(0);
  expect(existsSync(gitPath(dir, "REBASE_HEAD"))).toBe(true);
  expect(sha(dir, "REBASE_HEAD")).toBe(featSha);
  // In a rebase "theirs" is the commit being replayed.
  git(dir, "checkout", "--theirs", "--", "tests/c.test.ts");
  git(dir, "add", "--", "tests/c.test.ts");
  return { dir, featSha };
}

describe("AC-STE-676.5 — rebase stop: plain `git commit` is graded against REBASE_HEAD", () => {
  test("replayed paths equal to REBASE_HEAD → exit 1 naming them and the head", async () => {
    const { dir, featSha } = rebaseStop();
    const r = await runHook(dir, "git commit -m 'replay'");
    expectWaiverReminder(r, ["tests/c.test.ts", "tests/new.test.ts"], [featSha]);
  }, T);

  test("forbid twin — a replayed path edited by hand during the stop → exit 2", async () => {
    const { dir } = rebaseStop();
    put(dir, "tests/c.test.ts", "// c edited during the stop\n");
    git(dir, "add", "--", "tests/c.test.ts");
    const r = await runHook(dir, "git commit -m 'replay'");
    expectRefusal(r, ["tests/c.test.ts"], ["tests/new.test.ts"]);
  }, T);

  test("forbid twin — a REBASE_HEAD file with no rebase directory gives no waiver", async () => {
    const dir = makeRepo();
    git(dir, "checkout", "-q", "-b", "other");
    const otherSha = commitFiles(dir, { "tests/z.test.ts": "// z\n" }, "other ships z");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "other", "--", "tests/z.test.ts");
    writeFileSync(gitPath(dir, "REBASE_HEAD"), otherSha + "\n");
    expect(existsSync(gitPath(dir, "rebase-merge"))).toBe(false);
    expect(existsSync(gitPath(dir, "rebase-apply"))).toBe(false);
    const r = await runHook(dir, "git commit -m 'not a rebase'");
    expectRefusal(r, ["tests/z.test.ts"]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.6 — heads read through --git-path, resolved with ^{commit}; fail closed
// ---------------------------------------------------------------------------

describe("AC-STE-676.6 — head reading is worktree-safe and fails closed", () => {
  test("a clean merge in a LINKED WORKTREE is waived (MERGE_HEAD lives under the worktree's git dir)", async () => {
    const dir = makeRepo();
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "checkout", "-q", "main");
    const mainSha = commitFiles(dir, { "tests/a.test.ts": "// shipped by main\n" }, "main ships a");
    const wt = join(tmpRoot, "wt");
    git(dir, "worktree", "add", "-q", "-b", "feature2", wt, "feature");
    git(wt, "merge", "-q", "--no-ff", "--no-commit", "main");
    expect(existsSync(join(dir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(existsSync(gitPath(wt, "MERGE_HEAD"))).toBe(true);
    const r = await runHook(wt, "git commit -m 'merge main in worktree'");
    expectWaiverReminder(r, ["tests/a.test.ts"], [mainSha]);
  }, T);

  test("a clean merge committed from a SUBDIRECTORY is waived", async () => {
    const { dir, mainSha } = cleanMerge();
    const sub = join(dir, "src");
    const r = await runHook(sub, "git commit -m 'merge main from src/'");
    expectWaiverReminder(r, ["tests/a.test.ts"], [mainSha]);
  }, T);

  test("forbid — a MERGE_HEAD line naming no object disables the waiver → exit 2", async () => {
    const { dir } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
  }, T);

  test("forbid — one good head plus one unresolvable head disables the waiver for the WHOLE commit", async () => {
    const { dir, mainSha } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), `${mainSha}\nnot-a-sha\n`);
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
  }, T);

  test("forbid — a head that resolves to a TREE, not a commit, disables the waiver", async () => {
    const { dir } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), sha(dir, "main^{tree}") + "\n");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
  }, T);

  test("forbid — a failed git spawn while resolving a head disables the waiver (no crash)", async () => {
    const { dir } = cleanMerge();
    const shim = gitShim({ failIfArgContains: "^{commit}" });
    const r = await runHook(dir, "git commit -m 'merge main'", shim.env);
    expectRefusal(r, ["tests/a.test.ts"]);
    // The shim was actually consulted with a ^{commit} resolution.
    expect(readFileSync(shim.log, "utf-8")).toContain("^{commit}");
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.6 — the MERGE-RESULT leg fails closed too (Phase 3 hardening)
//
// A git failure while reading git's own merge result must disable the waiver
// for the WHOLE commit, so a path a head would have waived is refused with the
// rest. A merge-tree that merely reports a conflict (exit 1) is not a failure:
// the head-matched paths stay waived.
// ---------------------------------------------------------------------------

/** A clean merge holding one path equal to main (n) and one git auto-merged (m). */
function headAndAutoMerge() {
  const dir = makeRepo();
  const base = lines(12, "m");
  commitFiles(dir, { "tests/m.test.ts": base }, "m base");
  git(dir, "checkout", "-q", "-b", "feature");
  commitFiles(dir, { "tests/m.test.ts": base.replace("// m line 12", "// m line 12 (feature)") }, "feature");
  git(dir, "checkout", "-q", "main");
  const mainSha = commitFiles(
    dir,
    { "tests/m.test.ts": base.replace("// m line 1\n", "// m line 1 (main)\n"), "tests/n.test.ts": "// n\n" },
    "main",
  );
  git(dir, "checkout", "-q", "feature");
  expect(gitTry(dir, "merge", "--no-ff", "--no-commit", "main").code).toBe(0);
  return { dir, mainSha };
}

describe("AC-STE-676.6 — a failure reading git's merge result disables the whole waiver", () => {
  test("permit control — head-matched n and auto-merged m are both waived", async () => {
    const { dir, mainSha } = headAndAutoMerge();
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/m.test.ts", "tests/n.test.ts"], [mainSha]);
  }, T);

  test("forbid — a failed `git merge-tree` spawn refuses the head-matched path too", async () => {
    const { dir } = headAndAutoMerge();
    // git 2.55 writes AUTO_MERGE even for a clean --no-commit merge; remove it
    // so the merge-tree fallback is the leg under test.
    if (existsSync(gitPath(dir, "AUTO_MERGE"))) rmSync(gitPath(dir, "AUTO_MERGE"));
    const shim = gitShim({ failIfArgContains: "merge-tree" });
    const r = await runHook(dir, "git commit -m 'merge main'", shim.env);
    expectRefusal(r, ["tests/m.test.ts", "tests/n.test.ts"]);
    expect(readFileSync(shim.log, "utf-8")).toContain("merge-tree");
  }, T);

  test("forbid — a failed `AUTO_MERGE^{tree}` read refuses the head-matched path too", async () => {
    const { dir } = autoMergeRepo(true);
    expect(existsSync(gitPath(dir, "AUTO_MERGE"))).toBe(true);
    const shim = gitShim({ failIfArgContains: "AUTO_MERGE^{tree}" });
    const r = await runHook(dir, "git commit -m 'merge main'", shim.env);
    expectRefusal(r, ["tests/m.test.ts", "tests/k.test.ts"]);
    expect(readFileSync(shim.log, "utf-8")).toContain("AUTO_MERGE^{tree}");
  }, T);

  test("forbid — a failed `--git-path AUTO_MERGE` lookup refuses the head-matched path too", async () => {
    const { dir } = headAndAutoMerge();
    const shim = gitShim({ failIfArgContains: "AUTO_MERGE" });
    const r = await runHook(dir, "git commit -m 'merge main'", shim.env);
    expectRefusal(r, ["tests/m.test.ts", "tests/n.test.ts"]);
  }, T);

  test("permit — a merge-tree that only reports a conflict (exit 1) keeps the head waivers", async () => {
    const { dir, mainSha } = autoMergeRepo(true);
    // No AUTO_MERGE ⇒ the merge-tree fallback runs, and it conflicts on k.
    rmSync(gitPath(dir, "AUTO_MERGE"));
    const r = await runHook(dir, "git commit -m 'merge main'");
    // m equals no head and merge-tree gave no tree, so it is still graded;
    // k (taken from main) stays waived — exit 1 was a conflict, not a failure.
    expectRefusal(r, ["tests/m.test.ts"], ["tests/k.test.ts"]);
    expect(mainSha.length).toBe(40);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.7 — no operation in progress: today's behaviour, byte for byte
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC-STE-676.6 — a head git could never have written gives no waiver
// (Phase 3 review round 1). Git writes a full sha per MERGE_HEAD line, and a
// head that is HEAD or one of its ancestors is no merge at all: accepting one
// would waive any version of a test from history, including its deletion.
// ---------------------------------------------------------------------------

describe("AC-STE-676.6 — only a sha that is not already in HEAD's history counts as a head", () => {
  test("forbid — a MERGE_HEAD line naming a branch (not a sha) disables the waiver", async () => {
    const { dir } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), "main\n");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
  }, T);

  test("forbid — an option-looking MERGE_HEAD line disables the waiver", async () => {
    const { dir } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), "--all\n");
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectRefusal(r, ["tests/a.test.ts"]);
  }, T);

  test("forbid — a planted MERGE_HEAD at an ancestor of HEAD waives no old test version", async () => {
    const dir = makeRepo();
    const old = commitFiles(dir, { "tests/r.test.ts": "// old body\n" }, "old test");
    commitFiles(dir, { "tests/r.test.ts": "// new body\n" }, "test changed");
    // Restore the old bytes and plant MERGE_HEAD at the commit that had them.
    git(dir, "checkout", old, "--", "tests/r.test.ts");
    writeFileSync(gitPath(dir, "MERGE_HEAD"), old + "\n");
    const r = await runHook(dir, "git commit -m 'not a merge'");
    expectRefusal(r, ["tests/r.test.ts"]);
  }, T);

  test("forbid — MERGE_HEAD equal to HEAD waives no deletion", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/d.test.ts": "// d\n" }, "d");
    git(dir, "rm", "-q", "--", "tests/d.test.ts");
    writeFileSync(gitPath(dir, "MERGE_HEAD"), sha(dir, "HEAD") + "\n");
    const r = await runHook(dir, "git commit -m 'not a merge'");
    expectRefusal(r, ["tests/d.test.ts"]);
  }, T);

  test("during a rebase, the merge-tree fallback merges against the replayed commit's parent", async () => {
    const { dir, featSha } = rebaseStop();
    if (existsSync(gitPath(dir, "AUTO_MERGE"))) rmSync(gitPath(dir, "AUTO_MERGE"));
    // Hand-edit c so a path is left for the merge-result leg to look at.
    put(dir, "tests/c.test.ts", "// c edited during the stop\n");
    git(dir, "add", "--", "tests/c.test.ts");
    const shim = gitShim();
    await runHook(dir, "git commit -m 'replay'", shim.env);
    const calls = readFileSync(shim.log, "utf-8").split("\n").filter((l) => l.startsWith("merge-tree"));
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain(`--merge-base=${featSha}^`);
  }, T);
});

describe("AC-STE-676.7 — with no merge or rebase in progress nothing changes", () => {
  test("a plain commit staging a test → exit 2 with today's exact refusal block", async () => {
    const dir = makeRepo();
    put(dir, "tests/a.test.ts", "// new test\n");
    git(dir, "add", "--", "tests/a.test.ts");
    const r = await runHook(dir, "git commit -m 'feat: a'");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe(
      "Refusing: no TDD evidence for the staged test path tests/a.test.ts: neither a " +
        "dev-process-toolkit:tdd Skill tool_use nor a red-before proof covering it was found in this session.\n" +
        "Remedy: run /dev-process-toolkit:tdd; or, for an audit-driven fix with no FR, run those tests " +
        "against the pre-change bytes and record the red result in this session as a line reading " +
        `\`dpt-red-before-proof: repo=${dir} <paths>\` naming every staged test path it covers.\n` +
        "Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator\n",
    );
  }, T);

  test("a test checked out byte-identical from another branch, with no merge in progress, gets no waiver", async () => {
    const dir = makeRepo();
    git(dir, "checkout", "-q", "-b", "other");
    commitFiles(dir, { "tests/a.test.ts": "// from other\n" }, "other ships a");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "other", "--", "tests/a.test.ts");
    const r = await runHook(dir, "git commit -m 'borrow a'");
    expectRefusal(r, ["tests/a.test.ts"]);
    expect(r.stderr).not.toContain("Reminder:");
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.8 — squash, cherry-pick and revert get no waiver, and say so
// ---------------------------------------------------------------------------

function expectNotCoveredRefusal(r: RunResult, path: string): void {
  expectRefusal(r, [path]);
  const remedy = r.stderr.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
  expect(remedy).toMatch(/squash/i);
  expect(remedy).toMatch(/cherry-pick/i);
  expect(remedy).toMatch(/revert/i);
}

describe("AC-STE-676.8 — squash, cherry-pick and revert are not covered, and the remedy names them", () => {
  test("`git merge --squash` then `git commit` → exit 2, remedy names the three", async () => {
    const dir = makeRepo();
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "src/y.ts": "export const y = 2;\n" }, "feature work");
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, { "tests/a.test.ts": "// shipped by main\n" }, "main ships a");
    git(dir, "checkout", "-q", "feature");
    git(dir, "merge", "-q", "--squash", "main");
    expect(existsSync(gitPath(dir, "MERGE_HEAD"))).toBe(false);
    const r = await runHook(dir, "git commit -m 'squash main'");
    expectNotCoveredRefusal(r, "tests/a.test.ts");
  }, T);

  test("a stopped cherry-pick resolved to the picked bytes, then `git commit` → exit 2, remedy names the three", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/c.test.ts": "// c base\n" }, "c base");
    git(dir, "checkout", "-q", "-b", "feature");
    commitFiles(dir, { "tests/c.test.ts": "// c feature\n" }, "feature edits c");
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, { "tests/c.test.ts": "// c main\n" }, "main edits c");
    git(dir, "checkout", "-q", "feature");
    expect(gitTry(dir, "cherry-pick", "main").code).not.toBe(0);
    expect(existsSync(gitPath(dir, "CHERRY_PICK_HEAD"))).toBe(true);
    git(dir, "checkout", "--theirs", "--", "tests/c.test.ts");
    git(dir, "add", "--", "tests/c.test.ts");
    const r = await runHook(dir, "git commit -m 'pick'");
    expectNotCoveredRefusal(r, "tests/c.test.ts");
  }, T);

  test("a stopped revert resolved, then `git commit` → exit 2, remedy names the three", async () => {
    const dir = makeRepo();
    commitFiles(dir, { "tests/rv.test.ts": "// r0\n" }, "rv r0");
    const x = commitFiles(dir, { "tests/rv.test.ts": "// r1\n" }, "rv r1");
    commitFiles(dir, { "tests/rv.test.ts": "// r2\n" }, "rv r2");
    expect(gitTry(dir, "revert", x).code).not.toBe(0);
    expect(existsSync(gitPath(dir, "REVERT_HEAD"))).toBe(true);
    git(dir, "checkout", "--theirs", "--", "tests/rv.test.ts");
    git(dir, "add", "--", "tests/rv.test.ts");
    const r = await runHook(dir, "git commit -m 'revert'");
    expectNotCoveredRefusal(r, "tests/rv.test.ts");
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.9 — `-z` staged list; one diff per head, not one spawn per path
// ---------------------------------------------------------------------------

describe("AC-STE-676.9 — NUL-separated reads and per-head (not per-path) cost", () => {
  test("a non-ASCII test path shipped by main is matched and named verbatim", async () => {
    const { dir, mainSha } = cleanMerge({ "tests/ünïcødé.test.ts": "// shipped by main\n" });
    const r = await runHook(dir, "git commit -m 'merge main'");
    expectWaiverReminder(r, ["tests/ünïcødé.test.ts"], [mainSha]);
    expect(r.stderr).not.toContain("\\303");
  }, T);

  test("git spawn count does not grow with the number of waived paths; the per-head diff uses -z", async () => {
    const few: Record<string, string> = {};
    for (let i = 0; i < 2; i++) few[`tests/f${i}.test.ts`] = `// f${i}\n`;
    const many: Record<string, string> = {};
    for (let i = 0; i < 12; i++) many[`tests/f${i}.test.ts`] = `// f${i}\n`;

    const a = cleanMerge(few);
    const shimA = gitShim();
    const rA = await runHook(a.dir, "git commit -m 'merge few'", shimA.env);
    const callsA = readFileSync(shimA.log, "utf-8").split("\n").filter(Boolean);
    expect(rA.exitCode).toBe(1);

    // Second repo in a sibling dir of the same tmpRoot.
    Bun.spawnSync(["rm", "-rf", a.dir]);
    const b = cleanMerge(many);
    const shimB = gitShim();
    const rB = await runHook(b.dir, "git commit -m 'merge many'", shimB.env);
    const callsB = readFileSync(shimB.log, "utf-8").split("\n").filter(Boolean);
    expect(rB.exitCode).toBe(1);

    expect(callsB.length).toBe(callsA.length);
    const perHeadDiff = callsB.filter((c) => {
      const w = c.split(" ");
      return w.includes("diff") && w.includes("--cached") && w.includes("--name-only") && w.includes("-z") &&
        w.some((x) => x.includes(b.mainSha) || x.includes("MERGE_HEAD"));
    });
    expect(perHeadDiff.length).toBeGreaterThanOrEqual(1);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.10 — the reader lives in adapters/_shared/src; hook shape pins
// ---------------------------------------------------------------------------

const FS_READ_RES = [
  /\breadFileSync\s*\(/,
  /\breadFile\s*\(/,
  /\bBun\s*\.\s*file\s*\(/,
  /\bcreateReadStream\s*\(/,
  /\bopenSync\s*\(/,
  /\breadSync\s*\(/,
];

describe("AC-STE-676.10 — head reader is a shared module; the hook keeps its shape", () => {
  test("adapters/_shared/src/merge_provenance.ts exists", () => {
    expect(existsSync(READER_TS)).toBe(true);
  });

  test("the hook imports the reader from adapters/_shared/src/merge_provenance", () => {
    const src = readFileSync(HOOK_TS, "utf-8");
    expect(src).toMatch(/from\s+["'](?:\.\.\/)+adapters\/_shared\/src\/merge_provenance(?:\.ts)?["']/);
  });

  test("the hook makes no direct file read and keeps exactly one process.exit(1)", () => {
    const src = readFileSync(HOOK_TS, "utf-8");
    for (const re of FS_READ_RES) expect(src).not.toMatch(re);
    expect(count(src, "process.exit(1)")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Secondary — unit surface of the shared reader (dynamic import)
// ---------------------------------------------------------------------------

type Waived = Array<{ path: string; head: string }>;
async function reader(): Promise<(root: string, paths: string[]) => Promise<Waived>> {
  const mod = (await import(READER_TS)) as { waivedMergePaths?: unknown };
  expect(typeof mod.waivedMergePaths).toBe("function");
  return mod.waivedMergePaths as (root: string, paths: string[]) => Promise<Waived>;
}

describe("merge_provenance.waivedMergePaths — unit surface", () => {
  test("clean merge → the shipped path, matched to main's full sha", async () => {
    const { dir, mainSha } = cleanMerge();
    const waived = await (await reader())(dir, ["tests/a.test.ts"]);
    expect(waived).toEqual([{ path: "tests/a.test.ts", head: mainSha }]);
  }, T);

  test("hand-edited path is not in the waived set", async () => {
    const { dir } = cleanMerge();
    put(dir, "tests/a.test.ts", "// edited\n");
    git(dir, "add", "--", "tests/a.test.ts");
    const waived = await (await reader())(dir, ["tests/a.test.ts"]);
    expect(waived).toEqual([]);
  }, T);

  test("no operation in progress → []", async () => {
    const dir = makeRepo();
    put(dir, "tests/a.test.ts", "// new\n");
    git(dir, "add", "--", "tests/a.test.ts");
    expect(await (await reader())(dir, ["tests/a.test.ts"])).toEqual([]);
  }, T);

  test("an unresolvable head → [] for every path", async () => {
    const { dir, mainSha } = cleanMerge();
    writeFileSync(gitPath(dir, "MERGE_HEAD"), `${mainSha}\nffffffffffffffffffffffffffffffffffffffff\n`);
    expect(await (await reader())(dir, ["tests/a.test.ts"])).toEqual([]);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-676.11 — hooks-reference documents the waiver
// ---------------------------------------------------------------------------

function tddHookSection(): string {
  const doc = readFileSync(HOOKS_REFERENCE, "utf-8");
  const start = doc.indexOf("### pre-commit-tdd-orchestrator");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + 1);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("AC-STE-676.11 — docs/hooks-reference.md documents the merge waiver", () => {
  test("names the waiver for merges and rebases", () => {
    const s = tddHookSection();
    expect(s).toMatch(/waive/i);
    expect(s).toMatch(/MERGE_HEAD/);
    expect(s).toMatch(/REBASE_HEAD/);
  });

  test("shows the waiver's Reminder line", () => {
    const s = tddHookSection();
    const reminders = s.split("\n").filter((l) => /^\s*Reminder:/.test(l));
    expect(reminders.some((l) => /waive|merge|rebase/i.test(l))).toBe(true);
  });

  test("names squash, cherry-pick and revert as not covered", () => {
    const s = tddHookSection();
    expect(s).toMatch(/squash/i);
    expect(s).toMatch(/cherry-pick/i);
    expect(s).toMatch(/\brevert\b/i);
    expect(s).toMatch(/not covered/i);
  });

  test("says the waiver is an honesty aid a hand-made merge can forge", () => {
    const s = tddHookSection();
    expect(s).toMatch(/honesty aid/i);
    expect(s).toMatch(/forge/i);
    expect(s).toMatch(/hand-made merge/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-676.12 — sibling-module audit recorded in the FR notes
// ---------------------------------------------------------------------------

function frNotes(): string {
  // Active tree first, the archive after the milestone closes (tests/_spec_tree.ts).
  const fr = readSpecFile(REPO_ROOT, "specs/frs", "STE-676.md").body;
  const start = fr.indexOf("\n## Notes");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = fr.slice(start + 1);
  const next = rest.slice(1).search(/\n## |\n<!-- token-stats:begin/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("AC-STE-676.12 — the two sibling modules were audited and the result recorded", () => {
  test("Notes name spec_write_trunk_invocation_path.ts and video_commit_nudge.ts", () => {
    const n = frNotes();
    expect(n).toContain("spec_write_trunk_invocation_path.ts");
    expect(n).toContain("video_commit_nudge.ts");
  });

  test("Notes record a follow-up ticket key for the video nudge's silent merge conclusion", () => {
    const n = frNotes();
    const keys = (n.match(/\bSTE-\d+\b/g) ?? []).filter((k) => k !== "STE-676" && k !== "STE-677");
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(n).toMatch(/video_commit_nudge[\s\S]*\bSTE-\d+\b|\bSTE-\d+\b[\s\S]*video_commit_nudge/);
  });
});

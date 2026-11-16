import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Stage RED snapshot and the implementer's list of the fix's files are
// shell the forks run as written, so a pin on their text proves nothing about
// what they do. Each test lifts the block out of its SKILL.md and runs it with
// bash in a throwaway repository: an edit to the block is an edit to what is
// tested.

const PLUGIN = join(import.meta.dir, "..");
const PREFIX = "STE-901";
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** The first ```bash block after `marker` in a plugin file, dedented, with `<prefix>` filled in. */
function block(rel: string, marker: string): string {
  const md = readFileSync(join(PLUGIN, rel), "utf8");
  const at = md.indexOf(marker);
  if (at < 0) throw new Error(`${rel}: marker not found: ${marker}`);
  const lines = md.slice(at).split("\n");
  const open = lines.findIndex((l) => l.trim() === "```bash");
  const close = lines.findIndex((l, k) => k > open && l.trim() === "```");
  if (open < 0 || close < 0) throw new Error(`${rel}: no bash block after ${marker}`);
  const body = lines.slice(open + 1, close);
  const indent = Math.min(...body.filter((l) => l.trim().length > 0).map((l) => l.length - l.trimStart().length));
  return body.map((l) => l.slice(indent)).join("\n").replaceAll("<prefix>", PREFIX);
}

const SNAPSHOT = () => block("skills/tdd-write-test/SKILL.md", "**Record the Stage RED snapshot**");
const LISTING = () => block("skills/tdd-implement/SKILL.md", "When the AC's body begins `Regression:`");

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function bash(cwd: string, script: string): { status: number | null; stdout: string } {
  const r = spawnSync("bash", ["-c", script], { cwd, encoding: "utf8", env: ENV });
  return { status: r.status, stdout: r.stdout };
}

/** A repository with `a.txt` committed, or with no commit at all. */
function repo(withCommit = true): string {
  const dir = mkdtempSync(join(tmpdir(), "dpt-red-base-"));
  git(dir, "init", "-q");
  if (withCommit) {
    writeFileSync(join(dir, "a.txt"), "before\n");
    git(dir, "add", "a.txt");
    git(dir, "commit", "-q", "-m", "base");
  }
  return dir;
}

const snapshotPath = (dir: string) => join(dir, ".git", "dpt-red-base", PREFIX);

/** The snapshot's HEAD and tree, or empty strings when there is no snapshot. */
function readSnapshot(dir: string): { head: string; tree: string } {
  if (!existsSync(snapshotPath(dir))) return { head: "", tree: "" };
  const [head = "", tree = ""] = readFileSync(snapshotPath(dir), "utf8").trim().split(" ");
  return { head, tree };
}

const changeRows = (out: string) => out.split("\n").filter((l) => /^[A-Z]\t/.test(l)).sort();

describe("the Stage RED snapshot (tdd-write-test § A bug FR)", () => {
  test("holds tracked changes and untracked files, and leaves the real index alone", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "bug\n");
    writeFileSync(join(dir, "u.txt"), "untracked\n");
    writeFileSync(join(dir, "s.txt"), "staged\n");
    git(dir, "add", "s.txt");
    const index = git(dir, "diff", "--cached", "--name-status");
    bash(dir, SNAPSHOT());
    const { head, tree } = readSnapshot(dir);
    expect({
      head,
      a: tree ? git(dir, "show", `${tree}:a.txt`) : null,
      u: tree ? git(dir, "show", `${tree}:u.txt`) : null,
      index: git(dir, "diff", "--cached", "--name-status"),
    }).toEqual({ head: git(dir, "rev-parse", "HEAD").trim(), a: "bug\n", u: "untracked\n", index });
  });

  // A stale snapshot would let the undo plant revert later commits' work.
  test("a snapshot that cannot be built leaves none behind, not a stale one", () => {
    const dir = repo();
    mkdirSync(join(dir, ".git", "dpt-red-base"), { recursive: true });
    writeFileSync(snapshotPath(dir), "deadbeef deadbeef\n");
    // A held lock on the temporary index makes `read-tree` and `add -A` fail.
    writeFileSync(join(dir, ".git", "dpt-red-base", `${PREFIX}.index.lock`), "");
    bash(dir, SNAPSHOT());
    expect(existsSync(snapshotPath(dir))).toBe(false);
  });

  test("works in a repository with no commit", () => {
    const dir = repo(false);
    writeFileSync(join(dir, "a.txt"), "first\n");
    bash(dir, SNAPSHOT());
    const { head, tree } = readSnapshot(dir);
    expect({ head, a: tree ? git(dir, "show", `${tree}:a.txt`) : null }).toEqual({ head: "none", a: "first\n" });
  });
});

describe("the fix's files (tdd-implement, a Regression: AC's undo plant)", () => {
  // Another FR's uncommitted file under `/implement M<N>` is untracked at
  // Stage RED; compared with the working tree through the real index it would
  // read `D`, and a file the fix adds would not show at all.
  test("a file untracked at Stage RED and changed by the fix reads M, and a file the fix adds reads A", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "bug\n");
    writeFileSync(join(dir, "u.txt"), "another FR\n");
    bash(dir, SNAPSHOT());
    writeFileSync(join(dir, "a.txt"), "fixed\n");
    writeFileSync(join(dir, "u.txt"), "another FR, fixed\n");
    writeFileSync(join(dir, "n.txt"), "new\n");
    expect(changeRows(bash(dir, LISTING()).stdout)).toEqual(["A\tn.txt", "M\ta.txt", "M\tu.txt"]);
  });

  test("names the snapshot's tree for the plant", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "bug\n");
    bash(dir, SNAPSHOT());
    const { tree } = readSnapshot(dir);
    writeFileSync(join(dir, "a.txt"), "fixed\n");
    expect(bash(dir, LISTING()).stdout.split("\n")[0]).toBe(`tree ${tree}`);
  });

  test("a snapshot taken on an ancestor of HEAD still counts (a WIP commit since)", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "bug\n");
    bash(dir, SNAPSHOT());
    writeFileSync(join(dir, "a.txt"), "fixed\n");
    git(dir, "commit", "-q", "-am", "wip");
    expect(changeRows(bash(dir, LISTING()).stdout)).toEqual(["M\ta.txt"]);
  });

  test("a snapshot from another line of history is no snapshot", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "bug\n");
    bash(dir, SNAPSHOT());
    git(dir, "checkout", "-q", "--orphan", "other");
    git(dir, "commit", "-q", "--allow-empty", "-m", "unrelated root");
    expect(bash(dir, LISTING()).stdout.trim()).toBe("no snapshot");
  });

  test("no snapshot file is no snapshot", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "fixed\n");
    expect(bash(dir, LISTING()).stdout.trim()).toBe("no snapshot");
  });
});

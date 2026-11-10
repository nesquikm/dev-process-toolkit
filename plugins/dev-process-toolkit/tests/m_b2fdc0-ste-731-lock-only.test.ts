// STE-731 (M_b2fdc0) — lock commits carry only the lock.
//
// AC-STE-731.1 / .2 / .3 / .6 drive the real LocalProvider in throwaway git
// repositories (fake ids, fake local author) and read every outcome from git
// plumbing. AC-STE-731.4 drives the new `adapters/_shared/src/lock.ts` front
// door as a subprocess and pins docs/implement-reference.md. AC-STE-731.5 pins
// the step order of skills/spec-archive/SKILL.md.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  LOCK_ID,
  METHODS,
  PLUGIN_ROOT,
  REAL_CTOR,
  SHAPES,
  cleanupTemps,
  commitPaths,
  commitsSince,
  foreignPathsFor,
  git,
  head,
  indexEntries,
  installRejectingPreCommit,
  lockPathsFor,
  lockRel,
  makeRepo,
  observe,
  onlyLockProblem,
  stageForeign,
  stagedForeign,
} from "./_m_b2fdc0_ste731_fixture";

setDefaultTimeout(60_000);
afterAll(() => cleanupTemps());

// ------------------------------------------------------------ AC .1 + .6

describe("AC-STE-731.1 / AC-STE-731.6 — twins: each lock commit carries exactly its lock paths", () => {
  for (const method of METHODS) {
    test(`${method} NO-FOREIGN twin — the commit is exactly the lock paths (control: nothing foreign staged)`, async () => {
      const o = await observe(REAL_CTOR, method, [], "twin-clean");
      // This twin cannot prove AC .1/.2 on a foreign file: there is none.
      expect(o.stagedBefore).toEqual([]);
      expect(onlyLockProblem(o)).toBeNull();
      expect(o.headPaths).toEqual(lockPathsFor(method));
    });

    test(`${method} FOREIGN twin — same repo plus staged foreign changes; the commit is still exactly the lock paths`, async () => {
      const o = await observe(REAL_CTOR, method, SHAPES, "twin-foreign");
      // The twin is load-bearing only because something foreign IS staged.
      expect(o.stagedBefore.length).toBeGreaterThan(0);
      expect({ method, problem: onlyLockProblem(o) }).toEqual({ method, problem: null });
      expect(o.headPaths).toEqual(lockPathsFor(method));
      expect(o.leaked).toEqual([]);
    });
  }
});

// ------------------------------------------------------------ AC .2

describe("AC-STE-731.2 — every foreign staged path stays staged, same blob and mode, in no lock commit", () => {
  for (const method of METHODS) {
    for (const shape of SHAPES) {
      test(`${method} with a staged ${shape} foreign path`, async () => {
        const o = await observe(REAL_CTOR, method, [shape], `shape-${shape}`);
        expect(o.stagedBefore.length).toBeGreaterThan(0);
        expect(o.threw).toBeNull();
        // Staged afterwards, with the same index entry (mode + blob) or still absent.
        expect(o.indexAfter).toEqual(o.indexBefore);
        expect(o.stagedAfter).toEqual(o.stagedBefore);
        // In no commit the call created.
        expect(o.leaked).toEqual([]);
        for (const c of o.created) {
          for (const p of foreignPathsFor([shape])) expect(commitPaths(o.root, c)).not.toContain(p);
        }
      });
    }
  }
});

// ------------------------------------------------------------ AC .3

describe("AC-STE-731.3 — a rejected lock commit rolls back only the lock paths", () => {
  for (const method of METHODS) {
    test(`${method} refused by a pre-commit hook — throws, no commit, lock rolled back, foreign staged paths untouched`, async () => {
      const o = await observe(REAL_CTOR, method, SHAPES, "rollback", (root) => installRejectingPreCommit(root));
      expect(o.threw).not.toBeNull();
      expect(o.created).toEqual([]);
      expect(o.indexAfter).toEqual(o.indexBefore);
      expect(o.stagedAfter).toEqual(o.stagedBefore);
      expect(o.stagedAfter.length).toBeGreaterThan(0);
      // The lock paths are back where HEAD has them (claim: absent; removals: present and unstaged).
      const lockStaged = git(o.root, "diff", "--cached", "--name-only", "--", ".dpt/locks");
      expect(lockStaged).toBe("");
      for (const p of lockPathsFor(method)) {
        expect({ p, onDisk: existsSync(join(o.root, p)) }).toEqual({ p, onDisk: method !== "claim" });
      }
    });
  }
});

// ------------------------------------------------------------ AC .4

const LOCK_CLI = join(PLUGIN_ROOT, "adapters", "_shared", "src", "lock.ts");

function runCli(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const p = Bun.spawnSync({
    cmd: [process.execPath, "run", LOCK_CLI, ...args],
    cwd,
    env: { ...process.env, DPT_SKIP_FETCH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

describe("AC-STE-731.4 — the lock.ts front door", () => {
  test("adapters/_shared/src/lock.ts exists", () => {
    expect(existsSync(LOCK_CLI)).toBe(true);
  });

  test("claim <projectRoot> <id> <branch> commits the lock through LocalProvider and prints the new sha", async () => {
    const root = await makeRepo(REAL_CTOR, "claim", "cli-claim");
    stageForeign(root, SHAPES);
    const indexBefore = indexEntries(root, foreignPathsFor(SHAPES));
    const before = head(root);
    const r = runCli(["claim", root, LOCK_ID, BRANCH], root);
    expect({ exitCode: r.exitCode, stderr: r.stderr }).toEqual({ exitCode: 0, stderr: "" });
    const after = head(root);
    expect(after).not.toBe(before);
    expect(r.stdout.trim()).toBe(after);
    expect(git(root, "log", "-1", "--format=%s")).toBe(`chore(locks): claim lock for ${LOCK_ID}`);
    expect(commitPaths(root, after)).toEqual([lockRel(LOCK_ID)]);
    // Through LocalProvider: the foreign staged changes stay staged.
    expect(indexEntries(root, foreignPathsFor(SHAPES))).toEqual(indexBefore);
  });

  test("release <projectRoot> <id> removes the lock through LocalProvider and prints the new sha", async () => {
    const root = await makeRepo(REAL_CTOR, "release", "cli-release");
    stageForeign(root, ["added"]);
    const staged = stagedForeign(root);
    const before = head(root);
    const r = runCli(["release", root, LOCK_ID], root);
    expect({ exitCode: r.exitCode, stderr: r.stderr }).toEqual({ exitCode: 0, stderr: "" });
    const after = head(root);
    expect(commitsSince(root, before)).toEqual([after]);
    expect(r.stdout.trim()).toBe(after);
    expect(git(root, "log", "-1", "--format=%s")).toBe(`chore(locks): release lock for ${LOCK_ID}`);
    expect(commitPaths(root, after)).toEqual([lockRel(LOCK_ID)]);
    expect(existsSync(join(root, lockRel(LOCK_ID)))).toBe(false);
    expect(stagedForeign(root)).toEqual(staged);
  });

  const BAD_ARGV: Array<[string, (root: string) => string[]]> = [
    ["no arguments", () => []],
    ["an unknown verb", (root) => ["steal", root, LOCK_ID]],
    ["claim without a branch", (root) => ["claim", root, LOCK_ID]],
    ["claim with an extra argument", (root) => ["claim", root, LOCK_ID, BRANCH, "extra"]],
    ["release without an id", (root) => ["release", root]],
    ["release with an extra argument", (root) => ["release", root, LOCK_ID, BRANCH]],
  ];
  for (const [name, argv] of BAD_ARGV) {
    test(`refuses ${name} in the NFR-10 shape, commits nothing`, async () => {
      const root = await makeRepo(REAL_CTOR, "release", `cli-bad`);
      const before = head(root);
      const r = runCli(argv(root), root);
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout).toBe("");
      const lines = r.stderr.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]!.trim().length).toBeGreaterThan(0);
      expect(lines.some((l) => /^Remedy: \S/.test(l))).toBe(true);
      expect(lines.some((l) => /^Context: \S/.test(l))).toBe(true);
      expect(head(root)).toBe(before);
      // The lock the fixture claimed is untouched.
      expect(existsSync(join(root, lockRel(LOCK_ID)))).toBe(true);
    });
  }

  // Review finding (security): `id` reaches `join(locksDir, id)` unchecked, so a
  // crafted id claims or releases a path outside .dpt/locks. Every verb must
  // refuse an id that is not a plain lock-file name, before touching anything.
  function treeSnapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (r === ".git") continue;
        if (e.isDirectory()) {
          out[`${r}/`] = "<dir>";
          walk(r);
        } else out[r] = readFileSync(join(root, r), "utf-8");
      }
    };
    walk("");
    return out;
  }

  const BAD_IDS: Array<[string, string]> = [
    ["a traversal to a new file outside the lock store", "../../src/claimed.txt"],
    ["a traversal to a tracked file", "../../src/modified.txt"],
    ["a forward slash", "nested/id"],
    ["a backslash", "..\\..\\src\\modified.txt"],
    ["a bare ..", ".."],
    ["a leading -", "-rf"],
    ["the empty string", ""],
  ];
  for (const verb of ["claim", "release"] as const) {
    for (const [name, badId] of BAD_IDS) {
      test(`${verb} refuses an id with ${name} (${JSON.stringify(badId)}) in the NFR-10 shape, writes and commits nothing`, async () => {
        const root = await makeRepo(REAL_CTOR, verb, `cli-badid-${verb}`);
        const before = head(root);
        const statusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");
        const treeBefore = treeSnapshot(root);
        const argv = verb === "claim" ? ["claim", root, badId, BRANCH] : ["release", root, badId];
        const r = runCli(argv, root);
        expect({ badId, exitCode: r.exitCode === 0 ? 0 : "non-zero", stdout: r.stdout }).toEqual({
          badId,
          exitCode: "non-zero",
          stdout: "",
        });
        const lines = r.stderr.trim().split("\n");
        expect(lines[0]!).toMatch(/^Refusing: \S/);
        expect(lines.some((l) => /^Remedy: \S/.test(l))).toBe(true);
        expect(lines.some((l) => /^Context: \S/.test(l))).toBe(true);
        // No commit, nothing staged or unstaged, no file written or removed anywhere in the tree.
        expect(head(root)).toBe(before);
        expect(git(root, "status", "--porcelain=v1", "--untracked-files=all")).toBe(statusBefore);
        expect(treeSnapshot(root)).toEqual(treeBefore);
        // The release fixture's own lock is untouched.
        if (verb === "release") expect(existsSync(join(root, lockRel(LOCK_ID)))).toBe(true);
      });
    }
  }

  test("a plain tracker-style id still claims and releases through the front door", async () => {
    const id = "STE-731";
    const root = await makeRepo(REAL_CTOR, "claim", "cli-goodid");
    const c = runCli(["claim", root, id, BRANCH], root);
    expect({ exitCode: c.exitCode, stderr: c.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(c.stdout.trim()).toBe(head(root));
    expect(commitPaths(root, head(root))).toEqual([lockRel(id)]);
    const rel = runCli(["release", root, id], root);
    expect({ exitCode: rel.exitCode, stderr: rel.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(rel.stdout.trim()).toBe(head(root));
    expect(commitPaths(root, head(root))).toEqual([lockRel(id)]);
    expect(existsSync(join(root, lockRel(id)))).toBe(false);
  });

  test("docs/implement-reference.md names lock.ts as the tracker-less lock route, with no hand-written git rm of a lock", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "implement-reference.md"), "utf-8");
    expect(doc).toMatch(/adapters\/_shared\/src\/lock\.ts`?\s+claim\b/);
    expect(doc).toMatch(/adapters\/_shared\/src\/lock\.ts`?\s+release\b/);
    const handRolled = doc.split("\n").filter((l) => /git rm\b/.test(l) && /\.dpt\/locks/.test(l));
    expect(handRolled).toEqual([]);
  });
});

// ------------------------------------------------------------ AC .5

const SKILL = join(PLUGIN_ROOT, "skills", "spec-archive", "SKILL.md");

function section(doc: string, start: string, end: string): string {
  const a = doc.indexOf(start);
  const b = doc.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section ${start} .. ${end} not found in spec-archive SKILL.md`);
  return doc.slice(a, b);
}

/** Offsets of: the branch gate, the single archive commit, the first lock release. */
function order(text: string): { gate: number; commit: number; release: number } {
  return {
    gate: text.search(/branch gate/i),
    commit: text.search(/single atomic commit/i),
    release: text.search(/releaseLock/),
  };
}

describe("AC-STE-731.5 — /spec-archive orders branch gate, then the archive commit, then each releaseLock", () => {
  const doc = readFileSync(SKILL, "utf-8");

  test("single-FR procedure: gate < commit < releaseLock in the on-approval steps", () => {
    const s = section(doc, "**Single-FR archival**", "**Milestone-group archival**");
    // Only the steps that EXECUTE: from "On explicit approval" on (the Diff Preview step merely lists the release).
    const exec = s.slice(s.indexOf("On explicit approval"));
    const o = order(exec);
    expect(o.gate).toBeGreaterThanOrEqual(0);
    expect(o.commit).toBeGreaterThanOrEqual(0);
    expect(o.release).toBeGreaterThanOrEqual(0);
    expect({ gateBeforeCommit: o.gate < o.commit, commitBeforeRelease: o.commit < o.release }).toEqual({
      gateBeforeCommit: true,
      commitBeforeRelease: true,
    });
  });

  test("milestone procedure: gate < commit < every releaseLock (preview listing and skip clause excluded)", () => {
    const s = section(doc, "**Milestone-group archival**", "**Plan-only archival**");
    const exec = s
      .split("\n")
      .filter((l) => !/^\d+\.\s+Present the Diff Preview/.test(l.trim()))
      .join("\n")
      .replace(/no `releaseLock` for it/g, "");
    const o = order(exec);
    expect(o.gate).toBeGreaterThanOrEqual(0);
    expect(o.commit).toBeGreaterThanOrEqual(0);
    expect(o.release).toBeGreaterThanOrEqual(0);
    expect({ gateBeforeCommit: o.gate < o.commit, commitBeforeRelease: o.commit < o.release }).toEqual({
      gateBeforeCommit: true,
      commitBeforeRelease: true,
    });
  });

  test("no lock is released inside the archive commit: neither procedure lists releaseLock as part of the commit", () => {
    const s = section(doc, "**Single-FR archival**", "**Plan-only archival**");
    const inCommit = s.split("\n").filter((l) => /releaseLock/.test(l) && /single atomic commit/i.test(l) && !/after/i.test(l));
    expect(inCommit).toEqual([]);
  });
});


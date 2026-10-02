// STE-610 (M_685ff6) — joining a milestone declares the span; since STE-651 (M_a85e46) each
// side declares only its own plan and the sibling is graded read-only.
//
// AC-STE-610.1 — `declareSpan` in `spans_repos.ts` and its front door
//   `bun run adapters/_shared/src/spans_repos.ts <planFile> <milestone> --declare <siblingPath>`
//   verify the sibling before writing anything, and refuse in NFR-10 shape
//   naming the failed check, writing nothing in either repository.
// AC-STE-610.2 — on success both plans gain exactly the inserted `spans_repos:`
//   block (byte diff against a pre-write copy), named by `repo_tag`, pathed
//   between the MAIN worktree roots, and the declaration round-trips through
//   `resolveSpansRepos` from each root's primary checkout and a worktree.
// AC-STE-610.3 — idempotent (zero bytes written, mtimes unchanged), a
//   conflicting path refuses naming both paths, and `mode: none` or a missing
//   `repo_tag` refuses and says to hand-write the declaration.
//
// STE-651 (M_a85e46) amends AC-STE-610.1/.2: a declare writes ONLY the invoking
// repository's plan. The sibling is graded read-only from any git source, and
// the front door prints the command the sibling's own session runs for its
// side. Every B-untouched leg hashes B's whole working tree (excluding .git,
// which `git status` itself refreshes) and compares `git status --porcelain`.
//
// Real git roots (GIT_ENV), torn down in a `finally`; the front door is spawned
// synchronously from the invoking checkout.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

import { spanningSiblingState } from "../adapters/_shared/src/active_plan_ship_ready";
import * as spansRepos from "../adapters/_shared/src/spans_repos";
import { readSpansReposDeclaration, resolveSpansRepos } from "../adapters/_shared/src/spans_repos";
import { sameRepository } from "../adapters/_shared/src/target_repo";
import { FIXTURE_TRACKER_PROJECT, FIXTURE_TRACKER_TEAM, GIT_ENV, claudeMd } from "./_span_fixture";
import { describeRun, MILESTONE, PLUGIN_ROOT, type Run, writePlan } from "./_sibling_state_fixture";
import {
  NFR10,
  SPANS_DOOR,
  TAG_A,
  TAG_B,
  barePlan,
  commitAll,
  git,
  makeDeclarePair,
  noneClaudeMd,
  resolvesTo,
  runDeclare,
  sharedClaudeMd,
  snapshotObject,
  spawnDoor,
  type DeclarePair,
} from "./_span_declare_fixture";

const read = (p: string): string => readFileSync(p, "utf-8");

/**
 * Every working-tree file under `root`, EXCLUDING any `.git` entry: relative
 * path → sha256 of its bytes. `.git` is excluded because `git status` refreshes
 * the index there; the porcelain status is compared separately.
 */
function workTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else out[relative(root, abs)] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  };
  walk(root);
  return out;
}

/** `git -C root status --porcelain` (untracked files included). */
const porcelain = (root: string): string => git(root, "status", "--porcelain", "--untracked-files=all");

/**
 * The sibling command a declare prints — the span front door with
 * `--declare <path>` — cut verbatim from stdout, from `bun run` through the
 * `--declare` path (trailing punctuation the sentence adds is not part of it).
 * Null when no such command is printed.
 */
function siblingCommand(stdout: string): { command: string; declarePath: string } | null {
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("bun run ");
    if (at < 0 || !line.includes("spans_repos.ts") || !line.includes("--declare ")) continue;
    const m = /--declare\s+('(?:[^']|'\\'')*'|\S+)/.exec(line.slice(at));
    if (m === null) continue;
    const declarePath = m[1]!.startsWith("'") ? m[1]! : m[1]!.replace(/[`'";,.)]+$/, "");
    const end = at + m.index + m[0].indexOf(m[1]!) + declarePath.length;
    return { command: line.slice(at, end), declarePath };
  }
  return null;
}

/** Run a printed command through a shell from `cwd`, with CLAUDE_PLUGIN_ROOT set. */
function runPrinted(command: string, cwd: string): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...GIT_ENV, NO_COLOR: "1" })) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  const proc = spawnSync("bash", ["-c", command], { cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

async function withPair<T>(
  body: (p: DeclarePair, extra: string[]) => Promise<T> | T,
  opts: Parameters<typeof makeDeclarePair>[1] = {},
): Promise<T> {
  const p = makeDeclarePair(MILESTONE, opts);
  const extra: string[] = [];
  try {
    return await body(p, extra);
  } finally {
    try {
      p.cleanup();
    } finally {
      for (const d of extra) rmSync(d, { recursive: true, force: true });
    }
  }
}

/**
 * Assert `after` is `before` plus exactly one inserted, contiguous
 * `spans_repos:` block of two entries inside the frontmatter, and return that
 * block's entries (name → path).
 */
function insertedBlock(before: string, after: string, where: string): Record<string, string> {
  const b = before.split("\n");
  const a = after.split("\n");
  expect(a.length, `${where}: expected exactly 3 inserted lines\n--- after ---\n${after}`).toBe(b.length + 3);
  const at = a.findIndex((l) => l === "spans_repos:");
  expect(at, `${where}: no \`spans_repos:\` line\n--- after ---\n${after}`).toBeGreaterThan(0);
  const close = a.indexOf("---", 1);
  expect(at, `${where}: the block sits outside the frontmatter`).toBeLessThan(close);
  const without = [...a.slice(0, at), ...a.slice(at + 3)];
  expect(without.join("\n"), `${where}: lines other than the inserted block changed`).toBe(before);
  const entries: Record<string, string> = {};
  for (const line of a.slice(at + 1, at + 3)) {
    const m = /^[ \t]+([^:\s]+):[ \t]+(\S.*)$/.exec(line);
    expect(m, `${where}: \`${line}\` is not an indented \`name: path\` entry`).not.toBeNull();
    entries[m![1]!] = m![2]!.trim();
  }
  return entries;
}

function expectRefused(r: Run, ...needles: Array<string | RegExp>): void {
  expect(r.status, describeRun(r)).toBe(1);
  expect(r.stdout, describeRun(r)).toBe("");
  for (const re of NFR10) expect(r.stderr, describeRun(r)).toMatch(re);
  for (const n of needles) {
    if (typeof n === "string") expect(r.stderr, describeRun(r)).toContain(n);
    else expect(r.stderr, describeRun(r)).toMatch(n);
  }
}

/** Run a refusing declare and assert neither repository changed. */
function expectRefusedWritingNothing(
  p: { a: string; b: string },
  run: () => Run,
  ...needles: Array<string | RegExp>
): void {
  const beforeA = snapshotObject(p.a);
  const beforeB = snapshotObject(p.b);
  const r = run();
  expectRefused(r, ...needles);
  expect(snapshotObject(p.a), "root A changed on a refusal").toEqual(beforeA);
  expect(snapshotObject(p.b), "root B changed on a refusal").toEqual(beforeB);
}

/** A worktree of `root` in a SIBLING directory of the temp root; returns it. */
function siblingDirWorktree(root: string, extra: string[], branch: string): string {
  const parent = mkdtempSync(join(tmpdir(), "dpt-610-wt-"));
  extra.push(parent);
  const wt = `${parent}-wt`;
  extra.push(wt);
  git(root, "worktree", "add", "-q", "-b", branch, wt);
  return wt;
}

// ===========================================================================
// AC-STE-610.2, amended by STE-651 (M_a85e46) — a declare writes ONLY the
// invoking plan. The sibling is graded read-only; its own session declares
// its side with the command the front door prints.
// ===========================================================================

describe("AC-STE-610.2 / AC-STE-651.1 — a declare writes only this repository's plan", () => {
  test("AC-STE-651.1 from the primary checkout: A's plan gains exactly the inserted block, named by repo_tag and pathed between main roots; B's working tree and git status are unchanged, and the output names B and the command B's own session runs", async () => {
    await withPair(async (p) => {
      const beforeA = read(p.planA);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);

      const entriesA = insertedBlock(beforeA, read(p.planA), "invoking plan");
      expect(Object.keys(entriesA).sort()).toEqual([TAG_A, TAG_B].sort());
      expect(entriesA[TAG_A]).toBe(".");
      expect(isAbsolute(entriesA[TAG_B]!), `sibling path must be relative: ${entriesA[TAG_B]}`).toBe(false);
      expect(resolvesTo(p.a, entriesA[TAG_B]!, p.b), `${entriesA[TAG_B]} from A does not reach B`).toBe(true);

      // Nothing in B is written: every working-tree byte and its git status.
      expect(workTree(p.b), "a declare from A wrote into B's working tree").toEqual(treeB);
      expect(porcelain(p.b), "a declare from A changed B's git status").toBe(statusB);

      // The output names B and prints the command B's own session runs.
      expect(r.stdout).toContain(basename(p.b));
      const cmd = siblingCommand(r.stdout);
      expect(cmd, `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
      expect(resolvesTo(p.b, cmd!.declarePath, p.a), `the printed --declare path ${cmd!.declarePath} does not resolve to A`).toBe(true);
    });
  }, 30_000);

  test("AC-STE-651.5 round trip: after A and then B each declare their own side, resolveSpansRepos resolves self and the other repository from each primary checkout and from a sibling-directory worktree", async () => {
    await withPair(async (p, extra) => {
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      const rb = runDeclare(p.b, p.planB, MILESTONE, p.a);
      expect(rb.status, describeRun(rb)).toBe(0);
      commitAll(p.b, "fixture: B declares its side");
      const wtA = siblingDirWorktree(p.a, extra, "wt-a");
      const wtB = siblingDirWorktree(p.b, extra, "wt-b");
      const legs: Array<[string, string, string, string, string]> = [
        // [label, planBody source, invokingRepo, selfTag, otherRoot]
        ["A primary", p.planA, p.a, TAG_A, p.b],
        ["A worktree", p.planA, wtA, TAG_A, p.b],
        ["B primary", p.planB, p.b, TAG_B, p.a],
        ["B worktree", p.planB, wtB, TAG_B, p.a],
      ];
      for (const [label, planFile, invokingRepo, selfTag, otherRoot] of legs) {
        const states = await resolveSpansRepos({
          planBody: read(planFile),
          milestone: MILESTONE,
          invokingRepo,
        });
        expect(states.length, label).toBe(2);
        const self = states.find((s) => s.self);
        const other = states.find((s) => !s.self);
        expect(self?.name, label).toBe(selfTag);
        expect(self?.root !== null && sameRepository(self!.root!, invokingRepo), label).toBe(true);
        expect(other?.root, `${label}: the other entry is unlocatable`).not.toBeNull();
        expect(sameRepository(other!.root!, otherRoot), `${label}: the other entry is not the other repository`).toBe(
          true,
        );
      }
    });
  }, 60_000);

  test("AC-STE-651.1 declared from a nested worktree of A: the path is still computed between the MAIN worktree roots, and B is untouched", async () => {
    await withPair(async (p) => {
      const wt = join(p.a, ".claude", "worktrees", "declare-610");
      git(p.a, "worktree", "add", "-q", "-b", "nested-610", wt);
      const planWt = barePlan(wt, MILESTONE);
      const beforeWt = read(planWt);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      const r = runDeclare(wt, planWt, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      const entriesWt = insertedBlock(beforeWt, read(planWt), "worktree plan");
      expect(entriesWt[TAG_A]).toBe(".");
      expect(
        resolvesTo(p.a, entriesWt[TAG_B]!, p.b),
        `${entriesWt[TAG_B]} must reach B from A's MAIN worktree root`,
      ).toBe(true);
      expect(workTree(p.b), "a declare from A's worktree wrote into B").toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
      // The printed command names A's MAIN checkout, not the worktree.
      const cmd = siblingCommand(r.stdout);
      expect(cmd, `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
      expect(resolvesTo(p.b, cmd!.declarePath, p.a), `${cmd!.declarePath} must reach A's MAIN checkout`).toBe(true);
    });
  }, 30_000);

  test("AC-STE-651.1 declareSpan is exported and, called in process, writes the invoking plan only", async () => {
    await withPair(async (p) => {
      const declareSpan = (spansRepos as Record<string, unknown>).declareSpan;
      expect(typeof declareSpan, "spans_repos.ts exports no declareSpan").toBe("function");
      const beforeA = read(p.planA);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      await (declareSpan as (i: Record<string, string>) => unknown)({
        invokingRepo: p.a,
        planFile: p.planA,
        milestone: MILESTONE,
        siblingPath: p.b,
      });
      expect(insertedBlock(beforeA, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(workTree(p.b), "declareSpan wrote into B").toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-610.1 — every check refuses before anything is written
// ===========================================================================

describe("AC-STE-610.1 — the sibling is verified before anything is written", () => {
  test("a sibling that is not a git repository refuses, naming the check", async () => {
    await withPair(async (p, extra) => {
      const plain = mkdtempSync(join(tmpdir(), "dpt-610-plain-"));
      extra.push(plain);
      sharedClaudeMd(plain, TAG_B);
      barePlan(plain, MILESTONE);
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, plain), /git repositor/i);
    });
  }, 30_000);

  test("a sibling that is the same repository (a worktree of the invoking one) refuses, naming the check", async () => {
    await withPair(async (p, extra) => {
      const wt = siblingDirWorktree(p.a, extra, "same-610");
      barePlan(wt, MILESTONE);
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, wt), /same repositor/i);
    });
  }, 30_000);

  test("a sibling that is not toolkit-managed refuses, naming the check", async () => {
    await withPair(async (p) => {
      git(p.b, "rm", "-q", "CLAUDE.md");
      commitAll(p.b, "fixture: B unmanaged");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), /toolkit-managed/i);
    });
  }, 30_000);

  test("a sibling bound to another tracker project refuses, naming both projects", async () => {
    await withPair(async (p) => {
      sharedClaudeMd(p.b, TAG_B, { project: "Another Tracker Project" });
      commitAll(p.b, "fixture: B elsewhere");
      expectRefusedWritingNothing(
        p,
        () => runDeclare(p.a, p.planA, MILESTONE, p.b),
        "Another Tracker Project",
        /project/i,
      );
    });
  }, 30_000);

  test("a sibling bound to another tracker mode refuses, naming the mode", async () => {
    await withPair(async (p) => {
      sharedClaudeMd(p.b, TAG_B, { mode: "jira" });
      commitAll(p.b, "fixture: B on jira");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), /jira/i, /mode/i);
    });
  }, 30_000);

  test("two repositories declaring the same repo_tag refuse, naming the tag", async () => {
    await withPair(
      async (p) => {
        expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), /repo_tag/, TAG_A);
      },
      { tagA: TAG_A, tagB: TAG_A },
    );
  }, 30_000);

  test("a sibling holding no plan for the milestone anywhere refuses, naming the plan", async () => {
    await withPair(async (p) => {
      git(p.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(p.b, "fixture: B has no plan");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), /plan/i, MILESTONE);
    });
  }, 30_000);

  test("AC-STE-651.2 a sibling whose plan sits only on a branch that is not checked out no longer refuses: A is declared, B is untouched, and the output names the branch and B's own command (re-pinned: refused before STE-651)", async () => {
    await withPair(async (p) => {
      git(p.b, "checkout", "-q", "-b", "plan-only-610");
      commitAll(p.b, "fixture: plan on a branch");
      git(p.b, "checkout", "-q", "main");
      git(p.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(p.b, "fixture: main holds no plan");
      // Premise: the branch holds the plan; the main worktree does not.
      expect(git(p.b, "show", `plan-only-610:specs/plan/${MILESTONE}.md`)).toContain(`milestone: ${MILESTONE}`);
      const beforeA = read(p.planA);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      expect(insertedBlock(beforeA, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(workTree(p.b)).toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
      expect(r.stdout).toContain("branch plan-only-610");
      const cmd = siblingCommand(r.stdout);
      expect(cmd, `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
      expect(resolvesTo(p.b, cmd!.declarePath, p.a)).toBe(true);
    });
  }, 30_000);

  test("AC-STE-651.2 a sibling whose plan sits only in a linked worktree of B: A is declared, nothing in B or its worktree changes, and the output names that worktree", async () => {
    await withPair(async (p, extra) => {
      git(p.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(p.b, "fixture: main holds no plan");
      const wt = siblingDirWorktree(p.b, extra, "plan-wt-651");
      barePlan(wt, MILESTONE);
      const beforeA = read(p.planA);
      const treeB = workTree(p.b);
      const treeWt = workTree(wt);
      const statusB = porcelain(p.b);
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      expect(insertedBlock(beforeA, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(workTree(p.b)).toEqual(treeB);
      expect(workTree(wt), "the declare wrote into B's linked worktree").toEqual(treeWt);
      expect(porcelain(p.b)).toBe(statusB);
      expect(
        r.stdout.includes(`worktree ${wt}`) || r.stdout.includes(`worktree ${realpathSync(wt)}`),
        `the output names no source \`worktree ${wt}\`:\n${r.stdout}`,
      ).toBe(true);
      expect(siblingCommand(r.stdout), `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
    });
  }, 30_000);

  test("a missing sibling path refuses, naming the path", async () => {
    await withPair(async (p) => {
      const gone = `${p.b}-no-such-sibling`;
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, gone), basename(gone));
    });
  }, 30_000);

  test("(control: the plan reader already refuses on HEAD) an unreadable plan file refuses with the reader's text, naming the file", async () => {
    await withPair(async (p) => {
      const missing = join(p.a, "specs", "plan", "M_NOPE_1.md");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, missing, MILESTONE, p.b), "cannot be read", missing);
    });
  }, 30_000);

  test("(control: the declaration reader already refuses on HEAD) a malformed spans_repos in the invoking plan refuses with the reader's own text", async () => {
    await withPair(async (p) => {
      writePlan(p.a, "live", MILESTONE, {}, { extra: { spans_repos: "glacy" } });
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), "not a map");
    });
  }, 30_000);

  test("a malformed spans_repos in the sibling's plan refuses with the reader's own text", async () => {
    await withPair(async (p) => {
      writePlan(p.b, "live", MILESTONE, {}, { extra: { spans_repos: "glacy" } });
      commitAll(p.b, "fixture: B malformed");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), "not a map");
    });
  }, 30_000);

  test("a sibling CLAUDE.md declaration STE-602 refuses refuses with that reader's text", async () => {
    await withPair(async (p) => {
      claudeMd(p.b, { mode: "linear", team: FIXTURE_TRACKER_TEAM, project: FIXTURE_TRACKER_PROJECT, repoTag: TAG_B });
      commitAll(p.b, "fixture: B declaration refused");
      expectRefusedWritingNothing(
        p,
        () => runDeclare(p.a, p.planA, MILESTONE, p.b),
        `repo_tag "${TAG_B}" is declared with no min_dpt_version`,
      );
    });
  }, 30_000);

  test("the invoking CLAUDE.md declaration STE-602 refuses refuses with that reader's text", async () => {
    await withPair(async (p) => {
      claudeMd(p.a, { mode: "linear", team: FIXTURE_TRACKER_TEAM, project: FIXTURE_TRACKER_PROJECT, repoTag: TAG_A });
      expectRefusedWritingNothing(
        p,
        () => runDeclare(p.a, p.planA, MILESTONE, p.b),
        `repo_tag "${TAG_A}" is declared with no min_dpt_version`,
      );
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-610.3 — idempotence, conflict, and no invented names
// ===========================================================================

describe("AC-STE-610.3 — idempotence and conflict", () => {
  test("AC-STE-651.5 after A and B each declare their own side, a second declare from either side writes zero bytes in either repository (modification times unchanged)", async () => {
    await withPair(async (p) => {
      const first = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(first.status, describeRun(first)).toBe(0);
      const firstB = runDeclare(p.b, p.planB, MILESTONE, p.a);
      expect(firstB.status, describeRun(firstB)).toBe(0);
      // Premise: each run wrote its own block.
      expect(read(p.planA)).toContain("spans_repos:");
      expect(read(p.planB)).toContain("spans_repos:");
      for (const [label, run] of [
        ["from A", () => runDeclare(p.a, p.planA, MILESTONE, p.b)],
        ["from B", () => runDeclare(p.b, p.planB, MILESTONE, p.a)],
      ] as const) {
        const beforeA = snapshotObject(p.a);
        const beforeB = snapshotObject(p.b);
        const treeA = workTree(p.a);
        const treeB = workTree(p.b);
        const second = run();
        expect(second.status, `${label}\n${describeRun(second)}`).toBe(0);
        expect(snapshotObject(p.a), label).toEqual(beforeA);
        expect(snapshotObject(p.b), label).toEqual(beforeB);
        expect(workTree(p.a), label).toEqual(treeA);
        expect(workTree(p.b), label).toEqual(treeB);
      }
    });
  }, 30_000);

  test("AC-STE-651.5 sibling_release reports neither side one-sided once both have declared — and, before B declares, A's declare alone leaves B one-sided (opposite break)", async () => {
    await withPair(async (p) => {
      const first = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(first.status, describeRun(first)).toBe(0);
      const fromA0 = await spanningSiblingState(p.a, read(p.planA), MILESTONE);
      expect(
        fromA0.siblings.map((s) => [s.name, s.state]),
        "A's declare alone must not make B name A back",
      ).toEqual([[TAG_B, "one-sided"]]);
      const second = runDeclare(p.b, p.planB, MILESTONE, p.a);
      expect(second.status, describeRun(second)).toBe(0);
      commitAll(p.b, "fixture: B declares its side");
      const fromA = await spanningSiblingState(p.a, read(p.planA), MILESTONE);
      const fromB = await spanningSiblingState(p.b, read(p.planB), MILESTONE);
      expect(fromA.siblings.map((s) => s.name)).toEqual([TAG_B]);
      expect(fromB.siblings.map((s) => s.name)).toEqual([TAG_A]);
      for (const s of [...fromA.siblings, ...fromB.siblings]) expect(s.state, s.name).not.toBe("one-sided");
    });
  }, 60_000);

  test("an invoking plan mapping the sibling's tag to another path refuses, naming both paths", async () => {
    await withPair(async (p) => {
      writePlan(p.a, "live", MILESTONE, { [TAG_A]: ".", [TAG_B]: "../somewhere-else" });
      expectRefusedWritingNothing(
        p,
        () => runDeclare(p.a, p.planA, MILESTONE, p.b),
        "../somewhere-else",
        basename(p.b),
      );
    });
  }, 30_000);

  test("AC-STE-651.4 a sibling plan mapping the invoking tag to another path refuses, naming both paths, writing nothing in either repository", async () => {
    await withPair(async (p, extra) => {
      const other = mkdtempSync(join(tmpdir(), "dpt-610-other-"));
      extra.push(other);
      const wrong = relative(p.b, other);
      writePlan(p.b, "live", MILESTONE, { [TAG_A]: wrong, [TAG_B]: "." });
      commitAll(p.b, "fixture: B names another A");
      const treeA = workTree(p.a);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), wrong, basename(p.a));
      expect(workTree(p.a)).toEqual(treeA);
      expect(workTree(p.b)).toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
    });
  }, 30_000);

  test("AC-STE-651.4 the sibling conflict is graded read-only from any git source: held only on a branch of B, it still refuses naming both paths", async () => {
    await withPair(async (p, extra) => {
      const other = mkdtempSync(join(tmpdir(), "dpt-651-other-"));
      extra.push(other);
      const wrong = relative(p.b, other);
      git(p.b, "checkout", "-q", "-b", "conflict-651");
      writePlan(p.b, "live", MILESTONE, { [TAG_A]: wrong, [TAG_B]: "." });
      commitAll(p.b, "fixture: B's branch names another A");
      git(p.b, "checkout", "-q", "main");
      git(p.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(p.b, "fixture: main holds no plan");
      const treeA = workTree(p.a);
      const treeB = workTree(p.b);
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), wrong, basename(p.a));
      expect(workTree(p.a)).toEqual(treeA);
      expect(workTree(p.b)).toEqual(treeB);
    });
  }, 30_000);

  test("under mode: none the writer refuses and says to hand-write the declaration", async () => {
    await withPair(async (p) => {
      noneClaudeMd(p.a);
      noneClaudeMd(p.b);
      commitAll(p.b, "fixture: B mode none");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), /hand[- ]?writ|by hand/i);
    });
  }, 30_000);

  test("without a repo_tag on the invoking side the writer refuses and says to hand-write it, inventing no name", async () => {
    await withPair(
      async (p) => {
        expectRefusedWritingNothing(
          p,
          () => runDeclare(p.a, p.planA, MILESTONE, p.b),
          /repo_tag/,
          /hand[- ]?writ|by hand/i,
        );
      },
      { tagA: null },
    );
  }, 30_000);

  test("without a repo_tag on the sibling the writer refuses and says to hand-write it, inventing no name", async () => {
    await withPair(
      async (p) => {
        expectRefusedWritingNothing(
          p,
          () => runDeclare(p.a, p.planA, MILESTONE, p.b),
          /repo_tag/,
          /hand[- ]?writ|by hand/i,
        );
      },
      { tagB: null },
    );
  }, 30_000);

  test("(control) the existing resolve form of the front door is unchanged: an undeclared plan prints nothing and exits 0", async () => {
    await withPair(async (p) => {
      const r = spawnDoor(SPANS_DOOR, [p.planA, MILESTONE, p.a]);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout).toBe("");
    });
  }, 30_000);
});

// M_2306b6 / STE-616 — the git-read refusal names WHO repairs the sibling.
//
// "repair the sibling repository so git can read it" named an act in another
// repository and no actor, and escaped the sweep that fixed seven others because
// it reads "the sibling repository so git", not "in sibling". A child told to
// fix what a refusal names would repair B from A.
describe("STE-616 — the sibling git-read refusal names who acts", () => {
  test("an unreadable sibling object store refuses, telling the reader the sibling's own session repairs it", async () => {
    await withPair(async (p) => {
      const objects = join(p.b, ".git", "objects");
      const dirs = readdirSync(objects).filter((d) => /^[0-9a-f]{2}$/.test(d));
      expect(dirs.length, "the fixture has loose objects to hide").toBeGreaterThan(0);
      for (const d of dirs) chmodSync(join(objects, d), 0o000);
      try {
        expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), "cannot be read from git", /never from here|from ITS OWN session|own session/);
      } finally {
        for (const d of dirs) chmodSync(join(objects, d), 0o755);
      }
    });
  }, 30_000);
});

// ===========================================================================
// STE-651 (M_a85e46) — new legs, each red before the one-sided declare.
// ===========================================================================

describe("AC-STE-651.1 — a dirty sibling main worktree stays untouched", () => {
  test("AC-STE-651.1 B's main worktree carries an untracked file and an uncommitted edit to its undeclared plan: a declare from A exits 0, leaves every byte of B and its git status unchanged", async () => {
    await withPair(async (p) => {
      writeFileSync(join(p.b, "scratch-651.txt"), "work in progress in B\n");
      appendFileSync(p.planB, "\nAn uncommitted edit B's own session is in the middle of.\n");
      const statusB = porcelain(p.b);
      // Premise: B is dirty, both ways.
      expect(statusB).toContain("scratch-651.txt");
      expect(statusB).toContain(`specs/plan/${MILESTONE}.md`);
      const treeB = workTree(p.b);
      const beforeA = read(p.planA);
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      expect(insertedBlock(beforeA, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(workTree(p.b), "a declare from A rewrote B's dirty working tree").toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
    });
  }, 30_000);
});

describe("AC-STE-651.3 — a plan file outside the invoking repository refuses after the read", () => {
  test("AC-STE-651.3 B's plan passed from A refuses in NFR-10 shape naming both paths and writes nothing in either repository", async () => {
    await withPair(async (p) => {
      const treeA = workTree(p.a);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      expectRefusedWritingNothing(
        p,
        () => runDeclare(p.a, p.planB, MILESTONE, p.b),
        basename(p.b),
        basename(p.a),
        `specs/plan/${MILESTONE}.md`,
      );
      expect(workTree(p.a)).toEqual(treeA);
      expect(workTree(p.b)).toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
    });
  }, 30_000);

  test("AC-STE-651.3 a plan file in ANOTHER repository nested inside A's directory refuses (sameRepository on the real directory, not a path prefix) and writes nothing", async () => {
    await withPair(async (p) => {
      git(p.a, "clone", "-q", p.b, "vendor-b-651");
      const nested = join(p.a, "vendor-b-651");
      const nestedPlan = join(nested, "specs", "plan", `${MILESTONE}.md`);
      // Premise: the nested checkout is its own repository holding the plan.
      expect(read(nestedPlan)).toContain(`milestone: ${MILESTONE}`);
      expect(sameRepository(nested, p.a)).toBe(false);
      const treeNested = workTree(nested);
      const treeB = workTree(p.b);
      const r = runDeclare(p.a, nestedPlan, MILESTONE, p.b);
      expectRefused(r, "vendor-b-651", basename(p.a));
      expect(workTree(nested), "the nested repository's plan was written").toEqual(treeNested);
      expect(workTree(p.b)).toEqual(treeB);
    });
  }, 30_000);

  test("AC-STE-651.3 (control: the containment check runs AFTER the read) an unreadable plan path outside A still refuses with the reader's 'cannot be read' text", async () => {
    await withPair(async (p) => {
      const missing = join(p.b, "specs", "plan", "M_NOPE_651.md");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, missing, MILESTONE, p.b), "cannot be read", missing);
    });
  }, 30_000);
});

describe("AC-STE-651.3 hardening (review r0) — the containment check grades the plan FILE's real location", () => {
  test("AC-STE-651.3 a plan path inside A that is a SYMLINK to B's plan refuses and writes nothing in B", async () => {
    await withPair(async (p) => {
      const link = join(p.a, "specs", "plan", "M_SYMLINK_651.md");
      symlinkSync(p.planB, link);
      // Premise: the link's own directory is in A; only its target is in B.
      expect(sameRepository(join(p.a, "specs", "plan"), p.a)).toBe(true);
      const treeB = workTree(p.b);
      const statusB = porcelain(p.b);
      const r = runDeclare(p.a, link, MILESTONE, p.b);
      expectRefused(r, "is not in the invoking repository", `\`${link}\``);
      expect(workTree(p.b), "a declare through a symlink wrote B's plan").toEqual(treeB);
      expect(porcelain(p.b)).toBe(statusB);
    });
  }, 30_000);

  test("AC-STE-651.3 the nested-clone refusal names the plan file and the invoking repository, each in full", async () => {
    await withPair(async (p) => {
      git(p.a, "clone", "-q", p.b, "vendor-b-651b");
      const nestedPlan = join(p.a, "vendor-b-651b", "specs", "plan", `${MILESTONE}.md`);
      const r = runDeclare(p.a, nestedPlan, MILESTONE, p.b);
      expectRefused(r, `\`${nestedPlan}\` is not in the invoking repository \``);
      // The invoking repository is named as its own backticked path, not just inside the plan path.
      expect(r.stderr).toMatch(new RegExp(`invoking repository \`[^\`]*${basename(p.a)}\``));
    });
  }, 30_000);

  test("AC-STE-651.3 a relative planFile resolves against invokingRepo, not the process cwd: declareSpan in process declares A's plan", async () => {
    await withPair(async (p) => {
      const treeB = workTree(p.b);
      const before = read(p.planA);
      // Premise: this process's cwd is not A, so a cwd-relative read would miss.
      expect(sameRepository(process.cwd(), p.a)).toBe(false);
      await spansRepos.declareSpan({
        invokingRepo: p.a,
        planFile: `specs/plan/${MILESTONE}.md`,
        milestone: MILESTONE,
        siblingPath: p.b,
      });
      expect(insertedBlock(before, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(workTree(p.b)).toEqual(treeB);
    });
  }, 30_000);
});

describe("AC-STE-651.9 hardening (review r0) — the printed command survives a path with a space", () => {
  test("AC-STE-651.9 A checked out under a directory with a space: the printed command, run verbatim from B, makes B's plan name A", async () => {
    await withPair(async (p, extra) => {
      const parent = mkdtempSync(join(tmpdir(), "dpt span 651 "));
      extra.push(parent);
      const spaced = join(parent, "a copy");
      const cp = spawnSync("cp", ["-R", p.a, spaced], { encoding: "utf-8" });
      expect(cp.status, cp.stderr).toBe(0);
      const spacedPlan = join(spaced, "specs", "plan", `${MILESTONE}.md`);
      const r = runDeclare(spaced, spacedPlan, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      const cmd = siblingCommand(r.stdout);
      expect(cmd, `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
      const run = runPrinted(cmd!.command, p.b);
      expect(run.status, `${cmd!.command}\n${describeRun(run)}`).toBe(0);
      const decl = readSpansReposDeclaration(read(p.planB));
      const toA = decl.entries?.find((e) => e.name === TAG_A);
      expect(toA, `B's plan names no ${TAG_A}:\n${read(p.planB)}`).toBeDefined();
      expect(resolvesTo(p.b, toA!.declaredPath, spaced), `${toA!.declaredPath} from B does not reach the spaced A`).toBe(true);
    });
  }, 60_000);
});

describe("AC-STE-651.9 — the printed sibling command, run verbatim from B, declares B's side", () => {
  test("AC-STE-651.9 the command A's declare prints, run from B's root with CLAUDE_PLUGIN_ROOT set, exits 0 and makes B's plan name A", async () => {
    await withPair(async (p) => {
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      const cmd = siblingCommand(r.stdout);
      expect(cmd, `no sibling --declare command printed:\n${r.stdout}`).not.toBeNull();
      // Premise: B does not name A yet — A's declare did not write B.
      expect(readSpansReposDeclaration(read(p.planB)).declared, "A's declare wrote B's plan").toBe(false);
      const run = runPrinted(cmd!.command, p.b);
      expect(run.status, `${cmd!.command}\n${describeRun(run)}`).toBe(0);
      const decl = readSpansReposDeclaration(read(p.planB));
      expect(decl.declared, `B's plan declares no span after the printed command:\n${read(p.planB)}`).toBe(true);
      const toA = decl.entries!.find((e) => e.name === TAG_A);
      expect(toA, `B's plan names no ${TAG_A}`).toBeDefined();
      expect(resolvesTo(p.b, toA!.declaredPath, p.a), `${toA!.declaredPath} from B does not reach A`).toBe(true);
      expect(decl.entries!.find((e) => e.name === TAG_B)?.declaredPath).toBe(".");
    });
  }, 60_000);
});

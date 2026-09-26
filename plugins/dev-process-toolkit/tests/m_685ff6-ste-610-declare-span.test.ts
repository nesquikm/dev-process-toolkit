// STE-610 (M_685ff6) — joining a milestone declares the span in both plans.
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
// Real git roots (GIT_ENV), torn down in a `finally`; the front door is spawned
// synchronously from the invoking checkout.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

import * as spansRepos from "../adapters/_shared/src/spans_repos";
import { resolveSpansRepos } from "../adapters/_shared/src/spans_repos";
import { sameRepository } from "../adapters/_shared/src/target_repo";
import { FIXTURE_TRACKER_PROJECT, FIXTURE_TRACKER_TEAM, claudeMd } from "./_span_fixture";
import { describeRun, MILESTONE, type Run, writePlan } from "./_sibling_state_fixture";
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
// AC-STE-610.2 — both plans gain the span (red on HEAD: no --declare)
// ===========================================================================

describe("AC-STE-610.2 — a declare writes the span into both plans", () => {
  test("from the primary checkout: each plan gains exactly the inserted block, named by repo_tag and pathed between main roots, and the output names the sibling file to commit", async () => {
    await withPair(async (p) => {
      const beforeA = read(p.planA);
      const beforeB = read(p.planB);
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);

      const entriesA = insertedBlock(beforeA, read(p.planA), "invoking plan");
      expect(Object.keys(entriesA).sort()).toEqual([TAG_A, TAG_B].sort());
      expect(entriesA[TAG_A]).toBe(".");
      expect(isAbsolute(entriesA[TAG_B]!), `sibling path must be relative: ${entriesA[TAG_B]}`).toBe(false);
      expect(resolvesTo(p.a, entriesA[TAG_B]!, p.b), `${entriesA[TAG_B]} from A does not reach B`).toBe(true);

      const entriesB = insertedBlock(beforeB, read(p.planB), "sibling plan");
      expect(Object.keys(entriesB).sort()).toEqual([TAG_A, TAG_B].sort());
      expect(entriesB[TAG_B]).toBe(".");
      expect(isAbsolute(entriesB[TAG_A]!)).toBe(false);
      expect(resolvesTo(p.b, entriesB[TAG_A]!, p.a), `${entriesB[TAG_A]} from B does not reach A`).toBe(true);

      // The back-reference is left uncommitted in B, and the output names it.
      expect(`${r.stdout}\n${r.stderr}`).toContain(basename(p.b));
      expect(`${r.stdout}\n${r.stderr}`).toContain(`specs/plan/${MILESTONE}.md`);
    });
  }, 30_000);

  test("round trip: resolveSpansRepos resolves self and the other repository from each primary checkout and from a sibling-directory worktree", async () => {
    await withPair(async (p, extra) => {
      const r = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
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

  test("declared from a nested worktree of A: both paths are still computed between the MAIN worktree roots", async () => {
    await withPair(async (p) => {
      const wt = join(p.a, ".claude", "worktrees", "declare-610");
      git(p.a, "worktree", "add", "-q", "-b", "nested-610", wt);
      const planWt = barePlan(wt, MILESTONE);
      const beforeWt = read(planWt);
      const beforeB = read(p.planB);
      const r = runDeclare(wt, planWt, MILESTONE, p.b);
      expect(r.status, describeRun(r)).toBe(0);
      const entriesWt = insertedBlock(beforeWt, read(planWt), "worktree plan");
      expect(entriesWt[TAG_A]).toBe(".");
      expect(
        resolvesTo(p.a, entriesWt[TAG_B]!, p.b),
        `${entriesWt[TAG_B]} must reach B from A's MAIN worktree root`,
      ).toBe(true);
      const entriesB = insertedBlock(beforeB, read(p.planB), "sibling plan");
      expect(
        resolvesTo(p.b, entriesB[TAG_A]!, p.a),
        `${entriesB[TAG_A]} must reach A's MAIN checkout, not the worktree`,
      ).toBe(true);
    });
  }, 30_000);

  test("declareSpan is exported and, called in process, writes both plans", async () => {
    await withPair(async (p) => {
      const declareSpan = (spansRepos as Record<string, unknown>).declareSpan;
      expect(typeof declareSpan, "spans_repos.ts exports no declareSpan").toBe("function");
      const beforeA = read(p.planA);
      const beforeB = read(p.planB);
      await (declareSpan as (i: Record<string, string>) => unknown)({
        invokingRepo: p.a,
        planFile: p.planA,
        milestone: MILESTONE,
        siblingPath: p.b,
      });
      expect(insertedBlock(beforeA, read(p.planA), "invoking plan")[TAG_A]).toBe(".");
      expect(insertedBlock(beforeB, read(p.planB), "sibling plan")[TAG_B]).toBe(".");
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

  test("a sibling whose plan sits only on a branch that is not checked out refuses the write, naming the ref", async () => {
    await withPair(async (p) => {
      git(p.b, "checkout", "-q", "-b", "plan-only-610");
      commitAll(p.b, "fixture: plan on a branch");
      git(p.b, "checkout", "-q", "main");
      git(p.b, "rm", "-q", join("specs", "plan", `${MILESTONE}.md`));
      commitAll(p.b, "fixture: main holds no plan");
      // Premise: the branch holds the plan; the main worktree does not.
      expect(git(p.b, "show", `plan-only-610:specs/plan/${MILESTONE}.md`)).toContain(`milestone: ${MILESTONE}`);
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), "plan-only-610");
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
  test("a second declare writes zero bytes in either repository (modification times unchanged)", async () => {
    await withPair(async (p) => {
      const first = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(first.status, describeRun(first)).toBe(0);
      // Premise: the first run wrote the block.
      expect(read(p.planA)).toContain("spans_repos:");
      const beforeA = snapshotObject(p.a);
      const beforeB = snapshotObject(p.b);
      const second = runDeclare(p.a, p.planA, MILESTONE, p.b);
      expect(second.status, describeRun(second)).toBe(0);
      expect(snapshotObject(p.a)).toEqual(beforeA);
      expect(snapshotObject(p.b)).toEqual(beforeB);
    });
  }, 30_000);

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

  test("a sibling plan mapping the invoking tag to another path refuses, naming both paths", async () => {
    await withPair(async (p, extra) => {
      const other = mkdtempSync(join(tmpdir(), "dpt-610-other-"));
      extra.push(other);
      const wrong = relative(p.b, other);
      writePlan(p.b, "live", MILESTONE, { [TAG_A]: wrong, [TAG_B]: "." });
      commitAll(p.b, "fixture: B names another A");
      expectRefusedWritingNothing(p, () => runDeclare(p.a, p.planA, MILESTONE, p.b), wrong, basename(p.a));
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

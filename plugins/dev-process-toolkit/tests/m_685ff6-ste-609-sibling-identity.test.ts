// STE-609 (M_685ff6) — sibling identity: which repository a path names, where a
// relative `spans_repos:` path is resolved from, and exactly one self entry.
//
// AC-STE-609.1 — `sameRepository(a, b)` compares the realpaths of each path's
//   `git rev-parse --git-common-dir`, falling back to realpath equality outside a
//   git work tree. It is the self test of `resolveSpansRepos`. `sameRepo` and
//   `routeMilestone` stay byte-unchanged.
// AC-STE-609.2 — a relative path resolves against the invoking repository's
//   MAIN worktree root (first entry of `git worktree list --porcelain`), so a
//   nested `.claude/worktrees/<name>` checkout locates the sibling too.
// AC-STE-609.3 — exactly one entry names the invoking repository; zero or two
//   or more is refused in NFR-10 shape by every reader of the declaration.
//
// Every tree is a set of REAL git repositories (GIT_ENV: no global or system
// config), torn down in a `finally`. `sameRepository` is reached through the
// module namespace so its absence fails each test by name.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { runActivePlanShipReadyProbe } from "../adapters/_shared/src/active_plan_ship_ready";
import { classifyResume } from "../adapters/_shared/src/resume_classifier";
import { siblingShipGate } from "../adapters/_shared/src/sibling_release";
import { SpansReposError, resolveSpansRepos } from "../adapters/_shared/src/spans_repos";
import * as targetRepo from "../adapters/_shared/src/target_repo";
import {
  A_FR,
  A_NAME,
  B_NAME,
  MILESTONE,
  REPO_ROOT,
  describeRun,
  makeIdle,
  runModule,
  spansFromA,
  writePlan,
} from "./_sibling_state_fixture";
import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";

// ===========================================================================
// Helpers.
// ===========================================================================

type SameRepository = (a: string, b: string) => boolean;

function sameRepository(a: string, b: string): boolean {
  const fn = (targetRepo as Record<string, unknown>).sameRepository;
  if (typeof fn !== "function") {
    throw new Error("adapters/_shared/src/target_repo.ts exports no `sameRepository` function");
  }
  return (fn as SameRepository)(a, b);
}

const real = (p: string): string => realpathSync(p);

/** Scratch directories this file creates beyond the span fixture's two roots. */
function scratch(label: string): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `dpt-609-${label}-`));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function withSpan<T>(body: (fx: SpanFixture, extra: string[]) => Promise<T> | T): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  const extra: string[] = [];
  try {
    return await body(fx, extra);
  } finally {
    try {
      fx.cleanup();
    } finally {
      for (const d of extra) rmSync(d, { recursive: true, force: true });
    }
  }
}

/**
 * A second worktree of `repo` in a fresh sibling directory of it (same parent,
 * the OS temp dir), on a new branch. Returns its path; the caller removes it.
 */
function siblingWorktree(repo: string, extra: string[], branch = "wt"): string {
  const parent = mkdtempSync(join(tmpdir(), "dpt-609-wtparent-"));
  extra.push(parent);
  // `relative()` from this worktree must match `relative()` from `repo`, so the
  // worktree itself sits directly in the temp dir, not inside `parent`.
  const wt = `${parent}-wt`;
  extra.push(wt);
  git(repo, "worktree", "add", "-q", "-b", branch, wt);
  return wt;
}

/** A nested `.claude/worktrees/<name>` checkout inside `repo`. */
function nestedWorktree(repo: string, name = "nested"): string {
  const wt = join(repo, ".claude", "worktrees", name);
  mkdirSync(join(repo, ".claude", "worktrees"), { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", name, wt);
  return wt;
}

const planBody = (file: string): string => readFileSync(file, "utf-8");

// ===========================================================================
// AC-STE-609.1 — sameRepository
// ===========================================================================

describe("AC-STE-609.1 — sameRepository compares git common directories", () => {
  test("two worktrees of one repository compare equal", async () => {
    await withSpan((fx, extra) => {
      const wt = siblingWorktree(fx.a, extra);
      expect(sameRepository(fx.a, wt)).toBe(true);
      expect(sameRepository(wt, fx.a)).toBe(true);
    });
  });

  test("a nested .claude/worktrees checkout compares equal to its primary", async () => {
    await withSpan((fx) => {
      const wt = nestedWorktree(fx.a);
      expect(sameRepository(wt, fx.a)).toBe(true);
    });
  });

  test("a symlinked path to a checkout compares equal", async () => {
    await withSpan((fx, extra) => {
      const { dir } = scratch("link");
      extra.push(dir);
      const link = join(dir, "a-link");
      symlinkSync(fx.a, link);
      expect(sameRepository(link, fx.a)).toBe(true);
      expect(sameRepository(fx.a, link)).toBe(true);
    });
  });

  test("two separate clones compare unequal", async () => {
    await withSpan((fx, extra) => {
      const { dir } = scratch("clone");
      extra.push(dir);
      const clone = join(dir, "a-clone");
      git(dir, "clone", "-q", fx.a, clone);
      expect(sameRepository(fx.a, clone)).toBe(false);
      // …and the two fixture roots, two separate repositories, are unequal.
      expect(sameRepository(fx.a, fx.b)).toBe(false);
    });
  });

  test("a path that does not exist is unequal to everything, itself included, and never throws", async () => {
    await withSpan((fx) => {
      const missing = join(fx.a, "..", `${basename(fx.a)}-missing`);
      expect(sameRepository(missing, fx.a)).toBe(false);
      expect(sameRepository(fx.a, missing)).toBe(false);
      expect(sameRepository(missing, missing)).toBe(false);
    });
  });

  test("outside a git work tree it falls back to realpath equality", async () => {
    const { dir, done } = scratch("plain");
    try {
      const p = join(dir, "p");
      const q = join(dir, "q");
      mkdirSync(p);
      mkdirSync(q);
      const link = join(dir, "p-link");
      symlinkSync(p, link);
      expect(sameRepository(link, p)).toBe(true);
      expect(sameRepository(p, q)).toBe(false);
    } finally {
      done();
    }
  });

  test("resolveSpansRepos flags self by repository: an absolute path to the primary, read from a worktree, is self (red on HEAD)", async () => {
    await withSpan(async (fx, extra) => {
      makeIdle(fx);
      const wt = siblingWorktree(fx.a, extra);
      const body = [
        "---",
        `milestone: ${MILESTONE}`,
        "status: active",
        "spans_repos:",
        `  ${A_NAME}: ${real(fx.a)}`,
        `  ${B_NAME}: ${real(fx.b)}`,
        "---",
        "",
      ].join("\n");
      const states = await resolveSpansRepos({ planBody: body, milestone: MILESTONE, invokingRepo: wt });
      expect(states.find((s) => s.name === A_NAME)?.self).toBe(true);
      expect(states.find((s) => s.name === B_NAME)?.self).toBe(false);
    });
  });

  test("resolveSpansRepos flags self by repository: invoked through a symlink, the realpath entry is self (red on HEAD)", async () => {
    await withSpan(async (fx, extra) => {
      const { dir } = scratch("selflink");
      extra.push(dir);
      const link = join(dir, "a-link");
      symlinkSync(fx.a, link);
      const body = [
        "---",
        `milestone: ${MILESTONE}`,
        "status: active",
        "spans_repos:",
        `  ${A_NAME}: ${real(fx.a)}`,
        `  ${B_NAME}: ${real(fx.b)}`,
        "---",
        "",
      ].join("\n");
      const states = await resolveSpansRepos({ planBody: body, milestone: MILESTONE, invokingRepo: link });
      expect(states.find((s) => s.name === A_NAME)?.self).toBe(true);
    });
  });

  test("(control) sameRepo and routeMilestone are byte-identical to main's", () => {
    const rel = "plugins/dev-process-toolkit/adapters/_shared/src/target_repo.ts";
    const onMain = git(REPO_ROOT, "show", `main:${rel}`);
    const now = readFileSync(join(REPO_ROOT, rel), "utf-8");
    const fnSource = (src: string, sig: string): string => {
      const start = src.indexOf(sig);
      expect(start, `no \`${sig}\``).toBeGreaterThanOrEqual(0);
      const end = src.indexOf("\n}\n", start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end + 3);
    };
    for (const sig of ["export function sameRepo(", "export function routeMilestone("]) {
      expect(fnSource(now, sig)).toBe(fnSource(onMain, sig));
    }
  });

  test("(control) a target_repo naming a worktree of the invoking repository routes exactly as on HEAD", async () => {
    await withSpan((fx, extra) => {
      const wt = siblingWorktree(fx.a, extra);
      const routed = targetRepo.routeMilestone({
        planBody: ["---", `milestone: ${MILESTONE}`, `target_repo: ${wt}`, "---", ""].join("\n"),
        invokingRepo: fx.a,
      });
      // HEAD: string identity of resolved paths — a worktree is another tree,
      // and it carries the committed toolkit-managed CLAUDE.md.
      expect(routed.route).toBe("cross_repo_toolkit");
      expect(routed.repo).toBe(wt);
      expect(routed.declared).toBe(true);
    });
  });
});

// ===========================================================================
// AC-STE-609.2 — relative paths resolve from the main worktree root
// ===========================================================================

describe("AC-STE-609.2 — a relative spans_repos path resolves against the main worktree root", () => {
  /** B's root as `resolveSpansRepos` locates it from `invoking`, or null. */
  async function locateB(planFile: string, invoking: string): Promise<string | null> {
    const states = await resolveSpansRepos({
      planBody: planBody(planFile),
      milestone: MILESTONE,
      invokingRepo: invoking,
    });
    return states.find((s) => s.name === B_NAME)?.root ?? null;
  }

  test("one plan locates the same sibling root from the primary checkout", async () => {
    await withSpan(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
      const root = await locateB(plan, fx.a);
      expect(root).not.toBeNull();
      expect(real(root!)).toBe(real(fx.b));
    });
  });

  test("(control) …from a sibling-directory worktree", async () => {
    await withSpan(async (fx, extra) => {
      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
      const wt = siblingWorktree(fx.a, extra);
      const root = await locateB(plan, wt);
      expect(root).not.toBeNull();
      expect(real(root!)).toBe(real(fx.b));
    });
  });

  test("…and from a nested .claude/worktrees/<name> checkout (red on HEAD)", async () => {
    await withSpan(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
      const wt = nestedWorktree(fx.a);
      const root = await locateB(plan, wt);
      expect(root, "the nested checkout cannot locate the sibling").not.toBeNull();
      expect(real(root!)).toBe(real(fx.b));
      // …and `.` from the nested checkout is still this repository.
      const states = await resolveSpansRepos({
        planBody: planBody(plan),
        milestone: MILESTONE,
        invokingRepo: wt,
      });
      expect(states.find((s) => s.name === A_NAME)?.self).toBe(true);
    });
  });

  test("(control) a bare common directory has no main worktree: the invoking checkout is used, as on HEAD", async () => {
    await withSpan(async (fx, extra) => {
      // The bare repository sits one level deeper than the temp dir, so a
      // relative path resolved against IT would miss B; resolved against the
      // checkout (a direct child of the temp dir, like A) it finds B.
      const { dir } = scratch("bare");
      extra.push(dir);
      const bare = join(dir, "deeper", "a.git");
      mkdirSync(join(dir, "deeper"));
      git(dir, "clone", "-q", "--bare", fx.a, bare);
      const checkout = `${dir}-checkout`;
      extra.push(checkout);
      git(bare, "worktree", "add", "-q", checkout, "main");
      const porcelain = git(checkout, "worktree", "list", "--porcelain");
      expect(porcelain.split("\n").slice(0, 3)).toContain("bare");

      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
      expect(relative(checkout, fx.b)).toBe(relative(fx.a, fx.b));
      const root = await locateB(plan, checkout);
      expect(root).not.toBeNull();
      expect(real(root!)).toBe(real(fx.b));
    });
  });

  test("(control) absolute and ~ paths resolve as on HEAD, from the nested checkout too", async () => {
    await withSpan(async (fx) => {
      const wt = nestedWorktree(fx.a);
      for (const declared of [fx.b, `~/${relative(homedir(), fx.b)}`]) {
        const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(declared));
        for (const invoking of [fx.a, wt]) {
          const root = await locateB(plan, invoking);
          expect(root, `${declared} from ${invoking}`).not.toBeNull();
          expect(real(root!)).toBe(real(fx.b));
        }
      }
    });
  });

  test("(control) an invoking root outside any git work tree resolves as on HEAD", async () => {
    await withSpan(async (fx, extra) => {
      const { dir } = scratch("outside");
      extra.push(dir);
      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(dir, fx.b)));
      const root = await locateB(plan, dir);
      expect(root).not.toBeNull();
      expect(real(root!)).toBe(real(fx.b));
    });
  });
});

// ===========================================================================
// AC-STE-609.3 — exactly one entry names the invoking repository
// ===========================================================================

describe("AC-STE-609.3 — exactly one entry names the invoking repository", () => {
  /** Assert an NFR-10 three-line refusal naming every entry and what it resolved to. */
  function expectSelfCountRefusal(message: string, entries: Array<[name: string, root: string]>): void {
    const ls = message.replace(/\n+$/, "").split("\n");
    expect(ls.some((l) => l.startsWith("Refusing: ")), message).toBe(true);
    expect(ls.some((l) => l.startsWith("Remedy: ")), message).toBe(true);
    expect(ls.some((l) => l.startsWith("Context: ")), message).toBe(true);
    for (const [name, root] of entries) {
      expect(message, `the refusal does not name entry ${name}`).toContain(name);
      expect(message, `the refusal does not say what ${name} resolved to`).toContain(basename(root));
    }
  }

  async function rejectionOf(fn: () => Promise<unknown>): Promise<Error | null> {
    try {
      await fn();
      return null;
    } catch (e) {
      return e as Error;
    }
  }

  test("zero entries naming the invoking repository: resolveSpansRepos refuses in NFR-10 shape (red on HEAD)", async () => {
    await withSpan(async (fx) => {
      makeIdle(fx);
      const plan = writePlan(fx.a, "live", MILESTONE, { [B_NAME]: relative(fx.a, fx.b) });
      const e = await rejectionOf(() =>
        resolveSpansRepos({ planBody: planBody(plan), milestone: MILESTONE, invokingRepo: fx.a }),
      );
      expect(e, "a declaration naming no self entry resolved").toBeInstanceOf(SpansReposError);
      expectSelfCountRefusal(e!.message, [[B_NAME, fx.b]]);
    });
  });

  test("two entries naming the invoking repository: resolveSpansRepos refuses in NFR-10 shape (red on HEAD)", async () => {
    await withSpan(async (fx) => {
      makeIdle(fx);
      const plan = writePlan(fx.a, "live", MILESTONE, {
        [A_NAME]: ".",
        "glacy-app-fe-again": `../${basename(fx.a)}`,
        [B_NAME]: relative(fx.a, fx.b),
      });
      const e = await rejectionOf(() =>
        resolveSpansRepos({ planBody: planBody(plan), milestone: MILESTONE, invokingRepo: fx.a }),
      );
      expect(e, "a declaration naming self twice resolved").toBeInstanceOf(SpansReposError);
      expectSelfCountRefusal(e!.message, [
        [A_NAME, fx.a],
        ["glacy-app-fe-again", fx.a],
      ]);
    });
  });

  test("every reader refuses the zero-self declaration: the spans_repos CLI, refusal #4, probe #75 and the resume classifier (red on HEAD)", async () => {
    await withSpan(async (fx) => {
      makeIdle(fx);
      const plan = writePlan(fx.a, "live", MILESTONE, { [B_NAME]: relative(fx.a, fx.b) });
      fx.archivedFr(fx.a, A_FR, MILESTONE);

      const cli = runModule("adapters/_shared/src/spans_repos.ts", [plan, MILESTONE, fx.a]);
      expect(cli.status, describeRun(cli)).toBe(1);
      expect(cli.stdout, describeRun(cli)).toBe("");
      expect(cli.stderr, describeRun(cli)).toMatch(/^Refusing: /m);
      expect(cli.stderr).toContain(B_NAME);

      const gate = await siblingShipGate({
        projectRoot: fx.a,
        planBody: planBody(plan),
        milestone: MILESTONE,
        partial: false,
      });
      expect(gate.refusal, "refusal #4 passed a zero-self declaration").not.toBeNull();
      expect(gate.refusal!).toContain(B_NAME);

      expect(await rejectionOf(() => runActivePlanShipReadyProbe(fx.a))).toBeInstanceOf(
        SpansReposError,
      );
      expect(await rejectionOf(() => classifyResume(fx.a, MILESTONE))).toBeInstanceOf(
        SpansReposError,
      );
    });
  }, 30_000);

  test("a declaration pasted verbatim into the sibling (both entries resolve to self there) is refused from both roots (red on HEAD)", async () => {
    await withSpan(async (fx) => {
      // A's declaration, as A writes it: `.` and B relative to A.
      const declaration = spansFromA(relative(fx.a, fx.b));
      const aPlan = writePlan(fx.a, "live", MILESTONE, declaration);
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      // Pasted verbatim into B: from B, `.` is B and `../<B>` is B again.
      const bPlan = writePlan(fx.b, "live", MILESTONE, declaration);
      fx.archivedFr(fx.b, "STE-96093", MILESTONE);

      // Premise: from B both entries really locate B.
      const fromBStates = await rejectionOf(() =>
        resolveSpansRepos({ planBody: planBody(bPlan), milestone: MILESTONE, invokingRepo: fx.b }),
      );
      expect(fromBStates, "B's pasted declaration resolved").toBeInstanceOf(SpansReposError);
      expectSelfCountRefusal(fromBStates!.message, [
        [A_NAME, fx.b],
        [B_NAME, fx.b],
      ]);

      const fromB = await siblingShipGate({
        projectRoot: fx.b,
        planBody: planBody(bPlan),
        milestone: MILESTONE,
        partial: false,
      });
      // HEAD passes this with an EMPTY footer — both entries read as self.
      expect(fromB.refusal, `from B: footer=${JSON.stringify(fromB.footer)}`).not.toBeNull();

      const fromA = await siblingShipGate({
        projectRoot: fx.a,
        planBody: planBody(aPlan),
        milestone: MILESTONE,
        partial: false,
      });
      expect(fromA.refusal, `from A: footer=${JSON.stringify(fromA.footer)}`).not.toBeNull();
      expect(fromA.refusal!).toContain(B_NAME);
    });
  });

  test("(control) exactly one self entry resolves, self first, sibling second", async () => {
    await withSpan(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
      const states = await resolveSpansRepos({
        planBody: planBody(plan),
        milestone: MILESTONE,
        invokingRepo: fx.a,
      });
      expect(states.map((s) => [s.name, s.self])).toEqual([
        [A_NAME, true],
        [B_NAME, false],
      ]);
    });
  });
});

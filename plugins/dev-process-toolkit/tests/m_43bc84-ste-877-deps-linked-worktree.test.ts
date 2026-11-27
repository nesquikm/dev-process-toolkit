// STE-877 (M_43bc84) — deps resolve from a linked worktree.
//
// A `specs/deps.yaml` entry names its sibling as `../<name>`. Resolved
// against a linked worktree that lives under another parent directory, the
// sibling cloned beside the MAIN checkout looked missing. `resolveSiblingPath`
// now resolves against the main worktree root (first entry of
// `git worktree list --porcelain`) when the consumer root is a linked worktree,
// and keeps `resolve(consumerRepoRoot, entry.path)` everywhere else.
//
// Real git fixtures in a temp directory, invented names only:
//
//   <tmp>/side/acme-app            main checkout
//   <tmp>/side/acme-specs          the sibling, beside the main checkout
//   <tmp>/elsewhere/wt/acme-app-wt linked worktree under another parent
//
// Each fixture is torn down in a `finally`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DepsManifestShapeError,
  resolveSiblingPath,
  type DepsEntry,
} from "../adapters/_shared/src/deps_manifest";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const SIBLING = "acme-specs";
const ENTRY: DepsEntry = { name: SIBLING, path: `../${SIBLING}`, kind: "toolkit-docs" };

/** Env with every git location variable scrubbed, so an enclosing hook's GIT_DIR cannot leak in. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const k of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
    "GIT_NAMESPACE",
  ]) {
    delete env[k];
  }
  return env;
}

function git(cwd: string, ...args: string[]): string {
  const proc = spawnSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  if (proc.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString("utf-8")}`);
  }
  return proc.stdout.toString("utf-8");
}

interface Fixture {
  root: string;
  main: string;
  sibling: string;
  worktree: string;
  cleanup: () => void;
}

/** Main checkout + sibling beside it; optionally a linked worktree under a different parent. */
function makeFixture(opts: { linked: boolean }): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste-877-")));
  const side = join(root, "side");
  const main = join(side, "acme-app");
  const sibling = join(side, SIBLING);
  mkdirSync(main, { recursive: true });
  mkdirSync(join(sibling, "docs"), { recursive: true });
  writeFileSync(join(sibling, "docs", "README.md"), "# acme specs\n");
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "README.md"), "# acme app\n");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "fixture: initial");
  const worktree = join(root, "elsewhere", "wt", "acme-app-wt");
  if (opts.linked) {
    mkdirSync(join(root, "elsewhere", "wt"), { recursive: true });
    git(main, "worktree", "add", "-q", "-b", "feat/fixture", worktree);
  }
  return { root, main, sibling, worktree, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-877.1 — a linked worktree resolves against the main worktree root", () => {
  test("resolveSiblingPath(worktreeRoot, ../acme-specs) returns <main root>/../acme-specs", () => {
    const fx = makeFixture({ linked: true });
    try {
      // Anchor: the main root is the first entry of `git worktree list --porcelain`.
      const firstEntry = git(fx.worktree, "worktree", "list", "--porcelain").split("\n")[0];
      expect(firstEntry).toBe(`worktree ${fx.main}`);
      expect(resolveSiblingPath(fx.worktree, ENTRY)).toBe(join(fx.root, "side", SIBLING));
    } finally {
      fx.cleanup();
    }
  });

  test("the result is not the worktree-relative path", () => {
    const fx = makeFixture({ linked: true });
    try {
      expect(resolveSiblingPath(fx.worktree, ENTRY)).not.toBe(join(fx.root, "elsewhere", "wt", SIBLING));
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-877.2 — the main checkout and a repo with no linked worktrees are unchanged", () => {
  test("from the main checkout of a repo that has a linked worktree: resolve(main, path)", () => {
    const fx = makeFixture({ linked: true });
    try {
      expect(resolveSiblingPath(fx.main, ENTRY)).toBe(resolve(fx.main, ENTRY.path));
      expect(resolveSiblingPath(fx.main, ENTRY)).toBe(join(fx.root, "side", SIBLING));
    } finally {
      fx.cleanup();
    }
  });

  test("in a repository with no linked worktrees: resolve(root, path)", () => {
    const fx = makeFixture({ linked: false });
    try {
      expect(resolveSiblingPath(fx.main, ENTRY)).toBe(resolve(fx.main, ENTRY.path));
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-877.3 — falls back to resolve(consumerRepoRoot, path) when no main worktree is found", () => {
  test("a plain directory that is not a git repository", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ste-877-nogit-")));
    try {
      const consumer = join(root, "acme-plain");
      mkdirSync(consumer);
      expect(resolveSiblingPath(consumer, ENTRY)).toBe(resolve(consumer, ENTRY.path));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("git cannot be run (PATH without git), from a linked worktree", () => {
    const fx = makeFixture({ linked: true });
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = join(fx.root, "no-such-bin");
      let result: string | undefined;
      try {
        result = resolveSiblingPath(fx.worktree, ENTRY);
      } finally {
        process.env.PATH = savedPath;
      }
      expect(result).toBe(resolve(fx.worktree, ENTRY.path));
    } finally {
      process.env.PATH = savedPath;
      fx.cleanup();
    }
  });

  test("a linked worktree of a bare common directory", () => {
    const fx = makeFixture({ linked: false });
    try {
      const bare = join(fx.root, "bare", "acme-app.git");
      mkdirSync(join(fx.root, "bare"), { recursive: true });
      git(fx.root, "clone", "-q", "--bare", fx.main, bare);
      const wt = join(fx.root, "elsewhere", "bare-wt", "acme-app-wt");
      mkdirSync(join(fx.root, "elsewhere", "bare-wt"), { recursive: true });
      git(bare, "worktree", "add", "-q", wt, "main");
      expect(git(wt, "worktree", "list", "--porcelain")).toContain("\nbare\n");
      expect(resolveSiblingPath(wt, ENTRY)).toBe(resolve(wt, ENTRY.path));
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-877.4 — a path that does not start with ../ still throws", () => {
  test("from a linked worktree, `./acme-specs` throws DepsManifestShapeError", () => {
    const fx = makeFixture({ linked: true });
    try {
      expect(() =>
        resolveSiblingPath(fx.worktree, { name: SIBLING, path: `./${SIBLING}`, kind: "toolkit-docs" }),
      ).toThrow(DepsManifestShapeError);
    } finally {
      fx.cleanup();
    }
  });

  test("an absolute path throws DepsManifestShapeError", () => {
    expect(() =>
      resolveSiblingPath("/acme/consumer", { name: SIBLING, path: `/acme/${SIBLING}`, kind: "toolkit-docs" }),
    ).toThrow(DepsManifestShapeError);
  });
});

describe("AC-STE-877.5 — /deps list and the deps researcher see the sibling from a linked worktree", () => {
  test("the /deps list probe (existsSync of the resolved path) reads `present` from a linked worktree", () => {
    const fx = makeFixture({ linked: true });
    try {
      // The skill's local-status column: `present` when existsSync(resolveSiblingPath(...)).
      const status = existsSync(resolveSiblingPath(fx.worktree, ENTRY)) ? "present" : "missing";
      expect(status).toBe("present");
    } finally {
      fx.cleanup();
    }
  });

  test("the deps skill says the sibling path is resolved against the main checkout", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", "deps", "SKILL.md"), "utf-8");
    expect(/main checkout/i.test(text)).toBe(true);
  });

  test("the deps-researcher agent says the sibling path is resolved against the main checkout", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "agents", "deps-researcher.md"), "utf-8");
    expect(/main checkout/i.test(text)).toBe(true);
  });
});

// Phase 3 Stage A (M_43bc84 review): AC-STE-877.2 says the main checkout is
// byte-identical to today, so the main root may only be substituted inside a
// LINKED worktree. git prints canonical paths, so substituting it in the main
// checkout changes the string for a symlinked root and moves a subdirectory.
describe("AC-STE-877.2 hardening — only a linked worktree swaps in the main root", () => {
  test("the main checkout reached through a symlink keeps resolve(consumerRepoRoot, path) byte for byte", () => {
    const fx = makeFixture({ linked: true });
    try {
      const link = join(fx.root, "via-link");
      symlinkSync(fx.main, link);
      expect(resolveSiblingPath(link, ENTRY)).toBe(resolve(link, ENTRY.path));
    } finally {
      fx.cleanup();
    }
  });

  test("a subdirectory of the main checkout keeps resolve(consumerRepoRoot, path)", () => {
    const fx = makeFixture({ linked: true });
    try {
      const sub = join(fx.main, "packages");
      mkdirSync(sub);
      expect(resolveSiblingPath(sub, ENTRY)).toBe(resolve(sub, ENTRY.path));
    } finally {
      fx.cleanup();
    }
  });

  test("a subdirectory of a linked worktree resolves against the main worktree root", () => {
    const fx = makeFixture({ linked: true });
    try {
      const sub = join(fx.worktree, "packages");
      mkdirSync(sub);
      expect(resolveSiblingPath(sub, ENTRY)).toBe(join(fx.root, "side", SIBLING));
    } finally {
      fx.cleanup();
    }
  });

  test("the /deps list step no longer claims the probe does no git introspection", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", "deps", "SKILL.md"), "utf-8");
    expect(text).not.toContain("no `git` introspection");
  });
});

// Supervisor review (M_43bc84): the deps-researcher fork has Read/Grep/Glob
// only — no git, no resolveSiblingPath — so "resolved against the main
// checkout" needs a READ-ONLY mechanism it can follow. Both the agent and the
// deps-research child skill carry it, and the rule is checked against a real
// linked worktree so the prose cannot describe something git does not do.
describe("AC-STE-877.5 hardening — the read-only main-checkout derivation the fork can follow", () => {
  const AGENT = readFileSync(join(PLUGIN_ROOT, "agents", "deps-researcher.md"), "utf-8");
  const CHILD = readFileSync(join(PLUGIN_ROOT, "skills", "deps-research", "SKILL.md"), "utf-8");
  const stepWith = (text: string, n: number): string =>
    text.split("\n").find((l) => l.startsWith(`${n}. **Resolve**`)) ?? "";

  for (const [label, line] of [
    ["the deps-researcher agent's Resolve step", stepWith(AGENT, 3)],
    ["the deps-research child skill's Resolve step", stepWith(CHILD, 3)],
  ] as const) {
    test(`${label} reads <root>/.git as a file and takes its gitdir: line`, () => {
      expect(line).toContain("`<root>/.git`");
      expect(line).toContain("`gitdir:`");
    });
    test(`${label} strips /.git/worktrees/<name> to get the main checkout`, () => {
      expect(line).toContain("`/.git/worktrees/<name>`");
    });
    test(`${label} uses <root> itself when .git is a directory`, () => {
      expect(line).toMatch(/`\.git` is a directory[^.]*`<root>`/);
    });
    test(`${label} resolves ../<name> against that main checkout`, () => {
      expect(line).toContain("`../<name>`");
      expect(line).toMatch(/against (that|the) main checkout/);
    });
  }

  test("the documented rule, applied to a real linked worktree, lands on the sibling beside the main checkout", () => {
    const fx = makeFixture({ linked: true });
    try {
      const dotGit = readFileSync(join(fx.worktree, ".git"), "utf-8");
      const m = /^gitdir: (.+)$/m.exec(dotGit);
      expect(m).not.toBeNull();
      const stripped = m![1]!.trim().replace(/\/\.git\/worktrees\/[^/]+$/, "");
      expect(realpathSync(stripped)).toBe(realpathSync(fx.main));
      expect(existsSync(resolve(stripped, ENTRY.path))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// Supervisor review round 2 (M_43bc84): a `.git` FILE is not always a linked
// worktree. A submodule or a `--separate-git-dir` checkout points its gitdir
// elsewhere (`<store>/app.git`, `../.git/modules/x`); stripping nothing there
// must leave the main checkout as `<root>`, which is what the old text did.
describe("AC-STE-877.5 hardening — a .git file with no worktrees suffix keeps <root>", () => {
  const AGENT = readFileSync(join(PLUGIN_ROOT, "agents", "deps-researcher.md"), "utf-8");
  const CHILD = readFileSync(join(PLUGIN_ROOT, "skills", "deps-research", "SKILL.md"), "utf-8");
  const stepWith = (text: string): string => text.split("\n").find((l) => l.startsWith("3. **Resolve**")) ?? "";
  for (const [label, line] of [["the agent", stepWith(AGENT)], ["the child skill", stepWith(CHILD)]] as const) {
    test(`${label}: a gitdir with no trailing /.git/worktrees/<name> (submodule, --separate-git-dir) means <root>`, () => {
      expect(line).toMatch(/does not end in `\/\.git\/worktrees\/<name>`[^.]*`<root>`/);
      expect(line).toContain("submodule");
      expect(line).toContain("`--separate-git-dir`");
    });
  }

  test("the documented rule on a real --separate-git-dir checkout strips nothing and keeps <root>", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ste-877-sep-")));
    try {
      const app = join(root, "side", "acme-app");
      mkdirSync(join(root, "side", SIBLING), { recursive: true });
      mkdirSync(join(root, "store"), { recursive: true });
      mkdirSync(app, { recursive: true });
      git(app, "init", "-q", "-b", "main", "--separate-git-dir", join(root, "store", "app.git"));
      const dotGit = readFileSync(join(app, ".git"), "utf-8");
      const gitdir = /^gitdir: (.+)$/m.exec(dotGit)![1]!.trim();
      expect(/\/\.git\/worktrees\/[^/]+$/.test(gitdir)).toBe(false);
      // The rule: no worktrees suffix ⇒ the main checkout is <root> itself.
      expect(existsSync(resolve(app, ENTRY.path))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

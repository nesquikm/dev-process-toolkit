// STE-700 — both refusing gates, driven through their SHIPPED `.sh` wrappers
// the way the harness runs them (CLAUDE_PLUGIN_ROOT set, the PreToolUse JSON on
// stdin), against temporary git checkouts.
//
// Every transcript here carries NO gate-check and NO spec-review Skill call:
// the archive-only legs must pass on the change set alone (AC.4 / AC.5), and
// every forbid twin must refuse exactly as the gates refuse today (AC.6).
//
// The fixture checkouts switch `diff.renames` OFF, so a gate that leans on
// git's default rename detection sees each archive move as a delete plus an add
// and refuses the permit legs (AC.7).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyArchiveMove,
  FR_ACTIVE_PATH,
  FR_ARCHIVE_PATH,
  frArchivedText,
  frText,
  git,
  makeArchiveRepo,
  REQ_ROWS_BASE,
  REQ_ROW_NEW,
  REQUIREMENTS_PATH,
  requirementsText,
  writeAt,
} from "./_archive_only_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const COMMIT_WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh");
const PR_WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-pr-spec-review.sh");
const SID = "s-a5dc12-700";
const T = 60_000;

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "m-a5dc12-700-gate-"));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

/** A session transcript with NO Skill call at all — no gate evidence of any kind. */
function bareTranscript(): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    file,
    JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }) + "\n",
  );
  return file;
}

interface Run {
  exitCode: number;
  stderr: string;
}

async function runWrapper(wrapper: string, repo: string, command: string): Promise<Run> {
  const payload = JSON.stringify({
    session_id: SID,
    transcript_path: bareTranscript(),
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const proc = Bun.spawn(["/bin/bash", wrapper], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stderr };
}

const COMMIT_CMD = 'git commit -m "chore(specs): archive M_fx0001"';
const PR_CMD = "gh pr create --title archive --body archive";

const runCommitGate = (repo: string) => runWrapper(COMMIT_WRAPPER, repo, COMMIT_CMD);
const runPrGate = (repo: string, extra = "") =>
  runWrapper(PR_WRAPPER, repo, extra ? `${PR_CMD} ${extra}` : PR_CMD);

function expectRefused(r: Run, skill: string): void {
  expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:"), skill: r.stderr.includes(skill) }).toEqual({
    code: 2,
    refusing: true,
    skill: true,
  });
}

/**
 * Give the checkout a remote whose default branch is `main`, WITHOUT the
 * network: `refs/remotes/origin/HEAD` points at `refs/remotes/origin/main`.
 */
function setDefaultBranchMain(repo: string): void {
  git(repo, "remote", "add", "origin", "https://github.com/fixture-org/fixture-repo");
  git(repo, "update-ref", "refs/remotes/origin/main", "main");
  git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

// ---------------------------------------------------------------- forbid twins
//
// Each twin mutates a fresh base checkout and leaves the change STAGED; the PR
// legs commit it on a `feature` branch instead.

type Twin = (repo: string) => void;

const TWINS: Record<string, Twin> = {
  "archive rename staged beside a path outside specs/": (repo) => {
    applyArchiveMove(repo);
    writeAt(repo, "src/app.ts", "export const app = 2;\n");
    git(repo, "add", "-A");
  },
  "an edit to an active FR": (repo) => {
    writeAt(repo, FR_ACTIVE_PATH, frText({ summary: ["An edited active summary line."] }));
    git(repo, "add", "-A");
  },
  "an archive rename with a body edit outside the allowed set": (repo) => {
    const summary = frText().split("\n").slice(14, 22);
    summary[1] = "This sentence was rewritten during the archive.";
    applyArchiveMove(repo, frArchivedText({ summary }));
  },
  "a file added under an archive folder with no matching delete": (repo) => {
    writeAt(repo, "specs/frs/archive/FX-9.md", frArchivedText());
    git(repo, "add", "-A");
  },
  "a deletion": (repo) => {
    git(repo, "rm", "-q", FR_ACTIVE_PATH);
  },
  "a disallowed specs/requirements.md edit": (repo) => {
    applyArchiveMove(repo);
    writeAt(
      repo,
      REQUIREMENTS_PATH,
      requirementsText([REQ_ROW_NEW], "Fixture requirements, reworded."),
    );
    git(repo, "add", "-A");
  },
  "a move git reports as a delete plus an add (AC-STE-700.7)": (repo) => {
    git(repo, "rm", "-q", FR_ACTIVE_PATH);
    writeAt(
      repo,
      FR_ARCHIVE_PATH,
      Array.from({ length: 30 }, (_, i) => `entirely different line ${i}`).join("\n") + "\n",
    );
    git(repo, "add", "-A");
  },
};

// ------------------------------------------------------------ AC-STE-700.4

describe("AC-STE-700.4 — pre-commit-gate-check passes an archive-only staged set with no evidence", () => {
  test(
    "PERMIT — the archive move staged → exit 0, empty stderr, no gate-check evidence",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "commit-permit"));
      applyArchiveMove(repo);
      const r = await runCommitGate(repo);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    },
    T,
  );

  test(
    "PERMIT — a bare FR rename alone staged → exit 0, empty stderr",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "commit-permit-bare"));
      mkdirSync(join(repo, "specs", "frs", "archive"), { recursive: true });
      git(repo, "mv", FR_ACTIVE_PATH, FR_ARCHIVE_PATH);
      const r = await runCommitGate(repo);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    },
    T,
  );

  test(
    "PERMIT — only a traceability row appended to specs/requirements.md → exit 0",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "commit-permit-req"));
      writeAt(repo, REQUIREMENTS_PATH, requirementsText([...REQ_ROWS_BASE, REQ_ROW_NEW]));
      git(repo, "add", "-A");
      const r = await runCommitGate(repo);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    },
    T,
  );

  test(
    "CONTROL — an empty staged set is not archive-only → refused as today",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "commit-empty"));
      expectRefused(await runCommitGate(repo), "gate-check");
    },
    T,
  );
});

// ------------------------------------------------------------ AC-STE-700.6 (commit)

describe("AC-STE-700.6 — pre-commit-gate-check refuses every forbid twin through the .sh wrapper", () => {
  for (const [name, twin] of Object.entries(TWINS)) {
    test(
      `FORBID — ${name}`,
      async () => {
        const repo = makeArchiveRepo(join(tmpRoot, "commit-twin"));
        twin(repo);
        expectRefused(await runCommitGate(repo), "gate-check");
      },
      T,
    );
  }
});

// ------------------------------------------------------------ AC-STE-700.5

describe("AC-STE-700.5 — pre-pr-spec-review passes an archive-only branch diff with no evidence", () => {
  test(
    "PERMIT — no --base: the default branch (main) is the base → exit 0",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "pr-permit-default"));
      setDefaultBranchMain(repo);
      git(repo, "checkout", "-q", "-b", "feature");
      applyArchiveMove(repo);
      git(repo, "commit", "-q", "-m", "chore: archive");
      const r = await runPrGate(repo);
      expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:") }).toEqual({
        code: 0,
        refusing: false,
      });
    },
    T,
  );

  test(
    "PERMIT — the default branch moved on after the branch point: merge-base, not the tip → exit 0",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "pr-permit-moved"));
      git(repo, "checkout", "-q", "-b", "feature");
      applyArchiveMove(repo);
      git(repo, "commit", "-q", "-m", "chore: archive");
      git(repo, "checkout", "-q", "main");
      writeAt(repo, "src/app.ts", "export const app = 2;\n");
      git(repo, "commit", "-q", "-am", "feat: main moves on");
      setDefaultBranchMain(repo);
      git(repo, "checkout", "-q", "feature");
      const r = await runPrGate(repo);
      expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:") }).toEqual({
        code: 0,
        refusing: false,
      });
    },
    T,
  );

  // `develop` carries a non-spec commit on top of `main`; `feature` branches
  // from `develop` and holds only the archive move. Against `develop` the diff
  // is archive-only; against the default branch `main` it is not.
  function stackedRepo(name: string): string {
    const repo = makeArchiveRepo(join(tmpRoot, name));
    setDefaultBranchMain(repo);
    git(repo, "checkout", "-q", "-b", "develop");
    writeAt(repo, "src/app.ts", "export const app = 5;\n");
    git(repo, "commit", "-q", "-am", "feat: develop work");
    git(repo, "checkout", "-q", "-b", "feature");
    applyArchiveMove(repo);
    git(repo, "commit", "-q", "-m", "chore: archive");
    return repo;
  }

  test(
    "PERMIT — `--base develop` is honoured → exit 0",
    async () => {
      const repo = stackedRepo("pr-permit-base");
      const r = await runPrGate(repo, "--base develop");
      expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:") }).toEqual({
        code: 0,
        refusing: false,
      });
    },
    T,
  );

  test(
    "FORBID — the SAME checkout with no --base diffs against the default branch → refused",
    async () => {
      const repo = stackedRepo("pr-forbid-default");
      expectRefused(await runPrGate(repo), "spec-review");
    },
    T,
  );

  test(
    "FORBID — the SAME checkout with `--base main` → refused",
    async () => {
      const repo = stackedRepo("pr-forbid-main");
      expectRefused(await runPrGate(repo, "--base main"), "spec-review");
    },
    T,
  );
});

// ------------------------------------------------------------ AC-STE-700.6 (PR)

describe("AC-STE-700.6 — pre-pr-spec-review refuses every forbid twin through the .sh wrapper", () => {
  for (const [name, twin] of Object.entries(TWINS)) {
    test(
      `FORBID — ${name}`,
      async () => {
        const repo = makeArchiveRepo(join(tmpRoot, "pr-twin"));
        setDefaultBranchMain(repo);
        git(repo, "checkout", "-q", "-b", "feature");
        twin(repo);
        git(repo, "commit", "-q", "-m", "chore: twin");
        expectRefused(await runPrGate(repo), "spec-review");
      },
      T,
    );
  }
});

// ------------------------------------------------------------ AC-STE-700.4 [hardening]
//
// The archive-only pass grades the INDEX. A commit form that pulls working-tree
// content in (`-a`, a pathspec) would commit more than the graded set. Decided
// rule: the pass requires the tracked working tree to match the index (no
// unstaged change to a tracked file), so no commit form can widen it.

describe("AC-STE-700.4 [hardening] — the archive-only pass cannot carry content outside the staged set", () => {
  /** The permitted archive move staged, plus a tracked source file modified but NOT staged. */
  function dirtyRepo(name: string): string {
    const repo = makeArchiveRepo(join(tmpRoot, name));
    applyArchiveMove(repo);
    writeAt(repo, "src/app.ts", "export const app = 42;\n");
    return repo;
  }

  test(
    "AC-STE-700.4 [hardening] FORBID — unstaged tracked edit + `git commit -a` → refused, names gate-check",
    async () => {
      const repo = dirtyRepo("h1-commit-a");
      expectRefused(await runWrapper(COMMIT_WRAPPER, repo, 'git commit -a -m "x"'), "gate-check");
    },
    T,
  );

  test(
    "AC-STE-700.4 [hardening] FORBID — unstaged tracked edit + `git commit -m x src/app.ts` (pathspec) → refused",
    async () => {
      const repo = dirtyRepo("h1-commit-pathspec");
      expectRefused(await runWrapper(COMMIT_WRAPPER, repo, 'git commit -m "x" src/app.ts'), "gate-check");
    },
    T,
  );

  test(
    "AC-STE-700.4 [hardening] FORBID — unstaged tracked edit + plain `git commit -m x` → refused (working tree must match the index)",
    async () => {
      const repo = dirtyRepo("h1-commit-plain");
      expectRefused(await runWrapper(COMMIT_WRAPPER, repo, 'git commit -m "x"'), "gate-check");
    },
    T,
  );

  test(
    "AC-STE-700.4 [hardening] PERMIT CONTROL — clean working tree + `git commit -a` → exit 0, empty stderr",
    async () => {
      const repo = makeArchiveRepo(join(tmpRoot, "h1-commit-a-clean"));
      applyArchiveMove(repo);
      const r = await runWrapper(COMMIT_WRAPPER, repo, 'git commit -a -m "x"');
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    },
    T,
  );
});

// ===========================================================================
// AC-STE-700.5 [security] — the PR pass grades the branch the request opens
// ===========================================================================

describe("AC-STE-700.5 [security] — a request naming another head, or a flag-shaped base, gets no archive-only pass", () => {
  /** `feature` (checked out) holds only the archive move; `feature-with-code` holds a source change. */
  function headRepo(name: string): string {
    const repo = makeArchiveRepo(join(tmpRoot, name));
    setDefaultBranchMain(repo);
    git(repo, "checkout", "-q", "-b", "feature-with-code");
    writeAt(repo, "src/app.ts", "export const app = 7;\n");
    git(repo, "commit", "-q", "-am", "feat: real code");
    git(repo, "checkout", "-q", "main");
    git(repo, "checkout", "-q", "-b", "feature");
    applyArchiveMove(repo);
    git(repo, "commit", "-q", "-m", "chore: archive");
    return repo;
  }

  test(
    "AC-STE-700.5 [security] S3 FORBID — `gh pr create --head feature-with-code` from an archive-only checkout → refused, names spec-review",
    async () => {
      const repo = headRepo("s3-head-long");
      expectRefused(
        await runWrapper(PR_WRAPPER, repo, "gh pr create --head feature-with-code --title t --body b"),
        "spec-review",
      );
    },
    T,
  );

  test(
    "AC-STE-700.5 [security] S3 FORBID — `gh pr create -H feature-with-code` from an archive-only checkout → refused, names spec-review",
    async () => {
      const repo = headRepo("s3-head-short");
      expectRefused(
        await runWrapper(PR_WRAPPER, repo, "gh pr create -H feature-with-code --title t --body b"),
        "spec-review",
      );
    },
    T,
  );

  test(
    "AC-STE-700.5 [security] S3 PERMIT CONTROL — the same checkout with no --head → exit 0",
    async () => {
      const repo = headRepo("s3-control");
      const r = await runWrapper(PR_WRAPPER, repo, "gh pr create --title t --body b");
      expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:") }).toEqual({ code: 0, refusing: false });
    },
    T,
  );

  test(
    "AC-STE-700.5 [security] S4 FORBID — `--base=--output=<path>` → refused for missing evidence, and no file is written at <path>",
    async () => {
      const repo = headRepo("s4-dash-base");
      const target = join(tmpRoot, "s4-output-probe");
      const r = await runWrapper(PR_WRAPPER, repo, `gh pr create --base=--output=${target} --title t --body b`);
      expectRefused(r, "spec-review");
      expect(existsSync(target)).toBe(false);
    },
    T,
  );

  test(
    "AC-STE-700.5 [security] S4 FORBID — a flag-shaped base given as a separate word (`--base --output=<path>`) → refused, no file written",
    async () => {
      const repo = headRepo("s4-dash-base-sep");
      const target = join(tmpRoot, "s4-output-probe-sep");
      const r = await runWrapper(PR_WRAPPER, repo, `gh pr create --base --output=${target} --title t --body b`);
      expectRefused(r, "spec-review");
      expect(existsSync(target)).toBe(false);
    },
    T,
  );
});

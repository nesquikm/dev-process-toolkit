import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupBootstrapCommitSubjectProbe } from "../adapters/_shared/src/setup_bootstrap_commit_subject";

// STE-873 — probe #30 grades the most recent NON-MERGE commit whose own
// SUBJECT starts with the bootstrap prefix. A commit that carries the prefix
// only in its body (a merge that quotes it, a note that mentions it) is never
// graded.
//
// Every fixture is a real git repository in a temp directory. Commit dates
// are fixed and strictly increasing, so "most recent" is deterministic.

const CANONICAL = "chore: bootstrap dev-process-toolkit";
const SUFFIXED = "chore: bootstrap dev-process-toolkit (v0.1.0)";
const MERGE_SUBJECT = "Merge branch 'side'";
const VALID_FOOTER = "Toolkit: dev-process-toolkit v3.11.0";

// All after the probe's 2026-05-01 ship-date cutoff unless a test says otherwise.
const POST_CUTOFF_BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const PRE_CUTOFF_DATE = "2026-01-15T00:00:00Z";

// Each merge fixture spawns about ten git processes; bun's 5 s default is too
// tight under a full-suite run.
setDefaultTimeout(60_000);

const roots: string[] = [];
let tick = 0;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function nextDate(): string {
  tick += 1;
  return new Date(POST_CUTOFF_BASE_MS + tick * 60_000).toISOString();
}

// The fixtures never read the developer's own git configuration: a global
// hooks path, merge setting or signing rule must not change what they build.
const ISOLATED_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, args: string[], date?: string): string {
  const env =
    date === undefined
      ? { ...process.env, ...ISOLATED_GIT_ENV }
      : { ...process.env, ...ISOLATED_GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  return execFileSync("git", args, { cwd, encoding: "utf-8", env, timeout: 30_000 }).trim();
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ste-873-bootstrap-"));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

let fileCounter = 0;

/** One ordinary (non-merge) commit. Returns its full SHA. */
function commit(
  root: string,
  subject: string,
  body: string,
  date: string = nextDate(),
): string {
  fileCounter += 1;
  const name = `file-${fileCounter}.txt`;
  writeFileSync(join(root, name), `content ${fileCounter}\n`);
  git(root, ["add", name]);
  const msgPath = join(root, ".git", "STE873_MSG");
  writeFileSync(msgPath, body === "" ? `${subject}\n` : `${subject}\n\n${body}\n`);
  git(root, ["commit", "-q", "-F", msgPath], date);
  return git(root, ["rev-parse", "HEAD"]);
}

/** A side branch with one commit, merged into main with `--no-ff`. Returns the merge SHA. */
function mergeSideBranch(root: string, mergeBody: string): string {
  git(root, ["checkout", "-q", "-b", "side"]);
  commit(root, "feat: add a side file", "");
  git(root, ["checkout", "-q", "main"]);
  git(
    root,
    ["merge", "--no-ff", "-q", "-m", MERGE_SUBJECT, "-m", mergeBody, "side"],
    nextDate(),
  );
  const parents = git(root, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
  // Fixture self-check: HEAD really is a two-parent merge.
  expect(parents.length).toBe(3);
  return parents[0]!;
}

/** Which commit each violation points at, and whether its text names `subject`. */
async function graded(
  root: string,
  subject: string,
): Promise<{ file: string; namesSubject: boolean }[]> {
  const report = await runSetupBootstrapCommitSubjectProbe(root);
  return report.violations.map((v) => ({
    file: v.file,
    namesSubject: v.message.includes(`observed=\`${subject}\``),
  }));
}

describe("AC-STE-873.1 — the selected commit is the most recent non-merge commit whose subject starts with the prefix", () => {
  test("AC-STE-873.1 — a newer non-merge commit that quotes the prefix in its body does not displace the bootstrap commit", async () => {
    const root = makeRepo();
    commit(root, CANONICAL, `Initial scaffold.\n\n${VALID_FOOTER}`);
    commit(
      root,
      "docs: note how the project was bootstrapped",
      `The first commit of this project is:\n${CANONICAL}`,
    );

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });

  test("AC-STE-873.1 — a newer non-merge commit that quotes the prefix and a bad footer in its body is not graded", async () => {
    const root = makeRepo();
    commit(root, CANONICAL, `Initial scaffold.\n\n${VALID_FOOTER}`);
    commit(
      root,
      "docs: quote the bootstrap message",
      `${CANONICAL}\nToolkit: dev-process-toolkit v<unknown>`,
    );

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });

  test("AC-STE-873.1 — of two subject-matching commits, the newer one is graded: older suffixed, newer canonical passes", async () => {
    const root = makeRepo();
    commit(root, SUFFIXED, "Initial scaffold.");
    commit(root, CANONICAL, `Scaffold again.\n\n${VALID_FOOTER}`);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });

  test("AC-STE-873.1 — of two subject-matching commits, the newer one is graded: older canonical, newer suffixed fails on the newer", async () => {
    const root = makeRepo();
    commit(root, CANONICAL, `Initial scaffold.\n\n${VALID_FOOTER}`);
    const newer = commit(root, SUFFIXED, "Scaffold again.");

    expect(await graded(root, SUFFIXED)).toEqual([{ file: newer, namesSubject: true }]);
  });

  test("AC-STE-873.1 — a body-only quote newer than two subject-matching commits still leaves the newer subject match graded", async () => {
    const root = makeRepo();
    commit(root, CANONICAL, `Initial scaffold.\n\n${VALID_FOOTER}`);
    const newer = commit(root, SUFFIXED, "Scaffold again.");
    commit(root, "docs: quote the bootstrap subject", CANONICAL);

    expect(await graded(root, SUFFIXED)).toEqual([{ file: newer, namesSubject: true }]);
  });
});

describe("AC-STE-873.2 — Regression: a merge that quotes the bootstrap subject is not graded", () => {
  test("AC-STE-873.2 — canonical bootstrap commit plus a newer merge whose body is the bootstrap subject line reports zero violations", async () => {
    const root = makeRepo();
    commit(root, CANONICAL, `Initial scaffold.\n\n${VALID_FOOTER}`);
    mergeSideBranch(root, CANONICAL);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });
});

describe("AC-STE-873.3 — a prefix that appears only in a commit body is vacuous", () => {
  test("AC-STE-873.3 — the only match is the body of an ordinary commit: zero violations", async () => {
    const root = makeRepo();
    commit(root, "feat: first commit", "No toolkit here.");
    commit(root, "docs: describe the setup step", `Run setup, which commits:\n${CANONICAL}`);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });

  test("AC-STE-873.3 — the only match is the body of a merge commit: zero violations", async () => {
    const root = makeRepo();
    commit(root, "feat: first commit", "No toolkit here.");
    mergeSideBranch(root, CANONICAL);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });
});

describe("AC-STE-873.4 — Unchanged: the subject, footer and ship-date rules still apply to the selected commit", () => {
  test("AC-STE-873.4 — a bootstrap subject with a parenthesised suffix still fails", async () => {
    const root = makeRepo();
    const sha = commit(root, SUFFIXED, "Initial scaffold.");

    expect(await graded(root, SUFFIXED)).toEqual([{ file: sha, namesSubject: true }]);
  });

  test("AC-STE-873.4 — a malformed Toolkit: footer on the selected commit still fails", async () => {
    const root = makeRepo();
    const sha = commit(
      root,
      CANONICAL,
      "Initial scaffold.\n\nToolkit: dev-process-toolkit v<unknown>",
    );

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(
      report.violations.map((v) => ({
        file: v.file,
        namesLine: v.message.includes(
          "malformed_line=`Toolkit: dev-process-toolkit v<unknown>`",
        ),
      })),
    ).toEqual([{ file: sha, namesLine: true }]);
  });

  test("AC-STE-873.4 — a suffixed bootstrap commit authored before 2026-05-01 still passes vacuously", async () => {
    const root = makeRepo();
    commit(root, SUFFIXED, "Initial scaffold.", PRE_CUTOFF_DATE);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });

  test("AC-STE-873.4 — a suffixed bootstrap commit still fails, and is the one named, when a newer merge quotes the canonical subject", async () => {
    const root = makeRepo();
    const bootstrap = commit(root, SUFFIXED, "Initial scaffold.");
    mergeSideBranch(root, CANONICAL);

    expect(await graded(root, SUFFIXED)).toEqual([{ file: bootstrap, namesSubject: true }]);
  });

  test("AC-STE-873.4 — the ship-date carve-out reads the selected commit's date, not a newer merge's", async () => {
    const root = makeRepo();
    commit(root, SUFFIXED, "Initial scaffold.", PRE_CUTOFF_DATE);
    mergeSideBranch(root, CANONICAL);

    const report = await runSetupBootstrapCommitSubjectProbe(root);

    expect(report.violations.map((v) => v.reason)).toEqual([]);
  });
});

describe("AC-STE-873.4 — hardening: the selection does not depend on the repository's grep settings", () => {
  for (const patternType of ["fixed", "extended", "perl"]) {
    test(`AC-STE-873.4 — under grep.patternType=${patternType} a suffixed bootstrap subject still fails`, async () => {
      const root = makeRepo();
      const sha = commit(root, SUFFIXED, "Initial scaffold.");
      git(root, ["config", "grep.patternType", patternType]);

      expect(await graded(root, SUFFIXED)).toEqual([{ file: sha, namesSubject: true }]);
    });
  }
});

// STE-720 (M_d1b4b7) AC.4, front-door half — where `ctx.branches` comes from.
//
// The front door builds the branch list from `git for-each-ref
// --format='%(refname:lstrip=2)' refs/heads refs/remotes` in the project root
// (remote name stripped), plus every `gitBranch` / `git_branch` value in the
// files being scrubbed. Each case runs the front door as a subprocess on a
// temp working directory against a temp git repo.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  OTHER_BRANCH,
  REMOTE_ONLY_BRANCH,
  branchAlias,
  cleanupTemps,
  makeRepo,
  runFrontDoor,
  sevenSecretRows,
  SECRET_KEYS,
  tempDir,
} from "./_m_d1b4b7_ste720_fixture";

afterAll(cleanupTemps);

function workdir(label: string, report: string, transcript: string | null): string {
  const dir = tempDir(label);
  writeFileSync(join(dir, "report.md"), report);
  writeFileSync(join(dir, "metadata.json"), `${JSON.stringify({ redaction_summary: sevenSecretRows(SECRET_KEYS) }, null, 2)}\n`);
  if (transcript !== null) writeFileSync(join(dir, "transcript.jsonl"), transcript);
  return dir;
}

const read = (dir: string, f: string): string => readFileSync(join(dir, f), "utf-8");

describe("AC-STE-720.4 branch sources of the front door", () => {
  test("a branch that exists only as a local ref, never checked out, is rewritten where a command names it", () => {
    const repo = makeRepo("src-local-repo", { branches: [OTHER_BRANCH] });
    const dir = workdir("src-local-work", `$ git push origin ${OTHER_BRANCH}\n$ git log ${OTHER_BRANCH}\n`, null);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
    const h = branchAlias(OTHER_BRANCH);
    expect(read(dir, "report.md")).toBe(`$ git push origin ${h}\n$ git log ${h}\n`);
  });

  test("CONTROL: the same text in a repo without that ref is left alone (the rewrite comes from the ref)", () => {
    const repo = makeRepo("src-noref-repo");
    const text = `$ git push origin ${OTHER_BRANCH}\n`;
    const dir = workdir("src-noref-work", text, null);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    expect(read(dir, "report.md")).toBe(text);
  });

  test("a remote-tracking ref counts with its remote name stripped: refs/remotes/origin/feat/remote-fixture rewrites feat/remote-fixture", () => {
    const repo = makeRepo("src-remote-repo", { remoteBranches: [REMOTE_ONLY_BRANCH] });
    const dir = workdir("src-remote-work", `$ git checkout ${REMOTE_ONLY_BRANCH}\nseen at origin/${REMOTE_ONLY_BRANCH}\n`, null);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    const h = branchAlias(REMOTE_ONLY_BRANCH);
    expect(read(dir, "report.md")).toBe(`$ git checkout ${h}\nseen at origin/${h}\n`);
  });

  test("a gitBranch field in the transcript supplies a branch no ref holds, and it is rewritten in every file", () => {
    const repo = makeRepo("src-field-repo");
    const transcript = `${JSON.stringify({ type: "user", gitBranch: BRANCH, message: "x" })}\n`;
    const dir = workdir("src-field-work", `worked on ${BRANCH} today\n`, transcript);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    const h = branchAlias(BRANCH);
    expect(read(dir, "report.md")).toBe(`worked on ${h} today\n`);
    expect(JSON.parse(read(dir, "transcript.jsonl").split("\n")[0]!).gitBranch).toBe(h);
  });

  test("a git_branch field supplies a branch the same way", () => {
    const repo = makeRepo("src-field2-repo");
    const transcript = `${JSON.stringify({ type: "row", git_branch: OTHER_BRANCH })}\n`;
    const dir = workdir("src-field2-work", `merged ${OTHER_BRANCH}\n`, transcript);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    const h = branchAlias(OTHER_BRANCH);
    expect(read(dir, "report.md")).toBe(`merged ${h}\n`);
    expect(JSON.parse(read(dir, "transcript.jsonl").split("\n")[0]!).git_branch).toBe(h);
  });

  test("main stays main even though for-each-ref lists it", () => {
    const repo = makeRepo("src-main-repo");
    const text = "$ git checkout main\n(HEAD -> main, origin/main)\n";
    const dir = workdir("src-main-work", text, null);
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    expect(read(dir, "report.md")).toBe(text);
  });
});

// STE-720 (M_d1b4b7) AC.6 and AC.7 — the privacy guard on the payload front
// door `bun run adapters/_shared/src/report_issue_payload.ts <workdir>
// <projectRoot> (--redact-identifiers | --from-retro)`.
//
// The working directory holds `report.md` (git log + status text),
// `metadata.json` (seven secret rows) and `transcript.jsonl`, all seeded with
// synthetic home paths, a project-folder slug for `fixture-user`, synthetic
// UUIDs and a synthetic branch. The project root is a temp git repo that has
// the branches as refs. Each run is a subprocess.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  OTHER_BRANCH,
  SECRET_KEYS,
  cleanupTemps,
  leaks,
  makeRepo,
  predFrontDoorSharedMap,
  runFrontDoor,
  secretsMod,
  seedWorkdir,
  sevenSecretRows,
} from "./_m_d1b4b7_ste720_fixture";

afterAll(cleanupTemps);

const RUNS: { label: string; flags: string[] }[] = [
  { label: "redact", flags: ["--redact-identifiers"] },
  { label: "retro", flags: ["--from-retro"] },
  { label: "both", flags: ["--redact-identifiers", "--from-retro"] },
];

const FILES = ["report.md", "metadata.json", "transcript.jsonl"];

describe("AC-STE-720.6 privacy guard: no identifier survives a flagged run", () => {
  for (const { label, flags } of RUNS) {
    test(`${flags.join(" ")}: exit 0, and no file contains /Users/, /home/, -Users-fixture, -home-fixture, a UUID or the branch name`, () => {
      const repo = makeRepo(`priv-${label}-repo`, { branches: [BRANCH, OTHER_BRANCH] });
      const { dir } = seedWorkdir(`priv-${label}-work`);
      // Control: the seeds really carry every leak class before the run.
      const seeded = FILES.map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
      for (const cls of ["/Users/", "/home/", "-Users-fixture", "uuid:", `branch:${BRANCH}`, `branch:${OTHER_BRANCH}`]) {
        expect(leaks(seeded).some((l) => l.startsWith(cls)), `seed carries ${cls}`).toBe(true);
      }
      const r = runFrontDoor(dir, repo, flags);
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
      for (const f of FILES) {
        const text = readFileSync(join(dir, f), "utf-8");
        expect({ file: f, leaks: leaks(text) }).toEqual({ file: f, leaks: [] });
      }
    });
  }

  test("--redact-identifiers: one session keeps one alias across report.md and transcript.jsonl", () => {
    const repo = makeRepo("priv-alias-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = seedWorkdir("priv-alias-work");
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
    const firstLine = JSON.parse(readFileSync(join(dir, "transcript.jsonl"), "utf-8").split("\n")[0]!);
    expect(firstLine.sessionId).toMatch(/^s[1-9]\d*$/);
    const report = readFileSync(join(dir, "report.md"), "utf-8");
    expect(report).toContain(`Session ${firstLine.sessionId} wrote ~/.claude/projects/-~`);
    expect(report).toContain(`/${firstLine.sessionId}.jsonl`);
  });

  test("--redact-identifiers: one alias map serves the whole report: metadata.json's uuid(2) marker carries transcript line 2's alias, distinct from line 1's", () => {
    const repo = makeRepo("priv-map-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = seedWorkdir("priv-map-work");
    expect(runFrontDoor(dir, repo, ["--redact-identifiers"]).status).toBe(0);
    expect(predFrontDoorSharedMap(dir)).toBe(true);
  });

  test("the scrubbed files keep their shape: metadata.json is JSON, every transcript line is JSON", () => {
    const repo = makeRepo("priv-shape-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = seedWorkdir("priv-shape-work");
    expect(runFrontDoor(dir, repo, ["--redact-identifiers"]).status).toBe(0);
    expect(() => JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"))).not.toThrow();
    const lines = readFileSync(join(dir, "transcript.jsonl"), "utf-8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(typeof JSON.parse(l)).toBe("object");
  });
});

describe("AC-STE-720.7 redaction_summary: seven secret rows, then three identifier rows", () => {
  test("the fixture's seven secret keys are SECRET_PATTERNS' keys, in order", async () => {
    const { SECRET_PATTERNS } = await secretsMod();
    expect(SECRET_PATTERNS.map((p: any) => p.key)).toEqual([...SECRET_KEYS]);
  });

  for (const { label, flags } of RUNS) {
    test(`${flags.join(" ")}: the seven seeded rows stay in order and home_path, session_id, branch_name follow with the seeded counts`, () => {
      const repo = makeRepo(`sum-${label}-repo`, { branches: [BRANCH, OTHER_BRANCH] });
      const { dir, expected } = seedWorkdir(`sum-${label}-work`);
      const r = runFrontDoor(dir, repo, flags);
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
      const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
      expect(meta.redaction_summary).toEqual([
        ...sevenSecretRows(SECRET_KEYS),
        { pattern: "home_path", count: expected.home_path },
        { pattern: "session_id", count: expected.session_id },
        { pattern: "branch_name", count: expected.branch_name },
      ]);
      expect(meta.redaction_summary.length).toBe(10);
    });
  }
});

// STE-720 (M_d1b4b7) AC.13 — default byte identity.
//
// No /report-issue modeller exists, so the default path is graded on the
// shipped text (every sentence naming the front door names a flag, so a run
// with neither flag issues no front-door call) and on the shipped front door
// (with neither flag it refuses in NFR-10 shape, exits 1 with empty stdout and
// leaves every file byte-identical). Two spies prove nothing ran: a `git` shim
// on PATH logs every git call, and a bun preload wraps `scrubIdentifiers` to
// log every call. Each spy has a positive control under `--redact-identifiers`.
// Last, a settings file carrying a `report_issue` section is refused by the
// loader, so no settings path can turn the pass on.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  OTHER_BRANCH,
  SKILL_PATH,
  cleanupTemps,
  gitShim,
  logLines,
  makeRepo,
  predNoFlagRefusal,
  runFrontDoor,
  scrubSpyPreload,
  seedWorkdir,
  sentencesNaming,
  snapshot,
  tempDir,
  unflaggedFrontDoorMentions,
} from "./_m_d1b4b7_ste720_fixture";

afterAll(cleanupTemps);

describe("AC-STE-720.13 the shipped text: a run with neither flag issues no front-door call", () => {
  test("SKILL.md names the front door, and every sentence that names report_issue_payload.ts names --redact-identifiers or --from-retro", () => {
    const text = readFileSync(SKILL_PATH, "utf-8");
    expect(sentencesNaming(text, "report_issue_payload.ts").length).toBeGreaterThan(0);
    expect(unflaggedFrontDoorMentions(text)).toEqual([]);
  });
});

describe("AC-STE-720.13 the shipped front door with neither flag", () => {
  test("refuses in NFR-10 shape, exits 1, prints nothing on stdout, and leaves every file (metadata.json's seven rows included) byte-identical", () => {
    const repo = makeRepo("noflag-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = seedWorkdir("noflag-work");
    const before = snapshot(dir);
    expect(JSON.parse(before["metadata.json"]!).redaction_summary.length).toBe(7);
    const r = runFrontDoor(dir, repo, []);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/Remedy: /);
    expect(r.stderr).toMatch(/Context: /);
    expect(r.stderr).toMatch(/--redact-identifiers/);
    expect(snapshot(dir)).toEqual(before);
    expect(predNoFlagRefusal(r, before, snapshot(dir))).toBe(true);
  });

  test("CONTROL: the shipped front door exists, so the refusal above is its own and not a missing-module error", () => {
    const repo = makeRepo("noflag-ctl-repo");
    const { dir } = seedWorkdir("noflag-ctl-work");
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"]);
    expect(r.status).toBe(0);
  });

  test("spy: no git command runs with neither flag; the same shim records for-each-ref under --redact-identifiers", () => {
    const repo = makeRepo("spy-git-repo", { branches: [BRANCH] });
    const off = gitShim("spy-git-off");
    const { dir } = seedWorkdir("spy-git-off-work");
    const r = runFrontDoor(dir, repo, [], { env: off.env });
    expect(r.status).toBe(1);
    expect(logLines(off.log)).toEqual([]);

    const on = gitShim("spy-git-on");
    const { dir: dir2 } = seedWorkdir("spy-git-on-work");
    const r2 = runFrontDoor(dir2, repo, ["--redact-identifiers"], { env: on.env });
    expect(r2.status).toBe(0);
    expect(logLines(on.log).some((l) => l.includes("for-each-ref"))).toBe(true);
  });

  test("spy: scrubIdentifiers is never called with neither flag; the same spy records calls under --redact-identifiers", () => {
    const repo = makeRepo("spy-scrub-repo", { branches: [BRANCH] });
    const off = scrubSpyPreload("spy-scrub-off");
    const { dir } = seedWorkdir("spy-scrub-off-work");
    const before = snapshot(dir);
    const r = runFrontDoor(dir, repo, [], { preload: off.preload });
    expect(r.status).toBe(1);
    expect(logLines(off.log)).toEqual([]);
    expect(snapshot(dir)).toEqual(before);

    const on = scrubSpyPreload("spy-scrub-on");
    const { dir: dir2 } = seedWorkdir("spy-scrub-on-work");
    const r2 = runFrontDoor(dir2, repo, ["--redact-identifiers"], { preload: on.preload });
    expect({ status: r2.status, stderr: r2.stderr }).toEqual({ status: 0, stderr: r2.stderr });
    // One call per payload file at least (report.md, metadata.json, transcript.jsonl).
    expect(logLines(on.log).length).toBeGreaterThanOrEqual(3);
  });
});

describe("AC-STE-720.13 no settings path turns the pass on", () => {
  test("a settings file holding report_issue: { identifier_redaction: { enabled: true } } is refused by the loader as an unknown top-level key", async () => {
    const m = (await import("../adapters/_shared/src/project_settings")) as Record<string, any>;
    const root = tempDir("settings-ri");
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(
      join(root, "specs", "settings.yaml"),
      'schema_version: 1\nmin_dpt_version: "3.0.0"\nreport_issue:\n  identifier_redaction:\n    enabled: true\n',
    );
    writeFileSync(join(root, "CLAUDE.md"), "<!-- generated by /dev-process-toolkit:setup -->\n# P\n");
    let err: unknown = null;
    try {
      m.loadProjectSettings(root);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("report_issue");
  });

  test("CONTROL: the same file without the report_issue section loads", async () => {
    const m = (await import("../adapters/_shared/src/project_settings")) as Record<string, any>;
    const root = tempDir("settings-ok");
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), 'schema_version: 1\nmin_dpt_version: "3.0.0"\n');
    writeFileSync(join(root, "CLAUDE.md"), "<!-- generated by /dev-process-toolkit:setup -->\n# P\n");
    expect(m.loadProjectSettings(root).source).toBe("settings");
  });
});

// STE-721 (M_d1b4b7) AC.7 and the front-door half of AC.12 — `retro.json` in
// the payload, through `report_issue_payload.ts`.
//
// AC.7: a working directory holding a seeded `retro.json` passes the STE-720
// privacy test unchanged under `--from-retro` WITHOUT `--redact-identifiers`:
// no file, `retro.json` included, carries `/Users/`, `/home/`, a UUID-shaped
// token or a fixture branch name. And the front door seeds its alias map from
// `retro.json`'s `sessions` (seedAliasMap) before it scrubs: with `s1` = the
// digest of uuid(1) (A), a transcript holding uuid(2) (B) first and then A
// reads `s2` for B and `s1` for A.
//
// AC.12 (front door): given neither flag, the front door refuses and leaves a
// working directory that holds `retro.json` byte-identical.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BRANCH, OTHER_BRANCH, cleanupTemps, leaks, makeRepo, predNoFlagRefusal, runFrontDoor, snapshot, uuid } from "./_m_d1b4b7_ste720_fixture";
import { PAYLOAD_FILES, predFromRetroPrivacy, predRetroScrubbed, predSeededAliases, reportMod, seedAliasWorkdir, seedRetroWorkdir } from "./_m_d1b4b7_ste721_fixture";

afterAll(cleanupTemps);

describe("AC-STE-721.7 retro.json passes the STE-720 privacy test without --redact-identifiers", () => {
  test("CONTROL: the seeded retro.json is a valid report and carries home paths and both fixture branches", async () => {
    const { parseRetroReport } = await reportMod();
    const { retroBefore } = await seedRetroWorkdir("ctl");
    expect(() => parseRetroReport(retroBefore)).not.toThrow();
    const l = leaks(retroBefore);
    for (const cls of ["/Users/", "/home/", `branch:${BRANCH}`, `branch:${OTHER_BRANCH}`]) expect({ cls, seeded: l.includes(cls) }).toEqual({ cls, seeded: true });
  });

  test("--from-retro alone: exit 0, and none of report.md, metadata.json, transcript.jsonl, retro.json carries /Users/, /home/, a UUID or a fixture branch", async () => {
    const repo = makeRepo("721-priv-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = await seedRetroWorkdir("priv");
    const r = runFrontDoor(dir, repo, ["--from-retro"]);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
    for (const f of PAYLOAD_FILES) {
      expect({ file: f, leaks: leaks(readFileSync(join(dir, f), "utf-8")) }).toEqual({ file: f, leaks: [] });
    }
    expect(predFromRetroPrivacy(dir)).toBe(true);
    expect(predRetroScrubbed(dir)).toBe(true);
  });

  test("the seeded alias map: retro.json's s1 (uuid A) stays s1 in transcript.jsonl, and uuid B, met first, takes s2", async () => {
    const repo = makeRepo("721-alias-repo");
    const dir = await seedAliasWorkdir("alias");
    const r = runFrontDoor(dir, repo, ["--from-retro"]);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
    const ids = readFileSync(join(dir, "transcript.jsonl"), "utf-8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l).sessionId);
    expect(ids).toEqual(["s2", "s1"]);
    expect(predSeededAliases(dir)).toBe(true);
  });

  test("retro.json keeps its sessions list after the pass: s1 with the digest of uuid A", async () => {
    const { sessionDigest } = await import("../adapters/_shared/src/session_aliases");
    const repo = makeRepo("721-keep-repo");
    const dir = await seedAliasWorkdir("keep");
    expect(runFrontDoor(dir, repo, ["--from-retro"]).status).toBe(0);
    const retro = JSON.parse(readFileSync(join(dir, "retro.json"), "utf-8"));
    expect(retro.sessions).toEqual([{ alias: "s1", digest: sessionDigest(uuid(1)) }]);
  });
});

describe("AC-STE-721.12 front door, no flag: a working directory holding retro.json stays byte-identical", () => {
  test("refuses in NFR-10 shape, exits 1, empty stdout, every file (retro.json included) byte-identical", async () => {
    const repo = makeRepo("721-noflag-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = await seedRetroWorkdir("noflag");
    const before = snapshot(dir);
    expect(Object.keys(before)).toContain("retro.json");
    const r = runFrontDoor(dir, repo, []);
    expect(predNoFlagRefusal(r, before, snapshot(dir))).toBe(true);
  });
});

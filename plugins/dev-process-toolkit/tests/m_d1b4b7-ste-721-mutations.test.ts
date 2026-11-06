// STE-721 (M_d1b4b7) AC.10 — mutation controls.
//
// Four named mutations must each turn at least one named test red. Each named
// test's assertion is a predicate in `_m_d1b4b7_ste721_fixture.ts`, shared with
// the AC suites, so a mutant that falsifies the predicate here reds the named
// AC test too. Every mutant has a control: the predicate holds on the real code.
//
//   M1 the inside-ledger path check removed     -> predPathRule
//        (from-retro "AC-STE-721.3 refuses ... a path outside the ledger ...")
//        The mutant check copies its input into the ledger before calling the
//        real check, so the path rule cannot fire.
//   M2 retro.json dropped from the scrubbed set -> predRetroScrubbed
//        (payload "--from-retro alone: ... retro.json carries no ...")
//        The mutant outcome: the real front door runs, then retro.json gets
//        its unscrubbed bytes back.
//   M3 the alias seed step skipped              -> predSeededAliases
//        (payload "the seeded alias map: ...") — a bun preload turns
//        `seedAliasMap` into a no-op on the front door.
//   M4 no --redact-identifiers skips the pass under --from-retro
//                                               -> predFromRetroPrivacy
//        (payload "--from-retro alone: ...") — the mutant runner skips the
//        front door when --redact-identifiers is absent.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRANCH, OTHER_BRANCH, cleanupTemps, makeRepo, runFrontDoor } from "./_m_d1b4b7_ste720_fixture";
import {
  LEDGER_REL,
  type CheckFn,
  type Runner,
  noSeedPreload,
  predFromRetroPrivacy,
  predPathRule,
  predRetroScrubbed,
  predSeededAliases,
  realRunner,
  retroMod,
  seedAliasWorkdir,
  seedRetroWorkdir,
} from "./_m_d1b4b7_ste721_fixture";

afterAll(cleanupTemps);

describe("AC-STE-721.10 M1 — the inside-ledger path check removed", () => {
  test("control: predPathRule holds on the real check", async () => {
    const { checkRetroInput } = await retroMod();
    expect(await predPathRule(checkRetroInput, "m1-real")).toBe(true);
  });

  test("mutant: a check that never sees the real path fails predPathRule", async () => {
    const { checkRetroInput } = await retroMod();
    let n = 0;
    const mutant: CheckFn = (file, root) => {
      const inside = join(root, LEDGER_REL, `mutant-copy-${n++}.json`);
      writeFileSync(inside, readFileSync(file));
      return checkRetroInput(inside, root);
    };
    expect(await predPathRule(mutant, "m1-mutant")).toBe(false);
  });
});

describe("AC-STE-721.10 M2 — retro.json dropped from the scrubbed set", () => {
  test("control: predRetroScrubbed holds after the real --from-retro run", async () => {
    const repo = makeRepo("721-m2-real-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = await seedRetroWorkdir("m2-real");
    expect(runFrontDoor(dir, repo, ["--from-retro"]).status).toBe(0);
    expect(predRetroScrubbed(dir)).toBe(true);
  });

  test("mutant: retro.json left unscrubbed fails predRetroScrubbed (and predFromRetroPrivacy)", async () => {
    const repo = makeRepo("721-m2-mut-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const { dir, retroBefore } = await seedRetroWorkdir("m2-mut");
    expect(runFrontDoor(dir, repo, ["--from-retro"]).status).toBe(0);
    writeFileSync(join(dir, "retro.json"), retroBefore);
    expect(predRetroScrubbed(dir)).toBe(false);
    expect(predFromRetroPrivacy(dir)).toBe(false);
  });
});

describe("AC-STE-721.10 M3 — the alias seed step skipped", () => {
  test("control: predSeededAliases holds after the real --from-retro run", async () => {
    const repo = makeRepo("721-m3-real-repo");
    const dir = await seedAliasWorkdir("m3-real");
    expect(runFrontDoor(dir, repo, ["--from-retro"]).status).toBe(0);
    expect(predSeededAliases(dir)).toBe(true);
  });

  test("mutant: with seedAliasMap a no-op, the front door still exits 0 but predSeededAliases fails", async () => {
    const repo = makeRepo("721-m3-mut-repo");
    const dir = await seedAliasWorkdir("m3-mut");
    const { preload, log } = noSeedPreload("m3-preload");
    const r = runFrontDoor(dir, repo, ["--from-retro"], { preload });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
    // The stub really ran in place of the seed step.
    expect(readFileSync(log, "utf-8")).toContain("seedAliasMap");
    expect(predSeededAliases(dir)).toBe(false);
  });
});

describe("AC-STE-721.10 M4 — no --redact-identifiers skips the pass under --from-retro", () => {
  const run = async (runner: Runner, label: string): Promise<boolean> => {
    const repo = makeRepo(`721-m4-${label}-repo`, { branches: [BRANCH, OTHER_BRANCH] });
    const { dir } = await seedRetroWorkdir(`m4-${label}`);
    runner(dir, repo, ["--from-retro"]);
    return predFromRetroPrivacy(dir);
  };

  test("control: predFromRetroPrivacy holds on the real --from-retro run", async () => {
    expect(await run(realRunner, "real")).toBe(true);
  });

  test("mutant: a front door that needs --redact-identifiers fails predFromRetroPrivacy", async () => {
    const mutant: Runner = (dir, root, flags) =>
      flags.includes("--redact-identifiers") ? realRunner(dir, root, flags) : { status: 0, stdout: "", stderr: "" };
    expect(await run(mutant, "mut")).toBe(false);
  });
});

// STE-720 (M_d1b4b7) AC.11 — mutation controls.
//
// Seven named mutations must each turn at least one named test red. Each named
// test's assertion is a predicate in `_m_d1b4b7_ste720_fixture.ts`, shared by
// the AC suite and this file, so a mutant that falsifies the predicate here
// reds the named AC test too. Every mutant has a control: the predicate holds
// on the real code.
//
//   M1 the /Users/<segment> rule removed      -> predUsersPrefix
//        ("AC-STE-720.2 /Users/fixture-user/repo/a.ts becomes ~/repo/a.ts ...")
//   M2 the slug rule removed                  -> predSlug
//        ("AC-STE-720.2 with home /Users/fixture.user the project-folder slug ...")
//   M3 the UUID rule removed                  -> predUuid
//        ("AC-STE-720.3 every occurrence is counted ...")
//   M4 the remote-prefix branch match removed -> predRemotePrefix
//        ("AC-STE-720.4 origin/feat/fixture-branch in a git log decoration ...")
//      M1 to M4 run the real `scrubIdentifiers` with that rule's input masked
//      so the rule cannot fire, the mask restored in the output.
//   M5 the for-each-ref branch source removed -> branch-sources "a branch that
//      exists only as a local ref ..." — a PATH `git` shim answers
//      for-each-ref with nothing.
//   M6 the shared alias map removed           -> predSharedMap and
//      predFrontDoorSharedMap ("AC-STE-720.3 two UUIDs across two files ..."
//      and payload-privacy "one alias map serves the whole report") — each
//      `scrubIdentifiers` call gets a fresh map, in-process and through a
//      bun preload on the front door.
//   M7 the front door's no-flag refusal removed -> predNoFlagRefusal
//      (default-identity "refuses in NFR-10 shape ...") — graded on a TEMP
//      COPY of the plugin's adapters with a default flag injected before the
//      `if (import.meta.main)` guard.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  OTHER_BRANCH,
  PLUGIN_ROOT,
  UUID_RE,
  aliasMod,
  branchAlias,
  cleanupTemps,
  gitShim,
  idMod,
  makeRepo,
  masked,
  predFrontDoorSharedMap,
  predNoFlagRefusal,
  predRemotePrefix,
  predSharedMap,
  predSlug,
  predUsersPrefix,
  predUuid,
  runFrontDoor,
  scrubSpyPreload,
  seedWorkdir,
  sevenSecretRows,
  SECRET_KEYS,
  snapshot,
  tempDir,
  type ScrubFn,
} from "./_m_d1b4b7_ste720_fixture";

afterAll(cleanupTemps);

async function real(): Promise<{ scrub: ScrubFn; fresh: () => any }> {
  const { scrubIdentifiers } = await idMod();
  const { createAliasMap } = await aliasMod();
  return { scrub: scrubIdentifiers, fresh: () => createAliasMap() };
}

const literal = (from: string, to: string) => (s: string): string => s.split(from).join(to);

describe("AC-STE-720.11 M1-M4 — pure-rule mutants red their named predicates", () => {
  test("M1 /Users/<segment> rule: holds on the real pass, fails with /Users/ masked", async () => {
    const { scrub, fresh } = await real();
    expect(predUsersPrefix(scrub, fresh)).toBe(true);
    const mutant = masked(scrub, /\/Users\//g, () => "/UsQZXQers/", literal("/UsQZXQers/", "/Users/"));
    expect(predUsersPrefix(mutant, fresh)).toBe(false);
  });

  test("M2 slug rule: holds on the real pass, fails with -Users- and -home- masked", async () => {
    const { scrub, fresh } = await real();
    expect(predSlug(scrub, fresh)).toBe(true);
    const mutant = masked(
      scrub,
      /-(Users|home)-/g,
      (m) => `-${m.slice(1, 3)}QZXQ${m.slice(3)}`,
      (s) => s.replace(/-(Us|ho)QZXQ(ers|me)-/g, "-$1$2-"),
    );
    expect(predSlug(mutant, fresh)).toBe(false);
  });

  test("M3 UUID rule: holds on the real pass, fails with UUID hyphens masked", async () => {
    const { scrub, fresh } = await real();
    expect(predUuid(scrub, fresh)).toBe(true);
    const mutant = masked(scrub, UUID_RE, (m) => m.replace(/-/g, "QZXQ"), literal("QZXQ", "-"));
    expect(predUuid(mutant, fresh)).toBe(false);
  });

  test("M4 remote-prefix branch match: holds on the real pass, fails with origin/ masked", async () => {
    const { scrub, fresh } = await real();
    expect(predRemotePrefix(scrub, fresh)).toBe(true);
    const mutant = masked(scrub, /origin\//g, () => "originQZXQ", literal("originQZXQ", "origin/"));
    expect(predRemotePrefix(mutant, fresh)).toBe(false);
  });
});

describe("AC-STE-720.11 M5 — the for-each-ref branch source", () => {
  function run(label: string, blank: boolean): string {
    const repo = makeRepo(`${label}-repo`, { branches: [OTHER_BRANCH] });
    const dir = tempDir(`${label}-work`);
    writeFileSync(join(dir, "report.md"), `$ git push origin ${OTHER_BRANCH}\n`);
    writeFileSync(join(dir, "metadata.json"), `${JSON.stringify({ redaction_summary: sevenSecretRows(SECRET_KEYS) })}\n`);
    const shim = gitShim(`${label}-shim`, { blankForEachRef: blank });
    const r = runFrontDoor(dir, repo, ["--redact-identifiers"], { env: shim.env });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
    return readFileSync(join(dir, "report.md"), "utf-8");
  }

  test("control: through a pass-through git shim the never-checked-out ref is rewritten", () => {
    expect(run("m5-control", false)).toBe(`$ git push origin ${branchAlias(OTHER_BRANCH)}\n`);
  });

  test("mutant: with for-each-ref answering nothing, the ref-only branch survives (the named branch-sources row would red)", () => {
    expect(run("m5-mutant", true)).toBe(`$ git push origin ${OTHER_BRANCH}\n`);
  });
});

describe("AC-STE-720.11 M6 — the shared alias map", () => {
  test("in-process: predSharedMap holds on the real pass and fails when each call gets a fresh map", async () => {
    const { scrub, fresh } = await real();
    expect(predSharedMap(scrub, fresh)).toBe(true);
    const mutant: ScrubFn = (text, ctx) => scrub(text, { ...ctx, aliases: fresh() });
    expect(predSharedMap(mutant, fresh)).toBe(false);
  });

  test("front door: predFrontDoorSharedMap holds through a pass-through spy and fails through a fresh-map-per-call spy", () => {
    const repo = makeRepo("m6-repo", { branches: [BRANCH, OTHER_BRANCH] });
    const ctl = scrubSpyPreload("m6-ctl");
    const { dir: d1 } = seedWorkdir("m6-ctl-work");
    expect(runFrontDoor(d1, repo, ["--redact-identifiers"], { preload: ctl.preload }).status).toBe(0);
    expect(predFrontDoorSharedMap(d1)).toBe(true);

    const mut = scrubSpyPreload("m6-mut", { freshAliasPerCall: true });
    const { dir: d2 } = seedWorkdir("m6-mut-work");
    expect(runFrontDoor(d2, repo, ["--redact-identifiers"], { preload: mut.preload }).status).toBe(0);
    expect(predFrontDoorSharedMap(d2)).toBe(false);
  });
});

describe("AC-STE-720.11 M7 — the front door's no-flag refusal", () => {
  const INJECT =
    'if (!process.argv.includes("--redact-identifiers") && !process.argv.includes("--from-retro")) process.argv.push("--redact-identifiers"); // M7 mutant';

  function copyDoor(label: string, mutate: boolean): string {
    const root = join(tempDir(label), "plugin");
    cpSync(join(PLUGIN_ROOT, "adapters"), join(root, "adapters"), { recursive: true });
    cpSync(join(PLUGIN_ROOT, ".claude-plugin"), join(root, ".claude-plugin"), { recursive: true });
    const door = join(root, "adapters", "_shared", "src", "report_issue_payload.ts");
    if (mutate) {
      const text = readFileSync(door, "utf-8");
      const at = text.search(/^if \(import\.meta\.main\)/m);
      if (at < 0) throw new Error("report_issue_payload.ts has no `if (import.meta.main)` guard to inject before");
      writeFileSync(door, `${text.slice(0, at)}${INJECT}\n${text.slice(at)}`);
    }
    return door;
  }

  function refuses(door: string, label: string): boolean {
    const repo = makeRepo(`${label}-repo`, { branches: [BRANCH] });
    const { dir } = seedWorkdir(`${label}-work`);
    const before = snapshot(dir);
    const r = runFrontDoor(dir, repo, [], { door });
    return predNoFlagRefusal(r, before, snapshot(dir));
  }

  test("control: the unmutated copy refuses with neither flag", () => {
    expect(refuses(copyDoor("m7-control", false), "m7-control")).toBe(true);
  });

  test("mutant: with the refusal bypassed, the no-flag predicate fails", () => {
    expect(refuses(copyDoor("m7-mutant", true), "m7-mutant")).toBe(false);
  });
});

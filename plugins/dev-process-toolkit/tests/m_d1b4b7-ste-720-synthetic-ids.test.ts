// STE-720 (M_d1b4b7) AC.10 — every fixture this FR adds uses synthetic ids
// only. The privacy test's inputs use the user name `fixture-user` and UUIDs
// of the form `00000000-0000-4000-8000-00000000000N`.
//
// Graded two ways: a source scan of every file this FR adds under tests/, and
// a runtime scan of the seeded working directory the privacy test uses.

import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PLUGIN_ROOT, UUID_RE, USER, cleanupTemps, seedWorkdir } from "./_m_d1b4b7_ste720_fixture";

afterAll(cleanupTemps);

const TESTS = join(PLUGIN_ROOT, "tests");
const ADDED = [
  "_m_d1b4b7_ste720_fixture.ts",
  ...readdirSync(TESTS).filter((f) => f.startsWith("m_d1b4b7-ste-720-") && f.endsWith(".test.ts")),
].sort();

const USER_SEG = new RegExp("(?<![A-Za-z0-9])[/-](?:Users|home)[/-]([A-Za-z0-9._-]*)", "g");
const ALLOWED_USERS = new Set(["fixture-user", "fixture.user", "fixtureuser", "fixture"]);
/** A fixture name, alone or as the head of a slug (`fixture-user-repo`). */
function isFixtureUser(u: string): boolean {
  return [...ALLOWED_USERS].some((a) => u === a || u.startsWith(`${a}-`) || u.startsWith(`${a}.`));
}
const SYNTHETIC_UUID = /^00000000-0000-4000-8000-[0-9A-Fa-f]{12}$/;

describe("AC-STE-720.10 synthetic ids only", () => {
  test("this FR adds at least the fixture and eight suites", () => {
    expect(ADDED.length).toBeGreaterThanOrEqual(9);
  });

  for (const f of ADDED) {
    test(`${f}: every user segment is a fixture name, every literal UUID is synthetic, and the real home is absent`, () => {
      const src = readFileSync(join(TESTS, f), "utf-8");
      const users = [...src.matchAll(USER_SEG)].map((m) => m[1]!).filter((u) => u.length > 0 && /^[A-Za-z0-9]/.test(u));
      expect(users.filter((u) => !isFixtureUser(u))).toEqual([]);
      expect((src.match(UUID_RE) ?? []).filter((u) => !SYNTHETIC_UUID.test(u))).toEqual([]);
      expect(src.includes(homedir())).toBe(false);
    });
  }

  test("the privacy test's seeded inputs use fixture-user and 00000000-0000-4000-8000-00000000000N only", () => {
    const { dir } = seedWorkdir("synthetic-seed");
    const text = ["report.md", "metadata.json", "transcript.jsonl"].map((n) => readFileSync(join(dir, n), "utf-8")).join("\n");
    const uuids = text.match(UUID_RE) ?? [];
    expect(uuids.length).toBeGreaterThan(0);
    expect(uuids.filter((u) => !/^00000000-0000-4000-8000-00000000000\d$/.test(u))).toEqual([]);
    const users = [...text.matchAll(USER_SEG)].map((m) => m[1]!);
    expect(users.length).toBeGreaterThan(0);
    expect(users.filter((u) => !u.startsWith(USER))).toEqual([]);
    expect(text.includes(homedir())).toBe(false);
  });

  test("CONTROL: the user-segment scan flags a non-fixture name", () => {
    const planted = ["", "Users", "someone", "repo"].join("/");
    const users = [...planted.matchAll(USER_SEG)].map((m) => m[1]!);
    expect(users.filter((u) => !isFixtureUser(u))).toEqual(["someone"]);
  });
});

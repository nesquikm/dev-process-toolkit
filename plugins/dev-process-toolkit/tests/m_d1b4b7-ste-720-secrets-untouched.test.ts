// STE-720 (M_d1b4b7) AC.8 — the secret pass is untouched.
//
// `scrub_secrets.ts` (scrubSecrets + SECRET_PATTERNS) is byte-identical to
// trunk, and the suites that test it are unchanged against trunk. The
// identifier pass is a second module beside it, never folded into it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, SCRUB_IDENTIFIERS, TRUNK_SHA, atRev, idMod, secretsMod } from "./_m_d1b4b7_ste720_fixture";

const REL = "plugins/dev-process-toolkit/adapters/_shared/src/scrub_secrets.ts";
// The scrub_secrets runtime suite. (m137-ste-533 is graded by AC.9 as "stays green", by the full suite.)
const SECRET_SUITES = ["tests/report-issue.smoke.test.ts"];

describe("AC-STE-720.8 scrubSecrets and SECRET_PATTERNS are byte-identical to trunk", () => {
  test("scrub_secrets.ts equals its bytes at trunk", () => {
    expect(readFileSync(join(PLUGIN_ROOT, "adapters", "_shared", "src", "scrub_secrets.ts"), "utf-8")).toBe(atRev(TRUNK_SHA, REL));
  });

  test("SECRET_PATTERNS still holds seven patterns and scrubSecrets reports seven rows", async () => {
    const { SECRET_PATTERNS, scrubSecrets } = await secretsMod();
    expect(SECRET_PATTERNS.length).toBe(7);
    expect(scrubSecrets("plain").matches.length).toBe(7);
  });

  for (const rel of SECRET_SUITES) {
    test(`${rel} is unchanged against trunk`, () => {
      expect(readFileSync(join(PLUGIN_ROOT, rel), "utf-8")).toBe(atRev(TRUNK_SHA, `plugins/dev-process-toolkit/${rel}`));
    });
  }

  test("the identifier pass is its own module: it does not import or re-export scrub_secrets, and scrubIdentifiers leaves a secret alone", async () => {
    const src = readFileSync(SCRUB_IDENTIFIERS, "utf-8");
    expect(src).not.toMatch(/from\s+["']\.\/scrub_secrets/);
    const { scrubIdentifiers } = await idMod();
    const { createAliasMap } = (await import("../adapters/_shared/src/session_aliases")) as Record<string, any>;
    const secret = "token=abcdefgh12345678";
    expect(scrubIdentifiers(secret, { branches: [], aliases: createAliasMap() }).scrubbed).toBe(secret);
  });
});

// Unit tests for readVerificationConfig (STE-347 AC-STE-347.1).
//
// Covers the Schema-L-style `## Verification` section parser: defaults
// (CLAUDE.md absent, section absent, individual key absent), each explicit
// verify_mode, closed-key-set rejection (keys other than verify_skill /
// verify_mode inside the section throw), out-of-set verify_mode value
// rejection, and `verify_skill: visual-check` acceptance. Mirrors the
// shape of docs_config.test.ts — same isolation pattern (mkdtemp per
// test), same thrown-error assertions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MalformedVerificationConfigError,
  readVerificationConfig,
} from "./verification_config";

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-verifc-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const DEFAULTS = { verifySkill: null, verifyMode: "advisory" };

/** CLAUDE.md body with the given `## Verification` section lines. */
function claudeMdWithVerification(sectionLines: string): string {
  return `# Project

Description.

## Task Tracking

mode: none

## Verification

${sectionLines}

## Rules

- keep tests green
`;
}

describe("readVerificationConfig — defaults (AC-STE-347.1)", () => {
  test("absent CLAUDE.md file returns { verifySkill: null, verifyMode: 'advisory' }", () => {
    // No file written at claudeMdPath.
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("missing `## Verification` section returns defaults", () => {
    writeFileSync(
      claudeMdPath,
      `# Project\n\n## Task Tracking\n\nmode: linear\n`,
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("empty `## Verification` section (no keys) returns defaults", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification(""));
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("verify_mode absent defaults to 'advisory' (verify_skill still read)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_skill: glacy-drive"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
    });
  });

  test("verify_skill absent defaults to null (verify_mode still read)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: blocking"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "blocking",
    });
  });
});

describe("readVerificationConfig — explicit modes (AC-STE-347.1)", () => {
  test("verify_mode: advisory parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: advisory",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
    });
  });

  test("verify_mode: blocking parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: blocking",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "blocking",
    });
  });

  test("verify_mode: manual parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: manual",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "manual",
    });
  });

  test("the literal `visual-check` is an accepted verify_skill value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: visual-check\nverify_mode: advisory",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "visual-check",
      verifyMode: "advisory",
    });
  });
});

describe("readVerificationConfig — closed-set rejection (AC-STE-347.1)", () => {
  test("out-of-closed-set key inside the section throws MalformedVerificationConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_timeout: 30",
      ),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("out-of-set key error carries key + value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_timeout: 30"),
    );
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedVerificationConfigError);
      const e = err as MalformedVerificationConfigError;
      expect(e.name).toBe("MalformedVerificationConfigError");
      expect(e.key).toBe("verify_timeout");
      expect(e.value).toBe("30");
    }
  });

  test("out-of-set verify_mode value throws MalformedVerificationConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: strict"),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("out-of-set verify_mode error carries key + value (NFR-10 remedy shape)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: BLOCKING"),
    );
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedVerificationConfigError);
      const e = err as MalformedVerificationConfigError;
      expect(e.key).toBe("verify_mode");
      expect(e.value).toBe("BLOCKING");
      expect(e.message).toContain("verify_mode");
      expect(e.message).toContain("BLOCKING");
    }
  });
});

describe("readVerificationConfig — section boundaries", () => {
  test("section terminates at next heading (keys below `## Other` are ignored)", () => {
    const md = `# Project

## Verification

verify_mode: manual

## Other

verify_mode: garbage
bogus_key: x
`;
    writeFileSync(claudeMdPath, md);
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "manual",
    });
  });

  test("keys outside the section (e.g. Task Tracking's `mode:`) never trip the closed set", () => {
    // claudeMdWithVerification always includes `mode: none` under
    // `## Task Tracking` — an out-of-closed-set key that must be
    // ignored because it sits outside `## Verification`.
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_skill: glacy-drive"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
    });
  });
});

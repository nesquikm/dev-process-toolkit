// Unit tests for readDocsConfig (STE-68 AC-STE-68.3, AC-STE-68.7).
//
// Covers the Schema-L-style `## Docs` section parser: all-true, single-mode,
// missing section (= all-false, backward-compat), malformed boolean values in
// each key. Mirrors the shape of resolver_config.test.ts — same isolation
// pattern (mkdtemp per test), same thrown-error assertions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MalformedDocsConfigError, readDocsConfig } from "./docs_config";

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-docsc-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function claudeMdWithDocs(values: {
  user_facing_mode: string;
  packages_mode: string;
  changelog_ci_owned: string;
}): string {
  return `# Project

Description.

## Task Tracking

mode: none

## Docs

user_facing_mode: ${values.user_facing_mode}
packages_mode: ${values.packages_mode}
changelog_ci_owned: ${values.changelog_ci_owned}
`;
}

describe("readDocsConfig", () => {
  test("AC-STE-68.7 — all three true parses correctly", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "true",
        packages_mode: "true",
        changelog_ci_owned: "true",
      }),
    );
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: true,
      packagesMode: true,
      changelogCiOwned: true,
    });
  });

  test("AC-STE-68.7 — single mode (user_facing only) parses correctly", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "true",
        packages_mode: "false",
        changelog_ci_owned: "false",
      }),
    );
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: true,
      packagesMode: false,
      changelogCiOwned: false,
    });
  });

  test("AC-STE-68.7 — single mode (packages only) parses correctly", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "false",
        packages_mode: "true",
        changelog_ci_owned: "false",
      }),
    );
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: false,
      packagesMode: true,
      changelogCiOwned: false,
    });
  });

  test("AC-STE-68.3 — missing `## Docs` section returns all-false", () => {
    writeFileSync(
      claudeMdPath,
      `# Project\n\n## Task Tracking\n\nmode: linear\n`,
    );
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: false,
      packagesMode: false,
      changelogCiOwned: false,
    });
  });

  test("AC-STE-68.3 — absent CLAUDE.md file returns all-false", () => {
    // No file written at claudeMdPath.
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: false,
      packagesMode: false,
      changelogCiOwned: false,
    });
  });

  test("AC-STE-68.7 — malformed `user_facing_mode` value throws MalformedDocsConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "maybe",
        packages_mode: "true",
        changelog_ci_owned: "false",
      }),
    );
    expect(() => readDocsConfig(claudeMdPath)).toThrow(MalformedDocsConfigError);
  });

  test("AC-STE-68.7 — malformed `changelog_ci_owned` value throws MalformedDocsConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "true",
        packages_mode: "true",
        changelog_ci_owned: "yes",
      }),
    );
    expect(() => readDocsConfig(claudeMdPath)).toThrow(MalformedDocsConfigError);
  });

  test("error message cites the offending key (NFR-10 remedy shape)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithDocs({
        user_facing_mode: "true",
        packages_mode: "YES",
        changelog_ci_owned: "false",
      }),
    );
    try {
      readDocsConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedDocsConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain("packages_mode");
      expect(msg).toContain("YES");
    }
  });

  test("section terminates at next heading (extra keys below `## Other` are ignored)", () => {
    const md = `# Project

## Docs

user_facing_mode: true
packages_mode: false
changelog_ci_owned: false

## Other

user_facing_mode: this_should_be_ignored
`;
    writeFileSync(claudeMdPath, md);
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: true,
      packagesMode: false,
      changelogCiOwned: false,
    });
  });

  test("partial `## Docs` section — missing key defaults to false", () => {
    const md = `# Project

## Docs

user_facing_mode: true
`;
    writeFileSync(claudeMdPath, md);
    expect(readDocsConfig(claudeMdPath)).toEqual({
      userFacingMode: true,
      packagesMode: false,
      changelogCiOwned: false,
    });
  });
});

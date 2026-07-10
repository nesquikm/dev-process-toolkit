// Unit tests for readTokenStatsConfig (STE-378 AC-STE-378.2 / AC-STE-378.6).
//
// Covers the Schema-L-style `## Token Stats` section parser: defaults
// (CLAUDE.md absent, section absent, key absent), each explicit `enabled`
// value, closed-key-set rejection (keys other than `enabled` inside the
// section throw), out-of-set `enabled` value rejection, and section
// boundary termination (a `token_stats`-shaped token in a trailing
// comment / next section is not misread). Mirrors the shape of
// verification_config.test.ts — same isolation pattern (mkdtemp per test),
// same thrown-error assertions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MalformedTokenStatsConfigError,
  readTokenStatsConfig,
} from "./token_stats_config";

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-tsc-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const DEFAULTS = { enabled: false };

/** CLAUDE.md body with the given `## Token Stats` section lines. */
function claudeMdWithTokenStats(sectionLines: string): string {
  return `# Project

Description.

## Task Tracking

mode: none

## Token Stats

${sectionLines}

## Rules

- keep tests green
`;
}

describe("readTokenStatsConfig — defaults (AC-STE-378.2)", () => {
  test("absent CLAUDE.md file returns { enabled: false }", () => {
    // No file written at claudeMdPath.
    expect(readTokenStatsConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("present CLAUDE.md WITHOUT a `## Token Stats` section returns { enabled: false }", () => {
    writeFileSync(
      claudeMdPath,
      `# Project\n\n## Task Tracking\n\nmode: linear\n`,
    );
    expect(readTokenStatsConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("empty `## Token Stats` section (no keys) returns { enabled: false }", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats(""));
    expect(readTokenStatsConfig(claudeMdPath)).toEqual(DEFAULTS);
  });
});

describe("readTokenStatsConfig — explicit values (AC-STE-378.2)", () => {
  test("enabled: true parses as true", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: true"));
    expect(readTokenStatsConfig(claudeMdPath)).toEqual({ enabled: true });
  });

  test("enabled: false parses as false", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: false"));
    expect(readTokenStatsConfig(claudeMdPath)).toEqual({ enabled: false });
  });
});

describe("readTokenStatsConfig — malformed value rejection (AC-STE-378.2)", () => {
  test("enabled: TRUE (uppercase) throws MalformedTokenStatsConfigError", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: TRUE"));
    expect(() => readTokenStatsConfig(claudeMdPath)).toThrow(
      MalformedTokenStatsConfigError,
    );
  });

  test("enabled: yes throws MalformedTokenStatsConfigError", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: yes"));
    expect(() => readTokenStatsConfig(claudeMdPath)).toThrow(
      MalformedTokenStatsConfigError,
    );
  });

  test("enabled: 1 throws MalformedTokenStatsConfigError", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: 1"));
    expect(() => readTokenStatsConfig(claudeMdPath)).toThrow(
      MalformedTokenStatsConfigError,
    );
  });

  test("enabled: (empty value) throws — never silently defaults to false", () => {
    // Hardening (Phase 3 Stage C): an empty value is a distinct malformed
    // path from TRUE/yes/1 — it must reject, not fall through to the
    // absent-key default. Guards against a `.trim() === "" ⇒ treat as unset`
    // regression that would silently disable the feature on a typo.
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled:"));
    let caught: unknown;
    try {
      readTokenStatsConfig(claudeMdPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MalformedTokenStatsConfigError);
    expect((caught as MalformedTokenStatsConfigError).value).toBe("");
  });

  test("malformed value error carries key + value (NFR-10 remedy shape)", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: TRUE"));
    try {
      readTokenStatsConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedTokenStatsConfigError);
      const e = err as MalformedTokenStatsConfigError;
      expect(e.name).toBe("MalformedTokenStatsConfigError");
      expect(e.key).toBe("enabled");
      expect(e.value).toBe("TRUE");
      expect(e.message).toContain("enabled");
      expect(e.message).toContain("TRUE");
    }
  });
});

describe("readTokenStatsConfig — closed-set rejection (AC-STE-378.2)", () => {
  test("a key OUTSIDE the closed {enabled} set throws MalformedTokenStatsConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithTokenStats("enabled: true\nretention: 30"),
    );
    expect(() => readTokenStatsConfig(claudeMdPath)).toThrow(
      MalformedTokenStatsConfigError,
    );
  });

  test("out-of-set key error carries key + value (NFR-10 remedy shape)", () => {
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("retention: 30"));
    try {
      readTokenStatsConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedTokenStatsConfigError);
      const e = err as MalformedTokenStatsConfigError;
      expect(e.name).toBe("MalformedTokenStatsConfigError");
      expect(e.key).toBe("retention");
      expect(e.value).toBe("30");
    }
  });
});

describe("readTokenStatsConfig — section boundaries (AC-STE-378.2)", () => {
  test("section terminates at next heading — a `token_stats`-shaped key below `## Other` is ignored", () => {
    const md = `# Project

## Token Stats

enabled: true

## Other

enabled: false
retention: 30
`;
    writeFileSync(claudeMdPath, md);
    // Parser stops at `## Other`; the `enabled: false` and out-of-set
    // `retention` below it must not be read (no misread, no throw).
    expect(readTokenStatsConfig(claudeMdPath)).toEqual({ enabled: true });
  });

  test("keys outside the section (e.g. Task Tracking's `mode:`) never trip the closed set", () => {
    // claudeMdWithTokenStats always includes `mode: none` under
    // `## Task Tracking` — an out-of-closed-set key that must be ignored
    // because it sits outside `## Token Stats`.
    writeFileSync(claudeMdPath, claudeMdWithTokenStats("enabled: true"));
    expect(readTokenStatsConfig(claudeMdPath)).toEqual({ enabled: true });
  });
});

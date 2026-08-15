// Unit tests for readOrchestrationConfig (STE-463, AC-STE-463.1 … .7).
//
// Covers the Schema-L-style `## Orchestration` CLAUDE.md block reader:
// defaults on absence (file / heading / keys), each closed-set key parse,
// each NFR-10 refusal (invalid enum value, unknown top-level key), and
// CRLF/BOM normalization. Mirrors docs_config.test.ts — same isolation
// pattern (mkdtemp per test), same thrown-error assertions.
//
// Contract pinned here (shared authority for STE-464):
//   - readOrchestrationConfig(projectRoot) resolves CLAUDE.md inside the
//     project root (NOT a file path — differs from readDocsConfig).
//   - EFFORT_LEVELS / MERGE_POLICIES are exported closed-set consts.
//   - MalformedOrchestrationConfigError message carries the NFR-10
//     canonical shape: a `CLAUDE.md:<line>` anchor plus Refusing: /
//     Remedy: / Context: sub-lines.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EFFORT_LEVELS,
  MERGE_POLICIES,
  MalformedOrchestrationConfigError,
  readOrchestrationConfig,
} from "./orchestration_config";

const DEFAULTS = { defaultEffort: "ultracode", mergePolicy: "offer" };

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-orch-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** CLAUDE.md with an `## Orchestration` block containing the given lines. */
function claudeMdWithOrch(blockLines: string[]): string {
  return [
    "# Project",
    "",
    "## Task Tracking",
    "",
    "mode: none",
    "",
    "## Orchestration",
    "",
    ...blockLines,
    "",
    "## Docs",
    "",
    "user_facing_mode: false",
    "",
  ].join("\n");
}

/** Expect a MalformedOrchestrationConfigError and return it for shape checks. */
function expectRefusal(fn: () => unknown): MalformedOrchestrationConfigError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(MalformedOrchestrationConfigError);
  return caught as MalformedOrchestrationConfigError;
}

/** Assert the NFR-10 canonical refusal shape on an error message. */
function expectNfr10Shape(msg: string): void {
  // <file>:<line> anchor naming the offending line.
  expect(msg).toMatch(/CLAUDE\.md:\d+/);
  expect(msg).toMatch(/Refusing:/);
  expect(msg).toMatch(/Remedy:/);
  expect(msg).toMatch(/Context:/);
}

describe("readOrchestrationConfig — defaults (AC-STE-463.1)", () => {
  test("absent CLAUDE.md ⇒ defaults { ultracode, offer }", () => {
    // No file written at claudeMdPath; work dir is also NOT a git repo —
    // pure file reads must succeed here (no git, no network).
    expect(readOrchestrationConfig(work)).toEqual(DEFAULTS);
  });

  test("CLAUDE.md without `## Orchestration` heading ⇒ defaults", () => {
    writeFileSync(
      claudeMdPath,
      "# Project\n\n## Task Tracking\n\nmode: none\n\n## Docs\n\nuser_facing_mode: false\n",
    );
    expect(readOrchestrationConfig(work)).toEqual(DEFAULTS);
  });

  test("`## Orchestration` heading present but block empty ⇒ defaults", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch([]));
    expect(readOrchestrationConfig(work)).toEqual(DEFAULTS);
  });

  test("partial block — only default_effort set ⇒ merge_policy defaults to offer", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(["default_effort: low"]));
    expect(readOrchestrationConfig(work)).toEqual({
      defaultEffort: "low",
      mergePolicy: "offer",
    });
  });

  test("partial block — only merge_policy set ⇒ default_effort defaults to ultracode", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(["merge_policy: never"]));
    expect(readOrchestrationConfig(work)).toEqual({
      defaultEffort: "ultracode",
      mergePolicy: "never",
    });
  });

  test("section terminates at next heading — keys under `## Docs` are not orchestration keys", () => {
    // The claudeMdWithOrch fixture places `## Docs` (with a non-orchestration
    // key) after the block; a scan that fails to terminate at the next
    // heading would refuse on `user_facing_mode` as an unknown key.
    writeFileSync(
      claudeMdPath,
      claudeMdWithOrch(["default_effort: high", "merge_policy: offer"]),
    );
    expect(readOrchestrationConfig(work)).toEqual({
      defaultEffort: "high",
      mergePolicy: "offer",
    });
  });

  test("module performs pure file reads — no child_process / network imports", () => {
    const src = readFileSync(
      join(import.meta.dir, "orchestration_config.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'](node:)?child_process["']/);
    expect(src).not.toMatch(/require\(\s*["'](node:)?child_process["']\s*\)/);
    expect(src).not.toMatch(/from\s+["']node:https?["']/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});

describe("exported closed-set consts (shared authority for STE-464)", () => {
  test("EFFORT_LEVELS is exactly low|medium|high|xhigh|max|ultracode", () => {
    expect([...EFFORT_LEVELS].sort()).toEqual(
      ["low", "medium", "high", "xhigh", "max", "ultracode"].sort(),
    );
  });

  test("MERGE_POLICIES is exactly offer|auto|never", () => {
    expect([...MERGE_POLICIES].sort()).toEqual(
      ["offer", "auto", "never"].sort(),
    );
  });
});

describe("default_effort parsing (AC-STE-463.2)", () => {
  for (const effort of [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultracode",
  ]) {
    test(`accepts \`default_effort: ${effort}\``, () => {
      writeFileSync(
        claudeMdPath,
        claudeMdWithOrch([`default_effort: ${effort}`]),
      );
      expect(readOrchestrationConfig(work)).toEqual({
        defaultEffort: effort,
        mergePolicy: "offer",
      });
    });
  }

  test("invalid value refuses in NFR-10 shape naming the offending line and the legal set", () => {
    // Explicit line accounting so the :<line> anchor is pinned exactly:
    //   1 # Project
    //   2 (blank)
    //   3 ## Orchestration
    //   4 (blank)
    //   5 default_effort: turbo
    writeFileSync(
      claudeMdPath,
      [
        "# Project",
        "",
        "## Orchestration",
        "",
        "default_effort: turbo",
        "",
      ].join("\n"),
    );
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
    expect(err.message).toMatch(/CLAUDE\.md:5(\D|$)/);
    // Names the offending value.
    expect(err.message).toContain("turbo");
    // Names the legal set (distinctive members — never a silent fallback).
    expect(err.message).toContain("ultracode");
    expect(err.message).toContain("xhigh");
    expect(err.message).toContain("medium");
  });

  test("wrong case is not silently coerced — `Ultracode` refuses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithOrch(["default_effort: Ultracode"]),
    );
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
  });
});

describe("merge_policy parsing (AC-STE-463.3)", () => {
  for (const policy of ["offer", "auto", "never"]) {
    test(`accepts \`merge_policy: ${policy}\``, () => {
      writeFileSync(claudeMdPath, claudeMdWithOrch([`merge_policy: ${policy}`]));
      expect(readOrchestrationConfig(work)).toEqual({
        defaultEffort: "ultracode",
        mergePolicy: policy,
      });
    });
  }

  test("invalid value refuses in NFR-10 shape naming the legal set", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(["merge_policy: always"]));
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
    expect(err.message).toContain("always");
    expect(err.message).toContain("offer");
    expect(err.message).toContain("auto");
    expect(err.message).toContain("never");
  });

  test("auto is never inferred — absent key stays `offer`, not `auto`", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(["default_effort: max"]));
    expect(readOrchestrationConfig(work).mergePolicy).toBe("offer");
  });

  test("auto is never inferred — `Auto` (wrong case) refuses rather than enabling", () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(["merge_policy: Auto"]));
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
  });

  test('auto is never inferred — quoted `"auto"` is not the literal line and refuses', () => {
    writeFileSync(claudeMdPath, claudeMdWithOrch(['merge_policy: "auto"']));
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
  });
});

describe("unknown top-level keys refuse — closed schema (AC-STE-463.4)", () => {
  test("typo'd key refuses in NFR-10 shape naming the key and its line", () => {
    // Line accounting:
    //   1 # Project
    //   2 (blank)
    //   3 ## Orchestration
    //   4 (blank)
    //   5 default_effort: low
    //   6 merge_polcy: auto     <- typo, unknown key
    writeFileSync(
      claudeMdPath,
      [
        "# Project",
        "",
        "## Orchestration",
        "",
        "default_effort: low",
        "merge_polcy: auto",
        "",
      ].join("\n"),
    );
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
    expect(err.message).toContain("merge_polcy");
    expect(err.message).toMatch(/CLAUDE\.md:6(\D|$)/);
  });

  test("unknown key alongside two valid keys still refuses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithOrch([
        "default_effort: high",
        "merge_policy: never",
        "spawn_count: 3",
      ]),
    );
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expect(err.message).toContain("spawn_count");
    expectNfr10Shape(err.message);
  });
});

describe("CRLF/BOM normalization (AC-STE-463.5)", () => {
  const lfContent = claudeMdWithOrch([
    "default_effort: xhigh",
    "merge_policy: never",
  ]);
  const expected = { defaultEffort: "xhigh", mergePolicy: "never" };

  test("Windows-authored CLAUDE.md (BOM + CRLF) parses identically to LF", () => {
    // Unnormalized CRLF would leave `xhigh\r` / `never\r`, failing the
    // enum guard — so this test is a live mutation trap on normalization.
    writeFileSync(claudeMdPath, "﻿" + lfContent.replace(/\n/g, "\r\n"));
    expect(readOrchestrationConfig(work)).toEqual(expected);
  });

  test("CRLF-only (no BOM) parses identically to LF", () => {
    writeFileSync(claudeMdPath, lfContent.replace(/\n/g, "\r\n"));
    expect(readOrchestrationConfig(work)).toEqual(expected);
  });

  test("BOM directly before a first-line `## Orchestration` heading is stripped", () => {
    // Without BOM stripping, `﻿## Orchestration` fails the heading
    // match and the block silently reads as absent (wrong defaults).
    writeFileSync(
      claudeMdPath,
      "﻿## Orchestration\n\ndefault_effort: max\n",
    );
    expect(readOrchestrationConfig(work)).toEqual({
      defaultEffort: "max",
      mergePolicy: "offer",
    });
  });

  test("CRLF with an invalid value still refuses (normalization must not mask refusals)", () => {
    const bad = claudeMdWithOrch(["default_effort: turbo"]);
    writeFileSync(claudeMdPath, "﻿" + bad.replace(/\n/g, "\r\n"));
    const err = expectRefusal(() => readOrchestrationConfig(work));
    expectNfr10Shape(err.message);
    expect(err.message).toContain("turbo");
  });
});

describe("templates/CLAUDE.md.template stub (AC-STE-463.6)", () => {
  const templatePath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "templates",
    "CLAUDE.md.template",
  );

  test("template carries a commented `## Orchestration` stub documenting both keys and defaults", () => {
    const template = readFileSync(templatePath, "utf8");
    const idx = template.indexOf("## Orchestration");
    expect(idx).toBeGreaterThan(-1);

    // Commented stub (STE-167 shape): the heading sits inside an HTML
    // comment — the nearest `<!--` before it is not yet closed by a `-->`.
    const lastOpen = template.lastIndexOf("<!--", idx);
    const lastClose = template.lastIndexOf("-->", idx);
    expect(lastOpen).toBeGreaterThan(-1);
    expect(lastOpen).toBeGreaterThan(lastClose);

    // The stub documents both keys and both defaults.
    const commentEnd = template.indexOf("-->", idx);
    expect(commentEnd).toBeGreaterThan(-1);
    const stub = template.slice(lastOpen, commentEnd);
    expect(stub).toContain("default_effort");
    expect(stub).toContain("merge_policy");
    expect(stub).toContain("ultracode");
    expect(stub).toContain("offer");
  });
});

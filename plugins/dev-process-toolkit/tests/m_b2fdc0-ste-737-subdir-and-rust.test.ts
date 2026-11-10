// STE-737 (M_b2fdc0) — signature extraction finds a TypeScript project one
// folder down (AC-STE-737.1), names an unsupported Rust stack (AC-STE-737.2),
// and leaves root-tsconfig projects exactly as v3.3.0 had them (AC-STE-737.3).
//
// Every assertion is a NAMED leg from tests/_m_b2fdc0_ste737_fixture.ts, run
// through the shipped extractor on temporary project trees. The mutation
// battery (m_b2fdc0-ste-737-mutation.test.ts) re-runs the same legs against
// mutated copies (AC-STE-737.4).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractSignatures } from "../adapters/_shared/src/signature_extractor";
import {
  PLUGIN_ROOT,
  ROOT_CASES,
  bareProjectHasNoRustWarning,
  cleanupTemps,
  extractorFrom,
  onlyOneLevelDown,
  onlySkippedDirsIsNoStack,
  rustAtRootWarns,
  rustOneLevelDownWarns,
  rustWithPythonDoesNotWarn,
  sameAsV330,
  skipsNodeModulesAndDotDirs,
  subdirTsIsRead,
  subdirsReadInNameOrder,
  v330Source,
  type Extract,
} from "./_m_b2fdc0_ste737_fixture";

setDefaultTimeout(120_000);

const shipped = extractSignatures as Extract;
let v330: Extract;
beforeAll(async () => {
  v330 = await extractorFrom("v330", v330Source());
});
afterAll(() => cleanupTemps());

describe("AC-STE-737.1 — a TypeScript project one folder down is read", () => {
  test("a tsconfig.json in an immediate subfolder is read, paths relative to the project root", () => {
    expect(subdirTsIsRead(shipped)).toBeNull();
  });
  test("two such subfolders are both read, in name order", () => {
    expect(subdirsReadInNameOrder(shipped)).toBeNull();
  });
  test("node_modules and dot-directories are skipped", () => {
    expect(skipsNodeModulesAndDotDirs(shipped)).toBeNull();
  });
  test("tsconfigs only under node_modules and a dot-directory are no TS stack", () => {
    expect(onlySkippedDirsIsNoStack(shipped)).toBeNull();
  });
  test("a tsconfig two levels down is not read", () => {
    expect(onlyOneLevelDown(shipped)).toBeNull();
  });
});

describe("AC-STE-737.2 — a Rust project is named as unsupported", () => {
  test("Cargo.toml at the root: regex-fallback, zero modules, a warning naming Rust and Cargo.toml", () => {
    expect(rustAtRootWarns(shipped)).toBeNull();
  });
  test("Cargo.toml one folder down: the same warning", () => {
    expect(rustOneLevelDownWarns(shipped)).toBeNull();
  });
  test("a detected Python stack suppresses the Rust warning", () => {
    expect(rustWithPythonDoesNotWarn(shipped)).toBeNull();
  });
  test("no Cargo.toml, no Rust warning", () => {
    expect(bareProjectHasNoRustWarning(shipped)).toBeNull();
  });
});

describe("AC-STE-737.2 — /docs --full writes the extractor's warnings under the regex-fallback banner", () => {
  const skill = readFileSync(join(PLUGIN_ROOT, "skills", "docs", "SKILL.md"), "utf-8");
  const BANNER =
    "<!-- WARNING: This reference was generated without mechanical signature extraction for this stack. Signatures may be imprecise. Review carefully before publishing. -->";
  const start = skill.indexOf("5. **Non-TS stack banner.**");
  const end = skill.indexOf("6. **Full-tree diff + approval.**");
  const step5 = start >= 0 && end > start ? skill.slice(start, end) : "";

  test("step 5 is still the one banner step, edited in place, ahead of step 6", () => {
    expect({ start: start >= 0, ordered: end > start }).toEqual({ start: true, ordered: true });
    expect(skill.split("**Non-TS stack banner.**").length - 1).toBe(1);
    expect(step5.split(BANNER).length - 1).toBe(1);
  });

  test("step 5 writes each of ground.warnings as a comment line under the banner", () => {
    expect(step5).toContain("ground.warnings");
    expect(step5).toMatch(/\beach\b/i);
    expect(step5).toMatch(/comment line/i);
    expect(step5).toMatch(/\b(under|below|after)\b[^.]*banner/i);
  });
});

describe("AC-STE-737.3 — a root tsconfig.json gets the v3.3.0 strategy, modules and warnings", () => {
  for (const c of ROOT_CASES) {
    test(c.name, () => {
      expect(sameAsV330(shipped, v330, c)).toBeNull();
    });
  }
});

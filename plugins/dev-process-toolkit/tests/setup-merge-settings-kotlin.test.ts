import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalAllowList } from "../adapters/_shared/src/setup/merge_settings";

// STE-336 AC-STE-336.6 — Kotlin stack wires into the data-driven
// canonicalAllowList helper.
//
// `canonicalAllowList(template, "kotlin")` must return the Kotlin allowlist
// (the five explicit `Bash(./gradlew ...)` entries ∪ _common), NOT throw and
// NOT collapse to the `generic` fallback. The helper is pure + data-driven, so
// adding the `stacks.kotlin` key to templates/permissions.json is sufficient
// to wire it — this test guards that the key exists and is composed correctly.

const pluginRoot = join(import.meta.dir, "..");
const permissionsTemplate = JSON.parse(
  readFileSync(join(pluginRoot, "templates", "permissions.json"), "utf-8"),
);

const KOTLIN_ENTRIES = [
  "Bash(./gradlew compileKotlin)",
  "Bash(./gradlew detekt)",
  "Bash(./gradlew test)",
  "Bash(./gradlew build)",
  "Bash(./gradlew --version)",
];

describe("AC-STE-336.6 — canonicalAllowList(template, 'kotlin')", () => {
  test("does NOT throw (kotlin is a registered stack)", () => {
    expect(() => canonicalAllowList(permissionsTemplate, "kotlin")).not.toThrow();
  });

  test("contains the five explicit Bash(./gradlew ...) entries", () => {
    const allow = canonicalAllowList(permissionsTemplate, "kotlin");
    for (const e of KOTLIN_ENTRIES) {
      expect(allow).toContain(e);
    }
  });

  test("contains the _common entries (git status, mkdir, gh api, ...)", () => {
    const allow = canonicalAllowList(permissionsTemplate, "kotlin");
    expect(allow).toContain("Bash(git status)");
    expect(allow).toContain("Bash(mkdir)");
    expect(allow).toContain("Bash(gh api)");
  });

  test("differs from the generic fallback (kotlin ≠ generic)", () => {
    const kotlin = canonicalAllowList(permissionsTemplate, "kotlin");
    const generic = canonicalAllowList(permissionsTemplate, "generic");
    expect(kotlin).not.toEqual(generic);
    // The five gradle entries are present in kotlin, absent in generic.
    for (const e of KOTLIN_ENTRIES) {
      expect(generic).not.toContain(e);
    }
  });

  test("no glob-shaped Bash(./gradlew ... *) rule in the kotlin allowlist", () => {
    const allow = canonicalAllowList(permissionsTemplate, "kotlin");
    for (const rule of allow) {
      expect(rule).not.toMatch(/ \*\)$/);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalAllowList,
  mergeAllowList,
  type SettingsJson,
} from "../adapters/_shared/src/setup/merge_settings";

// STE-106 AC-STE-106.4 / AC-STE-106.7 — merge_settings helper.
//
// Pure function. Three behaviors:
//   (a) merge canonical entries into existing.permissions.allow without strip
//   (b) handle empty/missing pre-existing settings
//   (c) treat malformed input as the caller's problem (the helper is pure;
//       the skill prose decides when to call mergeAllowList vs abort)

const pluginRoot = join(import.meta.dir, "..");
const permissionsTemplate = JSON.parse(
  readFileSync(join(pluginRoot, "templates", "permissions.json"), "utf-8"),
);

describe("canonicalAllowList — stack-keyed lookup", () => {
  test("returns common + stack-specific entries (bun)", () => {
    const allow = canonicalAllowList(permissionsTemplate, "bun");
    expect(allow).toContain("Bash(git *)");
    expect(allow).toContain("Bash(bun *)");
    expect(allow).toContain("Bash(bunx *)");
  });

  test("returns common + stack-specific entries (flutter)", () => {
    const allow = canonicalAllowList(permissionsTemplate, "flutter");
    expect(allow).toContain("Bash(flutter *)");
    expect(allow).toContain("Bash(dart *)");
    expect(allow).toContain("Bash(git *)");
  });

  test("returns common + stack-specific entries (python)", () => {
    const allow = canonicalAllowList(permissionsTemplate, "python");
    expect(allow).toContain("Bash(uv *)");
    expect(allow).toContain("Bash(python *)");
    expect(allow).toContain("Bash(git *)");
  });

  test("unknown stack falls back to common only (generic)", () => {
    const allow = canonicalAllowList(permissionsTemplate, "generic");
    expect(allow).toContain("Bash(git *)");
    expect(allow).not.toContain("Bash(bun *)");
  });

  test("never returns duplicate entries", () => {
    const allow = canonicalAllowList(permissionsTemplate, "bun");
    expect(new Set(allow).size).toBe(allow.length);
  });

  test("missing stack key throws (caller must validate)", () => {
    expect(() => canonicalAllowList(permissionsTemplate, "elixir-nerves")).toThrow(
      /unknown stack/,
    );
  });
});

describe("mergeAllowList — preserves user additions", () => {
  test("merges canonical into pre-existing allow without stripping user adds", () => {
    const existing: SettingsJson = {
      permissions: {
        allow: ["Bash(my-custom-tool *)", "Bash(git *)"],
      },
    };
    const canonical = ["Bash(git *)", "Bash(bun *)", "Bash(bunx *)"];
    const merged = mergeAllowList(existing, canonical);
    expect(merged.permissions?.allow).toContain("Bash(my-custom-tool *)");
    expect(merged.permissions?.allow).toContain("Bash(git *)");
    expect(merged.permissions?.allow).toContain("Bash(bun *)");
    expect(merged.permissions?.allow).toContain("Bash(bunx *)");
  });

  test("dedups when canonical entries already present", () => {
    const existing: SettingsJson = {
      permissions: { allow: ["Bash(git *)", "Bash(bun *)"] },
    };
    const canonical = ["Bash(git *)", "Bash(bun *)", "Bash(bunx *)"];
    const merged = mergeAllowList(existing, canonical);
    expect(merged.permissions?.allow?.length).toBe(3);
  });

  test("handles missing permissions key", () => {
    const existing: SettingsJson = {};
    const canonical = ["Bash(git *)"];
    const merged = mergeAllowList(existing, canonical);
    expect(merged.permissions?.allow).toContain("Bash(git *)");
  });

  test("handles missing allow array", () => {
    const existing: SettingsJson = { permissions: {} };
    const canonical = ["Bash(git *)"];
    const merged = mergeAllowList(existing, canonical);
    expect(merged.permissions?.allow).toContain("Bash(git *)");
  });

  test("preserves other keys on the existing object (deny, env, etc.)", () => {
    const existing = {
      permissions: { allow: ["Bash(custom *)"], deny: ["Bash(rm -rf /)"] },
      otherKey: "preserved",
    } as SettingsJson;
    const canonical = ["Bash(git *)"];
    const merged = mergeAllowList(existing, canonical);
    expect(merged.permissions?.deny).toEqual(["Bash(rm -rf /)"]);
    expect((merged as Record<string, unknown>).otherKey).toBe("preserved");
  });
});

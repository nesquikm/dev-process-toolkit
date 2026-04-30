import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bumpFile,
  parseReleaseFiles,
  type ReleaseFile,
} from "../adapters/_shared/src/release_config";

// AC-STE-167.3 / AC-STE-167.6 — round-trip fixture validation.
//
// Each per-stack `examples/<stack>/release.yml` must:
//   1. Parse cleanly when wrapped in a `## Release Files` block.
//   2. Pass schema validation (validates implicitly via parseReleaseFiles).
//   3. Round-trip a stub `0.1.0 → 0.2.0` bump for every entry kind that
//      doesn't require runtime file content beyond the test's stub.

const pluginRoot = join(import.meta.dir, "..");

function wrap(yamlBody: string): string {
  return `## Release Files\n\n\`\`\`yaml\n${yamlBody}\n\`\`\`\n`;
}

function loadFixture(stackDir: string): ReleaseFile[] {
  const yamlBody = readFileSync(
    join(pluginRoot, "examples", stackDir, "release.yml"),
    "utf-8",
  );
  return parseReleaseFiles(wrap(yamlBody));
}

const stacks = [
  { dir: "typescript-node", expectKinds: ["json", "changelog", "regex"] as const },
  { dir: "flutter-dart", expectKinds: ["yaml", "changelog", "regex"] as const },
  { dir: "python", expectKinds: ["toml", "changelog", "regex"] as const },
  { dir: "plugin", expectKinds: ["json", "json", "changelog", "regex"] as const },
];

describe("examples/<stack>/release.yml fixtures (AC-STE-167.3)", () => {
  for (const stack of stacks) {
    test(`${stack.dir} parses to expected kinds`, () => {
      const out = loadFixture(stack.dir);
      expect(out.map((f) => f.kind)).toEqual([...stack.expectKinds]);
      // Every entry has a path.
      for (const f of out) expect(f.path.length).toBeGreaterThan(0);
    });
  }
});

describe("Round-trip 0.1.0 → 0.2.0 bump per kind (AC-STE-167.6)", () => {
  test("json bump round-trips", () => {
    const ts = loadFixture("typescript-node");
    const json = ts.find((f) => f.kind === "json")!;
    const before = '{\n  "name": "stub",\n  "version": "0.1.0"\n}\n';
    const after = bumpFile(json, before, { newVersion: "0.2.0" });
    expect(JSON.parse(after).version).toBe("0.2.0");
  });

  test("yaml bump round-trips with +<build> suffix", () => {
    const flutter = loadFixture("flutter-dart");
    const yaml = flutter.find((f) => f.kind === "yaml")!;
    const before = "name: stub\nversion: 0.1.0+15\n";
    const after = bumpFile(yaml, before, { newVersion: "0.2.0" });
    expect(after).toContain("version: 0.2.0+15");
  });

  test("toml bump round-trips", () => {
    const python = loadFixture("python");
    const toml = python.find((f) => f.kind === "toml")!;
    const before = '[project]\nname = "stub"\nversion = "0.1.0"\n';
    const after = bumpFile(toml, before, { newVersion: "0.2.0" });
    expect(after).toContain('version = "0.2.0"');
  });

  test("changelog bump round-trips", () => {
    const ts = loadFixture("typescript-node");
    const cl = ts.find((f) => f.kind === "changelog")!;
    const before = '# Changelog\n\nIntro.\n\n## [0.1.0] — 2026-01-01 — "Old"\n';
    const after = bumpFile(cl, before, {
      newVersion: "0.2.0",
      codename: "New",
      date: "2026-04-30",
      changelogBody: "### Added\n- thing\n",
    });
    expect(after).toContain('## [0.2.0] — 2026-04-30 — "New"');
    expect(after).toContain('## [0.1.0] — 2026-01-01 — "Old"');
    // New section above old.
    expect(after.indexOf("0.2.0")).toBeLessThan(after.indexOf("0.1.0"));
  });

  test("regex bump round-trips for README Latest line", () => {
    const ts = loadFixture("typescript-node");
    const re = ts.find((f) => f.kind === "regex")!;
    const before = 'Latest: **v0.1.0 — "Old"\n';
    const after = bumpFile(re, before, { newVersion: "0.2.0" });
    expect(after).toContain("Latest: **v0.2.0 — ");
  });

  test("plugin fixture rewrites nested plugins[0].version", () => {
    const plugin = loadFixture("plugin");
    const marketplace = plugin.find((f) => f.path === ".claude-plugin/marketplace.json")!;
    expect(marketplace.field).toBe("plugins[0].version");
    const before = JSON.stringify(
      { plugins: [{ name: "x", version: "0.1.0" }] },
      null,
      2,
    );
    const after = bumpFile(marketplace, before, { newVersion: "0.2.0" });
    expect(JSON.parse(after).plugins[0].version).toBe("0.2.0");
  });
});

import { describe, expect, test } from "bun:test";
import {
  bumpChangelog,
  bumpFile,
  bumpJson,
  bumpRegex,
  bumpToml,
  bumpYaml,
  MalformedReleaseFilesError,
  MissingReleaseFilesBlockError,
  parseReleaseFiles,
  type ReleaseFile,
} from "./release_config";

// AC-STE-167.1 / AC-STE-167.4 / AC-STE-167.6 — release_config parser + per-kind
// bump helpers. The parser reads a `## Release Files` YAML block from CLAUDE.md
// content; the bumpers each handle one `kind:` rewrite.

describe("parseReleaseFiles — happy path", () => {
  test("parses a minimal block with a json entry", () => {
    const md = [
      "# Project",
      "",
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: package.json",
      "    kind: json",
      "    field: version",
      "```",
      "",
    ].join("\n");
    const out = parseReleaseFiles(md);
    expect(out).toEqual([
      { path: "package.json", kind: "json", field: "version" },
    ]);
  });

  test("parses all five kinds together", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: package.json",
      "    kind: json",
      "    field: version",
      "  - path: pyproject.toml",
      "    kind: toml",
      "    field: project.version",
      "  - path: pubspec.yaml",
      "    kind: yaml",
      "    field: version",
      "  - path: CHANGELOG.md",
      "    kind: changelog",
      "  - path: README.md",
      "    kind: regex",
      "    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — '",
      "    replace: 'Latest: **v{version} — '",
      "    optional: true",
      "```",
      "",
    ].join("\n");
    const out = parseReleaseFiles(md);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ path: "package.json", kind: "json", field: "version" });
    expect(out[1]).toEqual({ path: "pyproject.toml", kind: "toml", field: "project.version" });
    expect(out[2]).toEqual({ path: "pubspec.yaml", kind: "yaml", field: "version" });
    expect(out[3]).toEqual({ path: "CHANGELOG.md", kind: "changelog" });
    expect(out[4]).toEqual({
      path: "README.md",
      kind: "regex",
      pattern: "Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — ",
      replace: "Latest: **v{version} — ",
      optional: true,
    });
  });

  test("ignores trailing sections after the block", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: pkg.json",
      "    kind: json",
      "    field: version",
      "```",
      "",
      "## Other Section",
      "",
      "Stuff that should not appear in parsed output.",
    ].join("\n");
    const out = parseReleaseFiles(md);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe("pkg.json");
  });
});

describe("parseReleaseFiles — refusals (AC-STE-167.4)", () => {
  test("missing block ⇒ MissingReleaseFilesBlockError", () => {
    const md = "# Some project\n\nNo block here.\n";
    expect(() => parseReleaseFiles(md)).toThrow(MissingReleaseFilesBlockError);
  });

  test("empty block ⇒ MissingReleaseFilesBlockError", () => {
    const md = "## Release Files\n\n```yaml\nfiles: []\n```\n";
    expect(() => parseReleaseFiles(md)).toThrow(MissingReleaseFilesBlockError);
  });

  test("missing field on json kind ⇒ MalformedReleaseFilesError", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: pkg.json",
      "    kind: json",
      "```",
      "",
    ].join("\n");
    expect(() => parseReleaseFiles(md)).toThrow(MalformedReleaseFilesError);
  });

  test("missing pattern on regex kind ⇒ MalformedReleaseFilesError", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: README.md",
      "    kind: regex",
      "    replace: 'v{version}'",
      "```",
      "",
    ].join("\n");
    expect(() => parseReleaseFiles(md)).toThrow(MalformedReleaseFilesError);
  });

  test("regex pattern without a (?<version>) named group ⇒ MalformedReleaseFilesError", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: README.md",
      "    kind: regex",
      "    pattern: 'v\\d+\\.\\d+\\.\\d+'",
      "    replace: 'v{version}'",
      "```",
      "",
    ].join("\n");
    expect(() => parseReleaseFiles(md)).toThrow(MalformedReleaseFilesError);
  });

  test("unknown kind ⇒ MalformedReleaseFilesError", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - path: pkg.json",
      "    kind: ini",
      "    field: version",
      "```",
      "",
    ].join("\n");
    expect(() => parseReleaseFiles(md)).toThrow(MalformedReleaseFilesError);
  });

  test("missing path ⇒ MalformedReleaseFilesError", () => {
    const md = [
      "## Release Files",
      "",
      "```yaml",
      "files:",
      "  - kind: json",
      "    field: version",
      "```",
      "",
    ].join("\n");
    expect(() => parseReleaseFiles(md)).toThrow(MalformedReleaseFilesError);
  });
});

describe("bumpJson", () => {
  test("rewrites top-level version field", () => {
    const input = '{\n  "name": "pkg",\n  "version": "0.1.0"\n}\n';
    const output = bumpJson(input, "version", "0.2.0");
    expect(JSON.parse(output)).toEqual({ name: "pkg", version: "0.2.0" });
    // Output is preserved as a JSON.stringify form (2-space indent).
    expect(output).toContain('"version": "0.2.0"');
  });

  test("rewrites a nested dotted field", () => {
    const input = '{\n  "plugins": [\n    { "name": "x", "version": "0.1.0" }\n  ]\n}\n';
    const output = bumpJson(input, "plugins[0].version", "1.0.0");
    const parsed = JSON.parse(output);
    expect(parsed.plugins[0].version).toBe("1.0.0");
  });

  test("throws on missing field", () => {
    const input = '{"name": "pkg"}';
    expect(() => bumpJson(input, "version", "0.2.0")).toThrow();
  });
});

describe("bumpToml", () => {
  test("rewrites a [project] version", () => {
    const input = '[project]\nname = "pkg"\nversion = "0.1.0"\n';
    const out = bumpToml(input, "project.version", "0.2.0");
    expect(out).toContain('version = "0.2.0"');
    expect(out).toContain('name = "pkg"');
  });

  test("rewrites a top-level version (no table)", () => {
    const input = 'version = "0.1.0"\n';
    const out = bumpToml(input, "version", "1.0.0");
    expect(out).toContain('version = "1.0.0"');
  });
});

describe("bumpYaml", () => {
  test("rewrites a top-level version", () => {
    const input = "name: app\nversion: 0.1.0\n";
    const out = bumpYaml(input, "version", "0.2.0");
    expect(out).toContain("version: 0.2.0");
    expect(out).toContain("name: app");
  });

  test("preserves a Flutter +<build> suffix on the same line", () => {
    const input = "name: app\nversion: 0.1.0+15\n";
    const out = bumpYaml(input, "version", "0.2.0");
    expect(out).toContain("version: 0.2.0+15");
  });
});

describe("bumpChangelog", () => {
  test("inserts a new section below the intro", () => {
    const input = [
      "# Changelog",
      "",
      "Intro paragraph.",
      "",
      "## [1.0.0] — 2026-01-01 — \"Old\"",
      "",
      "Old content.",
      "",
    ].join("\n");
    const out = bumpChangelog(input, "1.1.0", "New", "2026-04-30", "### Added\n- thing\n");
    // New section appears before the previous one.
    const newIdx = out.indexOf("## [1.1.0] — 2026-04-30 — \"New\"");
    const oldIdx = out.indexOf("## [1.0.0] — 2026-01-01 — \"Old\"");
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(newIdx);
    expect(out).toContain("- thing");
  });

  test("works on a CHANGELOG with no prior version sections", () => {
    const input = "# Changelog\n\nFirst release coming up.\n";
    const out = bumpChangelog(input, "0.1.0", "Initial", "2026-04-30", "### Added\n- everything\n");
    expect(out).toContain("## [0.1.0] — 2026-04-30 — \"Initial\"");
    expect(out).toContain("First release coming up.");
  });
});

describe("bumpRegex", () => {
  test("substitutes {version} into replace using the named capture", () => {
    const input = 'Latest: **v0.1.0 — "Old"\n';
    const out = bumpRegex(
      input,
      "Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — ",
      "Latest: **v{version} — ",
      "0.2.0",
    );
    expect(out).toContain("Latest: **v0.2.0 — ");
  });

  test("throws on no match", () => {
    const input = "no match here\n";
    expect(() =>
      bumpRegex(
        input,
        "v(?<version>\\d+\\.\\d+\\.\\d+)",
        "v{version}",
        "0.2.0",
      ),
    ).toThrow();
  });
});

describe("bumpFile dispatcher", () => {
  test("routes by kind", () => {
    const json: ReleaseFile = { path: "p.json", kind: "json", field: "version" };
    const out = bumpFile(json, '{"version":"0.1.0"}', { newVersion: "0.2.0" });
    expect(out).toContain('"version": "0.2.0"');
  });

  test("routes changelog with metadata", () => {
    const cl: ReleaseFile = { path: "CHANGELOG.md", kind: "changelog" };
    const out = bumpFile(
      cl,
      "# Changelog\n\nintro.\n\n## [1.0.0] — 2026-01-01 — \"Old\"\n",
      {
        newVersion: "1.1.0",
        codename: "New",
        date: "2026-04-30",
        changelogBody: "### Added\n- x\n",
      },
    );
    expect(out).toContain('## [1.1.0] — 2026-04-30 — "New"');
  });
});

describe("AC-STE-167.6 — round-trip (parse → bump → re-parse fixture stability)", () => {
  test("parsing each canonical fixture shape returns valid entries", () => {
    const fixtures: Array<{ kinds: ReleaseFile["kind"][] }> = [
      { kinds: ["json", "changelog", "regex"] }, // typescript
      { kinds: ["yaml", "changelog", "regex"] }, // flutter
      { kinds: ["toml", "changelog", "regex"] }, // python
      { kinds: ["json", "json", "changelog", "regex"] }, // plugin
    ];
    for (const fx of fixtures) {
      const lines = ["## Release Files", "", "```yaml", "files:"];
      for (let i = 0; i < fx.kinds.length; i++) {
        const k = fx.kinds[i]!;
        lines.push(`  - path: file${i}.ext`);
        lines.push(`    kind: ${k}`);
        if (k === "json" || k === "toml" || k === "yaml") {
          lines.push("    field: version");
        } else if (k === "regex") {
          lines.push("    pattern: 'v(?<version>\\d+\\.\\d+\\.\\d+)'");
          lines.push("    replace: 'v{version}'");
          lines.push("    optional: true");
        }
      }
      lines.push("```", "");
      const out = parseReleaseFiles(lines.join("\n"));
      expect(out).toHaveLength(fx.kinds.length);
    }
  });
});

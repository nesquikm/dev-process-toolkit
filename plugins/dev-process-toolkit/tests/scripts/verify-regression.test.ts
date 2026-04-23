import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchemaLProbe } from "./verify-regression";

// AC-STE-12.8 regression-gate probe-parity coverage. Two layers of tests:
//
//   (1) Direct unit tests for the exported `runSchemaLProbe` helper —
//       fast, no subprocess.
//
//   (2) End-to-end mutation test — copies a fixture CLAUDE.md into a
//       temp dir, injects a `## Task Tracking` line, and invokes
//       verify-regression via a targeted probe run. This proves the
//       operational script actually catches the violation, not just
//       the helper.

const scriptDir = import.meta.dir;
const pluginRoot = join(scriptDir, "..", "..");
const projectsDir = join(pluginRoot, "tests", "fixtures", "projects");

describe("runSchemaLProbe (AC-STE-12.8)", () => {
  test("returns mode=none when CLAUDE.md is missing", () => {
    const result = runSchemaLProbe(join(projectsDir, "__does_not_exist__", "CLAUDE.md"));
    expect(result).toEqual({ mode: "none" });
  });

  test("returns mode=none on mode-none-baseline fixture", () => {
    const path = join(projectsDir, "mode-none-baseline", "CLAUDE.md");
    expect(runSchemaLProbe(path)).toEqual({ mode: "none" });
  });

  test("returns mode=none on mode-none-fresh-setup fixture (AC-STE-8.7)", () => {
    const path = join(projectsDir, "mode-none-fresh-setup", "CLAUDE.md");
    expect(runSchemaLProbe(path)).toEqual({ mode: "none" });
  });

  test("mutation: injecting a `## Task Tracking` line flips probe off mode=none", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dpt-probe-"));
    try {
      const dst = join(tmp, "CLAUDE.md");
      copyFileSync(join(projectsDir, "mode-none-baseline", "CLAUDE.md"), dst);
      // Append a literal Schema L anchor + mode line — simulates a buggy
      // setup or a template leak that would silently break Pattern 9.
      const body = readFileSync(dst, "utf8");
      writeFileSync(dst, body + "\n## Task Tracking\n\nmode: linear\n");
      const probe = runSchemaLProbe(dst);
      expect(probe.mode).toBe("linear");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("mutation: duplicate `## Task Tracking` anchors report malformed (NFR-10)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dpt-probe-"));
    try {
      const dst = join(tmp, "CLAUDE.md");
      writeFileSync(
        dst,
        "# Proj\n\n## Task Tracking\n\nmode: linear\n\n## Task Tracking\n\nmode: jira\n",
      );
      const probe = runSchemaLProbe(dst);
      expect(probe).toEqual({ mode: "malformed", count: 2 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("step 3: parser stops at the next `### ` sub-section heading", () => {
    // Schema L step 3: any `### ` heading terminates key: value parsing.
    // This guards against a stray `### Notes` / `### <anything>` line
    // with a `mode: tricky` entry underneath from overriding the real
    // mode declaration above it.
    const tmp = mkdtempSync(join(tmpdir(), "dpt-probe-"));
    try {
      const dst = join(tmp, "CLAUDE.md");
      writeFileSync(
        dst,
        [
          "# Proj",
          "",
          "## Task Tracking",
          "",
          "mode: linear",
          "mcp_server: linear",
          "jira_ac_field:",
          "",
          "### Notes",
          "- mode: tricky looking entry",
          "",
        ].join("\n"),
      );
      expect(runSchemaLProbe(dst).mode).toBe("linear");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("step 3: parser stops at the next `## ` top-level heading", () => {
    const tmp = mkdtempSync(join(tmpdir(), "dpt-probe-"));
    try {
      const dst = join(tmp, "CLAUDE.md");
      writeFileSync(
        dst,
        [
          "# Proj",
          "",
          "## Task Tracking",
          "",
          "mcp_server: linear",
          "",
          "## Some other section",
          "",
          "mode: tricky",
          "",
        ].join("\n"),
      );
      // No `mode:` key inside the section → malformed per Schema L.
      expect(runSchemaLProbe(dst)).toEqual({ mode: "malformed", count: 1 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("mutation: commented `## Task Tracking` in trailing HTML comment still trips probe", () => {
    // Guards AC-STE-8.6 semantics: the probe is a literal grep and CANNOT
    // distinguish commented from live headings. If someone re-adds the
    // heading inside a template comment, this must surface as a probe
    // miss — forcing the fix back into the template, not the probe.
    const tmp = mkdtempSync(join(tmpdir(), "dpt-probe-"));
    try {
      const dst = join(tmp, "CLAUDE.md");
      writeFileSync(dst, "# Proj\n\n<!--\n## Task Tracking\nmode: linear\n-->\n");
      const probe = runSchemaLProbe(dst);
      // Exactly one anchor, `mode: linear` parsed — probe sees tracker mode.
      expect(probe.mode).toBe("linear");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("verify-regression.ts operational exit (AC-STE-12.8)", () => {
  test("exits 0 in the clean case", () => {
    const result = spawnSync(
      "bun",
      ["run", join(scriptDir, "verify-regression.ts")],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Schema L probe clean: mode-none-baseline");
    expect(result.stdout).toContain("Schema L probe clean: mode-none-fresh-setup");
  });

  // End-to-end mutation — verifies the script's exit code, not just the
  // helper. Because FIXTURES are hard-coded, we mutate in-place under a
  // try/finally that always restores. A crash between mutation and
  // restore would leave the fixture dirty (caught by subsequent CI run);
  // in practice this test completes in milliseconds.
  test("exits 1 when a probe fixture gains a `## Task Tracking` line", () => {
    const claudeMdPath = join(projectsDir, "mode-none-fresh-setup", "CLAUDE.md");
    const original = readFileSync(claudeMdPath, "utf8");
    const mutated = original + "\n## Task Tracking\n\nmode: linear\n";
    try {
      writeFileSync(claudeMdPath, mutated);
      const result = spawnSync(
        "bun",
        ["run", join(scriptDir, "verify-regression.ts")],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      const combined = (result.stdout ?? "") + (result.stderr ?? "");
      expect(combined).toMatch(/SCHEMA L PROBE FAILURE/);
      expect(combined).toContain("mode-none-fresh-setup");
    } finally {
      writeFileSync(claudeMdPath, original);
      if (readFileSync(claudeMdPath, "utf8") !== original) {
        throw new Error(
          "test-tearing: failed to restore mode-none-fresh-setup CLAUDE.md — inspect the file",
        );
      }
      expect(existsSync(claudeMdPath)).toBe(true);
    }
  });
});

import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchemaLProbe } from "./verify-regression";

// AC-STE-12.8 regression-gate probe-parity coverage.
//
// Direct unit tests for the exported `runSchemaLProbe` helper. The pre-M18
// `verify-regression.ts` script-mode (Layer 1 byte-diff + Layer 3 Schema M
// probe) was removed in M39 STE-141 — the operational subprocess tests that
// validated the script-mode entry are no longer applicable.

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


import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupOutputCompletenessProbe } from "../adapters/_shared/src/setup_output_completeness";

// STE-106 AC-STE-106.5 / AC-STE-106.7 — `setup-output-completeness` probe.
//
// Trigger: CLAUDE.md `## Task Tracking` declares `mode: <tracker>` (≠ none),
// then `.mcp.json` MUST exist at project root with a matching `mcpServers`
// entry for that mode.
//
// Fixtures via mkdtempSync:
//   (a) mode: none → vacuous pass (no .mcp.json required)
//   (b) mode: linear + .mcp.json with linear entry → pass
//   (c) mode: linear + .mcp.json missing → fail
//   (d) mode: linear + .mcp.json malformed JSON → fail (parse error)
//   (e) mode: linear + .mcp.json present but no `linear` server → fail
//   (f) CLAUDE.md absent → vacuous pass

const pluginRoot = join(import.meta.dir, "..");

function makeProject(opts: {
  claudeMd?: string | null;
  mcpJson?: string | null;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "setup-output-completeness-"));
  if (opts.claudeMd !== undefined && opts.claudeMd !== null) {
    writeFileSync(join(root, "CLAUDE.md"), opts.claudeMd);
  }
  if (opts.mcpJson !== undefined && opts.mcpJson !== null) {
    writeFileSync(join(root, ".mcp.json"), opts.mcpJson);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-106.5(a) mode: none → vacuous pass", () => {
  test("CLAUDE.md without ## Task Tracking → no violations", async () => {
    const ctx = makeProject({ claudeMd: "# My project\n\nBody.\n" });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("CLAUDE.md with explicit mode: none → vacuous pass", async () => {
    const ctx = makeProject({
      claudeMd: "# Project\n\n## Task Tracking\n\nmode: none\n",
    });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5(b) mode: linear + matching .mcp.json → pass", () => {
  test("linear mode + linear server present → no violations", async () => {
    const claudeMd = "# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n";
    const mcpJson = JSON.stringify({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
    const ctx = makeProject({ claudeMd, mcpJson });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5(c) mode: linear + .mcp.json missing → fail", () => {
  test("violation names .mcp.json + mode + canonical remedy", async () => {
    const claudeMd = "# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n";
    const ctx = makeProject({ claudeMd });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/\.mcp\.json/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(/mode=linear/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5(d) malformed .mcp.json → fail with parse error", () => {
  test("invalid JSON surfaces as a single violation", async () => {
    const claudeMd = "# Project\n\n## Task Tracking\n\nmode: linear\n";
    const ctx = makeProject({ claudeMd, mcpJson: "{ this is not json" });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/parse|malformed/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5(e) mode: linear + no linear server → fail", () => {
  test("present file with wrong server entry flags violation", async () => {
    const claudeMd = "# Project\n\n## Task Tracking\n\nmode: linear\n";
    const mcpJson = JSON.stringify({
      mcpServers: { somethingElse: { type: "stdio", command: "foo" } },
    });
    const ctx = makeProject({ claudeMd, mcpJson });
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/linear/);
      expect(report.violations[0]!.note).toMatch(/missing|absent|not found/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5(f) CLAUDE.md absent → vacuous pass", () => {
  test("no CLAUDE.md at all → no violations", async () => {
    const ctx = makeProject({});
    try {
      const report = await runSetupOutputCompletenessProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-106.5 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `setup-output-completeness`", () => {
    expect(gateCheckSkill).toMatch(/setup-output-completeness/);
  });
});

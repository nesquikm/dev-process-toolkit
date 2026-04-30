import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findVersionFreshnessDrift,
  runRootHygiene,
} from "../adapters/_shared/src/root_hygiene";

// AC-STE-168.1 / AC-STE-168.2 / AC-STE-168.3 / AC-STE-168.4 — gate-check
// probe portability. Probes #9b and #10 must skip cleanly when their
// toolkit-internal path is absent (end-user project) and run unchanged
// when present (toolkit self-run).

const pluginRoot = join(import.meta.dir, "..");

function makeStubProject(opts: { withPluginJson?: boolean; pluginVersion?: string }): {
  dir: string;
  cleanup: () => void;
  specsDir: string;
  pluginJsonPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "gate-check-portability-"));
  const specsDir = join(dir, "specs");
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(
    join(specsDir, "requirements.md"),
    [
      "# Stub project requirements",
      "",
      "## 1. Overview",
      "",
      "Latest shipped release: v0.1.0",
      "",
    ].join("\n"),
  );

  let pluginJsonPath = join(dir, ".claude-plugin", "plugin.json");
  if (opts.withPluginJson) {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      pluginJsonPath,
      JSON.stringify({ name: "stub", version: opts.pluginVersion ?? "0.1.0" }, null, 2) + "\n",
    );
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    specsDir,
    pluginJsonPath,
  };
}

describe("AC-STE-168.1 — probe #9b skips cleanly on end-user projects", () => {
  test("missing plugin.json: returns a `versionFreshnessSkipped` marker, not a drift", () => {
    const ctx = makeStubProject({ withPluginJson: false });
    try {
      const report = runRootHygiene(ctx.specsDir, ctx.pluginJsonPath);
      // No version-mismatch drift surfaces — declared 0.1.0 has no plugin.json baseline to compare against.
      expect(report.freshness.find((d) => d.kind === "version-mismatch")).toBeUndefined();
      // The probe surfaces an explicit n/a marker the caller can render.
      expect(report.versionFreshnessSkipped).toBeDefined();
      expect(report.versionFreshnessSkipped!.reason).toMatch(/no plugin manifest|probe skipped/i);
    } finally {
      ctx.cleanup();
    }
  });

  test("missing plugin.json: drift array contains no version-mismatch noise", () => {
    const ctx = makeStubProject({ withPluginJson: false });
    try {
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      // Drifts may still include "version-unparseable" if requirements.md
      // has no Latest line — but for the stub above, the line is present
      // and the absent plugin.json is the only condition.
      const hasVersionMismatch = drifts.some((d) => d.kind === "version-mismatch");
      expect(hasVersionMismatch).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-168.4 — probe #9b runs unchanged on toolkit self-run", () => {
  test("present plugin.json with matching version: zero drift, no skip marker", () => {
    const ctx = makeStubProject({ withPluginJson: true, pluginVersion: "0.1.0" });
    try {
      const report = runRootHygiene(ctx.specsDir, ctx.pluginJsonPath);
      expect(report.freshness).toEqual([]);
      expect(report.versionFreshnessSkipped).toBeUndefined();
    } finally {
      ctx.cleanup();
    }
  });

  test("present plugin.json with mismatched version: version-mismatch drift fires", () => {
    const ctx = makeStubProject({ withPluginJson: true, pluginVersion: "0.2.0" });
    try {
      const report = runRootHygiene(ctx.specsDir, ctx.pluginJsonPath);
      const mismatch = report.freshness.find((d) => d.kind === "version-mismatch");
      expect(mismatch).toBeDefined();
      expect(report.versionFreshnessSkipped).toBeUndefined();
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-168.2 — probe #10 SKILL.md prose carries existence-guard", () => {
  test("gate-check SKILL.md cites the existence-guard pattern for probe #10", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    // Locate the probe #10 block.
    const probeIdx = skill.indexOf("CLAUDE.md.template branch_template: hygiene");
    expect(probeIdx).toBeGreaterThan(-1);
    // The probe block must mention the existence guard + n/a fall-through.
    const block = skill.slice(probeIdx, probeIdx + 1500);
    expect(block.toLowerCase()).toMatch(/existence|absent|skip/);
    expect(block.toLowerCase()).toMatch(/n\/a|not applicable/);
  });
});

describe("AC-STE-168.3 — end-user fixture passes both probes as `n/a`", () => {
  test("stub end-user project: probe #9b reports skipped, probe #10 prose says skip", () => {
    // Fixture lives under tests/fixtures/end-user-project/.
    const fixtureDir = join(pluginRoot, "tests", "fixtures", "end-user-project");
    const specsDir = join(fixtureDir, "specs");
    const pluginJsonPath = join(fixtureDir, ".claude-plugin", "plugin.json");
    const report = runRootHygiene(specsDir, pluginJsonPath);
    expect(report.versionFreshnessSkipped).toBeDefined();
    // No GATE FAILED-class drift surfaces.
    const blocking = report.freshness.filter(
      (d) => d.kind === "version-mismatch" || d.kind === "in-flight-archived",
    );
    expect(blocking).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findMilestoneLeakage,
  findVersionFreshnessDrift,
  runRootHygiene,
} from "../adapters/_shared/src/root_hygiene";

// AC-STE-59.5 / AC-STE-59.6: the two sub-checks of the "Root spec hygiene"
// probe.
//   (a) Milestone-ID leakage — archived-milestone IDs leaking into live
//       framing (not under the "Shipped milestones" / "Archived context"
//       allowlist) fail the gate.
//   (b) Version/status freshness — requirements.md §1 must name the
//       current plugin.json version and the in-flight milestone (if any)
//       must resolve to a live plan file, not the archive.

function makeSpecsDir(): { root: string; specsDir: string; pluginJsonPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "root-hygiene-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  const pluginJsonPath = join(root, "plugin.json");
  return {
    root,
    specsDir,
    pluginJsonPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeRequirements(specsDir: string, overview: string): void {
  const body = `# Requirements

## 1. Overview

${overview}

## 2. Next

Body.
`;
  writeFileSync(join(specsDir, "requirements.md"), body);
}

function writePluginJson(path: string, version: string): void {
  writeFileSync(path, JSON.stringify({ name: "dpt", version }));
}

describe("AC-STE-59.5(a) — milestone-ID leakage detector", () => {
  test("clean spec with no archived milestone refs reports zero hits", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(ctx.specsDir, "**Latest shipped release:** v1.20.0.\n**In-flight milestone:** M99.");
      writeFileSync(join(ctx.specsDir, "technical-spec.md"), "# Tech\n\n## Schemas\n\nmilestone: M<N>\n");
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n\n## Strategy\n\nNo archived milestones here.\n");
      const hits = findMilestoneLeakage(ctx.specsDir);
      expect(hits).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("archived milestone named in live-framing section is flagged", () => {
    const ctx = makeSpecsDir();
    try {
      // M7 has an archived plan at specs/plan/archive/M7.md.
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M7.md"), "# M7\n");
      writeRequirements(ctx.specsDir, "This plugin replaces the M7-era auto-archival behavior.");
      writeFileSync(join(ctx.specsDir, "technical-spec.md"), "# Tech\n");
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n");
      const hits = findMilestoneLeakage(ctx.specsDir);
      expect(hits.length).toBe(1);
      expect(hits[0]!.milestone).toBe("M7");
      expect(hits[0]!.file).toBe("requirements.md");
      expect(hits[0]!.containingHeading).toBe("1. Overview");
    } finally {
      ctx.cleanup();
    }
  });

  test("archived milestone under 'Shipped milestones' allowlisted heading is NOT flagged", () => {
    const ctx = makeSpecsDir();
    try {
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M7.md"), "# M7\n");
      const body = `# Requirements

## 1. Overview

Current release.

### Shipped milestones

- v1.10 (M7) — auto-archival.

## 2. Next

Body.
`;
      writeFileSync(join(ctx.specsDir, "requirements.md"), body);
      writeFileSync(join(ctx.specsDir, "technical-spec.md"), "# Tech\n");
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n");
      const hits = findMilestoneLeakage(ctx.specsDir);
      expect(hits).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("milestone ID with no archived plan is NOT flagged (live or hypothetical)", () => {
    const ctx = makeSpecsDir();
    try {
      // No specs/plan/archive/M99.md exists.
      writeRequirements(ctx.specsDir, "We plan to ship M99 next release.");
      writeFileSync(join(ctx.specsDir, "technical-spec.md"), "# Tech\n");
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n");
      const hits = findMilestoneLeakage(ctx.specsDir);
      expect(hits).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("flags hits across all three root spec files", () => {
    const ctx = makeSpecsDir();
    try {
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M7.md"), "# M7\n");
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M12.md"), "# M12\n");
      writeRequirements(ctx.specsDir, "M7 behavior lives here.");
      writeFileSync(
        join(ctx.specsDir, "technical-spec.md"),
        "# Tech\n\n## Schemas\n\nM12 was the tracker-integration milestone.\n",
      );
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n");
      const hits = findMilestoneLeakage(ctx.specsDir);
      expect(hits.map((h) => h.file).sort()).toEqual(["requirements.md", "technical-spec.md"]);
      expect(hits.find((h) => h.file === "requirements.md")?.milestone).toBe("M7");
      expect(hits.find((h) => h.file === "technical-spec.md")?.milestone).toBe("M12");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-59.5(b) — version/status freshness detector", () => {
  test("declared version matching plugin.json + no in-flight milestone is clean", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(ctx.specsDir, "**Latest shipped release:** v1.20.0.");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      expect(drifts).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("declared version mismatching plugin.json is flagged with both versions + line", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(ctx.specsDir, "**Latest shipped release:** v1.17.0.");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("version-mismatch");
      expect(drifts[0]!.message).toContain("v1.17.0");
      expect(drifts[0]!.message).toContain("v1.20.0");
      expect(drifts[0]!.line).toBeGreaterThan(0);
    } finally {
      ctx.cleanup();
    }
  });

  test("missing 'Latest shipped release' line is flagged as unparseable", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(ctx.specsDir, "No release metadata here.");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      expect(drifts.map((d) => d.kind)).toContain("version-unparseable");
    } finally {
      ctx.cleanup();
    }
  });

  test("in-flight milestone resolving to an archived plan is flagged", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(
        ctx.specsDir,
        "**Latest shipped release:** v1.20.0.\n**In-flight milestone:** M7.",
      );
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M7.md"), "# M7\n");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      const archivedDrift = drifts.find((d) => d.kind === "in-flight-archived");
      expect(archivedDrift).toBeDefined();
      expect(archivedDrift!.message).toContain("M7");
      expect(archivedDrift!.message).toContain("archive");
    } finally {
      ctx.cleanup();
    }
  });

  test("in-flight milestone with a live plan file is clean", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(
        ctx.specsDir,
        "**Latest shipped release:** v1.20.0.\n**In-flight milestone:** M99.",
      );
      writeFileSync(join(ctx.specsDir, "plan", "M99.md"), "# M99\n");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      expect(drifts).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("in-flight milestone with no plan file at all is flagged as missing", () => {
    const ctx = makeSpecsDir();
    try {
      writeRequirements(
        ctx.specsDir,
        "**Latest shipped release:** v1.20.0.\n**In-flight milestone:** M42.",
      );
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const drifts = findVersionFreshnessDrift(ctx.specsDir, ctx.pluginJsonPath);
      const missingDrift = drifts.find((d) => d.kind === "in-flight-missing-plan");
      expect(missingDrift).toBeDefined();
      expect(missingDrift!.message).toContain("M42");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-59.5 — runRootHygiene aggregate", () => {
  test("aggregates both sub-checks in one pass", () => {
    const ctx = makeSpecsDir();
    try {
      writeFileSync(join(ctx.specsDir, "plan", "archive", "M7.md"), "# M7\n");
      writeRequirements(ctx.specsDir, "M7 behavior lives here.\n**Latest shipped release:** v1.17.0.");
      writeFileSync(join(ctx.specsDir, "technical-spec.md"), "# Tech\n");
      writeFileSync(join(ctx.specsDir, "testing-spec.md"), "# Testing\n");
      writePluginJson(ctx.pluginJsonPath, "1.20.0");
      const report = runRootHygiene(ctx.specsDir, ctx.pluginJsonPath);
      expect(report.leakage.length).toBeGreaterThan(0);
      expect(report.freshness.length).toBeGreaterThan(0);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-59.8 — /gate-check runs clean on this repo's baseline", () => {
  test("the real repo's root specs pass both sub-checks post-FR-D Part 1", () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const specsDir = join(repoRoot, "specs");
    const pluginJsonPath = join(repoRoot, "plugins", "dev-process-toolkit", ".claude-plugin", "plugin.json");
    const report = runRootHygiene(specsDir, pluginJsonPath);
    if (report.leakage.length > 0 || report.freshness.length > 0) {
      const detail = [
        ...report.leakage.map(
          (h) => `LEAK ${h.file}:${h.line}: archived milestone ${h.milestone} under heading "${h.containingHeading}"`,
        ),
        ...report.freshness.map((d) => `FRESH ${d.file}:${d.line ?? "-"}: ${d.kind} — ${d.message}`),
      ].join("\n");
      throw new Error(`root-hygiene self-check failed on this repo:\n${detail}`);
    }
    expect(report.leakage).toEqual([]);
    expect(report.freshness).toEqual([]);
  });
});

describe("AC-STE-59.5 prose assertions on gate-check SKILL.md", () => {
  test("gate-check SKILL.md includes the Root spec hygiene check", () => {
    const skillPath = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    const body = readFileSync(skillPath, "utf8");
    expect(body).toMatch(/Root spec hygiene/);
  });

  test("gate-check SKILL.md names both sub-checks", () => {
    const skillPath = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    const body = readFileSync(skillPath, "utf8");
    expect(body).toMatch(/[Mm]ilestone.?ID leakage|milestone-ID leakage/);
    expect(body).toMatch(/[Vv]ersion.*freshness|version\/status freshness/);
  });

  test("gate-check SKILL.md references the root_hygiene helper", () => {
    const skillPath = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    const body = readFileSync(skillPath, "utf8");
    expect(body).toMatch(/root_hygiene|runRootHygiene/);
  });
});

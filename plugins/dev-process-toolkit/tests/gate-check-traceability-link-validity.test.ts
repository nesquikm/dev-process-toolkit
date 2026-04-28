import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTraceabilityLinkValidityProbe } from "../adapters/_shared/src/traceability_link_validity";

// STE-111 AC-STE-111.4 — `traceability-link-validity` probe.
//
// Every `frs/<id>.md` link in `specs/requirements.md` and `specs/plan/<M>.md`
// must resolve to an existing file (either `specs/frs/<id>.md` or
// `specs/frs/archive/<id>.md`). Broken links → fail.
//
// Five fixtures:
//   (a) link to live FR file → pass
//   (b) link to archived FR file → pass
//   (c) link to non-existent FR (broken — file is in archive but link points to live) → fail
//   (d) no links at all → vacuous pass
//   (e) `specs/` absent → vacuous pass

const pluginRoot = join(import.meta.dir, "..");

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "traceability-link-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-111.4(a) link to live FR → pass", () => {
  test("requirements.md row pointing at frs/<id>.md → no violations", async () => {
    const ctx = makeProject({
      "specs/requirements.md": "| STE-100 | Hello | [link](frs/STE-100.md) |\n",
      "specs/frs/STE-100.md": "---\ntitle: x\n---\nbody\n",
    });
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.4(b) link to archived FR → pass", () => {
  test("requirements.md row pointing at frs/archive/<id>.md → no violations", async () => {
    const ctx = makeProject({
      "specs/requirements.md": "| STE-100 | Hello | [link](frs/archive/STE-100.md) |\n",
      "specs/frs/archive/STE-100.md": "---\ntitle: x\n---\nbody\n",
    });
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.4(c) broken link (live points but file is in archive) → fail", () => {
  test("violation flags the unrewritten link", async () => {
    const ctx = makeProject({
      "specs/requirements.md": "| STE-100 | Hello | [link](frs/STE-100.md) |\n",
      "specs/frs/archive/STE-100.md": "---\ntitle: x\n---\nbody\n",
    });
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/specs\/requirements\.md:\d+/);
      expect(v.note).toMatch(/STE-100/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      ctx.cleanup();
    }
  });

  test("plan file with broken link also flagged", async () => {
    const ctx = makeProject({
      "specs/plan/M29.md": "Body links [STE-100](../frs/STE-100.md).\n",
      "specs/frs/archive/STE-100.md": "---\n---\nbody\n",
    });
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/specs\/plan\/M29\.md/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.4(d) no traceability links → vacuous pass", () => {
  test("requirements.md without any frs link → no violations", async () => {
    const ctx = makeProject({
      "specs/requirements.md": "# Requirements\n\nNo links here.\n",
    });
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.4(e) specs/ absent → vacuous pass", () => {
  test("project without specs/ → no violations", async () => {
    const ctx = makeProject({});
    try {
      const report = await runTraceabilityLinkValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.4 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `traceability-link-validity`", () => {
    expect(gateCheckSkill).toMatch(/traceability-link-validity/);
  });
});

describe("AC-STE-111.4 — runs green on this repo's baseline", () => {
  test("the live repo's traceability links all resolve", async () => {
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runTraceabilityLinkValidityProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

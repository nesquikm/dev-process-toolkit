import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArchivePlanStatusProbe } from "../adapters/_shared/src/archive_plan_status";

// AC-STE-92.5 — probe #16 "Archive plan-status invariant" integration test.
//
// Five fixtures (in-memory via mkdtempSync — AC-STE-92.5 forbids new fixture dirs):
//   (a) positive: every archive plan carries status: archived + non-null archived_at → no violations
//   (b) negative: status: active   → violation, NFR-10 canonical shape
//   (c) negative: status: complete → violation
//   (d) negative: status: draft    → violation
//   (e) negative: missing archived_at → violation
//
// Test-file naming follows STE-82: `gate-check-<slug>.test.ts`.

const pluginRoot = join(import.meta.dir, "..");

function makeArchiveDir(): { root: string; archiveDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "archive-plan-status-"));
  const archiveDir = join(root, "specs", "plan", "archive");
  mkdirSync(archiveDir, { recursive: true });
  return { root, archiveDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writePlan(
  archiveDir: string,
  name: string,
  fields: { status?: string | null; archived_at?: string | null; extra?: string },
): void {
  const lines = ["---", `milestone: ${name.replace(/\.md$/, "")}`];
  if (fields.status !== undefined) {
    lines.push(`status: ${fields.status === null ? "null" : fields.status}`);
  }
  if (fields.archived_at !== undefined) {
    lines.push(`archived_at: ${fields.archived_at === null ? "null" : fields.archived_at}`);
  }
  if (fields.extra) lines.push(fields.extra);
  lines.push("---", "", `# ${name.replace(/\.md$/, "")}`, "", "Body.", "");
  writeFileSync(join(archiveDir, name), lines.join("\n"));
}

describe("AC-STE-92.5(a) positive — clean archive passes", () => {
  test("all plans status:archived + non-null archived_at → zero violations", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M1.md", {
        status: "archived",
        archived_at: "2026-01-01T00:00:00Z",
      });
      writePlan(ctx.archiveDir, "M2.md", {
        status: "archived",
        archived_at: "2026-02-01T12:34:56+04:00",
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.5(b) negative — status: active fails", () => {
  test("flips to violation naming file + observed/expected", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M20.md", {
        status: "active",
        archived_at: "2026-04-24T00:00:00Z",
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M20.md");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.note).toMatch(/^specs\/plan\/archive\/M20\.md:\d+ — /);
      expect(v.note).toMatch(/active/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.5(c) negative — status: complete fails", () => {
  test("non-canonical legacy value fails the probe", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M5.md", {
        status: "complete",
        archived_at: "2026-03-01T00:00:00Z",
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/complete/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.5(d) negative — status: draft fails", () => {
  test("draft (a milestone never bumped past initial) fails the probe", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M16.md", {
        status: "draft",
        archived_at: "2026-03-15T00:00:00Z",
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/draft/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.5(e) negative — missing archived_at fails", () => {
  test("status: archived but archived_at null fails the probe", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M12.md", {
        status: "archived",
        archived_at: null,
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/archived_at/);
    } finally {
      ctx.cleanup();
    }
  });

  test("status: archived but archived_at key absent entirely fails the probe", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M13.md", {
        status: "archived",
        // archived_at omitted
      });
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/archived_at/);
    } finally {
      ctx.cleanup();
    }
  });

  test("status: archived but archived_at: (bare key, no value) fails the probe", async () => {
    // parseFrontmatter returns `{}` for the bare-key form. Without the
    // empty-object guard, the violation slips past the predicate.
    const ctx = makeArchiveDir();
    try {
      const body = `---\nmilestone: M14\nstatus: archived\narchived_at:\n---\n\n# M14\n\nBody.\n`;
      writeFileSync(join(ctx.archiveDir, "M14.md"), body);
      const report = await runArchivePlanStatusProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/archived_at/);
      expect(report.violations[0]!.note).toMatch(/bare-key|<missing>/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.5 — multiple violations aggregate per file", () => {
  test("two bad plans yield two violations in deterministic order", async () => {
    const ctx = makeArchiveDir();
    try {
      writePlan(ctx.archiveDir, "M1.md", { status: "complete", archived_at: null });
      writePlan(ctx.archiveDir, "M2.md", { status: "active", archived_at: "2026-04-24T00:00:00Z" });
      const report = await runArchivePlanStatusProbe(ctx.root);
      // M1 has both status drift and missing archived_at — but the probe
      // emits one violation per file (the rendered note covers both
      // dimensions). The downstream gate-check renderer just needs file
      // identity to point the operator at the broken plan.
      expect(report.violations.length).toBeGreaterThanOrEqual(2);
      const files = report.violations.map((v) => v.file);
      expect(files.some((f) => f.includes("M1.md"))).toBe(true);
      expect(files.some((f) => f.includes("M2.md"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-92.7 — runs green on real repo state after backfill", () => {
  test("the live specs/plan/archive/ tree passes the probe", async () => {
    // The same probe applied to the actual repo. After STE-92's backfill
    // commit, every archive plan must satisfy the invariant — this is the
    // dogfood assertion the FR closes the loop on.
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runArchivePlanStatusProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

describe("AC-STE-92.4 — SKILL.md prose declares probe #16", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );

  test("SKILL.md contains a probe #16 entry titled 'Archive plan-status invariant'", () => {
    expect(gateCheckSkill).toMatch(/16\.\s+\*\*Archive plan-status invariant/i);
  });

  test("probe #16 references the archive_plan_status module + STE-82 test file name", () => {
    expect(gateCheckSkill).toMatch(/archive_plan_status/);
    expect(gateCheckSkill).toMatch(/gate-check-archive-plan-status\.test\.ts/);
  });

  test("probe #16 names the canonical assertions (status: archived + archived_at non-null)", () => {
    const idx = gateCheckSkill.search(/16\.\s+\*\*Archive plan-status invariant/i);
    expect(idx).toBeGreaterThan(-1);
    const block = gateCheckSkill.slice(idx, idx + 2000);
    expect(block).toMatch(/status:\s*archived/);
    expect(block).toMatch(/archived_at/);
  });
});

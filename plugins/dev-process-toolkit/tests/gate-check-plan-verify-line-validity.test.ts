import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanVerifyLineValidityProbe } from "../adapters/_shared/src/plan_verify_line_validity";

// STE-126 AC-STE-126.2 — `plan-verify-line-validity` probe (severity: warning).
//
// Scans active `specs/plan/M*.md` (excluding `archive/`) for `verify:` lines
// that reference paths matching obvious filesystem artifacts (e.g.,
// `tests/foo.test.ts`, `src/foo.ts`) and flags any whose referenced path
// no longer resolves to a file in the project tree.
//
// Severity is **warning** (NotesOnly) — the file may have been intentionally
// moved without /implement involvement; a hard fail would be too strict.

const pluginRoot = join(import.meta.dir, "..");

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "plan-verify-line-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-126.2(a) verify line references existing path → no notes", () => {
  test("verify command pointing at a real file → vacuous pass", async () => {
    const ctx = makeProject({
      "specs/plan/M1.md": [
        "- [ ] Run typecheck",
        "  verify: head -1 src/index.ts",
        "",
      ].join("\n"),
      "src/index.ts": "// real file\n",
    });
    try {
      const report = await runPlanVerifyLineValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.2(b) verify line references nonexistent path → note", () => {
  test("stale verify line surfaces as a violation with file:line", async () => {
    const ctx = makeProject({
      "specs/plan/M1.md": [
        "- [ ] Foundation tests",
        "  verify: head -1 tests/.placeholder.test.ts",
        "",
      ].join("\n"),
      // tests/.placeholder.test.ts intentionally absent
    });
    try {
      const report = await runPlanVerifyLineValidityProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/specs\/plan\/M1\.md:\d+/);
      expect(v.note).toMatch(/\.placeholder\.test\.ts/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.severity).toBe("warning");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.2(c) archive plan files NOT scanned", () => {
  test("plan/archive/<M>.md verify line referencing missing file → no notes", async () => {
    const ctx = makeProject({
      "specs/plan/archive/M0.md": [
        "- [x] Done long ago",
        "  verify: head -1 tests/.placeholder.test.ts",
        "",
      ].join("\n"),
    });
    try {
      const report = await runPlanVerifyLineValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.2(d) verify line without a path → no notes", () => {
  test("verify command that's pure prose (no path token) is skipped", async () => {
    const ctx = makeProject({
      "specs/plan/M1.md": [
        "- [ ] Confirm UX",
        "  verify: manually click through the flow",
        "",
      ].join("\n"),
    });
    try {
      const report = await runPlanVerifyLineValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.2 — specs/ absent → vacuous pass", () => {
  test("project without specs/ → no violations", async () => {
    const ctx = makeProject({});
    try {
      const report = await runPlanVerifyLineValidityProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.2 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `plan-verify-line-validity`", () => {
    expect(gateCheckSkill).toMatch(/plan-verify-line-validity/);
  });
});

describe("AC-STE-126.2 — runs green on this repo's baseline", () => {
  test("the live repo's plan-file verify lines all resolve", async () => {
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runPlanVerifyLineValidityProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

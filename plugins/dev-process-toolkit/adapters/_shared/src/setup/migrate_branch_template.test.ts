// STE-388 AC-STE-388.6 — `/setup --migrate` branch_template re-seed.
//
// `reseedBranchTemplate(claudeMdPath, { date })` re-seeds `branch_template:`
// to the canonical `{type}/m{N}-{slug}` when the existing value is
// byte-identical to the retired seeded default `{type}/{ticket-id}-{slug}`;
// any other value is preserved verbatim; an absent key stays absent. The
// re-seed is logged in `## /setup audit`.
//
// Round-trip matrix per the FR's Testing section: retired default → new,
// custom → untouched, absent → untouched (+ already-canonical idempotency).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAuditRow } from "./audit_log";
import { reseedBranchTemplate } from "./migrate_branch_template";

const RETIRED = "{type}/{ticket-id}-{slug}";
const CANONICAL = "{type}/m{N}-{slug}";

function tmpClaudeMd(initial: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "migrate-branch-template-"));
  const path = join(dir, "CLAUDE.md");
  writeFileSync(path, initial);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function claudeMdWith(branchTemplateLine: string | null): string {
  const lines = [
    "# Project",
    "",
    "## Task Tracking",
    "",
    "mode: linear",
    "mcp_server: linear",
    "jira_ac_field:",
  ];
  if (branchTemplateLine !== null) lines.push(branchTemplateLine);
  lines.push("", "### Linear", "", "team: STE", "");
  return lines.join("\n");
}

function branchTemplateAuditRows(content: string) {
  return content
    .split("\n")
    .map((line) => parseAuditRow(line))
    .filter((row) => row !== null && row.field === "branch_template");
}

describe("reseedBranchTemplate — retired default is re-seeded (AC-STE-388.6)", () => {
  test("value byte-identical to the retired seeded default becomes the canonical template", () => {
    const ctx = tmpClaudeMd(claudeMdWith(`branch_template: ${RETIRED}`));
    try {
      const result = reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      expect(result.reseeded).toBe(true);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(`branch_template: ${CANONICAL}`);
      expect(out).not.toContain(`branch_template: ${RETIRED}`);
    } finally {
      ctx.cleanup();
    }
  });

  test("the re-seed is logged in ## /setup audit", () => {
    const ctx = tmpClaudeMd(claudeMdWith(`branch_template: ${RETIRED}`));
    try {
      reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain("## /setup audit");
      const rows = branchTemplateAuditRows(out);
      expect(rows.length).toBe(1);
      expect(rows[0]!.value).toBe(CANONICAL);
      expect(rows[0]!.date).toBe("2026-07-16");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("reseedBranchTemplate — any other value is preserved verbatim (AC-STE-388.6)", () => {
  test("custom template is untouched, no audit row, file byte-identical", () => {
    const initial = claudeMdWith("branch_template: feat/{ticket-id}");
    const ctx = tmpClaudeMd(initial);
    try {
      const result = reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      expect(result.reseeded).toBe(false);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toBe(initial);
      expect(branchTemplateAuditRows(out).length).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  test("near-miss of the retired default (extra suffix) is preserved verbatim", () => {
    const initial = claudeMdWith(`branch_template: ${RETIRED}-x`);
    const ctx = tmpClaudeMd(initial);
    try {
      const result = reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      expect(result.reseeded).toBe(false);
      expect(readFileSync(ctx.path, "utf-8")).toBe(initial);
    } finally {
      ctx.cleanup();
    }
  });

  test("already-canonical value is preserved (idempotent, no audit row)", () => {
    const initial = claudeMdWith(`branch_template: ${CANONICAL}`);
    const ctx = tmpClaudeMd(initial);
    try {
      const result = reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      expect(result.reseeded).toBe(false);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toBe(initial);
      expect(branchTemplateAuditRows(out).length).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("reseedBranchTemplate — absent key stays absent (AC-STE-388.6)", () => {
  test("CLAUDE.md without branch_template: is untouched", () => {
    const initial = claudeMdWith(null);
    const ctx = tmpClaudeMd(initial);
    try {
      const result = reseedBranchTemplate(ctx.path, { date: "2026-07-16" });
      expect(result.reseeded).toBe(false);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toBe(initial);
      expect(out).not.toContain("branch_template:");
    } finally {
      ctx.cleanup();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-173 — /setup SKILL.md step 6b documents best-effort commit-msg hook
// install + the manual cp/chmod fallback. Doc-conformance only; the actual
// hook-install behavior is unchanged.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "setup", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function extractStep6b(body: string): string {
  const start = body.search(/\n### 6b\. Install commit-msg hook/);
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + 1);
  const endRelative = remainder.search(/\n### \d|\n## /);
  return endRelative === -1 ? body.slice(start) : body.slice(start, start + 1 + endRelative);
}

describe("STE-173 AC-STE-173.1 — best-effort install disclaimer in step 6b", () => {
  test("step 6b carries the 'best-effort under non-interactive runs' wording", () => {
    const step = extractStep6b(readSkill());
    expect(step).toMatch(/best-effort/i);
    expect(step).toMatch(/non-interactive|bypassPermissions/i);
  });

  test("step 6b names the model-layer block as the cause + audit-log surface", () => {
    const step = extractStep6b(readSkill());
    expect(step).toMatch(/model-layer|model layer/i);
    expect(step).toMatch(/\.git\/hooks/);
    expect(step).toMatch(/\/setup audit/i);
  });
});

describe("STE-173 AC-STE-173.2 — manual cp+chmod fallback one-liner in step 6b", () => {
  test("step 6b carries the canonical fallback command", () => {
    const step = extractStep6b(readSkill());
    expect(step).toContain(
      "cp plugins/dev-process-toolkit/templates/git-hooks/commit-msg.sh .git/hooks/commit-msg",
    );
    expect(step).toMatch(/chmod \+x .git\/hooks\/commit-msg/);
  });
});

describe("STE-173 AC-STE-173.3 — grep returns the expected match cluster", () => {
  test("grep -nE 'best-effort|chmod \\+x .git/hooks/commit-msg' returns at least 2 matches across the file", () => {
    const body = readSkill();
    const matches = body.match(/best-effort|chmod \+x \.git\/hooks\/commit-msg/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("STE-173 AC-STE-173.4 — audit prose surface is untouched", () => {
  test("the canonical audit appender (audit_log.ts) still exports appendAuditEntry", () => {
    const auditLogPath = join(
      pluginRoot,
      "adapters",
      "_shared",
      "src",
      "setup",
      "audit_log.ts",
    );
    const src = readFileSync(auditLogPath, "utf-8");
    // The setup audit block writer is the canonical surface for audit
    // entries; STE-173 must not touch it.
    expect(src).toMatch(/export (function|const) appendAuditEntry/);
  });

  test("CLAUDE.md.template carries no synthetic `## /setup audit` block (still appender-only)", () => {
    const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
    const tmpl = readFileSync(templatePath, "utf-8");
    // The audit block is appended by /setup at runtime, never baked into
    // the template — STE-173 must not change that.
    expect(tmpl).not.toMatch(/##\s+\/setup audit/i);
  });
});

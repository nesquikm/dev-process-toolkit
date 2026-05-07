// STE-238 AC-STE-238.4 — fixture-driven coverage of the
// closing_summary_capability_keys /gate-check probe.
//
// Variants:
//   (a) all canonical keys carry MUST-emit directives ⇒ pass
//   (b) one key documented in the static map but no MUST-emit directive ⇒ fail
//   (b') zero directives ⇒ every key surfaces a violation
//   (c) paraphrased prose without backticks ⇒ does not satisfy the directive

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";

function newProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "closing-summary-probe-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSpecWriteSkill(root: string, body: string): void {
  const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

function buildAllDirectives(): string {
  return CANONICAL_CAPABILITY_KEYS.map((k) => `- MUST emit \`${k}\` at the documented site.`).join("\n");
}

function buildAllButOneDirectives(skipKey: string): string {
  return CANONICAL_CAPABILITY_KEYS.filter((k) => k !== skipKey)
    .map((k) => `- MUST emit \`${k}\` at the documented site.`)
    .join("\n");
}

describe("AC-STE-238.4 — closing_summary_capability_keys probe", () => {
  test("variant (a): all directives present ⇒ pass", async () => {
    const ctx = newProject();
    try {
      writeSpecWriteSkill(
        ctx.root,
        `# spec-write\n\n## Step 7\n\n${buildAllDirectives()}\n`,
      );
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (b): one directive missing ⇒ fail naming the missing key", async () => {
    const ctx = newProject();
    try {
      const skipKey = "branch_gate_skipped_already_non_main";
      writeSpecWriteSkill(
        ctx.root,
        `# spec-write\n\n## Step 7\n\n${buildAllButOneDirectives(skipKey)}\n`,
      );
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.missingKey).toBe(skipKey);
      expect(v.reason).toContain(skipKey);
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("MUST emit");
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (b'): every missing directive surfaces a separate row", async () => {
    const ctx = newProject();
    try {
      // Skill body contains zero MUST-emit directives.
      writeSpecWriteSkill(ctx.root, "# spec-write\n\n## Step 7\n\nNo directives here.\n");
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      expect(report.violations.length).toBe(CANONICAL_CAPABILITY_KEYS.length);
      const missing = new Set(report.violations.map((v) => v.missingKey));
      for (const key of CANONICAL_CAPABILITY_KEYS) {
        expect(missing.has(key)).toBe(true);
      }
    } finally {
      ctx.cleanup();
    }
  });

  test("paraphrased prose (without backticks) does NOT satisfy the directive", async () => {
    const ctx = newProject();
    try {
      // Body mentions every key as plain text but never with backticked
      // MUST-emit shape — this is exactly the LLM-paraphrase regression
      // STE-238 closes.
      const paraphrased = CANONICAL_CAPABILITY_KEYS.map(
        (k) => `The closing summary mentions ${k} when applicable.`,
      ).join("\n");
      writeSpecWriteSkill(ctx.root, `# spec-write\n\n## Step 7\n\n${paraphrased}\n`);
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      expect(report.violations.length).toBe(CANONICAL_CAPABILITY_KEYS.length);
    } finally {
      ctx.cleanup();
    }
  });
});


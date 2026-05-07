// STE-237 AC-STE-237.3 — fixture-driven coverage of the
// socratic_loop_uses_ask_user_question /gate-check probe.
//
// Variants per AC:
//   (a) Pattern 26 cited + AskUserQuestion blocks present + protocol citation present  ⇒ pass
//   (b) Pattern 26 cited + bare-prose Qs (no AskUserQuestion)                          ⇒ fail (i)
//   (c) Pattern 26 cited + AskUserQuestion present + no protocol citation              ⇒ fail (ii)
//   (d) socratic: true tag + bare-prose Qs                                             ⇒ fail (forward-extension hook)
//   (e) no Pattern 26 / no socratic tag                                                ⇒ vacuous

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runSocraticLoopUsesAskUserQuestionProbe,
} from "../adapters/_shared/src/socratic_loop_uses_ask_user_question";

function newProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "socratic-probe-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(root: string, name: string, body: string): void {
  const dir = join(root, "plugins", "dev-process-toolkit", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

const VARIANT_A_PASS = `---
name: variant-a
---

# Variant A passing fixture

Per Pattern 26 (see docs/auto-mode-protocol.md § Socratic Loop Contract):

\`\`\`
AskUserQuestion: which mode?
\`\`\`
`;

const VARIANT_B_BARE_PROSE = `---
name: variant-b
---

# Variant B failing fixture

Per Pattern 26: ask the user which tracker they want? Then proceed.
Citation: docs/auto-mode-protocol.md § Socratic Loop Contract.
`;

const VARIANT_C_NO_CITATION = `---
name: variant-c
---

# Variant C failing fixture

Per Pattern 26: invoke AskUserQuestion to ask.
`;

const VARIANT_D_SOCRATIC_TAG_BARE = `---
name: variant-d
socratic: true
---

# Variant D forward-extension fixture

Ask the user which mode they want?
Citation: docs/auto-mode-protocol.md.
`;

const VARIANT_E_VACUOUS = `---
name: variant-e
---

# Variant E vacuous fixture

Run the gates. No clarifying questions here.
`;

describe("AC-STE-237.3 — socratic_loop_uses_ask_user_question probe", () => {
  test("variant (a): Pattern 26 cited + AskUserQuestion + protocol citation ⇒ pass", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "variant-a", VARIANT_A_PASS);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (b): Pattern 26 + bare-prose Qs ⇒ fail (i) — missing AskUserQuestion", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "variant-b", VARIANT_B_BARE_PROSE);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.reason).toContain("AskUserQuestion");
      expect(v.message).toContain("AskUserQuestion");
      expect(v.message).toContain("Remedy:");
      expect(v.note).toMatch(/variant-b\/SKILL\.md:\d+/);
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (c): Pattern 26 + AskUserQuestion present + no protocol citation ⇒ fail (ii)", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "variant-c", VARIANT_C_NO_CITATION);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.reason).toContain("docs/auto-mode-protocol.md");
      expect(v.message).toContain("Remedy:");
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (d): socratic: true tag + bare prose Qs ⇒ fail (forward-extension hook)", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "variant-d", VARIANT_D_SOCRATIC_TAG_BARE);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).toContain("AskUserQuestion");
    } finally {
      ctx.cleanup();
    }
  });

  test("variant (e): no Pattern 26 / no socratic tag ⇒ vacuous (no violations)", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "variant-e", VARIANT_E_VACUOUS);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("HTML-comment Pattern 26 mention does not pull skill into scope", async () => {
    const ctx = newProject();
    try {
      writeSkill(
        ctx.root,
        "variant-comment",
        `# Comment-only mention\n<!-- Pattern 26 mentioned in a comment -->\nNo body content.\n`,
      );
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("violations from multiple skills are aggregated", async () => {
    const ctx = newProject();
    try {
      writeSkill(ctx.root, "skill-1", VARIANT_B_BARE_PROSE);
      writeSkill(ctx.root, "skill-2", VARIANT_C_NO_CITATION);
      const report = await runSocraticLoopUsesAskUserQuestionProbe(ctx.root);
      expect(report.violations.length).toBe(2);
      const files = report.violations.map((v) => v.file);
      expect(files.some((f) => f.includes("skill-1"))).toBe(true);
      expect(files.some((f) => f.includes("skill-2"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

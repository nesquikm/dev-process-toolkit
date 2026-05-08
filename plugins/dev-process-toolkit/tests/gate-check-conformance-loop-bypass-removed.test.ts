import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformanceLoopBypassRemovedProbe } from "../adapters/_shared/src/conformance_loop_bypass_removed";

// STE-252 AC-STE-252.4 — /gate-check probe
// `conformance-loop-bypass-removed`. Severity: error.
//
// Globs `.claude/skills/{conformance-loop,smoke-test}/SKILL.md`, finds
// every fenced ```bash block whose body contains a `claude -p `
// invocation, and asserts none carry `--permission-mode bypassPermissions`.
//
// The new posture (STE-252) is content-rich `permissions.allow` in the
// tracked `.claude/settings.json` — children spawn in default permission
// mode and honor the tracked allowlist. `bypassPermissions` is removed
// at every spawn site. This probe locks the regression surface so a
// future edit cannot silently restore the bypass.
//
// Vacuous on toolkit-consumer repos that ship neither file.

function makeFixture(opts: {
  conformanceLoop?: string;
  smokeTest?: string;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "conformance-bypass-"));
  const projectDir = join(root, ".claude", "skills");
  mkdirSync(projectDir, { recursive: true });
  if (opts.conformanceLoop !== undefined) {
    const dir = join(projectDir, "conformance-loop");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.conformanceLoop);
  }
  if (opts.smokeTest !== undefined) {
    const dir = join(projectDir, "smoke-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.smokeTest);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const COMPLIANT_SPEC_WRITE_SPAWN = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p \\",
  "  --plugin-dir /tmp/x \\",
  "  > /tmp/spec-write.log 2>&1 <<'PROMPT_EOF'",
  "<dpt:auto-approve>v1</dpt:auto-approve>",
  "/dev-process-toolkit:spec-write",
  "",
  "Add a feature.",
  "PROMPT_EOF",
  "```",
].join("\n");

const NONCOMPLIANT_SPEC_WRITE_SPAWN = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p \\",
  "  --plugin-dir /tmp/x \\",
  "  --permission-mode bypassPermissions \\",
  "  > /tmp/spec-write.log 2>&1 <<'PROMPT_EOF'",
  "<dpt:auto-approve>v1</dpt:auto-approve>",
  "/dev-process-toolkit:spec-write",
  "",
  "Add a feature.",
  "PROMPT_EOF",
  "```",
].join("\n");

const COMPLIANT_GATE_CHECK_NON_PROMPT = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p /dev-process-toolkit:gate-check \\",
  "  --plugin-dir /tmp/x \\",
  "  < /dev/null > /tmp/gate-check.log 2>&1",
  "```",
].join("\n");

const NONCOMPLIANT_GATE_CHECK_NON_PROMPT = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p /dev-process-toolkit:gate-check \\",
  "  --plugin-dir /tmp/x \\",
  "  --permission-mode bypassPermissions \\",
  "  < /dev/null > /tmp/gate-check.log 2>&1",
  "```",
].join("\n");

describe("AC-STE-252.4 — conformance-loop-bypass-removed probe", () => {
  test("compliant SKILL.md (no bypassPermissions in any claude -p fence) ⇒ zero violations", async () => {
    const fx = makeFixture({
      conformanceLoop: COMPLIANT_SPEC_WRITE_SPAWN,
      smokeTest: COMPLIANT_SPEC_WRITE_SPAWN + "\n\n" + COMPLIANT_GATE_CHECK_NON_PROMPT,
    });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("non-compliant conformance-loop spawn (heredoc body, bypass present) ⇒ violation surfaced with file:line", async () => {
    const fx = makeFixture({ conformanceLoop: NONCOMPLIANT_SPEC_WRITE_SPAWN });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/\.claude\/skills\/conformance-loop\/SKILL\.md:\d+/);
      expect(v.note).toContain("bypassPermissions");
    } finally {
      fx.cleanup();
    }
  });

  test("non-compliant smoke-test spawn flagged the same way (both files in scope)", async () => {
    const fx = makeFixture({ smokeTest: NONCOMPLIANT_SPEC_WRITE_SPAWN });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(
        /\.claude\/skills\/smoke-test\/SKILL\.md:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("non-prompt-bearing `< /dev/null` fence with bypassPermissions ⇒ ALSO flagged (probe scope is every claude -p fence)", async () => {
    // STE-252 removes `bypassPermissions` at every spawn site reachable
    // from /conformance-loop, including the non-prompt-bearing children
    // (`/gate-check`, `/spec-review`, `/simplify`). Unlike STE-226's
    // marker probe (which excluded `< /dev/null` fences because they have
    // no prompt body), this probe's scope is *every* `claude -p` fence,
    // because the bypass-removal rule is universal.
    const fx = makeFixture({ smokeTest: NONCOMPLIANT_GATE_CHECK_NON_PROMPT });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.severity).toBe("error");
    } finally {
      fx.cleanup();
    }
  });

  test("multiple non-compliant fences in same file ⇒ one violation per fence", async () => {
    const fx = makeFixture({
      conformanceLoop:
        NONCOMPLIANT_SPEC_WRITE_SPAWN + "\n\n" + NONCOMPLIANT_SPEC_WRITE_SPAWN,
    });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when neither SKILL.md exists (toolkit consumer) ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("only one of the two files present ⇒ probe still runs on what's there", async () => {
    const fx = makeFixture({ conformanceLoop: NONCOMPLIANT_SPEC_WRITE_SPAWN });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("non-bash fence containing `--permission-mode bypassPermissions` text ⇒ NOT flagged (probe scopes to fenced bash blocks)", async () => {
    const proseWithBypassMention = [
      "Some prose mentioning `--permission-mode bypassPermissions` inline.",
      "",
      "```text",
      "claude -p --permission-mode bypassPermissions  # documentation example",
      "```",
      "",
      COMPLIANT_SPEC_WRITE_SPAWN,
    ].join("\n");
    const fx = makeFixture({ conformanceLoop: proseWithBypassMention });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Remedy + Context + probe name)", async () => {
    const fx = makeFixture({ conformanceLoop: NONCOMPLIANT_SPEC_WRITE_SPAWN });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("conformance-loop-bypass-removed");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });

  test("fence without `claude -p` (e.g., a plain shell snippet) ⇒ NOT flagged even if bypassPermissions text appears", async () => {
    // Out of scope: the probe targets `claude -p` spawns, not arbitrary
    // bash containing the substring. A snippet that documents the legacy
    // behavior in prose form should not falsely trip the probe.
    const noClaudeP = [
      "```bash",
      "# Reference of the legacy form, kept in a non-spawn snippet:",
      "# --permission-mode bypassPermissions was the prior default",
      "echo 'no claude here'",
      "```",
    ].join("\n");
    const fx = makeFixture({ conformanceLoop: noClaudeP });
    try {
      const r = await runConformanceLoopBypassRemovedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

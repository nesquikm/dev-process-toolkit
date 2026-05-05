import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutoApproveMarkerProbe } from "../adapters/_shared/src/auto_approve_marker";

// STE-226 AC-STE-226.5 — /gate-check probe
// `auto_approve_marker_in_canonical_spawns`. Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md` for `claude -p` heredoc-on-stdin spawn
// fences and asserts each carries the literal marker line
// `<dpt:auto-approve>v1</dpt:auto-approve>` on its own line. Hard fail
// when missing.
//
// Non-prompt-bearing `< /dev/null` snippets (no heredoc body) are out of
// scope — they target skills without operator-approval gates and have
// no prompt body to carry the marker.

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

function makeFixture(opts: {
  pluginSkills?: { name: string; content: string }[];
  projectSkills?: { name: string; content: string }[];
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "auto-approve-marker-"));
  const pluginDir = join(root, "plugins", "dev-process-toolkit", "skills");
  const projectDir = join(root, ".claude", "skills");
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  for (const s of opts.pluginSkills ?? []) {
    const dir = join(pluginDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.content);
  }
  for (const s of opts.projectSkills ?? []) {
    const dir = join(projectDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const COMPLIANT_SPEC_WRITE_SPAWN = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p \\",
  "  --plugin-dir /tmp/x \\",
  "  --permission-mode bypassPermissions \\",
  "  > /tmp/spec-write.log 2>&1 <<'PROMPT_EOF'",
  MARKER,
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
  "/dev-process-toolkit:spec-write",
  "",
  "Add a feature.",
  "PROMPT_EOF",
  "```",
].join("\n");

const NON_PROMPT_BEARING_GATE_CHECK_SPAWN = [
  "```bash",
  "CLAUDE_CONFIG_DIR=~/.claude-st claude -p /dev-process-toolkit:gate-check \\",
  "  --plugin-dir /tmp/x \\",
  "  --permission-mode bypassPermissions \\",
  "  < /dev/null > /tmp/gate-check.log 2>&1",
  "```",
].join("\n");

describe("AC-STE-226.5 — auto-approve marker probe", () => {
  test("compliant SKILL.md (every prompt-bearing spawn carries marker) ⇒ zero violations", async () => {
    const fx = makeFixture({
      projectSkills: [{ name: "smoke-test", content: COMPLIANT_SPEC_WRITE_SPAWN }],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("non-compliant SKILL.md (heredoc spawn missing marker) ⇒ violation surfaced with file:line", async () => {
    const fx = makeFixture({
      projectSkills: [{ name: "smoke-test", content: NONCOMPLIANT_SPEC_WRITE_SPAWN }],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/\.claude\/skills\/smoke-test\/SKILL\.md:\d+/);
      expect(v.note).toContain("auto-approve marker");
    } finally {
      fx.cleanup();
    }
  });

  test("non-prompt-bearing `< /dev/null` snippet ⇒ NOT flagged (out of scope)", async () => {
    const fx = makeFixture({
      projectSkills: [
        {
          name: "smoke-test",
          content:
            COMPLIANT_SPEC_WRITE_SPAWN + "\n\n" + NON_PROMPT_BEARING_GATE_CHECK_SPAWN,
        },
      ],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("plugin-skill SKILL.md is also scanned (glob covers both surfaces)", async () => {
    const fx = makeFixture({
      pluginSkills: [
        { name: "implement", content: NONCOMPLIANT_SPEC_WRITE_SPAWN },
      ],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(
        /plugins\/dev-process-toolkit\/skills\/implement\/SKILL\.md:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("multiple non-compliant fences in same file ⇒ one violation per fence", async () => {
    const fx = makeFixture({
      projectSkills: [
        {
          name: "smoke-test",
          content:
            NONCOMPLIANT_SPEC_WRITE_SPAWN + "\n\n" + NONCOMPLIANT_SPEC_WRITE_SPAWN,
        },
      ],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations.length).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when no SKILL.md files exist ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("marker present but on a non-line-anchored position ⇒ flagged (line-anchored detection)", async () => {
    // Embedded but not on its own line. `/spec-write`'s detection
    // contract is "literal line `<dpt:auto-approve>v1</dpt:auto-approve>`
    // on its own line"; mid-line matches do not satisfy the contract.
    const content = [
      "```bash",
      "CLAUDE_CONFIG_DIR=~/.claude-st claude -p \\",
      "  --plugin-dir /tmp/x \\",
      "  --permission-mode bypassPermissions \\",
      "  > /tmp/spec-write.log 2>&1 <<'PROMPT_EOF'",
      `prefix-${MARKER}-suffix`,
      "/dev-process-toolkit:spec-write",
      "",
      "Add a feature.",
      "PROMPT_EOF",
      "```",
    ].join("\n");
    const fx = makeFixture({
      projectSkills: [{ name: "smoke-test", content }],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape", async () => {
    const fx = makeFixture({
      projectSkills: [{ name: "smoke-test", content: NONCOMPLIANT_SPEC_WRITE_SPAWN }],
    });
    try {
      const r = await runAutoApproveMarkerProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("auto_approve_marker_in_canonical_spawns");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });
});

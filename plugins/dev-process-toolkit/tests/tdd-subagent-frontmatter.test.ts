import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-225 AC.2 + AC.10 — Subagent frontmatter shape.
//
// Each TDD subagent (test-writer, implementer, refactorer) lives at
// `plugins/dev-process-toolkit/agents/tdd-<role>.md` and must declare:
//   - tools: Read, Grep, Glob, Write, Edit, Bash    (allowlist; no Agent / WebFetch / WebSearch)
//   - maxTurns: 8
//   - description naming the orchestrator as the sole invoker
//
// AC.10 inverse: none of the three subagents declares `hooks:`,
// `mcpServers:`, or `permissionMode:` — Claude Code strips those from
// plugin-bundled subagents.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const agentsDir = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "agents",
);

const ROLES = [
  { file: "tdd-test-writer.md", role: "test-writer" },
  { file: "tdd-implementer.md", role: "implementer" },
  { file: "tdd-refactorer.md", role: "refactorer" },
] as const;

function readAgent(name: string): string {
  const p = join(agentsDir, name);
  expect(existsSync(p)).toBe(true);
  return readFileSync(p, "utf-8");
}

function parseFrontmatter(body: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/m.exec(body);
  expect(m).not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of m![1]!.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim();
    const v = line.slice(c + 1).trim();
    if (k.length > 0) out[k] = v;
  }
  return out;
}

describe("AC-STE-225.2 — TDD subagent frontmatter shape", () => {
  for (const { file, role } of ROLES) {
    test(`${file} declares the canonical tools allowlist`, () => {
      const fm = parseFrontmatter(readAgent(file));
      const tools = (fm.tools ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      expect(tools).toContain("Read");
      expect(tools).toContain("Grep");
      expect(tools).toContain("Glob");
      expect(tools).toContain("Write");
      expect(tools).toContain("Edit");
      expect(tools).toContain("Bash");
      expect(tools).not.toContain("Agent");
      expect(tools).not.toContain("WebFetch");
      expect(tools).not.toContain("WebSearch");
    });

    test(`${file} declares maxTurns: 8`, () => {
      const fm = parseFrontmatter(readAgent(file));
      expect(fm.maxTurns).toBe("8");
    });

    test(`${file} description names /tdd as the sole invoker for role=${role}`, () => {
      const fm = parseFrontmatter(readAgent(file));
      const desc = fm.description ?? "";
      expect(desc.toLowerCase()).toContain("tdd");
      expect(desc.toLowerCase()).toContain(role);
      expect(desc.toLowerCase()).toMatch(/exclusively|sole|only|do not invoke directly/i);
    });
  }
});

describe("AC-STE-225.10 — plugin-subagent constraint compliance", () => {
  for (const { file } of ROLES) {
    test(`${file} declares no hooks / mcpServers / permissionMode`, () => {
      const body = readAgent(file);
      // Plugin-bundled subagents drop these per
      // https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope
      expect(body).not.toMatch(/^hooks:/m);
      expect(body).not.toMatch(/^mcpServers:/m);
      expect(body).not.toMatch(/^permissionMode:/m);
    });
  }
});

// STE-296 AC.1 — `tdd-spec-reviewer` is the fourth TDD subagent.
// Read-only allowlist (`Read, Grep, Glob`), maxTurns: 8, model: sonnet,
// description names /dev-process-toolkit:tdd as the sole invoker, body
// describes the AC-trace + classify + fenced-block procedure.
describe("AC-STE-296.1 — tdd-spec-reviewer subagent frontmatter", () => {
  const file = "tdd-spec-reviewer.md";

  test(`${file} declares read-only tools allowlist (Read, Grep, Glob)`, () => {
    const fm = parseFrontmatter(readAgent(file));
    const tools = (fm.tools ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Glob");
    // Read-only — Write / Edit / Bash / Agent are explicitly excluded.
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Agent");
    expect(tools).not.toContain("WebFetch");
    expect(tools).not.toContain("WebSearch");
  });

  test(`${file} declares maxTurns: 8`, () => {
    const fm = parseFrontmatter(readAgent(file));
    expect(fm.maxTurns).toBe("8");
  });

  test(`${file} declares model: sonnet`, () => {
    const fm = parseFrontmatter(readAgent(file));
    expect(fm.model).toBe("sonnet");
  });

  test(`${file} description names /tdd as the sole invoker (context: fork)`, () => {
    const fm = parseFrontmatter(readAgent(file));
    const desc = (fm.description ?? "").toLowerCase();
    expect(desc).toContain("tdd");
    expect(desc).toMatch(/exclusively|sole|only|do not invoke directly/i);
    expect(desc).toContain("context: fork");
  });

  test(`${file} declares no hooks / mcpServers / permissionMode`, () => {
    const body = readAgent(file);
    expect(body).not.toMatch(/^hooks:/m);
    expect(body).not.toMatch(/^mcpServers:/m);
    expect(body).not.toMatch(/^permissionMode:/m);
  });

  test(`${file} body explains the audit procedure (trace ACs, classify, fenced block)`, () => {
    const body = readAgent(file);
    expect(body).toMatch(/AC|acceptance criteria/i);
    expect(body).toMatch(/trace/i);
    expect(body).toMatch(/done/i);
    expect(body).toMatch(/missing/i);
    expect(body).toMatch(/partial/i);
    expect(body).toContain("tdd-spec-review-result");
  });
});

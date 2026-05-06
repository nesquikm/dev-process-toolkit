import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-225 AC.1 — Orchestrator + child-skill frontmatter shape.
//
// `plugins/dev-process-toolkit/skills/tdd/SKILL.md` is the orchestrator
//   (no `context: fork`).
// `plugins/dev-process-toolkit/skills/tdd-{write-test,implement,refactor}/SKILL.md`
//   each carry `context: fork`, an `agent:` field that resolves to a
//   real `agents/*.md` file, and `user-invocable: false`.
//   `disable-model-invocation` is **not** set on the children — the
//   orchestrator must invoke them via the Skill tool.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginDir = join(repoRoot, "plugins", "dev-process-toolkit");
const skillsDir = join(pluginDir, "skills");
const agentsDir = join(pluginDir, "agents");

const ORCHESTRATOR = "tdd";
const CHILDREN = [
  { dir: "tdd-write-test", agent: "tdd-test-writer" },
  { dir: "tdd-implement", agent: "tdd-implementer" },
  { dir: "tdd-refactor", agent: "tdd-refactorer" },
] as const;

function readSkill(dir: string): string {
  const p = join(skillsDir, dir, "SKILL.md");
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

describe("AC-STE-225.1 — orchestrator skill frontmatter", () => {
  test("orchestrator skill exists at skills/tdd/SKILL.md", () => {
    expect(existsSync(join(skillsDir, ORCHESTRATOR, "SKILL.md"))).toBe(true);
  });

  test("orchestrator carries no `context: fork` (runs in main context)", () => {
    const fm = parseFrontmatter(readSkill(ORCHESTRATOR));
    expect(fm.context).toBeUndefined();
  });

  test("orchestrator declares name=tdd", () => {
    const fm = parseFrontmatter(readSkill(ORCHESTRATOR));
    expect(fm.name).toBe("tdd");
  });
});

describe("AC-STE-225.1 — child-skill frontmatter shape", () => {
  for (const { dir, agent } of CHILDREN) {
    test(`${dir} carries \`context: fork\``, () => {
      const fm = parseFrontmatter(readSkill(dir));
      expect(fm.context).toBe("fork");
    });

    test(`${dir} declares \`agent: ${agent}\` resolving to a real agents/*.md`, () => {
      const fm = parseFrontmatter(readSkill(dir));
      expect(fm.agent).toBe(agent);
      const agentPath = join(agentsDir, `${agent}.md`);
      expect(existsSync(agentPath)).toBe(true);
    });

    test(`${dir} carries \`user-invocable: false\``, () => {
      const fm = parseFrontmatter(readSkill(dir));
      expect(fm["user-invocable"]).toBe("false");
    });

    test(`${dir} does NOT carry \`disable-model-invocation\``, () => {
      // The orchestrator must invoke children via the Skill tool, so
      // model invocation must remain enabled.
      const fm = parseFrontmatter(readSkill(dir));
      expect(fm["disable-model-invocation"]).toBeUndefined();
    });
  }
});

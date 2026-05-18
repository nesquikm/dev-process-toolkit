// STE-301 AC-STE-301.15 — /gate-check probe
// `deps_researcher_subagent_invariants`. Severity: error.
//
// Asserts byte-checkable invariants on the new files introduced by
// STE-301:
//   (a) plugins/dev-process-toolkit/agents/deps-researcher.md exists with
//       frontmatter:
//         tools: Read, Grep, Glob       (no Write/Edit/Bash/Agent)
//         model: haiku
//         description: …                (mentions /dev-process-toolkit:deps-research)
//   (b) plugins/dev-process-toolkit/skills/deps-research/SKILL.md exists
//       with frontmatter:
//         context: fork
//         agent: deps-researcher
//         user-invocable: false
//         argument-hint: <topic>
//         allowed-tools (if present) excludes Agent
//
// Mirrors STE-296 AC.8 (`tdd_spec_reviewer_subagent_invariants`) and
// STE-225 AC.7 (`tdd_orchestrator_integrity`) probe shapes.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDepsResearcherInvariantsProbe } from "../adapters/_shared/src/deps_researcher_invariants";

const VALID_AGENT = [
  "---",
  "name: deps-researcher",
  "description: Internal deps-researcher subagent — invoked exclusively by /dev-process-toolkit:deps-research via context: fork.",
  "tools: Read, Grep, Glob",
  "model: haiku",
  "---",
  "",
  "Body",
].join("\n");

const VALID_CHILD = [
  "---",
  "name: deps-research",
  "description: child",
  "context: fork",
  "agent: deps-researcher",
  "user-invocable: false",
  "argument-hint: <topic>",
  "---",
  "",
  "Body",
].join("\n");

interface FixtureSpec {
  agent?: string | null;
  child?: string | null;
}

function makeFixture(spec: FixtureSpec): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "deps-researcher-invariants-"));
  const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(root, "plugins", "dev-process-toolkit", "agents");
  mkdirSync(skillsBase, { recursive: true });
  mkdirSync(agentsBase, { recursive: true });
  if (spec.child !== null) {
    const dir = join(skillsBase, "deps-research");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), spec.child ?? VALID_CHILD);
  }
  if (spec.agent !== null) {
    writeFileSync(join(agentsBase, "deps-researcher.md"), spec.agent ?? VALID_AGENT);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-301.15 — deps_researcher_subagent_invariants probe", () => {
  test("conforming fixture ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter missing tools Read/Grep/Glob ⇒ violation names tools", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read",
      "model: haiku",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.some((v) => /tools|Grep|Glob/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter tools includes Write ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read, Grep, Glob, Write",
      "model: haiku",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.some((v) => /\bWrite\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter tools includes Edit ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read, Grep, Glob, Edit",
      "model: haiku",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bEdit\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter tools includes Bash ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read, Grep, Glob, Bash",
      "model: haiku",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bBash\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter tools includes Agent ⇒ violation (no nested forks)", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read, Grep, Glob, Agent",
      "model: haiku",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bAgent\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent missing model: haiku ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: deps-researcher",
      "description: x",
      "tools: Read, Grep, Glob",
      "model: sonnet",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /model/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill missing context: fork ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: deps-research",
      "description: child",
      "agent: deps-researcher",
      "user-invocable: false",
      "argument-hint: <topic>",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /context: fork/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill missing user-invocable: false ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: deps-research",
      "description: child",
      "context: fork",
      "agent: deps-researcher",
      "argument-hint: <topic>",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /user-invocable/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill agent: pointing at wrong agent ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: deps-research",
      "description: child",
      "context: fork",
      "agent: not-deps-researcher",
      "user-invocable: false",
      "argument-hint: <topic>",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /agent/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill includes Agent in allowed-tools ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: deps-research",
      "description: child",
      "context: fork",
      "agent: deps-researcher",
      "user-invocable: false",
      "argument-hint: <topic>",
      "allowed-tools: Read, Grep, Glob, Agent",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bAgent\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing subagent file ⇒ violation citing path", async () => {
    const fx = makeFixture({ agent: null });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => v.note.includes("deps-researcher.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing child skill file ⇒ violation citing path", async () => {
    const fx = makeFixture({ child: null });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.some((v) => v.note.includes("deps-research/SKILL.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Remedy + Context)", async () => {
    const fx = makeFixture({ agent: null });
    try {
      const r = await runDepsResearcherInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("deps_researcher_subagent_invariants");
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous on a fresh repo with no plugin skills or agents directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "deps-researcher-empty-"));
    try {
      const r = await runDepsResearcherInvariantsProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

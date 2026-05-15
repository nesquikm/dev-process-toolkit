import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTddSpecReviewerInvariantsProbe,
} from "../adapters/_shared/src/tdd_spec_reviewer_invariants";

// STE-296 AC.8 — /gate-check probe `tdd_spec_reviewer_subagent_invariants`.
// Severity: error.
//
// Asserts byte-checkable invariants on the new files introduced by STE-296:
//   (a) plugins/dev-process-toolkit/agents/tdd-spec-reviewer.md exists with
//       frontmatter:
//         tools: Read, Grep, Glob   (no Write/Edit/Bash/Agent)
//         maxTurns: 8
//         model: sonnet
//   (b) plugins/dev-process-toolkit/skills/tdd-spec-review/SKILL.md exists
//       with frontmatter:
//         context: fork
//         agent: tdd-spec-reviewer
//         user-invocable: false
//         allowed-tools (if present) excludes Agent
//
// Mirrors STE-225 AC.7's tdd_orchestrator_integrity probe shape.

const VALID_AGENT = [
  "---",
  "name: tdd-spec-reviewer",
  "description: Internal TDD spec-reviewer subagent for /dev-process-toolkit:tdd. Invoked exclusively via context: fork.",
  "tools: Read, Grep, Glob",
  "maxTurns: 8",
  "model: sonnet",
  "---",
  "",
  "Body",
].join("\n");

const VALID_CHILD = [
  "---",
  "name: tdd-spec-review",
  "description: child",
  "context: fork",
  "agent: tdd-spec-reviewer",
  "user-invocable: false",
  "---",
  "",
  "Body",
].join("\n");

interface FixtureSpec {
  agent?: string | null;
  child?: string | null;
}

function makeFixture(spec: FixtureSpec): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tdd-spec-reviewer-"));
  const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(root, "plugins", "dev-process-toolkit", "agents");
  mkdirSync(skillsBase, { recursive: true });
  mkdirSync(agentsBase, { recursive: true });
  if (spec.child !== null) {
    const dir = join(skillsBase, "tdd-spec-review");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), spec.child ?? VALID_CHILD);
  }
  if (spec.agent !== null) {
    writeFileSync(join(agentsBase, "tdd-spec-reviewer.md"), spec.agent ?? VALID_AGENT);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-296.8 — tdd_spec_reviewer_subagent_invariants probe", () => {
  test("conforming fixture ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter missing tools Read/Grep/Glob ⇒ violation names tools", async () => {
    const badAgent = [
      "---",
      "name: tdd-spec-reviewer",
      "description: x",
      "tools: Read",
      "maxTurns: 8",
      "model: sonnet",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.some((v) => /tools|Grep|Glob/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent frontmatter tools includes Write/Edit/Bash ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: tdd-spec-reviewer",
      "description: x",
      "tools: Read, Grep, Glob, Write, Edit, Bash",
      "maxTurns: 8",
      "model: sonnet",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.some((v) => /\b(Write|Edit|Bash)\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent missing maxTurns: 8 ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: tdd-spec-reviewer",
      "description: x",
      "tools: Read, Grep, Glob",
      "maxTurns: 4",
      "model: sonnet",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /maxTurns/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent missing model: sonnet ⇒ violation", async () => {
    const badAgent = [
      "---",
      "name: tdd-spec-reviewer",
      "description: x",
      "tools: Read, Grep, Glob",
      "maxTurns: 8",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ agent: badAgent });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /model/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill missing context: fork ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: tdd-spec-review",
      "description: child",
      "agent: tdd-spec-reviewer",
      "user-invocable: false",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /context: fork/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill missing user-invocable: false ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: tdd-spec-review",
      "description: child",
      "context: fork",
      "agent: tdd-spec-reviewer",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /user-invocable/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill agent: pointing at wrong agent ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: tdd-spec-review",
      "description: child",
      "context: fork",
      "agent: not-spec-reviewer",
      "user-invocable: false",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /agent/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child skill includes Agent in allowed-tools ⇒ violation", async () => {
    const badChild = [
      "---",
      "name: tdd-spec-review",
      "description: child",
      "context: fork",
      "agent: tdd-spec-reviewer",
      "user-invocable: false",
      "allowed-tools: Read, Grep, Glob, Agent",
      "---",
      "",
      "Body",
    ].join("\n");
    const fx = makeFixture({ child: badChild });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bAgent\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing subagent file ⇒ violation citing path", async () => {
    const fx = makeFixture({ agent: null });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => v.note.includes("tdd-spec-reviewer.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing child skill file ⇒ violation citing path", async () => {
    const fx = makeFixture({ child: null });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.some((v) => v.note.includes("tdd-spec-review/SKILL.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Remedy + Context)", async () => {
    const fx = makeFixture({ agent: null });
    try {
      const r = await runTddSpecReviewerInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("tdd_spec_reviewer_subagent_invariants");
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous on a fresh repo with no plugin skills or agents directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "tdd-spec-reviewer-empty-"));
    try {
      const r = await runTddSpecReviewerInvariantsProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo's own files pass the probe (self-run sanity)", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const r = await runTddSpecReviewerInvariantsProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});

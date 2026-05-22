import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTddOrchestratorIntegrityProbe,
} from "../adapters/_shared/src/tdd_orchestrator_integrity";

// STE-225 AC.7 — `/gate-check` structural probe `tdd_orchestrator_integrity`.
//
// Per STE-318 / STE-296 canon, the orchestrator drives a 4-stage pipeline
// (write-test → implement → refactor → spec-review) via forked child skills.
// This test exercises the probe's load-bearing structural assertions:
//   (a) the orchestrator skill and each tracked child skill path exist
//   (b) each tracked child skill carries `context: fork`
//   (c) each child's `agent:` resolves to a real agents/*.md
//   (d) each child carries `user-invocable: false`
//   (e) each subagent's `tools` field excludes `Agent`
//
// Probe does NOT assert specific allowed-tool composition beyond the
// `Agent` exclusion or specific prompt phrasing — content drift is
// verified by the smoke, not the probe.

interface FixtureSpec {
  orchestrator?: string;
  writeTest?: string | null;
  implement?: string | null;
  refactor?: string | null;
  testWriterAgent?: string | null;
  implementerAgent?: string | null;
  refactorerAgent?: string | null;
}

const VALID_ORCHESTRATOR = [
  "---",
  "name: tdd",
  "description: Multi-agent TDD orchestrator.",
  "---",
  "",
  "# TDD",
].join("\n");

function child(opts: {
  agent: string;
  contextFork?: boolean;
  userInvocableFalse?: boolean;
}): string {
  const lines = ["---", "name: child"];
  if (opts.contextFork ?? true) lines.push("context: fork");
  lines.push(`agent: ${opts.agent}`);
  if (opts.userInvocableFalse ?? true) lines.push("user-invocable: false");
  lines.push("---", "", "Body");
  return lines.join("\n");
}

function agent(opts: {
  tools?: string;
  name?: string;
}): string {
  const tools = opts.tools ?? "Read, Grep, Glob, Write, Edit, Bash";
  return [
    "---",
    `name: ${opts.name ?? "tdd-test-writer"}`,
    `description: agent`,
    `tools: ${tools}`,
    "maxTurns: 8",
    "---",
    "",
    "Body",
  ].join("\n");
}

function makeFixture(spec: FixtureSpec): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tdd-integrity-"));
  const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(root, "plugins", "dev-process-toolkit", "agents");
  mkdirSync(skillsBase, { recursive: true });
  mkdirSync(agentsBase, { recursive: true });
  if (spec.orchestrator !== null) {
    const dir = join(skillsBase, "tdd");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), spec.orchestrator ?? VALID_ORCHESTRATOR);
  }
  const writeChild = (name: string, content: string | null | undefined, defaultContent: string) => {
    if (content === null) return;
    const dir = join(skillsBase, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content ?? defaultContent);
  };
  writeChild(
    "tdd-write-test",
    spec.writeTest,
    child({ agent: "tdd-test-writer" }),
  );
  writeChild(
    "tdd-implement",
    spec.implement,
    child({ agent: "tdd-implementer" }),
  );
  writeChild(
    "tdd-refactor",
    spec.refactor,
    child({ agent: "tdd-refactorer" }),
  );
  const writeAgent = (name: string, content: string | null | undefined) => {
    if (content === null) return;
    writeFileSync(
      join(agentsBase, `${name}.md`),
      content ?? agent({ name }),
    );
  };
  writeAgent("tdd-test-writer", spec.testWriterAgent);
  writeAgent("tdd-implementer", spec.implementerAgent);
  writeAgent("tdd-refactorer", spec.refactorerAgent);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-225.7 — tdd_orchestrator_integrity probe", () => {
  test("clean fixture (orchestrator + tracked children + tracked subagents) ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("(a) missing orchestrator skill ⇒ violation citing path", async () => {
    const fx = makeFixture({ orchestrator: null as unknown as string });
    try {
      // simulate "missing orchestrator file" by removing it before the probe runs
      rmSync(
        join(fx.root, "plugins", "dev-process-toolkit", "skills", "tdd"),
        { recursive: true, force: true },
      );
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(/skills\/tdd\/SKILL\.md/);
    } finally {
      fx.cleanup();
    }
  });

  test("(a) missing child skill ⇒ violation citing path", async () => {
    const fx = makeFixture({ implement: null });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations.some((v) => v.note.includes("tdd-implement/SKILL.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(b) child without context: fork ⇒ violation", async () => {
    const fx = makeFixture({
      writeTest: child({ agent: "tdd-test-writer", contextFork: false }),
    });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.some((v) => /context: fork/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(c) child agent: pointing at non-existent file ⇒ violation", async () => {
    const fx = makeFixture({
      writeTest: child({ agent: "ghost-agent" }),
      testWriterAgent: null,
    });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(
        r.violations.some(
          (v) => v.note.includes("ghost-agent.md") || v.note.includes("agent:"),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(d) child without `user-invocable: false` ⇒ violation", async () => {
    const fx = makeFixture({
      refactor: child({ agent: "tdd-refactorer", userInvocableFalse: false }),
    });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.some((v) => /user-invocable/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(e) subagent tools includes Agent ⇒ violation", async () => {
    const fx = makeFixture({
      implementerAgent: agent({
        name: "tdd-implementer",
        tools: "Read, Grep, Glob, Write, Edit, Bash, Agent",
      }),
    });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.some((v) => /\bAgent\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Remedy + Context)", async () => {
    const fx = makeFixture({
      writeTest: child({ agent: "ghost-agent" }),
      testWriterAgent: null,
    });
    try {
      const r = await runTddOrchestratorIntegrityProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("tdd_orchestrator_integrity");
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous on a fresh repo with no plugin skills directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "tdd-integrity-empty-"));
    try {
      const r = await runTddOrchestratorIntegrityProbe(root);
      // No skills present → probe early-returns without violations.
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("asymmetry: skills/ exists but agents/ missing ⇒ runs and surfaces violations (NOT vacuous)", async () => {
    // Round 1 / round 2 review concern: vacuous condition uses `&&`,
    // so a malformed plugin where skills/ is present but agents/ is
    // absent must NOT short-circuit as vacuous — the asymmetry IS the
    // failure (children declare `agent:` references that can't resolve).
    const root = mkdtempSync(join(tmpdir(), "tdd-integrity-asymmetry-"));
    const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
    mkdirSync(join(skillsBase, "tdd-write-test"), { recursive: true });
    writeFileSync(
      join(skillsBase, "tdd-write-test", "SKILL.md"),
      child({ agent: "tdd-test-writer" }),
    );
    try {
      const r = await runTddOrchestratorIntegrityProbe(root);
      expect(r.vacuous).toBe(false);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo's own files pass the probe (self-run sanity)", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const r = await runTddOrchestratorIntegrityProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});

// STE-307 — /gate-check probe `audit_fix_loop_pattern_invariants`.
// Severity: error.
//
// Asserts byte-checkable invariants on every canonical audit-fix loop
// declared in the `AUDIT_FIX_LOOP_CANONICAL_LOOPS` allowlist exported from
// adapters/_shared/src/audit_fix_loop_pattern.ts. The allowlist ships with
// the /tdd audit-fork pair at FR ship (STE-308 appends /spec-review):
//
//   { orchestrator: 'tdd', child: 'tdd-spec-review', subagent: 'tdd-spec-reviewer' }
//
// The RED/GREEN/REFACTOR /tdd forks are deliberately out of scope here —
// they are action subagents (need Write/Edit/Bash) and probe #39
// tdd_orchestrator_integrity already enforces their context:fork +
// agent:resolves invariants. This probe layers the read-only constraint
// on top, audit-fork pairs only, per the M80 plan architecture.
//
// For each entry, asserts:
//   (a) the child skill file exists at
//       `plugins/dev-process-toolkit/skills/<child>/SKILL.md` and carries
//       `context: fork`, `user-invocable: false`, `agent:` resolves to an
//       existing `plugins/dev-process-toolkit/agents/<name>.md`;
//   (b) the subagent declares `tools: Read, Grep, Glob` only
//       (Write/Edit/Bash/Agent excluded);
//   (c) the child's `allowed-tools:` (when present) excludes `Agent`.
//
// Probe is vacuous on repos with neither
// `plugins/dev-process-toolkit/skills/` nor
// `plugins/dev-process-toolkit/agents/`, matching probes #39 / #50 / #51.
//
// AC-STE-307.1 — probe row in gate-check SKILL.md.
// AC-STE-307.2 — allowlist content + shape.
// AC-STE-307.3 — per-entry assertions (a) / (b) / (c).
// AC-STE-307.4 — vacuous on absent-plugin-content fixture.
// AC-STE-307.5 — coverage scenarios (clean, child-missing-fork, subagent-Write,
//                child-allowed-tools-Agent, absent-plugin-content vacuous).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUDIT_FIX_LOOP_CANONICAL_LOOPS,
  runAuditFixLoopPatternInvariantsProbe,
  type AuditFixLoopEntry,
} from "../adapters/_shared/src/audit_fix_loop_pattern";

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillMd = join(pluginRoot, "skills", "gate-check", "SKILL.md");

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers — write a clean per-entry pair of files into a tmp project,
// then let individual tests overwrite specific files with malformed bodies.
// ─────────────────────────────────────────────────────────────────────────────

const TDD_CANONICAL: ReadonlyArray<AuditFixLoopEntry> = [
  { orchestrator: "tdd", child: "tdd-spec-review", subagent: "tdd-spec-reviewer" },
  { orchestrator: "spec-review", child: "spec-review-audit", subagent: "spec-reviewer" },
];

function validChild(opts: {
  name: string;
  agent: string;
  contextFork?: boolean;
  userInvocableFalse?: boolean;
  allowedTools?: string | null;
}): string {
  const lines = ["---", `name: ${opts.name}`, "description: child"];
  if (opts.contextFork ?? true) lines.push("context: fork");
  lines.push(`agent: ${opts.agent}`);
  if (opts.userInvocableFalse ?? true) lines.push("user-invocable: false");
  if (opts.allowedTools !== null && opts.allowedTools !== undefined) {
    lines.push(`allowed-tools: ${opts.allowedTools}`);
  }
  lines.push("---", "", "Body");
  return lines.join("\n");
}

function validSubagent(opts: {
  name: string;
  tools?: string;
}): string {
  const tools = opts.tools ?? "Read, Grep, Glob";
  return [
    "---",
    `name: ${opts.name}`,
    "description: subagent",
    `tools: ${tools}`,
    "maxTurns: 8",
    "model: sonnet",
    "---",
    "",
    "Body",
  ].join("\n");
}

interface FixtureOverrides {
  // Map of `<child>` → SKILL.md body (or null to omit the file).
  children?: Record<string, string | null>;
  // Map of `<subagent>` → agent.md body (or null to omit the file).
  subagents?: Record<string, string | null>;
}

function makeFixture(overrides: FixtureOverrides = {}): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "audit-fix-loop-pattern-"));
  const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(root, "plugins", "dev-process-toolkit", "agents");
  mkdirSync(skillsBase, { recursive: true });
  mkdirSync(agentsBase, { recursive: true });

  for (const entry of TDD_CANONICAL) {
    const childBody = Object.prototype.hasOwnProperty.call(
      overrides.children ?? {},
      entry.child,
    )
      ? overrides.children![entry.child]
      : validChild({ name: entry.child, agent: entry.subagent });
    if (childBody !== null) {
      const dir = join(skillsBase, entry.child);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), childBody);
    }

    const subagentBody = Object.prototype.hasOwnProperty.call(
      overrides.subagents ?? {},
      entry.subagent,
    )
      ? overrides.subagents![entry.subagent]
      : validSubagent({ name: entry.subagent });
    if (subagentBody !== null) {
      writeFileSync(join(agentsBase, `${entry.subagent}.md`), subagentBody);
    }
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-307.1 — Probe entry in gate-check SKILL.md probe table.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-307.1 — probe registered in gate-check SKILL.md", () => {
  test("gate-check SKILL.md mentions the probe identifier `audit_fix_loop_pattern_invariants`", () => {
    const body = readFileSync(gateCheckSkillMd, "utf8");
    expect(body).toContain("audit_fix_loop_pattern_invariants");
  });

  test("probe entry declares severity error", () => {
    const body = readFileSync(gateCheckSkillMd, "utf8");
    const idx = body.indexOf("audit_fix_loop_pattern_invariants");
    expect(idx).toBeGreaterThan(-1);
    // Take a 1000-char window around the probe identifier and look for severity.
    const windowStart = Math.max(0, idx - 50);
    const windowEnd = Math.min(body.length, idx + 1500);
    const windowSlice = body.slice(windowStart, windowEnd);
    expect(windowSlice).toMatch(/Severity:\s*\*?\*?error/i);
  });

  test("probe entry references the helper module path", () => {
    const body = readFileSync(gateCheckSkillMd, "utf8");
    const idx = body.indexOf("audit_fix_loop_pattern_invariants");
    expect(idx).toBeGreaterThan(-1);
    const windowEnd = Math.min(body.length, idx + 2000);
    const windowSlice = body.slice(idx, windowEnd);
    expect(windowSlice).toContain("audit_fix_loop_pattern.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-307.2 — Allowlist content + shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-307.2 — AUDIT_FIX_LOOP_CANONICAL_LOOPS allowlist shape", () => {
  test("allowlist is exported as an array", () => {
    expect(Array.isArray(AUDIT_FIX_LOOP_CANONICAL_LOOPS)).toBe(true);
  });

  test("allowlist ships with the /tdd audit-fork entry at FR ship", () => {
    const tddLoops = AUDIT_FIX_LOOP_CANONICAL_LOOPS.filter(
      (e) => e.orchestrator === "tdd",
    );
    expect(tddLoops.length).toBeGreaterThanOrEqual(1);
    const pairs = tddLoops.map((e) => `${e.child}::${e.subagent}`);
    expect(pairs).toContain("tdd-spec-review::tdd-spec-reviewer");
  });

  test("allowlist excludes /tdd action subagents (test-writer/implementer/refactorer)", () => {
    // The action subagents need Write/Edit/Bash; the allowlist tracks only
    // audit-fork pairs whose subagent is read-only. Probe #39 already
    // covers the action subagents' context:fork + agent:resolves invariants.
    const pairs = AUDIT_FIX_LOOP_CANONICAL_LOOPS.map(
      (e) => `${e.child}::${e.subagent}`,
    );
    expect(pairs).not.toContain("tdd-write-test::tdd-test-writer");
    expect(pairs).not.toContain("tdd-implement::tdd-implementer");
    expect(pairs).not.toContain("tdd-refactor::tdd-refactorer");
  });

  test("every allowlist entry carries the three required fields", () => {
    for (const entry of AUDIT_FIX_LOOP_CANONICAL_LOOPS) {
      expect(typeof entry.orchestrator).toBe("string");
      expect(entry.orchestrator.length).toBeGreaterThan(0);
      expect(typeof entry.child).toBe("string");
      expect(entry.child.length).toBeGreaterThan(0);
      expect(typeof entry.subagent).toBe("string");
      expect(entry.subagent.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-307.3 + AC-STE-307.5 — Per-entry assertions on a clean fixture and
// targeted-violation fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-307.3 — per-entry probe assertions", () => {
  test("(AC-STE-307.5a) clean fixture with the /tdd audit-fork entry ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("(AC-STE-307.5b) child skill missing `context: fork` ⇒ violation row cites the skill path", async () => {
    const badChild = validChild({
      name: "tdd-spec-review",
      agent: "tdd-spec-reviewer",
      contextFork: false,
    });
    const fx = makeFixture({ children: { "tdd-spec-review": badChild } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) => /context: fork/.test(v.note) &&
            v.note.includes("tdd-spec-review/SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(AC-STE-307.5c) subagent declaring `tools: Read, Grep, Glob, Write` ⇒ violation names Write", async () => {
    const badAgent = validSubagent({
      name: "tdd-spec-reviewer",
      tools: "Read, Grep, Glob, Write",
    });
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": badAgent } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) => /\bWrite\b/.test(v.note) &&
            v.note.includes("tdd-spec-reviewer.md"),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("(AC-STE-307.5d) child declaring `allowed-tools: Read, Agent` ⇒ violation names Agent", async () => {
    const badChild = validChild({
      name: "tdd-spec-review",
      agent: "tdd-spec-reviewer",
      allowedTools: "Read, Agent",
    });
    const fx = makeFixture({ children: { "tdd-spec-review": badChild } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) => /\bAgent\b/.test(v.note) &&
            v.note.includes("tdd-spec-review/SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent tools includes Edit ⇒ violation names Edit", async () => {
    const badAgent = validSubagent({
      name: "tdd-spec-reviewer",
      tools: "Read, Grep, Glob, Edit",
    });
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": badAgent } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bEdit\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent tools includes Bash ⇒ violation names Bash", async () => {
    const badAgent = validSubagent({
      name: "tdd-spec-reviewer",
      tools: "Read, Grep, Glob, Bash",
    });
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": badAgent } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bBash\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent tools includes Agent ⇒ violation names Agent (no nested forks)", async () => {
    const badAgent = validSubagent({
      name: "tdd-spec-reviewer",
      tools: "Read, Grep, Glob, Agent",
    });
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": badAgent } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /\bAgent\b/.test(v.note))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("subagent missing required tools (Read/Grep/Glob) ⇒ violation", async () => {
    const badAgent = validSubagent({
      name: "tdd-spec-reviewer",
      tools: "Read",
    });
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": badAgent } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some((v) => /tools|Grep|Glob/.test(v.note)),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("child missing `user-invocable: false` ⇒ violation", async () => {
    const badChild = validChild({
      name: "tdd-spec-review",
      agent: "tdd-spec-reviewer",
      userInvocableFalse: false,
    });
    const fx = makeFixture({ children: { "tdd-spec-review": badChild } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.some((v) => /user-invocable/.test(v.note))).toBe(
        true,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("child agent: pointing at a non-existent agents/*.md ⇒ violation", async () => {
    const badChild = validChild({
      name: "tdd-spec-review",
      agent: "ghost-agent",
    });
    const fx = makeFixture({
      children: { "tdd-spec-review": badChild },
      // Remove the canonical tdd-spec-reviewer agent so the resolve fails.
      subagents: { "tdd-spec-reviewer": null },
    });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) => v.note.includes("ghost-agent") || /agent/.test(v.note),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing child skill file ⇒ violation citing the skill path", async () => {
    const fx = makeFixture({ children: { "tdd-spec-review": null } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(
        r.violations.some((v) =>
          v.note.includes("tdd-spec-review/SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("missing subagent file ⇒ violation citing the subagent path", async () => {
    const fx = makeFixture({ subagents: { "tdd-spec-reviewer": null } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(
        r.violations.some((v) => v.note.includes("tdd-spec-reviewer")),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Remedy + Context)", async () => {
    const badChild = validChild({
      name: "tdd-spec-review",
      agent: "tdd-spec-reviewer",
      contextFork: false,
    });
    const fx = makeFixture({ children: { "tdd-spec-review": badChild } });
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("audit_fix_loop_pattern_invariants");
    } finally {
      fx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-307.4 + AC-STE-307.5e — Vacuous on absent-plugin-content fixture.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-307.4 — vacuous on absent-plugin-content fixture", () => {
  test("(AC-STE-307.5e) repo with neither plugins/dev-process-toolkit/skills/ nor /agents/ ⇒ vacuous, zero violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "audit-fix-loop-pattern-empty-"));
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skills/ exists but agents/ missing ⇒ runs and surfaces violations (NOT vacuous)", async () => {
    // The vacuous condition uses `&&`, so asymmetric trees must still run.
    const root = mkdtempSync(
      join(tmpdir(), "audit-fix-loop-pattern-asymmetric-"),
    );
    const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
    mkdirSync(join(skillsBase, "tdd-spec-review"), { recursive: true });
    writeFileSync(
      join(skillsBase, "tdd-spec-review", "SKILL.md"),
      validChild({ name: "tdd-spec-review", agent: "tdd-spec-reviewer" }),
    );
    try {
      const r = await runAuditFixLoopPatternInvariantsProbe(root);
      expect(r.vacuous).toBe(false);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Self-run sanity — the repo's own files must pass clean on main at FR ship.
// (Required by the FR's Testing section: "the new probe must pass clean on
// `main` at FR ship".)
// ─────────────────────────────────────────────────────────────────────────────

describe("self-run sanity", () => {
  test("repo's own files pass the probe (clean on main at FR ship)", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const r = await runAuditFixLoopPatternInvariantsProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});

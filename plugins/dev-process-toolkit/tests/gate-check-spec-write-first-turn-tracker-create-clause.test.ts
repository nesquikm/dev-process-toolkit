// STE-404 AC-STE-404.4 — /gate-check probe
// `spec_write_first_turn_tracker_create_clause`. Severity: error.
//
// Asserts skills/spec-write/SKILL.md carries the first-turn tracker-create
// prohibition: the two tracker-create MCP tool names + a first-turn-forbidden
// anchor. Single-file scope, literal substring match, vacuous when absent.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TRACKER_CREATE_CLAUSE_REQUIRED_LITERALS,
  runSpecWriteFirstTurnTrackerCreateClauseProbe,
} from "../adapters/_shared/src/spec_write_first_turn_tracker_create_clause";

const SPEC_WRITE_SKILL = "plugins/dev-process-toolkit/skills/spec-write/SKILL.md";

const KNOWN_GOOD = [
  "# Spec Write",
  "",
  "> FIRST ACTION: Write/Edit/NotebookEdit and the tracker-create MCP tools",
  "(`mcp__atlassian__createJiraIssue`, `mcp__linear__save_issue`) are",
  "forbidden before the first ask/refusal — the autonomous-mode reminder is",
  "the escalation trigger to resist.",
  "",
].join("\n");

function makeFixture(body?: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tracker-create-clause-"));
  if (body !== undefined) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-404.4 — spec_write_first_turn_tracker_create_clause probe", () => {
  test("SKILL body carrying all required literals ⇒ zero violations", async () => {
    const fx = makeFixture(KNOWN_GOOD);
    try {
      const r = await runSpecWriteFirstTurnTrackerCreateClauseProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when the SKILL is absent ⇒ zero violations", async () => {
    const fx = makeFixture(undefined);
    try {
      const r = await runSpecWriteFirstTurnTrackerCreateClauseProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  for (const literal of TRACKER_CREATE_CLAUSE_REQUIRED_LITERALS) {
    test(`missing required literal ${JSON.stringify(literal)} ⇒ violation naming it`, async () => {
      const truncated = KNOWN_GOOD.split(literal).join("[REDACTED]");
      const fx = makeFixture(truncated);
      try {
        const r = await runSpecWriteFirstTurnTrackerCreateClauseProbe(fx.root);
        expect(r.violations.length).toBeGreaterThanOrEqual(1);
        const v = r.violations[0]!;
        expect(v.severity).toBe("error");
        expect(v.file).toContain(SPEC_WRITE_SKILL);
        expect(v.message).toMatch(/Remedy:/);
        expect(v.message).toMatch(/Context:/);
        expect(v.message).toContain("spec_write_first_turn_tracker_create_clause");
        const messages = r.violations.map((x) => x.message).join("\n");
        expect(messages).toContain(literal);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("real shipped spec-write SKILL.md carries the clause (integration smoke)", async () => {
    const repoRoot = join(__dirname, "..", "..", "..");
    const r = await runSpecWriteFirstTurnTrackerCreateClauseProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});

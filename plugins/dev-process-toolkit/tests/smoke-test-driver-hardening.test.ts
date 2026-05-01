import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-175 — /smoke-test driver hardening (project-local skill at
// .claude/skills/smoke-test/SKILL.md). Doc-conformance: Phase 0.5 scratch
// reset + pre-flight #5 team-by-key + --reset flag.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

// The smoke-test skill is project-local and may not exist in every checkout
// (e.g., a downstream user's clone of just the plugin). Skip the suite when
// missing — STE-175 only governs the dogfood-side surface.
const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-175 AC-STE-175.1 — Phase 0.5 scratch-reset block", () => {
  test("Phase 0.5 heading exists between Phase 0 and Phase 1", () => {
    const body = skill!;
    const phase0 = body.indexOf("Phase 0 — Pre-approval");
    const phase05 = body.search(/Phase 0\.5\b/);
    const phase1 = body.indexOf("Phase 1 — Setup");
    expect(phase0).toBeGreaterThan(-1);
    expect(phase05).toBeGreaterThan(phase0);
    expect(phase1).toBeGreaterThan(phase05);
  });

  test("Phase 0.5 clears /tmp/dpt-smoke-prompt-*.txt and per-tracker logs", () => {
    const body = skill!;
    expect(body).toMatch(/rm -f\s+\/tmp\/dpt-smoke-prompt-\*\.txt/);
    expect(body).toMatch(/\/tmp\/dpt-smoke-<tracker>-\*\.log/);
  });

  test("Phase 0.5 explicitly preserves findings files + approval files", () => {
    const body = skill!;
    // The prose must call out the audit-trail artifacts so a future edit
    // doesn't widen the rm to include them.
    expect(body).toMatch(/findings/i);
    expect(body).toMatch(/approval/i);
    expect(body).toMatch(/(do NOT|do not|preserve|retain|never delete)/i);
  });
});

describeIfPresent("STE-175 AC-STE-175.2 — pre-flight #5 probes Linear team by key", () => {
  test("pre-flight #5 names a key-first probe (get_team or list_teams + key filter)", () => {
    const body = skill!;
    // Either `mcp__linear__get_team` (direct lookup) or a list_teams call
    // with a `team.key ==` filter.
    expect(body).toMatch(/mcp__linear__get_team|team\.key\s*==/);
  });

  test("pre-flight #5 keeps name-prefix `query=` only as fallback", () => {
    const body = skill!;
    // The prose must commit to "key first, name-prefix fallback" ordering.
    expect(body).toMatch(/fallback|fall back/i);
    expect(body).toMatch(/query=/);
  });
});

describeIfPresent("STE-175 AC-STE-175.3 — --reset flag", () => {
  test("argument-parsing section names --reset", () => {
    const body = skill!;
    // Argument-parsing block must declare the new flag.
    const argSection = body.indexOf("## Argument parsing");
    expect(argSection).toBeGreaterThan(-1);
    const tail = body.slice(argSection);
    expect(tail).toMatch(/--reset\b/);
  });

  test("--reset triggers `rm -rf ../dpt-test-project-<tracker>` from pre-flight #2", () => {
    const body = skill!;
    // Pre-flight #2 must explain the flag's effect.
    expect(body).toMatch(/--reset.*rm -rf|rm -rf.*--reset/i);
  });

  test("Phase 0 contract surfaces the RESET line when the flag is present", () => {
    const body = skill!;
    expect(body).toContain(
      "RESET: existing ../dpt-test-project-<tracker> will be deleted before run.",
    );
  });

  test("default behavior unchanged — without --reset, pre-flight #2 still refuses", () => {
    const body = skill!;
    // Negative phrasing must stay so the operator-explicit deletion path
    // is preserved.
    expect(body).toMatch(/default behavior unchanged|without --reset/i);
  });
});

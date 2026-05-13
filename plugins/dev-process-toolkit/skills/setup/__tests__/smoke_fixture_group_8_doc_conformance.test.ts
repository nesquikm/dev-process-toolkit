import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-286 AC.2 / AC.3 / AC.4 / AC.5 / AC.6 / AC.7 — doc-conformance tests.
//
// These ACs are verified by grep on:
//   - `.claude/skills/smoke-test/SKILL.md` (fixture group 8 prose)
//   - `specs/frs/STE-286.md` (AC.7 empirical-finding subsection in Notes)
//
// Each AC is encoded as one or more `test()` blocks asserting the SKILL.md
// (or FR file) contains a load-bearing token per the AC's `verify:` clauses.
//
// The smoke-test SKILL.md does NOT yet carry fixture group 8 prose; AC.2-AC.6
// tests fail RED until the implementer adds the group-8 block. AC.7's empirical
// finding subsection IS already present in STE-286.md Notes (recorded
// 2026-05-13), so the AC.7 grep test passes immediately — that's intentional
// per the FR-writer guidance: AC.7's substance is the documented finding, not
// a code change, and the test still belongs in the suite to catch future
// drift.

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
// Resolve the FR file at either the active or archive path — the doc
// conformance assertion holds for the same spec content after Phase 4
// milestone archival relocates the file (per STE-285's b01757f precedent).
const FR_ACTIVE = join(REPO_ROOT, "specs", "frs", "STE-286.md");
const FR_ARCHIVE = join(REPO_ROOT, "specs", "frs", "archive", "STE-286.md");
const FR_PATH = existsSync(FR_ACTIVE) ? FR_ACTIVE : FR_ARCHIVE;

function readSmokeSkill(): string {
  return readFileSync(SMOKE_SKILL_PATH, "utf-8");
}

function readFR(): string {
  return readFileSync(FR_PATH, "utf-8");
}

describe("AC-STE-286.2 — smoke SKILL.md carries fixture group 8 prose", () => {
  test("contains the canonical group-8 header token 'STE-285 hooks runtime regression'", () => {
    const body = readSmokeSkill();
    expect(body).toContain("STE-285 hooks runtime regression");
  });

  test("declares the diagnostic shape 'STE-285 runtime regression:'", () => {
    const body = readSmokeSkill();
    expect(body).toContain("STE-285 runtime regression:");
  });

  test("references this FR (STE-286) so a smoke regression points back to the spec", () => {
    const body = readSmokeSkill();
    expect(body).toContain("STE-286");
  });

  test("positions fixture group 8 after fixture group 7 (STE-225 TDD orchestrator forks)", () => {
    const body = readSmokeSkill();
    const idxGroup7 = body.indexOf("Fixture group 7");
    const idxGroup8 = body.indexOf("Fixture group 8");
    expect(idxGroup7).toBeGreaterThan(-1);
    expect(idxGroup8).toBeGreaterThan(-1);
    expect(idxGroup8).toBeGreaterThan(idxGroup7);
  });
});

describe("AC-STE-286.3 — install-verification prose for `.claude/settings.json`", () => {
  test("group-8 prose documents the 3-entry PreToolUse:Bash + 1-entry UserPromptSubmit:* shape", () => {
    const body = readSmokeSkill();
    // Mention of both matchers ("Bash" and "*") is load-bearing per AC.3.
    expect(body).toContain('"matcher": "Bash"');
    expect(body).toContain('"matcher": "*"');
  });

  test("group-8 prose references `<test-project>/.claude/settings.json` as the install-verification source", () => {
    const body = readSmokeSkill();
    expect(body).toMatch(/<test-project>\/\.claude\/settings\.json/);
  });

  test("group-8 prose names `--hooks=all` as the install vector for fixture group 8", () => {
    const body = readSmokeSkill();
    expect(body).toContain("--hooks=all");
  });
});

describe("AC-STE-286.4 — runtime-refusal probe prose + 4-scenario log filenames", () => {
  test("group-8 prose documents the per-scenario log filename pattern", () => {
    const body = readSmokeSkill();
    expect(body).toContain("/tmp/dpt-smoke-<tracker>-hooks-runtime-");
  });

  test("group-8 prose names all 4 scenarios", () => {
    const body = readSmokeSkill();
    expect(body).toContain("pre-commit-gate-check");
    expect(body).toContain("pre-commit-tdd-orchestrator");
    expect(body).toContain("pre-pr-spec-review");
    expect(body).toContain("pre-spec-write-brainstorm-reminder");
  });

  test("group-8 prose documents the per-scenario standalone bash subprocess fallback (AC.7 finding)", () => {
    // Per FR Notes "$CLAUDE_SESSION_FILE empirical finding" the canonical
    // driver shape is 4 standalone bash subprocesses, not a single shared
    // claude -p child. Prose must reflect this.
    const body = readSmokeSkill();
    expect(body).toMatch(/standalone\s+`?bash`?\s+subprocess|bash\s+subprocess/i);
  });
});

describe("AC-STE-286.5 — per-scenario NFR-10 assertion prose", () => {
  test("group-8 prose documents the 'Refusing:' + 'hook=pre-commit-gate-check' assertion (scenario 1)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("hook=pre-commit-gate-check");
  });

  test("group-8 prose documents the 'hook=pre-commit-tdd-orchestrator' assertion (scenario 2)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("hook=pre-commit-tdd-orchestrator");
  });

  test("group-8 prose documents the 'hook=pre-pr-spec-review' assertion (scenario 3)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("hook=pre-pr-spec-review");
  });

  test("group-8 prose documents the 'hook=pre-spec-write-brainstorm-reminder' assertion (scenario 4)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("hook=pre-spec-write-brainstorm-reminder");
  });

  test("group-8 prose documents the Refusing: token (scenarios 1-3)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("Refusing:");
  });

  test("group-8 prose documents the Reminder: token (scenario 4, advisory)", () => {
    const body = readSmokeSkill();
    expect(body).toContain("Reminder:");
  });

  test("group-8 prose documents the dev-process-toolkit:<skill> remediation token shapes", () => {
    const body = readSmokeSkill();
    expect(body).toContain("dev-process-toolkit:gate-check");
    expect(body).toContain("dev-process-toolkit:tdd");
    expect(body).toContain("dev-process-toolkit:spec-review");
    expect(body).toContain("dev-process-toolkit:brainstorm");
  });
});

describe("AC-STE-286.6 — findings-file regression line + clean-run PASS line prose", () => {
  test("group-8 prose documents the findings-file append path", () => {
    const body = readSmokeSkill();
    expect(body).toContain("/tmp/dpt-smoke-<tracker>-findings-");
  });

  test("group-8 prose documents the clean-run summary line 'STE-285 runtime check: PASS'", () => {
    const body = readSmokeSkill();
    expect(body).toContain("STE-285 runtime check: PASS");
  });
});

describe("AC-STE-286.7 — FR Notes carries the $CLAUDE_SESSION_FILE empirical finding", () => {
  test("STE-286.md Notes section contains the empirical-finding subsection", () => {
    const body = readFR();
    expect(body).toContain("$CLAUDE_SESSION_FILE` empirical finding");
  });

  test("empirical finding names the chosen fallback path (per-scenario standalone bash subprocesses)", () => {
    const body = readFR();
    // Fallback path = per-scenario standalone `bash` subprocesses (not a
    // single shared `claude -p` child).
    expect(body).toMatch(/standalone\s+`?bash`?\s+subprocess/i);
  });

  test("empirical finding references AC-STE-286.7's accepted fallback clause", () => {
    const body = readFR();
    expect(body).toContain("AC-STE-286.7");
  });
});

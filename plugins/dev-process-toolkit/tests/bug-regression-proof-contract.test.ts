import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTddResultBlock } from "../adapters/_shared/src/tdd_result";

// A bug FR (`kind: bug`) is fixed only when a test catches the bug: RED on the
// code before the fix, at the assertion that encodes the bug, through API that
// exists before the fix, and GREEN on the fix. The rule lives in prose the
// model follows — the test-writer's RED, the implementer's first plant, the
// two audits, /debug's path for a reported bug — so each sentence a regression
// would quietly drop is pinned on the surface that owns it. Literal
// substrings, not paraphrase: the point is that the rule is still stated.

const PLUGIN = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN, rel), "utf8");

const TEST_WRITER_SKILL = "skills/tdd-write-test/SKILL.md";
const TEST_WRITER_AGENT = "agents/tdd-test-writer.md";
const IMPLEMENTER_SKILL = "skills/tdd-implement/SKILL.md";
const IMPLEMENTER_AGENT = "agents/tdd-implementer.md";
const TDD_AUDIT_SKILL = "skills/tdd-spec-review/SKILL.md";
const TDD_AUDIT_AGENT = "agents/tdd-spec-reviewer.md";
const SPEC_AUDIT_SKILL = "skills/spec-review-audit/SKILL.md";
const SPEC_AUDIT_AGENT = "agents/spec-reviewer.md";
const DEBUG = "skills/debug/SKILL.md";
const RESOLVER_ENTRY = "docs/resolver-entry.md";
const IMPLEMENT = "docs/implement-reference.md";
const PATTERNS = "docs/patterns.md";
const TESTING_SPEC_TEMPLATE = "templates/spec-templates/testing-spec.md.template";

const PROOF_LINE = "`regression: <AC-id> <test name> red at <assertion> on <ref>`";
const ROLLBACK_PROOF_LINE = "`regression: <test> red at <assertion> on <pre-fix> → green on <fix>`";

describe("the test-writer — a bug FR's RED is the regression proof", () => {
  test("the skill has a section for a bug FR", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("## A bug FR (`kind: bug`)");
  });

  test("every bug case gets a test", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "**A test for every bug case.** Every AC is a bug case, the `Regression:` one and each other",
    );
  });

  test("RED counts only at the assertion that encodes the bug", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "**RED at the assertion that encodes the bug.** The test fails the way the FR's Actual describes, at its assertion. RED from a missing symbol, a compile error, setup or a lookup on the way does not count here",
    );
  });

  test("the test uses only API that exists before the fix", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "**Only API that exists before the fix.** No function, parameter, key or file the fix is about to add",
    );
  });

  test("a bug-case test that is GREEN before the fix is a failed RED", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "**GREEN before the fix is no regression test.** A bug-case test that passes now",
    );
  });

  test("the skill records one proof line per AC", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`**Record the proof**, one \`notes\` line per AC: ${PROOF_LINE}`);
  });

  test("the skill's missing-symbol rule names the bug FR exception", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "- **RED from a missing symbol is accepted, and proves little** (not on a bug FR, where it does not count: § A bug FR).",
    );
  });

  test("the agent carries the bug FR rule and its proof line", () => {
    const agent = read(TEST_WRITER_AGENT);
    expect(agent).toContain(
      "**A bug FR** (`kind: bug` in its frontmatter): the code still has the bug, so this RED is the regression proof.",
    );
    expect(agent).toContain(`Record one \`notes\` line per AC (block form \`notes: |\`): ${PROOF_LINE}`);
  });

  test("the agent's missing-symbol rule names the bug FR exception", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "**RED from a missing symbol** is accepted and proves only that the code is absent, except on a bug FR.",
    );
  });
});

describe("the implementer — a Regression: AC's first plant undoes the fix", () => {
  test("the skill makes the first plant the fix undone in one file", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(
      "When the AC's body begins `Regression:`, make the first plant your fix undone in one file",
    );
  });

  test("the agent makes the first plant the fix undone in one file", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "When the AC's body begins `Regression:`, the first plant is your fix undone in one file",
    );
  });
});

describe("the audits — a bug-case test must run on the code before the fix", () => {
  const RULE = "a test that asserts only that the fix's new code ran (a function, branch or key the change added) cannot run on the code before the fix";

  for (const rel of [TDD_AUDIT_SKILL, TDD_AUDIT_AGENT, SPEC_AUDIT_SKILL, SPEC_AUDIT_AGENT]) {
    test(`${rel} classifies a test of the fix's new code as partial`, () => {
      expect(read(rel)).toContain(RULE);
    });

    test(`${rel} classifies a Regression: AC with no test as missing`, () => {
      expect(read(rel)).toMatch(/A `Regression:` AC whose named test is not found is `(✗ Missing|missing)`/);
    });
  }
});

describe("/debug — a reported bug is fixed only when a test catches it", () => {
  test("the skill has a section for a reported bug", () => {
    expect(read(DEBUG)).toContain("## A reported bug");
  });

  test("a bug FR is fixed through /implement, not in Phase 4 first", () => {
    expect(read(DEBUG)).toContain("the fix itself goes through `/implement <FR-id>`");
  });

  test("a fix made before its test is proved by rolling it back", () => {
    expect(read(DEBUG)).toContain(
      "for each non-test path in `git diff --name-status <pre-fix> <fix>`, `M` or `D` → `git checkout <pre-fix> -- <path>`, `A` → `git rm -q <path>`",
    );
  });

  test("the change description carries one proof line per bug case", () => {
    expect(read(DEBUG)).toContain(`Put one line per bug case in the change description: ${ROLLBACK_PROOF_LINE}`);
  });

  test("the rules forbid fixing a reported bug before a test reproduces it", () => {
    expect(read(DEBUG)).toContain("- Do NOT fix a reported bug before a test reproduces it");
  });
});

describe("the docs — what proves a Regression: criterion", () => {
  test("resolver-entry § Bug FR body states the proof", () => {
    expect(read(RESOLVER_ENTRY)).toContain(
      "**What proves a `Regression:` criterion.** Its test goes RED on the code before the fix, at the assertion that encodes the bug, through API that exists before the fix, and GREEN on the fix.",
    );
  });

  test("the step-14 AC row carries each bug AC's proof line", () => {
    expect(read(IMPLEMENT)).toContain(
      "On a bug FR (`kind: bug`), each AC row also carries the `regression:` line the test-writer recorded for it in Stage RED's `notes`; an AC without one is listed as unproved.",
    );
  });

  test("the defect-check pattern names the bug variant", () => {
    expect(read(PATTERNS)).toContain("**A bug's test proves itself on the code before the fix.**");
  });

  test("the testing-spec template carries the bug rule", () => {
    expect(read(TESTING_SPEC_TEMPLATE)).toContain(
      "- **A bug's test:** RED on the code before the fix at the assertion that encodes the bug",
    );
  });
});

describe("the tdd-result block carries one regression line per AC", () => {
  test("a block-form notes keeps every regression line, in order", () => {
    const body = [
      "role: test-writer",
      "status: ok",
      "files:",
      "  - tests/login.test.ts",
      "command: bun test tests/login.test.ts",
      "output_excerpt: |",
      "  (fail) login keeps the session after a 404",
      "notes: |",
      "  regression: AC-BUG-1.1 login keeps the session after a 404 red at expect(session).toBe(saved) on 1a2b3c4",
      "  regression: AC-BUG-1.2 login retries once red at expect(calls).toBe(2) on 1a2b3c4",
    ].join("\n");
    const r = parseTddResultBlock(body, { expectedRole: "test-writer" });
    expect(r.ok).toBe(true);
    const lines = r.ok ? (r.block.notes ?? "").split("\n") : [];
    expect(lines).toEqual([
      "regression: AC-BUG-1.1 login keeps the session after a 404 red at expect(session).toBe(saved) on 1a2b3c4",
      "regression: AC-BUG-1.2 login retries once red at expect(calls).toBe(2) on 1a2b3c4",
    ]);
  });
});

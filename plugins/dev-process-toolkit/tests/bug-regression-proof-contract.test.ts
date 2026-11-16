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
const NA_LINE = "`regression: <AC-id> n/a — guards unchanged behavior`";
const NAMED_TEST = "A `Regression:` AC that names its test (`<test file> › <test name>`) gets it at that path, under that name.";
const KEPT_OUTCOME_LINE = "`defect check: fix undone in <file> → still GREEN; <plant 2> → red at <test name>`";
const ROLLBACK_PROOF_LINE = "`regression: <test> red at <assertion> on <pre-fix> → green on <fix>`";

describe("the test-writer — a bug FR's RED is the regression proof", () => {
  test("the skill has a section for a bug FR", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("## A bug FR (`kind: bug`)");
  });

  test("every bug case gets a test", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "**A test for every bug case.** A bug case is an AC the bug breaks: the `Regression:` one, and any other AC the FR's Actual shows failing today.",
    );
  });

  // An AC that guards behavior the bug leaves intact is GREEN before the fix
  // by design; demanding RED of it would halt an ordinary bug FR in mode A.
  test("an AC guarding unchanged behavior is no bug case", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`its line reads ${NA_LINE}`);
  });

  test("a Regression: AC's named test goes at the path and name it gives", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(NAMED_TEST);
  });

  test("a bug FR allows the test-writer one more run after a rewrite", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "A test that misses any of these is rewritten and the command run once more: a bug FR allows that second run.",
    );
  });

  test("the proof's git reads ride the test run's Bash call", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("Run both in the same Bash call as the test command.");
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

  test("the agent counts a bug case, its named test and an unchanged-behavior AC as the skill does", () => {
    const agent = read(TEST_WRITER_AGENT);
    expect(agent).toContain("A bug case is an AC the bug breaks: the `Regression:` one, and any other AC the FR's Actual shows failing today.");
    expect(agent).toContain(NAMED_TEST);
    expect(agent).toContain(`its line reads ${NA_LINE}`);
  });

  test("the agent does not count RED before the assertion, a lookup on the way included", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "RED from a missing symbol, a compile error, setup or a lookup on the way does not count",
    );
  });

  test("the agent allows one more run after a rewrite", () => {
    expect(read(TEST_WRITER_AGENT)).toContain("the command run once more: a bug FR allows that second run.");
  });
});

describe("the implementer — a Regression: AC's first plant undoes the fix", () => {
  test("the skill makes the first plant the fix undone in one file", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(
      "When the AC's body begins `Regression:`, make the first plant the fix undone in one file",
    );
  });

  test("the agent makes the first plant the fix undone in one file", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "When the AC's body begins `Regression:`, the first plant is the fix undone in one file",
    );
  });

  // Earlier ACs' forks may have written the fix, and a resumed fork wrote
  // nothing: the committed version is the code before the fix either way.
  test("the skill undoes the fix from its committed version, whoever wrote it", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(
      "copy in the committed version (`git show HEAD:<path>`) of a source file the fix modified, whichever AC's fork wrote the fix",
    );
  });

  test("the agent undoes the fix from its committed version, whoever wrote it", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "the committed version (`git show HEAD:<path>`) of a source file the fix modified, whichever AC's fork wrote it",
    );
  });

  // A fix-undone plant that stayed GREEN must stay in the line, where the
  // orchestrator lists `still GREEN` on an `ok` block as unverified.
  test("the skill keeps the fix-undone plant's outcome in its line", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(`keep its outcome there when it did not go RED at the assertion: ${KEPT_OUTCOME_LINE}`);
  });

  test("the agent keeps the fix-undone plant's outcome in its line", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(`keep its outcome in \`notes\` when it did not go RED at the assertion: ${KEPT_OUTCOME_LINE}`);
  });
});

describe("the audits — a bug-case test must run on the code before the fix", () => {
  const RULE = "a test that asserts only that the fix's new code ran (a function, branch or key the change added) cannot run on the code before the fix";

  for (const rel of [TDD_AUDIT_SKILL, TDD_AUDIT_AGENT, SPEC_AUDIT_SKILL, SPEC_AUDIT_AGENT]) {
    test(`${rel} classifies a test of the fix's new code as partial`, () => {
      expect(read(rel)).toContain(RULE);
    });

    test(`${rel} classifies a Regression: test off its named path or name as partial`, () => {
      expect(read(rel)).toContain(
        "So is a `Regression:` AC whose test sits at another path or under another name than the one the AC gives.",
      );
    });

    // A new `missing` verdict would send the audit's retry round to a
    // test-writer that cannot see RED on a tree the fix already changed.
    test(`${rel} adds no missing verdict for a Regression: AC`, () => {
      expect(read(rel)).not.toContain("whose named test is not found");
    });

    test(`${rel} counts only an AC the bug breaks as a bug case`, () => {
      expect(read(rel)).toContain("a bug case is an AC the bug breaks, and its test must drive the condition");
    });
  }
});

describe("/debug — a reported bug is fixed only when a test catches it", () => {
  test("the skill has a section for a reported bug", () => {
    expect(read(DEBUG)).toContain("## A reported bug");
  });

  test("a bug FR is fixed through /implement, not in Phase 4 first", () => {
    expect(read(DEBUG)).toContain("The fix itself goes through `/implement <FR-id>`");
  });

  // /implement's Stage RED must see the code before the fix.
  test("a bug FR's investigation leaves no fix behind for /implement", () => {
    expect(read(DEBUG)).toContain("leave no fix behind: revert Phase 3's edits");
  });

  // A renamed path prints as R100, which the M/D/A recipe would skip.
  test("a fix made before its test is proved by rolling it back, renames split", () => {
    expect(read(DEBUG)).toContain(
      "for each non-test path in `git diff --name-status --no-renames <pre-fix> <fix>`, `M` or `D` → `git checkout <pre-fix> -- <path>`, `A` → `git rm -q <path>`",
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

  test("resolver-entry counts only an AC the bug breaks as a bug case", () => {
    expect(read(RESOLVER_ENTRY)).toContain(
      "Every bug case, an AC the bug breaks, gets such a test; an AC that guards behavior the bug leaves intact is no bug case.",
    );
  });

  test("the step-14 AC row carries each bug AC's proof line and the unproved count", () => {
    expect(read(IMPLEMENT)).toContain(
      "On a bug FR (`kind: bug`), the row also states how many ACs are unproved, and each AC row carries the `regression:` line the test-writer recorded for it in Stage RED's `notes`; an AC without one is listed as unproved.",
    );
  });

  test("a resumed run's ACs are not reported unproved for a Stage RED it skipped", () => {
    expect(read(IMPLEMENT)).toContain(
      "A `--resume-at` run skipped Stage RED, so its ACs read `not in this run — resumed at <point>` instead.",
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

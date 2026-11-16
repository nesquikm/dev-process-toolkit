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

// The closed set of the test-writer's `notes` lines on a bug FR.
const PROOF_LINE = "`regression: <AC-id> <test name> red at <assertion> on <ref>`";
const NEW_BEHAVIOR_LINE = "`regression: <AC-id> n/a — new behavior the fix adds`";
const UNCHANGED_LINE = "`regression: <AC-id> n/a — guards unchanged behavior`";
const NOT_PROVED_LINE = "`regression: <AC-id> not proved — <reason>`";
const NAMED_TEST = "A `Regression:` AC that names its test (`<test file> › <test name>`) gets it at that path, under that name.";
const BUG_CASE = "A bug case is an AC the bug breaks: the `Regression:` one, and any other AC the FR's Actual shows failing today.";
// The implementer's defect-check line on a `Regression:` AC, when the undo is no proof.
const UNDO_NO_PROOF = "`defect check: fix undone in <file> → <still GREEN | changed nothing | red before the assertion>; <plant 2> → red at <test name>`";
const UNDO_NA = "`defect check: fix undone: n/a — <no snapshot | the fix adds files only>; <plant 2> → red at <test name>`";
const SNAPSHOT_FILE = "`<git-dir>/dpt-red-base/<prefix>`";
const ROLLBACK_PROOF_LINE = "`regression: <test> red at <assertion> on <pre-fix> → green on <fix>`";

/** The `## A bug FR` section of the test-writer skill, up to the next `## ` heading. */
function bugFrSection(md: string): string {
  const start = md.indexOf("## A bug FR (`kind: bug`)");
  if (start < 0) return "";
  const next = md.indexOf("\n## ", start + 1);
  return md.slice(start, next < 0 ? undefined : next);
}

describe("the test-writer — a bug FR's RED is the regression proof", () => {
  test("the skill has a section for a bug FR", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("## A bug FR (`kind: bug`)");
  });

  test("every bug case gets a test", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`- **${BUG_CASE.replace("A bug case", "A bug case**")}`);
  });

  // An AC for behavior the fix adds cannot be RED before the fix except on a
  // missing symbol; holding it to the bug-case rule leaves it no legal path.
  test("an AC for new behavior the fix adds follows the ordinary RED rule", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "- **New behavior the fix adds** (a helper, a parameter, a message the FR asks for) does not exist yet, so the Actual cannot show it failing. Its test follows the ordinary rules, RED from a missing symbol included",
    );
  });

  test("an AC guarding unchanged behavior needs no RED", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "- **Unchanged behavior** the bug leaves intact passes before the fix by design and needs no RED.",
    );
  });

  test("a bug case's RED counts only at the assertion that encodes the bug", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "It goes RED at the assertion that encodes the bug, the way the FR's Actual describes: RED from a missing symbol, a compile error, setup or a lookup on the way does not count here",
    );
  });

  test("a bug case's test uses only API that exists before the fix", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "It uses only API that exists before the fix, no function, parameter, key or file the fix is about to add",
    );
  });

  // The scoping itself: the API rule sits inside the bug-case bullet, not in
  // the section's preamble, where it would bind every AC of the FR again.
  test("the API-before-the-fix rule binds bug cases only", () => {
    const lines = bugFrSection(read(TEST_WRITER_SKILL)).split("\n").filter((l) => l.includes("API that exists before the fix"));
    expect(lines.map((l) => l.startsWith("- **A bug case**"))).toEqual([true]);
  });

  test("a Regression: AC's named test goes at the path and name it gives", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(NAMED_TEST);
  });

  test("the skill records a bug case's proof line", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`- ${PROOF_LINE} — a bug case RED at its assertion;`);
  });

  test("the skill records an AC for new behavior as n/a", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`- ${NEW_BEHAVIOR_LINE};`);
  });

  test("the skill records an AC guarding unchanged behavior as n/a", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(`- ${UNCHANGED_LINE};`);
  });

  // A bug case GREEN before the fix (the fix already in the tree, as in the
  // audit's retry round) is recorded, not failed: a failed test-writer has no
  // orchestrator mode, and a halt there has no exit the operator can take.
  test("the skill records a bug case it cannot prove as not proved", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      `- ${NOT_PROVED_LINE} — a bug case whose test is GREEN now (the bug does not reproduce that way, or the fix is already in the working tree) or RED only before its assertion.`,
    );
  });

  test("a not proved line does not fail the run", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "A `not proved` line does not fail the run: return `status: ok` when the run is otherwise sound, and `/implement` step 14 lists the AC as unproved.",
    );
  });

  test("the bug FR section never asks for status: failed", () => {
    const section = bugFrSection(read(TEST_WRITER_SKILL));
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toContain("status: failed");
  });

  test("a bug case is rewritten once before it is recorded not proved, when a turn is left", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("When a turn is left, rewrite such a test once and run the command again first.");
  });

  test("the ref names a repository with no commit", () => {
    expect(read(TEST_WRITER_SKILL)).toContain("`<ref>` is `git rev-parse --short HEAD`, or `no-commit` in a repository without one");
  });

  test("the skill records the Stage RED snapshot through a temporary index", () => {
    const md = read(TEST_WRITER_SKILL);
    expect(md).toContain("**Record the Stage RED snapshot.**");
    expect(md).toContain('GIT_INDEX_FILE="$i" git add -A && t=$(GIT_INDEX_FILE="$i" git write-tree) && echo "$h $t" > "$f"');
  });

  // The audit's retry round runs after GREEN: rewriting the snapshot then
  // would make it hold the fix, and the undo plant would undo nothing.
  test("the snapshot is rewritten only when HEAD has moved", () => {
    const md = read(TEST_WRITER_SKILL);
    expect(md).toContain('if [ "$(cut -d\' \' -f1 "$f" 2>/dev/null)" != "$h" ]; then');
    expect(md).toContain("The file names the `HEAD` it was taken on and is rewritten only when that `HEAD` has moved");
  });

  test("the skill's missing-symbol rule names the bug case exception", () => {
    expect(read(TEST_WRITER_SKILL)).toContain(
      "- **RED from a missing symbol is accepted, and proves little** (not for a bug case on a bug FR, where it does not count: § A bug FR).",
    );
  });

  test("the agent sorts a bug case and places its named test as the skill does", () => {
    const agent = read(TEST_WRITER_AGENT);
    expect(agent).toContain(BUG_CASE);
    expect(agent).toContain(NAMED_TEST);
  });

  test("the agent does not count RED before the assertion, a lookup on the way included", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "RED from a missing symbol, a compile error, setup or a lookup on the way does not count here.",
    );
  });

  test("the agent lets new behavior follow the ordinary rule", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "New behavior the fix adds follows the ordinary rules, RED from a missing symbol included; unchanged behavior the bug leaves intact needs no RED.",
    );
  });

  test("the agent carries the closed set of notes lines", () => {
    const agent = read(TEST_WRITER_AGENT);
    expect([PROOF_LINE, NEW_BEHAVIOR_LINE, UNCHANGED_LINE, NOT_PROVED_LINE].filter((l) => !agent.includes(l))).toEqual([]);
  });

  test("the agent returns ok over a not proved line", () => {
    expect(read(TEST_WRITER_AGENT)).toContain("A `not proved` line does not fail the run: return `status: ok`.");
  });

  test("the agent records the Stage RED snapshot", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "record the Stage RED snapshot the implementer undoes the fix from, as the child skill's § A bug FR shows.",
    );
  });

  test("the agent's missing-symbol rule names the bug case exception", () => {
    expect(read(TEST_WRITER_AGENT)).toContain(
      "**RED from a missing symbol** is accepted and proves only that the code is absent, except for a bug case on a bug FR.",
    );
  });
});

describe("the implementer — a Regression: AC's first plant undoes the fix", () => {
  test("the skill makes the first plant the fix undone in one file, from the snapshot", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(
      "When the AC's body begins `Regression:`, make the first plant the fix undone in one file, from the Stage RED snapshot the test-writer recorded",
    );
  });

  test("the agent makes the first plant the fix undone in one file, from the snapshot", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "When the AC's body begins `Regression:`, the first plant is the fix undone in one file: `git show <tree>:<path>`",
    );
  });

  // Under `/implement M<N>` an earlier FR's work sits uncommitted in the tree:
  // `HEAD` would undo it too. The snapshot predates this FR's implementers only.
  test("the skill reads the snapshot, not HEAD", () => {
    const md = read(IMPLEMENTER_SKILL);
    expect(md).toContain(`\`<tree>\` is the second field of ${SNAPSHOT_FILE}`);
    expect(md).not.toContain("git show HEAD:<path>");
  });

  test("the agent reads the snapshot, not HEAD", () => {
    const md = read(IMPLEMENTER_AGENT);
    expect(md).toContain(`the second field of ${SNAPSHOT_FILE}`);
    expect(md).not.toContain("git show HEAD:<path>");
  });

  test("the skill undoes a file the snapshot diff names as modified", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain("Pick a source file `git diff --name-status --no-renames <tree>` lists as modified");
  });

  test("the skill names an undo that is no proof", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(UNDO_NO_PROOF);
  });

  test("the agent names an undo that is no proof", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(UNDO_NO_PROOF);
  });

  test("the skill names an undo with nothing to plant", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(UNDO_NA);
  });

  test("the agent names an undo with nothing to plant", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(UNDO_NA);
  });

  test("the skill hands every undo but a red one to step 14 as unproved", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain("`/implement` step 14 counts every other form as unproved.");
  });

  // The undo plant takes out code other ACs' forks wrote in that file, so the
  // isolation sentence that named only the test-file read is no longer whole.
  test("the skill's isolation sentence names the undo plant", () => {
    expect(read(IMPLEMENTER_SKILL)).toContain(
      "on a `Regression:` AC its first plant also swaps one source file back to its Stage RED version for the length of the check",
    );
  });

  test("the agent's isolation rule names the undo plant", () => {
    expect(read(IMPLEMENTER_AGENT)).toContain(
      "on a `Regression:` AC the first plant swaps one source file back to its Stage RED version for the length of the check",
    );
  });
});

describe("the audits — a bug-case test must run on the code before the fix", () => {
  const RULE = "a test that asserts only that the fix's new code ran (a function, branch or key the change added) cannot run on the code before the fix";
  const VERDICT: Record<string, string> = {
    [TDD_AUDIT_SKILL]: "`⚠ Partial`",
    [TDD_AUDIT_AGENT]: "`⚠ Partial`",
    [SPEC_AUDIT_SKILL]: "`partial`",
    [SPEC_AUDIT_AGENT]: "`partial`",
  };

  for (const [rel, verdict] of Object.entries(VERDICT)) {
    // Through the verdict word: a pin that stops before it lets `done` slip in.
    test(`${rel} classifies a test of the fix's new code as partial`, () => {
      expect(read(rel)).toContain(`${RULE}, so it is ${verdict}.`);
    });

    test(`${rel} classifies a Regression: test off its named path or name as partial`, () => {
      expect(read(rel)).toContain(
        "So is a `Regression:` AC whose test sits at another path or under another name than the one the AC gives.",
      );
    });

    // A `missing` verdict would send the audit's retry round to a test-writer
    // that cannot see RED on a tree the fix already changed. Graded on the
    // bug FR passage itself, whatever words a regression would use.
    test(`${rel}'s bug FR passage gives partial and never missing`, () => {
      const passage = read(rel).split("\n").filter((l) => /On a bug FR \(`kind: bug`|\*\*A bug FR\*\* \(`kind: bug`/.test(l));
      expect(passage.length).toBe(1);
      expect({ partial: passage[0]!.includes(verdict), missing: /missing/i.test(passage[0]!) }).toEqual({ partial: true, missing: false });
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

  // The model invokes a skill by its description: without the reported bug
  // there, the section is unreachable for a symptom or a ticket.
  test("the description names a reported bug", () => {
    const description = read(DEBUG).split("\n").find((l) => l.startsWith("description:")) ?? "";
    expect(description).toContain("or when a reported bug (a symptom, a ticket, a bug FR) needs its cause found and a test that proves the fix");
  });

  test("a bug FR is fixed through /implement, not in Phase 4 first", () => {
    expect(read(DEBUG)).toContain("The fix itself goes through `/implement <FR-id>`");
  });

  // /implement's Stage RED must see the code before the fix.
  test("a bug FR's investigation leaves no fix behind for /implement", () => {
    expect(read(DEBUG)).toContain("leave no fix behind: revert Phase 3's edits one by one");
  });

  test("reverting Phase 3 never resets the whole tree", () => {
    expect(read(DEBUG)).toContain("`git checkout -- <file>` only for a file that was clean before Phase 3, never the whole tree");
  });

  // A renamed path prints as R100, which the M/D/A recipe would skip.
  test("a fix made before its test is proved by rolling it back, renames split", () => {
    expect(read(DEBUG)).toContain(
      "for each non-test path in `git diff --name-status --no-renames <pre-fix> <fix>`, `M` or `D` → `git checkout <pre-fix> -- <path>`, `A` → `git rm -q <path>`",
    );
  });

  test("a squash-merged fix's pre-fix ref is its parent", () => {
    expect(read(DEBUG)).toContain("and `<fix>^` for a squash-merged one");
  });

  test("the rollback runs in a throwaway worktree", () => {
    expect(read(DEBUG)).toContain("Work in a throwaway worktree, `git worktree add --detach <dir> <fix>`");
  });

  test("the throwaway worktree is removed", () => {
    expect(read(DEBUG)).toContain("Then `git worktree remove --force <dir>`.");
  });

  // Untracked build output survives `git reset --hard` and can still hold
  // the code before the fix.
  test("the rollback regenerates after the fix comes back", () => {
    expect(read(DEBUG)).toContain("regenerate again, so no build output still holds the code before the fix, and run the test: GREEN");
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
      "an AC that guards behavior the bug leaves intact is no bug case, and neither is one for new behavior the fix adds, whose test follows the ordinary RED rule.",
    );
  });

  test("resolver-entry says an unproved bug case never halts the run", () => {
    expect(read(RESOLVER_ENTRY)).toContain(
      "A bug case the test-writer cannot prove is recorded `not proved` and counted at `/implement` step 14; it never halts the run.",
    );
  });

  test("the step-14 AC row carries each bug AC's proof line and the unproved count", () => {
    expect(read(IMPLEMENT)).toContain(
      "On a bug FR (`kind: bug`), the row also states how many ACs are unproved, and each AC row carries the `regression:` line the test-writer recorded for it in Stage RED's `notes`.",
    );
  });

  // One token separates the undo's proof from every other outcome, so a line
  // that also carries `→ red at` for plant 2 is never read as proved.
  test("step 14 says which lines count as unproved", () => {
    expect(read(IMPLEMENT)).toContain(
      "An AC is unproved when that line reads `not proved`, when it has no line, and, for the `Regression:` AC, when its defect-check line does not begin `defect check: fix undone in <file> → red at`; an `n/a` line is not unproved.",
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

  test("the defect-check pattern owes the bug RED to bug cases only", () => {
    expect(read(PATTERNS)).toContain(
      "Only a bug case, an AC the bug breaks, owes that RED: a test for new behavior the fix adds follows the ordinary rule.",
    );
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

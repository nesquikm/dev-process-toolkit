// STE-728 (M_d1b4b7) AC-STE-728.13 — mutation controls.
//
// Each named mutation of retro_proposal.ts turns at least one named test red.
// The map below names, per mutation, the test(s) that grade the property the
// mutation breaks; this file asserts every named test exists, by file and
// title, so a renamed or deleted test cannot silently leave a mutation
// ungraded. The own-line re-add (and its control) runs on a temp copy in
// m_d1b4b7-ste-728-retro-proposal.test.ts; the row-shape mutation runs on temp
// copies in m_d1b4b7-ste-728-propose.test.ts.
//
//   digest check removed            -> apply "one byte of the settings file changed after propose …"
//                                      approval "propose ran in worktree A; apply <worktree B> …"
//   transcript approval check removed -> approval "an approval in assistant prose only",
//                                      approval "an unset CLAUDE_CODE_SESSION_ID"
//   echo-printed propose accepted   -> approval "an echo-printed digest line in place of a real propose"
//   a false value admitted          -> propose "a false value (tracking.token_stats.enabled: false) throws …"
//   apply on a declined answer      -> approval "a Leave settings unchanged answer"
//   step-3 consumption check dropped -> approval "an earlier apply call's recorded tool_result …",
//                                      retro-proposal "the same child … plus a recorded apply result …"
//   retro-apply receipt write dropped -> apply "token_stats row, .dpt/.gitignore present: …" (one receipt),
//                                      approval "re-apply: …"
//   its read dropped                -> approval "re-apply: …",
//                                      retro-proposal "after a first child wrote, … refuses through the receipt"
//   recorded-call arm narrowed to runsRetroProposal
//                                   -> approval "the earlier call written as a cd <root> && … chain",
//                                      approval "the earlier call written in an echo-prefixed form"
//   receipt rolled back on a refused apply
//                                   -> apply "a tracked local settings file: …",
//                                      approval "an apply after an earlier one refused at the precondition check …"
//   realpath(projectRoot) left out of the digest
//                                   -> approval "propose ran in worktree A; apply <worktree B> …"
//   a question holding only the digest line accepted
//                                   -> approval "a question that holds only the digest line",
//                                      approval "the question missing a printed set line"
//   the running call's own line required again
//                                   -> retro-proposal "the copy re-adding the own-line step refuses the live fixture",
//                                      approval "positive control: one question holding every printed line …"
//   settings written before the precondition check
//                                   -> apply "retro-apply receipt write, then the check with settingOn: true, …",
//                                      apply "a tracked local settings file: …"
//   .claude/settings.local.json left out of the rollback
//                                   -> apply "a register that writes .claude/settings.local.json then refuses: …"

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const T = (f: string) => join(import.meta.dir, `m_d1b4b7-ste-728-${f}.test.ts`);

/** mutation -> [test file key, a literal fragment of a test title in it] */
const MAP: Record<string, [string, string][]> = {
  "digest check removed": [
    ["apply", "one byte of the settings file changed after propose"],
    ["approval", "propose ran in worktree A; apply <worktree B>"],
  ],
  "transcript approval check removed": [
    ["approval", "an approval in assistant prose only"],
    ["approval", "an unset CLAUDE_CODE_SESSION_ID"],
  ],
  "echo-printed propose accepted": [["approval", "an echo-printed digest line in place of a real propose"]],
  "a false value admitted": [["propose", "throws when the module loads"]],
  "apply on a declined answer": [["approval", "a Leave settings unchanged answer"]],
  "step-3 consumption check dropped": [
    ["approval", "an earlier apply call's recorded tool_result for the same digest"],
    ["retro-proposal", "plus a recorded apply result after the answer refuses"],
  ],
  "retro-apply receipt write dropped": [
    ["apply", "settings = prior + key, CLAUDE.md identical, only the receipt"],
    ["approval", "re-apply: a first apply writes and registers"],
  ],
  "receipt read dropped": [
    ["approval", "re-apply: a first apply writes and registers"],
    ["retro-proposal", "refuses through the receipt"],
  ],
  "recorded-call arm narrowed to runsRetroProposal": [
    ["approval", "the earlier call written as a cd <root> && bun run <abs>/retro_proposal.ts apply chain"],
    ["approval", "the earlier call written in an echo-prefixed form"],
  ],
  "receipt rolled back on a refused apply": [
    ["apply", "a tracked local settings file: refuses before any settings write"],
    ["approval", "an apply after an earlier one refused at the precondition check"],
  ],
  "realpath(projectRoot) left out of the digest": [["approval", "propose ran in worktree A; apply <worktree B>"]],
  "a question holding only the digest line accepted": [
    ["approval", "a question that holds only the digest line"],
    ["approval", "the question missing a printed set line"],
    ["approval", "the question with a printed because line reworded"],
    ["approval", "the question missing the printed add .gitignore: line"],
  ],
  "the running call's own line required again": [
    ["retro-proposal", "the copy re-adding the own-line step refuses the live fixture"],
    ["approval", "positive control: one question holding every printed line"],
  ],
  "settings written before the precondition check": [
    ["apply", "retro-apply receipt write, then the check with settingOn: true"],
    ["apply", "a tracked local settings file: refuses before any settings write"],
  ],
  ".claude/settings.local.json left out of the rollback": [
    ["apply", "a register that writes .claude/settings.local.json then refuses"],
  ],
};

describe("AC-STE-728.13 every named mutation has a named test that grades it", () => {
  test("the map names all fifteen mutations of the AC", () => {
    expect(Object.keys(MAP)).toHaveLength(15);
  });

  for (const [mutation, refs] of Object.entries(MAP)) {
    test(`${mutation}: every named test exists in its file`, () => {
      expect(refs.length).toBeGreaterThan(0);
      for (const [file, title] of refs) {
        const text = readFileSync(T(file), "utf-8");
        const titles = [...text.matchAll(/\btest\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)].map((m) => m[1]!);
        expect(titles.some((t) => t.includes(title))).toBe(true);
      }
    });
  }
});

describe("AC-STE-728.13 the temp-copy mutations have their injection points", () => {
  const src = () => readFileSync(join(import.meta.dir, "..", "adapters", "_shared", "src", "retro_proposal.ts"), "utf-8");

  test("retro_proposal.ts has an `if (import.meta.main)` front door at column 0 (the own-line re-add injects before it)", () => {
    expect(src()).toMatch(/^if \(import\.meta\.main\)/m);
  });

  test("retro_proposal.ts declares PROPOSABLE_SETTINGS as an exported array literal (the row-shape mutation registers into it)", () => {
    expect(src()).toMatch(/export const PROPOSABLE_SETTINGS\b[^=]*=\s*(?:Object\.freeze\(\s*)?\[/);
  });
});

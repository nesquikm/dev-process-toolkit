// STE-290 — Pre-commit gate-check enforcement (per-hook entrypoint).
// STE-597 — commit recognition in all three shapes.
//
// Refusing hook: blocks commit-bearing Bash calls when no
// `dev-process-toolkit:gate-check` Skill tool_use is present in the current
// session transcript. Other commands early-exit 0; unparseable stdin
// fails open.
//
// AC-STE-597.3 — the commit is recognised in the same three shapes the sibling
// /tdd hook recognises (bare, `cd <dir> && git commit`, `git -C <dir> commit`),
// closing the same bypass: the retired `/^git commit\b/` matcher saw no commit
// in the two careful shapes and waved them straight through.
//
// This hook deliberately gains NO staged-path classification and never uses the
// resolved `repoRoot`. Its one question — "was /gate-check run in this session?"
// — has no repository in it, so an UNRESOLVABLE target changes nothing here:
// `isCommit` is still true and the evidence is still required. Inventing a
// classification this hook does not perform today is out of scope.

import { emitNFR10, oneLine, parseHookPayload, requireSkillToolUse } from "../session.ts";
import { resolveCommitTargetFromPayload } from "../../../../adapters/_shared/src/commit_target_repo.ts";

/** An NFR-10 `Reminder:`, then exit 1: visible and non-blocking (the sibling /tdd hook's idiom). */
function remind(sentence: string, remedy: string): never {
  emitNFR10("Reminder", sentence, remedy, "dev-process-toolkit:gate-check", "pre-commit-gate-check");
  process.exit(1);
}

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
// The SAME front door the sibling /tdd hook uses, so "is this a commit?" cannot
// be answered one way here and another way there.
const target = resolveCommitTargetFromPayload(payload);
if (!target.isCommit) {
  // AC-STE-601.9 — `pull`, `rebase`, `stash` and the writing `notes` forms are
  // out of scope for this gate but never silent. Exit 1, not 0: the harness
  // shows no stderr on exit 0. Exit 1 is visible and lets the command proceed.
  if (target.advisory !== null) {
    remind(
      `${target.advisory}.`,
      "run /dev-process-toolkit:gate-check yourself if this changes what you are about to ship.",
    );
  }
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "dev-process-toolkit:gate-check",
  "pre-commit-gate-check",
  payload,
);
// AC-STE-601.11 — an unplaced commit (`GIT_DIR=<B>/.git git commit`) still
// needs the evidence, but the refusal names the checkouts it could write to, so
// the operator sees WHICH repository the refused commit was aimed at.
if (!found && target.repoRoot === null && target.candidateRoots.length > 0) {
  process.stderr.write(
    `Target: ${oneLine(target.unresolved ?? "unplaced")}; candidate checkouts: ${oneLine(target.candidateRoots.join(", "))}\n`,
  );
}
process.exit(found ? 0 : 2);

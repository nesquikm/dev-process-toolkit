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

import { parseHookPayload, requireSkillToolUse } from "../session.ts";
import { resolveCommitTargetFromPayload } from "../../../../adapters/_shared/src/commit_target_repo.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
// The SAME front door the sibling /tdd hook uses, so "is this a commit?" cannot
// be answered one way here and another way there.
if (!resolveCommitTargetFromPayload(payload).isCommit) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "dev-process-toolkit:gate-check",
  "pre-commit-gate-check",
  payload,
);
process.exit(found ? 0 : 2);

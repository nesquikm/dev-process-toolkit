// STE-290 — Pre-PR spec-review enforcement (per-hook entrypoint).
//
// Refusing hook: blocks `gh pr create*` Bash calls when no
// `dev-process-toolkit:spec-review` Skill tool_use is present in the current
// session transcript. Other commands early-exit 0; unparseable stdin
// fails open.
//
// STE-614 — this gate reads the transcript leg ALONE, deliberately, because it
// cannot yet say which repository a `gh pr create` raises a PR in. The house
// rule is the same two-legged one the commit gates read; STE-615 resolves the
// PR's target checkout and passes it here as
// `gateEvidenceTarget("dev-process-toolkit:spec-review", payload.session_id,
// { roots, unplaced, candidateRoots, sessionRoot })` — the same composer both
// commit gates call, so the third gate joins the one rule rather than growing
// a third reading of it.

import { harnessAbsent, parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
// STE-614 AC.2 — the ONE fail-open leg, asked BEFORE any other verdict: empty
// or unparseable stdin, or a `transcript_path` naming a file that is not there.
if (!payload || harnessAbsent(payload)) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^gh pr create\b/.test(cmd)) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "dev-process-toolkit:spec-review",
  "pre-pr-spec-review",
  payload,
);
process.exit(found ? 0 : 2);

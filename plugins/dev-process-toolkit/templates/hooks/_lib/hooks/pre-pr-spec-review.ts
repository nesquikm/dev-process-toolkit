// STE-290 — Pre-PR spec-review enforcement (per-hook entrypoint).
//
// Refusing hook: blocks `gh pr create*` Bash calls when no
// `dev-process-toolkit:spec-review` Skill tool_use is present in the current
// session transcript. Other commands early-exit 0; unparseable stdin
// fails open.

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
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

// STE-290 — Pre-commit gate-check enforcement (per-hook entrypoint).
//
// Refusing hook: blocks `git commit*` Bash calls when no
// `dev-process-toolkit:gate-check` Skill tool_use is present in the current
// session transcript. Other commands early-exit 0; unparseable stdin
// fails open.

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^git commit\b/.test(cmd)) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "dev-process-toolkit:gate-check",
  "pre-commit-gate-check",
  payload,
);
process.exit(found ? 0 : 1);

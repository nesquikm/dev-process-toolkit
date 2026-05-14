// STE-290 — Pre-commit /tdd orchestrator enforcement (per-hook entrypoint).
//
// Refusing hook: on `git commit*`, runs `git diff --cached --name-only` to
// find staged files. If any FR file (specs/frs/*.md) or test file
// (__tests__ in path, or .test.ts/.test.tsx/.spec.ts/.spec.tsx/.test.js/
// .spec.js suffix) is staged, requires a `dev-process-toolkit:tdd` Skill
// tool_use in the session transcript. Otherwise early-exits 0.

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

// Collect staged files via filesystem call (no $CLAUDE_STAGED_FILES env var).
const proc = Bun.spawn(["git", "diff", "--cached", "--name-only"], {
  stdout: "pipe",
  stderr: "ignore",
});
const stagedRaw = await new Response(proc.stdout).text();
await proc.exited;
const staged = stagedRaw.split("\n").filter((l) => l.length > 0);

const FR_RE = /^specs\/frs\/.*\.md$/;
const TEST_SUFFIX_RE = /\.(test|spec)\.(ts|tsx|js)$/;
const isFrRelated = (p: string): boolean =>
  FR_RE.test(p) || p.includes("__tests__") || TEST_SUFFIX_RE.test(p);

if (!staged.some(isFrRelated)) {
  process.exit(0);
}

const { found } = requireSkillToolUse(
  "dev-process-toolkit:tdd",
  "pre-commit-tdd-orchestrator",
  payload,
);
process.exit(found ? 0 : 1);

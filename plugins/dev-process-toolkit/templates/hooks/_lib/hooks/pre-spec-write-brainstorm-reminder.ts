// STE-290 — Pre-spec-write brainstorm reminder (per-hook entrypoint).
//
// Advisory hook (UserPromptSubmit): when a prompt invokes
// `/dev-process-toolkit:spec-write` with no resolved tracker ID arg AND no
// brainstorm Skill tool_use is in the session, emit a Reminder NFR-10 block
// to stderr. Always exits 0 (advisory, never blocks the prompt).

import { emitNFR10, findSkillToolUse, parseHookPayload } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const prompt = payload.prompt ?? "";
if (!prompt.includes("/dev-process-toolkit:spec-write")) {
  process.exit(0);
}
// Tracker-mode arg suppresses the reminder (greenfield-only heuristic).
if (/[A-Z][A-Z0-9]+-[0-9]+/.test(prompt)) {
  process.exit(0);
}
// Pure boolean check (no Refusing emit) — this is an advisory hook that
// emits its own Reminder NFR-10 block on miss.
const { found } = findSkillToolUse("dev-process-toolkit:brainstorm", payload);
if (found) {
  process.exit(0);
}
emitNFR10(
  "Reminder",
  "greenfield /dev-process-toolkit:spec-write invoked without prior /dev-process-toolkit:brainstorm.",
  "consider running /dev-process-toolkit:brainstorm first to clarify the design space.",
  "dev-process-toolkit:brainstorm",
  "pre-spec-write-brainstorm-reminder",
);
process.exit(0);

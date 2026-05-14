// Shared helper for Process-category enforcement hooks (STE-285 / STE-290).
//
// Reads the current Claude Code session log (JSONL stream at the hook
// payload's `transcript_path`) and looks for a `Skill` tool_use entry naming
// a specific skill. Fail-open when the payload is unparseable / missing
// `transcript_path` (hook invoked outside a Claude Code session, e.g. a bare
// `git commit`).
//
// Public API:
//   parseHookPayload(stdin) => HookPayload | null
//   findSkillToolUse(skill, payload) => { found: boolean }   (no stderr emit)
//   requireSkillToolUse(skill, hook, payload) => { found: boolean }
//   emitNFR10(verdict, why, how, skill, hook) => void

import { existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Hook payload shape (Claude Code 2.1.x stdin JSON contract)
// ---------------------------------------------------------------------------

export type HookPayload = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    description?: string;
    [k: string]: unknown;
  };
  tool_use_id?: string;
  prompt?: string;
};

// ---------------------------------------------------------------------------
// parseHookPayload — fail-open JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse a Claude Code hook stdin JSON payload. Returns `null` on:
 *   - empty / whitespace-only stdin
 *   - unparseable JSON
 *   - missing `transcript_path` field
 *
 * Fail-open by design: hooks invoked outside a Claude Code session (e.g. a
 * bare `git commit` from the terminal) get an empty stdin and must not
 * block the user.
 */
export function parseHookPayload(stdin: string): HookPayload | null {
  if (!stdin || stdin.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).transcript_path !== "string"
  ) {
    return null;
  }
  return parsed as HookPayload;
}

// ---------------------------------------------------------------------------
// emitNFR10 — byte-stable NFR-10 stderr block (STE-286 §104)
// ---------------------------------------------------------------------------

/**
 * Emit a 3-line NFR-10-shape block to stderr.
 *
 * Byte-stable substrings (per STE-286 §104):
 *   "<verdict>: <why>"
 *   "Remedy: <how>"
 *   "Context: mode=hook, ticket=unbound, skill=<skill>, hook=<hook>"
 */
export function emitNFR10(
  verdict: "Refusing" | "Reminder",
  why: string,
  how: string,
  skill: string,
  hook: string,
): void {
  const block =
    `${verdict}: ${why}\n` +
    `Remedy: ${how}\n` +
    `Context: mode=hook, ticket=unbound, skill=${skill}, hook=${hook}\n`;
  process.stderr.write(block);
}

// ---------------------------------------------------------------------------
// findSkillToolUse / requireSkillToolUse — atomic-line check (STE-285)
// ---------------------------------------------------------------------------

/**
 * Look for a Skill tool_use for `skill` in the transcript at
 * `payload.transcript_path`. The atomic-line invariant (STE-285) requires
 * `"name":"Skill"` AND `"skill":"<skill>"` to appear on the SAME JSONL
 * line — two separate matches across different lines must not satisfy
 * the check, since Claude Code writes each tool_use as a single JSONL line.
 *
 * Pure boolean check: returns `{ found: true }` on hit, `{ found: false }`
 * on miss. Fail-open (returns `{ found: true }`) when the transcript file
 * is missing or unreadable. Never writes to stderr — callers that need an
 * NFR-10 Refusing emit on miss should use `requireSkillToolUse` instead.
 */
export function findSkillToolUse(
  skill: string,
  payload: HookPayload,
): { found: boolean } {
  const transcript = payload.transcript_path;
  if (!transcript || !existsSync(transcript)) {
    // Fail-open: no transcript file ⇒ behave as if the hook fired outside
    // a Claude Code session.
    return { found: true };
  }

  let body: string;
  try {
    body = readFileSync(transcript, "utf-8");
  } catch {
    return { found: true };
  }

  const needleName = '"name":"Skill"';
  const needleSkill = `"skill":"${skill}"`;
  const lines = body.split("\n");
  const hit = lines.some(
    (line) => line.includes(needleName) && line.includes(needleSkill),
  );
  return { found: hit };
}

/**
 * Same atomic-line check as `findSkillToolUse`, but emits the byte-stable
 * NFR-10 `Refusing:` block to stderr on miss. Use this in Refusing hooks
 * (gate-check, spec-review, tdd-orchestrator) where a miss must produce
 * the canonical refusal template. Use `findSkillToolUse` in advisory hooks
 * (brainstorm-reminder) that emit their own `Reminder:` block instead.
 */
export function requireSkillToolUse(
  skill: string,
  hook: string,
  payload: HookPayload,
): { found: boolean } {
  const result = findSkillToolUse(skill, payload);
  if (result.found) {
    return result;
  }
  emitNFR10(
    "Refusing",
    `required ${skill} Skill tool_use not found in current session.`,
    `run /${skill} before retrying this action.`,
    skill,
    hook,
  );
  return result;
}

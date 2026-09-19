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
//   readTranscriptLines(payload) => string[] | null           (THE reader)
//   findSkillToolUse(skill, payload) => { found: boolean }   (no stderr emit)
//   requireSkillToolUse(skill, hook, payload) => { found: boolean }
//   findRedBeforeProof(payload, requiredPaths) => { found, uncovered }
//   requireTddEvidence(skill, hook, payload, requiredPaths) => { found: boolean }
//   emitNFR10(verdict, why, how, skill, hook) => void
//   RED_BEFORE_PROOF_MARKER                                  (operator contract)
//
// STE-598 — the /tdd requirement has TWO satisfying doors, not one. The
// orchestrator Skill tool_use is the first; a recorded red-before proof naming
// the staged test paths is the second, for audit-driven work that has no FR and
// therefore cannot run the per-FR orchestrator honestly. Both doors are read
// through the SAME transcript reader (`readTranscriptLines`) — no second
// discovery mechanism ships (AC-STE-598.3).

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
 * Collapse every run of control characters and Unicode line separators to one
 * space, then trim: the same rule as `oneLine` in `tracker_receipts.ts`, kept
 * here because this file stays free of relative imports (its suites load it
 * from a temp copy); a parity test pins the two together. A refusal quotes
 * words the model wrote, and the transcript records hook stderr verbatim, so an
 * embedded newline must never start a line of its own — a forged
 * `dpt-receipt:` among them (STE-601 review).
 */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").trim();
}


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
    `${verdict}: ${oneLine(why)}\n` +
    `Remedy: ${oneLine(how)}\n` +
    `Context: mode=hook, ticket=unbound, skill=${skill}, hook=${hook}\n`;
  process.stderr.write(block);
}

// ---------------------------------------------------------------------------
// readTranscriptLines — the ONE transcript reader (STE-598 AC.3)
// ---------------------------------------------------------------------------

/**
 * Read the session transcript at `payload.transcript_path` and return its JSONL
 * lines. Returns `null` when the transcript is missing or unreadable — callers
 * translate that into their own fail-open verdict.
 *
 * This is the only place in the guard family that touches the filesystem for a
 * transcript. Every evidence check (Skill tool_use, red-before proof) reads
 * through it, so a change to how sessions are discovered lands once.
 */
export function readTranscriptLines(payload: HookPayload): string[] | null {
  const transcript = payload.transcript_path;
  if (!transcript || !existsSync(transcript)) {
    return null;
  }
  try {
    return readFileSync(transcript, "utf-8").split("\n");
  } catch {
    return null;
  }
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
  const lines = readTranscriptLines(payload);
  if (lines === null) {
    // Fail-open: no transcript file ⇒ behave as if the hook fired outside
    // a Claude Code session.
    return { found: true };
  }

  const needleName = '"name":"Skill"';
  const needleSkill = `"skill":"${skill}"`;
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

// ---------------------------------------------------------------------------
// STE-598 — the second door: a recorded red-before proof.
// ---------------------------------------------------------------------------

/**
 * The canonical marker an operator types to record that the covered tests were
 * run against the PRE-CHANGE bytes and were red. Byte-stable on purpose: it is
 * a contract a human has to reproduce from the refusal text, so it must not
 * drift.
 */
export const RED_BEFORE_PROOF_MARKER = "dpt-red-before-proof:";

/**
 * Where a claim stops. A marker occurrence claims the path list it actually
 * names, not the rest of the JSONL line — a line carries far more than one
 * message, and the guard's own denial record carries its stderr TWICE, so an
 * unbounded slice from the first marker swallows the second copy's `Refusing:`
 * line and lets a refusal satisfy the door it just refused.
 *
 * A path list ends at the first of: an escaped newline (the message moved on to
 * another line of prose), or a double quote — escaped (`\"`, a quote inside the
 * message text) or bare (`"`, the close of the JSON string value carrying this
 * message). Failing both, at the end of the JSONL line.
 *
 * The BACKTICK is deliberately NOT a terminator (STE-598, second audit). It is
 * also what an operator writes AROUND a path, so
 * `<marker> ` + "`a.test.ts` `b.test.ts`" bounded at the first backtick claimed
 * an empty string and covered nothing: the honest operator was refused and the
 * remedy handed back the very form it had just rejected. Dropping it is safe
 * because within one copy of the refusal `emitNFR10` prints the paths BEFORE
 * the marker, so the escaped newline ending the `Remedy:` line still lands
 * between copy #1's marker and copy #2's paths — measured on the shipped bytes,
 * not assumed. The bare quote is the second, independent bound: it stops a claim
 * at the end of its own JSON string value even when no escaped newline follows
 * the marker, and it cannot truncate an honest proof because a path contains no
 * quote character.
 */
const CLAIM_TERMINATORS = ['\\"', '"', "\\n"];

/**
 * Every marker occurrence on `line`, each bounded to the text it claims.
 *
 * EVERY occurrence, not just the first and not just the last: two honest proofs
 * in one assistant message share a JSONL line, and each covers its own paths.
 */
function claimsOnLine(line: string): string[] {
  const claims: string[] = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(RED_BEFORE_PROOF_MARKER, from);
    if (at === -1) {
      return claims;
    }
    const start = at + RED_BEFORE_PROOF_MARKER.length;
    let end = line.length;
    for (const terminator of CLAIM_TERMINATORS) {
      const hit = line.indexOf(terminator, start);
      if (hit !== -1 && hit < end) {
        end = hit;
      }
    }
    claims.push(line.slice(start, end));
    from = start;
  }
}

/**
 * Look for a red-before proof covering EVERY path in `requiredPaths`.
 *
 * A path is covered iff some transcript line carries the marker and names that
 * path AFTER it. Two invariants are deliberate:
 *
 *   - ATOMIC LINE (STE-285, re-applied). The marker and the path must share one
 *     JSONL line. A marker on one line and a path on another is two unrelated
 *     claims, not one proof.
 *   - POSITION. Only text after the marker counts, so a path merely mentioned
 *     earlier in the same message is not silently swept into the claim.
 *   - BOUNDED CLAIM. Only text up to the end of that occurrence's path list
 *     counts (see `claimsOnLine`), so a path mentioned LATER on the same line
 *     in other business is not swept in either — the guard's own denial record
 *     carries its stderr twice and would otherwise satisfy the door it refused.
 *
 * Coverage is a UNION across marker lines, so a session that proved two files
 * red in two messages satisfies a commit staging both.
 *
 * An EMPTY `requiredPaths` returns `found: false`: a proof that covers nothing
 * proves nothing, and `[].every(...)` is `true` — the shape that has shipped as
 * a bug here before.
 *
 * Fail-open (`found: true`) when the transcript is missing or unreadable,
 * matching the existing door.
 */
export function findRedBeforeProof(
  payload: HookPayload,
  requiredPaths: string[],
): { found: boolean; uncovered: string[] } {
  const lines = readTranscriptLines(payload);
  if (lines === null) {
    return { found: true, uncovered: [] };
  }
  if (requiredPaths.length === 0) {
    return { found: false, uncovered: [] };
  }
  const covered = new Set<string>();
  for (const line of lines) {
    for (const claim of claimsOnLine(line)) {
      for (const path of requiredPaths) {
        if (claim.includes(path)) {
          covered.add(path);
        }
      }
    }
  }
  const uncovered = requiredPaths.filter((p) => !covered.has(p));
  return { found: uncovered.length === 0, uncovered };
}

/**
 * The /tdd requirement, satisfied by EITHER door (AC-STE-598.1):
 *
 *   1. a `dev-process-toolkit:tdd` Skill tool_use in this session, or
 *   2. a red-before proof covering every path that raised the requirement.
 *
 * With neither present the commit is refused exactly as before, and the
 * refusal NAMES BOTH doors (AC-STE-598.4) so the second one is learned rather
 * than rediscovered. Silent on success: a satisfied requirement must not print
 * a refusal it then ignores.
 */
export function requireTddEvidence(
  skill: string,
  hook: string,
  payload: HookPayload,
  requiredPaths: string[],
): { found: boolean } {
  // Door one first, and via the NON-emitting check: `requireSkillToolUse`
  // would write its own refusal before door two had been asked.
  if (findSkillToolUse(skill, payload).found) {
    return { found: true };
  }
  if (findRedBeforeProof(payload, requiredPaths).found) {
    return { found: true };
  }
  // The operator is told to name "every staged test path it covers" — so name
  // them here. `requiredPaths` is the set that raised the requirement, already
  // computed by the caller; withholding it makes the operator re-derive it.
  const one = requiredPaths.length === 1;
  const subject = requiredPaths.length === 0
    ? "the staged test paths"
    : `the staged test ${one ? "path" : "paths"} ${requiredPaths.join(", ")}`;
  const them = one ? "it" : "them";
  emitNFR10(
    "Refusing",
    `no TDD evidence for ${subject}: neither a ${skill} Skill ` +
      `tool_use nor a red-before proof covering ${them} was found in this session.`,
    `run /${skill}; or, for an audit-driven fix with no FR, run those ` +
      `tests against the pre-change bytes and record the red result in this ` +
      `session as a line reading \`${RED_BEFORE_PROOF_MARKER} <paths>\` ` +
      `naming every staged test path it covers.`,
    skill,
    hook,
  );
  return { found: false };
}

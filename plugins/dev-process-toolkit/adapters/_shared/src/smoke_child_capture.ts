// smoke_child_capture (STE-352 AC-STE-352.1 + AC-STE-352.2) —
// Readers for /smoke-test Phase 2's `claude -p --output-format stream-json`
// child captures (NDJSON at /tmp/dpt-smoke-<tracker>-<skill>.log).
//
// Two capture failure modes hid the M94 STE-350 bug behind green smoke runs:
//
// - F2 text-mode blind spot: default text mode emits only the child's final
//   result message, so mid-stream assistant tokens (per-probe capability
//   rows, forked `tdd-result` fences) never reached the log.
//   extractAssistantText lifts ALL assistant text blocks out of the NDJSON
//   capture, in stream order, joined so each block starts on its own line —
//   fences stay line-anchored and greppable.
// - 0-byte grandchild: a child whose nested `claude -p` spawn was denied by
//   the permission classifier can still exit green with an empty capture.
//   checkChildSpawnCapture is the direct detector — an empty capture, or a
//   `permission_denials[]` entry whose tool_input.command head is `claude`,
//   is one high-severity finding with the canonical STE-350 diagnostic.
//
// Malformed / non-assistant lines are silently skipped (same posture as
// parseStreamJsonTranscript in socratic_first_turn_stream.ts) so a partial
// or truncated capture still yields a usable prefix. Both modules share the
// low-level NDJSON reader in stream_json_events.ts.

import {
  assistantContentBlocks,
  parseStreamJsonEvents,
} from "./stream_json_events";

export interface ChildSpawnFinding {
  severity: "high";
  diagnostic: string;
}

const DIAGNOSTIC_PREFIX =
  "STE-350 regression: nested claude -p spawn denied/empty — ";

// Head-anchored `claude` spawn match: the denied command must START with the
// bare word `claude` — a command merely mentioning `claude -p` mid-string
// (e.g., a grep over a SKILL.md body) is NOT a nested-spawn denial.
const CLAUDE_SPAWN_HEAD_RE = /^claude(\s|$)/;

/**
 * Project every assistant event's text blocks out of a stream-json NDJSON
 * capture, in stream order. Blocks are joined so each starts on its own
 * line (```tdd-result fences stay line-anchored / greppable). tool_use
 * inputs, tool_results, and non-assistant events contribute no text.
 */
export function extractAssistantText(ndjson: string): string {
  const blocks: string[] = [];
  for (const event of parseStreamJsonEvents(ndjson)) {
    for (const block of assistantContentBlocks(event)) {
      if (block.type === "text" && typeof block.text === "string") {
        blocks.push(block.text);
      }
    }
  }
  return blocks.join("\n");
}

function finding(child: string): ChildSpawnFinding {
  return { severity: "high", diagnostic: `${DIAGNOSTIC_PREFIX}${child}` };
}

/**
 * Assert a child's capture is non-empty and non-denied.
 *
 * Returns [] on a healthy capture, or exactly one high-severity finding
 * when the capture is empty (the 0-byte-grandchild symptom) or a `result`
 * event carries a permission_denials entry whose tool_input.command head is
 * `claude` (a denied nested spawn).
 */
export function checkChildSpawnCapture(
  ndjson: string,
  child: string,
): ChildSpawnFinding[] {
  if (ndjson.trim().length === 0) return [finding(child)];

  for (const event of parseStreamJsonEvents(ndjson)) {
    if (event.type !== "result") continue;
    const denials = event.permission_denials;
    if (!Array.isArray(denials)) continue;
    for (const denial of denials) {
      if (!denial || typeof denial !== "object") continue;
      const toolInput = (denial as Record<string, unknown>).tool_input;
      if (!toolInput || typeof toolInput !== "object") continue;
      const command = (toolInput as Record<string, unknown>).command;
      if (
        typeof command === "string" &&
        CLAUDE_SPAWN_HEAD_RE.test(command.trimStart())
      ) {
        return [finding(child)];
      }
    }
  }
  return [];
}

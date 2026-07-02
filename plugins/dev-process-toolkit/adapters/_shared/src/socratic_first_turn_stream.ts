// socratic_first_turn_stream (STE-237 AC-STE-237.4 driver wrapper) —
// Parses `claude -p --output-format stream-json` NDJSON output into the
// TranscriptEntry[] shape consumed by assertFirstTurnShape.
//
// /smoke-test Phase 8 spawns each in-scope skill as a stream-json child,
// captures stdout to an NDJSON log, and feeds the log through
// parseStreamJsonTranscript -> assertFirstTurnShape. The first arbiter is
// still assertFirstTurnShape itself; this helper is the I/O adapter that
// lifts NDJSON into its input shape.
//
// Stream-json line shapes (per claude -p --output-format stream-json):
// - {"type":"system","subtype":"init",...}      session init; ignored
// - {"type":"assistant","message":{"content":[…],"stop_reason":…}}  the
//   first-turn signal source; we project content blocks in order
// - {"type":"user",…}                            tool_results; ignored
// - {"type":"result",…}                          final summary; ignored
// - {"type":"system","subtype":"refusal",…}      defensive: project as a
//                                                refusal entry
//
// Malformed / unrecognized lines are silently skipped so a partial /
// truncated capture still yields a usable prefix transcript. Callers that
// need stricter validation should diff this helper's output against the
// raw NDJSON line count. The low-level NDJSON reader is shared with
// smoke_child_capture via stream_json_events.ts.

import type { TranscriptEntry } from "./socratic_first_turn";
import {
  assistantContentBlocks,
  parseStreamJsonEvent,
} from "./stream_json_events";

/**
 * Parse one NDJSON line into zero or more transcript entries.
 * Empty / malformed / non-assistant lines yield an empty array.
 */
export function parseStreamJsonLine(line: string): TranscriptEntry[] {
  const event = parseStreamJsonEvent(line);
  if (!event) return [];

  if (event.type === "system" && event.subtype === "refusal") {
    return [{ type: "refusal" }];
  }

  if (event.type !== "assistant") return [];

  const message = event.message;
  if (!message || typeof message !== "object") return [];

  const entries: TranscriptEntry[] = [];
  for (const block of assistantContentBlocks(event)) {
    if (block.type === "text") {
      entries.push({ type: "text" });
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      entries.push({ type: "tool_use", name: block.name });
    }
  }

  if ((message as Record<string, unknown>).stop_reason === "refusal") {
    entries.push({ type: "refusal" });
  }

  return entries;
}

/**
 * Parse a full NDJSON capture into a TranscriptEntry[].
 * Concatenates the per-line projections in stream order.
 */
export function parseStreamJsonTranscript(ndjson: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const line of ndjson.split("\n")) {
    out.push(...parseStreamJsonLine(line));
  }
  return out;
}

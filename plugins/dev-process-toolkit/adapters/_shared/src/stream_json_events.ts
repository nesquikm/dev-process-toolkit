// stream_json_events — low-level reader for `claude -p --output-format
// stream-json` NDJSON captures. Shared by socratic_first_turn_stream
// (first-turn shape projection) and smoke_child_capture (child-capture
// assertions), which project different views of the same event stream.
//
// Posture: malformed / empty / non-object lines are silently skipped so a
// partial or truncated capture still yields a usable prefix. Callers that
// need stricter validation should diff their projection against the raw
// NDJSON line count.

export type StreamJsonEvent = Record<string, unknown>;

/** Parse one NDJSON line; null for empty / malformed / non-object lines. */
export function parseStreamJsonEvent(line: string): StreamJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as StreamJsonEvent;
}

/** Parse a full NDJSON capture into events, skipping malformed lines. */
export function parseStreamJsonEvents(ndjson: string): StreamJsonEvent[] {
  const events: StreamJsonEvent[] = [];
  for (const line of ndjson.split("\n")) {
    const event = parseStreamJsonEvent(line);
    if (event) events.push(event);
  }
  return events;
}

/**
 * The content blocks of an assistant event's message, in stream order.
 * Returns [] for non-assistant events and malformed / block-less messages.
 */
export function assistantContentBlocks(
  event: StreamJsonEvent,
): StreamJsonEvent[] {
  if (event.type !== "assistant") return [];
  const message = event.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as StreamJsonEvent).content;
  if (!Array.isArray(content)) return [];
  const blocks: StreamJsonEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    blocks.push(block as StreamJsonEvent);
  }
  return blocks;
}

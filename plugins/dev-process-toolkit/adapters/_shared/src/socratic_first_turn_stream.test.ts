// STE-237 AC-STE-237.4 driver wrapper — parseStreamJsonTranscript covers
// the common stream-json line shapes claude -p emits and the end-to-end
// composition with assertFirstTurnShape that /smoke-test Phase 8 invokes.

import { describe, expect, test } from "bun:test";
import {
  parseStreamJsonLine,
  parseStreamJsonTranscript,
} from "./socratic_first_turn_stream";
import {
  assertFirstTurnShape,
  SocraticFirstTurnViolationError,
} from "./socratic_first_turn";

describe("parseStreamJsonLine", () => {
  test("system init lines yield no entries", () => {
    const line = JSON.stringify({ type: "system", subtype: "init" });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  test("assistant message with single text block", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "text" }]);
  });

  test("assistant message with single tool_use block", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: "tool_use", name: "AskUserQuestion" },
    ]);
  });

  test("assistant message with mixed content blocks preserves order", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll check the codebase first." },
          { type: "tool_use", name: "Read", input: { file_path: "/x" } },
          { type: "text", text: "Now asking." },
          { type: "tool_use", name: "AskUserQuestion", input: {} },
        ],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: "text" },
      { type: "tool_use", name: "Read" },
      { type: "text" },
      { type: "tool_use", name: "AskUserQuestion" },
    ]);
  });

  test("user / tool_result lines ignored", () => {
    const line = JSON.stringify({ type: "user", message: { content: [] } });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  test("result summary line ignored", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 12345,
    });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  test("system refusal subtype projects to refusal entry", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "refusal",
      reason: "RequiresInputRefusedError",
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: "refusal" }]);
  });

  test("assistant message with stop_reason refusal appends refusal entry", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Cannot proceed without input." }],
        stop_reason: "refusal",
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: "text" },
      { type: "refusal" },
    ]);
  });

  test("tool_use block missing name skipped", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", input: {} }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  test("malformed JSON yields empty", () => {
    expect(parseStreamJsonLine("not json")).toEqual([]);
    expect(parseStreamJsonLine("{")).toEqual([]);
  });

  test("empty / whitespace-only line yields empty", () => {
    expect(parseStreamJsonLine("")).toEqual([]);
    expect(parseStreamJsonLine("   ")).toEqual([]);
    expect(parseStreamJsonLine("\t")).toEqual([]);
  });

  test("non-object JSON literal yields empty", () => {
    expect(parseStreamJsonLine("42")).toEqual([]);
    expect(parseStreamJsonLine("null")).toEqual([]);
    expect(parseStreamJsonLine('"string"')).toEqual([]);
  });
});

describe("parseStreamJsonTranscript", () => {
  test("multi-line NDJSON concatenates per-line projections in stream order", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "thinking" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n");
    expect(parseStreamJsonTranscript(ndjson)).toEqual([
      { type: "text" },
      { type: "tool_use", name: "AskUserQuestion" },
    ]);
  });

  test("interleaved malformed lines silently skipped", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      "garbage line",
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
        },
      }),
      "",
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n");
    expect(parseStreamJsonTranscript(ndjson)).toEqual([
      { type: "tool_use", name: "AskUserQuestion" },
    ]);
  });

  test("trailing newline is tolerated", () => {
    const ndjson =
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }],
        },
      }) + "\n";
    expect(parseStreamJsonTranscript(ndjson)).toEqual([
      { type: "tool_use", name: "AskUserQuestion" },
    ]);
  });

  test("empty input yields empty transcript", () => {
    expect(parseStreamJsonTranscript("")).toEqual([]);
  });
});

describe("end-to-end: parseStreamJsonTranscript -> assertFirstTurnShape", () => {
  test("ask-first stream-json is ok-asked", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Need to clarify a few things." },
            { type: "tool_use", name: "AskUserQuestion", input: {} },
          ],
        },
      }),
    ].join("\n");
    const transcript = parseStreamJsonTranscript(ndjson);
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(1);
  });

  test("Write-before-ask stream-json triggers SocraticFirstTurnViolationError", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { file_path: "/x" } },
            { type: "tool_use", name: "AskUserQuestion", input: {} },
          ],
        },
      }),
    ].join("\n");
    const transcript = parseStreamJsonTranscript(ndjson);
    expect(() => assertFirstTurnShape(transcript)).toThrow(
      SocraticFirstTurnViolationError,
    );
  });

  test("refusal-first stream-json (system subtype) is ok-refused", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "system", subtype: "refusal" }),
    ].join("\n");
    const transcript = parseStreamJsonTranscript(ndjson);
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-refused");
    expect(result.askIndex).toBe(0);
  });

  test("read-only-then-ask stream-json is ok-asked (Read allowed pre-ask)", () => {
    const ndjson = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/x" } },
            { type: "tool_use", name: "Grep", input: { pattern: "y" } },
            { type: "tool_use", name: "AskUserQuestion", input: {} },
          ],
        },
      }),
    ].join("\n");
    const transcript = parseStreamJsonTranscript(ndjson);
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(2);
  });
});

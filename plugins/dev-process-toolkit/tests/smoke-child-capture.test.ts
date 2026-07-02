import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-352 — stream-json child capture + non-empty/non-denied assertion
// (the direct detector for the M94 0-byte-grandchild false-green).
//
// AC-STE-352.1: /smoke-test switches canonical-chain child capture to
//   `--output-format stream-json`. The final text-mode message alone hid
//   nested tokens (smoke F2), so a helper must lift ALL assistant text out
//   of the NDJSON capture — per-probe capability rows and forked
//   `tdd-result` fences included — not just the final result message.
//
// AC-STE-352.2: after each child returns, the driver asserts the capture is
//   non-empty AND carries no `permission_denials[]` entry for a nested
//   `claude` spawn. Either condition is a high-severity finding with the
//   canonical diagnostic:
//     STE-350 regression: nested claude -p spawn denied/empty — <child>
//
// Contract pinned here (implemented by adapters/_shared/src/smoke_child_capture.ts):
//   extractAssistantText(ndjson: string): string
//     - projects every assistant event's text blocks, in stream order,
//       joined so each block starts on its own line (fences stay greppable)
//     - skips malformed lines / non-assistant events / tool_use inputs
//   checkChildSpawnCapture(ndjson: string, child: string): ChildSpawnFinding[]
//     - [] on a healthy capture
//     - one { severity: "high", diagnostic } finding when the capture is
//       0 bytes OR when a permission_denials entry's tool_input.command
//       head is `claude` (head-anchored — a command merely mentioning
//       `claude -p` mid-string is NOT an STE-350 finding)

import {
  checkChildSpawnCapture,
  extractAssistantText,
} from "../adapters/_shared/src/smoke_child_capture";

const fixtureDir = join(import.meta.dir, "fixtures", "smoke-child-capture");

const healthy = readFileSync(join(fixtureDir, "healthy-child.ndjson"), "utf8");
const denied = readFileSync(
  join(fixtureDir, "denied-nested-spawn.ndjson"),
  "utf8",
);
const empty = readFileSync(join(fixtureDir, "empty.ndjson"), "utf8");

const DIAG_PREFIX = "STE-350 regression: nested claude -p spawn denied/empty — ";

function resultEvent(denials: unknown[]): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    permission_denials: denials,
  });
}

const assistantText = (text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }], stop_reason: null },
  });

describe("AC-STE-352.1 — extractAssistantText closes the F2 text-mode blind spot", () => {
  test("mid-stream capability rows are present even though the final result message lacks them", () => {
    const text = extractAssistantText(healthy);
    expect(text).toContain("spec_write_draft_default_applied");
    expect(text).toContain("spec_write_commit_default_applied");

    // Fixture self-check: the final `result` message alone (all text mode
    // captured) does NOT carry the rows — that's the blind spot being closed.
    const lines = healthy.trim().split("\n");
    const final = JSON.parse(lines[lines.length - 1]) as { result: string };
    expect(final.result).not.toContain("spec_write_draft_default_applied");
  });

  test("forked tdd-result fences are parseable at line start", () => {
    const text = extractAssistantText(healthy);
    expect(text).toMatch(/(^|\n)```tdd-result\n/);
    expect(text).toContain("role: test-writer");
  });

  test("assistant text is projected in stream order", () => {
    const text = extractAssistantText(healthy);
    const first = text.indexOf("Drafting the FR now.");
    const rows = text.indexOf("spec_write_draft_default_applied");
    const fence = text.indexOf("```tdd-result");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(rows).toBeGreaterThan(first);
    expect(fence).toBeGreaterThan(rows);
  });

  test("tool_use inputs contribute no text", () => {
    // The Write tool_use in the fixture carries specs/frs/STE-999.md as its
    // input; tool inputs are not assistant prose and must not leak in.
    expect(extractAssistantText(healthy)).not.toContain("STE-999.md");
  });

  test("malformed and non-assistant lines are skipped, not fatal", () => {
    const ndjson = [
      "this is not json {",
      JSON.stringify({ type: "system", subtype: "init" }),
      assistantText("still standing"),
      "",
    ].join("\n");
    expect(extractAssistantText(ndjson)).toContain("still standing");
  });
});

describe("AC-STE-352.2 — checkChildSpawnCapture: non-empty / non-denied assertion", () => {
  test("a 0-byte capture is a high-severity finding, not a silent pass", () => {
    const findings = checkChildSpawnCapture(empty, "implement");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
  });

  test("empty-string capture equals the 0-byte case", () => {
    const findings = checkChildSpawnCapture("", "gate-check");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}gate-check`);
  });

  test("a permission_denials entry for a nested claude spawn is a high-severity finding", () => {
    const findings = checkChildSpawnCapture(denied, "gate-check");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}gate-check`);
  });

  test("a healthy capture (output present, denials empty) yields no findings", () => {
    expect(checkChildSpawnCapture(healthy, "spec-write")).toEqual([]);
  });

  test("a denial of a non-claude command is NOT an STE-350 finding", () => {
    const ndjson = [
      assistantText("ran something"),
      resultEvent([
        {
          tool_name: "Bash",
          tool_use_id: "toolu_03",
          tool_input: { command: "bun test tests/greet.test.ts" },
        },
      ]),
      "",
    ].join("\n");
    expect(checkChildSpawnCapture(ndjson, "implement")).toEqual([]);
  });

  test("claude-spawn matching is head-anchored — mid-string mention does not fire", () => {
    const ndjson = [
      assistantText("grepping the skill body"),
      resultEvent([
        {
          tool_name: "Bash",
          tool_use_id: "toolu_04",
          tool_input: {
            command: "grep -rn 'claude -p' .claude/skills/smoke-test/SKILL.md",
          },
        },
      ]),
      "",
    ].join("\n");
    expect(checkChildSpawnCapture(ndjson, "implement")).toEqual([]);
  });

  test("multiple denials with one claude spawn yield exactly one STE-350 finding", () => {
    const ndjson = [
      assistantText("partial run"),
      resultEvent([
        {
          tool_name: "Bash",
          tool_use_id: "toolu_05",
          tool_input: { command: "bun test tests/greet.test.ts" },
        },
        {
          tool_name: "Bash",
          tool_use_id: "toolu_06",
          tool_input: { command: "claude -p /dev-process-toolkit:spec-review" },
        },
      ]),
      "",
    ].join("\n");
    const findings = checkChildSpawnCapture(ndjson, "spec-review");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}spec-review`);
  });
});

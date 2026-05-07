// STE-237 AC-STE-237.5 — six-case matrix for assertFirstTurnShape.
//
// 1. ask-first             ⇒ ok-asked
// 2. refuse-first          ⇒ ok-refused
// 3. Write-before-ask      ⇒ violation (NFR-10 message)
// 4. Edit-before-ask       ⇒ violation
// 5. read-only-then-ask    ⇒ ok-asked (Read / Grep allowed pre-ask)
// 6. text-then-ask         ⇒ ok-asked (text entries allowed pre-ask)

import { describe, expect, test } from "bun:test";
import {
  assertFirstTurnShape,
  SocraticFirstTurnViolationError,
  type TranscriptEntry,
} from "./socratic_first_turn";

describe("AC-STE-237.5 — assertFirstTurnShape six-case matrix", () => {
  test("case 1: ask-first ⇒ ok-asked", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(0);
    expect(result.firstScaffoldEntry).toBeUndefined();
  });

  test("case 2: refuse-first (refusal entry) ⇒ ok-refused", () => {
    const transcript: TranscriptEntry[] = [
      { type: "refusal" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-refused");
    expect(result.askIndex).toBe(0);
  });

  test("case 2b: refuse-first (RequiresInputRefusedError tool_use marker) ⇒ ok-refused", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "RequiresInputRefusedError" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-refused");
    expect(result.askIndex).toBe(0);
  });

  test("case 3: Write-before-ask ⇒ violation (NFR-10 message)", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write" },
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    expect(() => assertFirstTurnShape(transcript)).toThrow(
      SocraticFirstTurnViolationError,
    );
    try {
      assertFirstTurnShape(transcript);
    } catch (err) {
      const e = err as SocraticFirstTurnViolationError;
      expect(e.toolName).toBe("Write");
      expect(e.index).toBe(0);
      expect(e.message).toContain("Verdict:");
      expect(e.message).toContain("Remedy:");
      expect(e.message).toContain("Context:");
      expect(e.message).toContain("Write");
      expect(e.message).toContain("docs/auto-mode-protocol.md");
    }
  });

  test("case 4: Edit-before-ask ⇒ violation", () => {
    const transcript: TranscriptEntry[] = [
      { type: "text" },
      { type: "tool_use", name: "Edit" },
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    expect(() => assertFirstTurnShape(transcript)).toThrow(
      SocraticFirstTurnViolationError,
    );
    try {
      assertFirstTurnShape(transcript);
    } catch (err) {
      const e = err as SocraticFirstTurnViolationError;
      expect(e.toolName).toBe("Edit");
      expect(e.index).toBe(1);
    }
  });

  test("case 4b: NotebookEdit-before-ask ⇒ violation (third scaffold tool)", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "NotebookEdit" },
    ];
    expect(() => assertFirstTurnShape(transcript)).toThrow(
      SocraticFirstTurnViolationError,
    );
  });

  test("case 5: read-only-then-ask ⇒ ok-asked (Read / Grep / Glob / Bash allowed)", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Read" },
      { type: "tool_use", name: "Grep" },
      { type: "tool_use", name: "Glob" },
      { type: "tool_use", name: "Bash" },
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(4);
  });

  test("case 6: text-then-ask ⇒ ok-asked", () => {
    const transcript: TranscriptEntry[] = [
      { type: "text" },
      { type: "text" },
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(2);
  });

  test("vacuous: empty transcript ⇒ ok-asked with no askIndex", () => {
    const result = assertFirstTurnShape([]);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBeUndefined();
  });

  test("vacuous: read-only-only transcript (no ask, no scaffold) ⇒ ok-asked, no askIndex", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Read" },
      { type: "text" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBeUndefined();
  });
});

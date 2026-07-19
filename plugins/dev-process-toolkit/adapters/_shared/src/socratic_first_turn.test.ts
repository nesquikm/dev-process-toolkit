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

  test("AC-STE-399.1: empty transcript ⇒ vacuous (not ok-asked)", () => {
    const result = assertFirstTurnShape([]);
    expect(result.outcome).toBe("vacuous");
    expect(result.askIndex).toBeUndefined();
  });

  test("AC-STE-399.1: read-only-only transcript (no ask, no scaffold) ⇒ vacuous", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Read" },
      { type: "text" },
    ];
    const result = assertFirstTurnShape(transcript);
    expect(result.outcome).toBe("vacuous");
    expect(result.askIndex).toBeUndefined();
  });
});

describe("STE-399 — projectRoot-scoped scaffolding detection", () => {
  const ROOT = "/Users/ns/workspace/dpt-test-project-linear";

  test("AC-STE-399.3: scaffold write inside projectRoot ⇒ violation", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write", path: `${ROOT}/specs/frs/STE-1.md` },
    ];
    expect(() =>
      assertFirstTurnShape(transcript, { projectRoot: ROOT }),
    ).toThrow(SocraticFirstTurnViolationError);
  });

  test("AC-STE-399.4: scaffold write OUTSIDE projectRoot ⇒ no violation (vacuous)", () => {
    const transcript: TranscriptEntry[] = [
      {
        type: "tool_use",
        name: "Write",
        path: "/Users/ns/english/mistakes/inbox/2026-07-20-x.md",
      },
    ];
    const result = assertFirstTurnShape(transcript, { projectRoot: ROOT });
    expect(result.outcome).toBe("vacuous");
  });

  test("AC-STE-399.4: outside-root scaffold then a real ask ⇒ ok-asked", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write", path: "/tmp/scratch/report.md" },
      { type: "tool_use", name: "AskUserQuestion" },
    ];
    const result = assertFirstTurnShape(transcript, { projectRoot: ROOT });
    expect(result.outcome).toBe("ok-asked");
    expect(result.askIndex).toBe(1);
  });

  test("AC-STE-399.4: sibling-dir path is NOT treated as inside (boundary-safe)", () => {
    const transcript: TranscriptEntry[] = [
      {
        type: "tool_use",
        name: "Write",
        path: `${ROOT}-sibling/leak.md`,
      },
    ];
    const result = assertFirstTurnShape(transcript, { projectRoot: ROOT });
    expect(result.outcome).toBe("vacuous");
  });

  test("AC-STE-399.6: scaffold with no path under projectRoot ⇒ conservative violation", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write" },
    ];
    expect(() =>
      assertFirstTurnShape(transcript, { projectRoot: ROOT }),
    ).toThrow(SocraticFirstTurnViolationError);
  });

  test("AC-STE-399.6: projectRoot omitted ⇒ unchanged by-name violation regardless of path", () => {
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write", path: "/anywhere/at/all.md" },
    ];
    expect(() => assertFirstTurnShape(transcript)).toThrow(
      SocraticFirstTurnViolationError,
    );
  });
});

// STE-399 AC-STE-399.2 — verdictFor maps a first-turn outcome to the
// CLI's single-line verdict + exit code. Unit-tests the pure mapping the
// `if (import.meta.main)` CLI wrapper delegates to (no subprocess spawn).

import { describe, expect, test } from "bun:test";
import { verdictFor } from "./socratic_first_turn_assert";
import type { TranscriptEntry } from "./socratic_first_turn";

describe("STE-399 — verdictFor exit-code + verdict mapping", () => {
  test("ok-asked ⇒ exit 0", () => {
    const t: TranscriptEntry[] = [{ type: "tool_use", name: "AskUserQuestion" }];
    const v = verdictFor("spec-write", t);
    expect(v.exitCode).toBe(0);
    expect(v.line).toBe("spec-write: ok-asked askIndex=0");
  });

  test("ok-refused ⇒ exit 0", () => {
    const t: TranscriptEntry[] = [{ type: "refusal" }];
    const v = verdictFor("setup", t);
    expect(v.exitCode).toBe(0);
    expect(v.line).toContain("ok-refused");
  });

  test("AC-STE-399.2: vacuous ⇒ non-zero, distinct verdict line", () => {
    const t: TranscriptEntry[] = [{ type: "tool_use", name: "Read" }];
    const v = verdictFor("setup", t);
    expect(v.exitCode).not.toBe(0);
    expect(v.exitCode).not.toBe(1); // distinct from violation
    expect(v.line).toContain("vacuous");
  });

  test("violation ⇒ exit 1", () => {
    const t: TranscriptEntry[] = [{ type: "tool_use", name: "Write" }];
    const v = verdictFor("brainstorm", t);
    expect(v.exitCode).toBe(1);
    expect(v.line).toContain("violation");
    expect(v.line).toContain("tool=Write");
  });

  test("AC-STE-399.6: verdictFor forwards projectRoot (outside-root scaffold ⇒ vacuous, not violation)", () => {
    const t: TranscriptEntry[] = [
      { type: "tool_use", name: "Write", path: "/tmp/scratch/x.md" },
    ];
    const v = verdictFor("report-issue", t, { projectRoot: "/proj" });
    expect(v.exitCode).not.toBe(1);
    expect(v.line).toContain("vacuous");
  });
});

// STE-251 AC-STE-251.4 — replay test for the F1 reproducer.
//
// Re-feeds the committed v4 violation transcript at
// `tests/fixtures/socratic-first-turn/regression/spec-write-2026-05-07.json`
// through `parseStreamJsonTranscript` + `assertFirstTurnShape` and asserts
// the helper still detects it as a Socratic-first-turn violation with
// `toolName === "Write"` and `index === 23`.
//
// The fixture lives under `regression/` (not the per-date sibling path) so
// future `/smoke-test` Phase 8 runs that overwrite the per-date file
// don't clobber this regression input — that's the load-bearing path
// guarantee for forward-compat of the helper's contract.
//
// The fixture was originally committed in `79be499` (Phase 8 baseline
// cohort + F1 spec-write reproducer) and pinned here on the M67 commit.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFirstTurnShape,
  SocraticFirstTurnViolationError,
} from "./socratic_first_turn";
import { parseStreamJsonTranscript } from "./socratic_first_turn_stream";

const REGRESSION_FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "socratic-first-turn",
  "regression",
  "spec-write-2026-05-07.json",
);

describe("AC-STE-251.4 — F1 reproducer replay (regression fixture)", () => {
  test("the v4 spec-write transcript still surfaces a Write@23 violation", () => {
    const ndjson = readFileSync(REGRESSION_FIXTURE, "utf-8");
    const transcript = parseStreamJsonTranscript(ndjson);

    let captured: SocraticFirstTurnViolationError | null = null;
    try {
      assertFirstTurnShape(transcript);
    } catch (e) {
      if (e instanceof SocraticFirstTurnViolationError) {
        captured = e;
      } else {
        throw e;
      }
    }
    expect(captured).not.toBeNull();
    expect(captured!.toolName).toBe("Write");
    expect(captured!.index).toBe(23);
    // Forward-compat: the canonical NFR-10 message references the
    // protocol doc + names the offending tool/index.
    expect(captured!.message).toContain("Socratic first-turn contract violation");
    expect(captured!.message).toContain("Write");
    expect(captured!.message).toContain("docs/auto-mode-protocol.md");
  });

  test("the regression fixture's transcript projects to a non-empty TranscriptEntry[]", () => {
    // Sanity guard against per-date overwrite drift — if the fixture path
    // is silently emptied by a future tooling change, this test will fail
    // loudly rather than surface as a passing replay against an empty
    // transcript (which would never throw the violation error).
    const ndjson = readFileSync(REGRESSION_FIXTURE, "utf-8");
    const transcript = parseStreamJsonTranscript(ndjson);
    expect(transcript.length).toBeGreaterThan(23);
  });
});

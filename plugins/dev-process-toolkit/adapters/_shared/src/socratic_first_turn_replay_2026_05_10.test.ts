// STE-270 AC-STE-270.1 — replay test for the iter-1 (2026-05-10) reproducer.
//
// Re-feeds the committed v4 violation transcript at
// `tests/fixtures/socratic-first-turn/regression/spec-write-2026-05-10.json`
// through `parseStreamJsonTranscript` + `assertFirstTurnShape` and asserts
// the helper still detects it as a Socratic-first-turn violation.
//
// STE-404: the fixture's TRUE first violation is a tracker create
// (`mcp__linear__save_issue @ 16`, the magpie ticket-create) that precedes
// the Write @ 19. Before STE-404 the arbiter's forbidden set omitted
// tracker-create tools, so it surfaced the later Write; now it correctly
// surfaces the earlier `mcp__linear__save_issue @ 16`. The transcript still
// throws a violation (the regression baseline's intent) — the catch moved to
// the earlier, more-faithful offending action.
//
// Sibling to STE-251's `socratic_first_turn_replay.test.ts` (Write@23 from
// the 2026-05-07 fixture). Two regression baselines from different
// /conformance-loop runs preserve forward-compat across future SKILL.md
// edits — if either replay starts passing-without-violation post-edit,
// the helper has drifted and the failure is loud.
//
// The fixture lives under `regression/` (not the per-date sibling path) so
// future `/smoke-test` Phase 8 runs that overwrite the per-date file
// don't clobber this regression input.

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
  "spec-write-2026-05-10.json",
);

describe("AC-STE-270.1 — F1 reproducer replay (2026-05-10 regression fixture)", () => {
  test("the v4 spec-write transcript surfaces the tracker-create save_issue@16 violation (STE-404)", () => {
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
    // STE-404: the earlier tracker-create (save_issue @ 16) is the true first
    // violation, ahead of the Write @ 19 the pre-STE-404 arbiter surfaced.
    expect(captured!.toolName).toBe("mcp__linear__save_issue");
    expect(captured!.index).toBe(16);
    // Forward-compat: the canonical NFR-10 message references the
    // protocol doc + names the offending tool/index.
    expect(captured!.message).toContain("Socratic first-turn contract violation");
    expect(captured!.message).toContain("mcp__linear__save_issue");
    expect(captured!.message).toContain("docs/auto-mode-protocol.md");
  });

  test("the regression fixture's transcript projects to a non-empty TranscriptEntry[]", () => {
    // Sanity guard against per-date overwrite drift — if the fixture path
    // is silently emptied by a future tooling change, this test will fail
    // loudly rather than surface as a passing replay against an empty
    // transcript (which would never throw the violation error).
    const ndjson = readFileSync(REGRESSION_FIXTURE, "utf-8");
    const transcript = parseStreamJsonTranscript(ndjson);
    expect(transcript.length).toBeGreaterThan(19);
  });
});

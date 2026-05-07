// STE-238 AC-STE-238.8 — unit test on the rendering helper.
//
// Asserts the renderer never produces the forbidden paraphrase
// "require Linear MCP" for any documented cause, and produces accurate
// cause-specific prose for each branch.

import { describe, expect, test } from "bun:test";
import {
  FORBIDDEN_SKIP_PHRASE,
  renderProbeSkipReason,
  type ProbeSkipCause,
} from "./tracker_probe_skip_reason";

const ALL_CAUSES: ProbeSkipCause[] = [
  "no_fr_in_scope",
  "active_fr_no_tracker_block",
  "fr_archived",
  "mode_none",
  "mcp_unavailable",
  "plan_file_missing",
];

describe("AC-STE-238.8 — renderProbeSkipReason never emits forbidden paraphrase", () => {
  test.each(ALL_CAUSES)(
    "cause=%s ⇒ rendered prose does NOT contain 'require Linear MCP'",
    (cause) => {
      const output = renderProbeSkipReason({
        probe: "tracker-project-milestone-attached",
        cause,
        detail: "STE-237.md",
      });
      expect(output).not.toContain(FORBIDDEN_SKIP_PHRASE);
    },
  );

  test("FORBIDDEN_SKIP_PHRASE export is the literal substring the contract forbids", () => {
    // Anchor the contract value in tests so future helper expansions cannot
    // silently re-allow the paraphrase by changing the constant.
    expect(FORBIDDEN_SKIP_PHRASE).toBe("require Linear MCP");
  });

  test("mode_none branch names the structural cause", () => {
    const output = renderProbeSkipReason({
      probe: "tracker-project-milestone-attached",
      cause: "mode_none",
    });
    expect(output).toContain("mode: none");
    expect(output).toContain("tracker-project-milestone-attached");
  });

  test("mcp_unavailable branch names tools, not vendor (vendor-neutral)", () => {
    const output = renderProbeSkipReason({
      probe: "active-ticket-drift",
      cause: "mcp_unavailable",
    });
    expect(output).toContain("MCP unavailable");
    expect(output).toContain("mcp__<tracker>__*");
    expect(output).not.toContain(FORBIDDEN_SKIP_PHRASE);
  });

  test("active_fr_no_tracker_block branch substitutes detail when provided", () => {
    const output = renderProbeSkipReason({
      probe: "tracker-project-milestone-attached",
      cause: "active_fr_no_tracker_block",
      detail: "specs/frs/STE-237.md",
    });
    expect(output).toContain("active FR has no `tracker:` block");
    expect(output).toContain("specs/frs/STE-237.md");
    expect(output).not.toContain(FORBIDDEN_SKIP_PHRASE);
  });

  test("active_fr_no_tracker_block branch handles missing detail gracefully", () => {
    const output = renderProbeSkipReason({
      probe: "tracker-project-milestone-attached",
      cause: "active_fr_no_tracker_block",
    });
    expect(output).toContain("active FR has no `tracker:` block");
    expect(output).not.toContain("(undefined)");
    expect(output).not.toContain(FORBIDDEN_SKIP_PHRASE);
  });

  test("no_fr_in_scope branch is mode-neutral (works for any tracker / mode: none)", () => {
    const output = renderProbeSkipReason({
      probe: "active-ticket-drift",
      cause: "no_fr_in_scope",
    });
    expect(output).toContain("no FR currently in scope");
    expect(output).not.toContain(FORBIDDEN_SKIP_PHRASE);
  });

  test("renderer is referentially transparent (same input ⇒ same output)", () => {
    const a = renderProbeSkipReason({ probe: "p", cause: "mode_none" });
    const b = renderProbeSkipReason({ probe: "p", cause: "mode_none" });
    expect(a).toBe(b);
  });
});

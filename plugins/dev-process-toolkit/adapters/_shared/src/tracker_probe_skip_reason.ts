// tracker_probe_skip_reason (STE-238 AC-STE-238.8) —
// Pure rendering helper for /gate-check skip-reason text on tracker-MCP-
// dependent probes. Replaces the prior LLM-paraphrased phrase
// "require Linear MCP" (which fired even when the Linear MCP was loaded
// but the probe skipped for an unrelated reason — the F9 conformance-loop
// finding from /tmp/dpt-conformance-loop-2026-05-07-iter-1.md).
//
// Spec deviation note (ambiguous, resolved provisionally): AC-STE-238.8
// names the probe `cross-cutting-spec-stale-file-refs` (probe #37) but
// the source signal F9 is about probe #26 (`tracker-project-milestone-
// attached`). The literal substring "require Linear MCP" appears in
// neither probe's source code today — it is LLM-emitted at runtime as a
// paraphrase. This helper is the byte-checkable arbiter the FR's "unit
// test on the rendering helper" sentence describes; any /gate-check
// probe that needs a skip-reason rendering routes through it. Forbidding
// the literal substring is enforced at unit-test level so future drift
// re-introducing the paraphrase fails the test.

export type ProbeSkipCause =
  | "no_fr_in_scope"
  | "active_fr_no_tracker_block"
  | "fr_archived"
  | "mode_none"
  | "mcp_unavailable"
  | "plan_file_missing";

export interface ProbeSkipReason {
  /** The probe whose skip-reason this renders for (e.g., `tracker-project-milestone-attached`). */
  probe: string;
  /** The structural cause of the skip — drives the rendered prose. */
  cause: ProbeSkipCause;
  /** Optional context for substitution into the rendered prose. */
  detail?: string;
}

/**
 * Forbidden substring — the LLM-emitted paraphrase the F9 finding caught.
 * Any rendered output that contains this substring violates the contract;
 * unit tests assert its absence across every cause.
 */
export const FORBIDDEN_SKIP_PHRASE = "require Linear MCP";

/**
 * Render a probe skip-reason. The output is byte-checkable, accurate, and
 * mode-aware — it never falls back to a generic "MCP-not-loaded" phrase
 * when the actual cause is something else.
 */
export function renderProbeSkipReason(reason: ProbeSkipReason): string {
  const { probe, cause, detail } = reason;
  switch (cause) {
    case "mode_none":
      return `${probe}: skipped — \`mode: none\` (Schema L declares no tracker)`;
    case "mcp_unavailable":
      return `${probe}: skipped — tracker MCP unavailable (no \`mcp__<tracker>__*\` tools loadable in this session)`;
    case "no_fr_in_scope":
      return `${probe}: skipped — no FR currently in scope`;
    case "active_fr_no_tracker_block":
      return `${probe}: skipped — active FR has no \`tracker:\` block${detail ? ` (${detail})` : ""}`;
    case "fr_archived":
      return `${probe}: skipped — FR archived${detail ? ` (${detail})` : ""}`;
    case "plan_file_missing":
      return `${probe}: skipped — plan file missing${detail ? ` (${detail})` : ""}`;
  }
}

// get_issue — STE-295 AC-STE-295.2: Linear MCP read-path wrapper.
//
// Symmetric counterpart to `formatLinearDescription` on the write path.
// STE-211 added `stripLinearACFences` and applied it inside the FR-import
// flow (`importFromTracker`). This wrapper extends the strip to any
// caller of `mcp__linear__get_issue` (e.g., /implement Phase 1 ticket
// state probes, /spec-write existing-FR re-read, /gate-check probe #37
// helpers) so they all see a clean unwrapped `description`.
//
// Round-trip property:
//   pushDescription(local) → fetchDescription(remote) → byte-equal(local)
//
// The wrapper takes a dependency-injected function that performs the
// underlying `mcp__linear__get_issue` call. Non-`description` fields
// (e.g., `title`, `identifier`) propagate untouched.
//
// Tests: see `tests/linear-ac-token-round-trip.test.ts`.

import { stripLinearACFences } from "./format_description";

/**
 * Wrap a `mcp__linear__get_issue` caller and strip AC-prefix fences /
 * legacy `<issue id>` XML wrappers from the returned `description`.
 *
 * All other fields propagate unchanged.
 */
export async function getIssue<T extends { description: string }>(
  mcpFn: (args: { id: string }) => Promise<T>,
  id: string,
): Promise<T> {
  const result = await mcpFn({ id });
  return {
    ...result,
    description: stripLinearACFences(result.description),
  };
}

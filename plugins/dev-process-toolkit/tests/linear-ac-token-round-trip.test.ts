// STE-295 AC-STE-295.2 — Linear MCP get_issue read-path round trip.
//
// STE-211 already wraps AC-prefix tokens with backtick fences on the WRITE
// path (`formatLinearDescription` in adapters/linear/src/format_description
// .ts) and strips them on the IMPORT path (`stripLinearACFences` applied
// inside `importFromTracker`). What's missing — and what AC-STE-295.2 adds
// — is symmetric strip on the direct `mcp__linear__get_issue` read wrapper
// so callers other than the FR-importer (e.g. /implement Phase 1 ticket
// state probes, /spec-write existing-FR re-read, /gate-check probe #37
// helpers) see a clean unwrapped description too.
//
// The new wrapper lives at adapters/linear/src/get_issue.ts and exposes
// `getIssue(mcpFn, ticketId): Promise<{ description, ... }>`. Round-trip
// property:
//
//   pushDescription(local) ─push─→ Linear ─fetch─→ getIssue(...).description
//                                                       ‖
//                                                  byte-equal `local`
//
// (The "push" + "Linear" steps are simulated here by composing
// `formatLinearDescription` and a fake `mcp__linear__get_issue` stub.)

import { describe, expect, test } from "bun:test";

import { formatLinearDescription } from "../adapters/linear/src/format_description";
import { getIssue } from "../adapters/linear/src/get_issue";

/**
 * Simulate the Linear MCP server's `mcp__linear__get_issue` call shape.
 * The server post-processes the stored description on read in two ways:
 *   1. Backtick fences from `formatLinearDescription` are echoed verbatim
 *      (so AC-prefix tokens stay non-auto-linked on Linear's web UI).
 *   2. Bare `STE-NNN` tokens in prose get auto-linked into
 *      `<issue id="...">STE-NNN</issue>` XML wrappers.
 *
 * The fake stub stores whatever was pushed and returns it on `get_issue`.
 */
function fakeLinearServer(stored: string) {
  return async (_args: { id: string }): Promise<{ description: string }> => {
    return { description: stored };
  };
}

describe("AC-STE-295.2 — getIssue read-path round trip: byte-equal local", () => {
  test("single AC line → fetched description byte-equals local", async () => {
    const local = "- AC-STE-203.1: foo\n";
    const pushed = formatLinearDescription(local);
    const mcp = fakeLinearServer(pushed);
    const out = await getIssue(mcp, "STE-203");
    expect(out.description).toBe(local);
  });

  test("multi-line AC body with bare refs preserved → byte-equal local", async () => {
    const local =
      "Requirement\n\n- AC-STE-203.1: first\n- AC-STE-204.2: second\n\nRefs: STE-205\n";
    const pushed = formatLinearDescription(local);
    const mcp = fakeLinearServer(pushed);
    const out = await getIssue(mcp, "STE-203");
    expect(out.description).toBe(local);
  });

  test("legacy <issue id> XML wrapper on AC prefix is stripped on read", async () => {
    // Simulate a pre-STE-211 stored body where the auto-linker wrapped the AC prefix.
    const linearSide = '- AC-<issue id="abc-def">STE-203</issue>.1: foo\n';
    const mcp = fakeLinearServer(linearSide);
    const out = await getIssue(mcp, "STE-203");
    expect(out.description).toBe("- AC-STE-203.1: foo\n");
  });

  test("body with NO AC prefixes passes through unchanged", async () => {
    const local = "Just some prose. Refs: STE-205\n";
    const pushed = formatLinearDescription(local);
    const mcp = fakeLinearServer(pushed);
    const out = await getIssue(mcp, "STE-205");
    expect(out.description).toBe(local);
  });

  test("propagates non-description fields untouched", async () => {
    const local = "- AC-STE-203.1: foo\n";
    const pushed = formatLinearDescription(local);
    // The stub returns description only; extend to assert that other
    // fields the wrapper receives pass through if present.
    const mcp = async (_args: { id: string }) =>
      ({
        description: pushed,
        title: "Sample title",
        identifier: "STE-203",
      }) as { description: string; title: string; identifier: string };
    const out = (await getIssue(mcp, "STE-203")) as {
      description: string;
      title?: string;
      identifier?: string;
    };
    expect(out.description).toBe(local);
    expect(out.title).toBe("Sample title");
    expect(out.identifier).toBe("STE-203");
  });
});

describe("AC-STE-295.2 — pushDescription → fetchDescription byte-equality property", () => {
  test("a battery of canonical AC-prefix bodies all round-trip", async () => {
    const inputs = [
      "AC-STE-203.1: foo",
      "- AC-STE-204.5: bar baz\n- AC-STE-205.10: qux",
      "Mixed: AC-STE-1.1, AC-DPT-99.7",
      "Plain text with no AC.",
      "Refs: STE-205\nAC-STE-203.1: foo",
    ];
    for (const local of inputs) {
      const pushed = formatLinearDescription(local);
      const mcp = fakeLinearServer(pushed);
      const out = await getIssue(mcp, "STE-1");
      expect(out.description).toBe(local);
    }
  });
});

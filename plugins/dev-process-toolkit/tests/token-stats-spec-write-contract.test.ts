import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";

// STE-345 AC-STE-345.5 — /spec-write integration prose contract.
//
// After /spec-write writes or updates an FR file, it renders that FR's
// `## Token Stats` block from the ledger, riding its own FR-file write (no
// separate dirty-tree event, no new commit), and emits a literal
// `token_stats_rendered` capability row in its Step 7 closing summary —
// vacuous (no row, no block) when the ledger is absent or has no rows for
// the FR.
//
// These are prose-contract meta-tests (same shape as the existing SKILL.md
// wiring assertions, e.g. deps-research-injection.test.ts): readFileSync the
// skill surface and assert it carries the literal directives probe #44
// (`closing_summary_capability_keys`) greps for. Registration in
// CANONICAL_CAPABILITY_KEYS is asserted too — probe #44's orphan-directive
// guard refuses a MUST-emit directive whose key is not in the canonical set.

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

const HEADING = "## Token Stats";

function specWriteBody(): string {
  return readFileSync(specWritePath, "utf8");
}

/** All ±window slices around each `## Token Stats` mention in the body. */
function tokenStatsWindows(body: string): string[] {
  const windows: string[] = [];
  let idx = body.indexOf(HEADING);
  while (idx !== -1) {
    windows.push(body.slice(Math.max(0, idx - 1000), idx + 1200));
    idx = body.indexOf(HEADING, idx + HEADING.length);
  }
  return windows;
}

describe("AC-STE-345.5 — /spec-write renders ## Token Stats riding its own FR-file write", () => {
  test("SKILL.md carries the literal `MUST emit \\`token_stats_rendered\\`` directive (probe #44 shape)", () => {
    expect(specWriteBody()).toMatch(/MUST emit\s+`token_stats_rendered`/);
  });

  test("§ 7 static capability map carries a token_stats_rendered row", () => {
    const body = specWriteBody();
    const mapIdx = body.indexOf("Static plain-language map");
    expect(mapIdx).toBeGreaterThan(-1);
    const mapRegion = body.slice(mapIdx);
    // A table row (pipe-delimited) naming the backticked key.
    expect(mapRegion).toMatch(/^\|[^\n]*`token_stats_rendered`[^\n]*\|\s*$/m);
  });

  test("token_stats_rendered is registered in CANONICAL_CAPABILITY_KEYS (probe #44 orphan guard)", () => {
    expect(CANONICAL_CAPABILITY_KEYS as readonly string[]).toContain(
      "token_stats_rendered",
    );
  });

  test("render-after-FR-write contract: ledger-sourced, rides the FR-file write, helper named", () => {
    const body = specWriteBody();
    expect(body).toContain(HEADING);

    const windows = tokenStatsWindows(body);
    // The block is a projection of the STE-344 ledger.
    expect(windows.some((w) => /ledger/i.test(w))).toBe(true);
    // Rides the FR-file write — no separate dirty-tree event, no new commit.
    expect(
      windows.some((w) =>
        /no (?:separate|new) commit|no separate dirty-tree|rid\w*[\s\S]{0,60}FR-file write/i.test(
          w,
        ),
      ),
    ).toBe(true);
    // The deterministic render path is the shared helper, not ad-hoc prose.
    expect(body).toMatch(/upsertTokenStatsBlock|token_stats_render/);
  });

  test("vacuous path documented: ledger absent or no rows for the FR ⇒ no row, no block", () => {
    const windows = tokenStatsWindows(specWriteBody());
    expect(
      windows.some(
        (w) => /vacuous/i.test(w) && /(absent|no rows)/i.test(w),
      ),
    ).toBe(true);
  });
});

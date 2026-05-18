// STE-301 AC-STE-301.10 / AC-STE-301.11 — deterministic parser for the
// `deps-research-result` fenced block emitted by the deps-researcher
// subagent.
//
// Module under test:
//   plugins/dev-process-toolkit/adapters/_shared/src/deps_research_result.ts
//
// Public surface:
//   parseDepsResearchBlock(text): { ok: true, sections } | { ok: false, reason }
//   DEPS_RESEARCH_BANNER  — canonical banner literal
//   DEPS_RESEARCH_SECTIONS — canonical 3-section list, in order
//
// Closed-schema rules (AC-STE-301.10):
//   - banner line above the opening fence
//   - opening fence `\`\`\`deps-research-result`
//   - exactly three `##` headings in canonical order:
//       ## Relevant Packages
//       ## API Surface Highlights
//       ## Reusable Patterns
//   - optional fourth section `## Missing deps`
//   - hard cap 25 lines (banner + open-fence + body + close-fence)
//   - exactly one fenced block in the text (multiple ⇒ violation)
//
// Pattern clone of `parseSpecResearchBlock` (STE-230).

import { describe, expect, test } from "bun:test";
import {
  DEPS_RESEARCH_BANNER,
  DEPS_RESEARCH_SECTIONS,
  parseDepsResearchBlock,
} from "../adapters/_shared/src/deps_research_result";

function canonicalBlock(): string {
  return [
    DEPS_RESEARCH_BANNER,
    "```deps-research-result",
    "## Relevant Packages",
    "- my-sdk — internal SDK for acme platform",
    "",
    "## API Surface Highlights",
    "- `function frobnicate(opts: Opts): Promise<void>`",
    "",
    "## Reusable Patterns",
    "- repository pattern with adapter injection",
    "```",
    "",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Constants — canonical banner + section list.
// -----------------------------------------------------------------------------

describe("AC-STE-301.10 — DEPS_RESEARCH_SECTIONS canonical 3-section list", () => {
  test("section names + order match the AC", () => {
    expect(DEPS_RESEARCH_SECTIONS).toEqual([
      "## Relevant Packages",
      "## API Surface Highlights",
      "## Reusable Patterns",
    ]);
  });

  test("DEPS_RESEARCH_BANNER is a non-empty string starting with `>`", () => {
    expect(typeof DEPS_RESEARCH_BANNER).toBe("string");
    expect(DEPS_RESEARCH_BANNER.length).toBeGreaterThan(0);
    expect(DEPS_RESEARCH_BANNER.startsWith(">")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Positive — canonical 3-section block parses cleanly.
// -----------------------------------------------------------------------------

describe("AC-STE-301.11 — valid 3-section block parses cleanly", () => {
  test("canonical block returns ok: true with all sections", () => {
    const r = parseDepsResearchBlock(canonicalBlock());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sections["## Relevant Packages"]).toBeDefined();
      expect(r.sections["## API Surface Highlights"]).toBeDefined();
      expect(r.sections["## Reusable Patterns"]).toBeDefined();
    }
  });
});

describe("AC-STE-301.10 — valid 3-section + optional `## Missing deps`", () => {
  test("block with the optional 4th subsection parses cleanly", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "```deps-research-result",
      "## Relevant Packages",
      "- (none found)",
      "## API Surface Highlights",
      "- (none found)",
      "## Reusable Patterns",
      "- (none found)",
      "## Missing deps",
      "- absent-sdk (../absent-sdk not present on disk)",
      "```",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sections["## Missing deps"]).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// Negative — every shape failure surfaces a reason that names the offending part.
// -----------------------------------------------------------------------------

describe("AC-STE-301.11 — block missing banner ⇒ format violation naming `banner`", () => {
  test("missing banner returns ok: false with reason citing the banner", () => {
    const block = [
      "```deps-research-result",
      "## Relevant Packages",
      "- (none found)",
      "## API Surface Highlights",
      "- (none found)",
      "## Reusable Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/banner/i);
    }
  });
});

describe("AC-STE-301.11 — block over 25 lines ⇒ format violation naming `line cap`", () => {
  test("over-cap block returns ok: false with reason citing the line cap", () => {
    const lines: string[] = [DEPS_RESEARCH_BANNER, "```deps-research-result"];
    for (const heading of DEPS_RESEARCH_SECTIONS) {
      lines.push(heading);
      for (let i = 0; i < 10; i++) {
        lines.push(`- bullet ${i} padding`);
      }
    }
    lines.push("```");
    lines.push("");
    const r = parseDepsResearchBlock(lines.join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/line cap|25/i);
    }
  });
});

describe("AC-STE-301.11 — wrong section order ⇒ format violation naming `section order`", () => {
  test("swapped sections return ok: false naming order", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "```deps-research-result",
      "## API Surface Highlights", // out of order
      "- (none found)",
      "## Relevant Packages",
      "- (none found)",
      "## Reusable Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/order/i);
    }
  });
});

describe("AC-STE-301.11 — wrong section name ⇒ format violation naming the offending name", () => {
  test("typo in section name returns ok: false naming the offender", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "```deps-research-result",
      "## Relevant Pacakges", // typo
      "- (none found)",
      "## API Surface Highlights",
      "- (none found)",
      "## Reusable Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("## Relevant Pacakges");
    }
  });
});

describe("AC-STE-301.11 — missing opening fence ⇒ format violation naming the fence", () => {
  test("no fence returns ok: false naming the fence", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "## Relevant Packages",
      "- (none found)",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/fence/i);
    }
  });
});

describe("AC-STE-301.11 — two fenced blocks ⇒ format violation (exactly-one rule)", () => {
  test("two ` ```deps-research-result ` fences return ok: false", () => {
    const single = canonicalBlock().trimEnd();
    const block = `${single}\n\n${single}\n`;
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/exactly one|multiple|two|duplicate/i);
    }
  });
});

describe("AC-STE-301.11 — missing closing fence ⇒ format violation", () => {
  test("unclosed block returns ok: false naming the fence", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "```deps-research-result",
      "## Relevant Packages",
      "- (none found)",
      "## API Surface Highlights",
      "- (none found)",
      "## Reusable Patterns",
      "- (none found)",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/fence|closing/i);
    }
  });
});

describe("AC-STE-301.11 — missing third section ⇒ format violation", () => {
  test("two-section block returns ok: false with a section-related reason", () => {
    const block = [
      DEPS_RESEARCH_BANNER,
      "```deps-research-result",
      "## Relevant Packages",
      "- (none found)",
      "## API Surface Highlights",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const r = parseDepsResearchBlock(block);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toMatch(/section|missing|count|3 |three/);
    }
  });
});

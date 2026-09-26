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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// R3 (docs audit, 2026-09-23) — the vacuous-exit shape one document ORDERED
// was rejected by the parser that grades it.
//
// Three artifacts, two of them normative: `skills/deps-research/SKILL.md`
// prescribed an EMPTY fenced block (banner + open + close, no content lines);
// `agents/deps-researcher.md` prescribed the canonical headers with
// `- (none found)`; and `parseDepsResearchBlock` requires the three headings,
// so it rejected the skill's shape outright. Two of the three already agreed,
// so the skill moved rather than the parser — loosening the parser would make
// an empty block indistinguishable from a fork that died mid-emit.
//
// This row grades the AGREEMENT rather than any one of them: it builds the
// block from the module's own banner and section constants, checks the parser
// accepts it, and checks BOTH shipped documents prescribe that shape and no
// longer prescribe the empty one.
describe("R3 — the vacuous-exit shape the documents prescribe is the shape the parser accepts", () => {
  const pluginRoot = join(import.meta.dir, "..");
  const fence = "`".repeat(3);
  const canonicalNoneFound = [
    DEPS_RESEARCH_BANNER,
    `${fence}deps-research-result`,
    ...DEPS_RESEARCH_SECTIONS.flatMap((s) => [s, "- (none found)"]),
    fence,
  ].join("\n");

  test("the parser accepts the canonical `- (none found)` block", () => {
    const r = parseDepsResearchBlock(canonicalNoneFound);
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
  });

  test("CONTROL — it still rejects the EMPTY block the skill used to prescribe, so this is a real disagreement and not a formatting taste", () => {
    const empty = [DEPS_RESEARCH_BANNER, `${fence}deps-research-result`, fence].join("\n");
    const r = parseDepsResearchBlock(empty);
    expect(r.ok).toBe(false);
  });

  for (const rel of ["skills/deps-research/SKILL.md", "agents/deps-researcher.md"]) {
    test(`${rel} prescribes the accepted shape and not the rejected one`, () => {
      const text = readFileSync(join(pluginRoot, rel), "utf-8");
      expect(text, "it names the placeholder bullet the parser accepts").toContain("- (none found)");
      expect(text, "and no longer orders a content-less block").not.toMatch(/empty `deps-research-result` fenced block/);
    });
  }
});

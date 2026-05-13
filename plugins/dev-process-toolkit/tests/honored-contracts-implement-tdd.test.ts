// Doc-conformance tests for STE-283.
//
// "Honored Contracts enforcement — /implement → /tdd Contract block +
// Rationalization table + catalog". Three layered prose edits reinforce each
// other:
//
//   1. A labeled **TDD Orchestrator Contract** callout at /implement Phase 2
//      step 8 (named violation: "Inline TDD Antipattern", auditable evidence
//      shape, residual-risk note citing STE-220→STE-270 + escalation path,
//      cross-reference to the catalog file).
//   2. An inline **Rationalization Prevention table** (Excuse | Reality) with
//      ≥ 3 rows preempting cost / no-N-times-pattern / shipping-over-fidelity.
//   3. A new `plugins/dev-process-toolkit/docs/honored-contracts.md` catalog
//      with ≥ 3 seeded entries (`/implement → /tdd` primary,
//      `/spec-write → spec-research` precedent, `/brainstorm →
//      AskUserQuestion-first` precedent) under a uniform four-label shape
//      (Mandate / Violation name / Auditable evidence / Precedent FRs).
//
// One test per AC verify line. Assertions are over file content (prose-only
// FR — no runtime behavior to assert).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const IMPLEMENT_SKILL_PATH = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const CATALOG_PATH = join(PLUGIN_ROOT, "docs", "honored-contracts.md");

function readImplementSkill(): string {
  if (!existsSync(IMPLEMENT_SKILL_PATH)) {
    throw new Error(`/implement SKILL.md not found at ${IMPLEMENT_SKILL_PATH}`);
  }
  return readFileSync(IMPLEMENT_SKILL_PATH, "utf-8");
}

function readCatalog(): string {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`honored-contracts.md not found at ${CATALOG_PATH}`);
  }
  return readFileSync(CATALOG_PATH, "utf-8");
}

/**
 * Extract the prose region for /implement Phase 2 step 8 — the labeled
 * "Execute in TDD order via the multi-agent orchestrator" item under
 * `## Phase 2: Build (TDD)`. The Contract block lives at the start of this
 * region per the FR's Technical Design.
 *
 * Region runs from the `## Phase 2: Build (TDD)` header through the start of
 * step 9 (`Spec deviation check`). This window is the AC's "Phase 2 step 8"
 * scope; assertions narrower than the SKILL file as a whole guard against
 * stray matches elsewhere in the file.
 */
function step8Region(body: string): string {
  const phase2Idx = body.indexOf("## Phase 2: Build (TDD)");
  if (phase2Idx === -1) {
    throw new Error("`## Phase 2: Build (TDD)` heading not found in /implement SKILL.md");
  }
  // Step 9 begins with "9. **Spec deviation check**". Fall back to the next
  // `### Spec Breakout` / `## ` heading if the step numbering ever shifts.
  const step9Idx = body.indexOf("9. **Spec deviation check**", phase2Idx);
  const fallbackIdx = (() => {
    const a = body.indexOf("### Spec Breakout", phase2Idx);
    const b = body.indexOf("\n## ", phase2Idx + 1);
    const candidates = [step9Idx, a, b].filter((i) => i > phase2Idx);
    if (candidates.length === 0) {
      return body.length;
    }
    return Math.min(...candidates);
  })();
  return body.slice(phase2Idx, fallbackIdx);
}

describe("STE-283 AC.1 — /implement Phase 2 step 8 carries the TDD Orchestrator Contract callout", () => {
  test("Contract block names the contract verbatim", () => {
    const body = readImplementSkill();
    expect(body).toContain("TDD Orchestrator Contract");
  });

  test('Contract block names the violation: "Inline TDD Antipattern"', () => {
    const body = readImplementSkill();
    expect(body).toContain("Inline TDD Antipattern");
  });

  test("Contract block + violation name appear inside Phase 2 step 8 (not elsewhere)", () => {
    const body = readImplementSkill();
    const region = step8Region(body);
    expect(region).toContain("TDD Orchestrator Contract");
    expect(region).toContain("Inline TDD Antipattern");
  });

  test("Contract block states the auditable evidence shape (N tool_use entries = FR count in milestone scope)", () => {
    const region = step8Region(readImplementSkill());
    // The FR's AC.1 spells out the canonical evidence shape:
    //   "N Skill(/dev-process-toolkit:tdd <FR-id>) tool_use entries where
    //    N = FR count in milestone scope".
    // We assert the canonical-name fragments rather than the exact prose so
    // the wording can absorb minor phrasing adjustments without churn — the
    // *substance* (orchestrator call, tool_use evidence, FR-count rule) is
    // load-bearing.
    expect(region).toMatch(/\/dev-process-toolkit:tdd/);
    expect(region).toMatch(/tool_use/i);
    expect(region).toMatch(/FR count|per FR|N\s*=\s*FR/i);
  });
});

describe("STE-283 AC.2 — Rationalization Prevention table (≥ 3 rows)", () => {
  test("Excuse | Reality table header appears in /implement SKILL.md", () => {
    const body = readImplementSkill();
    expect(body).toContain("| Excuse | Reality |");
  });

  test("Excuse | Reality table sits inside or immediately after the Contract block in Phase 2 step 8", () => {
    const region = step8Region(readImplementSkill());
    expect(region).toContain("| Excuse | Reality |");
  });

  test("Table has ≥ 3 body rows preempting documented rationalizations (cost / N-times / shipping-over-fidelity)", () => {
    const region = step8Region(readImplementSkill());
    const headerIdx = region.indexOf("| Excuse | Reality |");
    expect(headerIdx).toBeGreaterThan(-1);
    // Walk past the header row + separator row, then count consecutive body
    // rows (lines beginning with `|`). Stop at the first non-pipe line.
    const afterHeader = region.slice(headerIdx).split("\n");
    // afterHeader[0] is the header row, afterHeader[1] is the separator
    // (`|--------|---------|`). Body rows start at index 2.
    let bodyRows = 0;
    for (let i = 2; i < afterHeader.length; i++) {
      const line = afterHeader[i]!;
      if (line.trim().startsWith("|")) {
        bodyRows++;
      } else {
        break;
      }
    }
    expect(bodyRows).toBeGreaterThanOrEqual(3);

    // The three canonical rationalizations are explicitly named in the FR.
    // Each must be addressed somewhere in the table body. We match generous
    // substrings — the rebuttal wording is the operator's call.
    const tableBody = afterHeader.slice(2, 2 + bodyRows).join("\n");
    expect(tableBody.toLowerCase()).toMatch(/cost/);
    expect(tableBody.toLowerCase()).toMatch(/n-times|n times|N times/i);
    expect(tableBody.toLowerCase()).toMatch(/ship|fidelity/);
  });
});

describe("STE-283 AC.3 — honored-contracts.md catalog exists with uniform four-label shape", () => {
  test("plugins/dev-process-toolkit/docs/honored-contracts.md exists", () => {
    expect(existsSync(CATALOG_PATH)).toBe(true);
  });

  test("catalog has ≥ 12 four-label section headers (3 entries × 4 labels: Mandate / Violation name / Auditable evidence / Precedent FRs)", () => {
    const body = readCatalog();
    // AC verify line uses the regex: ^\*\*(Mandate|Violation name|Auditable evidence|Precedent FRs).
    // We replicate it line-by-line for clarity.
    const lines = body.split("\n");
    const labelRe = /^\*\*(Mandate|Violation name|Auditable evidence|Precedent FRs)/;
    const matches = lines.filter((l) => labelRe.test(l));
    expect(matches.length).toBeGreaterThanOrEqual(12);
  });

  test("catalog contains an entry for /implement → /tdd", () => {
    const body = readCatalog();
    // The entry's heading or body must name the contract pair. We accept
    // either ASCII arrow `->` or the unicode arrow `→` used elsewhere in the
    // repo prose, paired with `/implement` and `/tdd`.
    expect(body).toMatch(/\/implement[\s\S]{0,80}(→|->)[\s\S]{0,80}\/tdd/);
  });
});

describe("STE-283 AC.4 — /implement → /tdd catalog entry cites the STE-225 + STE-220→STE-270 chain", () => {
  test("catalog cites STE-225 (orchestrator) and all six prose-falsification FRs (STE-220, 226, 237, 251, 262, 270)", () => {
    const body = readCatalog();
    const required = [
      "STE-225",
      "STE-220",
      "STE-226",
      "STE-237",
      "STE-251",
      "STE-262",
      "STE-270",
    ];
    // AC verify line: grep -E "STE-225|STE-220|STE-226|STE-237|STE-251|STE-262|STE-270" >= 7 distinct refs.
    const distinctHits = new Set<string>();
    for (const ref of required) {
      if (body.includes(ref)) {
        distinctHits.add(ref);
      }
    }
    expect(distinctHits.size).toBeGreaterThanOrEqual(7);
  });
});

describe("STE-283 AC.5 — Contract block references the catalog file path", () => {
  test("`docs/honored-contracts.md` is cited inside Phase 2 step 8", () => {
    const region = step8Region(readImplementSkill());
    expect(region).toContain("docs/honored-contracts.md");
  });
});

describe("STE-283 AC.6 — catalog seeds ≥ 3 contract entries under `## ` headings", () => {
  test("catalog has ≥ 3 `## ` (level-2) headings", () => {
    const body = readCatalog();
    const headings = body.split("\n").filter((l) => /^## /.test(l));
    expect(headings.length).toBeGreaterThanOrEqual(3);
  });

  test("catalog names the three seeded entries: /implement → /tdd, /spec-write → spec-research, /brainstorm → AskUserQuestion-first", () => {
    const body = readCatalog();
    // /implement → /tdd
    expect(body).toMatch(/\/implement[\s\S]{0,80}(→|->)[\s\S]{0,80}\/tdd/);
    // /spec-write → spec-research (precedent — STE-230)
    expect(body).toMatch(/\/spec-write[\s\S]{0,80}(→|->)[\s\S]{0,80}spec-research/);
    // /brainstorm → AskUserQuestion-first (precedent — STE-237)
    expect(body).toMatch(/\/brainstorm[\s\S]{0,80}(→|->)[\s\S]{0,80}AskUserQuestion/);
  });
});

describe("STE-283 AC.7 — Contract block carries a residual-risk note citing STE-220→STE-270 + escalation path", () => {
  test("Phase 2 step 8 mentions falsification or escalation (residual-risk framing)", () => {
    const region = step8Region(readImplementSkill());
    // AC verify line: grep -E "falsif|escalation" ... referencing STE-220.
    expect(region).toMatch(/falsif|escalation/i);
  });

  test("residual-risk note references STE-220 (anchor of the prose-falsification chain)", () => {
    const region = step8Region(readImplementSkill());
    expect(region).toContain("STE-220");
  });

  test("residual-risk note names the documented escalation path (evidence-based gate / hard mechanic)", () => {
    const region = step8Region(readImplementSkill());
    // The FR notes the escalation path as "evidence-based gate (STE-262/STE-270
    // pattern) or hard mechanic (STE-225 pattern)". Either phrase counts.
    expect(region).toMatch(/evidence-based gate|hard mechanic/i);
  });
});

// STE-295 AC-STE-295.3 / AC-STE-295.4 / AC-STE-295.5 — SKILL.md content checks.
//
// Three byte-checkable doc/prose-content assertions against checked-in
// SKILL.md files. These are grep-style tests: read the file, assert a
// literal substring (or regex absence). No subprocess spawn, no MCP.
//
// AC-STE-295.3 — `.claude/skills/smoke-test/SKILL.md` Phase 9 (or
//   equivalent) MUST include a master-merge step that merges
//   `chore/setup-bootstrap` → master BEFORE the
//   `branch_gate_default_applied` auto-apply spawn. Verify SKILL.md
//   content has BOTH the merge step prose AND the
//   `branch_gate_default_applied` reference, with the merge step
//   appearing BEFORE the first occurrence of the token.
//
// AC-STE-295.4 — `plugins/dev-process-toolkit/skills/gate-check/SKILL.md`
//   MUST contain the literal one-line sentence documenting probe #37's
//   fenced-block-only scope. Substring assertion.
//
// AC-STE-295.5 — `.claude/skills/smoke-test/SKILL.md` MUST emit the
//   canonical `**Severity:** <level>` form (colon ends bold) and the
//   regression form `**Severity: <level>.**` (severity word + colon
//   INSIDE bold + trailing period) MUST be absent.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SMOKE_TEST_SKILL = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
const GATE_CHECK_SKILL = join(
  REPO_ROOT,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "gate-check",
  "SKILL.md",
);

// AC-STE-295.4 canonical sentence (must appear verbatim in the gate-check
// SKILL.md probe #37 anchor body or § What's checked section).
const PROBE_37_SCOPE_SENTENCE =
  "Probe #37 (cross-cutting-spec-stale-file-refs) only fires on path tokens inside fenced directory-tree blocks in technical-spec.md / testing-spec.md; bare-prose path mentions outside fences are operator judgment surface and never flagged.";

describe("AC-STE-295.3 — smoke-test SKILL.md Phase 9 master-merge step", () => {
  test("SKILL.md contains the branch_gate_default_applied capability token", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    expect(content).toContain("branch_gate_default_applied");
  });

  test("SKILL.md contains a master-merge step naming chore/setup-bootstrap", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // The merge step must name the source branch (chore/setup-bootstrap)
    // AND a merge operation onto master/main. Be tolerant of phrasing but
    // strict on the two anchor tokens both being present.
    expect(content).toContain("chore/setup-bootstrap");
    // The merge step prose must mention `merge` near the source branch
    // (loose match — the implementer chooses exact wording). Use a regex
    // that allows ≤ 200 chars between `merge` and `chore/setup-bootstrap`
    // on the same line or within a small window.
    const mergeRe =
      /merge[\s\S]{0,200}chore\/setup-bootstrap|chore\/setup-bootstrap[\s\S]{0,200}merge/;
    expect(content).toMatch(mergeRe);
  });

  test("master-merge step appears BEFORE the first branch_gate_default_applied auto-apply spawn", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    const mergeIdx = content.indexOf("chore/setup-bootstrap");
    const tokenIdx = content.indexOf("branch_gate_default_applied");
    // Both must exist (separately asserted above) AND mergeIdx must come
    // before the FIRST occurrence of the auto-apply spawn token.
    expect(mergeIdx).toBeGreaterThanOrEqual(0);
    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(mergeIdx).toBeLessThan(tokenIdx);
  });
});

describe("AC-STE-295.4 — gate-check SKILL.md probe #37 fence-only scope doc line", () => {
  test("gate-check SKILL.md contains the literal one-line probe-#37 scope sentence", () => {
    const content = readFileSync(GATE_CHECK_SKILL, "utf-8");
    expect(content).toContain(PROBE_37_SCOPE_SENTENCE);
  });
});

describe("AC-STE-295.5 — smoke-test SKILL.md Severity-format canonical normalization", () => {
  test("SKILL.md contains the canonical `**Severity:** <level>` form (colon ends bold)", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // At least one canonical occurrence — the Phase 3 findings template.
    expect(content).toMatch(/\*\*Severity:\*\*\s+(high|medium|low)/);
  });

  test("SKILL.md has ZERO regression-form occurrences `**Severity: <level>.**`", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // Regression form: severity word + colon INSIDE bold + trailing period.
    // `**Severity: high.**`, `**Severity: medium.**`, `**Severity: low.**`.
    const regressionRe = /\*\*Severity:\s+(?:high|medium|low)\.\*\*/g;
    const matches = content.match(regressionRe) ?? [];
    expect(matches.length).toBe(0);
  });

  test("SKILL.md has ZERO occurrences of any `**Severity: <word>**` (colon-inside-bold) form", () => {
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // Broader regression form — colon INSIDE bold without trailing period
    // is also non-canonical; the canonical is `**Severity:** <level>` only.
    const colonInsideBoldRe = /\*\*Severity:\s+[a-z]+\.?\*\*/g;
    const matches = content.match(colonInsideBoldRe) ?? [];
    expect(matches.length).toBe(0);
  });

  test("SKILL.md carries an explicit canonical-form normative callout", () => {
    // Per the FR /conformance-loop iter-1 termination-probe finding: the
    // LLM-emitter drifts to `**Severity: high.**` in actual findings files
    // even when the template uses the canonical form. AC-STE-295.5's fix
    // hardens the template with an explicit anti-regression callout that
    // names BOTH forms — canonical and regression — so the emitter cannot
    // mis-render. The test pins this prose so it cannot regress.
    const content = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // Match an explicit normative statement: "must" / "MUST" / "exactly"
    // appearing in proximity to the canonical-vs-regression contrast.
    // We accept any flavor of callout that names BOTH `**Severity:**` AND
    // disambiguates against the colon-inside-bold form.
    const calloutRe =
      /(?:exactly|MUST|must|canonical)[\s\S]{0,400}\*\*Severity:\*\*[\s\S]{0,400}(?:not|never|NOT|NEVER|regression)/;
    expect(content).toMatch(calloutRe);
  });
});

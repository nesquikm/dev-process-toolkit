import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SPEC_REVIEW_DRIFT_HINT_THRESHOLD,
  formatDriftHint,
} from "../adapters/_shared/src/spec_review_drift_hint";

// STE-172 — /spec-review live-spec drift refresh hint when drift count
// crosses threshold. Two test surfaces: (1) AC-STE-172.4 integration
// fixtures (0 / 1 / 4 drift branches) against the deterministic
// `formatDriftHint(count)` helper that owns the threshold + literal line
// shape; (2) doc-conformance against SKILL.md so the LLM-as-runtime
// emits the same string the helper renders. Both surfaces share a single
// source of truth for the threshold rule.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-review", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

describe("STE-172 AC-STE-172.1 — SKILL.md carries the drift_count threshold rule", () => {
  test("threshold rule names the `>= 2` cutoff inline", () => {
    const body = readSkill();
    // The threshold must be `>= 2` (not `> 0`) — single-line cosmetic
    // drifts during normal /implement churn should not train operators to
    // ignore the hint.
    expect(body).toMatch(/drift[_ ]count\s*>=\s*2/i);
  });

  test("rationale is recorded inline so a future revisit understands the choice", () => {
    const body = readSkill();
    // Rationale text — anything mentioning cosmetic / single-line drifts +
    // /implement churn pattern is acceptable, but the prose must carry it
    // so a future reader doesn't have to dig through the FR.
    expect(body).toMatch(/cosmetic|single-line/i);
    expect(body).toMatch(/implement churn|normal\s+\/?implement/i);
  });
});

describe("STE-172 AC-STE-172.2 — SKILL.md emits the literal hint line on drift_count >= 2", () => {
  test("hint template is byte-exact", () => {
    const body = readSkill();
    // Substring match on the canonical hint line — `N` is a placeholder.
    expect(body).toContain(
      "Live-spec refresh suggested — N drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    );
  });

  test("hint placement: after the verdict, before the closing summary", () => {
    const body = readSkill();
    // The prose must commit to a placement so the LLM doesn't sprinkle
    // it mid-table or above the verdict.
    expect(body).toMatch(/after the verdict|end of the report/i);
  });
});

describe("STE-172 AC-STE-172.3 — SKILL.md states the omit branches (0-drift / 1-drift)", () => {
  test("hint is omitted when drift_count < 2", () => {
    const body = readSkill();
    // Either negative phrasing (omit / skip / suppress) or a positive
    // restatement of the threshold suffices, but the prose must rule
    // out N=0 / N=1 emissions explicitly.
    expect(body).toMatch(/omit|skip|suppress|only when|do not emit/i);
  });
});

describe("STE-172 AC-STE-172.4 — formatDriftHint integration covers 0 / 1 / 4 drift fixtures", () => {
  test("0-drift fixture → null (no hint emitted)", () => {
    expect(formatDriftHint(0)).toBeNull();
  });

  test("1-drift fixture → null (below threshold)", () => {
    expect(formatDriftHint(1)).toBeNull();
  });

  test("4-drift fixture → hint with N=4 substituted, byte-exact", () => {
    expect(formatDriftHint(4)).toBe(
      "Live-spec refresh suggested — 4 drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    );
  });

  test("threshold-boundary fixture (drift=2) → hint emits with N=2", () => {
    expect(formatDriftHint(2)).toBe(
      "Live-spec refresh suggested — 2 drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    );
  });

  test("non-integer / negative inputs → null (safe degenerate handling)", () => {
    expect(formatDriftHint(-1)).toBeNull();
    expect(formatDriftHint(1.5)).toBeNull();
    expect(formatDriftHint(Number.NaN)).toBeNull();
  });

  test("threshold constant exposed for downstream contract pinning", () => {
    expect(SPEC_REVIEW_DRIFT_HINT_THRESHOLD).toBe(2);
  });
});

describe("STE-172 — SKILL.md binds to the formatDriftHint helper as canonical source", () => {
  test("SKILL.md names the helper path so the rendered string is testable", () => {
    const body = readSkill();
    expect(body).toMatch(/spec_review_drift_hint|formatDriftHint/);
  });
});

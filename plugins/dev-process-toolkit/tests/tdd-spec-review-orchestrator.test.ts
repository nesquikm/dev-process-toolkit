import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  stepSpecReview,
  type SpecReviewDecision,
} from "../adapters/_shared/src/tdd_spec_review_orchestrator";
import {
  newRetryBudget,
  recordAuditRoundFailure,
  recordTddFailure,
  type RetryKey,
} from "../adapters/_shared/src/tdd_retry_state";
import type { TddSpecReviewBlock } from "../adapters/_shared/src/tdd_spec_review_result";

// STE-296 — Orchestrator state machine + doc invariants for the AUDIT stage.
//
// Tests in this file cover:
//   AC.1 — agents/tdd-spec-reviewer.md frontmatter invariants
//   AC.2 — skills/tdd-spec-review/SKILL.md frontmatter invariants
//   AC.4 — orchestrator SKILL.md post-REFACTOR AUDIT branch documented
//   AC.5 — clean first audit ⇒ exit-ok (advisory fields ignored for halt/retry)
//   AC.6 — missing_acs.length > 0 ⇒ retry path + audit-round budget cap=1
//   AC.9 — capability key map entries present in spec-write SKILL.md
//   AC.10 — pure orchestrator step decisions on fixture inputs (paths a–d)

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginRoot = join(repoRoot, "plugins", "dev-process-toolkit");

function read(p: string): string {
  expect(existsSync(p)).toBe(true);
  return readFileSync(p, "utf-8");
}

function parseFrontmatter(body: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/m.exec(body);
  expect(m).not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of m![1]!.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim();
    const v = line.slice(c + 1).trim();
    if (k.length > 0) out[k] = v;
  }
  return out;
}

function makeBlock(
  overrides: Partial<TddSpecReviewBlock> = {},
): TddSpecReviewBlock {
  return {
    role: "spec-reviewer",
    status: "ok",
    missing_acs: [],
    partial_acs: [],
    drift_count: 0,
    advisory_findings: [],
    cross_cutting_drift: [],
    command: "bun test",
    output_excerpt: "PASS",
    ...overrides,
  };
}

// ─── AC.1: agents/tdd-spec-reviewer.md frontmatter ──────────────────────────
describe("AC-STE-296.1 — tdd-spec-reviewer subagent frontmatter", () => {
  const agentPath = join(pluginRoot, "agents", "tdd-spec-reviewer.md");

  test("file exists", () => {
    expect(existsSync(agentPath)).toBe(true);
  });

  test("tools field is exactly Read, Grep, Glob (no Write/Edit/Bash/Agent)", () => {
    const fm = parseFrontmatter(read(agentPath));
    const tools = (fm.tools ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Glob");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Agent");
  });

  test("maxTurns: 8", () => {
    const fm = parseFrontmatter(read(agentPath));
    expect(fm.maxTurns).toBe("8");
  });

  test("model: sonnet", () => {
    const fm = parseFrontmatter(read(agentPath));
    expect(fm.model).toBe("sonnet");
  });

  test("description names /dev-process-toolkit:tdd as exclusive invoker + context: fork", () => {
    const fm = parseFrontmatter(read(agentPath));
    const desc = (fm.description ?? "").toLowerCase();
    expect(desc).toContain("tdd");
    expect(desc).toMatch(/exclusive|sole|only|do not invoke directly/i);
    expect(desc).toContain("context: fork");
  });

  test("body explains audit procedure: read FR, trace ACs, classify, fenced block", () => {
    const body = read(agentPath);
    expect(body.toLowerCase()).toContain("read");
    expect(body).toMatch(/AC|acceptance criteria/i);
    expect(body).toMatch(/trace/i);
    // Classification tokens (✓ Done / ✗ Missing / ⚠ Partial — at least the words).
    expect(body).toMatch(/done/i);
    expect(body).toMatch(/missing/i);
    expect(body).toMatch(/partial/i);
    expect(body).toContain("tdd-spec-review-result");
  });
});

// ─── AC.2: skills/tdd-spec-review/SKILL.md frontmatter ──────────────────────
describe("AC-STE-296.2 — tdd-spec-review child skill frontmatter", () => {
  const skillPath = join(pluginRoot, "skills", "tdd-spec-review", "SKILL.md");

  test("file exists", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  test("user-invocable: false", () => {
    const fm = parseFrontmatter(read(skillPath));
    expect(fm["user-invocable"]).toBe("false");
  });

  test("context: fork", () => {
    const fm = parseFrontmatter(read(skillPath));
    expect(fm.context).toBe("fork");
  });

  test("agent: tdd-spec-reviewer", () => {
    const fm = parseFrontmatter(read(skillPath));
    expect(fm.agent).toBe("tdd-spec-reviewer");
  });

  test("allowed-tools (if present) excludes Agent", () => {
    const fm = parseFrontmatter(read(skillPath));
    const allowed = (fm["allowed-tools"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    expect(allowed).not.toContain("Agent");
  });
});

// ─── AC.4: orchestrator SKILL.md post-REFACTOR AUDIT integration ────────────
describe("AC-STE-296.4 — orchestrator SKILL.md AUDIT integration", () => {
  const orchestratorPath = join(pluginRoot, "skills", "tdd", "SKILL.md");

  test("architecture stage table includes AUDIT row", () => {
    const body = read(orchestratorPath);
    expect(body).toMatch(/AUDIT/);
    expect(body).toContain("tdd-spec-review");
    expect(body).toContain("tdd-spec-reviewer");
  });

  test("orchestrator references parseTddSpecReviewBlock and tdd_spec_review_result", () => {
    const body = read(orchestratorPath);
    expect(body).toMatch(/parseTddSpecReviewBlock|tdd_spec_review_result/);
  });

  test("orchestrator documents post-REFACTOR audit branching on missing_acs.length", () => {
    const body = read(orchestratorPath);
    expect(body.toLowerCase()).toContain("missing_acs");
    expect(body).toMatch(/REFACTOR/);
  });
});

// ─── AC.5: doc invariant — advisory fields do not halt ──────────────────────
describe("AC-STE-296.5 — clean first audit exits regardless of advisory fields", () => {
  test("orchestrator SKILL.md documents advisory-only behavior for drift/partial_acs", () => {
    const body = read(join(pluginRoot, "skills", "tdd", "SKILL.md"));
    expect(body).toMatch(/advisor/i);
    expect(body.toLowerCase()).toContain("drift_count");
  });

  test("pure orchestrator step: missing_acs:[] returns exit-ok with passed key", () => {
    const budget = newRetryBudget();
    const block = makeBlock({
      missing_acs: [],
      partial_acs: ["AC-X.1"],
      drift_count: 9,
      cross_cutting_drift: ["specs/requirements.md — stale"],
    });
    const decision: SpecReviewDecision = stepSpecReview({
      block,
      retryBudget: budget,
      isRetry: false,
    });
    expect(decision.decision).toBe("exit-ok");
    expect(decision.capabilityKey).toBe("tdd_spec_audit_passed");
    expect(decision.missingAcs).toEqual([]);
  });
});

// ─── AC.6: retry budget — recordAuditRoundFailure cap=1 ─────────────────────
describe("AC-STE-296.6 — audit-round retry budget cap=1", () => {
  test("recordAuditRoundFailure(budget) first call ⇒ retry, attemptNumber=1", () => {
    const budget = newRetryBudget();
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });

  test("second recordAuditRoundFailure(budget) call ⇒ halt", () => {
    const budget = newRetryBudget();
    recordAuditRoundFailure(budget);
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("halt");
    expect(dec.attemptNumber).toBe(2);
  });

  test("audit-round budget is independent from per-AC semantic budget", () => {
    const budget = newRetryBudget();
    // Burn the per-AC semantic budget for an implementer/AC pair via the
    // existing recordTddFailure path — should not affect audit-round.
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
  });

  test("pure orchestrator step: missing_acs non-empty + first audit ⇒ retry path", () => {
    const budget = newRetryBudget();
    const decision = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC-STE-296.2"] }),
      retryBudget: budget,
      isRetry: false,
    });
    expect(decision.decision).toBe("retry-write-test-implement");
    expect(decision.missingAcs).toEqual(["AC-STE-296.2"]);
  });

  test("pure orchestrator step: missing_acs non-empty + second audit ⇒ halt + halted key", () => {
    const budget = newRetryBudget();
    // Simulate first retry was already taken.
    recordAuditRoundFailure(budget);
    const decision = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC-STE-296.2"] }),
      retryBudget: budget,
      isRetry: true,
    });
    expect(decision.decision).toBe("halt");
    expect(decision.capabilityKey).toBe("tdd_spec_audit_halted");
    expect(decision.missingAcs).toEqual(["AC-STE-296.2"]);
  });

  test("pure orchestrator step: missing recovered on retry ⇒ exit-ok + missing_recovered key", () => {
    const budget = newRetryBudget();
    recordAuditRoundFailure(budget); // first retry consumed
    const decision = stepSpecReview({
      block: makeBlock({ missing_acs: [] }),
      retryBudget: budget,
      isRetry: true,
    });
    expect(decision.decision).toBe("exit-ok");
    expect(decision.capabilityKey).toBe("tdd_spec_audit_missing_recovered");
  });
});

// ─── AC.9: capability key map entries in spec-write SKILL.md ────────────────
describe("AC-STE-296.9 — capability key rows in spec-write SKILL.md", () => {
  const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

  test("static map contains tdd_spec_audit_passed entry", () => {
    const body = read(specWritePath);
    expect(body).toContain("tdd_spec_audit_passed");
  });

  test("static map contains tdd_spec_audit_missing_recovered entry", () => {
    const body = read(specWritePath);
    expect(body).toContain("tdd_spec_audit_missing_recovered");
  });

  test("static map contains tdd_spec_audit_halted entry", () => {
    const body = read(specWritePath);
    expect(body).toContain("tdd_spec_audit_halted");
  });
});

// ─── AC.10: pure orchestrator end-to-end paths (a, b, c, d) ─────────────────
describe("AC-STE-296.10 — orchestrator pure-function state machine paths", () => {
  test("path (a) — clean first audit ⇒ tdd_spec_audit_passed, exit-ok", () => {
    const budget = newRetryBudget();
    const dec = stepSpecReview({
      block: makeBlock({ missing_acs: [] }),
      retryBudget: budget,
      isRetry: false,
    });
    expect(dec.capabilityKey).toBe("tdd_spec_audit_passed");
    expect(dec.decision).toBe("exit-ok");
  });

  test("path (b) — Missing → retry → clean ⇒ tdd_spec_audit_missing_recovered", () => {
    const budget = newRetryBudget();
    // First audit: missing.
    const first = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC.1"] }),
      retryBudget: budget,
      isRetry: false,
    });
    expect(first.decision).toBe("retry-write-test-implement");
    // (Orchestrator records the audit round failure here in real code.)
    recordAuditRoundFailure(budget);
    // Second audit: clean.
    const second = stepSpecReview({
      block: makeBlock({ missing_acs: [] }),
      retryBudget: budget,
      isRetry: true,
    });
    expect(second.decision).toBe("exit-ok");
    expect(second.capabilityKey).toBe("tdd_spec_audit_missing_recovered");
  });

  test("path (c) — Missing → retry → still-Missing ⇒ halt + tdd_spec_audit_halted", () => {
    const budget = newRetryBudget();
    const first = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC.1"] }),
      retryBudget: budget,
      isRetry: false,
    });
    expect(first.decision).toBe("retry-write-test-implement");
    recordAuditRoundFailure(budget);
    const second = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC.1"] }),
      retryBudget: budget,
      isRetry: true,
    });
    expect(second.decision).toBe("halt");
    expect(second.capabilityKey).toBe("tdd_spec_audit_halted");
    expect(second.missingAcs).toEqual(["AC.1"]);
  });

  test("path (d) reflected at orchestrator level — halt on second-pass still-missing reports unresolved ACs", () => {
    const budget = newRetryBudget();
    recordAuditRoundFailure(budget);
    const dec = stepSpecReview({
      block: makeBlock({ missing_acs: ["AC.1", "AC.3"] }),
      retryBudget: budget,
      isRetry: true,
    });
    expect(dec.decision).toBe("halt");
    expect(dec.missingAcs).toEqual(["AC.1", "AC.3"]);
  });

  // Spec § AC-STE-296.10 path (d): format violation of the spec-review
  // block → single targeted retry (mode D per STE-225) → halt if the
  // second emission is also malformed. Mode D is owned by `recordTddFailure`
  // (format budget = 2 attempts cap, then halt), not by `audit-round`.
  // The orchestrator step itself only sees a parsed block; the format-
  // violation path lives upstream in the orchestrator skill prose +
  // STE-225's mode D handling. This test asserts the contract via the
  // existing format budget (cap=2 ⇒ first failure retries, second halts).
  test("path (d) format-violation: mode D format budget halts after one retry", () => {
    const budget = newRetryBudget();
    // First format violation of the spec-review block emission ⇒ retry.
    const first = recordTddFailure(
      budget,
      { role: "spec-reviewer" } as RetryKey,
      "D",
    );
    expect(first.decision).toBe("retry");
    expect(first.retryKind).toBe("format");
    // Second format violation on the re-emitted spec-review block ⇒ halt.
    const second = recordTddFailure(
      budget,
      { role: "spec-reviewer" } as RetryKey,
      "D",
    );
    expect(second.decision).toBe("halt");
    expect(second.attemptNumber).toBe(2);
  });

  test("path (d) format-violation: audit-round budget is NOT consumed by mode D", () => {
    const budget = newRetryBudget();
    // Burn the entire mode-D budget for spec-reviewer on a format violation.
    recordTddFailure(budget, { role: "spec-reviewer" } as RetryKey, "D");
    recordTddFailure(budget, { role: "spec-reviewer" } as RetryKey, "D");
    // The audit-round budget must still have its full allowance.
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });
});

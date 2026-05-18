// STE-308 — structural assertions over the migrated /spec-review skill,
// the new `spec-reviewer` subagent, the new `spec-review-audit` child
// skill, and the allowlist updates that enable the new audit-fork pair.
//
// AC coverage by test block:
//   AC-STE-308.1 — `agents/spec-reviewer.md` frontmatter (tools / model /
//                  maxTurns) and audit-task prompt body.
//   AC-STE-308.2 — `skills/spec-review-audit/SKILL.md` frontmatter
//                  (context: fork / agent / user-invocable: false /
//                  allowed-tools excludes Agent / description names
//                  /spec-review as sole invoker).
//   AC-STE-308.4 — `skills/spec-review/SKILL.md` rewritten to dispatch
//                  the fork and parse the returned fenced block.
//   AC-STE-308.5 — /spec-review entry on AUDIT_FIX_LOOP_CANONICAL_LOOPS.
//   AC-STE-308.6 — `spec-review-audit` entry on
//                  NON_COMMIT_PRODUCING_SKILLS.
//   AC-STE-308.7 — `formatDriftHint` helper preserved unchanged
//                  (threshold >= 2, same literal line).
//   AC-STE-308.8 — integration smoke surface: structural fields
//                  preserved (AC count parsed, drift_count parsed,
//                  drift-hint line emitted at threshold).
//
// Pattern lineage: mirrors `gate-check-tdd-spec-reviewer-invariants.test.ts`
// and the audit-fix-loop pair tests; the spec-review fork is the
// second canonical pair (STE-296 introduced the first via the /tdd
// audit-fork pair).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_FIX_LOOP_CANONICAL_LOOPS,
} from "../adapters/_shared/src/audit_fix_loop_pattern";
import {
  NON_COMMIT_PRODUCING_SKILLS,
} from "../adapters/_shared/src/commit_producing_skill_branch_gate";
import {
  SPEC_REVIEW_DRIFT_HINT_THRESHOLD,
  formatDriftHint,
} from "../adapters/_shared/src/spec_review_drift_hint";
import {
  parseSpecReviewResultBlock,
} from "../adapters/_shared/src/spec_review_result";

const pluginRoot = join(import.meta.dir, "..");

const subagentPath = join(pluginRoot, "agents", "spec-reviewer.md");
const childSkillPath = join(
  pluginRoot,
  "skills",
  "spec-review-audit",
  "SKILL.md",
);
const mainSkillPath = join(pluginRoot, "skills", "spec-review", "SKILL.md");

function readIfExists(path: string): string {
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
}

function parseFrontmatter(body: string): Record<string, string> {
  const lines = body.split("\n");
  if (lines[0] !== "---") return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "---") break;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.1 — new subagent `agents/spec-reviewer.md`.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.1 — spec-reviewer subagent frontmatter + prompt body", () => {
  test("agents/spec-reviewer.md file exists", () => {
    expect(existsSync(subagentPath)).toBe(true);
  });

  test("frontmatter `tools` is exactly `Read, Grep, Glob` (read-only)", () => {
    const body = readIfExists(subagentPath);
    const fm = parseFrontmatter(body);
    expect(fm.tools).toBeDefined();
    const tools = (fm.tools ?? "").split(",").map((t) => t.trim());
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
    expect(tools).toContain("Glob");
    // Read-only — forbidden tools must not appear.
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Agent");
    expect(tools).not.toContain("WebFetch");
    expect(tools).not.toContain("WebSearch");
  });

  test("frontmatter `model: sonnet`", () => {
    const fm = parseFrontmatter(readIfExists(subagentPath));
    expect(fm.model).toBe("sonnet");
  });

  test("frontmatter `maxTurns: 8` (mirroring tdd-spec-reviewer)", () => {
    const fm = parseFrontmatter(readIfExists(subagentPath));
    expect(fm.maxTurns).toBe("8");
  });

  test("prompt body documents the audit task (read FRs, scan impl, traceability, classify, drift)", () => {
    const body = readIfExists(subagentPath);
    // The prompt body must commit to the audit task so the fork knows
    // what to do. Anchor on the four canonical steps the FR calls out.
    expect(body).toMatch(/specs\/frs/i);
    expect(body).toMatch(/traceability/i);
    expect(body).toMatch(/done|missing|partial/i);
    expect(body).toMatch(/drift/i);
  });

  test("prompt body names the fenced-block output contract", () => {
    const body = readIfExists(subagentPath);
    // The subagent must emit a `spec-review-result` fenced block —
    // prose has to name it so the LLM honors the contract.
    expect(body).toContain("spec-review-result");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.2 — new child skill `skills/spec-review-audit/SKILL.md`.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.2 — spec-review-audit child skill frontmatter", () => {
  test("skills/spec-review-audit/SKILL.md file exists", () => {
    expect(existsSync(childSkillPath)).toBe(true);
  });

  test("frontmatter `context: fork`", () => {
    const fm = parseFrontmatter(readIfExists(childSkillPath));
    expect(fm.context).toBe("fork");
  });

  test("frontmatter `agent: spec-reviewer` (resolves to the new subagent)", () => {
    const fm = parseFrontmatter(readIfExists(childSkillPath));
    expect(fm.agent).toBe("spec-reviewer");
  });

  test("frontmatter `user-invocable: false`", () => {
    const fm = parseFrontmatter(readIfExists(childSkillPath));
    expect(fm["user-invocable"]).toBe("false");
  });

  test("frontmatter `allowed-tools:` (when present) excludes `Agent`", () => {
    const fm = parseFrontmatter(readIfExists(childSkillPath));
    if (fm["allowed-tools"] === undefined) {
      // allowed-tools is optional — absent is fine per AC-STE-308.2.
      return;
    }
    const allowed = fm["allowed-tools"].split(",").map((t) => t.trim());
    expect(allowed).not.toContain("Agent");
  });

  test("description names /spec-review as the sole invoker (do not invoke directly)", () => {
    const fm = parseFrontmatter(readIfExists(childSkillPath));
    const desc = fm.description ?? "";
    // Mirror the "do not invoke directly" pattern from tdd-spec-review's
    // description — the prose must name /spec-review and signal that
    // direct invocation is not the intended entry point.
    expect(desc).toMatch(/spec-review/i);
    expect(desc).toMatch(/do not invoke directly|sole invoker|exclusively|only invoker/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.4 — main `/spec-review` SKILL.md rewritten to dispatch
// into the fork and parse the returned fenced block.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.4 — /spec-review SKILL.md dispatches the fork", () => {
  test("SKILL.md references `spec-review-audit` (the dispatched child skill)", () => {
    const body = readIfExists(mainSkillPath);
    expect(body).toContain("spec-review-audit");
  });

  test("SKILL.md references the parser `parseSpecReviewResultBlock`", () => {
    const body = readIfExists(mainSkillPath);
    // The skill body must name the parser so the LLM knows to use it
    // (mirrors how /spec-review names formatDriftHint today for the
    // drift hint helper).
    expect(body).toMatch(/parseSpecReviewResultBlock|spec_review_result/);
  });

  test("SKILL.md preserves tracker-mode probe step (existing § 0 logic)", () => {
    const body = readIfExists(mainSkillPath);
    // The migration must not lose the tracker-mode probe gate.
    expect(body).toMatch(/Tracker[-\s]mode probe|## Task Tracking|tracker mode/i);
  });

  test("SKILL.md documents the bounded-retry / halt-on-format-violation contract", () => {
    const body = readIfExists(mainSkillPath);
    // Single bounded retry per STE-296 mode-D pattern, then halt with
    // NFR-10 canonical refusal. Prose must commit to this so the LLM
    // doesn't loop forever on a malformed fenced block.
    expect(body).toMatch(/bounded retry|single retry|one retry/i);
    expect(body).toMatch(/halt|NFR-10|refusal/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.5 — /spec-review entry on AUDIT_FIX_LOOP_CANONICAL_LOOPS.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.5 — /spec-review entry on the audit-fix-loop allowlist", () => {
  test("AUDIT_FIX_LOOP_CANONICAL_LOOPS contains the /spec-review audit-fork entry", () => {
    const entry = AUDIT_FIX_LOOP_CANONICAL_LOOPS.find(
      (e) => e.orchestrator === "spec-review",
    );
    expect(entry).toBeDefined();
    expect(entry!.child).toBe("spec-review-audit");
    expect(entry!.subagent).toBe("spec-reviewer");
  });

  test("the /tdd audit-fork entry still ships alongside (no regression)", () => {
    const pairs = AUDIT_FIX_LOOP_CANONICAL_LOOPS.map(
      (e) => `${e.orchestrator}::${e.child}::${e.subagent}`,
    );
    expect(pairs).toContain("tdd::tdd-spec-review::tdd-spec-reviewer");
    expect(pairs).toContain("spec-review::spec-review-audit::spec-reviewer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.6 — spec-review-audit on NON_COMMIT_PRODUCING_SKILLS.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.6 — spec-review-audit on NON_COMMIT_PRODUCING_SKILLS allowlist", () => {
  test("NON_COMMIT_PRODUCING_SKILLS contains `spec-review-audit`", () => {
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("spec-review-audit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.7 — formatDriftHint preserved unchanged (threshold >= 2,
// same literal line).
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.7 — formatDriftHint contract preserved", () => {
  test("threshold constant still 2", () => {
    expect(SPEC_REVIEW_DRIFT_HINT_THRESHOLD).toBe(2);
  });

  test("formatDriftHint(2) returns the canonical literal line", () => {
    expect(formatDriftHint(2)).toBe(
      "Live-spec refresh suggested — 2 drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    );
  });

  test("formatDriftHint(0) / (1) returns null (threshold preserved)", () => {
    expect(formatDriftHint(0)).toBeNull();
    expect(formatDriftHint(1)).toBeNull();
  });

  test("/spec-review SKILL.md still references the helper module", () => {
    const body = readIfExists(mainSkillPath);
    // After migration the helper still lives in main (per FR § Notes:
    // "the audit fork emits the count, main emits the line"). The
    // SKILL.md must continue to name it so the conformance link is
    // testable.
    expect(body).toMatch(/spec_review_drift_hint|formatDriftHint/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.8 — integration smoke: fenced block round-trips through
// the parser, structural fields (AC count, drift_count, drift-hint line
// at threshold) are all preserved.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.8 — integration smoke: fenced-block fixture preserves structural fields", () => {
  // Simulated audit-fork output. The fork emits this; main parses it
  // and renders the user-facing report.
  const fixtureBlock = [
    "```spec-review-result",
    "role: spec-reviewer",
    "",
    "## Traceability map",
    "- ac: AC-STE-308.1, impl: agents/spec-reviewer.md:1, test: tests/spec-review-fork-migration.test.ts:80, status: done",
    "- ac: AC-STE-308.2, impl: skills/spec-review-audit/SKILL.md:1, test: tests/spec-review-fork-migration.test.ts:130, status: done",
    "- ac: AC-STE-308.3, impl: adapters/_shared/src/spec_review_result.ts:1, test: tests/spec-review-result-parser.test.ts:1, status: done",
    "",
    "## Findings",
    "- AC-STE-308.1 — traced cleanly",
    "- AC-STE-308.2 — traced cleanly",
    "- AC-STE-308.3 — traced cleanly",
    "",
    "## Drift hints",
    "- specs/requirements.md:120 — stale ref to deleted FR",
    "- specs/technical-spec.md:55 — orphan section heading",
    "```",
  ].join("\n");

  test("AC count parsed (3 traceability rows)", () => {
    const r = parseSpecReviewResultBlock(fixtureBlock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.traceability.length).toBe(3);
  });

  test("drift_count parsed (2 drift entries)", () => {
    const r = parseSpecReviewResultBlock(fixtureBlock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.drift_count).toBe(2);
  });

  test("drift-hint line present at threshold (drift_count == 2 ⇒ emit)", () => {
    const r = parseSpecReviewResultBlock(fixtureBlock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hint = formatDriftHint(r.block.drift_count);
    expect(hint).not.toBeNull();
    expect(hint).toContain("2 drift(s)");
  });

  test("every traceability row has the required fields", () => {
    const r = parseSpecReviewResultBlock(fixtureBlock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const row of r.block.traceability) {
      expect(typeof row.ac).toBe("string");
      expect(row.ac).toMatch(/^AC-/);
      // impl / test can be null per the schema, but must be present.
      expect("impl" in row).toBe(true);
      expect("test" in row).toBe(true);
      expect(["done", "missing", "partial"]).toContain(row.status);
    }
  });
});

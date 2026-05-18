// Doc-conformance tests for STE-306 — Audit-fix loop pattern doc.
//
// Asserts that `docs/patterns.md` carries a new "Audit-fix loop" section with
// stable anchor {#pattern-audit-fix-loop}, enumerates the four current loops
// (`/tdd`, `/spec-review`, `/implement` Phase 3 Stage B, `/simplify`) with
// canonical/legacy classification, references the canonical precedents
// (STE-225, STE-296) and the superseded ancestor (HG95VF), documents the
// in-process-fix exception for `/implement` Stage B, and that at least one
// existing skill file cross-references the new anchor.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const patternsPath = join(pluginRoot, "docs", "patterns.md");
const skillsDir = join(pluginRoot, "skills");

function readPatterns(): string {
  return readFileSync(patternsPath, "utf8");
}

// Slice the body of the audit-fix-loop section: from its heading line through
// the next top-level `## ` heading (exclusive). Returns the full body remaining
// at end-of-file if no later heading exists. The section must exist for the
// slice to be meaningful, so callers should assert anchor presence first.
function sliceAuditFixLoopSection(body: string): string {
  const anchorIdx = body.indexOf("{#pattern-audit-fix-loop}");
  if (anchorIdx === -1) return "";
  // Walk back to the start of the heading line that carries the anchor.
  const lineStart = body.lastIndexOf("\n", anchorIdx) + 1;
  // Find the next top-level `## ` heading after this section.
  const rest = body.slice(lineStart);
  // Match the next `\n## ` (not `\n### `) — section ends there.
  const nextSectionMatch = rest.slice(1).match(/\n## /);
  if (!nextSectionMatch || nextSectionMatch.index === undefined) {
    return rest;
  }
  return rest.slice(0, 1 + nextSectionMatch.index);
}

describe("AC-STE-306.1 — Audit-fix loop section + stable anchor", () => {
  test("docs/patterns.md contains the {#pattern-audit-fix-loop} anchor exactly once", () => {
    const body = readPatterns();
    const matches = body.match(/\{#pattern-audit-fix-loop\}/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("anchor lives on a heading line whose title contains 'Audit-fix loop'", () => {
    const body = readPatterns();
    const anchorIdx = body.indexOf("{#pattern-audit-fix-loop}");
    expect(anchorIdx).toBeGreaterThan(-1);
    const lineStart = body.lastIndexOf("\n", anchorIdx) + 1;
    const lineEnd = body.indexOf("\n", anchorIdx);
    const headingLine = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd);
    // Heading marker (## or ###) at line start.
    expect(headingLine).toMatch(/^#{2,3}\s+/);
    expect(headingLine.toLowerCase()).toContain("audit-fix loop");
  });

  test("section body describes the canonical shape end-to-end", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    expect(section.length).toBeGreaterThan(0);
    // Canonical-shape tokens (anchor concepts of the pattern).
    expect(section).toContain("orchestrator");
    expect(section).toMatch(/Skill tool|Skill\(\)|skill tool/);
    expect(section).toMatch(/context:\s*fork|forked child/);
    expect(section).toMatch(/read-only subagent|read-only sub-agent/);
    expect(section).toMatch(/result/); // fenced `<role>-result` block reference
    // The orchestrator either dispatches a fix into another fork OR halts.
    expect(section.toLowerCase()).toMatch(/another fork|second fork|fix fork/);
    expect(section.toLowerCase()).toContain("halt");
  });
});

describe("AC-STE-306.2 — Four current loops enumerated and classified", () => {
  test("section names the four current loops", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    expect(section).toContain("/tdd");
    expect(section).toContain("/spec-review");
    expect(section).toContain("/implement");
    expect(section).toContain("/simplify");
  });

  test("section uses at least one of the three classification tags", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    // The FR lists three classes: canonical / legacy (in-process fix) /
    // legacy (no fork at all). At least one of "canonical" or "legacy"
    // must appear in the section.
    expect(section.toLowerCase()).toMatch(/\bcanonical\b|\blegacy\b/);
  });

  test("section classifies each loop — every loop name co-occurs with a tag in its row", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    const sectionLower = section.toLowerCase();
    // Each of the four loop names appears in a context with at least one
    // classification tag in the surrounding 200 characters. This is a
    // proximity check, not a strict table-parse — it tolerates table or
    // list rendering.
    const loops = ["/tdd", "/spec-review", "/implement", "/simplify"];
    for (const loop of loops) {
      const idx = sectionLower.indexOf(loop);
      expect(idx).toBeGreaterThan(-1);
      const windowStart = Math.max(0, idx - 200);
      const windowEnd = Math.min(sectionLower.length, idx + loop.length + 200);
      const windowSlice = sectionLower.slice(windowStart, windowEnd);
      expect(windowSlice).toMatch(/canonical|legacy/);
    }
  });
});

describe("AC-STE-306.3 — Precedent + supersession cross-references", () => {
  test("section references the superseded ancestor HG95VF", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    expect(section).toContain("HG95VF");
  });

  test("section references the canonical precedent STE-225", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    expect(section).toContain("STE-225");
  });

  test("section references the canonical precedent STE-296", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    expect(section).toContain("STE-296");
  });
});

describe("AC-STE-306.4 — In-process-fix exception documented", () => {
  test("section flags `/implement` Stage B as the in-process-fix exception", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    // The exception must be explicitly tied to `/implement` Stage B.
    expect(section).toContain("/implement");
    expect(section).toMatch(/Stage B|stage B|stage-B/i);
  });

  test("exception rationale cites the nested-spawn constraint", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    // Rationale token: Claude Code forbids nested subagent spawns.
    expect(section).toMatch(/nested (subagent |sub-agent |)spawn|nested spawn/i);
  });

  test("exception rationale cites the orchestrator-context requirement", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    // Rationale: fixer needs the orchestrator's full implementation context.
    expect(section.toLowerCase()).toMatch(/full (implementation |orchestrator |)context|orchestrator's (full |)context/);
  });

  test("exception documents the future-migration path", () => {
    const body = readPatterns();
    const section = sliceAuditFixLoopSection(body);
    // Migration target: M82+ (deferred), mirroring /tdd's decomposed shape.
    expect(section).toMatch(/M82/);
    expect(section.toLowerCase()).toMatch(/migrat|future|deferred/);
  });
});

describe("AC-STE-306.5 — At least one skill file cross-references the new anchor", () => {
  test("some plugin skill SKILL.md links to {#pattern-audit-fix-loop}", () => {
    const entries = readdirSync(skillsDir);
    const skillFiles: string[] = [];
    for (const entry of entries) {
      const dirPath = join(skillsDir, entry);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch {
        continue;
      }
      const skillMd = join(dirPath, "SKILL.md");
      try {
        const body = readFileSync(skillMd, "utf8");
        skillFiles.push(body);
      } catch {
        // Some skill dirs may lack SKILL.md mid-refactor; skip silently.
      }
    }
    expect(skillFiles.length).toBeGreaterThan(0);
    const anyReferences = skillFiles.some(
      (body) =>
        body.includes("#pattern-audit-fix-loop") ||
        body.includes("pattern-audit-fix-loop"),
    );
    expect(anyReferences).toBe(true);
  });
});

// Meta-tests for STE-826 (M_d1e7b1) — the spec-review auditors state only
// tree facts they checked.
//
//   - AC-STE-826.1: agents/spec-reviewer.md says a claim that a file exists,
//     is absent, or was deleted names the Read or Glob call that observed it,
//     and a claim with no such call is left out.
//   - AC-STE-826.2: agents/tdd-spec-reviewer.md carries the same rule.
//   - AC-STE-826.3: skills/spec-review/SKILL.md re-checks each file-existence
//     claim in the audit result against the tree (a Glob per claimed path)
//     before it renders the report; a contradicted claim is dropped and the
//     report says so in one line.
//   - AC-STE-826.4 is the whole-suite gate, verified by the orchestrator.
//
// The rule must live in ONE paragraph or list item, so the parts of it read
// together; a word scattered across the file does not satisfy it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const read = (...p: string[]): string =>
  readFileSync(join(pluginRoot, ...p), "utf8");

const specReviewerBody = read("agents", "spec-reviewer.md");
const tddSpecReviewerBody = read("agents", "tdd-spec-reviewer.md");
const specReviewSkillBody = read("skills", "spec-review", "SKILL.md");

// Split markdown into units: blank-line-separated paragraphs, and each list
// item (with its indented continuation lines) as a unit of its own.
function units(body: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const lines = body.split("\n");
  let cur: string[] = [];
  let curStart = 0;
  let pos = 0;
  const flush = () => {
    if (cur.join("").trim() !== "") {
      out.push({ text: cur.join("\n"), offset: curStart });
    }
    cur = [];
  };
  for (const line of lines) {
    const isBlank = line.trim() === "";
    const isItem = /^\s*(?:[-*]|\d+\.|[a-z]\.)\s/.test(line);
    if (isBlank) {
      flush();
    } else {
      if (isItem) flush();
      if (cur.length === 0) curStart = pos;
      cur.push(line);
    }
    pos += line.length + 1;
  }
  flush();
  return out;
}

const EXISTS = /\bexists?\b/i;
const ABSENT = /\babsent\b/i;
const DELETED = /\bdeleted\b/i;
const READ_CALL = /\bRead\b/;
const GLOB_CALL = /\bGlob\b/;
const CITES_CALL = /\b(?:names?|cites?)\b[^\n]{0,80}\b(?:Read|Glob)\b/;
const OBSERVED = /\bobserved\b/i;
const LEFT_OUT = /\bleft out\b/i;

// The unit that states the file-existence citation rule: it speaks of a file
// existing, being absent and being deleted, and names Read and Glob.
function citationRule(body: string): string | undefined {
  return units(body).find(
    (u) =>
      EXISTS.test(u.text) &&
      ABSENT.test(u.text) &&
      DELETED.test(u.text) &&
      READ_CALL.test(u.text) &&
      GLOB_CALL.test(u.text),
  )?.text;
}

function describeCitationRule(label: string, body: string, acId: string) {
  describe(`${acId} — ${label} backs every file-existence claim with a call`, () => {
    test("one paragraph covers a file that exists, is absent, or was deleted, and names Read and Glob", () => {
      expect(citationRule(body)).toBeString();
    });

    test("the rule says the claim names the Read or Glob call", () => {
      expect(citationRule(body) ?? "").toMatch(CITES_CALL);
    });

    test("the rule says the call is the one that observed the file", () => {
      expect(citationRule(body) ?? "").toMatch(OBSERVED);
    });

    test("the rule says a claim with no such call is left out", () => {
      expect(citationRule(body) ?? "").toMatch(LEFT_OUT);
    });
  });
}

// -----------------------------------------------------------------------------
// AC-STE-826.1 / AC-STE-826.2 — the two auditor agents
// -----------------------------------------------------------------------------

describeCitationRule("agents/spec-reviewer.md", specReviewerBody, "AC-STE-826.1");
describeCitationRule(
  "agents/tdd-spec-reviewer.md",
  tddSpecReviewerBody,
  "AC-STE-826.2",
);

// -----------------------------------------------------------------------------
// AC-STE-826.3 — /spec-review re-checks the claims before rendering
// -----------------------------------------------------------------------------

const FILE_EXISTENCE_CLAIM = /\bfile-existence claims?\b/i;

function recheckRule(): { text: string; offset: number } | undefined {
  return units(specReviewSkillBody).find(
    (u) =>
      FILE_EXISTENCE_CLAIM.test(u.text) &&
      GLOB_CALL.test(u.text) &&
      /\bcontradicted\b/i.test(u.text),
  );
}

describe("AC-STE-826.3 — /spec-review re-checks file-existence claims against the tree", () => {
  test("one paragraph re-checks each file-existence claim with a Glob and handles a contradicted one", () => {
    expect(recheckRule()).toBeDefined();
  });

  test("the re-check covers each claim in the audit result", () => {
    expect(recheckRule()?.text ?? "").toMatch(
      /\beach file-existence claim\b/i,
    );
  });

  test("a contradicted claim is dropped", () => {
    expect(recheckRule()?.text ?? "").toMatch(
      /\bcontradicted claim\b[^\n]{0,80}\bdropped\b/i,
    );
  });

  test("the report says so in one line", () => {
    expect(recheckRule()?.text ?? "").toMatch(/\bone line\b/i);
  });

  test("the re-check sits before the report is rendered", () => {
    // The first rendered part of the report is the traceability map (4a).
    const renderAt = specReviewSkillBody.search(
      /^\s*a\. \*\*Traceability map\*\*/m,
    );
    expect(renderAt).toBeGreaterThan(-1);
    const rule = recheckRule();
    expect(rule).toBeDefined();
    expect(rule?.offset ?? Number.MAX_SAFE_INTEGER).toBeLessThan(renderAt);
  });

  test("the skill keeps Glob in its allowed tools so the re-check can run", () => {
    const fm = specReviewSkillBody.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm?.[1] ?? "").toMatch(/^allowed-tools:[^\n]*\bGlob\b/m);
  });
});

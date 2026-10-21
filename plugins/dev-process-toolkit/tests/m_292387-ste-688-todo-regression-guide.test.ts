// M_292387 / STE-688 — "The bug FR guide says a TODO regression fails probe 88".
//
// WHAT THE IMPLEMENTER WRITES.
//
//   docs/resolver-entry.md § Bug FR body — beside the existing rule ("Every bug
//   FR carries at least one AC whose body begins `Regression:` and names the
//   test ..."), a sentence stating that a `Regression:` criterion with no body,
//   or with only a TODO marker, fails probe #88 until a test is named.
//
// Filter by AC with `bun test -t "AC-STE-688"`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const RESOLVER_ENTRY = join(PLUGIN_ROOT, "docs", "resolver-entry.md");

/** The `## Bug FR body` section, heading excluded, up to the next `## ` heading. */
function bugFrBodySection(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^## Bug FR body\b/.test(l));
  if (start < 0) return "";
  let end = lines.length;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^```/.test(lines[i]!)) inFence = !inFence;
    if (!inFence && /^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** Prose paragraphs of a section, with fenced code blocks removed. */
function proseParagraphs(section: string): string[] {
  const noFences = section.replace(/^```[\s\S]*?^```[^\n]*$/gm, "");
  return noFences
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const EXISTING_RULE = /Every bug FR carries at least one AC whose body begins `Regression:`/;

function namesTodoFailure(p: string): boolean {
  return (
    /`Regression:`/.test(p) &&
    /\bTODO\b/.test(p) &&
    /probe #88/.test(p) &&
    /\bfails?\b/.test(p) &&
    /\b(no body|empty)\b/i.test(p) &&
    /\buntil\b[^.]*\btest\b/i.test(p)
  );
}

describe("AC-STE-688.1 / AC-STE-688.2 — resolver-entry.md § Bug FR body", () => {
  const md = readFileSync(RESOLVER_ENTRY, "utf8");
  const section = bugFrBodySection(md);
  const paragraphs = proseParagraphs(section);
  const ruleIdx = paragraphs.findIndex((p) => EXISTING_RULE.test(p));

  test("control: the section and its existing Regression: rule are found", () => {
    expect(section.length).toBeGreaterThan(0);
    expect(ruleIdx).toBeGreaterThanOrEqual(0);
  });

  test("the bug FR body section names the TODO regression failure", () => {
    expect(ruleIdx).toBeGreaterThanOrEqual(0);
    // "Beside the existing rule": in the rule's own paragraph or the one
    // directly after it.
    const beside = paragraphs.slice(ruleIdx, ruleIdx + 2);
    const verdicts = beside.map((p) => ({ paragraph: p, namesTodoFailure: namesTodoFailure(p) }));
    expect(verdicts.some((v) => v.namesTodoFailure)).toBe(true);
  });

  test("control: the matcher rejects the current rule sentence on its own", () => {
    const rule = paragraphs[ruleIdx] ?? "";
    const ruleSentenceOnly = rule.split(/(?<=\.)\s+/)[0] ?? "";
    expect(namesTodoFailure(ruleSentenceOnly)).toBe(false);
  });
});

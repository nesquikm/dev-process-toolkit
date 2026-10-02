// STE-657 — prose pins for the codename composed at spec time.
//
// AC-STE-657.4: the plan template carries `codename:` directly after `migration:`,
//               with a comment naming the four rules and the front door.
// AC-STE-657.5: /spec-write's plan.md section says the title and codename are
//               composed from the approved design, never asked, and that the
//               composed codename passes the front door before the plan is written.
// AC-STE-657.6: that section asks for neither — and the detector goes red on a
//               planted name-asking line (control).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const TEMPLATE = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");
const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

function frontmatterLines(raw: string): string[] {
  const lines = raw.split("\n");
  expect(lines[0]).toBe("---");
  const close = lines.indexOf("---", 1);
  expect(close).toBeGreaterThan(0);
  return lines.slice(1, close);
}

/** The `#### plan.md` subsection, up to the next `###`/`####` heading. */
function planSection(raw: string): string {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^#### plan\.md\b/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,4} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const ASK = /AskUserQuestion|\bask(?:s|ed|ing)?\b|\bprompt(?:s|ed|ing)?\b(?! body)|\bquestion\b/i;
const SUBJECT = /\bcodename\b|\bmilestone (?:title|name)\b|\brelease name\b|\bwhat to call\b/i;
const NEGATED = /\bnever\b|\bnot\b|\bwithout\b|\bno\b|\bnor\b/i;

/** Sentences in `section` that instruct asking for the milestone title or codename. */
function nameAskingSentences(section: string): string[] {
  return section
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => ASK.test(s) && SUBJECT.test(s) && !NEGATED.test(s));
}

describe("AC-STE-657.4 plan template codename line", () => {
  const fm = frontmatterLines(readFileSync(TEMPLATE, "utf8"));

  test("codename: sits directly after migration:", () => {
    const mig = fm.findIndex((l) => /^migration:/.test(l));
    expect(mig).toBeGreaterThanOrEqual(0);
    expect(fm[mig + 1]).toMatch(/^codename:/);
  });

  test("its comment names the four rules and the front door", () => {
    const idx = fm.findIndex((l) => /^codename:/.test(l));
    expect(idx).toBeGreaterThanOrEqual(0);
    const line = fm[idx]!;
    const hash = line.indexOf("#");
    expect(hash).toBeGreaterThan(0);
    const comment = line.slice(hash);
    expect(comment).toMatch(/trimmed|non-empty/i);
    expect(comment).toMatch(/\b32\b/);
    expect(comment).toMatch(/backtick/i);
    expect(comment).toMatch(/line break/i);
    expect(comment).toContain("milestone_codename.ts");
  });
});

describe("AC-STE-657.5 /spec-write plan.md section composes, never asks", () => {
  const section = planSection(readFileSync(SPEC_WRITE, "utf8"));
  const paragraphs = section.split(/\n\s*\n/);
  const para = paragraphs.find((p) => /\bcodename\b/i.test(p) && /milestone_codename\.ts/.test(p));

  test("one paragraph carries the codename rule and names the front door", () => {
    expect(para).toBeDefined();
  });

  test("it says title and codename are composed from the approved design", () => {
    expect(para ?? "").toMatch(/\btitle\b/i);
    expect(para ?? "").toMatch(/compos(?:e|ed|es|ing)\b/i);
    expect(para ?? "").toMatch(/approved design/i);
  });

  test("it says neither is ever asked", () => {
    expect(para ?? "").toMatch(/never ask(?:ed|s)?\b/i);
  });

  test("it says the composed codename passes the front door before the plan file is written", () => {
    expect(para ?? "").toMatch(/before[^.]*\bplan file\b[^.]*\bwritten\b/i);
  });

  test("the check is the RUNNABLE front door, and the rules are not restated", () => {
    // Phase 3 review: the plan-path door cannot check a value no plan holds yet,
    // so the paragraph runs `--check`; the four rules live in validateCodename only.
    expect(para ?? "").toContain("bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/milestone_codename.ts --check");
    expect(para ?? "").not.toMatch(/at most 32 characters/);
  });
});

describe("AC-STE-657.6 no name-asking instruction in the plan.md section", () => {
  const section = planSection(readFileSync(SPEC_WRITE, "utf8"));

  test("the shipped section asks for neither the milestone title nor the codename", () => {
    expect(nameAskingSentences(section)).toEqual([]);
  });

  test("the section carries the codename paragraph the detector must not mistake for an ask", () => {
    // Without this the green above could be vacuous: a section that never mentions
    // the codename has nothing for the detector to judge.
    expect(section).toMatch(/\bcodename\b/i);
  });

  const planted = [
    "Ask the user what codename the release should carry.",
    "Use `AskUserQuestion` to ask for the milestone title.",
    "Prompt the operator for the codename before writing the plan.",
  ];

  for (const line of planted) {
    test(`control: goes red when a name-asking line is planted — ${line}`, () => {
      const mutated = section.replace(/\n\nFirst, break the requirements/, `\n\n${line}\n\nFirst, break the requirements`);
      expect(mutated).not.toBe(section);
      expect(nameAskingSentences(mutated)).toContain(line);
    });
  }
});

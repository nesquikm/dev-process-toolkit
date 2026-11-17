// Meta-tests for STE-745 (M_d1e7b1) — the /implement report fits its caps, and
// smoke fixture 15a grades the whole report.
//
//   - AC-STE-745.1: skills/implement/SKILL.md step 14 and
//     docs/implement-reference.md state the lead-in budget (at most three
//     sentences, each at most PLAIN_SENTENCE_WORD_CAP (20) words, inside the
//     whole-report line cap) and give ONE literal lead-in template whose every
//     sentence fits the cap.
//   - AC-STE-745.2: a committed model report built from the template, with both
//     cap-exempt sections and the fence, exits 0 from
//     `stage_block_adoption.ts --report`; the same report with a 23-word
//     lead-in sentence exits 1 and names the sentence cap.
//   - AC-STE-745.3: smoke sub-fixture 15a's **Source** names the whole final
//     assistant message of the /implement capture as the subject; the old
//     "from the last `stage-status-block` fence opener's paragraph onward"
//     phrase is gone.
//   - AC-STE-745.4: a committed /implement capture fixture, extracted by the
//     new 15a rule, yields a subject that exits 0; the old cut of the same
//     capture drops a cap-exempt section.
//   - AC-STE-745.5 is the whole-suite gate, verified by the orchestrator.
//
// THE CONTRACT THESE TESTS PIN, so the implementer has nothing to guess:
//
//   * The template is a fenced block opened by ```` ```implement-lead-in ````
//     (leading indentation allowed, so it can sit inside the step-14 list
//     item). Its body is the literal lead-in; `<...>` marks a placeholder.
//     The SAME body (after stripping indentation) appears in SKILL.md step 14
//     and in docs/implement-reference.md.
//   * Model report: tests/fixtures/stage-block-adoption/implement-lead-in-report.txt
//     — everything above its `stage-status-block` fence opener is the
//     template with each placeholder filled in.
//   * Capture: tests/fixtures/smoke-child-capture/implement-final-report.ndjson
//     — a stream-json capture with at least two assistant messages carrying
//     text; the LAST one is the healthy closing report (lead-in, fence, both
//     cap-exempt sections). A message is the set of assistant events sharing
//     one `message.id` (an event without an id is a message of its own).
//
// Assertions are phrase/token literals; they never require STE-/AC- tokens in
// skills/** prose.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  longSentences,
  PLAIN_SENTENCE_WORD_CAP,
} from "../adapters/_shared/src/plain_sentences";
import { extractAssistantText } from "../adapters/_shared/src/smoke_child_capture";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const MODULE = join(pluginRoot, "adapters", "_shared", "src", "stage_block_adoption.ts");
const SKILL_PATH = join(pluginRoot, "skills", "implement", "SKILL.md");
const REFERENCE_PATH = join(pluginRoot, "docs", "implement-reference.md");
const SMOKE_PATH = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const MODEL_REPORT_PATH = join(
  pluginRoot,
  "tests",
  "fixtures",
  "stage-block-adoption",
  "implement-lead-in-report.txt",
);
const CAPTURE_PATH = join(
  pluginRoot,
  "tests",
  "fixtures",
  "smoke-child-capture",
  "implement-final-report.ndjson",
);

const FENCE_OPENER_RE = /^[ \t]*```stage-status-block[ \t]*$/;
const EXEMPT_SECTIONS = ["## Verification evidence", "## Advisory notes"];

const scratch = mkdtempSync(join(tmpdir(), "ste-745-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// The step-14 item of skills/implement/SKILL.md: from the `14. **Report**`
// line up to the next numbered step. The end is searched for only PAST the
// start line, so the start line can never match as its own end.
function step14(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^14\.\s+\*\*Report\*\*/.test(l));
  expect(start, "SKILL.md has a `14. **Report**` step").toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\d+\.\s+\*\*/.test(lines[i]!) || /^#{1,6}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// A heading-bounded section: from the heading line matching `start` up to the
// next heading of the same or a higher level, searched for past the start
// heading's own line.
function headingSection(body: string, start: RegExp): string {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => start.test(l));
  expect(idx, `heading ${start} exists`).toBeGreaterThanOrEqual(0);
  const level = /^(#+)/.exec(lines[idx]!)![1]!.length;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]!);
    if (m !== null && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(idx, end).join("\n");
}

// The template in `text`: the body of the ONE ```implement-lead-in fence,
// indentation stripped — or, on /implement's step 14, the ONE inline span after
// "Lead-in template:". Fails when there is none, or more than one.
// Amended by AC-STE-745.1 (M_d1e7b1): /implement/SKILL.md sits at NFR-1's 358
// cap and step 14 is one paragraph, so the skill carries the template inline;
// the reference doc keeps the fence. The template's text is compared either way.
function leadInTemplate(text: string, where: string): string[] {
  const inline = [...text.matchAll(/Lead-in template: `([^`]+)`/g)];
  if (inline.length > 0 && !/```implement-lead-in/.test(text)) {
    expect(inline.length, `${where} carries exactly one inline lead-in template`).toBe(1);
    return [inline[0]![1]!.trim()];
  }
  const lines = text.split("\n");
  const openers = lines
    .map((l, i) => (/^[ \t]*```implement-lead-in[ \t]*$/.test(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(openers.length, `${where} carries exactly one implement-lead-in fence`).toBe(1);
  const open = openers[0]!;
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (/^[ \t]*```[ \t]*$/.test(lines[i]!)) {
      close = i;
      break;
    }
  }
  expect(close, `${where}'s implement-lead-in fence is closed`).toBeGreaterThan(open);
  const body = lines
    .slice(open + 1, close)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  expect(body.length, `${where}'s template is not empty`).toBeGreaterThan(0);
  return body;
}

// Sentences in `lines` by the plain-sentence contract: a terminator as a
// token's last character ends one, and so does the end of the text.
function sentenceCount(lines: readonly string[]): number {
  let count = 0;
  let open = false;
  for (const token of lines.join(" ").split(/\s+/)) {
    if (token === "") continue;
    open = true;
    if ([".", "!", "?", ";"].includes(token[token.length - 1]!)) {
      count += 1;
      open = false;
    }
  }
  return count + (open ? 1 : 0);
}

function runReport(path: string): { code: number; out: string } {
  const proc = Bun.spawnSync(["bun", MODULE, "--report", path], {
    cwd: pluginRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    out: proc.stdout.toString() + proc.stderr.toString(),
  };
}

function writeScratch(name: string, body: string): string {
  const path = join(scratch, name);
  writeFileSync(path, body);
  return path;
}

// Index of the LAST stage-status-block fence opener in `lines`.
function lastFenceOpener(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FENCE_OPENER_RE.test(lines[i]!)) return i;
  }
  return -1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The template as a whole-text matcher: literal text, `<...>` matches any
// non-empty filling, any whitespace run matches any whitespace run.
function templateMatcher(template: readonly string[]): RegExp {
  const joined = template.join(" ");
  const parts = joined.split(/(<[^>]+>)/);
  const src = parts
    .map((p) =>
      /^<[^>]+>$/.test(p)
        ? ".+?"
        : escapeRe(p).replace(/\s+/g, "\\s+"),
    )
    .join("");
  return new RegExp(`^${src}$`, "s");
}

// --- the new and the old 15a cuts ------------------------------------------

// NEW rule: the whole final assistant message. Messages are grouped by
// `message.id`; only messages carrying text count. extractAssistantText is
// run over that message's events alone.
function finalAssistantMessage(ndjson: string): { subject: string; messages: number } {
  const groups: { key: string; lines: string[] }[] = [];
  ndjson.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const e = event as { type?: unknown; message?: { id?: unknown } };
    if (e.type !== "assistant") return;
    if (extractAssistantText(line) === "") return;
    const key = typeof e.message?.id === "string" ? e.message.id : `line-${i}`;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.lines.push(line);
    else groups.push({ key, lines: [line] });
  });
  const final = groups[groups.length - 1];
  return {
    subject: final === undefined ? "" : extractAssistantText(final.lines.join("\n")),
    messages: groups.length,
  };
}

// OLD rule: the assistant text from the last fence opener's paragraph onward,
// through the closing marker of that fence.
function oldCut(ndjson: string): string {
  const lines = extractAssistantText(ndjson).split("\n");
  const opener = lastFenceOpener(lines);
  if (opener < 0) return "";
  let start = opener;
  while (start > 0 && lines[start - 1]!.trim() !== "") start--;
  let close = lines.length - 1;
  for (let i = opener + 1; i < lines.length; i++) {
    if (/^[ \t]*```[ \t]*$/.test(lines[i]!)) {
      close = i;
      break;
    }
  }
  return lines.slice(start, close + 1).join("\n");
}

// ---------------------------------------------------------------------------

describe("AC-STE-745.1 — step 14 and the reference state the lead-in budget and template", () => {
  const surfaces: [string, () => string][] = [
    ["skills/implement/SKILL.md step 14", () => step14(read(SKILL_PATH))],
    ["docs/implement-reference.md", () => read(REFERENCE_PATH)],
  ];

  for (const [where, text] of surfaces) {
    test(`${where} caps the lead-in at three sentences`, () => {
      expect(text()).toMatch(/at most three sentences/i);
    });

    test(`${where} caps each sentence at PLAIN_SENTENCE_WORD_CAP (20) words`, () => {
      const body = text();
      expect(body).toContain("PLAIN_SENTENCE_WORD_CAP");
      expect(body).toMatch(/\b20\b[- ]words?/);
    });

    test(`${where} places the budget inside the whole-report line cap`, () => {
      expect(text()).toMatch(/whole-report line cap/i);
    });

    test(`${where} gives a template of at most three sentences, each within the cap`, () => {
      const template = leadInTemplate(text(), where);
      const n = sentenceCount(template);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
      expect(longSentences(template)).toEqual([]);
    });
  }

  test("both surfaces carry the SAME literal template", () => {
    const skill = leadInTemplate(step14(read(SKILL_PATH)), "SKILL.md step 14");
    const ref = leadInTemplate(read(REFERENCE_PATH), "implement-reference.md");
    expect(ref).toEqual(skill);
  });

  test("the cap the prose names is the constant's value", () => {
    expect(PLAIN_SENTENCE_WORD_CAP).toBe(20);
  });
});

describe("AC-STE-745.2 — the model report built from the template grades clean", () => {
  const reportText = () => read(MODEL_REPORT_PATH);

  test("the model report's lead-in is the template with its placeholders filled", () => {
    const template = leadInTemplate(read(REFERENCE_PATH), "implement-reference.md");
    const lines = reportText().split("\n");
    const opener = lastFenceOpener(lines);
    expect(opener).toBeGreaterThan(0);
    const leadIn = lines.slice(0, opener).join("\n").trim();
    expect(leadIn).toMatch(templateMatcher(template));
  });

  test("the model report carries both cap-exempt sections after the fence", () => {
    const lines = reportText().split("\n");
    const opener = lastFenceOpener(lines);
    expect(opener).toBeGreaterThanOrEqual(0);
    const after = lines.slice(opener).join("\n");
    for (const heading of EXEMPT_SECTIONS) {
      expect(after.split("\n")).toContain(heading);
    }
  });

  test("--report exits 0 on the model report", () => {
    const { code, out } = runReport(MODEL_REPORT_PATH);
    expect(out).toContain("clean");
    expect(code).toBe(0);
  });

  test("the same report with a 23-word lead-in sentence exits 1 naming the sentence cap", () => {
    const lines = reportText().split("\n");
    const opener = lastFenceOpener(lines);
    expect(opener).toBeGreaterThan(0);
    const long =
      "This run landed every change the plan asked for and the operator now " +
      "reviews the whole diff before anything is committed right here.";
    expect(long.split(/\s+/).length).toBe(23);
    const mutated = [long, "", ...lines.slice(opener)].join("\n");
    const path = writeScratch("long-lead-in.txt", mutated);
    const { code, out } = runReport(path);
    expect(code).toBe(1);
    expect(out).toContain("carries 23 words");
    expect(out).toContain("20-word plain-sentence cap");
  });
});

describe("AC-STE-745.3 — smoke 15a's Source is the whole final assistant message", () => {
  const smoke = () => read(SMOKE_PATH);
  const source = () => {
    const section = headingSection(smoke(), /^#{1,6}\s+Sub-fixture 15a\b/);
    const line = section.split("\n").find((l) => l.startsWith("**Source:**"));
    expect(line, "15a carries a **Source:** paragraph").toBeDefined();
    return line!;
  };

  test("the Source names the whole final assistant message as the subject", () => {
    expect(source()).toMatch(/whole final assistant message/i);
  });

  test("the Source still names the /implement capture and extractAssistantText", () => {
    const s = source();
    expect(s).toContain("implement.log");
    expect(s).toContain("extractAssistantText");
  });

  test("the old fence-opener cut phrase is gone", () => {
    expect(smoke()).not.toContain(
      "from the last `stage-status-block` fence opener's paragraph onward",
    );
  });
});

describe("AC-STE-745.4 — the committed /implement capture under the new 15a rule", () => {
  const capture = () => read(CAPTURE_PATH);

  test("the capture carries more than one assistant message with text", () => {
    expect(finalAssistantMessage(capture()).messages).toBeGreaterThanOrEqual(2);
  });

  test("the new rule's subject carries both cap-exempt sections", () => {
    const lines = finalAssistantMessage(capture()).subject.split("\n");
    for (const heading of EXEMPT_SECTIONS) expect(lines).toContain(heading);
  });

  test("the new rule's subject exits 0 from --report", () => {
    const { subject } = finalAssistantMessage(capture());
    const path = writeScratch("new-cut.txt", subject);
    const { code, out } = runReport(path);
    expect(out).toContain("clean");
    expect(code).toBe(0);
  });

  test("the old cut of the same capture drops a cap-exempt section", () => {
    const newLines = finalAssistantMessage(capture()).subject.split("\n");
    const oldLines = oldCut(capture()).split("\n");
    expect(oldLines.some((l) => FENCE_OPENER_RE.test(l))).toBe(true);
    const dropped = EXEMPT_SECTIONS.filter(
      (h) => newLines.includes(h) && !oldLines.includes(h),
    );
    expect(dropped.length).toBeGreaterThanOrEqual(1);
  });
});

// STE-721 (M_d1b4b7) — the skill text and its pins.
//
//   AC.1  the report-issue argument-hint, and its two widened pins
//   AC.4  the four canonical prompts byte-identical to trunk; the AC-STE-229.5
//         order test unchanged and green
//   AC.5  § 2 says each prompt is still its own AskUserQuestion with the retro
//         default as the first option labelled `(from retro)`, and that the
//         operator's answer wins
//   AC.6  § 6 four files under --from-retro, three without; retro.json and
//         retro_included present only under --from-retro; m137 re-keyed
//   AC.8  report_issue_retro_seeded in the /spec-write § 7 map only
//   AC.9  brainstorm § 0 fetches retro.json on retro_included=true
//   AC.12 no-flag identity of the shipped text
//   AC.13 the 208 -> 212 line budget and its pins
//
// Trunk is effc0981 (the merge of PR #131, v3.0.0 + M_7bc805); the report-issue
// SKILL.md there is the v3.0.0 text. STE-720's state is d0ff89e8 (208 lines).
// The existing pins named by AC.1, AC.6 and AC.13 are amended by the
// implementer; the rows below assert the amended contents those files carry.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, SKILL_PATH, SKILL_REL, TRUNK_SHA, atRev, sentencesNaming, steTokens, unflaggedFrontDoorMentions } from "./_m_d1b4b7_ste720_fixture";
import { runNestedBunTest } from "./_nested_bun_test";
import { specWriteStep7Map } from "./_skill-md";

const STE720_SHA = "d0ff89e8";
const HINT = "[--full] [--dry-run] [--redact-identifiers] [--from-retro <file>]";
const HINT_720 = "[--full] [--dry-run] [--redact-identifiers]";

const now = (): string => readFileSync(SKILL_PATH, "utf-8");
const trunk = (): string => atRev(TRUNK_SHA, `plugins/dev-process-toolkit/${SKILL_REL}`);
const at720 = (): string => atRev(STE720_SHA, `plugins/dev-process-toolkit/${SKILL_REL}`);
const read = (rel: string): string => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");

/** The lines of `### <n>.` up to (not including) the next `### ` or `## ` heading. */
function sectionLines(text: string, n: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### ${n}. `));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end);
}
const section = (text: string, n: string): string => sectionLines(text, n).join("\n");

function nested(file: string, filter: string | null): { exit: number; out: string } {
  const r = runNestedBunTest(filter ? [file, "-t", filter] : [file], { cwd: PLUGIN_ROOT, timeoutMs: 240_000 });
  return { exit: r.exitCode, out: r.stdout + r.stderr };
}
function expectGreen(file: string, filter: string | null, minPass = 1): void {
  const r = nested(file, filter);
  expect({ file, filter, exit: r.exit, out: r.out }).toEqual({ file, filter, exit: 0, out: r.out });
  const m = r.out.match(/\b(\d+) pass\b/);
  expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(minPass);
}

// ---------------------------------------------------------------- v3.0.0 literals (effc0981)

const V300_FILE_LIST_BULLETS = [
  "- **`report.md`** — narrative + curated context inline; markdown for human readability. Sections, in this order:",
  "- **`metadata.json`** — machine-readable shape:",
  "- **`transcript.jsonl`** — full mode only; the scrubbed transcript verbatim.",
];

const V300_METADATA_KEYS = [
  "  ```json",
  "  {",
  '    "timestamp": "<ISO-8601 UTC>",',
  '    "plugin_version": "<x.y.z>",',
  '    "git_head": "<sha>",',
  '    "severity": "<low|medium|high>",',
  '    "verified": <boolean>,',
  '    "verification": { "searched": <boolean>, "found": <boolean>, "markers": ["<marker>", ...] },',
  '    "redaction_summary": [{ "pattern": "<key>", "count": <n> }, ...],',
  '    "full_transcript_included": <boolean>',
  "  }",
  "  ```",
];

const V300_GIST_LINE = 'gh gist create -d "<title>" report.md metadata.json [transcript.jsonl]';

const topBullets = (lines: string[]): string[] => lines.filter((l) => l.startsWith("- **`"));
function jsonBlock(lines: string[]): string[] {
  const s = lines.indexOf("  ```json");
  if (s < 0) return [];
  const e = lines.indexOf("  ```", s + 1);
  return lines.slice(s, e + 1);
}
const withoutFromRetro = (lines: string[]): string[] => lines.filter((l) => !l.includes("--from-retro"));

// ===========================================================================

describe("AC-STE-721.1 argument-hint", () => {
  test(`report-issue argument-hint is exactly ${HINT}`, () => {
    const m = now().match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    expect(m?.[1]).toBe(HINT);
  });

  test("CONTROL: STE-720's argument-hint is the three-flag one", () => {
    expect(at720()).toContain(`argument-hint: '${HINT_720}'`);
  });

  test("report-issue-doc-conformance and m117-ste-428 carry the widened literal and the Amended-by comment, not the STE-720 literal", () => {
    for (const rel of ["tests/report-issue-doc-conformance.test.ts", "tests/m117-ste-428-report-issue-renderable.test.ts"]) {
      const src = read(rel);
      expect({ rel, widened: src.includes(`toBe("${HINT}")`) }).toEqual({ rel, widened: true });
      expect({ rel, old: src.includes(`toBe("${HINT_720}")`) }).toEqual({ rel, old: false });
      expect({ rel, comment: src.includes("Amended by AC-STE-721.1: argument-hint gains --from-retro <file>.") }).toEqual({ rel, comment: true });
    }
  });

  test("both widened argument-hint rows pass", () => {
    expectGreen("tests/report-issue-doc-conformance.test.ts", "argument-hint is exactly");
    expectGreen("tests/m117-ste-428-report-issue-renderable.test.ts", "argument-hint advertises the flag");
  });
});

describe("AC-STE-721.4 the four canonical prompts", () => {
  const promptLines = (text: string): string[] => sectionLines(text, "2").filter((l) => /^[1-4]\. "/.test(l));

  test("the four numbered prompt lines of § 2, and their order, are byte-identical to trunk", () => {
    const base = promptLines(trunk());
    expect(base.length).toBe(4);
    expect(promptLines(now())).toEqual(base);
  });

  test("the AC-STE-229.5 describe block of report-issue-doc-conformance is unchanged against trunk, and passes", () => {
    const block = (t: string): string => {
      const s = t.indexOf('describe("AC-STE-229.5');
      return s < 0 ? "" : t.slice(s, t.indexOf("\n});\n", s));
    };
    const base = block(atRev(TRUNK_SHA, "plugins/dev-process-toolkit/tests/report-issue-doc-conformance.test.ts"));
    expect(base.length).toBeGreaterThan(200);
    expect(block(read("tests/report-issue-doc-conformance.test.ts"))).toBe(base);
    expectGreen("tests/report-issue-doc-conformance.test.ts", "AC-STE-229.5", 2);
  });
});

describe("AC-STE-721.5 § 2: still asked one at a time, the retro default first, the operator wins", () => {
  test("a § 2 sentence says each prompt is still its own AskUserQuestion with the retro default as the first option labelled (from retro)", () => {
    const s2 = section(now(), "2");
    expect(s2.length).toBeGreaterThan(0);
    const hits = sentencesNaming(s2, "(from retro)").filter((s) => s.includes("AskUserQuestion") && /first option/i.test(s));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("a § 2 sentence says the operator's answer wins", () => {
    const s2 = section(now(), "2");
    const hits = sentencesNaming(s2, "answer").filter((s) => /operator[’']s answer/i.test(s) && /\bwins?\b/i.test(s));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("§ 1 ends with one paragraph naming the input check, its three refusals and the (from retro) defaults from retroPromptDefaults", () => {
    const lines = now().split("\n");
    const i2 = lines.findIndex((l) => l.startsWith("### 2. "));
    expect(i2).toBeGreaterThan(4);
    expect(lines[i2 - 1]).toBe("");
    const p = lines[i2 - 2]!;
    expect(lines[i2 - 3]).toBe("");
    expect(lines[i2 - 4]).toBe("This is the hard prerequisite per AC-STE-229.2. The skill performs zero side effects on this path.");
    for (const needle of ["--from-retro", ".dpt/ledger/retro/", "parseRetroReport", "tripped_count", "(from retro)", "retroPromptDefaults", "report_issue_retro.ts"]) {
      expect({ needle, present: p.includes(needle) }).toEqual({ needle, present: true });
    }
    expect(p).toMatch(/symlink/i);
    expect(p).toMatch(/refus/i);
    expect(steTokens(p)).toBe(0);
  });
});

describe("AC-STE-721.6 § 6: three files, or four under --from-retro", () => {
  test("§ 6 says three files maximum, and four files maximum in a sentence naming --from-retro", () => {
    const s6 = section(now(), "6");
    expect(s6).toMatch(/three files maximum/i);
    const four = sentencesNaming(s6, "four files maximum").concat(sentencesNaming(s6, "Four files maximum"));
    expect(four.length).toBeGreaterThanOrEqual(1);
    expect(four.every((s) => s.includes("--from-retro"))).toBe(true);
  });

  test("the retro.json bullet follows the transcript.jsonl bullet and says it is present only under --from-retro, a copy of the input file", () => {
    const lines = sectionLines(now(), "6");
    const it = lines.findIndex((l) => l.startsWith("- **`transcript.jsonl`**"));
    expect(it).toBeGreaterThan(-1);
    const r = lines[it + 1]!;
    expect(r.startsWith("- **`retro.json`**")).toBe(true);
    expect(r).toContain("--from-retro");
    expect(r).toMatch(/\bonly\b/);
    expect(r).toMatch(/cop(y|ies)/i);
  });

  test("§ 6 documents retro_included as present only under --from-retro", () => {
    const hits = sentencesNaming(section(now(), "6"), "retro_included");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((s) => s.includes("--from-retro") && /\bonly\b/.test(s))).toBe(true);
  });

  test("m137-ste-533 is re-keyed to both counts, with its Amended-by comment, and passes", () => {
    const src = read("tests/m137-ste-533-report-conformance-matrix.test.ts");
    expect(src).toContain("Amended by AC-STE-721.6");
    expect(src).toMatch(/three files maximum/);
    expect(src).toMatch(/four files maximum/);
    expectGreen("tests/m137-ste-533-report-conformance-matrix.test.ts", null, 30);
  });
});

describe("AC-STE-721.8 report_issue_retro_seeded: the /spec-write § 7 map only", () => {
  test("the /spec-write § 7 map renders report_issue_retro_seeded", () => {
    const map = specWriteStep7Map(read("skills/spec-write/SKILL.md"));
    expect(map).toContain("`report_issue_retro_seeded`");
  });

  test("it is in neither CANONICAL_CAPABILITY_KEYS nor KEY_OWNER_SKILL, and CANONICAL_CAPABILITY_KEYS stays 47", async () => {
    const m = await import("../adapters/_shared/src/closing_summary_capability_keys");
    expect((m.CANONICAL_CAPABILITY_KEYS as readonly string[]).includes("report_issue_retro_seeded")).toBe(false);
    expect(Object.keys(m.KEY_OWNER_SKILL)).not.toContain("report_issue_retro_seeded");
    expect(m.CANONICAL_CAPABILITY_KEYS.length).toBe(47);
  });

  test("closing_summary_capability_keys reports clean on the repo", async () => {
    const { runClosingSummaryCapabilityKeysProbe } = await import("../adapters/_shared/src/closing_summary_capability_keys");
    const repoRoot = join(PLUGIN_ROOT, "..", "..");
    const r = await runClosingSummaryCapabilityKeysProbe(repoRoot);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });

  test("skills/spec-write/SKILL.md gains no line and no STE token against trunk, and stays at most 358 split-lines", () => {
    const cur = read("skills/spec-write/SKILL.md");
    const base = atRev(TRUNK_SHA, "plugins/dev-process-toolkit/skills/spec-write/SKILL.md");
    expect(cur.split("\n").length).toBe(base.split("\n").length);
    expect(cur.split("\n").length).toBeLessThanOrEqual(358);
    expect(steTokens(cur)).toBe(steTokens(base));
  });

  test("the report-issue SKILL lists report_issue_retro_seeded under ## Capability rows, naming --from-retro", () => {
    const text = now();
    const cap = text.slice(text.indexOf("## Capability rows"), text.indexOf("## Rules"));
    const row = cap.split("\n").filter((l) => l.startsWith("- `report_issue_retro_seeded`"));
    expect(row.length).toBe(1);
    expect(row[0]).toContain("--from-retro");
  });
});

describe("AC-STE-721.9 brainstorm § 0 reads retro.json back", () => {
  test("the retro.json fetch line directly follows the transcript.jsonl line and is conditioned on retro_included=true", () => {
    const lines = sectionLines(read("skills/brainstorm/SKILL.md"), "0");
    const t = lines.findIndex((l) => l.startsWith("gh gist view <id-or-url> --raw -f transcript.jsonl"));
    expect(t).toBeGreaterThan(-1);
    const r = lines[t + 1] ?? "";
    expect(r.startsWith("gh gist view <id-or-url> --raw -f retro.json")).toBe(true);
    expect(r).toContain("retro_included=true");
  });

  test("§ 0 says an absent retro_included key fetches nothing", () => {
    const hits = sentencesNaming(section(read("skills/brainstorm/SKILL.md"), "0"), "retro_included").filter((s) => /absent/i.test(s) && /nothing/i.test(s));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-721.12 no-flag identity of the shipped text", () => {
  test("CONTROL: the v3.0.0 literals are trunk's bytes", () => {
    const base = trunk();
    const s6 = sectionLines(base, "6");
    expect(topBullets(s6)).toEqual(V300_FILE_LIST_BULLETS);
    expect(jsonBlock(s6)).toEqual(V300_METADATA_KEYS);
    expect(base.split("\n")).toContain(V300_GIST_LINE);
  });

  test("the § 6 file list read without --from-retro equals its v3.0.0 bytes", () => {
    expect(withoutFromRetro(topBullets(sectionLines(now(), "6")))).toEqual(V300_FILE_LIST_BULLETS);
  });

  test("the metadata.json key list read without --from-retro equals its v3.0.0 bytes", () => {
    expect(withoutFromRetro(jsonBlock(sectionLines(now(), "6")))).toEqual(V300_METADATA_KEYS);
  });

  test("the § 8 gh gist create line equals its v3.0.0 bytes once [retro.json] is removed", () => {
    const lines = sectionLines(now(), "8").filter((l) => l.startsWith("gh gist create"));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(" [retro.json]");
    expect(lines[0]!.replace(" [retro.json]", "")).toBe(V300_GIST_LINE);
  });

  test("every line new against trunk names --from-retro (the argument-hint and the § 8 gh line aside)", () => {
    const base = new Set(trunk().split("\n"));
    const added = now()
      .split("\n")
      .filter((l) => l.trim().length > 0 && !base.has(l))
      .filter((l) => !l.startsWith("argument-hint:") && !l.startsWith("gh gist create"));
    expect(added.length).toBeGreaterThanOrEqual(5);
    expect(added.filter((l) => !l.includes("--from-retro"))).toEqual([]);
  });

  test("the § 9 closing-summary rationale still says three files maximum without the flag, and four with it", () => {
    const s9 = section(now(), "9");
    const fileList = s9.split("\n").filter((l) => l.startsWith("- File list with byte sizes."));
    expect(fileList.length).toBe(1);
    expect(fileList[0]).toMatch(/three files maximum/);
    expect(fileList[0]).toMatch(/\bfour\b/i);
    expect(fileList[0]).toContain("--from-retro");
  });

  test("with neither flag the skill issues no front-door call: every sentence naming report_issue_payload.ts names a flag", () => {
    expect(now()).toContain("report_issue_payload.ts");
    expect(unflaggedFrontDoorMentions(now())).toEqual([]);
  });
});

describe("AC-STE-721.13 the line budget and its pins", () => {
  test("SKILL.md measures exactly 212 split-lines (208 at STE-720) and keeps its STE-<n> token count", () => {
    expect(at720().split("\n").length).toBe(208);
    expect(now().split("\n").length).toBe(212);
    expect(steTokens(now())).toBe(steTokens(trunk()));
    expect(steTokens(now())).toBe(steTokens(at720()));
  });

  test("m_a85e46-ste-656-docs-drift carries LINE_DELTA 6 for report-issue with its Amended-by comment, token assertion unedited", () => {
    const src = read("tests/m_a85e46-ste-656-docs-drift.test.ts");
    expect(src).toMatch(/const LINE_DELTA: Record<string, number> = \{\s*"skills\/report-issue\/SKILL\.md": 6\s*\}/);
    expect(src).toContain("// Amended by AC-STE-721.13 (208 -> 212)");
    expect(src).toContain('base.split("\\n").length + (LINE_DELTA[rel] ?? 0)');
    expect(src).toContain("expect(steTokens(now)).toBe(steTokens(base));");
  });

  test("m117-ste-428 MODULE_BASENAMES holds report_issue_retro with its Amended-by comment", () => {
    const src = read("tests/m117-ste-428-report-issue-renderable.test.ts");
    const at = src.indexOf("const MODULE_BASENAMES = new Set([");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("]);", at));
    expect(block).toMatch(/"report_issue_retro",?\s*\/\/ Amended by AC-STE-721\.13/);
    expect(block).toContain('"report_issue_payload"');
  });

  test("the amended rows pass: docs-drift's pinned-count rows and m117's no-new-capability-key row", () => {
    expectGreen("tests/m_a85e46-ste-656-docs-drift.test.ts", "keeps its pinned counts", 3);
    expectGreen("tests/m117-ste-428-report-issue-renderable.test.ts", "no new capability key is minted", 1);
  });

  test("the six CANONICAL_CAPABILITY_KEYS length pins at 47 are unedited against trunk", () => {
    const pins: [string, number][] = [
      ["tests/m84-ste-320-code-reviewer-scope-registry.test.ts", 308],
      ["tests/m84-ste-320-code-reviewer-scope-registry.test.ts", 348],
      ["tests/orphan-listing-shared.test.ts", 805],
      ["tests/m_840a06-ste-579-idempotency-probe-narrows.test.ts", 1003],
      ["tests/m_8f07e0-ste-585-epic-label.test.ts", 352],
      ["tests/m_8f07e0-ste-587-span-fixture.test.ts", 555],
    ];
    for (const [rel, line] of pins) {
      const cur = read(rel);
      expect({ rel, unedited: cur === atRev(TRUNK_SHA, `plugins/dev-process-toolkit/${rel}`) }).toEqual({ rel, unedited: true });
      const pin = cur.split("\n")[line - 1]!.trim();
      expect({ rel, line, pin, at47: /^expect\((CANONICAL_CAPABILITY_KEYS\.length|discovered\.size)\)\.toBe\(47\);$/.test(pin) }).toEqual({ rel, line, pin, at47: true });
    }
  });
});

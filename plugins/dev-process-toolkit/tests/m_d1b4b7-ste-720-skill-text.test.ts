// STE-720 (M_d1b4b7) AC.9 and AC.15 — the /report-issue skill text.
//
// The skill changes in exactly two places: the `argument-hint` line, rewritten
// in place, and one front-door paragraph plus its blank line at the end of § 6,
// directly before `### 7. Preview gate` (206 -> 208 split-lines, no `STE-<n>`
// token added). Everything else, the per-file secret-scrub prose of § 4 to § 6
// included, is byte-identical to trunk. The needle row (every sentence naming
// `report_issue_payload.ts` names a flag) has a temp-copy control.
//
// The existing pins that read this file are amended by the implementer; the
// rows below assert the amended contents those files must carry.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  PLUGIN_ROOT,
  SKILL_PATH,
  SKILL_REL,
  TRUNK_SHA,
  atRev,
  cleanupTemps,
  steTokens,
  tempDir,
  unflaggedFrontDoorMentions,
} from "./_m_d1b4b7_ste720_fixture";
import { runNestedBunTest } from "./_nested_bun_test";

afterAll(cleanupTemps);

// Amended by AC-STE-721.1: argument-hint gains --from-retro <file>.
const HINT_NOW = "argument-hint: '[--full] [--dry-run] [--redact-identifiers] [--from-retro <file>]'";
const HINT_TRUNK = "argument-hint: '[--full] [--dry-run]'";
const PREVIEW = "### 7. Preview gate";

const now = (): string => readFileSync(SKILL_PATH, "utf-8");
const trunk = (): string => atRev(TRUNK_SHA, `plugins/dev-process-toolkit/${SKILL_REL}`);

/** The front-door paragraph: the line two above `### 7. Preview gate`. */
function frontDoorParagraph(text: string): string {
  const lines = text.split("\n");
  const i7 = lines.indexOf(PREVIEW);
  return i7 >= 2 ? lines[i7 - 2]! : "";
}

describe("AC-STE-720.9 the skill text", () => {
  test("argument-hint reads exactly [--full] [--dry-run] [--redact-identifiers] [--from-retro <file>]", () => {
    const m = now().match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    // Amended by AC-STE-721.1: argument-hint gains --from-retro <file>.
    expect(m?.[1]).toBe("[--full] [--dry-run] [--redact-identifiers] [--from-retro <file>]");
  });

  test("CONTROL: trunk's argument-hint is the v3.0.0 one", () => {
    expect(trunk().split("\n")).toContain(HINT_TRUNK);
  });

  // Amended by AC-STE-721.13: STE-721 adds four --from-retro lines and edits
  // others in place, each naming --from-retro (the § 8 gh line aside). STE-720's
  // own change set is still the argument-hint line and the front-door paragraph.
  test("the only changes against trunk are the argument-hint line, one paragraph + blank line directly before § 7, and the STE-721 --from-retro lines", () => {
    const cur = now().split("\n");
    const base = trunk().split("\n");
    expect(cur.length).toBe(base.length + 2 + 4);
    const i7 = cur.indexOf(PREVIEW);
    expect(i7).toBeGreaterThan(2);
    expect(cur[i7 - 1]).toBe("");
    expect(cur[i7 - 2]!.trim().length).toBeGreaterThan(0);
    expect(cur[i7 - 3]).toBe("");
    const ste721Inserted = (l: string, i: number, all: string[]): boolean =>
      l.startsWith("**`--from-retro <file>` input check.**") ||
      (l === "" && (all[i - 1] ?? "").startsWith("**`--from-retro <file>` input check.**")) ||
      l.startsWith("- **`retro.json`** — `--from-retro` only") ||
      l.startsWith("- `report_issue_retro_seeded` —");
    const withoutFrontDoor = [...cur.slice(0, i7 - 2), ...cur.slice(i7)];
    const restored = withoutFrontDoor
      .filter((l, i, all) => !ste721Inserted(l, i, all))
      .map((l) => (l === HINT_NOW ? HINT_TRUNK : l.startsWith("gh gist create") ? l.replace(" [retro.json]", "") : l));
    expect(restored.length).toBe(base.length);
    const changed = restored.map((l, i) => [l, base[i]!] as const).filter(([l, b]) => l !== b);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.filter(([l]) => !l.includes("--from-retro"))).toEqual([]);
  });

  test("the per-file secret-scrub prose of § 4 to § 6 is byte-identical to trunk", () => {
    const region = (t: string): string => t.slice(t.indexOf("### 4. Gather curated context"), t.indexOf(PREVIEW));
    const b = region(trunk());
    expect(b.length).toBeGreaterThan(1000);
    expect(b).toContain("scrubSecrets");
    // Amended by AC-STE-721.13: § 6 gains --from-retro clauses; every trunk line
    // naming scrubSecrets is still present byte-for-byte, and every other new
    // line in the region names --from-retro.
    const cur = region(now()).split("\n");
    for (const l of b.split("\n").filter((x) => x.includes("scrubSecrets"))) expect(cur).toContain(l);
    const baseLines = new Set(b.split("\n"));
    expect(cur.filter((l) => !baseLines.has(l) && !l.includes("--from-retro") && !l.includes("report_issue_payload.ts") && l !== "")).toEqual([]);
  });

  test("the front-door paragraph names report_issue_payload.ts, both flags, the secret scrub before it and the preview gate after it", () => {
    const p = frontDoorParagraph(now());
    expect(p).toContain("report_issue_payload.ts");
    expect(p).toContain("--redact-identifiers");
    expect(p).toContain("--from-retro");
    expect(p).toMatch(/secret/i);
    expect(p).toMatch(/preview/i);
  });

  test("it says the redaction row counts the summary rows, with examples across 7 pattern(s) and across 10 pattern(s)", () => {
    const p = frontDoorParagraph(now());
    expect(p).toContain("across 7 pattern(s)");
    expect(p).toContain("across 10 pattern(s)");
    expect(p).toMatch(/\brows?\b/);
  });

  test("the front door is named only in that paragraph", () => {
    const lines = now().split("\n");
    const hits = lines.map((l, i) => [i, l] as const).filter(([, l]) => l.includes("report_issue_payload"));
    expect(hits.map(([i]) => i)).toEqual([lines.indexOf(PREVIEW) - 2]);
  });

  test("needle row: every sentence naming report_issue_payload.ts also names --redact-identifiers or --from-retro", () => {
    expect(now()).toContain("report_issue_payload.ts");
    expect(unflaggedFrontDoorMentions(now())).toEqual([]);
  });

  test("CONTROL: a planted unconditional mention in a temp copy turns the needle row red", () => {
    const planted = "Then run `bun run adapters/_shared/src/report_issue_payload.ts <workdir> <projectRoot>` on every report.";
    const lines = now().split("\n");
    const i7 = lines.indexOf(PREVIEW);
    expect(i7).toBeGreaterThan(2);
    lines[i7 - 2] = `${lines[i7 - 2]} ${planted}`;
    const copy = join(tempDir("skill-copy"), "SKILL.md");
    writeFileSync(copy, lines.join("\n"));
    const red = unflaggedFrontDoorMentions(readFileSync(copy, "utf-8"));
    expect(red.length).toBe(1);
    expect(red[0]).toContain("on every report");
  });

  test("the amended argument-hint pins: report-issue-doc-conformance and m117-ste-428 carry the widened literal and the Amended-by comment", () => {
    for (const rel of ["tests/report-issue-doc-conformance.test.ts", "tests/m117-ste-428-report-issue-renderable.test.ts"]) {
      const src = readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
      // Amended by AC-STE-721.1: argument-hint gains --from-retro <file>.
      expect({ rel, widened: src.includes('toBe("[--full] [--dry-run] [--redact-identifiers] [--from-retro <file>]")') }).toEqual({ rel, widened: true });
      expect({ rel, narrow: src.includes('toBe("[--full] [--dry-run]")') }).toEqual({ rel, narrow: false });
      expect({ rel, comment: src.includes("Amended by AC-STE-720.9: argument-hint gains --redact-identifiers.") }).toEqual({ rel, comment: true });
    }
  });
});

describe("AC-STE-720.15 the line budget and the two amended pins", () => {
  test("SKILL.md measures exactly 212 split-lines (206 at trunk, 208 at STE-720) and keeps its STE-<n> token count", () => {
    expect(trunk().split("\n").length).toBe(206);
    // Amended by AC-STE-721.13 (208 -> 212)
    expect(now().split("\n").length).toBe(212);
    expect(steTokens(now())).toBe(steTokens(trunk()));
    expect(steTokens(frontDoorParagraph(now()))).toBe(0);
  });

  test("m_a85e46-ste-656-docs-drift carries LINE_DELTA 2 for report-issue with its Amended-by comment, read into the line assertion, token assertion unedited", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "tests", "m_a85e46-ste-656-docs-drift.test.ts"), "utf-8");
    // Amended by AC-STE-721.13 (208 -> 212)
    expect(src).toMatch(/const LINE_DELTA: Record<string, number> = \{\s*"skills\/report-issue\/SKILL\.md": 6\s*\}/);
    expect(src).toContain("// Amended by AC-STE-720.15 (206 -> 208)");
    expect(src).toContain('base.split("\\n").length + (LINE_DELTA[rel] ?? 0)');
    expect(src).toContain("expect(steTokens(now)).toBe(steTokens(base));");
    expect(src).not.toContain('expect(now.split("\\n").length).toBe(base.split("\\n").length);');
  });

  test("m117-ste-428 MODULE_BASENAMES holds report_issue_payload with its Amended-by comment, and keeps its non-vacuity control", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "tests", "m117-ste-428-report-issue-renderable.test.ts"), "utf-8");
    const at = src.indexOf("const MODULE_BASENAMES = new Set([");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("]);", at));
    expect(block).toMatch(/"report_issue_payload",?\s*\/\/ Amended by AC-STE-720\.15/);
    expect(src).toContain('expect(map.includes("`report_issue_dry_run_skipped`")).toBe(false);');
  });

  test("the two amended rows pass: docs-drift's three pinned-count rows and m117's no-new-capability-key row", () => {
    const drift = runNestedBunTest(["tests/m_a85e46-ste-656-docs-drift.test.ts", "-t", "keeps its pinned counts"], {
      cwd: PLUGIN_ROOT,
      timeoutMs: 120_000,
    });
    expect({ exit: drift.exitCode, out: drift.stdout + drift.stderr }).toEqual({ exit: 0, out: drift.stdout + drift.stderr });
    expect(drift.stderr + drift.stdout).toMatch(/\b3 pass\b/);
    const m117 = runNestedBunTest(["tests/m117-ste-428-report-issue-renderable.test.ts", "-t", "no new capability key is minted"], {
      cwd: PLUGIN_ROOT,
      timeoutMs: 120_000,
    });
    expect({ exit: m117.exitCode, out: m117.stdout + m117.stderr }).toEqual({ exit: 0, out: m117.stdout + m117.stderr });
    expect(m117.stderr + m117.stdout).toMatch(/\b1 pass\b/);
  });
});

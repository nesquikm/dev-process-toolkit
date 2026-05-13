import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-285 AC-STE-285.6 — Cancellation chain citation.
//
// STE-262/STE-270/STE-276 cancellation chain explicitly cited in this FR's
// Notes section under "Why not session-wide bundled". Preserves the decision
// chain so future agents reading this FR understand the layer choice.
//
// AC verify line: `grep -E "STE-262|STE-270|STE-276" specs/frs/STE-285.md`
// returns ≥ 3 distinct refs in Notes section.
//
// STE-285 AC-STE-285.7 — `plugins/dev-process-toolkit/docs/hooks-reference.md`
// enumerates each seeded hook. AC verify: file exists; ≥ 4 level-3 headings.

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const FR_PATH = join(REPO_ROOT, "specs", "frs", "STE-285.md");
const HOOKS_REFERENCE_PATH = join(
  REPO_ROOT,
  "plugins",
  "dev-process-toolkit",
  "docs",
  "hooks-reference.md",
);

const SEEDED_HOOKS = [
  "pre-commit-gate-check",
  "pre-pr-spec-review",
  "pre-spec-write-brainstorm-reminder",
  "pre-commit-tdd-orchestrator",
];

function readFr(): string {
  return readFileSync(FR_PATH, "utf-8");
}

/**
 * Slice the Notes section from the FR. Heading is `## Notes`; section
 * extends to EOF or the next `## ` heading.
 */
function notesSection(body: string): string {
  const notesIdx = body.indexOf("## Notes");
  if (notesIdx === -1) {
    return "";
  }
  const next = body.indexOf("\n## ", notesIdx + 1);
  return next === -1 ? body.slice(notesIdx) : body.slice(notesIdx, next);
}

describe("AC-STE-285.6 — cancellation chain cited in Notes section", () => {
  test("Notes section exists in specs/frs/STE-285.md", () => {
    const notes = notesSection(readFr());
    expect(notes.length).toBeGreaterThan(0);
  });

  test("Notes section contains ≥ 3 distinct refs to STE-262, STE-270, STE-276", () => {
    const notes = notesSection(readFr());
    const refs = ["STE-262", "STE-270", "STE-276"];
    const hits = refs.filter((r) => notes.includes(r));
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  test('Notes section carries the "Why not session-wide bundled" framing', () => {
    const notes = notesSection(readFr());
    // The FR's Notes carries a "Why not session-wide bundled" subhead per
    // the AC text. Accept exact phrase or close paraphrases that preserve
    // the load-bearing fragments ("session-wide" + "bundled").
    expect(notes).toMatch(/session-wide.*bundled|bundled.*session-wide|not\s+session-wide\s+bundled/i);
  });
});

describe("AC-STE-285.7 — hooks-reference.md catalog enumerates each seeded hook", () => {
  test("plugins/dev-process-toolkit/docs/hooks-reference.md exists", () => {
    expect(existsSync(HOOKS_REFERENCE_PATH)).toBe(true);
  });

  test("hooks-reference.md has ≥ 4 level-3 (### ) headings (one section per seeded hook)", () => {
    const body = readFileSync(HOOKS_REFERENCE_PATH, "utf-8");
    const h3Count = body
      .split("\n")
      .filter((line) => /^### /.test(line)).length;
    expect(h3Count).toBeGreaterThanOrEqual(4);
  });

  test("hooks-reference.md names each of the four seeded hooks", () => {
    const body = readFileSync(HOOKS_REFERENCE_PATH, "utf-8");
    for (const hook of SEEDED_HOOKS) {
      expect(body).toContain(hook);
    }
  });

  test("each seeded hook section documents event, matcher, requirement, refusal shape, override", () => {
    const body = readFileSync(HOOKS_REFERENCE_PATH, "utf-8");
    // The catalog shape: each `### ` entry must carry the five canonical
    // labels per AC.7's enumeration. We grep for each label across the file
    // and require ≥ 4 hits (one per seeded hook).
    const requiredLabels = [
      /event[:\s]/i,
      /matcher[:\s]/i,
      /requirement[:\s]/i,
      /(refusal|NFR-10|miss)/i,
      /override/i,
    ];
    for (const label of requiredLabels) {
      const lines = body.split("\n");
      const hits = lines.filter((l) => label.test(l)).length;
      expect(hits).toBeGreaterThanOrEqual(4);
    }
  });
});

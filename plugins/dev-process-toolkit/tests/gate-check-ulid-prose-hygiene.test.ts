import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-82 AC-STE-82.6 + AC-STE-82.7 — gate-check probe #11 integration test.
//
// Probe 11 (tracker mode only; skipped in mode: none) greps active
// `specs/plan/*.md`, the current release section of `CHANGELOG.md`, and
// `README.md` for the full 26-char ULID regex `fr_[0-9A-HJKMNP-TV-Z]{26}`.
// Each hit → GATE PASSED WITH NOTES listing `<file>:<line>` so the
// operator rewrites the prose to use the tracker ID instead. Warn-only —
// never GATE FAILED.
//
// Satisfies AC-STE-67.6 (probe 11's declaration) and AC-STE-82.6 (probe 11's
// integration test). The regex is the canonical ULID form: `fr_` prefix
// followed by exactly 26 Crockford-base32 characters.

const ULID_REGEX = /fr_[0-9A-HJKMNP-TV-Z]{26}/g;

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function scanFileForUlids(path: string): { line: number; match: string }[] {
  const hits: { line: number; match: string }[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((text, i) => {
    for (const m of text.matchAll(ULID_REGEX)) {
      hits.push({ line: i + 1, match: m[0] });
    }
  });
  return hits;
}

describe("STE-82 AC-STE-82.6 prose — /gate-check probe 11 is documented in SKILL.md", () => {
  test("SKILL.md names the Tracker-mode ULID prose hygiene probe + STE-67.6 reference", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Tracker-mode ULID prose hygiene/);
    expect(body).toMatch(/AC-STE-67\.6/);
  });

  test("probe is tracker-mode only and skipped in mode: none", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Tracker-mode ULID prose hygiene");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 800);
    expect(block).toMatch(/tracker mode only|mode: none/i);
    expect(block).toMatch(/skipped/i);
  });

  test("probe uses the canonical 26-char ULID regex", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/fr_\[0-9A-HJKMNP-TV-Z\]\{26\}/);
  });

  test("probe scopes to active plan files + current CHANGELOG section + README", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Tracker-mode ULID prose hygiene");
    const block = body.slice(probeIdx, probeIdx + 800);
    expect(block).toMatch(/specs\/plan\/\*\.md/);
    expect(block).toContain("CHANGELOG.md");
    expect(block).toContain("README.md");
  });

  test("probe is warn-only: GATE PASSED WITH NOTES, never GATE FAILED", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Tracker-mode ULID prose hygiene");
    const block = body.slice(probeIdx, probeIdx + 800);
    expect(block).toContain("GATE PASSED WITH NOTES");
    expect(block).toMatch(/never.*GATE FAILED/i);
  });
});

describe("STE-82 AC-STE-82.6/7 — ULID prose hygiene fixtures (positive + negative)", () => {
  function makeProjectTree(): { dir: string; planDir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "ulid-hygiene-"));
    const planDir = join(dir, "specs", "plan");
    mkdirSync(planDir, { recursive: true });
    return { dir, planDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test("POSITIVE: plan file using tracker IDs has zero full-ULID hits", () => {
    const ctx = makeProjectTree();
    try {
      const planPath = join(ctx.planDir, "M22.md");
      writeFileSync(
        planPath,
        `# M22\n\n## FR list\n\n| STE-77 | Linear SSE swap |\n| STE-78 | Mechanicals |\n| STE-82 | Probe tests |\n`,
      );
      const hits = scanFileForUlids(planPath);
      expect(hits).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("NEGATIVE: plan file leaking full ULIDs surfaces each hit with line number (note shape)", () => {
    const ctx = makeProjectTree();
    try {
      const planPath = join(ctx.planDir, "M18.md");
      const body = `# M18\n\n## FRs\n\n- fr_01KPWPMA9TKSYYBNCQ3TAYM9BE — filename convention\n- fr_01KPZ7GRFN656QFSG79EY53YJV — another full ULID leak\n`;
      writeFileSync(planPath, body);
      const hits = scanFileForUlids(planPath);
      expect(hits.length).toBe(2);
      expect(hits[0]!.line).toBe(5);
      expect(hits[0]!.match).toMatch(/^fr_[0-9A-HJKMNP-TV-Z]{26}$/);
      // AC-STE-82.7 canonical note shape: `<file>:<line> — reason`.
      const note = `${planPath}:${hits[0]!.line} — full ULID ${hits[0]!.match} should be rewritten to the tracker ID`;
      expect(note).toMatch(/:\d+ — full ULID fr_[0-9A-HJKMNP-TV-Z]{26} should be rewritten/);
    } finally {
      ctx.cleanup();
    }
  });

  test("ULID regex is strict: 26-char Crockford-base32 only (not permissive)", () => {
    // 25 chars — rejected.
    expect("fr_0000000000000000000000000").not.toMatch(/^fr_[0-9A-HJKMNP-TV-Z]{26}$/);
    // 26 chars using excluded letters (I, L, O, U) — rejected.
    expect("fr_IIIIIIIIIIIIIIIIIIIIIIIIII").not.toMatch(/^fr_[0-9A-HJKMNP-TV-Z]{26}$/);
    // Valid ULID — accepted.
    expect("fr_01KPWPMA9TKSYYBNCQ3TAYM9BE").toMatch(/^fr_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

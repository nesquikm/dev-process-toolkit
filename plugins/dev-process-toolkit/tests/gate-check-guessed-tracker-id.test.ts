import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AC-STE-87.8: /gate-check gains probe #15 "Guessed tracker-ID scan".
// For each specs/frs/*.md (active, non-archive) with a bound tracker,
// every AC-<PREFIX>.<N> line's <PREFIX> must equal the file's own
// tracker.<key> value. Mismatch → GATE FAILED naming the file, the
// offending prefix, and the expected tracker ID. Skipped for mode: none.
//
// Same shape as gate-check-ticket-state-drift.test.ts (probe #8) +
// gate-check-active-ticket-drift.test.ts (probe #14). The behavior
// assertions exercise the scan predicate (frontmatter tracker key vs.
// AC-line prefix); the prose-shape assertions verify SKILL.md carries
// the probe declaration.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function readGateCheck(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

// Lightweight frontmatter parser for fixture bodies — just enough to pull
// the tracker.<key> binding out of an inline FR stub. Mirrors the shape
// the probe's prose would need at gate-check time.
interface FrontmatterTracker {
  [key: string]: string | null;
}

function readTrackerBinding(body: string): FrontmatterTracker | null {
  const match = body.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const lines = match[1].split("\n");
  // Find the `tracker:` line. If it is inline (`tracker: null` or similar)
  // the FR has no bound tracker. Otherwise walk indented continuation
  // lines (`  <key>: <value>`) until an unindented line (next top-level
  // YAML key or end-of-frontmatter), which is the probe's scope boundary.
  const startIdx = lines.findIndex((l) => /^tracker:/.test(l));
  if (startIdx === -1) return null;
  const header = lines[startIdx];
  const inline = header.match(/^tracker:\s*(.+?)\s*$/);
  if (inline && inline[1] && inline[1] !== "null" && inline[1] !== "~") {
    // Inline scalar binding — unexpected shape; treat as no tracker.
    return null;
  }
  const result: FrontmatterTracker = {};
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s/.test(line)) break; // unindented → next top-level key
    const kv = line.match(/^\s+(\w+):\s*(.+?)\s*$/);
    if (kv) {
      const value = kv[2];
      result[kv[1]] = value === "null" || value === "~" ? null : value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// The probe's core scan predicate, lifted out of SKILL.md prose. Given an
// FR file body and a tracker-key (from the CLAUDE.md mode), returns the
// list of mismatched AC-<PREFIX>.<N> lines (empty array means the file
// passes the probe).
interface Mismatch {
  prefix: string;
  line: number;
  expected: string;
}

function scanGuessedTrackerIds(
  body: string,
  trackerKey: string,
): { status: "skip" | "scanned"; mismatches: Mismatch[] } {
  const binding = readTrackerBinding(body);
  if (!binding) {
    // AC-STE-87.8 case (d): FR with no bound tracker is skipped
    // (probe only runs on files that have a tracker.<key> to compare against).
    return { status: "skip", mismatches: [] };
  }
  const expected = binding[trackerKey];
  if (!expected || typeof expected !== "string") {
    return { status: "skip", mismatches: [] };
  }
  const lines = body.split("\n");
  const mismatches: Mismatch[] = [];
  const acRe = /AC-([A-Z][A-Z0-9]*-\d+)\.\d+/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    acRe.lastIndex = 0;
    while ((m = acRe.exec(line)) !== null) {
      if (m[1] !== expected) {
        mismatches.push({ prefix: m[1], line: i + 1, expected });
      }
    }
  }
  return { status: "scanned", mismatches };
}

// Isolate probe #15's prose block. The block ends at whichever comes
// first: the next numbered probe (`\n16.`, `\n17.`, …) so a future
// probe #16 doesn't bleed in, or the next `##`/`###` heading so a
// footer rename (e.g., "Full details:") doesn't silently swallow
// probe-15 assertions. Same-shape boundary as the probe #14 block
// in gate-check-active-ticket-drift.test.ts.
function probe15Block(body: string): string {
  const idx = body.search(/15\.\s+\*\*Guessed tracker-ID scan/i);
  expect(idx).toBeGreaterThan(-1);
  const remainder = body.slice(idx + 1);
  const nextRel = remainder.search(/\n(?:\d+\.\s|##\s|###\s)/);
  return nextRel === -1 ? body.slice(idx) : body.slice(idx, idx + 1 + nextRel);
}

describe("AC-STE-87.8 — probe #15 prose shape in gate-check SKILL.md", () => {
  test("SKILL.md contains a probe #15 heading with 'Guessed tracker-ID scan' substring", () => {
    const body = readGateCheck();
    expect(body).toMatch(/15\.\s+\*\*Guessed tracker-ID scan/i);
  });

  test("probe #15 references AC-<PREFIX>.<N> shape and tracker.<key> comparison", () => {
    const block = probe15Block(readGateCheck());
    expect(block).toMatch(/AC-<?PREFIX>?/);
    expect(block).toMatch(/tracker\.<?key>?/);
  });

  test("probe #15 documents the NFR-10 remedy for guessed-ID substitution", () => {
    // The remedy must mention the <tracker-id> placeholder convention
    // (STE-66) so the operator knows how to fix the offending file.
    const block = probe15Block(readGateCheck());
    expect(block).toMatch(/<tracker-id>/);
    expect(block).toMatch(/STE-66|placeholder/i);
  });

  test("probe #15 documents the mode: none skip (carve-out to STE-50 ac_prefix probe)", () => {
    const block = probe15Block(readGateCheck());
    expect(block).toMatch(/mode:\s*none/i);
    expect(block).toMatch(/STE-50|ac_prefix|short-ULID/i);
  });
});

describe("AC-STE-87.8(a) — positive match: prefix equals bound tracker", () => {
  test("FR with tracker.linear=STE-87 and AC-STE-87.1 passes", () => {
    const body = [
      "---",
      "title: example",
      "milestone: M24",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: STE-87",
      "created_at: 2026-04-24T00:00:00Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-87.1: first criterion",
      "- AC-STE-87.2: second criterion",
      "",
    ].join("\n");
    const result = scanGuessedTrackerIds(body, "linear");
    expect(result.status).toBe("scanned");
    expect(result.mismatches).toEqual([]);
  });
});

describe("AC-STE-87.8(b) — negative: prefix-vs-tracker mismatch fails", () => {
  test("FR with tracker.linear=STE-87 but AC-STE-88.1 fails with expected=STE-87", () => {
    const body = [
      "---",
      "title: example",
      "milestone: M24",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: STE-87",
      "created_at: 2026-04-24T00:00:00Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-88.1: guessed wrong ID",
      "- AC-STE-87.2: correct",
      "",
    ].join("\n");
    const result = scanGuessedTrackerIds(body, "linear");
    expect(result.status).toBe("scanned");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].prefix).toBe("STE-88");
    expect(result.mismatches[0].expected).toBe("STE-87");
    // Mismatch row must surface a resolvable line number for the GATE FAILED report.
    expect(result.mismatches[0].line).toBeGreaterThan(0);
  });

  test("multiple guessed prefixes all surface as separate mismatches", () => {
    const body = [
      "---",
      "title: example",
      "milestone: M24",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: STE-87",
      "created_at: 2026-04-24T00:00:00Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-88.1: wrong",
      "- AC-STE-99.5: also wrong",
      "",
    ].join("\n");
    const result = scanGuessedTrackerIds(body, "linear");
    expect(result.mismatches).toHaveLength(2);
    const prefixes = result.mismatches.map((m) => m.prefix).sort();
    expect(prefixes).toEqual(["STE-88", "STE-99"]);
  });
});

describe("AC-STE-87.8(c) — mode: none skip (prose-level)", () => {
  test("probe prose says the scan is skipped for mode: none", () => {
    // The skip logic lives in the SKILL.md prose — this case reads the
    // prose to confirm the carve-out is present (negative assertion that
    // complements the positive scan behavior above).
    const block = probe15Block(readGateCheck());
    expect(block).toMatch(/Skipped for .mode:\s*none./i);
  });
});

describe("AC-STE-87.8(d) — FR with no bound tracker is skipped", () => {
  test("FR whose frontmatter has no tracker.<key> binding returns status: skip", () => {
    // In tracker mode, an FR with a null/absent tracker binding is not a
    // valid active-FR shape — probe #15 scopes itself only to FRs that
    // have a bound ref to compare against (STE-87 skips them silently;
    // other probes catch the missing-tracker issue separately).
    const body = [
      "---",
      "title: example",
      "milestone: M24",
      "status: active",
      "archived_at: null",
      "tracker: null",
      "created_at: 2026-04-24T00:00:00Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-88.1: would have mismatched but file has no tracker",
      "",
    ].join("\n");
    const result = scanGuessedTrackerIds(body, "linear");
    expect(result.status).toBe("skip");
    expect(result.mismatches).toEqual([]);
  });

  test("FR with tracker binding for a different tracker key is skipped", () => {
    // Multi-tracker scenario: jira-bound FR scanned under linear mode → skip.
    const body = [
      "---",
      "title: example",
      "milestone: M24",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  jira: PROJ-42",
      "created_at: 2026-04-24T00:00:00Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-PROJ-42.1: correct for jira",
      "",
    ].join("\n");
    const result = scanGuessedTrackerIds(body, "linear");
    expect(result.status).toBe("skip");
  });
});

describe("AC-STE-87.8(e) — probe authoring contract lists probe #15", () => {
  test("SKILL.md probe authoring contract references gate-check-guessed-tracker-id.test.ts", () => {
    const body = readGateCheck();
    // STE-82 authoring contract: every probe names its test file so the
    // pair can't silently drift apart.
    expect(body).toMatch(/gate-check-guessed-tracker-id\.test\.ts/);
  });
});

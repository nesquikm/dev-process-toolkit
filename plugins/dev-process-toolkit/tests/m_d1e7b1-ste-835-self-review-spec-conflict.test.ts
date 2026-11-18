// Meta-tests for STE-835 (M_d1e7b1) — /implement's Phase 3 self-review stops
// before it edits the FR. A finding that conflicts with the FR's text ends the
// round as an escalation instead of rewriting the spec.
//
//   - AC-STE-835.1: skills/implement/SKILL.md Phase 3 says a finding that
//     conflicts with the FR's Acceptance Criteria, Technical Design or Testing
//     section never edits the FR file; the round ends as an escalation that
//     names the FR section and the finding.
//   - AC-STE-835.2: the escalation emits `implement_spec_conflict_escalated`,
//     registered in CANONICAL_CAPABILITY_KEYS with `spec-write` as its owner (amended),
//     and carries a remedy row: run `/spec-write <FR-id>`, which syncs the
//     tracker.
//   - AC-STE-835.3: docs/implement-reference.md § Phase 3 carries the same rule
//     and the reason (an FR edited mid-run leaves the tracker description
//     stale).
//   - AC-STE-835.4 is the whole-suite gate, verified by the orchestrator.
//
// Assertions are phrase/token literals; they never require STE-/AC- tokens
// in skills/** prose.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  KEY_OWNER_SKILL,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");

const implementBody = readFileSync(
  join(pluginRoot, "skills", "implement", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);
const referenceBody = readFileSync(
  join(pluginRoot, "docs", "implement-reference.md"),
  "utf8",
);

const TOKEN = "implement_spec_conflict_escalated";
const FR_SECTIONS = ["Acceptance Criteria", "Technical Design", "Testing"];

// Slice `body` from the first match of `start` up to (not including) the first
// match of `end` after it. Fails loudly when either anchor is missing.
function section(body: string, start: RegExp, end: RegExp): string {
  const s = body.search(start);
  expect(s).toBeGreaterThan(-1);
  const tail = body.slice(s);
  // Search for the end only past the start's own line, so a heading cannot
  // close its own section (a sliced `#### X` reads `### X`).
  const skip = tail.indexOf("\n") + 1;
  expect(skip).toBeGreaterThan(0);
  const e = tail.slice(skip).search(end);
  expect(e).toBeGreaterThan(-1);
  return tail.slice(0, skip + e);
}

// Paragraphs (blank-line separated blocks) of `text` matching every pattern.
function paragraphsMatching(text: string, ...patterns: RegExp[]): string[] {
  return text
    .split(/\n\s*\n/)
    .filter((p) => patterns.every((re) => re.test(p)));
}

const NEVER_EDITS_FR = /never edits? the FR file/i;
const CONFLICT = /conflict/i;

// /implement Phase 3: from its heading up to the Phase 4 heading.
const implementPhase3 = section(
  implementBody,
  /^## Phase 3: Self-Review Loop/m,
  /^## Phase 4\b/m,
);

// The one Phase 3 paragraph carrying the conflict rule.
function implementConflictParagraph(): string {
  const hits = paragraphsMatching(implementPhase3, CONFLICT, NEVER_EDITS_FR);
  expect(hits.length).toBeGreaterThan(0);
  return hits[0]!;
}

// docs/implement-reference.md § Phase 3: every `## ` section whose heading
// names Phase 3, joined.
function referencePhase3(): string {
  const parts = referenceBody
    .split(/^(?=## )/m)
    .filter((part) => /^## [^\n]*Phase 3\b/.test(part));
  expect(parts.length).toBeGreaterThan(0);
  return parts.join("\n\n");
}

// -----------------------------------------------------------------------------
// AC-STE-835.1 — /implement Phase 3 rule
// -----------------------------------------------------------------------------

describe("AC-STE-835.1 — /implement Phase 3: a spec conflict never edits the FR", () => {
  test("Phase 3 says a conflicting finding never edits the FR file", () => {
    expect(
      paragraphsMatching(implementPhase3, CONFLICT, NEVER_EDITS_FR).length,
    ).toBeGreaterThan(0);
  });

  test("the rule names the Acceptance Criteria, Technical Design and Testing sections", () => {
    const p = implementConflictParagraph();
    for (const name of FR_SECTIONS) {
      expect(p).toContain(name);
    }
  });

  test("the round ends as an escalation", () => {
    expect(implementConflictParagraph()).toMatch(/escalat/i);
  });

  test("the escalation names the FR section and the finding", () => {
    const p = implementConflictParagraph();
    expect(p).toMatch(/names? the FR section/i);
    expect(p).toMatch(/\bfinding\b/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-835.2 — capability token, registry, remedy row
// -----------------------------------------------------------------------------

describe("AC-STE-835.2 — the escalation emits a registered token with a remedy", () => {
  test("the Phase 3 conflict rule MUST emit implement_spec_conflict_escalated", () => {
    expect(implementConflictParagraph()).toContain(`**MUST emit \`${TOKEN}\`**`);
  });

  // AC-STE-835.2 as amended: the owner probe reads /spec-write only, so this pin is what
  // guards the directive at its real emission site. Located by anchor (the paragraph that
  // names the conflict rule inside Phase 3), never by line number.
  test("MUTATION: deleting the /implement Phase 3 directive turns the emission-site pin red", () => {
    const directive = `**MUST emit \`${TOKEN}\`**`;
    const para = implementConflictParagraph();
    expect(para).toContain(directive);
    const mutated = implementPhase3.replace(directive, "");
    expect(mutated).not.toBe(implementPhase3);
    const hits = paragraphsMatching(mutated, CONFLICT, NEVER_EDITS_FR);
    expect(hits.some((p) => p.includes(directive))).toBe(false);
  });

  test("CANONICAL_CAPABILITY_KEYS includes implement_spec_conflict_escalated", () => {
    expect([...CANONICAL_CAPABILITY_KEYS] as string[]).toContain(TOKEN);
  });

  test("KEY_OWNER_SKILL routes implement_spec_conflict_escalated to spec-write", () => {
    // AC-STE-835.2 as amended: owner spec-write, the convention for every token /implement emits.
    expect((KEY_OWNER_SKILL as Record<string, string>)[TOKEN]).toBe("spec-write");
  });

  test("/spec-write SKILL.md carries a literal MUST-emit directive for the token", () => {
    // The registry round-trips with /spec-write's MUST-emit directive set.
    expect(specWriteBody).toMatch(
      new RegExp("MUST emit\\s*`" + TOKEN + "`"),
    );
  });

  test("/spec-write § 7 static map row names the token and the /spec-write <FR-id> remedy", () => {
    const map = specWriteStep7Map(specWriteBody);
    const row = map
      .split("\n")
      .find((line) => new RegExp("^\\|[^|]*`" + TOKEN + "`[^|]*\\|").test(line));
    expect(row).toBeString();
    const prose = (row as string).split("|").slice(2).join("|");
    expect(prose).toContain("/spec-write <FR-id>");
  });

  test("the remedy row says /spec-write syncs the tracker", () => {
    const map = specWriteStep7Map(specWriteBody);
    const row = map
      .split("\n")
      .find((line) => new RegExp("^\\|[^|]*`" + TOKEN + "`[^|]*\\|").test(line));
    expect(row).toBeString();
    const prose = (row as string).split("|").slice(2).join("|");
    expect(prose).toMatch(/sync[^|]{0,60}tracker/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-835.3 — docs/implement-reference.md § Phase 3
// -----------------------------------------------------------------------------

describe("AC-STE-835.3 — implement-reference § Phase 3 carries the rule and the reason", () => {
  test("§ Phase 3 says a conflicting finding never edits the FR file", () => {
    expect(
      paragraphsMatching(referencePhase3(), CONFLICT, NEVER_EDITS_FR).length,
    ).toBeGreaterThan(0);
  });

  test("§ Phase 3 names the three FR sections in the rule", () => {
    const hits = paragraphsMatching(referencePhase3(), CONFLICT, NEVER_EDITS_FR);
    expect(hits.length).toBeGreaterThan(0);
    for (const name of FR_SECTIONS) {
      expect(hits[0]!).toContain(name);
    }
  });

  test("§ Phase 3 gives the reason: an FR edited mid-run leaves the tracker description stale", () => {
    const text = referencePhase3();
    expect(text).toMatch(/mid-run/i);
    expect(text).toMatch(/tracker description[^\n]{0,80}stale|stale[^\n]{0,80}tracker description/i);
  });
});

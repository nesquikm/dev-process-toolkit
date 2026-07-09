// Meta-tests for STE-373 (M100) — deps-research fork enforcement parity.
//
// Prose / registry contracts asserted (probe behavior lives in the two
// dedicated probe-test files):
//   - AC-STE-373.2: /brainstorm Step 1.5b + /spec-write § 0b step 2.5b
//     persist the returned fork block to
//     `.dpt-locks/<ulid>/deps-research-result.txt`.
//   - AC-STE-373.3: agents/deps-researcher.md references the real
//     `deps_research_result_shape` probe and drops the phantom-probe
//     "operator-judgment, not runtime-enforced" phrasing.
//   - AC-STE-373.4: both skip tokens registered in
//     CANONICAL_CAPABILITY_KEYS, present in both parent skills, and in
//     the /spec-write § 7 static plain-language map.
//   - AC-STE-373.5: both parent skills carry the complete legal
//     disposition set with literal MUST-emit directives for both skip
//     tokens; no compromised/injected/disabled token.
//   - AC-STE-373.6: both parent skills carry the anti-cascade rule.
//   - AC-STE-373.8: the FR § Notes documents the STE-318 reversal.
//
// IMPORTANT: assertions are phrase/token literals — they never require
// STE-/AC-namespace tokens in skills/** prose (a separate shipped-prose
// ceiling test caps those counts).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const brainstormBody = readFileSync(
  join(pluginRoot, "skills", "brainstorm", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);
const depsAgentBody = readFileSync(
  join(pluginRoot, "agents", "deps-researcher.md"),
  "utf8",
);
// Resolve the FR from its active path, falling back to the archive path once
// the milestone has been archived (the meta-test must survive its own FR's
// /implement Phase 4 archival — active FR files are git mv'd into archive/).
const frActivePath = join(repoRoot, "specs", "frs", "STE-373.md");
const frArchivedPath = join(repoRoot, "specs", "frs", "archive", "STE-373.md");
const frBody = readFileSync(
  existsSync(frActivePath) ? frActivePath : frArchivedPath,
  "utf8",
);

const SKIP_MANIFEST = "deps_research_skipped_no_manifest";
const SKIP_TECH = "deps_research_skipped_no_tech";
const LEGAL_SET = [
  "deps_research_invoked",
  "deps_research_no_matches",
  "deps_research_shape_violation",
  SKIP_MANIFEST,
  SKIP_TECH,
];

const PARENT_SKILLS: ReadonlyArray<[string, string]> = [
  ["brainstorm", brainstormBody],
  ["spec-write", specWriteBody],
];

const backticked = (body: string, token: string): boolean =>
  body.includes(`\`${token}\``);

// -----------------------------------------------------------------------------
// AC-STE-373.2 — block persistence to .dpt-locks/<ulid>/deps-research-result.txt.
// -----------------------------------------------------------------------------

describe("AC-STE-373.2 — deps-research block persistence", () => {
  for (const [name, body] of PARENT_SKILLS) {
    test(`${name} SKILL.md names the .dpt-locks/<ulid>/deps-research-result.txt path`, () => {
      expect(body).toMatch(
        /\.dpt-locks\/(?:<ulid>|\{ulid\}|[^\/\s`]+)\/deps-research-result\.txt/,
      );
    });

    test(`${name} SKILL.md describes persisting/writing the returned block to that path`, () => {
      expect(body).toMatch(
        /(persist|writ|record|sav)[\s\S]{0,240}deps-research-result\.txt|deps-research-result\.txt[\s\S]{0,240}(persist|writ|record|sav)/i,
      );
    });
  }
});

// -----------------------------------------------------------------------------
// AC-STE-373.3 — kill the phantom-probe reference in the agent file.
// -----------------------------------------------------------------------------

describe("AC-STE-373.3 — deps-researcher.md references the real probe", () => {
  test("agent file references the now-real deps_research_result_shape probe", () => {
    expect(depsAgentBody).toContain("deps_research_result_shape");
  });

  test('agent file no longer claims "operator-judgment, not runtime-enforced"', () => {
    expect(depsAgentBody).not.toContain("operator-judgment, not runtime-enforced");
  });
});

// -----------------------------------------------------------------------------
// AC-STE-373.4 — skip-disposition tokens registered.
// -----------------------------------------------------------------------------

describe("AC-STE-373.4 — skip tokens registered", () => {
  const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];

  test("CANONICAL_CAPABILITY_KEYS includes deps_research_skipped_no_manifest", () => {
    expect(keys).toContain(SKIP_MANIFEST);
  });

  test("CANONICAL_CAPABILITY_KEYS includes deps_research_skipped_no_tech", () => {
    expect(keys).toContain(SKIP_TECH);
  });

  test("/spec-write § 7 static map carries both skip-token rows", () => {
    const map = specWriteStep7Map(specWriteBody);
    expect(backticked(map, SKIP_MANIFEST)).toBe(true);
    expect(backticked(map, SKIP_TECH)).toBe(true);
  });

  for (const [name, body] of PARENT_SKILLS) {
    test(`${name} SKILL.md mentions both skip token names`, () => {
      expect(body).toContain(SKIP_MANIFEST);
      expect(body).toContain(SKIP_TECH);
    });
  }
});

// -----------------------------------------------------------------------------
// AC-STE-373.5 — complete legal disposition set (MUST-emit).
// -----------------------------------------------------------------------------

describe("AC-STE-373.5 — complete MUST-emit disposition set", () => {
  for (const [name, body] of PARENT_SKILLS) {
    test(`${name} carries literal MUST emit \`${SKIP_MANIFEST}\``, () => {
      expect(body).toMatch(
        new RegExp(`MUST emit\\s*\`${SKIP_MANIFEST}\``),
      );
    });

    test(`${name} carries literal MUST emit \`${SKIP_TECH}\``, () => {
      expect(body).toMatch(new RegExp(`MUST emit\\s*\`${SKIP_TECH}\``));
    });

    test(`${name} enumerates the complete 5-token legal set (backticked)`, () => {
      for (const token of LEGAL_SET) {
        expect(backticked(body, token)).toBe(true);
      }
    });

    test(`${name} introduces no compromised/injected/disabled disposition token`, () => {
      expect(body).not.toMatch(
        /deps_research[a-z_]*(compromised|injected|disabled)/,
      );
    });
  }
});

// -----------------------------------------------------------------------------
// AC-STE-373.6 — no cross-invocation belief (anti-cascade).
// -----------------------------------------------------------------------------

describe("AC-STE-373.6 — anti-cascade rule", () => {
  for (const [name, body] of PARENT_SKILLS) {
    test(`${name} carries anti-cascade prose tied to a shape violation`, () => {
      const hasRule =
        /never disables the fork/i.test(body) ||
        /no cross-invocation belief/i.test(body);
      expect(hasRule).toBe(true);
      expect(body).toMatch(/shape.?violation/i);
    });
  }
});

// -----------------------------------------------------------------------------
// AC-STE-373.8 — reversal is documented in the FR § Notes.
// -----------------------------------------------------------------------------

describe("AC-STE-373.8 — STE-318 reversal documented", () => {
  test("§ Notes names STE-318, the reversal, and the 2026-07-09 incident", () => {
    const notesStart = frBody.indexOf("## Notes");
    expect(notesStart).toBeGreaterThan(-1);
    const notes = frBody.slice(notesStart);
    expect(notes).toContain("STE-318");
    expect(notes).toMatch(/reverses/i);
    expect(notes).toContain("2026-07-09");
  });
});

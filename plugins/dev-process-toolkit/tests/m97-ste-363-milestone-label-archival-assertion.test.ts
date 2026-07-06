// Meta-tests for STE-363 — archival-time milestone-label assertion (M97).
//
// Prose contracts asserted:
//   - AC-STE-363.1: skills/spec-archive/SKILL.md wires the shared helper
//     `assertMilestoneBindingAtArchive` (adapters/_shared/src/
//     assert_milestone_binding_at_archive.ts) into BOTH archival paths
//     (single-FR and milestone-group), and skills/implement/SKILL.md wires it
//     into § Milestone Archival (Phase-4-close), before the git mv flip.
//   - AC-STE-363.2: refusal semantics live in prose — NFR-10 message at the
//     archival boundary; the milestone-group path skips only the offending FR
//     and reports it; the Diff Preview lists the per-FR assertion outcome.
//   - AC-STE-363.3: FR-backed-only scope statement — the assertion iterates
//     the FR files being archived; it never enumerates the tracker board.
//   - AC-STE-363.5: two new capability tokens
//     (`milestone_label_asserted_at_archive` /
//     `milestone_label_archive_refused`) carried in /spec-write § 7's static
//     map, registered in CANONICAL_CAPABILITY_KEYS, with literal MUST-emit
//     directives in BOTH /spec-archive and /implement so /gate-check's
//     closing_summary_capability_keys probe enforces them.
//
// IMPORTANT: assertions here are phrase/token literals only — they never
// require STE-/AC-namespace tokens in skills/** prose (the shipped-prose
// ceiling test caps those counts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");

const specArchiveBody = readFileSync(
  join(pluginRoot, "skills", "spec-archive", "SKILL.md"),
  "utf8",
);
const implementBody = readFileSync(
  join(pluginRoot, "skills", "implement", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);

const HELPER = "assertMilestoneBindingAtArchive";
const HELPER_PATH = "adapters/_shared/src/assert_milestone_binding_at_archive.ts";
const ASSERTED = "milestone_label_asserted_at_archive";
const REFUSED = "milestone_label_archive_refused";

// Directive shape matching /gate-check's closing_summary_capability_keys
// probe (buildMustEmitRegex): literal backticked token — paraphrase without
// backticks does not satisfy it.
function mustEmitRe(key: string): RegExp {
  return new RegExp(`MUST emit\\s*\`${key}\``);
}

/** spec-archive § 1 Archival procedure — heading through the § 2 sibling. */
function specArchiveArchivalProcedure(): string {
  const start = specArchiveBody.indexOf("### 1. Archival procedure");
  expect(start).toBeGreaterThan(-1);
  const end = specArchiveBody.indexOf("### 2.", start);
  expect(end).toBeGreaterThan(start);
  return specArchiveBody.slice(start, end);
}

/** spec-archive single-FR archival block. */
function singleFrBlock(): string {
  const section = specArchiveArchivalProcedure();
  const start = section.indexOf("**Single-FR archival**");
  expect(start).toBeGreaterThan(-1);
  const end = section.indexOf("**Milestone-group archival**", start);
  expect(end).toBeGreaterThan(start);
  return section.slice(start, end);
}

/** spec-archive milestone-group archival block. */
function milestoneGroupBlock(): string {
  const section = specArchiveArchivalProcedure();
  const start = section.indexOf("**Milestone-group archival**");
  expect(start).toBeGreaterThan(-1);
  const end = section.indexOf("**Plan-only archival**", start);
  expect(end).toBeGreaterThan(start);
  return section.slice(start, end);
}

/** implement § Milestone Archival — heading through the next H2. */
function implementMilestoneArchival(): string {
  const start = implementBody.indexOf("### Milestone Archival");
  expect(start).toBeGreaterThan(-1);
  const end = implementBody.indexOf("\n## ", start);
  expect(end).toBeGreaterThan(start);
  return implementBody.slice(start, end);
}

describe("AC-STE-363.1 — assertion wired at both archival surfaces", () => {
  test("spec-archive single-FR path calls the helper", () => {
    expect(singleFrBlock()).toContain(HELPER);
  });

  test("spec-archive milestone-group path calls the helper", () => {
    expect(milestoneGroupBlock()).toContain(HELPER);
  });

  test("spec-archive cites the shared helper module path", () => {
    expect(specArchiveBody).toContain(HELPER_PATH);
  });

  test("implement § Milestone Archival calls the helper before the archival sweep", () => {
    expect(implementMilestoneArchival()).toContain(HELPER);
  });

  test("implement cites the shared helper module path", () => {
    expect(implementBody).toContain(HELPER_PATH);
  });
});

describe("AC-STE-363.2 — refusal semantics in prose", () => {
  test("spec-archive archival procedure names the NFR-10 refusal at the boundary", () => {
    expect(specArchiveArchivalProcedure()).toContain("NFR-10");
  });

  test("milestone-group path skips only the offending FR and reports it", () => {
    expect(milestoneGroupBlock()).toMatch(/offending FR/);
  });

  test("spec-archive Diff Preview lists the per-FR assertion outcome", () => {
    expect(specArchiveBody).toMatch(/assertion outcome/i);
  });

  test("implement § Milestone Archival names the refusal token (refusal blocks that FR's archival)", () => {
    expect(implementMilestoneArchival()).toContain(REFUSED);
  });
});

describe("AC-STE-363.3 — FR-backed scope statement", () => {
  test("spec-archive states the FR-backed-only scope", () => {
    expect(specArchiveBody).toContain("FR-backed");
  });

  test("spec-archive states the assertion never enumerates the tracker board", () => {
    expect(specArchiveBody).toMatch(/never enumerat\w* the tracker board/i);
  });

  test("implement states the FR-backed-only scope", () => {
    expect(implementBody).toContain("FR-backed");
  });
});

describe("AC-STE-363.5 — capability tokens (static map + registry + MUST-emit directives)", () => {
  test("spec-write § 7 static capability map carries the asserted-at-archive row", () => {
    expect(specWriteStep7Map(specWriteBody)).toContain(`\`${ASSERTED}\``);
  });

  test("spec-write § 7 static capability map carries the archive-refused row", () => {
    expect(specWriteStep7Map(specWriteBody)).toContain(`\`${REFUSED}\``);
  });

  test("both keys registered in CANONICAL_CAPABILITY_KEYS so the gate-check probe enforces them", () => {
    const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];
    expect(keys).toContain(ASSERTED);
    expect(keys).toContain(REFUSED);
  });

  test("spec-archive carries the MUST-emit directive for the asserted token", () => {
    expect(specArchiveBody).toMatch(mustEmitRe(ASSERTED));
  });

  test("spec-archive carries the MUST-emit directive for the refused token", () => {
    expect(specArchiveBody).toMatch(mustEmitRe(REFUSED));
  });

  test("implement carries the MUST-emit directive for the asserted token", () => {
    expect(implementBody).toMatch(mustEmitRe(ASSERTED));
  });

  test("implement carries the MUST-emit directive for the refused token", () => {
    expect(implementBody).toMatch(mustEmitRe(REFUSED));
  });
});

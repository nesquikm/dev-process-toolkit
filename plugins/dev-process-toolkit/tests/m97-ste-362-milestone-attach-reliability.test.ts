// Meta-tests for STE-362 — reliable milestone-label landing at attach time
// (M97).
//
// Prose contracts asserted:
//   - AC-STE-362.2: skills/implement/SKILL.md § 0.e states the milestone
//     attach + verify runs PER FR on the milestone-scope path (the
//     `/implement M<N>` fan-out), before each FR's Phase 4 close — closing
//     the ambiguity that let a milestone-scope-built ticket skip § 0.e.
//   - AC-STE-362.3: `milestone_attach_failed` is a loud (severity >=
//     warning) capability row: present in skills/spec-write/SKILL.md § 7's
//     static plain-language map, backed by literal MUST-emit directives in
//     BOTH /spec-write and /implement (scoped to permanent failure), and
//     registered in CANONICAL_CAPABILITY_KEYS so /gate-check's
//     closing_summary_capability_keys probe enforces the directive (the
//     probe's reverse orphan leg also requires the const registration once
//     the spec-write directive lands).
//   - Spec-is-source-of-truth invariant preserved: permanent attach failure
//     still writes the FR file (not rolled back) — the milestone-attachment
//     prose keeps that sentence AND names the loud token.
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

const implementBody = readFileSync(
  join(pluginRoot, "skills", "implement", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);

const KEY = "milestone_attach_failed";
// Directive shape matching /gate-check's closing_summary_capability_keys
// probe (buildMustEmitRegex): literal backticked token — paraphrase without
// backticks does not satisfy it.
const MUST_EMIT_RE = /MUST emit\s*`milestone_attach_failed`/;

/** implement SKILL.md § 0.e — from its bold heading to the 0.f sibling. */
function implementStep0e(): string {
  const start = implementBody.indexOf("**0.e Project-milestone attach");
  expect(start).toBeGreaterThan(-1);
  const end = implementBody.indexOf("**0.f", start);
  expect(end).toBeGreaterThan(start);
  return implementBody.slice(start, end);
}

/** Every line of `body` carrying a MUST-emit directive for KEY. */
function mustEmitLines(body: string): string[] {
  return body.split("\n").filter((l) => MUST_EMIT_RE.test(l));
}

describe("AC-STE-362.2 — implement § 0.e: all-/implement/-paths attach guarantee", () => {
  test("§ 0.e names the milestone-scope path (not only single-FR resolve)", () => {
    expect(implementStep0e()).toContain("milestone-scope");
  });

  test("§ 0.e states the attach + verify runs per FR on the fan-out", () => {
    expect(implementStep0e()).toMatch(/per[- ]FR/i);
  });

  test("§ 0.e anchors the guarantee before the FR's Phase 4 close", () => {
    expect(implementStep0e()).toContain("Phase 4");
  });
});

describe("AC-STE-362.3 — loud permanent-failure surface (milestone_attach_failed)", () => {
  test("spec-write § 7 static capability map carries a milestone_attach_failed row", () => {
    const map = specWriteStep7Map(specWriteBody);
    expect(map).toContain(`\`${KEY}\``);
  });

  test("the § 7 map row is loud (severity >= warning), not a plain informational line", () => {
    const map = specWriteStep7Map(specWriteBody);
    const row = map
      .split("\n")
      .find((l) => l.trim().startsWith("|") && l.includes(`\`${KEY}\``));
    expect(row).toBeDefined();
    expect(row!).toMatch(/warning/i);
  });

  test("spec-write carries the MUST-emit directive, scoped to permanent failure", () => {
    const lines = mustEmitLines(specWriteBody);
    expect(lines.length).toBeGreaterThan(0);
    // The directive fires only on PERMANENT failure (retries exhausted or
    // non-transient mismatch) — never on success or capability-skip paths
    // (AC-STE-362.4 vacuity: no row on mode:none / project_milestone:false).
    expect(lines.some((l) => /permanent|exhausted/i.test(l))).toBe(true);
  });

  test("implement carries the MUST-emit directive, scoped to permanent failure", () => {
    const lines = mustEmitLines(implementBody);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => /permanent|exhausted/i.test(l))).toBe(true);
  });

  test("key registered in CANONICAL_CAPABILITY_KEYS so the gate-check probe enforces it", () => {
    // Forward leg: the probe greps the owner SKILL.md for the directive.
    // Reverse leg: an unregistered directive in spec-write would fire the
    // orphan-directive violation — registration is load-bearing both ways.
    expect([...CANONICAL_CAPABILITY_KEYS] as string[]).toContain(KEY);
  });

  test("milestone-attachment prose keeps spec-is-source-of-truth AND names the loud token", () => {
    const start = specWriteBody.indexOf("**Milestone attachment");
    expect(start).toBeGreaterThan(-1);
    const end = specWriteBody.indexOf("\n\n", start);
    const section = specWriteBody.slice(start, end === -1 ? specWriteBody.length : end);
    // Invariant retained: permanent failure still writes the FR file.
    expect(section).toContain("not rolled back");
    // New contract: the permanent-failure outcome routes to the loud row.
    expect(section).toContain(KEY);
  });
});

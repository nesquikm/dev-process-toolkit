// Meta-tests for STE-752 (M_d1e7b1) — a --no-tech run names its legal
// spec-research skip with `spec_research_skipped_no_tech`, mirroring the
// deps-research `deps_research_skipped_no_tech` disposition.
//
//   - AC-STE-752.1: /spec-write step 2.5 MUST-emits the skip token and states
//     the complete four-token set for the step.
//   - AC-STE-752.2: /brainstorm § 1.5 says the same.
//   - AC-STE-752.3: the key is registered in CANONICAL_CAPABILITY_KEYS with
//     its owner, and /spec-write's § 7 static map carries a row for it.
//   - AC-STE-752.4: the smoke group-4 `--no-tech` spec-write capture asserts
//     `present spec_research_skipped_no_tech`.
//   - AC-STE-752.5 is the whole-suite gate, verified by the orchestrator.
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
const repoRoot = join(pluginRoot, "..", "..");

const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);
const brainstormBody = readFileSync(
  join(pluginRoot, "skills", "brainstorm", "SKILL.md"),
  "utf8",
);
const smokeBody = readFileSync(
  join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
  "utf8",
);

const SKIP_TECH = "spec_research_skipped_no_tech";
const FOUR_TOKEN_SET = [
  "spec_research_invoked",
  "spec_research_no_matches",
  "spec_research_shape_violation",
  SKIP_TECH,
];

const mustEmit = (token: string): string => `**MUST emit \`${token}\`**`;

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

// /spec-write step 2.5: from the spec-research seed marker up to the
// deps-research seed (step 2.5b) marker.
const specWriteStep25 = section(
  specWriteBody,
  /\*\*Spec-research seed \(/,
  /\*\*Deps-research seed \(/,
);

// /brainstorm § 1.5: from its heading up to the § 1.5b heading.
const brainstormStep15 = section(
  brainstormBody,
  /^### 1\.5\. Spec-research seed/m,
  /^### 1\.5b\. /m,
);

// -----------------------------------------------------------------------------
// AC-STE-752.1 — /spec-write step 2.5
// -----------------------------------------------------------------------------

describe("AC-STE-752.1 — /spec-write step 2.5 names the --no-tech skip", () => {
  test("step 2.5 says a --no-tech run MUST emit spec_research_skipped_no_tech", () => {
    expect(specWriteStep25).toContain(mustEmit(SKIP_TECH));
  });

  test("step 2.5 ties the skip token to the --no-tech run", () => {
    expect(specWriteStep25).toMatch(
      /--no-tech[^\n]{0,200}\*\*MUST emit `spec_research_skipped_no_tech`\*\*/,
    );
  });

  test("step 2.5 states the complete four-token set, each as a MUST-emit", () => {
    for (const token of FOUR_TOKEN_SET) {
      expect(specWriteStep25).toContain(mustEmit(token));
    }
  });

  test("step 2.5 counts the set as four tokens", () => {
    expect(specWriteStep25).toMatch(/\bfour\b[^\n]{0,80}tokens?/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-752.2 — /brainstorm § 1.5
// -----------------------------------------------------------------------------

describe("AC-STE-752.2 — /brainstorm § 1.5 names the --no-tech skip", () => {
  test("§ 1.5 says a --no-tech run MUST emit spec_research_skipped_no_tech", () => {
    expect(brainstormStep15).toContain(mustEmit(SKIP_TECH));
  });

  test("§ 1.5 ties the skip token to the --no-tech run", () => {
    expect(brainstormStep15).toMatch(
      /--no-tech[^\n]{0,200}\*\*MUST emit `spec_research_skipped_no_tech`\*\*/,
    );
  });

  test("§ 1.5 states the complete four-token set, each as a MUST-emit", () => {
    for (const token of FOUR_TOKEN_SET) {
      expect(brainstormStep15).toContain(mustEmit(token));
    }
  });

  test("§ 1.5 counts the set as four tokens", () => {
    expect(brainstormStep15).toMatch(/\bfour\b[^\n]{0,80}tokens?/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-752.3 — registry + static map
// -----------------------------------------------------------------------------

describe("AC-STE-752.3 — skip token registered with its owner and mapped", () => {
  test("CANONICAL_CAPABILITY_KEYS includes spec_research_skipped_no_tech", () => {
    expect([...CANONICAL_CAPABILITY_KEYS] as string[]).toContain(SKIP_TECH);
  });

  test("KEY_OWNER_SKILL routes spec_research_skipped_no_tech to spec-write", () => {
    expect((KEY_OWNER_SKILL as Record<string, string>)[SKIP_TECH]).toBe("spec-write");
  });

  test("/spec-write § 7 static map carries a row whose key cell names the token", () => {
    const map = specWriteStep7Map(specWriteBody);
    const row = map
      .split("\n")
      .find((line) => /^\|[^|]*`spec_research_skipped_no_tech`[^|]*\|/.test(line));
    expect(row).toBeString();
    // The rendered-prose cell explains the skip rather than staying empty.
    const prose = (row as string).split("|")[2] ?? "";
    expect(prose).toMatch(/--no-tech/);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-752.4 — smoke group 4 step 1 capture
// -----------------------------------------------------------------------------

describe("AC-STE-752.4 — smoke --no-tech spec-write capture asserts the token", () => {
  const group4 = section(
    smokeBody,
    /^#### Fixture group 4 — /m,
    /^#### Fixture group 5\b|^### /m,
  );

  test("group 4 asserts `present` spec_research_skipped_no_tech on the step-1 log", () => {
    expect(group4).toMatch(
      /present\s+\S*no-tech-step-1\.log\s+spec_research_skipped_no_tech\b/,
    );
  });
});

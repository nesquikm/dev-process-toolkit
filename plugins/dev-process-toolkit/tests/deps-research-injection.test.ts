// STE-301 AC-STE-301.13 / AC-STE-301.14 — `/dev-process-toolkit:deps-research`
// injection contract for /brainstorm + /spec-write.
//
// Two assertion modes:
//
//   (1) Doc-conformance against the shipped SKILL.md files (canonical files
//       in plugins/dev-process-toolkit/skills/{brainstorm,spec-write}/SKILL.md).
//       Verifies the Step 1.5b / step 2.5b prose exists and points at
//       `/dev-process-toolkit:deps-research`, the vacuous-paths (manifest
//       absent / empty) are documented, the --no-tech carve-out is documented,
//       the shape-violation fallback is documented, and the three new
//       capability keys appear in /spec-write § 7's static map.
//
//   (2) Capability-key registration in `CANONICAL_CAPABILITY_KEYS` from
//       `closing_summary_capability_keys.ts` — required by AC-STE-301.14
//       (key owner: spec-write).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const BRAINSTORM_PATH = join(PLUGIN_ROOT, "skills", "brainstorm", "SKILL.md");
const SPEC_WRITE_PATH = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

function readBrainstorm(): string {
  return readFileSync(BRAINSTORM_PATH, "utf-8");
}

function readSpecWrite(): string {
  return readFileSync(SPEC_WRITE_PATH, "utf-8");
}

// -----------------------------------------------------------------------------
// /brainstorm Step 1.5b — vacuous + happy-path + --no-tech (AC-STE-301.13).
// -----------------------------------------------------------------------------

describe("AC-STE-301.13 — /brainstorm Step 1.5b documents the deps-research injection", () => {
  test("Step 1.5b heading exists after Step 1.5 (spec-research seed)", () => {
    const text = readBrainstorm();
    const s15 = text.search(/###\s*1\.5\.\s+Spec-research seed/);
    const s15b = text.search(/###\s*1\.5b\./);
    expect(s15).toBeGreaterThan(-1);
    expect(s15b).toBeGreaterThan(s15);
  });

  test("Step 1.5b references /dev-process-toolkit:deps-research (forked invocation)", () => {
    const text = readBrainstorm();
    const start = text.search(/###\s*1\.5b\./);
    expect(start).toBeGreaterThan(-1);
    const tail = text.slice(start);
    expect(tail).toContain("/dev-process-toolkit:deps-research");
  });

  test("Step 1.5b documents the vacuous-path: skipped when specs/deps.yaml is absent or empty", () => {
    const text = readBrainstorm();
    const start = text.search(/###\s*1\.5b\./);
    expect(start).toBeGreaterThan(-1);
    const next = text.slice(start + 1).search(/###\s+\d/);
    const slice = text.slice(start, next === -1 ? text.length : start + 1 + next);
    expect(slice).toContain("specs/deps.yaml");
    expect(slice).toMatch(/absent|empty|zero entries|vacuous/i);
  });

  test("Step 1.5b documents the --no-tech carve-out", () => {
    const text = readBrainstorm();
    const start = text.search(/###\s*1\.5b\./);
    expect(start).toBeGreaterThan(-1);
    const next = text.slice(start + 1).search(/###\s+\d/);
    const slice = text.slice(start, next === -1 ? text.length : start + 1 + next);
    expect(slice).toMatch(/--no-tech/);
  });
});

// -----------------------------------------------------------------------------
// /spec-write § 0b step 2.5b — symmetric injection (AC-STE-301.14).
// -----------------------------------------------------------------------------

describe("AC-STE-301.14 — /spec-write § 0b step 2.5b documents the deps-research injection", () => {
  test("step 2.5b is present and references /dev-process-toolkit:deps-research", () => {
    const text = readSpecWrite();
    expect(text).toMatch(/2\.5b/);
    // The step references the forked skill.
    const idx = text.search(/2\.5b/);
    const tail = text.slice(idx);
    expect(tail).toContain("/dev-process-toolkit:deps-research");
  });

  test("step 2.5b sits between step 2.5 (spec-research) and step 3 (AC prefix)", () => {
    const text = readSpecWrite();
    // spec-research seed lives in step 2.5 (or a labeled "Spec-research seed").
    const seedIdx = text.search(/\*\*Spec-research seed/);
    const s25b = text.search(/2\.5b/);
    const s3 = text.search(/3\.\s*\*\*AC prefix\*\*/);
    expect(seedIdx).toBeGreaterThan(-1);
    expect(s25b).toBeGreaterThan(seedIdx);
    expect(s3).toBeGreaterThan(s25b);
  });

  test("step 2.5b documents the vacuous-path: skipped when specs/deps.yaml is absent or empty", () => {
    const text = readSpecWrite();
    const start = text.search(/2\.5b/);
    expect(start).toBeGreaterThan(-1);
    const slice = text.slice(start, start + 2000);
    expect(slice).toContain("specs/deps.yaml");
    expect(slice).toMatch(/absent|empty|zero entries|vacuous/i);
  });

  test("step 2.5b documents the shape-violation fallback (drop block, log capability row)", () => {
    const text = readSpecWrite();
    const start = text.search(/2\.5b/);
    expect(start).toBeGreaterThan(-1);
    const slice = text.slice(start, start + 2000);
    expect(slice).toMatch(/deps_research_shape_violation/);
  });
});

// -----------------------------------------------------------------------------
// /spec-write § 7 capability rows (AC-STE-301.14) — three new keys.
// -----------------------------------------------------------------------------

describe("AC-STE-301.14 — /spec-write § 7 capability rows", () => {
  test("`deps_research_invoked` key appears in /spec-write SKILL.md", () => {
    const text = readSpecWrite();
    expect(text).toContain("`deps_research_invoked`");
  });

  test("`deps_research_no_matches` key appears in /spec-write SKILL.md", () => {
    const text = readSpecWrite();
    expect(text).toContain("`deps_research_no_matches`");
  });

  test("`deps_research_shape_violation` key appears in /spec-write SKILL.md", () => {
    const text = readSpecWrite();
    expect(text).toContain("`deps_research_shape_violation`");
  });

  test("/spec-write SKILL.md carries MUST-emit directive for `deps_research_invoked` (STE-238 literal-token shape)", () => {
    const text = readSpecWrite();
    expect(text).toMatch(/MUST emit\s+`deps_research_invoked`/);
  });

  test("/spec-write SKILL.md carries MUST-emit directive for `deps_research_no_matches`", () => {
    const text = readSpecWrite();
    expect(text).toMatch(/MUST emit\s+`deps_research_no_matches`/);
  });

  test("/spec-write SKILL.md carries MUST-emit directive for `deps_research_shape_violation`", () => {
    const text = readSpecWrite();
    expect(text).toMatch(/MUST emit\s+`deps_research_shape_violation`/);
  });
});

// -----------------------------------------------------------------------------
// CANONICAL_CAPABILITY_KEYS registration — three new keys must be present.
// -----------------------------------------------------------------------------

describe("AC-STE-301.14 — CANONICAL_CAPABILITY_KEYS registers the three new keys", () => {
  test("`deps_research_invoked` is in CANONICAL_CAPABILITY_KEYS", () => {
    expect(
      (CANONICAL_CAPABILITY_KEYS as readonly string[]).includes(
        "deps_research_invoked",
      ),
    ).toBe(true);
  });

  test("`deps_research_no_matches` is in CANONICAL_CAPABILITY_KEYS", () => {
    expect(
      (CANONICAL_CAPABILITY_KEYS as readonly string[]).includes(
        "deps_research_no_matches",
      ),
    ).toBe(true);
  });

  test("`deps_research_shape_violation` is in CANONICAL_CAPABILITY_KEYS", () => {
    expect(
      (CANONICAL_CAPABILITY_KEYS as readonly string[]).includes(
        "deps_research_shape_violation",
      ),
    ).toBe(true);
  });
});

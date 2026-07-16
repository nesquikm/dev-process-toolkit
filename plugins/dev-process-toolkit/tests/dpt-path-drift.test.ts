import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNoRetiredLiterals, dptPathDriftScanTargets } from "./_dpt-path-drift";

// M104 AC-STE-384.1 regression — the retired `.dpt-locks` / `.dev-process` path
// literals may not reappear in the live tree. Fails loudly, naming every
// `file:line`, if any future change reintroduces one under docs, skills,
// adapters, templates, README.md, or the live cross-cutting spec files.
//
// The scan itself lives in `./_dpt-path-drift` rather than inline here: the
// same primitive is driven over fixture trees by
// `tests/m104-ste-384-dpt-path-drift.test.ts`, which is what proves this gate
// actually fires instead of merely never matching. Scope, patterns and
// exemptions (including why CHANGELOG.md and the spec archives are excluded)
// are all documented there.

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

describe("M104 AC-STE-384.1 — retired path literals are absent from the live tree", () => {
  test("the scan over the AC-STE-384.1 path set returns zero survivors", () => {
    const targets = dptPathDriftScanTargets(pluginRoot, repoRoot);
    // Guards vacuity: an empty or absent target list would pass trivially.
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(target)).toBe(true);
    }
    assertNoRetiredLiterals(targets);
  });
});

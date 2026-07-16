// STE-386 — /gate-check probe #67 `fr_summary_altitude`: wiring + dogfood.
// RED-state until the scanner module + the SKILL.md probe entry land.
//
// AC map:
//   AC-STE-386.3 — the scanner is wired as probe #67 (`fr_summary_altitude`,
//                  Severity: error) in the gate-check numbered probe list,
//                  following the existing probe-entry shape (call
//                  `scanFrSummaryAltitude(projectRoot)` from
//                  `adapters/_shared/src/scan_fr_summary_altitude.ts`;
//                  vacuity clause; test-coverage pointer).
//   AC-STE-386.5 — dogfood: the scanner runs clean over THIS repo's own
//                  active FRs (`specs/frs/*.md`) — the M105 FR summaries
//                  must clear their own probe.
//   AC-STE-386.6 — aggregate: this file + the bumped count-drift pins in
//                  tests/gate-check-public-surface-count-drift.test.ts going
//                  green is the byte-checkable slice of "full gate green".
//
// Sibling shape: tests/gate-check-public-surface-count-drift.test.ts (#57)
// and tests/gate-check-design-references-resolve.test.ts (#61).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Module not yet present — these imports drive the RED state.
import {
  PROBE_ID,
  scanFrSummaryAltitude,
} from "../adapters/_shared/src/scan_fr_summary_altitude";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scannerModulePath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "adapters",
  "_shared",
  "src",
  "scan_fr_summary_altitude.ts",
);
const skillMdPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "gate-check",
  "SKILL.md",
);

/** The #67 probe-entry block: from `^67.` to the next numbered entry / h2 / EOF. */
function probe67Block(skillMd: string): string {
  const match = skillMd.match(
    /^67\.\s+\*\*`?fr_summary_altitude`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
  );
  expect(match).not.toBeNull();
  return match![0];
}

describe("AC-STE-386.3 — probe #67 wiring in gate-check SKILL.md", () => {
  test("scanner module exists at the canonical shared path", () => {
    expect(existsSync(scannerModulePath)).toBe(true);
  });

  test("PROBE_ID is the literal string 'fr_summary_altitude'", () => {
    expect(PROBE_ID).toBe("fr_summary_altitude");
  });

  test("probe is registered as the 67th numbered probe", () => {
    const skillMd = readFileSync(skillMdPath, "utf-8");
    // Line shape mirrors siblings #61/#66: `67. **`fr_summary_altitude`** — …`
    expect(skillMd).toMatch(/^67\.\s+\*\*`?fr_summary_altitude`?\*\*/m);
  });

  test("entry declares Severity: error", () => {
    const block = probe67Block(readFileSync(skillMdPath, "utf-8"));
    expect(block).toMatch(/Severity:\s*error/i);
  });

  test("entry follows the probe-entry shape: names the scanner call, module path, vacuity clause, test coverage", () => {
    const block = probe67Block(readFileSync(skillMdPath, "utf-8"));
    // call `scanFrSummaryAltitude(projectRoot)` from `adapters/_shared/src/…`
    expect(block).toMatch(/scanFrSummaryAltitude/);
    expect(block).toMatch(/adapters\/_shared\/src\/scan_fr_summary_altitude\.ts/);
    // Vacuous-pass contract is spelled out (absent `## Summary` / absent FRs).
    expect(block).toMatch(/[Vv]acuous/);
    // Test-coverage pointer, like every sibling entry.
    expect(block).toMatch(/tests\/gate-check-fr-summary-altitude\.test\.ts/);
  });

  test("the four rule ids are named in the entry (closed set)", () => {
    const block = probe67Block(readFileSync(skillMdPath, "utf-8"));
    for (const rule of ["line_cap", "backtick", "ac_id", "path_token"]) {
      expect(block).toContain(rule);
    }
  });
});

describe("AC-STE-386.5 — dogfood: this repo's own active FRs clear the probe", () => {
  test("scanFrSummaryAltitude(repoRoot) returns zero violations", () => {
    const violations = scanFrSummaryAltitude(repoRoot) as Array<{
      file: string;
      line: number;
      rule: string;
    }>;
    if (violations.length > 0) {
      // Name every offender so the failing test says exactly which summary
      // drifted and which rule it broke — the probe's own UX, dogfooded.
      const noted = violations
        .map((v) => `${v.file}:${v.line} — ${v.rule}`)
        .join("\n");
      throw new Error(
        `Expected the repo's own FR summaries to clear probe #67, got ${violations.length} violation(s):\n${noted}`,
      );
    }
    expect(violations).toEqual([]);
  });
});

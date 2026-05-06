// STE-227 AC-STE-227.9 — `/gate-check` integration assertions for the
// needs_technical_review_consistency probe.
//
// AC.10 requires:
//   - Positive (compliant FRs → PASS)
//   - Negative (placeholder mismatch → FAIL with file:line)
//
// This test pairs with the unit test in
// `tests/needs-technical-review-consistency-probe.test.ts`. It also asserts
// that the probe is documented in `skills/gate-check/SKILL.md` so the gate
// runner picks it up.
//
// The probe module does not yet exist at
//   adapters/_shared/src/needs_technical_review_consistency.ts
// — the import fails at compile time, satisfying the RED requirement.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNeedsTechnicalReviewConsistencyProbe } from "../adapters/_shared/src/needs_technical_review_consistency";

const PLACEHOLDER = "[needs technical review — run /spec-write";

function buildFR(opts: {
  trackerId: string;
  flag: boolean;
  techDesignBody: string;
  testingBody: string;
}): string {
  return [
    "---",
    "title: t",
    "milestone: M60",
    "status: active",
    "archived_at: null",
    "tracker:",
    `  linear: ${opts.trackerId}`,
    ...(opts.flag ? ["needs_technical_review: true"] : []),
    "created_at: 2026-05-05T13:24:13Z",
    "---",
    "",
    `# ${opts.trackerId}: title`,
    "",
    "## Requirement",
    "",
    "Some requirement prose.",
    "",
    "## Acceptance Criteria",
    "",
    `- AC-${opts.trackerId}.1: foo`,
    "",
    "## Technical Design",
    "",
    opts.techDesignBody,
    "",
    "## Testing",
    "",
    opts.testingBody,
    "",
    "## Notes",
    "",
    "Notes.",
    "",
  ].join("\n");
}

describe("AC-STE-227.9 (integration) — positive: all compliant FRs → PASS", () => {
  test("mix of flag-set+placeholder and flag-absent+real-prose → zero violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntr-gate-pos-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      writeFileSync(
        join(root, "specs", "frs", "STE-400.md"),
        buildFR({
          trackerId: "STE-400",
          flag: true,
          techDesignBody: `${PLACEHOLDER} STE-400 to complete]`,
          testingBody: `${PLACEHOLDER} STE-400 to complete]`,
        }),
      );
      writeFileSync(
        join(root, "specs", "frs", "STE-401.md"),
        buildFR({
          trackerId: "STE-401",
          flag: false,
          techDesignBody: "Real architecture prose with substance.",
          testingBody: "Real testing prose with substance.",
        }),
      );
      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-227.9 (integration) — negative: placeholder mismatch → FAIL with file:line", () => {
  test("flag-set + non-placeholder body surfaces a file:line violation", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntr-gate-neg-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      const path = join(root, "specs", "frs", "STE-402.md");
      writeFileSync(
        path,
        buildFR({
          trackerId: "STE-402",
          flag: true,
          techDesignBody: "Architecture prose without the placeholder.",
          testingBody: "Test prose without the placeholder.",
        }),
      );
      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.file).toMatch(/STE-402\.md/);
      expect(v.line).toBeGreaterThan(0);
      // NFR-10 canonical envelope.
      expect(v.message).toMatch(/needs_technical_review_consistency/);
      expect(v.message).toMatch(/Remedy:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flag-absent + placeholder in body surfaces a file:line violation", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntr-gate-neg2-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      writeFileSync(
        join(root, "specs", "frs", "STE-403.md"),
        buildFR({
          trackerId: "STE-403",
          flag: false,
          techDesignBody: `${PLACEHOLDER} STE-403 to complete]`,
          testingBody: "Real testing prose.",
        }),
      );
      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find((v) => v.file.endsWith("STE-403.md"));
      expect(hit).toBeDefined();
      expect(hit!.line).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-227.9 (integration) — gate-check SKILL.md documents the probe", () => {
  test("gate-check SKILL.md references needs_technical_review_consistency", () => {
    const skillPath = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    const body = readFileSync(skillPath, "utf8");
    // The probe must be advertised in the SKILL.md probe list per the
    // probe-authoring contract (`tests/gate-check-<slug>.test.ts` paired
    // with a probe declaration in skills/gate-check/SKILL.md).
    expect(body).toContain("needs_technical_review_consistency");
  });

  test("gate-check SKILL.md documents the probe at error severity", () => {
    const skillPath = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    const body = readFileSync(skillPath, "utf8");
    // Per AC-STE-227.9 the severity is error (hard fail).
    expect(body).toMatch(
      /needs_technical_review_consistency[\s\S]{0,800}(error|GATE FAILED)/i,
    );
  });
});

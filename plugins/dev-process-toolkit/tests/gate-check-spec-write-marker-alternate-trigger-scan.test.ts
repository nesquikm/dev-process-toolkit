import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FORBIDDEN_PHRASES,
  runSpecWriteAlternateTriggerScanProbe,
} from "../adapters/_shared/src/spec_write_alternate_trigger_scan";

// STE-262 AC-STE-262.4 + AC-STE-262.7 — /gate-check probe
// `spec_write_marker_alternate_trigger_scan`. Severity: error.
//
// Globs ONLY plugins/dev-process-toolkit/skills/spec-write/SKILL.md and
// flags any of the forbidden alternate-trigger paraphrases listed in
// `FORBIDDEN_PHRASES` (STE-262 seeded; STE-294 extended) of the STE-226
// marker contract. Per occurrence: file:line:column + matched phrase +
// remedy. Lines containing canonical negation/historical signatures are
// excluded from the scan.

const KNOWN_GOOD_BODY = [
  "---",
  "name: spec-write",
  "---",
  "",
  "# Spec Write",
  "",
  "**Marker is the single deterministic mechanism (STE-226).**",
  "",
  "Run the byte-grep helper before evaluating the auto-apply branch.",
  "",
].join("\n");

function makeFixture(opts: { specWriteBody: string }): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(
    join(tmpdir(), "spec-write-alternate-trigger-"),
  );
  const dir = join(
    root,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "spec-write",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), opts.specWriteBody);
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("AC-STE-262.4 + AC-STE-262.7 — spec_write_marker_alternate_trigger_scan probe", () => {
  test("known-good SKILL.md ⇒ zero violations", async () => {
    const fx = makeFixture({ specWriteBody: KNOWN_GOOD_BODY });
    try {
      const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when SKILL.md absent ⇒ zero violations", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "spec-write-alternate-trigger-vacuous-"),
    );
    try {
      const r = await runSpecWriteAlternateTriggerScanProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // One known-bad fixture per forbidden phrase — count matches
  // `FORBIDDEN_PHRASES.length`.
  for (const phrase of FORBIDDEN_PHRASES) {
    test(`known-bad SKILL.md containing ${JSON.stringify(phrase)} (positive trigger) ⇒ exactly one violation`, async () => {
      const body = [
        "---",
        "name: spec-write",
        "---",
        "",
        "# Spec Write",
        "",
        // Positive trigger form (no carve-out signature on this line).
        `Drift sentinel: ${phrase} triggers default-apply for the gate.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations.length).toBe(1);
        const v = r.violations[0]!;
        expect(v.severity).toBe("error");
        expect(v.matchedPhrase).toBe(phrase);
        expect(v.line).toBeGreaterThan(0);
        expect(v.column).toBeGreaterThan(0);
        expect(v.note).toMatch(
          /plugins\/dev-process-toolkit\/skills\/spec-write\/SKILL\.md:\d+:\d+/,
        );
        expect(v.note).toContain(phrase);
        expect(v.message).toMatch(/Remedy:/);
        expect(v.message).toContain("single deterministic mechanism");
        expect(v.message).toMatch(/Context:/);
        expect(v.message).toContain("severity=error");
      } finally {
        fx.cleanup();
      }
    });
  }

  // Negation-context carve-outs — each must NOT trigger a violation.
  for (const phrase of FORBIDDEN_PHRASES) {
    test(`negation context — ${JSON.stringify(phrase)} on a line with 'is removed' ⇒ zero violations`, async () => {
      const body = [
        "# Spec Write",
        "",
        `The legacy ${phrase} detection path is removed per STE-226.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });

    test(`negation context — ${JSON.stringify(phrase)} on a line with 'are removed' ⇒ zero violations`, async () => {
      const body = [
        "# Spec Write",
        "",
        `The legacy ${phrase} and prior detection paths are removed.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });

    test(`negation context — ${JSON.stringify(phrase)} on a line with 'regardless of' ⇒ zero violations`, async () => {
      const body = [
        "# Spec Write",
        "",
        `The marker is mandatory regardless of ${phrase} prose elsewhere.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });

    test(`negation context — ${JSON.stringify(phrase)} on a line with 'NOT acceptable' ⇒ zero violations`, async () => {
      const body = [
        "# Spec Write",
        "",
        `Pre-baked ${phrase} prose is NOT acceptable as a trigger.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });

    test(`canonical contract anchor 'single deterministic' on a line with ${JSON.stringify(phrase)} ⇒ zero violations`, async () => {
      const body = [
        "# Spec Write",
        "",
        `the script's output is the single deterministic gate decision; no LLM inference, no ${phrase} influences the auto-apply branch.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("multiple positive-trigger phrases on different lines ⇒ one violation per occurrence", async () => {
    const body = [
      "# Spec Write",
      "",
      `Note: ${FORBIDDEN_PHRASES[0]} triggers default-apply.`,
      `Note: ${FORBIDDEN_PHRASES[1]} permits silent commit.`,
      `Note: ${FORBIDDEN_PHRASES[2]} grants approval.`,
      "",
    ].join("\n");
    const fx = makeFixture({ specWriteBody: body });
    try {
      const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
      expect(r.violations.length).toBe(3);
      const phrases = r.violations.map((v) => v.matchedPhrase);
      expect(phrases).toContain(FORBIDDEN_PHRASES[0]);
      expect(phrases).toContain(FORBIDDEN_PHRASES[1]);
      expect(phrases).toContain(FORBIDDEN_PHRASES[2]);
    } finally {
      fx.cleanup();
    }
  });

  test("scope is single-file: skills outside /spec-write are NOT scanned", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "spec-write-alternate-trigger-scope-"),
    );
    try {
      const otherDir = join(
        root,
        "plugins",
        "dev-process-toolkit",
        "skills",
        "setup",
      );
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(
        join(otherDir, "SKILL.md"),
        `Drift: ${FORBIDDEN_PHRASES[0]} triggers default-apply.`,
      );
      const r = await runSpecWriteAlternateTriggerScanProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("violation message follows NFR-10 canonical shape", async () => {
    const body = [
      "# Spec Write",
      "",
      `Drift: ${FORBIDDEN_PHRASES[0]} triggers default-apply for the gate.`,
    ].join("\n");
    const fx = makeFixture({ specWriteBody: body });
    try {
      const r = await runSpecWriteAlternateTriggerScanProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.message).toContain(
        "spec_write_marker_alternate_trigger_scan",
      );
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(
        /spec_write_marker_alternate_trigger_scan: plugins\/dev-process-toolkit\/skills\/spec-write\/SKILL\.md:\d+:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-262.7 sweep — on-disk /spec-write SKILL.md MUST pass with zero violations", async () => {
    // Final ship gate: the actual production SKILL.md must pass the
    // probe. Derive the repo root from this file's path (canonical
    // pattern across this test suite) so the test is robust to
    // working-directory changes by future test runners.
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const r = await runSpecWriteAlternateTriggerScanProbe(repoRoot);
    if (r.violations.length > 0) {
      const summary = r.violations
        .map((v) => v.note)
        .join("\n");
      throw new Error(
        `Expected zero violations on the on-disk SKILL.md, found ${r.violations.length}:\n${summary}`,
      );
    }
    expect(r.violations).toEqual([]);
  });
});

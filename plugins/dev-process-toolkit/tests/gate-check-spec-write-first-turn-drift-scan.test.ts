import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FORBIDDEN_FIRST_TURN_DRIFT_PHRASES,
  runSpecWriteFirstTurnDriftScanProbe,
} from "../adapters/_shared/src/spec_write_first_turn_drift_scan";

// STE-270 AC-STE-270.2 + AC-STE-270.4 — /gate-check probe
// `spec_write_first_turn_drift_scan`. Severity: error.
//
// Globs ONLY `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` and
// flags any of six forbidden alternate-trigger paraphrases of the
// Pattern-26 first-turn contract. Per occurrence: file:line:column +
// matched phrase + remedy.

const KNOWN_GOOD_SKILL_BODY = [
  "---",
  "name: spec-write",
  "---",
  "",
  "# Spec Write",
  "",
  "> **FIRST ACTION (under non-interactive stdin) — STE-251 AC-STE-251.1.**",
  "> The first tool call under non-tty MUST be `AskUserQuestion` or",
  "> `RequiresInputRefusedError`.",
  "",
  "## Process",
  "",
  "Run the Socratic loop unconditionally; the marker only relaxes",
  "approval gates, never the loop entry.",
  "",
].join("\n");

function makeFixture(opts: { specWriteBody: string }): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "spec-write-first-turn-drift-"));
  const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), opts.specWriteBody);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-270.2 + AC-STE-270.4 — spec_write_first_turn_drift_scan probe", () => {
  test("known-good SKILL.md ⇒ zero violations, severity error tag wired", async () => {
    const fx = makeFixture({ specWriteBody: KNOWN_GOOD_SKILL_BODY });
    try {
      const r = await runSpecWriteFirstTurnDriftScanProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when SKILL.md absent ⇒ zero violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "spec-write-first-turn-drift-vacuous-"));
    try {
      const r = await runSpecWriteFirstTurnDriftScanProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // One known-bad fixture per forbidden phrase — six fixtures total.
  for (const phrase of FORBIDDEN_FIRST_TURN_DRIFT_PHRASES) {
    test(`known-bad SKILL.md containing ${JSON.stringify(phrase)} ⇒ exactly one violation`, async () => {
      const body = [
        "---",
        "name: spec-write",
        "---",
        "",
        "# Spec Write",
        "",
        // Surround the forbidden phrase with leading prose so the column
        // offset is non-zero — the probe must still report the phrase's
        // start column, not the line start.
        `Drift sentinel: prose claiming ${phrase} the Socratic loop entry; rephrase me.`,
        "",
      ].join("\n");
      const fx = makeFixture({ specWriteBody: body });
      try {
        const r = await runSpecWriteFirstTurnDriftScanProbe(fx.root);
        expect(r.violations.length).toBe(1);
        const v = r.violations[0]!;
        expect(v.severity).toBe("error");
        expect(v.matchedPhrase).toBe(phrase);
        expect(v.line).toBeGreaterThan(0);
        expect(v.column).toBeGreaterThan(1);
        expect(v.note).toMatch(
          /plugins\/dev-process-toolkit\/skills\/spec-write\/SKILL\.md:\d+:\d+/,
        );
        expect(v.note).toContain(phrase);
        // Remedy text guidance.
        expect(v.message).toMatch(/Remedy:/);
        expect(v.message).toContain("AskUserQuestion");
        expect(v.message).toContain("RequiresInputRefusedError");
        // NFR-10 canonical context line.
        expect(v.message).toMatch(/Context:/);
        expect(v.message).toContain("severity=error");
      } finally {
        fx.cleanup();
      }
    });
  }

  test("multiple forbidden phrases on different lines ⇒ one violation per occurrence", async () => {
    const body = [
      "---",
      "name: spec-write",
      "---",
      "",
      "# Spec Write",
      "",
      `Note: ${FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[0]} the Socratic loop.`,
      `Note: ${FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[1]} loop entry.`,
      `Note: ${FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[2]} entry.`,
      "",
    ].join("\n");
    const fx = makeFixture({ specWriteBody: body });
    try {
      const r = await runSpecWriteFirstTurnDriftScanProbe(fx.root);
      expect(r.violations.length).toBe(3);
      const phrases = r.violations.map((v) => v.matchedPhrase);
      expect(phrases).toContain(FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[0]);
      expect(phrases).toContain(FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[1]);
      expect(phrases).toContain(FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[2]);
    } finally {
      fx.cleanup();
    }
  });

  test("scope is single-file: skills outside /spec-write are NOT scanned", async () => {
    // Plant a forbidden phrase in a sibling skill body — must NOT
    // trigger because the probe globs only /spec-write SKILL.md.
    const root = mkdtempSync(join(tmpdir(), "spec-write-first-turn-drift-scope-"));
    try {
      const otherDir = join(root, "plugins", "dev-process-toolkit", "skills", "setup");
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(
        join(otherDir, "SKILL.md"),
        `Note: ${FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[0]} the loop.`,
      );
      // /spec-write SKILL.md absent — vacuous scope.
      const r = await runSpecWriteFirstTurnDriftScanProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("violation message follows NFR-10 canonical shape", async () => {
    const body = [
      "# Spec Write",
      "",
      `Drift: ${FORBIDDEN_FIRST_TURN_DRIFT_PHRASES[0]} the loop entry.`,
    ].join("\n");
    const fx = makeFixture({ specWriteBody: body });
    try {
      const r = await runSpecWriteFirstTurnDriftScanProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.message).toContain("spec_write_first_turn_drift_scan");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(
        /spec_write_first_turn_drift_scan: plugins\/dev-process-toolkit\/skills\/spec-write\/SKILL\.md:\d+:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });
});

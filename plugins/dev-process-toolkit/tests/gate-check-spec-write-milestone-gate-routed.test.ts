// STE-401 AC-STE-401.5 — /gate-check probe `spec_write_milestone_gate_routed`.
// Severity: error.
//
// Asserts skills/spec-write/SKILL.md documents the milestone-allocation
// gate's marker/refusal routing byte-checkably: `requireOrRefuse`, the
// `milestone_allocation_default_applied` token, `RequiresInputRefusedError`,
// and the non-tty anchor `prose-ask-then-end-turn is forbidden under non-tty`.
// Single-file scope, literal substring match, one NFR-10 note per missing
// literal, vacuous when the SKILL is absent.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MILESTONE_GATE_REQUIRED_LITERALS,
  runSpecWriteMilestoneGateRoutedProbe,
} from "../adapters/_shared/src/spec_write_milestone_gate_routed";

const SPEC_WRITE_SKILL = "plugins/dev-process-toolkit/skills/spec-write/SKILL.md";

// A minimal SKILL body carrying every required literal — the known-good case.
const KNOWN_GOOD = [
  "# Spec Write",
  "",
  "**Milestone-allocation gate (STE-401).** The milestone-binding decision",
  "routes through `requireOrRefuse(...)` with the computed recommendation as",
  "defaultValue: marker present ⇒ default-applied, MUST emit",
  "`milestone_allocation_default_applied`; marker absent + non-tty ⇒",
  "`RequiresInputRefusedError` naming gate site `milestone-allocation`. A",
  "prose-ask-then-end-turn is forbidden under non-tty.",
  "",
].join("\n");

function makeFixture(specWriteBody?: string): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "milestone-gate-routed-"));
  if (specWriteBody !== undefined) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), specWriteBody);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-401.5 — spec_write_milestone_gate_routed probe", () => {
  test("SKILL body carrying all required literals ⇒ zero violations", async () => {
    const fx = makeFixture(KNOWN_GOOD);
    try {
      const r = await runSpecWriteMilestoneGateRoutedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when the SKILL is absent ⇒ zero violations", async () => {
    const fx = makeFixture(undefined);
    try {
      const r = await runSpecWriteMilestoneGateRoutedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  for (const literal of MILESTONE_GATE_REQUIRED_LITERALS) {
    test(`missing required literal ${JSON.stringify(literal)} ⇒ violation naming it`, async () => {
      const truncated = KNOWN_GOOD.split(literal).join("[REDACTED]");
      const fx = makeFixture(truncated);
      try {
        const r = await runSpecWriteMilestoneGateRoutedProbe(fx.root);
        expect(r.violations.length).toBeGreaterThanOrEqual(1);
        const v = r.violations[0]!;
        expect(v.severity).toBe("error");
        expect(v.file).toContain(SPEC_WRITE_SKILL);
        expect(v.message).toMatch(/Remedy:/);
        expect(v.message).toMatch(/Context:/);
        expect(v.message).toContain("spec_write_milestone_gate_routed");
        const messages = r.violations.map((x) => x.message).join("\n");
        expect(messages).toContain(literal);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("real shipped spec-write SKILL.md carries the milestone-gate contract (integration smoke)", async () => {
    const repoRoot = join(__dirname, "..", "..", "..");
    const r = await runSpecWriteMilestoneGateRoutedProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});

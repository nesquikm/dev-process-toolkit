import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-35 conformance — /setup --migrate detection for mode: none → tracker path.
//
// The skill is markdown read by an LLM; there is no TypeScript dispatcher to
// unit-test. These tests lock the SKILL.md rule text at the exact markers
// that determine whether the LLM routes mode: none + --migrate into the
// tracker-mode migration branch (correct) or into fresh-setup (the bug
// observed in the 2026-04-22 dogfooding session).
//
// Each test names the AC it covers. Removing the marker regresses STE-35.

const pluginRoot = join(import.meta.dir, "..");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");

function readSetupSkill(): string {
  return readFileSync(setupSkillPath, "utf8");
}

describe("STE-35 — /setup --migrate detection for mode:none→tracker path", () => {
  test("AC-STE-35.1 — tracker-mode migration detection admits `mode: none` as a valid starting state", () => {
    const body = readSetupSkill();
    // The §0b tracker-mode migration block must explicitly include mode: none
    // as a valid current state — not gate on `## Task Tracking` presence.
    expect(body).toContain("All modes (including `none`) are valid starting states");
  });

  test("AC-STE-35.2 — §0 fresh-setup routing yields to --migrate in arguments", () => {
    const body = readSetupSkill();
    // The §0 probe's "empty of `## Task Tracking` → fresh-setup" rule must
    // carve out an exception when --migrate is in arguments. Without this,
    // the probe terminates before §0b ever fires on a mode: none + --migrate
    // invocation.
    expect(body).toContain("and `$ARGUMENTS` does **not** contain `--migrate`");
  });

  test("AC-STE-35.5 — §0b migration handling emits an NFR-10 refusal naming current + supported targets", () => {
    const body = readSetupSkill();
    // When neither migration flavor applies (e.g., target == current), the
    // skill must refuse with the canonical NFR-10 shape. The template names
    // both the detected current mode and the remaining valid targets so the
    // user knows what they can pick next — never a silent fall-through.
    expect(body).toMatch(/Detected current mode:/);
    expect(body).toMatch(/Supported targets:/);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-41 AC-STE-41.5 conformance — /gate-check carries a warn-only lint rule
// that catches "(in flight — v<X.Y.Z>)" / "(planned — v<X.Y.Z>)" markers
// in specs/requirements.md when the referenced version already ships in
// CHANGELOG.md. Stops the "changelog-by-accident" rot observed 2026-04-22
// on the plugin's own repo (v1.15/1.16/1.17 all shipped but overview
// still said "in flight"/"planned").

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function readGateCheckSkill(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

describe("STE-41 AC-STE-41.5 — /gate-check stale-release-marker lint rule", () => {
  test("SKILL.md names the Stale release marker probe and its FR reference", () => {
    const body = readGateCheckSkill();
    expect(body).toContain("Stale release marker");
    expect(body).toMatch(/AC-STE-41\.5/);
  });

  test("probe describes the marker detection (in flight / planned) + CHANGELOG cross-reference", () => {
    const body = readGateCheckSkill();
    expect(body).toMatch(/\(in flight[\s—]/);
    expect(body).toMatch(/\(planned[\s—]/);
    expect(body).toMatch(/CHANGELOG\.md/);
  });

  test("probe is warn-only (GATE PASSED WITH NOTES), not GATE FAILED", () => {
    const body = readGateCheckSkill();
    // Locate the probe block and verify it lands under PASSED WITH NOTES.
    const probeIdx = body.indexOf("Stale release marker");
    expect(probeIdx).toBeGreaterThan(-1);
    // Within 400 chars after the probe header, PASSED WITH NOTES must
    // appear and GATE FAILED must NOT.
    const probeBlock = body.slice(probeIdx, probeIdx + 400);
    expect(probeBlock).toContain("GATE PASSED WITH NOTES");
    expect(probeBlock).not.toContain("GATE FAILED");
  });
});

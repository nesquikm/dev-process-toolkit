// STE-138 AC-STE-138.4 — guard against checklist-vs-reality drift in
// CLAUDE.md. After STE-167, the canonical release-files list lives in the
// `## Release Files` block (parsed by /ship-milestone via release_config.ts);
// the legacy `## Release Checklist` numbered enumeration was removed. These
// tests now constrain the new schema:
//   1. The list parses cleanly through the loader.
//   2. Every required (non-optional) entry's path exists.
// Since 3.0.0 this repository keeps the list as `release.files` in
// specs/settings.yaml, so it is read through readReleaseFiles — the reader
// /ship-milestone uses — and never parsed out of CLAUDE.md by hand.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readReleaseFiles } from "../adapters/_shared/src/release_config";

const repoRoot = join(import.meta.dir, "..", "..", "..");

function readClaudeMd(): string {
  return readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
}

describe("AC-STE-138.4 — Release Files block matches reality", () => {
  test("toolkit release files parse through the loader", () => {
    const entries = readReleaseFiles(repoRoot, readClaudeMd);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("every required (non-optional) entry's path exists in the repo", () => {
    const entries = readReleaseFiles(repoRoot, readClaudeMd);
    const required = entries.filter((e) => !e.optional);
    for (const e of required) {
      expect(existsSync(join(repoRoot, e.path))).toBe(true);
    }
  });

  test("specs/requirements.md hygiene is still enforced (gate-check probe #9b)", () => {
    // The specs/requirements.md "Latest shipped release" line is now
    // gated by gate-check probe #9b (root_hygiene), not by the bumper.
    // This test guards the explicit cross-reference in CLAUDE.md.
    const claudeMd = readClaudeMd();
    expect(claudeMd).toMatch(/specs\/requirements\.md/);
    expect(claudeMd.toLowerCase()).toMatch(/latest shipped release/);
  });
});

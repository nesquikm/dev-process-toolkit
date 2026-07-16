import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// STE-49 AC-STE-49.1 / AC-STE-49.10 regression — no file under the AC-STE-49.1 path set
// may contain the literal v1-archive path. Fails loudly if any future change
// reintroduces `specs/archive/` in tracked prose under docs, skills,
// README.md, or the live cross-cutting spec files.

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

// `baseTargets` are always present. The cross-cutting specs are OPTIONAL
// targets, filtered by `existsSync`: a downstream consumer project running this
// plugin's `/gate-check` may not carry every cross-cutting spec file, and an
// absent one must be tolerated rather than fatal. Nothing absent is ever handed
// to grep — an unmatched operand makes grep exit >= 2, which the `status !== 1`
// check below would report as a regression with no matches to show.
//
// The filter is NOT here because this repo's own `specs/` is untracked. It is
// tracked — 420 files, and no ignore rule matches it (verified 2026-07-15 with
// `git check-ignore specs/` + `git ls-files specs/`) — so all three optional
// targets resolve here and the full AC-STE-49.1 scope really is scanned in this
// repo. An earlier version of this comment claimed the opposite and was copied
// forward unverified; M104 AC-STE-384.3 corrected it. The mechanism was always
// right; only the justification was wrong.

const baseTargets = [
  join(pluginRoot, "docs"),
  join(pluginRoot, "skills"),
  join(repoRoot, "README.md"),
];
const optionalTargets = [
  join(repoRoot, "specs", "requirements.md"),
  join(repoRoot, "specs", "technical-spec.md"),
  join(repoRoot, "specs", "testing-spec.md"),
].filter(existsSync);
const scanTargets = [...baseTargets, ...optionalTargets];

describe("STE-49 AC-STE-49.1 — v1 archive path is absent from tracked prose", () => {
  test("grep 'specs/archive' over the AC-STE-49.1 path set returns zero matches", () => {
    for (const target of baseTargets) {
      expect(existsSync(target)).toBe(true);
    }
    const proc = spawnSync("grep", ["-rn", "specs/archive", ...scanTargets], {
      encoding: "utf8",
    });
    // `grep` exits 0 on match, 1 on no-match, >=2 on error. We want 1.
    if (proc.status !== 1) {
      const matches = proc.stdout.trim();
      throw new Error(
        `STE-49 AC-STE-49.1 regression: 'specs/archive' found in tracked prose.\n${matches}`,
      );
    }
    expect(proc.status).toBe(1);
    expect(proc.stdout).toBe("");
  });
});

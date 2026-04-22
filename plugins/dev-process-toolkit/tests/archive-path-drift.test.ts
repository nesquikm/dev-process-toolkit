import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// FR-70 AC-70.1 / AC-70.10 regression — no file under the AC-70.1 path set
// may contain the literal v1-archive path. Fails loudly if any future change
// reintroduces `specs/archive/` in tracked prose under docs, skills,
// README.md, or the live cross-cutting spec files.

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

// The full AC-70.1 scope includes the live cross-cutting specs, but this
// repo's own `specs/` is gitignored (dogfood workspace). Scan the tracked
// targets (always present) plus any dogfood specs that happen to exist. A
// downstream project running this plugin's `/gate-check` will exercise the
// full scope against its own tracked specs.

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

describe("FR-70 AC-70.1 — v1 archive path is absent from tracked prose", () => {
  test("grep 'specs/archive' over the AC-70.1 path set returns zero matches", () => {
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
        `FR-70 AC-70.1 regression: 'specs/archive' found in tracked prose.\n${matches}`,
      );
    }
    expect(proc.status).toBe(1);
    expect(proc.stdout).toBe("");
  });
});

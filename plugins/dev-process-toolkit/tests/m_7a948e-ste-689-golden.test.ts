// STE-689 (M_7a948e) — AC-STE-689.9: with `changelog_unversioned` absent, the
// writer's output over this repo's own `## Release Files` block is byte-identical
// to the pre-change writer.
//
// The golden under `fixtures/m_7a948e-ste-689-golden/` was captured by running
// the PRE-CHANGE `release_config.ts` (branch tip 49444993, before any STE-689
// implementation) over `input/` — a copy of this repo's CLAUDE.md (whose
// `## Docs` carries no `changelog_unversioned` line) and the five files its
// `## Release Files` block names, the large ones trimmed to the region the
// bumpers touch. `expected/<mode>/` holds the stdout, stderr, exit code and
// every file's bytes after the run.
//
// This test is GREEN before the change by construction; it is a regression pin
// that turns red if the unversioned path leaks into a project without the flag.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "release_config.ts");
const GOLDEN = join(import.meta.dir, "fixtures", "m_7a948e-ste-689-golden");

// The exact argv the golden was captured with.
const ARGS = [
  "2.100.0",
  "--codename",
  "Golden Path",
  "--date",
  "2026-10-21",
  "--body",
  "### Added\n\n- A golden release line (STE-1)\n",
  "--test-count",
  "100,0,0",
];

const FILES = [
  "CLAUDE.md",
  ".claude-plugin/marketplace.json",
  "plugins/dev-process-toolkit/.claude-plugin/plugin.json",
  "CHANGELOG.md",
  "README.md",
  "specs/requirements.md",
];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("AC-STE-689.9 — flag absent: byte-identical to the pre-change writer", () => {
  test("the golden input carries no changelog_unversioned line", () => {
    expect(readFileSync(join(GOLDEN, "input", "CLAUDE.md"), "utf-8")).not.toContain("changelog_unversioned");
  });

  for (const mode of ["dry-run", "real"] as const) {
    test(`${mode}: stdout, stderr, exit code and every release file match the golden`, () => {
      const root = mkdtempSync(join(tmpdir(), "ste-689-golden-"));
      dirs.push(root);
      cpSync(join(GOLDEN, "input"), root, { recursive: true });
      const argv = ["bun", "run", DOOR, root, ...ARGS, ...(mode === "dry-run" ? ["--dry-run"] : [])];
      const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
      const expected = join(GOLDEN, "expected", mode);

      expect(new TextDecoder().decode(proc.stdout)).toBe(readFileSync(join(expected, "stdout.txt"), "utf-8"));
      expect(new TextDecoder().decode(proc.stderr)).toBe(readFileSync(join(expected, "stderr.txt"), "utf-8"));
      expect(String(proc.exitCode)).toBe(readFileSync(join(expected, "exit-code.txt"), "utf-8"));
      for (const f of FILES) {
        expect(readFileSync(join(root, f), "utf-8")).toBe(readFileSync(join(expected, "files", f), "utf-8"));
      }
    });
  }
});

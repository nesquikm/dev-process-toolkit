import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInstalledHookNames } from "../install_hooks";

// STE-285 AC-STE-285.5 — `/setup --hooks` flag re-runs only the hooks step.
//
// Two-part test:
//   (a) Doc conformance — `/setup` SKILL.md mentions `--hooks` flag with
//       "re-runs only the hooks step" semantics.
//   (b) Helper invocation — `install_hooks.ts` exports
//       `readInstalledHookNames(settingsPath, pluginRoot)` returning the
//       array of installed hook names (used for pre-checking the menu).

const SKILL_PATH = join(import.meta.dir, "..", "SKILL.md");

function read(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}

describe("AC-STE-285.5 (a) — /setup SKILL.md documents --hooks flag", () => {
  test("SKILL.md mentions --hooks flag verbatim", () => {
    expect(read()).toContain("--hooks");
  });

  test("SKILL.md states the flag re-runs only the hooks step (skips stack detection + CLAUDE.md generation)", () => {
    const body = read();
    // Either "re-runs only the hooks step" verbatim, or load-bearing
    // fragments separately.
    expect(body).toMatch(/--hooks/);
    expect(body).toMatch(/re-runs?\s+only.*hooks?\s+step|skip.*(stack detection|CLAUDE\.md generation)/i);
  });

  test("SKILL.md states the re-run is idempotent with pre-checked menu", () => {
    const body = read();
    // Idempotency: menu pre-checks already-installed hooks.
    expect(body).toMatch(/idempotent|pre-check(ed)?|already.installed/i);
  });
});

describe("AC-STE-285.5 (b) — readInstalledHookNames helper", () => {
  const PLUGIN_ROOT = "/plugin/dev-process-toolkit";

  function makeSettings(hookNames: string[]): string {
    return JSON.stringify({
      hooks: {
        PreToolUse: hookNames.map((name) => ({
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "bash",
              args: [`${PLUGIN_ROOT}/templates/hooks/process/${name}.sh`],
              timeout: 5000,
            },
          ],
        })),
      },
    });
  }

  test("returns empty array when settings.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-285-flag-"));
    const settingsPath = join(dir, "missing.json");
    try {
      const names = readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(names).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns empty array when settings.json has no hook entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-285-flag-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, "{}");
    try {
      const names = readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(names).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns names of currently installed plugin hooks", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-285-flag-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      makeSettings(["pre-commit-gate-check", "pre-pr-spec-review"]),
    );
    try {
      const names = readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(names.sort()).toEqual(
        ["pre-commit-gate-check", "pre-pr-spec-review"].sort(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores non-plugin hooks (user's own custom-hook.sh)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-285-flag-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [
                {
                  type: "command",
                  command: "bash",
                  args: ["/Users/me/custom-hook.sh"],
                },
              ],
            },
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "bash",
                  args: [
                    `${PLUGIN_ROOT}/templates/hooks/process/pre-commit-gate-check.sh`,
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    try {
      const names = readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(names).toEqual(["pre-commit-gate-check"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

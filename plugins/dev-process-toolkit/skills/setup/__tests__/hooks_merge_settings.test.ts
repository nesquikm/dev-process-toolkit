import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installHooks,
  mergeHooksIntoSettings,
} from "../install_hooks";

// STE-285 AC-STE-285.3 — install_hooks.ts merge helper.
//
// Selected hooks write into the user's `.claude/settings.json` via key-level
// merge (existing entries preserved). Each entry uses exec form:
//
//   { "command": "bash",
//     "args": ["<plugin>/templates/hooks/process/<name>.sh"],
//     "timeout": 5000 }
//
// Conflict resolution:
//   - same matcher + identical command → no-op (idempotent re-run)
//   - same matcher + different command → diff + prompt (per STE-133)
//
// Fixtures: (a) empty settings.json, (b) settings with unrelated hooks
// preserved, (c) same matcher + identical command (no-op),
// (d) same matcher + different command (conflict surfaced).

const SAMPLE_PLUGIN_ROOT = "/plugin/dev-process-toolkit";

function hookEntry(name: string, matcher: string, event: string): {
  event: string;
  matcher: string;
  hook: {
    type: "command";
    command: string;
    args: string[];
    timeout?: number;
  };
} {
  return {
    event,
    matcher,
    hook: {
      type: "command",
      command: "bash",
      args: [`${SAMPLE_PLUGIN_ROOT}/templates/hooks/process/${name}.sh`],
      timeout: 5000,
    },
  };
}

describe("AC-STE-285.3 — mergeHooksIntoSettings: empty settings.json (case a)", () => {
  test("merges into an empty object", () => {
    const additions = [hookEntry("pre-commit-gate-check", "Bash", "PreToolUse")];
    const { merged, conflicts } = mergeHooksIntoSettings({}, additions);
    expect(conflicts).toEqual([]);
    expect(merged.hooks?.PreToolUse).toBeDefined();
    expect(merged.hooks!.PreToolUse!.length).toBeGreaterThanOrEqual(1);
    const installed = merged.hooks!.PreToolUse![0]!;
    expect(installed.matcher).toBe("Bash");
    expect(installed.hooks[0]!.command).toBe("bash");
    expect(installed.hooks[0]!.args).toContain(
      `${SAMPLE_PLUGIN_ROOT}/templates/hooks/process/pre-commit-gate-check.sh`,
    );
  });
});

describe("AC-STE-285.3 — mergeHooksIntoSettings: preserves unrelated existing entries (case b)", () => {
  test("user's custom hook entries are not stripped", () => {
    const existing = {
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
        ],
      },
    };
    const additions = [hookEntry("pre-commit-gate-check", "Bash", "PreToolUse")];
    const { merged, conflicts } = mergeHooksIntoSettings(existing, additions);
    expect(conflicts).toEqual([]);
    // Both the pre-existing Edit matcher and the new Bash matcher must survive.
    const matchers = merged.hooks!.PreToolUse!.map((e) => e.matcher);
    expect(matchers).toContain("Edit");
    expect(matchers).toContain("Bash");
    // The user's custom-hook command must still be present.
    const flatCommands = merged
      .hooks!.PreToolUse!.flatMap((e) => e.hooks.map((h) => h.args?.[0] ?? ""))
      .filter(Boolean);
    expect(flatCommands.some((c) => c.includes("custom-hook.sh"))).toBe(true);
  });
});

describe("AC-STE-285.3 — mergeHooksIntoSettings: idempotent re-run (case c)", () => {
  test("same matcher + identical command → no duplicate entry", () => {
    const additions = [hookEntry("pre-commit-gate-check", "Bash", "PreToolUse")];
    const first = mergeHooksIntoSettings({}, additions);
    const second = mergeHooksIntoSettings(first.merged, additions);
    expect(second.conflicts).toEqual([]);
    // The args list for the Bash matcher should NOT carry the same script
    // twice. Count occurrences of the script path across all entries.
    const allArgs = second
      .merged.hooks!.PreToolUse!.flatMap((e) => e.hooks.map((h) => h.args?.[0] ?? ""));
    const hits = allArgs.filter((a) =>
      a.includes("pre-commit-gate-check.sh"),
    );
    expect(hits.length).toBe(1);
  });
});

describe("AC-STE-285.3 — mergeHooksIntoSettings: conflict on differing command (case d)", () => {
  test("same matcher + different command → conflict reported (no silent overwrite)", () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "bash",
                args: [
                  // A hook at the SAME script path-suffix but with a DIFFERENT
                  // pinned plugin root (user manually pointed at a vendored
                  // copy). Conflict: same intent, different command.
                  "/user/vendored/templates/hooks/process/pre-commit-gate-check.sh",
                ],
              },
            ],
          },
        ],
      },
    };
    const additions = [hookEntry("pre-commit-gate-check", "Bash", "PreToolUse")];
    const { merged: _merged, conflicts } = mergeHooksIntoSettings(
      existing,
      additions,
    );
    // Conflict surfaced — caller (skill prose) handles diff+prompt per STE-133.
    expect(conflicts.length).toBeGreaterThan(0);
    const first = conflicts[0]!;
    expect(first.matcher).toBe("Bash");
    // Conflict carries both the existing and proposed commands for the prompt UX.
    expect(typeof first.existingCommand).toBe("string");
    expect(typeof first.proposedCommand).toBe("string");
    expect(first.existingCommand).not.toBe(first.proposedCommand);
  });
});

describe("AC-STE-285.3 — installHooks: writes selected hooks to settings.json on disk", () => {
  test("installHooks materializes a settings file when given a path + hook names", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-285-merge-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, "{}");
    try {
      const result = installHooks(
        settingsPath,
        ["pre-commit-gate-check"],
        SAMPLE_PLUGIN_ROOT,
      );
      // installHooks returns a MergeResult with `conflicts` field.
      expect(Array.isArray(result.conflicts)).toBe(true);
      const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
      // The hook entry landed on disk.
      const allArgs: string[] = (written.hooks?.PreToolUse ?? []).flatMap(
        (e: { hooks: Array<{ args?: string[] }> }) =>
          e.hooks.flatMap((h) => h.args ?? []),
      );
      expect(allArgs.some((a) => a.includes("pre-commit-gate-check.sh"))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

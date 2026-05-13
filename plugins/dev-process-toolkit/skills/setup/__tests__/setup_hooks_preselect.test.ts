import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-286 AC-STE-286.1 — `/setup --hooks` accepts a non-interactive preselect
// flag.
//
// The parser MUST live as an exported function `parsePreselectFlag(arg)` in
// `plugins/dev-process-toolkit/skills/setup/install_hooks.ts`. These tests
// fail RED until `parsePreselectFlag` is exported with the contract below:
//
//   parsePreselectFlag("all") → { all: true, names: [<4 names from HOOK_REGISTRATIONS>] }
//   parsePreselectFlag("pre-commit-gate-check,pre-pr-spec-review")
//                            → { all: false, names: ["pre-commit-gate-check", "pre-pr-spec-review"] }
//   parsePreselectFlag("unknown-hook") → throws NFR-10-shape error
//                                        (message contains "Refusing:" + "unknown hook" + name)
//
// Idempotent re-run: invoking `installHooks(settingsPath, names, root)` twice
// with the same `names` is a no-op on the second call (existing entries are
// preserved, no duplicates).

// Dynamic import so the suite reaches the test runner even before
// parsePreselectFlag exists — each test calls `loadModule()` and surfaces a
// clean RED on the missing export.
const MODULE_PATH = join(import.meta.dir, "..", "install_hooks");

type InstallHooksModule = typeof import("../install_hooks") & {
  parsePreselectFlag?: (arg: string) => { all: boolean; names: string[] };
};

async function loadModule(): Promise<InstallHooksModule> {
  return (await import(MODULE_PATH)) as InstallHooksModule;
}

const KNOWN_NAMES = [
  "pre-commit-gate-check",
  "pre-pr-spec-review",
  "pre-spec-write-brainstorm-reminder",
  "pre-commit-tdd-orchestrator",
];

describe("AC-STE-286.1 — parsePreselectFlag('all')", () => {
  test("returns { all: true, names: <all 4 seeded names> }", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    const result = mod.parsePreselectFlag!("all");
    expect(result.all).toBe(true);
    expect(result.names.sort()).toEqual([...KNOWN_NAMES].sort());
  });
});

describe("AC-STE-286.1 — parsePreselectFlag('<comma-list>')", () => {
  test("parses a 2-name subset", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    const result = mod.parsePreselectFlag!(
      "pre-commit-gate-check,pre-pr-spec-review",
    );
    expect(result.all).toBe(false);
    expect(result.names.sort()).toEqual(
      ["pre-commit-gate-check", "pre-pr-spec-review"].sort(),
    );
  });

  test("parses a single-name list", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    const result = mod.parsePreselectFlag!("pre-commit-gate-check");
    expect(result.all).toBe(false);
    expect(result.names).toEqual(["pre-commit-gate-check"]);
  });

  test("tolerates surrounding whitespace per comma-separated entry", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    const result = mod.parsePreselectFlag!(
      " pre-commit-gate-check , pre-pr-spec-review ",
    );
    expect(result.all).toBe(false);
    expect(result.names.sort()).toEqual(
      ["pre-commit-gate-check", "pre-pr-spec-review"].sort(),
    );
  });
});

describe("AC-STE-286.1 — parsePreselectFlag rejects unknown names (NFR-10 shape)", () => {
  test("'unknown-hook' throws with Refusing: + unknown hook + name", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    let captured: Error | null = null;
    try {
      mod.parsePreselectFlag!("unknown-hook");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    const msg = captured!.message;
    expect(msg).toContain("Refusing:");
    expect(msg).toContain("unknown hook");
    expect(msg).toContain("unknown-hook");
  });

  test("mixed valid+unknown list rejects on first unknown name", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    let captured: Error | null = null;
    try {
      mod.parsePreselectFlag!("pre-commit-gate-check,bogus-hook");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    const msg = captured!.message;
    expect(msg).toContain("Refusing:");
    expect(msg).toContain("bogus-hook");
  });

  test("rejection message lists known names so caller can recover", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    let captured: Error | null = null;
    try {
      mod.parsePreselectFlag!("definitely-not-a-hook");
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    const msg = captured!.message;
    // At least one of the canonical hook names appears in the "known names"
    // hint so the caller can correct the typo.
    const hasKnownHint = KNOWN_NAMES.some((n) => msg.includes(n));
    expect(hasKnownHint).toBe(true);
  });
});

describe("AC-STE-286.1 — parsePreselectFlag rejects empty value", () => {
  test("'' throws with Refusing: + non-empty hint", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    expect(() => mod.parsePreselectFlag!("")).toThrow(/Refusing:/);
  });

  test("'   ' (whitespace-only) throws", async () => {
    const mod = await loadModule();
    expect(() => mod.parsePreselectFlag!("   ")).toThrow(/Refusing:/);
  });

  test("',,' (commas with no names) throws", async () => {
    const mod = await loadModule();
    expect(() => mod.parsePreselectFlag!(",,")).toThrow(/Refusing:/);
  });
});

describe("AC-STE-286.1 — idempotent re-run preserves preselected entries", () => {
  const PLUGIN_ROOT = "/plugin/dev-process-toolkit";

  test("installHooks called twice with the same names is a no-op on the second call", async () => {
    const mod = await loadModule();
    const dir = mkdtempSync(join(tmpdir(), "ste-286-preselect-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, "{}");
    try {
      const names = ["pre-commit-gate-check", "pre-pr-spec-review"];
      mod.installHooks(settingsPath, names, PLUGIN_ROOT);
      const firstWrite = readFileSync(settingsPath, "utf-8");
      mod.installHooks(settingsPath, names, PLUGIN_ROOT);
      const secondWrite = readFileSync(settingsPath, "utf-8");
      // Byte-for-byte stable across re-runs.
      expect(secondWrite).toBe(firstWrite);
      // And the installed-name list still matches exactly (no duplicates).
      const installed = mod.readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(installed.sort()).toEqual([...names].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parsePreselectFlag('all') + installHooks twice → 4 entries, no duplicates", async () => {
    const mod = await loadModule();
    expect(typeof mod.parsePreselectFlag).toBe("function");
    const dir = mkdtempSync(join(tmpdir(), "ste-286-preselect-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, "{}");
    try {
      const { names } = mod.parsePreselectFlag!("all");
      mod.installHooks(settingsPath, names, PLUGIN_ROOT);
      mod.installHooks(settingsPath, names, PLUGIN_ROOT);
      const installed = mod.readInstalledHookNames(settingsPath, PLUGIN_ROOT);
      expect(installed.sort()).toEqual([...KNOWN_NAMES].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

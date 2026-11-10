// STE-730 (M_b2fdc0) — `verification.test_commands` in specs/settings.yaml.
//
// AC-STE-730.1: an optional non-empty list of mappings, each with exactly
// `stack` (bun | pytest | flutter) and `command` (a non-empty list of non-empty
// strings). Any other shape throws `SettingsShapeError` naming the dotted path
// (e.g. `verification.test_commands[1].command`). The key joins the closed key
// order, `NEW_KEYS` and docs/settings-reference.md.
//
// AC-STE-730.2 (loader half): a legacy CLAUDE.md `## Verification` block never
// supplies the key.
//
// All names are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PLUGIN_ROOT, SHIPPED_SRC, settingsYaml } from "./_m_b2fdc0_ste730_fixture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = await import(join(SHIPPED_SRC, "project_settings.ts"));

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste730-settings-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function withCommands(testCommands: unknown): string {
  return tree({ "specs/settings.yaml": settingsYaml(testCommands) });
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw, got a return");
}

const GOOD = [
  { stack: "flutter", command: ["fvm", "flutter", "test"] },
  { stack: "pytest", command: ["make", "test-api"] },
  { stack: "bun", command: ["bun", "test"] },
];

describe("AC-STE-730.1 — a well-formed `verification.test_commands` loads", () => {
  test("loadProjectSection returns the declared list verbatim, in order", () => {
    const root = withCommands(GOOD);
    expect(M.loadProjectSection(root, "verification").test_commands).toEqual(GOOD);
  });

  test("loadProjectSettings accepts it too (the whole-file check)", () => {
    const root = withCommands(GOOD);
    const r = M.loadProjectSettings(root);
    expect(r.source).toBe("settings");
    expect(r.settings.verification.test_commands).toEqual(GOOD);
  });

  test("the key is optional: absent, the section carries no test_commands", () => {
    const root = tree({ "specs/settings.yaml": settingsYaml() });
    expect("test_commands" in M.loadProjectSection(root, "verification")).toBe(false);
  });
});

/** [label, value of test_commands, the dotted path the refusal must name] */
const MALFORMED: ReadonlyArray<[string, unknown, string]> = [
  ["a string, not a list", "bun test", "verification.test_commands"],
  ["a mapping, not a list", { stack: "bun", command: ["bun", "test"] }, "verification.test_commands"],
  ["an empty list", [], "verification.test_commands"],
  ["an entry that is a string", ["bun test"], "verification.test_commands[0]"],
  ["an entry missing stack", [{ command: ["bun", "test"] }], "verification.test_commands[0].stack"],
  ["an entry missing command", [{ stack: "bun" }], "verification.test_commands[0].command"],
  ["an unknown stack", [{ stack: "jest", command: ["npx", "jest"] }], "verification.test_commands[0].stack"],
  ["a non-string stack", [{ stack: 3, command: ["bun", "test"] }], "verification.test_commands[0].stack"],
  ["command as a string", [{ stack: "bun", command: "bun test" }], "verification.test_commands[0].command"],
  ["an empty command list", [{ stack: "bun", command: [] }], "verification.test_commands[0].command"],
  ["an empty command word", [{ stack: "bun", command: ["bun", ""] }], "verification.test_commands[0].command"],
  ["a non-string command word", [{ stack: "bun", command: ["bun", 7] }], "verification.test_commands[0].command"],
  ["an extra key on an entry", [{ stack: "bun", command: ["bun", "test"], cwd: "svc" }], "verification.test_commands[0]"],
  ["the SECOND entry's command is bad", [GOOD[0], { stack: "pytest", command: [1] }], "verification.test_commands[1].command"],
  ["the SECOND entry's stack is bad", [GOOD[0], { stack: "go", command: ["go", "test"] }], "verification.test_commands[1].stack"],
];

describe("AC-STE-730.1 — any other shape throws SettingsShapeError naming the dotted path", () => {
  for (const [label, value, path] of MALFORMED) {
    test(`${label} → names \`${path}\` (section read)`, () => {
      const root = withCommands(value);
      const e = thrown(() => M.loadProjectSection(root, "verification"));
      expect(e).toBeInstanceOf(M.SettingsShapeError);
      expect(e.message).toContain(path);
    });

    test(`${label} → names \`${path}\` (whole-file read)`, () => {
      const root = withCommands(value);
      const e = thrown(() => M.loadProjectSettings(root));
      expect(e).toBeInstanceOf(M.SettingsShapeError);
      expect(e.message).toContain(path);
    });
  }

  test("the entry-level refusal names the index, not just the list", () => {
    const e = thrown(() => M.loadProjectSection(withCommands([GOOD[0], GOOD[1], { stack: "bun" }]), "verification"));
    expect(e.message).toContain("verification.test_commands[2].command");
  });
});

describe("AC-STE-730.1 — the key is registered", () => {
  test("it is in the closed key order of `verification`", () => {
    expect(M.settingsKeyOrder("verification")).toContain("test_commands");
  });

  test("it is in NEW_KEYS as `verification.test_commands`", () => {
    expect(M.NEW_KEYS).toContain("verification.test_commands");
  });

  test("docs/settings-reference.md has a `verification.test_commands` row naming stack, command and the three stacks", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf8");
    const row = doc.split("\n").find((l) => l.startsWith("| `verification.test_commands`"));
    expect(row, "no table row for `verification.test_commands`").toBeDefined();
    for (const word of ["stack", "command", "bun", "pytest", "flutter"]) expect(row).toContain(word);
  });
});

describe("AC-STE-730.2 — a legacy CLAUDE.md verification block never supplies the key", () => {
  const LEGACY = ["# Synthetic", "", "## Verification", "", "verify_skill: smoke-test", "verify_mode: advisory", "run_cmd: none", "e2e_cmd: none", ""];

  test("a legacy block loads with no test_commands", () => {
    const root = tree({ "CLAUDE.md": LEGACY.join("\n") });
    expect(M.detectSettingsSource(root)).toBe("legacy");
    expect("test_commands" in M.loadProjectSection(root, "verification")).toBe(false);
  });

  test("a `test_commands:` line in a legacy block is never read as the key", () => {
    const md = [...LEGACY.slice(0, -1), "test_commands: fvm flutter test", ""].join("\n");
    const root = tree({ "CLAUDE.md": md });
    let section: Record<string, unknown> | null = null;
    try {
      section = M.loadProjectSection(root, "verification");
    } catch {
      // Refusing the line is an acceptable answer too; supplying it is not.
      section = null;
    }
    expect(section === null || !("test_commands" in section)).toBe(true);
  });
});

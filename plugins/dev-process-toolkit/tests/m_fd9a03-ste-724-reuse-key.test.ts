// STE-724 (M_fd9a03) AC.1, AC.2, AC.3 — the live reuse key.
//
// Module under test: adapters/_shared/src/gate_reuse.ts (new), export
// `computeReuseKey(projectRoot, commandText, options?)`. It composes the
// M_7bc805 `gateReuseKey` (gate_reuse_key.ts) and adds only the per-command
// hash; it returns `null` unless every part is readable and the tree is clean.
//
// Every receipt here is minted by SPAWNING the shipped gate-receipt front door
// (the STE-614 rule), every git call runs with a neutral config, and every tree
// lives in a temp dir from the shared M_7bc805 fixture.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  GATE_OUTCOMES_ON,
  SETTINGS_HEAD,
  SRC,
  cleanupTemps,
  git,
  makeTree,
  mintRun,
  readJson,
  tempDir,
} from "./_m_7bc805_gate_outcome_fixture";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";

type AnyMod = Record<string, any>;
const T = 120_000;

const GATE_REUSE = join(SRC, "gate_reuse.ts");
const REUSE_ON_SETTINGS = `${SETTINGS_HEAD}${GATE_OUTCOMES_ON}optimizations:\n  gate_commands: reuse\n`;
const CMD = "bun test";

/** The M_7bc805 `gateReuseKey` field set (archived AC-STE-715.1). */
const GATE_KEY_FIELDS = ["bun", "clean", "commands", "head", "plugin", "settings", "v", "worktree"];

afterAll(cleanupTemps);

async function reuseModule(): Promise<AnyMod> {
  if (!existsSync(GATE_REUSE)) throw new Error(`gate_reuse.ts is absent: ${GATE_REUSE}`);
  return (await import(GATE_REUSE)) as AnyMod;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * A clean, committed toolkit tree with `gate_commands: reuse` and gate outcomes on.
 *
 * It commits `.dpt/.gitignore` the way /setup writes it (`writeDptGitignore`),
 * as a toolkit-managed tree does: without it the first receipt write creates
 * that file, and the tree a receipt is minted in is no longer clean.
 */
function reuseTree(label: string): string {
  const root = makeTree(label, "on");
  writeDptGitignore(root);
  writeFileSync(join(root, "specs", "settings.yaml"), REUSE_ON_SETTINGS);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "reuse on");
  return root;
}

// ===========================================================================
// AC-STE-724.1 — the key's shape
// ===========================================================================

describe("AC-STE-724.1 computeReuseKey returns exactly { gate, command_sha256 }", () => {
  test("on a clean temporary repository the key has exactly gate and command_sha256", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac1-shape");
    const key = await m.computeReuseKey(root, CMD);
    expect(key).not.toBeNull();
    expect(Object.keys(key).sort()).toEqual(["command_sha256", "gate"]);
  }, T);

  test("the gate part carries exactly the M_7bc805 gateReuseKey fields", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac1-gate-fields");
    const key = await m.computeReuseKey(root, CMD);
    expect(Object.keys(key.gate).sort()).toEqual(GATE_KEY_FIELDS);
    expect(key.gate.v).toBe(1);
    expect(key.gate.clean).toBe(true);
    expect(key.gate.head).toBe(git(root, "rev-parse", "HEAD").trim());
  }, T);

  test("command_sha256 is sha256: of the exact command text, one byte apart differing", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac1-cmd-hash");
    const a = await m.computeReuseKey(root, CMD);
    const b = await m.computeReuseKey(root, `${CMD} `);
    expect(a.command_sha256).toBe(`sha256:${sha(CMD)}`);
    expect(b.command_sha256).toBe(`sha256:${sha(`${CMD} `)}`);
    expect(a.command_sha256).not.toBe(b.command_sha256);
    expect(a.gate).toEqual(b.gate);
  }, T);

  test("options (bunVersion, pluginRoot) pass through to gateReuseKey unchanged", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac1-options");
    const pluginRoot = join(tempDir("ac1-plugin"), "plugin");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), '{"name":"stub","version":"0.0.1"}\n');
    const key = await m.computeReuseKey(root, CMD, { bunVersion: "0.0.0-stub", pluginRoot });
    expect(key.gate.bun).toBe("0.0.0-stub");
    expect(key.gate.plugin).toBe("0.0.1");
  }, T);
});

// ===========================================================================
// AC-STE-724.2 — one key function
// ===========================================================================

describe("AC-STE-724.2 the gate part is the key the M_7bc805 run receipt records", () => {
  test("computeReuseKey(root, cmd).gate deep-equals the run receipt's evidence.key", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac2-same-key");
    const { path } = mintRun(root);
    const recorded = (readJson(path).evidence as Record<string, unknown>).key;
    expect(recorded).not.toBeNull();
    const key = await m.computeReuseKey(root, CMD);
    expect(key.gate).toEqual(recorded);
  }, T);

  test("gate_reuse.ts imports gateReuseKey and reads no Bun.version, runningDptVersion or settings.yaml of its own", () => {
    expect(existsSync(GATE_REUSE)).toBe(true);
    const src = readFileSync(GATE_REUSE, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\bgateReuseKey\b[^}]*\}\s*from\s*["']\.\/gate_reuse_key(\.ts)?["']/);
    expect(src).not.toContain("Bun.version");
    expect(src).not.toContain("runningDptVersion");
    expect(src).not.toContain("settings.yaml");
  });

  test("CONTROL: the grep reads a live file — gate_reuse_key.ts itself names Bun.version and runningDptVersion", () => {
    const src = readFileSync(join(SRC, "gate_reuse_key.ts"), "utf-8");
    expect(src).toContain("Bun.version");
    expect(src).toContain("runningDptVersion");
  });
});

// ===========================================================================
// AC-STE-724.3 — no key on a tree that is not clean and committed
// ===========================================================================

describe("AC-STE-724.3 computeReuseKey returns null", () => {
  test("CONTROL: the clean committed tree yields a non-null key", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac3-control");
    expect(await m.computeReuseKey(root, CMD)).not.toBeNull();
  }, T);

  test("null for a modified tracked file", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac3-modified");
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.1","private":true}\n');
    expect(await m.computeReuseKey(root, CMD)).toBeNull();
  }, T);

  test("null for a staged change", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac3-staged");
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(root, "add", "staged.txt");
    expect(await m.computeReuseKey(root, CMD)).toBeNull();
  }, T);

  test("null for an untracked file", async () => {
    const m = await reuseModule();
    const root = reuseTree("ac3-untracked");
    writeFileSync(join(root, "untracked.txt"), "untracked\n");
    expect(await m.computeReuseKey(root, CMD)).toBeNull();
  }, T);

  test("null for a non-git directory", async () => {
    const m = await reuseModule();
    const dir = join(tempDir("ac3-non-git"), "plain");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "# plain\n");
    expect(await m.computeReuseKey(dir, CMD)).toBeNull();
  }, T);

  test("null for an unborn HEAD", async () => {
    const m = await reuseModule();
    const root = join(tempDir("ac3-unborn"), "repo");
    mkdirSync(root, { recursive: true });
    git(root, "init", "-q", "-b", "main");
    // Nothing staged or untracked: only the unborn HEAD keeps the key away.
    expect(git(root, "status", "--porcelain").trim()).toBe("");
    expect(await m.computeReuseKey(root, CMD)).toBeNull();
  }, T);
});

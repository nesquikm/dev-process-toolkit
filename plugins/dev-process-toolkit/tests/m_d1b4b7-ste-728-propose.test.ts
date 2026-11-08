// STE-728 (M_d1b4b7) — the closed table's load-time refusal and `propose`.
//
//   AC-STE-728.2  a test-registered row outside the closed shape (a `false`
//                 value, `optimizations.gate_commands: run`, a key outside the
//                 `tracking` and `optimizations` sections) makes the module
//                 throw when it loads, before any proposal is computed. Graded
//                 on temp copies of the module whose PROPOSABLE_SETTINGS array
//                 literal is prefixed with the rows a test registers.
//   AC-STE-728.3  propose's silent cases print nothing and exit 0.
//   AC-STE-728.4  the token_stats fixture prints exactly the set, because and
//                 digest lines.
//   AC-STE-728.5  propose writes nothing.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

import {
  IGNORE_OTHER,
  SETTINGS_HEAD,
  TOKEN_STATS_OFF,
  TOKEN_STATS_REASON,
  TOOL_CALLS_OFF,
  TWO_OFF,
  cleanupTemps,
  gitStatus,
  makeTree,
  pluginCopy,
  printedLines,
  propose,
  proposalMod,
  rules,
  snapshot,
  trackingYaml,
  writeReport,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

// ------------------------------------------------------------------ AC.2

const EXTRA = "__DPT_STE728_TEST_ROWS__";
let copySrc: string | null = null;
let caseN = 0;

/**
 * A fresh module file in a temp copy of the plugin, its PROPOSABLE_SETTINGS
 * array literal prefixed with `globalThis[EXTRA]` — the rows a test registers.
 */
function registeringCopy(): string {
  if (copySrc === null) {
    const door = pluginCopy("ac2-table");
    copySrc = readFileSync(door, "utf-8");
    const m = /export const PROPOSABLE_SETTINGS\b[^=]*=\s*(?:Object\.freeze\(\s*)?\[/.exec(copySrc);
    if (m === null) throw new Error("retro_proposal.ts declares no `export const PROPOSABLE_SETTINGS = [` array literal to register rows into");
    const at = m.index + m[0].length;
    copySrc = `${copySrc.slice(0, at)}\n  ...(((globalThis as any).${EXTRA} ?? []) as any[]),${copySrc.slice(at)}`;
    (registeringCopy as any).dir = join(door, "..");
  }
  const path = join((registeringCopy as any).dir as string, `retro_proposal_ac2_case${++caseN}.ts`);
  writeFileSync(path, copySrc);
  return path;
}

async function loadWith(rows: unknown[]): Promise<{ ok: true; mod: any } | { ok: false; error: unknown }> {
  const path = registeringCopy();
  (globalThis as any)[EXTRA] = rows;
  try {
    return { ok: true, mod: await import(path) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    delete (globalThis as any)[EXTRA];
  }
}

async function rowLike(key: string, value: unknown): Promise<Record<string, unknown>> {
  const { PROPOSABLE_SETTINGS } = await proposalMod();
  return { ...PROPOSABLE_SETTINGS[0], key, value };
}

describe("AC-STE-728.2 a row outside the closed shape makes the module throw on load", () => {
  test("control: a registered row in the closed shape (tracking.<name>.enabled: true) loads, the table then holds four rows", async () => {
    const r = await loadWith([await rowLike("tracking.extra_fixture.enabled", true)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mod.PROPOSABLE_SETTINGS.map((x: any) => x.key)).toContain("tracking.extra_fixture.enabled");
    if (r.ok) expect(r.mod.PROPOSABLE_SETTINGS).toHaveLength(4);
  });

  const bad: [string, string, unknown][] = [
    ["a false value", "tracking.token_stats.enabled", false],
    ["optimizations.gate_commands with the value run", "optimizations.gate_commands", "run"],
    ["a key outside the tracking and optimizations sections", "verification.verify_skill", true],
    ["a key outside the tracking and optimizations sections (close_out)", "close_out.upgrade_offer.enabled", true],
    ["a tracking key not of the .enabled shape", "tracking.token_stats.threshold", true],
  ];
  for (const [name, key, value] of bad) {
    test(`${name} (${key}: ${JSON.stringify(value)}) throws when the module loads`, async () => {
      const r = await loadWith([await rowLike(key, value)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(String((r.error as Error)?.message ?? r.error)).toContain(key);
    });
  }
});

// ------------------------------------------------------------------ AC.3

describe("AC-STE-728.3 propose is silent (no output, exit 0) when nothing applies", () => {
  test("a report with no matching skip reason", async () => {
    const root = makeTree("ac3-nomatch");
    const report = await writeReport("ac3-nomatch", rules());
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("a report whose skip names no tracking switch", async () => {
    const { skipped } = await import("./_m_d1b4b7_ste728_fixture");
    const root = makeTree("ac3-other-skip");
    const report = await writeReport("ac3-other-skip", rules([skipped("zero_yield_round", "no tdd-implement or tdd-refactor round in scope")]));
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("a settings file where every applicable key is already on", async () => {
    const root = makeTree("ac3-on", { settings: SETTINGS_HEAD + trackingYaml({ token_stats: true, tool_calls: true, gate_outcomes: false }) });
    const report = await writeReport("ac3-on", TWO_OFF());
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("a legacy tree (settings in CLAUDE.md, no settings file)", async () => {
    const root = makeTree("ac3-legacy", {
      settings: null,
      claudeMd: "# Fixture\n\n## Task Tracking\n\nmode: none\n\n## Key Commands\n\n- `bun test`\n",
    });
    const report = await writeReport("ac3-legacy", TOKEN_STATS_OFF());
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("a tree with no settings file", async () => {
    const root = makeTree("ac3-none", { settings: null });
    const report = await writeReport("ac3-none", TOKEN_STATS_OFF());
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("a tracking section the section read refuses", async () => {
    const root = makeTree("ac3-bad-tracking", { settings: `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: "yes"\n` });
    const report = await writeReport("ac3-bad-tracking", TOKEN_STATS_OFF());
    const r = propose(root, report);
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  test("control: the same report on an off tree prints", async () => {
    const root = makeTree("ac3-control");
    const report = await writeReport("ac3-control", TOKEN_STATS_OFF());
    const r = propose(root, report);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toBe("");
  });
});

// ------------------------------------------------------------------ AC.4

describe("AC-STE-728.4 the token_stats fixture prints exactly the set, because and digest lines", () => {
  test("cost_per_changed_line skipped naming tracking.token_stats off", async () => {
    const root = makeTree("ac4");
    const report = await writeReport("ac4", TOKEN_STATS_OFF());
    const r = propose(root, report);
    expect(r.status).toBe(0);
    const lines = printedLines(r.stdout);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("set tracking.token_stats.enabled: true");
    expect(lines[1]!.startsWith("because cost_per_changed_line skipped:")).toBe(true);
    expect(lines[1]).toContain(TOKEN_STATS_REASON);
    expect(lines[2]).toMatch(/^digest=sha256:[0-9a-f]{64}$/);
  });

  test("the scope resolving to no session, with the reason naming tracking.token_stats off, proposes the token_stats row", async () => {
    const { skipped } = await import("./_m_d1b4b7_ste728_fixture");
    const reason = "scope resolves to no session (tracking.token_stats off)";
    const root = makeTree("ac4-scope");
    const report = await writeReport(
      "ac4-scope",
      ["slow_gate_run", "gate_rerun_unchanged_key", "zero_yield_round", "cost_per_changed_line"].map((id) => skipped(id, reason)),
    );
    const r = propose(root, report);
    expect(printedLines(r.stdout).filter((l) => l.startsWith("set "))).toEqual(["set tracking.token_stats.enabled: true"]);
  });

  test("the digest is stable across two runs and changes with the settings bytes", async () => {
    const root = makeTree("ac4-digest");
    const report = await writeReport("ac4-digest", TOKEN_STATS_OFF());
    const one = propose(root, report).stdout;
    expect(propose(root, report).stdout).toBe(one);
    writeFileSync(join(root, "specs", "settings.yaml"), `${readFileSync(join(root, "specs", "settings.yaml"), "utf-8")}# a comment\n`);
    expect(propose(root, report).stdout).not.toBe(one);
  });
});

// ------------------------------------------------------------------ AC.5

function claudeAndDpt(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const top of [".dpt", ".claude"]) {
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const n of readdirSync(d)) {
        const full = join(d, n);
        if (statSync(full).isDirectory()) walk(full);
        else out[relative(root, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    };
    walk(join(root, top));
  }
  return out;
}

describe("AC-STE-728.5 propose writes nothing", () => {
  test("git status, every file under .dpt/ and every file under .claude/ are identical before and after (printing case)", async () => {
    const root = makeTree("ac5", { gitignore: IGNORE_OTHER, untrackedLocal: '{\n  "permissions": {}\n}\n' });
    mkdirSync(join(root, ".dpt", "ledger"), { recursive: true });
    writeFileSync(join(root, ".dpt", "ledger", "token-ledger.jsonl"), "");
    const report = await writeReport("ac5", TWO_OFF());
    const status = gitStatus(root);
    const files = claudeAndDpt(root);
    const all = snapshot(root);
    const r = propose(root, report);
    expect(r.stdout).toContain("add .gitignore: .claude/settings.local.json");
    expect(gitStatus(root)).toBe(status);
    expect(claudeAndDpt(root)).toEqual(files);
    expect(snapshot(root)).toEqual(all);
  });

  test("the same holds on a tree with no .dpt/ at all", async () => {
    const root = makeTree("ac5-nodpt", { dptGitignore: false });
    const report = await writeReport("ac5-nodpt", TOOL_CALLS_OFF());
    const all = snapshot(root);
    const status = gitStatus(root);
    const r = propose(root, report);
    expect(r.stdout).not.toBe("");
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    expect(gitStatus(root)).toBe(status);
    expect(snapshot(root)).toEqual(all);
  });
});


// STE-810 (M_c46877) — a toolkit run records the settings it started under.
//
// AC-STE-810.1  the module, the row schema, the path composed in dpt_paths.ts
// AC-STE-810.2  `settings` = every PROPOSABLE_SETTINGS key and no other; the privacy plant
// AC-STE-810.3  `settings_hash`, `plugin_version`, `registration`
// AC-STE-810.4  the hook entrypoint + its hooks.json registration; skill/prompt forms; `fr`
// AC-STE-810.5  the any-switch gate; the all-off tree loads no toolkit module
// AC-STE-810.6  fail-open
// AC-STE-810.7  the CLI
// AC-STE-810.8  docs/retro-reference.md
// AC-STE-810.9  is the full-suite gate the orchestrator runs; no test here.
//
// Shapes these suites assume (read off the FR's Technical Design):
//   adapters/_shared/src/run_start.ts exports snapshotSettings(root),
//     recordRunStart(root, { session, skill, fr, at }) and readRunStarts(root, session?);
//     `at` is an ISO-8601 string and lands verbatim in `started_at`.
//   templates/hooks/process/run-start-snapshot.sh execs
//     templates/hooks/_lib/hooks/run-start-snapshot.ts.
//   The row's `skill` is the full `dev-process-toolkit:<name>` string — the
//     form the token ledger keys on (`attributionSkill`), which STE-811 joins to.
//
// All names, paths and ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PROPOSABLE_SETTINGS } from "../adapters/_shared/src/retro_proposal";
import { captureStatus } from "../adapters/_shared/src/capture_registration";
import { GIT_ENV, PLUGIN_ROOT, SETTINGS_HEAD, cleanupTemps, pluginCopy, tempDir } from "./_m_7bc805_gate_outcome_fixture";

const T = 120_000;
const SID = "00000000-0000-4000-8000-000000000810";
const SID2 = "00000000-0000-4000-8000-000000000811";
const MODULE_REL = "adapters/_shared/src/run_start.ts";
const WRAPPER_REL = "templates/hooks/process/run-start-snapshot.sh";
const ENTRY_REL = "templates/hooks/_lib/hooks/run-start-snapshot.ts";
const LEDGER_REL = join(".dpt", "ledger", "run-starts.jsonl");
const ROW_KEYS = ["schema", "session_id", "skill", "fr", "started_at", "settings_hash", "settings", "plugin_version", "registration"].sort();
const RUNNING_VERSION = (JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8")) as { version: string }).version;

afterAll(cleanupTemps);

// ------------------------------------------------------------------ fixtures

const TOKENS_ON = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n`;
const ALL_OFF = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  gate_outcomes:\n    enabled: false\n  tool_calls:\n    enabled: false\n  review_findings:\n    enabled: false\n`;
const GATE_ONLY = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  gate_outcomes:\n    enabled: true\n`;

/** A git-less project root holding `specs/settings.yaml` (when `settings` is not null) and the given files. */
function makeRoot(label: string, settings: string | null, files: Record<string, string> = {}): string {
  const root = join(tempDir(`ste810-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# Synthetic project\n");
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

/** `makeRoot` plus `git init` — the hook resolves the checkout root from `.git`. */
function makeCheckout(label: string, settings: string | null, files: Record<string, string> = {}): string {
  const root = makeRoot(label, settings, files);
  const p = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root, encoding: "utf-8", env: { ...process.env, ...GIT_ENV } });
  if (p.status !== 0) throw new Error(`git init failed: ${p.stderr}`);
  return root;
}

function ledgerFile(root: string): string {
  return join(root, LEDGER_REL);
}

function ledgerRows(root: string): Array<Record<string, any>> {
  const f = ledgerFile(root);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, any>);
}

async function loadModule(): Promise<Record<string, any>> {
  return (await import(`../${MODULE_REL}`)) as Record<string, any>;
}

/** Record one start through the module and return the one row it wrote. */
async function recordOne(root: string, skill = "dev-process-toolkit:implement", fr: string | null = null): Promise<Record<string, any>> {
  const m = await loadModule();
  const before = ledgerRows(root).length;
  await m.recordRunStart(root, { session: SID, skill, fr, at: "2026-11-17T10:00:00.000Z" });
  const rows = ledgerRows(root);
  expect(rows.length).toBe(before + 1);
  return rows[rows.length - 1]!;
}

/** Canonical JSON: keys sorted at every level, no whitespace. Written here, independent of the module. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A `.claude/settings.local.json` holding one capture entry that is not the current render (registration `stale`). */
function plantStaleCapture(root: string): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  const entry = { type: "command", command: '"/synthetic/plugin"/templates/hooks/process/tool-call-capture.sh # 0.0.0-stale', timeout: 2 };
  writeFileSync(
    join(root, ".claude", "settings.local.json"),
    `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash|Skill", hooks: [entry] }], PostToolUse: [{ matcher: "Bash|Skill", hooks: [entry] }] } }, null, 2)}\n`,
  );
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runHook(payload: unknown, opts: { pluginRoot?: string; env?: Record<string, string>; cwd?: string } = {}): Run {
  const pluginRoot = opts.pluginRoot ?? PLUGIN_ROOT;
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const p = spawnSync("/bin/bash", [join(pluginRoot, WRAPPER_REL)], {
    cwd: opts.cwd,
    input,
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(opts.env ?? {}) },
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

function runCli(args: string[], opts: { pluginRoot?: string; session?: string | null } = {}): Run {
  const pluginRoot = opts.pluginRoot ?? PLUGIN_ROOT;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...GIT_ENV };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (opts.session !== null) env.CLAUDE_CODE_SESSION_ID = opts.session ?? SID;
  const p = spawnSync("bun", ["run", join(pluginRoot, MODULE_REL), ...args], { encoding: "utf-8", env });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

function skillPayload(root: string, skill: string, args: string, sid = SID): Record<string, unknown> {
  return {
    session_id: sid,
    transcript_path: join(root, "synthetic-transcript.jsonl"),
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: "Skill",
    tool_input: { skill, args },
    tool_use_id: "toolu_STE810",
  };
}

function promptPayload(root: string, prompt: string, sid = SID): Record<string, unknown> {
  return {
    session_id: sid,
    transcript_path: join(root, "synthetic-transcript.jsonl"),
    cwd: root,
    hook_event_name: "UserPromptSubmit",
    prompt,
  };
}

const FR_FILES = {
  "specs/frs/STE-1.md": "---\ntitle: synthetic\n---\n",
  "specs/frs/archive/STE-2.md": "---\ntitle: synthetic archived\n---\n",
};

// ===========================================================================
// AC-STE-810.1 — the module, the row, the path
// ===========================================================================

describe("AC-STE-810.1 the run-start row", () => {
  // STE-810 review (Pass 2): a JSON line that is not a run-start row is skipped, never thrown on.
  test("readRunStarts skips lines that are not dpt-run-start/1 objects", async () => {
    const { readRunStarts, recordRunStart } = await import("../adapters/_shared/src/run_start.ts");
    const root = makeRoot("read-shape", TOKENS_ON);
    recordRunStart(root, { session: SID, skill: "dev-process-toolkit:implement", fr: null, at: "2026-11-16T00:00:00.000Z" });
    const file = ledgerFile(root);
    writeFileSync(file, `null\n42\n"text"\n{"schema":"other/1","session_id":"${SID}"}\n${readFileSync(file, "utf-8")}`);
    expect(readRunStarts(root).length).toBe(1);
    expect(readRunStarts(root, SID).length).toBe(1);
  });

  test("runStartLedgerPath(root) is <root>/.dpt/ledger/run-starts.jsonl", async () => {
    const paths = (await import("../adapters/_shared/src/dpt_paths")) as Record<string, any>;
    expect(typeof paths.runStartLedgerPath).toBe("function");
    expect(paths.runStartLedgerPath("/synthetic/root")).toBe("/synthetic/root/.dpt/ledger/run-starts.jsonl");
  });

  test("recordRunStart appends one line at runStartLedgerPath carrying exactly the nine keys and schema dpt-run-start/1", async () => {
    const root = makeRoot("row", TOKENS_ON, FR_FILES);
    const row = await recordOne(root, "dev-process-toolkit:tdd", "STE-1");
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row.schema).toBe("dpt-run-start/1");
    expect(row.session_id).toBe(SID);
    expect(row.skill).toBe("dev-process-toolkit:tdd");
    expect(row.fr).toBe("STE-1");
    expect(row.started_at).toBe("2026-11-17T10:00:00.000Z");
  }, T);

  test("a second start appends a second line; the first line's bytes are untouched", async () => {
    const root = makeRoot("append", TOKENS_ON);
    await recordOne(root);
    const first = readFileSync(ledgerFile(root), "utf-8");
    await recordOne(root, "dev-process-toolkit:gate-check");
    const both = readFileSync(ledgerFile(root), "utf-8");
    expect(both.startsWith(first)).toBe(true);
    expect(both.split("\n").filter((l) => l !== "").length).toBe(2);
    expect(both.endsWith("\n")).toBe(true);
  }, T);

  test("readRunStarts(root, session) returns only that session's rows; readRunStarts(root) returns all", async () => {
    const root = makeRoot("read", TOKENS_ON);
    const m = await loadModule();
    await m.recordRunStart(root, { session: SID, skill: "dev-process-toolkit:tdd", fr: null, at: "2026-11-17T10:00:00.000Z" });
    await m.recordRunStart(root, { session: SID2, skill: "dev-process-toolkit:implement", fr: null, at: "2026-11-17T10:05:00.000Z" });
    const mine = (await m.readRunStarts(root, SID)) as Array<Record<string, unknown>>;
    expect(mine.map((r) => [r.session_id, r.skill])).toEqual([[SID, "dev-process-toolkit:tdd"]]);
    const all = (await m.readRunStarts(root)) as Array<Record<string, unknown>>;
    expect(all.map((r) => r.session_id)).toEqual([SID, SID2]);
  }, T);

  test("the ledger path literal is composed only in dpt_paths.ts", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) {
          if (name.name !== "node_modules") walk(p);
        } else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && readFileSync(p, "utf-8").includes("run-starts.jsonl")) {
          offenders.push(p.slice(PLUGIN_ROOT.length + 1));
        }
      }
    };
    walk(join(PLUGIN_ROOT, "adapters"));
    walk(join(PLUGIN_ROOT, "templates"));
    expect(offenders).toEqual(["adapters/_shared/src/dpt_paths.ts"]);
  });
});

// ===========================================================================
// AC-STE-810.2 — proposable keys only; the privacy plant
// ===========================================================================

describe("AC-STE-810.2 settings = the proposable keys only", () => {
  const proposable = PROPOSABLE_SETTINGS.map((r) => r.key).sort();

  test("settings maps every PROPOSABLE_SETTINGS key and no other", async () => {
    const root = makeRoot("keys", TOKENS_ON);
    const row = await recordOne(root);
    expect(Object.keys(row.settings).sort()).toEqual(proposable);
  }, T);

  test("set keys carry their value; unset keys carry the literal \"absent\" (not the loader default)", async () => {
    const root = makeRoot(
      "values",
      `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  gate_outcomes:\n    enabled: false\n`,
    );
    const row = await recordOne(root);
    expect(row.settings).toEqual({
      "tracking.token_stats.enabled": true,
      "tracking.gate_outcomes.enabled": false,
      "tracking.tool_calls.enabled": "absent",
      "optimizations.gate_commands": "absent",
    });
  }, T);

  test("an optimizations knob that is set carries its value", async () => {
    const root = makeRoot(
      "knob",
      `${SETTINGS_HEAD}tracking:\n  gate_outcomes:\n    enabled: true\noptimizations:\n  gate_commands: run\n`,
    );
    const row = await recordOne(root);
    expect(row.settings["optimizations.gate_commands"]).toBe("run");
    expect(row.settings["tracking.gate_outcomes.enabled"]).toBe(true);
  }, T);

  test("privacy plant (module): a non-proposable key's unique string appears nowhere in the ledger bytes", async () => {
    const plant = `PLANTED-${crypto.randomUUID()}`;
    const root = makeRoot(
      "plant-module",
      `${SETTINGS_HEAD}verification:\n  run_cmd: ${plant}\ntracking:\n  token_stats:\n    enabled: true\n`,
    );
    await recordOne(root);
    const bytes = readFileSync(ledgerFile(root), "utf-8");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.includes(plant)).toBe(false);
  }, T);

  test("privacy plant (hook): a non-proposable key's unique string appears nowhere in the ledger bytes", () => {
    const plant = `PLANTED-${crypto.randomUUID()}`;
    const root = makeCheckout(
      "plant-hook",
      `${SETTINGS_HEAD}verification:\n  run_cmd: ${plant}\ntracking:\n  token_stats:\n    enabled: true\n`,
    );
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(true);
    const bytes = readFileSync(ledgerFile(root), "utf-8");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.includes(plant)).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-810.3 — the hash, plugin_version, registration
// ===========================================================================

describe("AC-STE-810.3 settings_hash, plugin_version, registration", () => {
  test("settings_hash is sha256 hex of the canonical JSON of { settings, plugin_version, registration }", async () => {
    const root = makeRoot("hash", TOKENS_ON);
    const row = await recordOne(root);
    expect(row.settings_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.settings_hash).toBe(sha256(canonical({ settings: row.settings, plugin_version: row.plugin_version, registration: row.registration })));
  }, T);

  test("plugin_version is the running plugin's manifest version", async () => {
    const root = makeRoot("version", TOKENS_ON);
    const row = await recordOne(root);
    expect(row.plugin_version).toBe(RUNNING_VERSION);
  }, T);

  test("registration is captureStatus(root).registration — `none` with no capture entry", async () => {
    const root = makeRoot("reg-none", TOKENS_ON);
    const row = await recordOne(root);
    expect(row.registration).toBe("none");
    expect(row.registration).toBe(captureStatus(root).registration);
  }, T);

  test("registration is captureStatus(root).registration — `stale` with a capture entry naming another render", async () => {
    const root = makeRoot("reg-stale", TOKENS_ON);
    plantStaleCapture(root);
    const row = await recordOne(root);
    expect(row.registration).toBe("stale");
    expect(row.registration).toBe(captureStatus(root).registration);
  }, T);

  test("reordering the settings file with equal values leaves the hash unchanged", async () => {
    const a = makeRoot(
      "order-a",
      `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  gate_outcomes:\n    enabled: false\noptimizations:\n  gate_commands: run\n`,
    );
    const b = makeRoot(
      "order-b",
      `${SETTINGS_HEAD}optimizations:\n  gate_commands: run\ntracking:\n  gate_outcomes:\n    enabled: false\n  token_stats:\n    enabled: true\n`,
    );
    const ra = await recordOne(a);
    const rb = await recordOne(b);
    expect(rb.settings_hash).toBe(ra.settings_hash);
  }, T);

  test("changing one setting changes the hash (gate_outcomes absent → false)", async () => {
    const a = makeRoot("chg-a", TOKENS_ON);
    const b = makeRoot("chg-b", `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  gate_outcomes:\n    enabled: false\n`);
    const ra = await recordOne(a);
    const rb = await recordOne(b);
    expect(rb.settings_hash).not.toBe(ra.settings_hash);
  }, T);

  test("changing the registration changes the hash (none → stale, settings equal)", async () => {
    const a = makeRoot("chg-reg-a", TOKENS_ON);
    const b = makeRoot("chg-reg-b", TOKENS_ON);
    plantStaleCapture(b);
    const ra = await recordOne(a);
    const rb = await recordOne(b);
    expect(rb.settings).toEqual(ra.settings);
    expect(rb.settings_hash).not.toBe(ra.settings_hash);
  }, T);

  test("changing the plugin version changes the hash: a plugin copy at another version records that version", () => {
    const copy = pluginCopy("ste810-version");
    const manifest = join(copy, ".claude-plugin", "plugin.json");
    const json = JSON.parse(readFileSync(manifest, "utf-8")) as Record<string, unknown>;
    json.version = "9.9.9-synthetic";
    writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`);
    const a = makeRoot("chg-ver-a", TOKENS_ON);
    const b = makeRoot("chg-ver-b", TOKENS_ON);
    expect(runCli([a, "dev-process-toolkit:tdd"]).exitCode).toBe(0);
    expect(runCli([b, "dev-process-toolkit:tdd"], { pluginRoot: copy }).exitCode).toBe(0);
    const [ra] = ledgerRows(a);
    const [rb] = ledgerRows(b);
    expect(ra!.plugin_version).toBe(RUNNING_VERSION);
    expect(rb!.plugin_version).toBe("9.9.9-synthetic");
    expect(rb!.settings_hash).not.toBe(ra!.settings_hash);
  }, T);

  test("plugin_version is \"unknown\" when the running plugin's manifest is unreadable", () => {
    const copy = pluginCopy("ste810-nomanifest");
    rmSync(join(copy, ".claude-plugin", "plugin.json"));
    const root = makeRoot("nomanifest", TOKENS_ON);
    const r = runCli([root, "dev-process-toolkit:tdd"], { pluginRoot: copy });
    expect(r.exitCode).toBe(0);
    const [row] = ledgerRows(root);
    expect(row!.plugin_version).toBe("unknown");
  }, T);
});

// ===========================================================================
// AC-STE-810.4 — the hook entrypoint and its registration
// ===========================================================================

describe("AC-STE-810.4 hooks.json registration", () => {
  const COMMAND = '"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/run-start-snapshot.sh';
  type Group = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
  const hooks = (): Record<string, Group[]> =>
    (JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf-8")) as { hooks: Record<string, Group[]> }).hooks;
  const groupsHolding = (groups: Group[] | undefined): Group[] =>
    (groups ?? []).filter((g) => (g.hooks ?? []).some((h) => h.type === "command" && h.command === COMMAND));

  test("PreToolUse registers the run-start hook under matcher `Skill`", () => {
    expect(groupsHolding(hooks().PreToolUse).map((g) => g.matcher)).toEqual(["Skill"]);
  });

  test("UserPromptSubmit registers the run-start hook", () => {
    expect(groupsHolding(hooks().UserPromptSubmit).length).toBe(1);
  });

  test("the wrapper exists and execs the _lib entrypoint, which exists", () => {
    expect(existsSync(join(PLUGIN_ROOT, WRAPPER_REL))).toBe(true);
    expect(readFileSync(join(PLUGIN_ROOT, WRAPPER_REL), "utf-8")).toContain(`exec bun run "\${CLAUDE_PLUGIN_ROOT}/${ENTRY_REL}"`);
    expect(existsSync(join(PLUGIN_ROOT, ENTRY_REL))).toBe(true);
  });
});

describe("AC-STE-810.4 the hook records toolkit skill starts", () => {
  test("PreToolUse Skill dev-process-toolkit:<name> records one row for the payload's session and skill", () => {
    const root = makeCheckout("hook-skill", TOKENS_ON, FR_FILES);
    const r = runHook(skillPayload(root, "dev-process-toolkit:tdd", "STE-1"));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    const rows = ledgerRows(root);
    expect(rows.map((x) => [x.schema, x.session_id, x.skill, x.fr])).toEqual([["dpt-run-start/1", SID, "dev-process-toolkit:tdd", "STE-1"]]);
  }, T);

  test("the hook row's started_at is an ISO instant taken at the hook run", () => {
    const root = makeCheckout("hook-at", TOKENS_ON);
    const before = Date.now();
    runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    const after = Date.now();
    const [row] = ledgerRows(root);
    const at = Date.parse(row!.started_at);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(after + 1000);
  }, T);

  test("UserPromptSubmit with a prompt whose first token is /dev-process-toolkit:<name> records one row", () => {
    const root = makeCheckout("hook-prompt", TOKENS_ON, FR_FILES);
    const r = runHook(promptPayload(root, "/dev-process-toolkit:implement STE-1 please"));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(ledgerRows(root).map((x) => [x.session_id, x.skill, x.fr])).toEqual([[SID, "dev-process-toolkit:implement", "STE-1"]]);
  }, T);

  test("a prompt that names the command after its first token records nothing", () => {
    const root = makeCheckout("hook-prompt-mid", TOKENS_ON);
    const r = runHook(promptPayload(root, "please run /dev-process-toolkit:implement STE-1"));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a prompt naming another plugin's command records nothing", () => {
    const root = makeCheckout("hook-prompt-foreign", TOKENS_ON);
    const r = runHook(promptPayload(root, "/simplify the diff"));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a Skill call to a foreign skill records nothing", () => {
    const root = makeCheckout("hook-foreign", TOKENS_ON);
    const r = runHook(skillPayload(root, "other-plugin:implement", "STE-1"));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a Skill call to an unprefixed skill records nothing", () => {
    const root = makeCheckout("hook-bare", TOKENS_ON);
    const r = runHook(skillPayload(root, "simplify", ""));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("fr is the first argument token equal to a specs/frs/ stem", () => {
    const root = makeCheckout("fr-first", TOKENS_ON, FR_FILES);
    runHook(skillPayload(root, "dev-process-toolkit:implement", "M_abc --fast STE-1 STE-2"));
    expect(ledgerRows(root).map((x) => x.fr)).toEqual(["STE-1"]);
  }, T);

  test("fr resolves against specs/frs/archive/ stems too", () => {
    const root = makeCheckout("fr-archive", TOKENS_ON, FR_FILES);
    runHook(skillPayload(root, "dev-process-toolkit:spec-review", "STE-2"));
    expect(ledgerRows(root).map((x) => x.fr)).toEqual(["STE-2"]);
  }, T);

  test("fr is null when no argument token names an FR file", () => {
    const root = makeCheckout("fr-null", TOKENS_ON, FR_FILES);
    runHook(skillPayload(root, "dev-process-toolkit:implement", "STE-9 M_abc"));
    expect(ledgerRows(root).map((x) => x.fr)).toEqual([null]);
  }, T);

  test("fr is null with no arguments", () => {
    const root = makeCheckout("fr-noargs", TOKENS_ON, FR_FILES);
    runHook(skillPayload(root, "dev-process-toolkit:gate-check", ""));
    expect(ledgerRows(root).map((x) => x.fr)).toEqual([null]);
  }, T);

  test("a hook run from a subdirectory writes under the checkout root", () => {
    const root = makeCheckout("hook-sub", TOKENS_ON, FR_FILES);
    const sub = join(root, "pkg", "inner");
    mkdirSync(sub, { recursive: true });
    const p = skillPayload(root, "dev-process-toolkit:tdd", "STE-1");
    p.cwd = sub;
    const r = runHook(p, { cwd: sub });
    expect(r.exitCode).toBe(0);
    expect(ledgerRows(root).map((x) => x.fr)).toEqual(["STE-1"]);
    expect(existsSync(join(sub, LEDGER_REL))).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-810.5 — the any-switch gate
// ===========================================================================

describe("AC-STE-810.5 the any-switch gate", () => {
  // STE-810 review (Pass 2): the built-ins fast path must not skip a flow-style
  // tracking section the real parser reads as on — a silent miss is a lost row.
  test("a flow-style child or a multi-line flow section with a switch on records", () => {
    for (const [label, body] of [
      ["gate-flow-child", "tracking:\n  token_stats: {enabled: true}\n"],
      ["gate-flow-multi", "tracking: {\n  token_stats: {enabled: true}}\n"],
    ] as const) {
      const root = makeCheckout(label, `${SETTINGS_HEAD}${body}`);
      const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
      expect({ label, code: r.exitCode, wrote: existsSync(ledgerFile(root)) }).toEqual({ label, code: 0, wrote: true });
    }
  }, T);

  test("a flow-style tracking section with a switch on records", () => {
    const root = makeCheckout("gate-flow", `${SETTINGS_HEAD}tracking: {token_stats: {enabled: true}}\n`);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(true);
  }, T);

  test("token_stats off and gate_outcomes on records", () => {
    const root = makeCheckout("gate-go", GATE_ONLY);
    runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(ledgerRows(root).length).toBe(1);
  }, T);

  test("only tool_calls on records", () => {
    const root = makeCheckout("gate-tc", `${SETTINGS_HEAD}tracking:\n  tool_calls:\n    enabled: true\n`);
    runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(ledgerRows(root).length).toBe(1);
  }, T);

  test("only review_findings on (a tracking switch that is not proposable) records", () => {
    const root = makeCheckout("gate-rf", `${SETTINGS_HEAD}tracking:\n  review_findings:\n    enabled: true\n`);
    runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(ledgerRows(root).length).toBe(1);
  }, T);

  test("every tracking switch off records nothing", () => {
    const root = makeCheckout("gate-off", ALL_OFF);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(existsSync(join(root, ".dpt"))).toBe(false);
  }, T);

  test("`enabled: true` outside tracking (close_out, retro) with every tracking switch off records nothing", () => {
    const root = makeCheckout(
      "gate-other-true",
      `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\nclose_out:\n  upgrade_offer:\n    enabled: true\nretro:\n  enabled: true\n`,
    );
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a tree with no tracking key records nothing", () => {
    const root = makeCheckout("gate-absent", SETTINGS_HEAD);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a checkout with no toolkit settings home records nothing", () => {
    const root = makeCheckout("gate-nohome", null);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("a cwd outside any checkout records nothing and exits 0", () => {
    const root = makeRoot("gate-nogit", TOKENS_ON);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  // --- the all-off tree loads no toolkit module ---------------------------
  //
  // A temp plugin copy in which every .ts module under adapters/ and
  // templates/hooks/_lib/ — except the hook entrypoint itself and the
  // built-ins-only session helper (templates/hooks/_lib/session.ts, which the
  // STE-717 precedent loads statically) — appends `loaded <rel>` to $MARKER
  // when it loads. The all-off run must leave $MARKER empty; the switch-on run
  // is the control that proves the markers fire.

  const MARKER_ENV = "STE810_LOAD_MARKER";

  function markerCopy(label: string): string {
    const copy = pluginCopy(label);
    const skip = new Set([ENTRY_REL, "templates/hooks/_lib/session.ts"]);
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== "node_modules" && ent.name !== "__tests__") walk(p);
          continue;
        }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts") || p.endsWith(".d.ts")) continue;
        const rel = p.slice(copy.length + 1);
        if (skip.has(rel)) continue;
        const src = readFileSync(p, "utf-8");
        const marker = `import { appendFileSync as __m810 } from "node:fs";\nif (process.env.${MARKER_ENV}) __m810(process.env.${MARKER_ENV}, "loaded ${rel}\\n");\n`;
        if (src.startsWith("#!")) {
          const nl = src.indexOf("\n");
          writeFileSync(p, src.slice(0, nl + 1) + marker + src.slice(nl + 1));
        } else {
          writeFileSync(p, marker + src);
        }
      }
    };
    walk(join(copy, "adapters"));
    walk(join(copy, "templates", "hooks", "_lib"));
    return copy;
  }

  function loaded(marker: string): string[] {
    return existsSync(marker) ? readFileSync(marker, "utf-8").split("\n").filter((l) => l !== "") : [];
  }

  test("an all-off tree's hook run loads no module beyond Node built-ins", () => {
    const copy = markerCopy("ste810-marker-off");
    const root = makeCheckout("marker-off", ALL_OFF);
    const marker = join(tempDir("ste810-marker-off-log"), "marker.log");
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""), { pluginRoot: copy, env: { [MARKER_ENV]: marker } });
    expect(r.exitCode).toBe(0);
    expect(loaded(marker)).toEqual([]);
  }, T);

  test("control: a switch-on tree's hook run through the same copy loads run_start.ts and records", () => {
    const copy = markerCopy("ste810-marker-on");
    const root = makeCheckout("marker-on", TOKENS_ON);
    const marker = join(tempDir("ste810-marker-on-log"), "marker.log");
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""), { pluginRoot: copy, env: { [MARKER_ENV]: marker } });
    expect(r.exitCode).toBe(0);
    expect(loaded(marker)).toContain(`loaded ${MODULE_REL}`);
    expect(ledgerRows(root).length).toBe(1);
  }, T);
});

// ===========================================================================
// AC-STE-810.6 — fail-open
// ===========================================================================

describe("AC-STE-810.6 fail-open", () => {
  test("an unreadable settings file: exit 0, empty stdout, nothing written", () => {
    const root = makeCheckout("fail-unreadable", TOKENS_ON);
    const settings = join(root, "specs", "settings.yaml");
    chmodSync(settings, 0o000);
    try {
      const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
      expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
      expect(existsSync(ledgerFile(root))).toBe(false);
    } finally {
      chmodSync(settings, 0o644);
    }
  }, T);

  test("a settings file that is not valid YAML but holds `enabled: true`: exit 0, empty stdout, nothing written", () => {
    const root = makeCheckout("fail-yaml", `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  : [unclosed\n`);
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("an unwritable ledger directory: exit 0, empty stdout", () => {
    const root = makeCheckout("fail-unwritable", TOKENS_ON);
    mkdirSync(join(root, ".dpt"), { recursive: true });
    writeFileSync(join(root, ".dpt", "ledger"), "a file where the ledger directory should be\n");
    const r = runHook(skillPayload(root, "dev-process-toolkit:implement", ""));
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    expect(readFileSync(join(root, ".dpt", "ledger"), "utf-8")).toBe("a file where the ledger directory should be\n");
  }, T);

  test("unparseable stdin: exit 0, empty stdout", () => {
    const r = runHook("{not json");
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
  }, T);

  test("empty stdin: exit 0, empty stdout", () => {
    const r = runHook("");
    expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
  }, T);

  // STE-810 review (audit advisory): a row with no session cannot join to any run, so the
  // hook writes none — the same answer the CLI gives an unset session id (AC-STE-810.7).
  test("a payload with no session id: exit 0, empty stdout, nothing written", () => {
    const root = makeCheckout("fail-no-session", TOKENS_ON);
    for (const sid of ["", undefined]) {
      const p = skillPayload(root, "dev-process-toolkit:implement", "");
      if (sid === undefined) delete p.session_id;
      else p.session_id = sid;
      const r = runHook(p);
      expect({ code: r.exitCode, out: r.stdout }).toEqual({ code: 0, out: "" });
    }
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-810.7 — the CLI
// ===========================================================================

describe("AC-STE-810.7 the CLI", () => {
  test("records a start for CLAUDE_CODE_SESSION_ID and prints settings_hash=<hex> equal to the row's hash", () => {
    const root = makeRoot("cli-on", TOKENS_ON, FR_FILES);
    const r = runCli([root, "dev-process-toolkit:tdd", "STE-1"], { session: SID2 });
    expect(r.exitCode).toBe(0);
    const rows = ledgerRows(root);
    expect(rows.map((x) => [x.session_id, x.skill, x.fr])).toEqual([[SID2, "dev-process-toolkit:tdd", "STE-1"]]);
    expect(r.stdout.trim()).toBe(`settings_hash=${rows[0]!.settings_hash}`);
    expect(r.stdout.trim()).toMatch(/^settings_hash=[0-9a-f]{64}$/);
  }, T);

  test("with no fr argument the row's fr is null", () => {
    const root = makeRoot("cli-nofr", TOKENS_ON);
    const r = runCli([root, "dev-process-toolkit:implement"]);
    expect(r.exitCode).toBe(0);
    expect(ledgerRows(root).map((x) => x.fr)).toEqual([null]);
  }, T);

  test("every switch off: prints `skipped: no tracking switch is on` and writes nothing", () => {
    const root = makeRoot("cli-off", ALL_OFF);
    const r = runCli([root, "dev-process-toolkit:implement"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("skipped: no tracking switch is on");
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("no session id: refuses in the NFR-10 shape, prints nothing on stdout, writes nothing", () => {
    const root = makeRoot("cli-nosid", TOKENS_ON);
    const r = runCli([root, "dev-process-toolkit:implement"], { session: null });
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);

  test("an empty session id refuses the same way", () => {
    const root = makeRoot("cli-emptysid", TOKENS_ON);
    const r = runCli([root, "dev-process-toolkit:implement"], { session: "" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Remedy:");
    expect(existsSync(ledgerFile(root))).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-810.8 — docs/retro-reference.md
// ===========================================================================

describe("AC-STE-810.8 docs/retro-reference.md describes the run-start ledger", () => {
  const doc = (): string => readFileSync(join(PLUGIN_ROOT, "docs", "retro-reference.md"), "utf-8");

  test("names the ledger file and its schema", () => {
    const d = doc();
    expect(d).toContain("run-starts.jsonl");
    expect(d).toContain("dpt-run-start/1");
  });

  test("lists every row key", () => {
    const d = doc();
    expect(ROW_KEYS.filter((k) => !d.includes(`\`${k}\``))).toEqual([]);
  });

  test("states the any-switch gate", () => {
    expect(doc()).toMatch(/any `?tracking\.<name>\.enabled`?[^.\n]*true|at least one `?tracking\.<name>\.enabled`?/i);
  });

  test("states the proposable-keys-only privacy rule", () => {
    const d = doc();
    expect(d).toContain("PROPOSABLE_SETTINGS");
    expect(d).toMatch(/no other (settings )?key/i);
  });
});

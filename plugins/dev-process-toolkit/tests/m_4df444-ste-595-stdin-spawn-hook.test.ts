// M_4df444 / STE-595 — the repository hook that refuses a spawn script fed to a
// shell through stdin (AC.1–AC.4).
//
// HOW THE HOOK IS FOUND. Never by a hand-typed path. `tests/_stdin_spawn_hook.ts`
// reads the tracked `.claude/settings.json`, resolves every `PreToolUse` command
// hook with matcher `Bash` to its shim and to the entry the shim `exec`s, and
// picks the one whose entry imports `stdin_spawn_detector`. It runs that
// REGISTERED command exactly as the harness would: a shell command with the
// JSON payload on stdin. AC.1–AC.3 therefore test the wiring AC.4 registers,
// not a file the settings might not point at.
//
// NFR-10 SHAPE asserted on a refusal (byte-stable, via `emitNFR10` in
// templates/hooks/_lib/session.ts):
//   Refusing: <why — names stdin>
//   Remedy: <how — the run-from-a-file remedy: write it to a file, `bash <file>`>
//   Context: mode=hook, ticket=unbound, skill=<skill>, hook=<shim basename>
//
// FIXTURES were copied byte-for-byte (`cp`) from the kept transcript
// 9c766729-40f9-4ba4-bd66-b81d37993123.jsonl, which is never edited:
//   golden-phase-a-2026-09-11.sh — toolu_01CzF5NNpdHTcG5sLeMtiK6T, 2026-09-10T20:41:53.854Z
//   control-preflight-1.sh       — toolu_01EoMyE1C21C9CDLnS9EU1rx, 20:41:00.567Z
//   control-preflight-2.sh       — toolu_019HNgUr7M9cep6e6b6QnDMK, 20:41:24.412Z
// Byte sizes run two over the transcript's character counts: an em dash.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { runConformanceLoopBypassRemovedProbe } from "../adapters/_shared/src/conformance_loop_bypass_removed";
import { runSetupPermissionsShapeProbe } from "../adapters/_shared/src/setup_permissions_shape";
import { runSpawnPatternAllowlistProbe, SPAWN_PATTERN } from "../adapters/_shared/src/spawn_pattern_allowlist";
import { countSites, label, phaseAFence, parseFences, pluginRoot, readDoc, repoRoot } from "./_spawn_fences";
import {
  bashPayload,
  bashPreToolUseCommands,
  nfr10Lines,
  readSettings,
  registeredStdinSpawnHook,
  requireHook,
  runHookOn,
  runHookRaw,
  SETTINGS_PATH,
  type HookRun,
} from "./_stdin_spawn_hook";

// ===========================================================================
// Fixtures and measured constants.
// ===========================================================================

const FIXTURE_DIR = join(pluginRoot, "tests", "fixtures", "stdin-spawn");
const FIXTURES = {
  golden: {
    file: "golden-phase-a-2026-09-11.sh",
    bytes: 2969,
    sha256: "8238ae514366fab7fbb016593d80e5e1c9bad1c9754323e975cf863aded1a983",
  },
  preflight1: {
    file: "control-preflight-1.sh",
    bytes: 725,
    sha256: "4c57cc20ece614d55f92ebf2a977fa1e35c15ebc4ebf164e041a3c1dab6c6c42",
  },
  preflight2: {
    file: "control-preflight-2.sh",
    bytes: 537,
    sha256: "14e59fa0524fe5b1f68dee31b025bc1d3bcbc1c6792aea93874f52044e5064aa",
  },
} as const;

const fx = (k: keyof typeof FIXTURES): string => readFileSync(join(FIXTURE_DIR, FIXTURES[k].file), "utf-8");
const GOLDEN = fx("golden");
const PREFLIGHT_1 = fx("preflight1");
const PREFLIGHT_2 = fx("preflight2");

/** The file-run command the fences now use, in the prefix rule shape `Bash(<cmd>:*)`. */
const FILE_RUN_GRANT = "Bash(bash:*)";
const HOOKS_JSON = join(pluginRoot, "hooks", "hooks.json");
const SMOKE_SKILL = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let goldenRun: HookRun | undefined;
async function golden(): Promise<HookRun> {
  goldenRun ??= await runHookOn(GOLDEN);
  return goldenRun;
}

function expectRefusal(run: HookRun, what: string): void {
  expect(run.exitCode, `${what}: exit 2 blocks the tool call. stderr:\n${run.stderr}`).toBe(2);
  expect(nfr10Lines(run.stderr)[0] ?? "", `${what}: stderr:\n${run.stderr}`).toMatch(/^Refusing: /);
}

function expectPass(run: HookRun, what: string): void {
  expect(run.exitCode, `${what}: exit 0 lets the tool call run. stderr:\n${run.stderr}`).toBe(0);
  expect(run.stderr, `${what}: no refusal`).not.toMatch(/^Refusing: /m);
}

// ===========================================================================
// AC-STE-595.1
// ===========================================================================

describe("AC-STE-595.1 — the 2026-09-11 Phase A command is refused with exit 2 and NFR-10 lines", () => {
  test("PROVENANCE: the three fixtures are the transcript bytes, unedited", () => {
    for (const k of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
      const buf = readFileSync(join(FIXTURE_DIR, FIXTURES[k].file));
      expect(buf.length, `${FIXTURES[k].file} byte length`).toBe(FIXTURES[k].bytes);
      expect(createHash("sha256").update(buf).digest("hex"), `${FIXTURES[k].file} sha256`).toBe(FIXTURES[k].sha256);
    }
  });

  test("PROVENANCE: the golden is a `bash <<'OUTER'` call with three backgrounded brace groups, each holding a claude -p prompt heredoc", () => {
    const lines = GOLDEN.split("\n");
    expect(lines[0]).toBe("bash <<'OUTER'");
    expect(lines[lines.length - 1]).toBe("OUTER");
    expect(GOLDEN.match(/^\} <\/dev\/null >\/dev\/null 2>&1 &$/gm)?.length).toBe(3);
    expect(GOLDEN.match(/^\s*claude -p /gm)?.length).toBe(3);
    expect(GOLDEN.match(/<<'PROMPT_EOF'$/gm)?.length).toBe(3);
  });

  test("the registered hook exits 2 on the golden payload", async () => {
    expectRefusal(await golden(), "golden");
  }, 20_000);

  test("stderr carries exactly the three NFR-10 lines, in order, with the byte-stable Context line", async () => {
    const hook = requireHook();
    const lines = nfr10Lines((await golden()).stderr);
    expect(lines.length, `NFR-10 lines: ${JSON.stringify(lines)}`).toBe(3);
    expect(lines[0]).toMatch(/^Refusing: \S/);
    expect(lines[1]).toMatch(/^Remedy: \S/);
    expect(lines[2]).toMatch(
      new RegExp(`^Context: mode=hook, ticket=unbound, skill=[A-Za-z0-9:_-]+, hook=${escapeRe(hook.name)}$`),
    );
  }, 20_000);

  test("the Remedy names the run-from-a-file remedy: write it to a file, run `bash <file>`", async () => {
    const remedy = nfr10Lines((await golden()).stderr)[1] ?? "";
    expect(remedy).toMatch(/^Remedy: /);
    expect(remedy).toMatch(/\bfile\b/i);
    expect(remedy).toMatch(/\bbash <(?:file|path|script)>/);
  }, 20_000);

  test("the Refusing line says the script would be read from stdin", async () => {
    const why = nfr10Lines((await golden()).stderr)[0] ?? "";
    expect(why).toMatch(/^Refusing: /);
    expect(why).toMatch(/\bstdin\b|standard input/i);
  }, 20_000);

  test("CONTROL: the two pre-flight `bash <<'EOF'` calls from the same transcript pass", async () => {
    expectPass(await runHookOn(PREFLIGHT_1), "pre-flight 1");
    expectPass(await runHookOn(PREFLIGHT_2), "pre-flight 2");
  }, 20_000);
});

// ===========================================================================
// AC-STE-595.2 — end to end through the registered hook.
// ===========================================================================

const AC2_REFUSED: [string, string][] = [
  ["bash <<EOF", "bash <<EOF\nsleep 30 &\nEOF"],
  ["bash <<'EOF'", "bash <<'EOF'\nsleep 30 &\nEOF"],
  ["bash <<-EOF", "bash <<-EOF\n\tsleep 30 &\n\tEOF"],
  ["sh -s <<EOF", "sh -s <<EOF\nsleep 30 &\nEOF"],
  ["zsh <<EOF", "zsh <<EOF\nsleep 30 &\nEOF"],
  ["… | bash with a backgrounding body", "printf '%s\\n' 'sleep 30 &' | bash"],
  ["… | sh with a backgrounding body", "printf '%s\\n' 'sleep 30 &' | sh"],
  ["bash < fence.sh", "bash < fence.sh"],
  ["cat fence.sh | bash", "cat fence.sh | bash"],
  ['bash <<< "cmd &"', 'bash <<< "sleep 30 &"'],
];

const AC2_ALLOWED: [string, string][] = [
  [
    "claude -p … <<'PROMPT_EOF' … & (the sanctioned spawn)",
    "claude -p \\\n  --output-format stream-json --verbose \\\n  > /tmp/dpt-smoke-ste595-setup.log 2>&1 <<'PROMPT_EOF' &\n<dpt:auto-approve>v1</dpt:auto-approve>\n/dev-process-toolkit:setup\nPROMPT_EOF\necho $! > /tmp/dpt-smoke-ste595-setup.pid",
  ],
  ["bash /path/fence.sh", "bash /tmp/ste595/fence.sh"],
  ["bash -c 'a && b'", "bash -c 'true && echo ok'"],
  ["pre-flight 1 (heredoc into bash, no backgrounding)", PREFLIGHT_1],
  ["pre-flight 2 (heredoc into bash, no backgrounding)", PREFLIGHT_2],
  ["cmd1 && cmd2", "true && echo ok"],
];

describe("AC-STE-595.2 — the AC's shapes, through the registered hook", () => {
  for (const [name, command] of AC2_REFUSED) {
    test(`refused (exit 2): ${name}`, async () => expectRefusal(await runHookOn(command), name), 20_000);
  }
  for (const [name, command] of AC2_ALLOWED) {
    test(`allowed (exit 0): ${name}`, async () => expectPass(await runHookOn(command), name), 20_000);
  }
});

describe("AC-STE-595.2 — every documented backgrounded spawn fence: stdin-fed ⇒ refused, direct ⇒ allowed (derived)", () => {
  const sites = countSites();

  test("CONTROL: the derived set is non-empty and holds /conformance-loop Phase A", () => {
    const a = phaseAFence(parseFences("conformance-loop", readDoc("conformance-loop")));
    expect(a, "Phase A found by shape").toBeDefined();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.some((s) => s.doc === a!.doc && s.openLine === a!.openLine)).toBe(true);
  });

  for (const site of sites) {
    test(`${label(site)} wrapped in bash <<'OUTER' is refused`, async () => {
      expectRefusal(await runHookOn(`bash <<'OUTER'\n${site.body}\nOUTER`), label(site));
    }, 20_000);
    test(`${label(site)} as a direct command is allowed`, async () => {
      expectPass(await runHookOn(site.body), label(site));
    }, 20_000);
  }
});

// ===========================================================================
// AC-STE-595.3
// ===========================================================================

describe("AC-STE-595.3 — fail-open on empty or unparseable stdin", () => {
  const cases: [string, string][] = [
    ["empty stdin", ""],
    ["whitespace-only stdin", "  \n\t\n"],
    ["a raw command, not JSON", "bash <<EOF\nsleep 30 &\nEOF"],
    ["truncated JSON", '{"tool_input": {"command": "bash <<EOF'],
    ["a JSON array", "[]"],
  ];
  for (const [name, stdin] of cases) {
    test(`${name} ⇒ exit 0, no refusal`, async () => expectPass(await runHookRaw(stdin), name), 20_000);
  }

  test("a payload with no tool_input.command ⇒ exit 0", async () => {
    const stdin = JSON.stringify({ transcript_path: "/nonexistent", hook_event_name: "PreToolUse", tool_name: "Bash" });
    expectPass(await runHookRaw(stdin), "no tool_input");
  }, 20_000);

  test("a payload whose command is not a string ⇒ exit 0", async () => {
    expectPass(await runHookRaw(bashPayload(42)), "numeric command");
  }, 20_000);
});

describe("AC-STE-595.3 — the hook reads nothing beyond its stdin payload", () => {
  test("the refusal is byte-identical whatever the transcript, the cwd or HOME", async () => {
    const base = await golden();
    expectRefusal(base, "baseline");
    const tmp = mkdtempSync(join(tmpdir(), "ste595-hook-"));
    try {
      const transcript = join(tmp, "transcript.jsonl");
      writeFileSync(transcript, '{"not":"a skill tool_use"}\ngarbage\n');
      const withTranscript = await runHookRaw(bashPayload(GOLDEN, { transcript_path: transcript }));
      const elsewhere = await runHookRaw(bashPayload(GOLDEN, { cwd: tmp }), { cwd: tmp, env: { HOME: tmp } });
      for (const [what, run] of [["a real transcript", withTranscript], ["another cwd and HOME", elsewhere]] as const) {
        expect(run.exitCode, what).toBe(2);
        expect(run.stderr, `${what}: the stderr bytes`).toBe(base.stderr);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  test("STATIC: the entry reads stdin and nothing else — no file, transcript, network or process read", () => {
    const src = readFileSync(requireHook().entry, "utf-8");
    expect(src, "the entry reads its payload from stdin").toMatch(
      /\bBun\.stdin\.text\(\)|readFileSync\(\s*(?:0|["']\/dev\/stdin["'])/,
    );
    const body = src.replace(/^\s*import\b[^;]*;?\s*$/gm, "");
    expect(body).not.toMatch(
      /\breadFileSync\b(?!\(\s*(?:0|["']\/dev\/stdin["'])\s*[,)])|\breadFile\b|\bexistsSync\b|\bstatSync\b|\bopenSync\b|\bBun\.file\b|\bfetch\s*\(|\bfindSkillToolUse\b|\brequireSkillToolUse\b|\bBun\.spawn|\bchild_process\b|\bexecSync\b/,
    );
  });

  test("STATIC: the entry reuses parseHookPayload and emitNFR10 from the shared hook library", () => {
    const { entry } = requireHook();
    const src = readFileSync(entry, "utf-8");
    const session = join(pluginRoot, "templates", "hooks", "_lib", "session.ts");
    const names = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
      .filter((m) => {
        const p = resolve(dirname(entry), m[2]!);
        return p === session || `${p}.ts` === session;
      })
      .flatMap((m) => m[1]!.split(",").map((s) => s.trim().replace(/^type\s+/, "")));
    expect(names).toContain("parseHookPayload");
    expect(names).toContain("emitNFR10");
  });
});

// ===========================================================================
// AC-STE-595.4
// ===========================================================================

function scaffoldHeredocBody(): string {
  const lines = readFileSync(SMOKE_SKILL, "utf-8").split("\n");
  const open = lines.findIndex((l) => /\bcat\s*>\s*\.claude\/settings\.json\s*<<\s*'?EOF'?/.test(l));
  expect(open, "the /smoke-test settings-writing scaffold heredoc exists").toBeGreaterThan(-1);
  const body: string[] = [];
  for (let j = open + 1; j < lines.length && lines[j]!.trim() !== "EOF"; j++) body.push(lines[j]!);
  return body.join("\n");
}

function trackedAllow(): string[] {
  const perms = (readSettings().permissions ?? {}) as Record<string, unknown>;
  return Array.isArray(perms.allow) ? (perms.allow as string[]) : [];
}

describe("AC-STE-595.4 — registered repo-level, probes green, the file-run command granted", () => {
  test("the tracked settings register a PreToolUse command hook with matcher `Bash` that runs the stdin-spawn entry", () => {
    expect(bashPreToolUseCommands().length, `${SETTINGS_PATH} has no hooks.PreToolUse matcher-Bash command`).toBeGreaterThan(0);
    expect(registeredStdinSpawnHook(), "no registered command resolves to an entry importing stdin_spawn_detector").not.toBeNull();
  });

  test("the registration is a two-line shim that execs a bun entry", () => {
    const { shim } = requireHook();
    const lines = readFileSync(shim, "utf-8").split("\n").filter((l) => l.trim() !== "");
    expect(lines.length, `shim lines: ${JSON.stringify(lines)}`).toBe(2);
    expect(lines[0]).toBe("#!/usr/bin/env bash");
    expect(lines[1]).toMatch(/^exec bun run "[^"]*\.ts"$/);
  });

  test("the shim is executable when the registered command invokes it directly", () => {
    const { command, shim } = requireHook();
    if (/^\s*(?:bash|sh)\s/.test(command)) return; // the command names the interpreter itself
    expect(statSync(shim).mode & 0o100, `${shim} lacks the user exec bit`).not.toBe(0);
  });

  test("REGRESSION: the plugin's hooks/hooks.json is byte-unchanged against main and never names the hook", () => {
    const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: pluginRoot });
    expect(git(["rev-parse", "--verify", "--quiet", "main"]).exitCode, "control: main resolves").toBe(0);
    const onMain = git(["show", "main:plugins/dev-process-toolkit/hooks/hooks.json"]);
    expect(onMain.exitCode, "control: hooks.json exists on main").toBe(0);
    expect(Buffer.compare(Buffer.from(onMain.stdout), readFileSync(HOOKS_JSON)), "hooks.json differs from main").toBe(0);
    expect(readFileSync(HOOKS_JSON, "utf-8")).not.toMatch(/stdin[_-]?spawn/i);
  });

  test("REGRESSION: the settings still parse and keep the child-spawn grant", () => {
    expect(trackedAllow()).toContain(SPAWN_PATTERN);
  });

  test("REGRESSION: spawn_pattern_allowlist reports zero violations", async () => {
    const r = await runSpawnPatternAllowlistProbe(repoRoot);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });

  test("REGRESSION: setup_permissions_shape reports zero violations", async () => {
    const r = await runSetupPermissionsShapeProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });

  test("REGRESSION: conformance_loop_bypass_removed reports zero violations", async () => {
    const r = await runConformanceLoopBypassRemovedProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });

  test(`the tracked allow-list grants the file-run command: ${FILE_RUN_GRANT}`, () => {
    expect(trackedAllow()).toContain(FILE_RUN_GRANT);
  });

  test(`the /smoke-test scaffold heredoc grants it too (CONTROL: the same body carries ${SPAWN_PATTERN})`, () => {
    const body = scaffoldHeredocBody();
    expect(body, "control: this is the allow-list body").toContain(SPAWN_PATTERN);
    expect(body).toContain(FILE_RUN_GRANT);
  });

  test("neither surface grants it in the inert glob shape `Bash(bash *)`", () => {
    expect(trackedAllow()).not.toContain("Bash(bash *)");
    expect(scaffoldHeredocBody()).not.toContain("Bash(bash *)");
  });
});

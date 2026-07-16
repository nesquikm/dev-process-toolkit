// STE-344 AC-STE-344.4 — capture hook, idempotent per session.
//
// A bundled hook (templates/hooks/process/session-token-ledger.sh, a thin
// `bun run` shim over a TS module, wired into hooks/hooks.json on SessionEnd
// with Stop as an equivalent trigger) parses `transcript_path` from the stdin
// hook JSON (STE-290 contract, via parseHookPayload) and writes the session's
// rows to the ledger, REPLACING any existing rows whose session_id matches
// (re-fire never appends duplicates). Fail-open: any parse/IO error exits 0
// with no write and no stderr gate.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ledgerPath } from "../adapters/_shared/src/token_usage";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const WRAPPER_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "process",
  "session-token-ledger.sh",
);
const HOOKS_JSON_PATH = join(PLUGIN_ROOT, "hooks", "hooks.json");

const SESSION_ID = "hook-session-1";
// M104 STE-382 AC-STE-382.4 — the ledger moved into the consolidated `.dpt/`
// tree. Rather than re-pin a literal (which is exactly what went stale on the
// move), every ledger location below derives from the production helper —
// `token_usage.ledgerPath`, which composes via `dpt_paths`, the sole composer
// of `.dpt` path literals (AC-STE-382.1). A future relocation cannot leave
// this fixture behind.

// M102 STE-379 — the capture hook now gates on the project's `## Token Stats`
// enabled flag (read via readTokenStatsConfig). Write-path fixtures declare
// `enabled: true` so they keep exercising the write path once the gate lands
// (spec-mandated fixture update under AC-STE-379.1); the new gate tests pass
// DISABLED / MALFORMED / absent.
const TOKEN_STATS_ENABLED = "# fixture project\n\n## Token Stats\n\nenabled: true\n";
const TOKEN_STATS_DISABLED = "# fixture project\n\n## Token Stats\n\nenabled: false\n";
// `TRUE` is out of the lowercase literal {true,false} set ⇒ readTokenStatsConfig
// throws MalformedTokenStatsConfigError; the fail-off gate treats it as OFF.
const TOKEN_STATS_MALFORMED = "# fixture project\n\n## Token Stats\n\nenabled: TRUE\n";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the TS module the wrapper shim executes. The wrapper contract
 * (matching the existing process/*.sh shims) is a `bun run` against a
 * `${CLAUDE_PLUGIN_ROOT}`-anchored .ts path; we substitute the plugin root
 * so tests can invoke the module directly without the harness.
 */
function resolveModulePath(): string | null {
  if (!existsSync(WRAPPER_PATH)) {
    return null;
  }
  const body = readFileSync(WRAPPER_PATH, "utf-8");
  const m = body.match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]+\.ts)/);
  if (!m) {
    return null;
  }
  const resolved = join(PLUGIN_ROOT, m[1]!);
  return existsSync(resolved) ? resolved : null;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHookModule(
  stdinPayload: string,
  cwd: string,
): Promise<RunResult> {
  const modulePath = resolveModulePath();
  // Fail loudly (RED) rather than crashing the suite when the hook is absent.
  expect(modulePath).not.toBeNull();
  const proc = Bun.spawn(["bun", "run", modulePath!], {
    cwd,
    stdin: new Response(stdinPayload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

type LedgerRow = {
  schema: string;
  session_id: string;
  skill: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  message_count: number;
};

function readLedger(projectRoot: string): LedgerRow[] {
  const path = ledgerPath(projectRoot);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as LedgerRow);
}

function usageLine(
  skill: string | null,
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  },
): string {
  const line: Record<string, unknown> = {
    type: "assistant",
    timestamp: "2026-07-06T12:00:00.000Z",
    sessionId: SESSION_ID,
    gitBranch: "main",
    message: { role: "assistant", model, usage },
  };
  if (skill !== null) {
    line.attributionSkill = skill;
    line.attributionPlugin = "dev-process-toolkit";
  }
  return JSON.stringify(line);
}

let projectRoot: string;
let scratch: string;
// M102 STE-379 — per-test project dirs the gate tests spin up with a specific
// `## Token Stats` config; cleaned up alongside projectRoot/scratch.
let extraDirs: string[] = [];

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ste-344-hook-proj-"));
  scratch = mkdtempSync(join(tmpdir(), "ste-344-hook-scratch-"));
  extraDirs = [];
  // M102 STE-379: the write-path tests below run with cwd=projectRoot; declare
  // `enabled: true` so they still exercise the write path once AC-379.1's gate
  // lands (absent a `## Token Stats` section, the project parses as OFF).
  writeFileSync(join(projectRoot, "CLAUDE.md"), TOKEN_STATS_ENABLED);
});

afterEach(() => {
  for (const dir of [projectRoot, scratch, ...extraDirs]) {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * M102 STE-379 — spin up a throwaway project dir seeded with a specific
 * `## Token Stats` config (or none when `claudeMd === null`) for the gate tests.
 */
function makeGateProject(claudeMd: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "ste-379-hook-proj-"));
  extraDirs.push(dir);
  if (claudeMd !== null) {
    writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  }
  return dir;
}

function payloadFor(transcriptPath: string, cwd: string): string {
  return JSON.stringify({
    session_id: SESSION_ID,
    transcript_path: transcriptPath,
    cwd,
    hook_event_name: "SessionEnd",
  });
}

/** Transcript: 2 implement-skill lines + 1 main-loop line ⇒ 2 buckets. */
function writeTranscript(): string {
  const file = join(scratch, "transcript.jsonl");
  writeFileSync(
    file,
    [
      usageLine("dev-process-toolkit:implement", "claude-fable-5", {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40,
      }),
      usageLine("dev-process-toolkit:implement", "claude-fable-5", {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
      usageLine(null, "claude-fable-5", {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 8,
      }),
    ].join("\n") + "\n",
  );
  return file;
}

function validPayload(transcriptPath: string): string {
  return JSON.stringify({
    session_id: SESSION_ID,
    transcript_path: transcriptPath,
    cwd: projectRoot,
    hook_event_name: "SessionEnd",
  });
}

// ---------------------------------------------------------------------------
// wrapper + wiring shape
// ---------------------------------------------------------------------------

describe("AC-STE-344.4 — wrapper shim exists and matches the process/*.sh shape", () => {
  test("templates/hooks/process/session-token-ledger.sh exists", () => {
    expect(existsSync(WRAPPER_PATH)).toBe(true);
  });

  test("wrapper is a thin `bun run` shim over a ${CLAUDE_PLUGIN_ROOT}-anchored session-token-ledger TS module", () => {
    const body = readFileSync(WRAPPER_PATH, "utf-8");
    const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
    expect(trimmed.split("\n").length).toBeLessThanOrEqual(3);
    expect(body).toContain("bun run");
    expect(body).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(body).toContain("session-token-ledger");
  });

  test("the wrapper's TS module resolves to an existing file", () => {
    expect(resolveModulePath()).not.toBeNull();
  });
});

describe("AC-STE-344.4 — hooks.json wires the hook on SessionEnd with Stop as equivalent trigger", () => {
  type HooksJson = {
    hooks?: Record<
      string,
      Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>
    >;
  };

  function commandsFor(event: string): string[] {
    const parsed = JSON.parse(
      readFileSync(HOOKS_JSON_PATH, "utf-8"),
    ) as HooksJson;
    const groups = parsed.hooks?.[event] ?? [];
    return groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ""));
  }

  test("SessionEnd carries a ${CLAUDE_PLUGIN_ROOT}-anchored session-token-ledger.sh entry", () => {
    const cmds = commandsFor("SessionEnd").filter((c) =>
      c.includes("session-token-ledger.sh"),
    );
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(cmds[0]).toContain("templates/hooks/process/session-token-ledger.sh");
  });

  test("Stop carries the same session-token-ledger.sh entry", () => {
    const cmds = commandsFor("Stop").filter((c) =>
      c.includes("session-token-ledger.sh"),
    );
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
  });
});

// ---------------------------------------------------------------------------
// end-to-end module behavior
// ---------------------------------------------------------------------------

describe("AC-STE-344.4 — hook writes the session's aggregated rows to the ledger", () => {
  test("valid payload → exit 0 + one ledger row per (skill, model) bucket with summed fields", async () => {
    const transcript = writeTranscript();
    const r = await runHookModule(validPayload(transcript), projectRoot);
    expect(r.exitCode).toBe(0);

    const rows = readLedger(projectRoot);
    expect(rows.length).toBe(2);

    const impl = rows.find(
      (row) => row.skill === "dev-process-toolkit:implement",
    );
    expect(impl).toBeDefined();
    expect(impl!.model).toBe("claude-fable-5");
    expect(impl!.input_tokens).toBe(11);
    expect(impl!.output_tokens).toBe(22);
    expect(impl!.cache_read_input_tokens).toBe(33);
    expect(impl!.cache_creation_input_tokens).toBe(44);
    expect(impl!.message_count).toBe(2);

    const main = rows.find((row) => row.skill === "(main-loop)");
    expect(main).toBeDefined();
    expect(main!.input_tokens).toBe(5);
    expect(main!.message_count).toBe(1);
  });

  test("every written row carries schema token-ledger/v1 and the payload's session_id", async () => {
    const transcript = writeTranscript();
    await runHookModule(validPayload(transcript), projectRoot);
    const rows = readLedger(projectRoot);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.schema).toBe("token-ledger/v1");
      expect(row.session_id).toBe(SESSION_ID);
    }
  });
});

describe("AC-STE-344.4 — re-fire is idempotent per session_id (replace, never duplicate)", () => {
  test("firing the hook twice leaves exactly the same row count (no appended duplicates)", async () => {
    const transcript = writeTranscript();
    const r1 = await runHookModule(validPayload(transcript), projectRoot);
    expect(r1.exitCode).toBe(0);
    const afterFirst = readLedger(projectRoot);
    expect(afterFirst.length).toBe(2);

    const r2 = await runHookModule(validPayload(transcript), projectRoot);
    expect(r2.exitCode).toBe(0);
    const afterSecond = readLedger(projectRoot);
    expect(afterSecond.length).toBe(2);
    expect(
      afterSecond.filter((row) => row.session_id === SESSION_ID).length,
    ).toBe(2);
  });

  test("stale rows for the same session_id are replaced; other sessions' rows survive", async () => {
    const transcript = writeTranscript();

    // Pre-seed the ledger: one stale row for THIS session (bogus numbers that
    // a correct re-derive must wipe) + one foreign-session row that must be
    // preserved byte-for-byte in field terms.
    const ledgerFile = ledgerPath(projectRoot);
    const staleRow = {
      schema: "token-ledger/v1",
      ts: "2026-07-01T00:00:00Z",
      session_id: SESSION_ID,
      git_branch: "main",
      skill: "dev-process-toolkit:implement",
      model: "claude-fable-5",
      input_tokens: 999999,
      output_tokens: 999999,
      cache_read_input_tokens: 999999,
      cache_creation_input_tokens: 999999,
      message_count: 999,
    };
    const foreignRow = {
      ...staleRow,
      session_id: "some-other-session",
      skill: "dev-process-toolkit:brainstorm",
      input_tokens: 42,
    };
    // `dpt_paths` is pure path composition (no I/O by design), so the fixture
    // owns the mkdir — derived from the ledger path rather than re-named.
    mkdirSync(dirname(ledgerFile), { recursive: true });
    writeFileSync(
      ledgerFile,
      JSON.stringify(staleRow) + "\n" + JSON.stringify(foreignRow) + "\n",
    );

    const r = await runHookModule(validPayload(transcript), projectRoot);
    expect(r.exitCode).toBe(0);

    const rows = readLedger(projectRoot);
    // 2 fresh rows for SESSION_ID + 1 preserved foreign row.
    expect(rows.length).toBe(3);
    // The bogus stale aggregate is gone…
    expect(rows.some((row) => row.input_tokens === 999999)).toBe(false);
    // …replaced by the re-derived aggregate.
    const impl = rows.find(
      (row) =>
        row.session_id === SESSION_ID &&
        row.skill === "dev-process-toolkit:implement",
    );
    expect(impl).toBeDefined();
    expect(impl!.input_tokens).toBe(11);
    // Foreign session untouched.
    const foreign = rows.find(
      (row) => row.session_id === "some-other-session",
    );
    expect(foreign).toBeDefined();
    expect(foreign!.skill).toBe("dev-process-toolkit:brainstorm");
    expect(foreign!.input_tokens).toBe(42);
  });
});

describe("AC-STE-344.4 — fail-open: parse/IO errors exit 0 with no write and no stderr gate", () => {
  test("malformed stdin JSON → exit 0, no ledger created, no Refusing block", async () => {
    const r = await runHookModule("{definitely-not-json", projectRoot);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
    expect(existsSync(ledgerPath(projectRoot))).toBe(false);
  });

  test("empty stdin → exit 0, no ledger created", async () => {
    const r = await runHookModule("", projectRoot);
    expect(r.exitCode).toBe(0);
    expect(existsSync(ledgerPath(projectRoot))).toBe(false);
  });

  test("payload pointing at a missing transcript → exit 0", async () => {
    const payload = validPayload(join(scratch, "nope.jsonl"));
    const r = await runHookModule(payload, projectRoot);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-379.1 — capture-hook gate: honor the `## Token Stats` enabled flag
// ---------------------------------------------------------------------------

describe("AC-STE-379.1 — capture hook gates on readTokenStatsConfig().enabled (fully off)", () => {
  test("enabled: false ⇒ writes NOTHING to the ledger and exits 0", async () => {
    const dir = makeGateProject(TOKEN_STATS_DISABLED);
    const transcript = writeTranscript();
    const r = await runHookModule(payloadFor(transcript, dir), dir);
    expect(r.exitCode).toBe(0);
    // The transcript carries real usage rows, so absent the gate the hook
    // WOULD write — the gate is what makes the ledger stay absent.
    expect(readLedger(dir)).toEqual([]);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });

  test("enabled: true ⇒ rows written exactly as today", async () => {
    const dir = makeGateProject(TOKEN_STATS_ENABLED);
    const transcript = writeTranscript();
    const r = await runHookModule(payloadFor(transcript, dir), dir);
    expect(r.exitCode).toBe(0);
    // Same two (skill, model) buckets the unconditional-capture path produces.
    expect(readLedger(dir).length).toBe(2);
  });

  test("malformed CLAUDE.md (`enabled: TRUE`) ⇒ fail-off: no write, exit 0", async () => {
    const dir = makeGateProject(TOKEN_STATS_MALFORMED);
    const transcript = writeTranscript();
    const r = await runHookModule(payloadFor(transcript, dir), dir);
    // MalformedTokenStatsConfigError is swallowed by the fail-open catch and
    // treated as OFF — the error never gates session-end.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");
    expect(readLedger(dir)).toEqual([]);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });

  test("absent CLAUDE.md ⇒ default-off: no write, exit 0", async () => {
    const dir = makeGateProject(null);
    const transcript = writeTranscript();
    const r = await runHookModule(payloadFor(transcript, dir), dir);
    expect(r.exitCode).toBe(0);
    expect(readLedger(dir)).toEqual([]);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });
});

// M_4df444 / STE-594 — /implement Phase 3: the Termination cleanup fence under zsh.
//
// The spawn fences run as `bash <file>` (STE-595), but the Termination fence is
// not a spawn fence: a driver may run it inline in its own shell, which is zsh
// on this machine. zsh does not field-split an unquoted parameter, and the
// first cut relied on that in three places (the STE-594 audit, 2026-09-15):
//   * `for SEL in ${SELECTED_LEGS}` ran once with every leg in one word, so the
//     artifact read was `dpt-smoke-verdict-linear jira.json` (missing) and no leg
//     was cleaned;
//   * `for SID in ${SIDS}` and the unquoted `${SESSION_FLAGS}` on the delete gave
//     the cleanup ONE argument (" --session a --session b"), which its strict
//     parser refuses, so the leg was kept under the wrong reason.
// Nothing was ever deleted wrongly; a passed leg was simply never cleaned.
//
// Each case runs the real fence under zsh and, as the control, under bash, and
// the bash run must already pass: the test pins shell-independence, not a new
// behaviour. A local `bun` stub records every cleanup argv element on its own
// line, so "one word" and "separate words" can be told apart; every other bun
// call runs the real module from this plugin's source.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { smokeRunLedgerPath } from "../adapters/_shared/src/dpt_paths";
import { appendRunLedgerRow } from "../adapters/_shared/src/smoke_run_ledger";
import { baseEnv, makeSandbox, rebase, reap, terminationCleanupFence, today, unique, type Sandbox } from "./_ste594_harness";
import { pluginRoot } from "./_spawn_fences";

const SRC_DIR = join(pluginRoot, "adapters", "_shared", "src");
const REAL_BUN = process.execPath;
const ZSH = "/bin/zsh";

const sandboxes: Sandbox[] = [];
afterEach(() => {
  for (const sb of sandboxes.splice(0)) reap(sb);
});

/** Replace the harness's bun stub with one that records each cleanup argv element on its own line. */
function argvRecordingBun(sb: Sandbox): string {
  const argvFile = join(sb.root, "cleanup-argv.txt");
  const stub = `#!/bin/bash
[ "\${1:-}" = run ] && shift
MOD="\${1:-}"; [ $# -gt 0 ] && shift
BASE="\${MOD##*/}"
if [ "$BASE" = smoke_session_cleanup.ts ]; then
  { echo "--- call"; for A in "$@"; do printf '[%s]\\n' "$A"; done; } >> '${argvFile}'
  echo "smoke-session-cleanup: zsh-test stub, nothing deleted"
  exit 0
fi
exec '${REAL_BUN}' '${SRC_DIR}'/"$BASE" "$@"
`;
  writeFileSync(join(sb.bin, "bun"), stub, { mode: 0o755 });
  return argvFile;
}

interface Calls {
  /** One entry per cleanup invocation: its argv elements, exactly as received. */
  calls: string[][];
  out: string;
}

function readArgv(file: string): string[][] {
  if (!existsSync(file)) return [];
  const calls: string[][] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line === "--- call") calls.push([]);
    else if (line.startsWith("[") && line.endsWith("]")) calls[calls.length - 1]?.push(line.slice(1, -1));
  }
  return calls;
}

/** Plant a run: its run-id file, one ledger row per session, a `pass` artifact per leg; then run the fence. */
function runTermination(shell: string, legs: Record<string, string[]>): Calls {
  const fence = terminationCleanupFence();
  if (fence === undefined) throw new Error("the Termination cleanup fence was not found");
  const sb = makeSandbox("delegate");
  sandboxes.push(sb);
  const argvFile = argvRecordingBun(sb);
  const date = today();
  const iter = unique("zsh");
  const runId = randomUUID();

  const runFile = join(sb.tmp, `dpt-conformance-loop-${date}.run`);
  writeFileSync(runFile, `${runId}\n`);
  const past = Date.now() / 1000 - 60;
  utimesSync(runFile, past, past); // the run started a minute ago, so today's artifacts are fresh
  const ledger = smokeRunLedgerPath(sb.work, runId);
  for (const [leg, sids] of Object.entries(legs)) {
    for (const sid of sids) appendRunLedgerRow(ledger, { run: runId, leg, session_id: sid });
    writeFileSync(join(sb.tmp, `dpt-smoke-verdict-${leg}.json`), `${JSON.stringify({ outcome: "pass" })}\n`);
  }

  const body = rebase(fence.body.replace(/^ITER=<N>$/m, `ITER=${iter}`), sb);
  const script = [
    `DATE=${date}`,
    `ITER=${iter}`,
    `SELECTED_LEGS="${Object.keys(legs).join(" ")}"`,
    body,
  ].join("\n");
  const file = join(sb.root, `termination-${shell.replace(/\W/g, "")}.sh`);
  writeFileSync(file, script);
  const env = baseEnv(sb);
  const which = Bun.spawnSync([shell, "-c", "command -v bun"], { env, cwd: sb.work }).stdout.toString().trim();
  expect(which, "SAFETY: the recording bun stub must shadow the real bun").toBe(join(sb.bin, "bun"));
  const r = Bun.spawnSync([shell, file], { env, cwd: sb.work, timeout: 60_000 });
  return { calls: readArgv(argvFile), out: `${r.stdout.toString()}\n${r.stderr.toString()}` };
}

/** Does one cleanup call carry exactly these session ids, each as its own `--session <sid>` argument pair, plus --delete? */
function deletesExactly(call: string[], sids: readonly string[]): boolean {
  if (!call.includes("--delete")) return false;
  const pairs: string[] = [];
  for (let i = 0; i < call.length; i++) if (call[i] === "--session") pairs.push(call[i + 1] ?? "");
  return [...pairs].sort().join(",") === [...sids].sort().join(",");
}

describe("AC-STE-594.4 / AC-STE-594.7 — Phase 3: the Termination fence cleans passed legs under zsh as under bash", () => {
  for (const shell of ["/bin/bash", ZSH]) {
    const name = shell.endsWith("zsh") ? "zsh" : "bash (control)";

    test(`${name}: two selected legs, both pass — one delete per leg, each naming only that leg's sessions`, () => {
      const legs = { linear: [randomUUID()], jira: [randomUUID()] };
      const r = runTermination(shell, legs);
      const deletes = r.calls.filter((c) => c.includes("--delete"));
      expect(deletes.length, `one delete per passed leg\n${r.out}`).toBe(2);
      for (const sids of Object.values(legs)) {
        expect(deletes.some((c) => deletesExactly(c, sids)), `a delete naming exactly ${sids.join(",")}\n${r.out}`).toBe(true);
      }
    });

    test(`${name}: one selected leg with two sessions — each --session is its own argument`, () => {
      const legs = { none: [randomUUID(), randomUUID()] };
      const r = runTermination(shell, legs);
      const deletes = r.calls.filter((c) => c.includes("--delete"));
      expect(deletes.length, `one delete\n${r.out}`).toBe(1);
      expect(deletesExactly(deletes[0]!, legs.none), `argv: ${JSON.stringify(deletes[0])}\n${r.out}`).toBe(true);
      expect(deletes[0]!.some((a) => /^\s/.test(a) || /\s--session\s/.test(a)), "no argument carries several flags in one word").toBe(false);
    });
  }
});

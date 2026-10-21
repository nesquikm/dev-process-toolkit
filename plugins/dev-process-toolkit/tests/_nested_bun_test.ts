// Shared runner for every test that starts a nested `bun test` (STE-685).
//
// A nested `bun test` that never exits would hang the outer gate forever, so
// every such spawn goes through `runNestedBunTest`: it bounds the child with a
// `timeout` (default 300000 ms, overridable per call) and kills it with
// SIGKILL, which a child cannot ignore. The result reports the exit code, both
// output streams, and whether the child was killed for outliving its timeout.
//
// This module imports only `node:` builtins, so a copy of it can be loaded from
// any directory.

import { spawnSync } from "node:child_process";

export const NESTED_BUN_TEST_DEFAULT_TIMEOUT_MS = 300_000;
export const NESTED_BUN_TEST_DEPTH_ENV = "DPT_NESTED_BUN_TEST_DEPTH";
export const NESTED_BUN_TEST_DEPTH_CEILING = 3;

export interface NestedBunTestOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface NestedBunTestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run `bun test <args...>` bounded by a timeout, SIGKILLing a child that outlives it. */
export function runNestedBunTest(args: string[], opts: NestedBunTestOptions = {}): NestedBunTestResult {
  const raw = process.env[NESTED_BUN_TEST_DEPTH_ENV];
  const depth = raw === undefined || raw === "" ? 0 : Number(raw);
  if (!(depth < NESTED_BUN_TEST_DEPTH_CEILING)) {
    const why = `runNestedBunTest refused: nested bun test depth ${raw} is at or past the ceiling of ${NESTED_BUN_TEST_DEPTH_CEILING}`;
    throw new Error(why);
  }
  const timeoutMs = opts.timeoutMs ?? NESTED_BUN_TEST_DEFAULT_TIMEOUT_MS;
  const proc = spawnSync(process.execPath, ["test", ...args], {
    cwd: opts.cwd,
    env: { ...(opts.env ?? process.env), [NESTED_BUN_TEST_DEPTH_ENV]: String(depth + 1) },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const errorCode = (proc.error as NodeJS.ErrnoException | undefined)?.code;
  const timedOut = errorCode === "ETIMEDOUT";
  return {
    exitCode: proc.status ?? (proc.signal !== null ? 128 : 1),
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    timedOut,
  };
}

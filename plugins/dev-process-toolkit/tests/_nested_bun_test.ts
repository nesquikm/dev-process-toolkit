// Shared runner for every test that starts a nested `bun test` (STE-685).
//
// A nested `bun test` that never exits would hang the outer gate forever, so
// every such spawn goes through `runNestedBunTest`: it bounds the child with a
// `timeout` (default 300000 ms, overridable per call) and kills it with
// SIGKILL, which a child cannot ignore. The result reports the exit code, both
// output streams, and whether the child was killed for outliving its timeout.
//
// A child killed by a signal has no exit code. It reads as 128 (never 0), and
// `signal` and `note` say which signal and that the child did not exit on its
// own (STE-872), so a crash under load is not mistaken for a test verdict.
//
// This module imports only `node:` builtins, so a copy of it can be loaded from
// any directory. That is why it cannot import `tests/_child_result.ts`: its
// note follows that helper's wording instead.

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
  /** The signal that ended the child, or null. */
  signal: string | null;
  /** Empty for a child that exited on its own; otherwise what happened. */
  note: string;
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
  const signal = proc.signal ?? null;
  const cmd = `bun test ${args.join(" ")}`;
  let note = "";
  if (timedOut) {
    note = `[the child \`${cmd}\` timed out: it was killed${signal ? ` by ${signal}` : ""} when its ${timeoutMs} ms timeout ran out — a timeout, not a module verdict]`;
  } else if (proc.status === null) {
    const how = signal === null ? "with no exit code and no signal" : `by ${signal}`;
    note = `[the child \`${cmd}\` was killed ${how}; it did not exit on its own — this is a HARNESS or machine-load failure, not a module verdict]`;
  }
  return {
    exitCode: proc.status ?? (signal !== null ? 128 : 1),
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    timedOut,
    signal,
    note,
  };
}

// STE-872 — read a FINISHED child result and say how it ended.
//
// Accepts the three shapes the test runners produce:
//   - a Bun spawnSync result:        { exitCode, signalCode, exitedDueToTimeout }
//   - a node:child_process sync one: { status, signal, error?.code === "ETIMEDOUT" }
//   - a node async `close` pair:     { code, signal }
//
// A child that exited on its own keeps its exit code and an empty note. A child
// killed by a signal reads as code -1 (never 0) with a note naming the signal,
// the command and that it did not exit on its own; a child killed by its own
// timeout is named as a timeout instead. This module only reads: it starts no
// process and never retries, so a failure can never turn into a pass here.

export interface ChildResult {
  /** The child's own exit code, or -1 when it did not exit on its own. */
  code: number;
  /** The signal that ended the child, or null. */
  signal: string | null;
  /** True when the child was killed because its own timeout ran out. */
  timedOut: boolean;
  /** Empty for a child that exited on its own; otherwise what happened. */
  note: string;
}

type Loose = Record<string, unknown>;

function pickCode(r: Loose): number | null {
  for (const k of ["exitCode", "status", "code"]) {
    const v = r[k];
    if (typeof v === "number") return v;
  }
  return null;
}

function pickSignal(r: Loose): string | null {
  for (const k of ["signalCode", "signal"]) {
    const v = r[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickTimedOut(r: Loose): boolean {
  if (r.exitedDueToTimeout === true) return true;
  const err = r.error as { code?: unknown } | undefined;
  return !!err && typeof err === "object" && err.code === "ETIMEDOUT";
}

export function childResult(
  result: unknown,
  command: string[] | string,
  opts: { timeoutMs?: number } = {},
): ChildResult {
  const r = (result ?? {}) as Loose;
  const cmd = Array.isArray(command) ? command.join(" ") : command;
  const exit = pickCode(r);
  const signal = pickSignal(r);
  const timedOut = pickTimedOut(r);

  if (timedOut) {
    const limit = opts.timeoutMs === undefined ? "its timeout" : `its ${opts.timeoutMs} ms timeout`;
    return {
      code: exit === null || exit === 0 ? -1 : exit,
      signal,
      timedOut: true,
      note: `[the child \`${cmd}\` timed out: it was killed${signal ? ` by ${signal}` : ""} when ${limit} ran out — a timeout, not a module verdict]`,
    };
  }
  if (exit !== null && signal === null) {
    return { code: exit, signal: null, timedOut: false, note: "" };
  }
  const how = signal === null ? "with no exit code and no signal" : `by ${signal}`;
  return {
    code: -1,
    signal,
    timedOut: false,
    note: `[the child \`${cmd}\` was killed ${how}; it did not exit on its own — this is a HARNESS or machine-load failure, not a module verdict]`,
  };
}

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
// timeout is named as a timeout instead. A child that never started (a node
// result whose error.code is ENOENT, EACCES or the like) is named as a start
// failure, and one whose output passed maxBuffer (ENOBUFS) is named as that,
// even when it then exited on its own, since its output was cut; both still
// read as -1. This module only reads: it starts no
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

function pickError(r: Loose): { code: string; message: string } | null {
  const err = r.error as { code?: unknown; message?: unknown } | undefined;
  if (!err || typeof err !== "object" || typeof err.code !== "string") return null;
  return { code: err.code, message: typeof err.message === "string" ? err.message : "" };
}

function pickTimedOut(r: Loose): boolean {
  if (r.exitedDueToTimeout === true) return true;
  return pickError(r)?.code === "ETIMEDOUT";
}

/** Add a child's note to its stderr, on a line of its own. An empty note adds nothing. */
export function withNote(stderr: string, note: string): string {
  if (note === "") return stderr;
  return stderr === "" || stderr.endsWith("\n") ? `${stderr}${note}\n` : `${stderr}\n${note}\n`;
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
  const error = pickError(r);
  // ENOBUFS is named whatever the exit: a child that ignores the kill and exits
  // on its own still had its output cut, so its exit code is no clean pass.
  if (error !== null && error.code === "ENOBUFS") {
    const how =
      exit === null
        ? `so it was killed${signal ? ` by ${signal}` : ""}`
        : `so its output was cut; it then exited with code ${exit}, but on cut output`;
    return {
      code: -1,
      signal,
      timedOut: false,
      note: `[the child \`${cmd}\` wrote more output than maxBuffer allows, ${how} (ENOBUFS) — a buffer limit, not a module verdict]`,
    };
  }
  if (exit === null && error !== null && signal === null) {
    const why = error.message === "" ? "" : `: ${error.message}`;
    return {
      code: -1,
      signal: null,
      timedOut: false,
      note: `[the child \`${cmd}\` failed to start (${error.code})${why} — it never ran, so this is not a module verdict]`,
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

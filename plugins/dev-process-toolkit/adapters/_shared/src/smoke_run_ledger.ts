// smoke_run_ledger — STE-594: the per-run ledger of every `claude -p` session
// the `/conformance-loop` and `/smoke-test` drivers spawn.
//
// Each spawn fence mints a session id, appends one row here, and only then
// starts the child with `--session-id <that id>`. Recording precedes spawning,
// so a fence that loops still records every launch it makes, and a run's
// cleanup can later be scoped to exactly the sessions the run owned.
//
// One row is one JSON line holding exactly {run, leg, session_id, parent,
// spawned_at}, written in ONE O_APPEND write so rows from concurrent legs never
// tear or interleave. The shells never compose JSON: they call the CLI below.
// The ledger's path is composed by `smokeRunLedgerPath` in ./dpt_paths, the
// only module allowed to spell the toolkit's directory (AC-STE-382.1).
//
// CLI:  bun smoke_run_ledger.ts append --run <id> --leg <leg> --session <uuid>
//                                      [--parent <uuid>] [--project-root <dir>]
//         Writes one row and exits 0. A refused row exits 1 and writes nothing.
//       bun smoke_run_ledger.ts sessions --run <id> --leg <leg> [--project-root <dir>]
//         Prints that run's leg's session ids, one per line, and exits 0 (no
//         rows prints nothing).
// Both resolve the file as smokeRunLedgerPath(<--project-root, default cwd>,
// <run>). A malformed invocation exits 2.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { smokeRunLedgerPath } from "./dpt_paths";

export interface RunLedgerRow {
  run: string;
  leg: string;
  session_id: string;
  /** The session that spawned this one (a grandchild names its child), or null. */
  parent: string | null;
  /** ISO-8601, the moment the row was written — just before the spawn. */
  spawned_at: string;
}

export interface RunLedgerInput {
  run: string;
  leg: string;
  session_id: string;
  parent?: string | null;
}

/** macOS `uuidgen` prints upper case, so both cases are accepted and stored verbatim. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A bare token: it becomes part of a file name, so it may never carry a slash or a dot-dot. */
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function refuse(reason: string): never {
  throw new Error(`smoke-run-ledger: refused — ${reason}`);
}

/** Append one row. Throws, writing nothing, on an id that is not a UUID or a run/leg that is not a bare token. */
export function appendRunLedgerRow(file: string, input: RunLedgerInput): RunLedgerRow {
  if (!TOKEN_RE.test(input.run)) refuse(`run ${JSON.stringify(input.run)} is not a bare [A-Za-z0-9_-] token`);
  if (!TOKEN_RE.test(input.leg)) refuse(`leg ${JSON.stringify(input.leg)} is not a bare [A-Za-z0-9_-] token`);
  if (!UUID_RE.test(input.session_id)) refuse(`session id ${JSON.stringify(input.session_id)} is not a UUID`);
  const parent = input.parent ?? null;
  if (parent !== null && !UUID_RE.test(parent)) refuse(`parent ${JSON.stringify(parent)} is not a UUID`);

  const row: RunLedgerRow = {
    run: input.run,
    leg: input.leg,
    session_id: input.session_id,
    parent,
    spawned_at: new Date().toISOString(),
  };
  const line = Buffer.from(`${JSON.stringify(row)}\n`, "utf-8");
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "a");
  try {
    const written = writeSync(fd, line);
    if (written !== line.length) refuse(`short write (${written} of ${line.length} bytes) to ${file}`);
  } finally {
    closeSync(fd);
  }
  return row;
}

function asRow(value: unknown): RunLedgerRow | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.run !== "string" || typeof v.leg !== "string") return null;
  if (typeof v.session_id !== "string" || v.session_id === "") return null;
  return {
    run: v.run,
    leg: v.leg,
    session_id: v.session_id,
    parent: typeof v.parent === "string" ? v.parent : null,
    spawned_at: typeof v.spawned_at === "string" ? v.spawned_at : "",
  };
}

/** Every well-formed row. A missing file gives []; malformed, torn and id-less lines are skipped. */
export function readRunLedger(file: string): RunLedgerRow[] {
  if (!existsSync(file)) return [];
  const rows: RunLedgerRow[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const row = asRow(parsed);
    if (row !== null) rows.push(row);
  }
  return rows;
}

/** One run's one leg: its children and grandchildren, deduplicated, in ledger order. */
export function legSessionIds(rows: readonly RunLedgerRow[], run: string, leg: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.run !== run || r.leg !== leg || seen.has(r.session_id)) continue;
    seen.add(r.session_id);
    out.push(r.session_id);
  }
  return out;
}

// --- CLI ---------------------------------------------------------------------

const APPEND_FLAGS = new Set(["run", "leg", "session", "parent", "project-root"]);
const SESSIONS_FLAGS = new Set(["run", "leg", "project-root"]);

function usage(problem: string): never {
  console.error(`smoke-run-ledger: ${problem}`);
  console.error(
    "usage: bun smoke_run_ledger.ts append --run <id> --leg <leg> --session <uuid> [--parent <uuid>] [--project-root <dir>]\n" +
      "       bun smoke_run_ledger.ts sessions --run <id> --leg <leg> [--project-root <dir>]",
  );
  process.exit(2);
}

function parseFlags(argv: readonly string[], allowed: ReadonlySet<string>): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (m === null || !allowed.has(m[1]!)) usage(`unknown argument ${JSON.stringify(arg)}`);
    let value = m[2];
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined) usage(`--${m[1]} needs a value`);
      i++;
    }
    flags.set(m[1]!, value);
  }
  return flags;
}

function requireFlags(flags: ReadonlyMap<string, string>, names: readonly string[]): void {
  for (const name of names) {
    if (!flags.has(name)) usage(`--${name} is required`);
  }
}

/** The run's ledger file, under `--project-root` or, by default, the current directory. */
function ledgerFile(flags: ReadonlyMap<string, string>, run: string): string {
  return smokeRunLedgerPath(flags.get("project-root") ?? process.cwd(), run);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "sessions") {
    // One run's one leg, one session id per line (children and grandchildren,
    // deduplicated, in ledger order). No rows prints nothing and still exits 0.
    const flags = parseFlags(rest, SESSIONS_FLAGS);
    requireFlags(flags, ["run", "leg"]);
    const run = flags.get("run")!;
    const leg = flags.get("leg")!;
    // The run names a FILE, so it is checked before any path is composed, exactly
    // as `append` checks it: an unchecked `../` run would read a .jsonl outside
    // the ledger directory.
    if (!TOKEN_RE.test(run)) usage(`--run ${JSON.stringify(run)} is not a bare [A-Za-z0-9_-] token`);
    if (!TOKEN_RE.test(leg)) usage(`--leg ${JSON.stringify(leg)} is not a bare [A-Za-z0-9_-] token`);
    for (const sid of legSessionIds(readRunLedger(ledgerFile(flags, run)), run, leg)) console.log(sid);
    process.exit(0);
  }
  if (command !== "append") usage(`unknown command ${JSON.stringify(command ?? "")}`);
  const flags = parseFlags(rest, APPEND_FLAGS);
  requireFlags(flags, ["run", "leg", "session"]);
  const run = flags.get("run")!;
  const parent = flags.get("parent");
  try {
    appendRunLedgerRow(ledgerFile(flags, run), {
      run,
      leg: flags.get("leg")!,
      session_id: flags.get("session")!,
      parent: parent === undefined || parent === "" ? null : parent,
    });
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

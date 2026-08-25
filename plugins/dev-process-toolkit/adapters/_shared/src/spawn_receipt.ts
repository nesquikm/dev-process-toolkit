// spawn_receipt — M133 STE-516: a stage cannot report a spawn it did not
// perform.
//
// THE DEFECT. `/deliver` renders a chain whose steps each name their own
// placement (`resume_classifier.ts` → `(inline)` / `(worker)`), and NOTHING
// anywhere checked that a step marked `(worker)` ever reached a worker. On the
// run that prompted this FR every ceremony step ran in the orchestrating
// session, the hand-off fence graded clean, and the discrepancy was invisible:
// `verifyDeliverStageCapture` grades `stage`, `milestone`, `status` and the
// three evidence sections, and graded `summary` NOT AT ALL.
//
// THE TWO HALVES, which must not be conflated:
//
//   * THE EMISSION SIDE — `renderSpawnReceipt`. Resolves the handle through the
//     spawning tool's ownership check (agent-toolkit's `spawn-agent
//     lib/owned.py`) via an INJECTED runner, and returns the one receipt line
//     ONLY on exit 0 with a resolved handle. Every other outcome throws a
//     NAMED halt.
//   * THE GRADING SIDE — `parseSpawnReceipt` plus `chainRequiresSpawnReceipt`,
//     which `deliver_stage_capture.ts` consults so a capture whose chain
//     carried a step that ran outside this session is graded for the receipt.
//
// WHERE THE RECEIPT LIVES, and why. It is an INDENTED list item under
// `summary:`, never a ninth section. `topLevelKeys` in
// `deliver_stage_capture.ts` matches `/^([A-Za-z_][A-Za-z0-9_]*):/` — anchored
// at column 0 — so an indented item is invisible to section detection and the
// fixed eight-section order this repo repaired one milestone ago is not
// reopened. It costs exactly one fence line against `FENCE_LINE_CAP`.
//
// NO SPAWN MECHANICS HERE. The ledger path and the worker row name arrive from
// what the spawning tool REPORTED; this module derives neither. Re-deriving a
// ledger path would be re-implementing a host-dependent contract that belongs
// to `agent-toolkit:spawn-agent`, and would drift from it the first time that
// tool moved its own state.
//
// FAIL-CLOSED, CODE BY CODE. A single catch-all halt would satisfy "every
// non-zero outcome halts" while erasing the remedies an operator actually
// needs, and `feedback_fix_the_quiet_half` is explicit that a silent skip is
// worse than a loud failure. So each outcome carries its OWN refusal text
// under the house NFR-10 envelope (`deliver_decision.ts` idiom).
//
// Pure by construction — every EXPORT below touches no filesystem, no network
// and no child process, because the ownership check is injected, which is what
// makes every branch testable without a live agent-toolkit install. The one
// import below is `import type`, erased at compile time, so that guarantee
// survives it. The `import.meta.main` command-line guard at the foot of this
// file is the one place a child process is run, and it never runs under
// `import` — see its own header.

import type { StepPlacement } from "./resume_classifier";

/**
 * The receipt's fixed prefix.
 *
 * Exported because the prefix IS the contract: `skills/deliver/SKILL.md` and
 * `docs/deliver-reference.md` both state it for the worker's benefit, and the
 * surface-parity check reads it from here rather than from a second literal
 * that could drift (the M131 sibling-surface shape).
 */
export const SPAWN_RECEIPT_PREFIX = "- spawn:";

/**
 * The fields, in THE fixed order they appear left to right.
 *
 * Fixed, not merely conventional: a reader (human or grader) that has to
 * discover field order per line cannot tell a receipt from a receipt-shaped
 * sentence. `parseSpawnReceipt` builds its recognizer from this list, so a
 * transposed line is not a receipt at all.
 */
export const SPAWN_RECEIPT_FIELDS = ["handle", "ledger", "owned"] as const;

export type SpawnReceiptField = (typeof SPAWN_RECEIPT_FIELDS)[number];

/** The indentation that keeps the receipt a `summary` item, not a section. */
const RECEIPT_INDENT = "  ";

/**
 * Per-field value grammar. `handle` and `ledger` are opaque tokens minted
 * elsewhere — no shape is imposed on them here, because imposing one would be
 * this module deriving what the spawning tool reported. `owned` is the
 * ownership check's exit code, so it is digits.
 *
 * `\S+` is what makes an EMPTY field a non-receipt: `handle=` followed by a
 * space matches nothing, and the field is the entire point of the line.
 */
const FIELD_VALUE: Readonly<Record<SpawnReceiptField, string>> = {
  handle: "(\\S+)",
  ledger: "(\\S+)",
  owned: "(\\d+)",
};

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The recognizer, BUILT from the two exported constants rather than retyped.
 * A prefix or field-order change therefore moves the parser with it, and the
 * pinned constants stay the one source of truth for both halves.
 */
const RECEIPT_RE = new RegExp(
  `^[ \\t]*${escapeLiteral(SPAWN_RECEIPT_PREFIX)}` +
    SPAWN_RECEIPT_FIELDS.map(
      (field) => `[ \\t]+${escapeLiteral(field)}=${FIELD_VALUE[field]}`,
    ).join("") +
    `[ \\t]*$`,
);

// ---------------------------------------------------------------------------
// Shapes.
// ---------------------------------------------------------------------------

/**
 * The placement vocabulary, RE-EXPORTED from the module that MINTS placements
 * rather than respelled here.
 *
 * This is HYGIENE, not a guard, and the distinction matters because an earlier
 * pass claimed otherwise. A type cannot close a fail-open hole: types are
 * erased, so what a chain carries at runtime is whatever the caller put there,
 * and only `chainRequiresSpawnReceipt` below decides whether it owes evidence.
 * What the re-export buys is one spelling of the vocabulary instead of two
 * that can drift apart in review.
 *
 * `import type` is load-bearing, not stylistic: it is erased at compile time,
 * so this module keeps its no-filesystem guarantee even though
 * `resume_classifier` reaches for `node:fs/promises`. Do not convert it to a
 * value import.
 */
export type { StepPlacement };

/** A chain step, as `resume_classifier` renders it. */
export interface ChainStep {
  readonly placement: StepPlacement;
}

/**
 * What the SPAWNING TOOL reported. None of it is derived here.
 *
 * `host` is the terminal host the tool spawned into — `null` when the tool is
 * installed but no host exists to spawn into.
 */
export interface SpawnedWorker {
  readonly handle: string;
  readonly ledger: string;
  readonly name: string;
  readonly host: string | null;
}

/** The ownership check's outcome. `handle` is present only on a clean resolve. */
export interface OwnedCheckResult {
  readonly code: number;
  readonly handle?: string;
}

/** What the ownership check is asked — the tool's own bytes, verbatim. */
export interface OwnedCheckQuery {
  readonly ledger: string;
  readonly name: string;
}

export type OwnedCheckRunner = (query: OwnedCheckQuery) => OwnedCheckResult;

export interface SpawnReceipt {
  /** The one summary item, indented, no newline. */
  readonly line: string;
  /** The handle the ownership check RESOLVED — never a composed one. */
  readonly handle: string;
  readonly ledger: string;
}

export interface ParsedSpawnReceipt {
  readonly handle: string;
  readonly ledger: string;
  readonly owned: number;
}

// ---------------------------------------------------------------------------
// The named halts.
// ---------------------------------------------------------------------------

/**
 * Every halt this module can raise, named. Exported so a caller can branch on
 * the reason rather than grepping the refusal prose.
 */
export const SPAWN_RECEIPT_HALTS = [
  "no-terminal-host",
  "no-ledger-row",
  "no-ownership-sidecar",
  "ownership-unresolved",
  "handle-composed",
  "handle-unresolved",
] as const;

export type SpawnReceiptHalt = (typeof SPAWN_RECEIPT_HALTS)[number];

/**
 * The house NFR-10 envelope: what is refused, what to do about it, and the
 * machine-readable context naming the halt. Three prefixes, in this order.
 */
function halt(reason: SpawnReceiptHalt, refusing: string, remedy: string): never {
  throw new Error(
    [
      `Refusing: ${refusing}`,
      `Remedy: ${remedy}`,
      `Context: reason=${reason}`,
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// The emission side.
// ---------------------------------------------------------------------------

/**
 * Render the one receipt line for a worker the spawning tool reported.
 *
 * The order of the guards below is load-bearing. The host check runs FIRST and
 * the ownership runner is not consulted at all when there is no host: if the
 * host case merely rode the exit-2 path, a stale ledger row would let a
 * hostless run emit a receipt for a worker that does not exist — precisely the
 * fail-open shape this FR closes.
 *
 * Exit 0 PERMITS emission; it does not guarantee it. A clean exit that
 * resolved no handle, or one that resolved a handle other than the reported
 * one, is a halt: the receipt names what the CHECK resolved, so there is
 * nothing to name when the check named nothing.
 */
export function renderSpawnReceipt(input: {
  spawned: SpawnedWorker;
  owned: OwnedCheckRunner;
}): SpawnReceipt {
  const { spawned, owned } = input;

  if (spawned.host === null || spawned.host.trim() === "") {
    halt(
      "no-terminal-host",
      `the spawning tool is installed but reported no terminal host for worker "${spawned.name}", so nothing was spawned`,
      "open a terminal host (a cmux surface or a herdr pane) and re-run the stage, or run the chain inline and mark the step (inline)",
    );
  }

  let result: OwnedCheckResult;
  try {
    result = owned({ ledger: spawned.ledger, name: spawned.name });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    halt(
      "ownership-unresolved",
      `the ownership check for worker "${spawned.name}" could not be run: ${detail}`,
      "repair the agent-toolkit:spawn-agent install so its ownership check runs, then re-run the stage",
    );
  }

  if (result.code !== 0) {
    if (result.code === 2) {
      halt(
        "no-ledger-row",
        `the spawn ledger has no row for worker "${spawned.name}"`,
        `add or repair the row for that worker in the spawn ledger at ${spawned.ledger}, then re-run the stage`,
      );
    }
    if (result.code === 5) {
      halt(
        "no-ownership-sidecar",
        `worker "${spawned.name}" has a ledger row but no ownership sidecar`,
        "restore the missing .owner sidecar for that worker, then re-run the stage",
      );
    }
    // Exits 3 and 4 are documented by `agent-toolkit lib/owned.py` as HARD
    // STOPS that must never be retried. Their machine reason stays
    // `ownership-unresolved` and their exit code stays quoted — the two are
    // sub-cases of the generic family, not new families — but the
    // operator-facing halves are their own: the refusal names WHICH hard stop
    // it is, and the remedy states the never-retry contract instead of the
    // generic "then re-run the stage" tail, which for these codes would advise
    // the one thing the contract forbids.
    if (result.code === 3) {
      halt(
        "ownership-unresolved",
        `a live session holds the name "${spawned.name}" but it is not ours (exit code 3)`,
        "this is a documented hard stop — never retry it; spawn under a name no other live session holds, or hand the stage to the session that already owns this one",
      );
    }
    if (result.code === 4) {
      halt(
        "ownership-unresolved",
        `ownership of worker "${spawned.name}" is ambiguous — more than one live session answered (exit code 4)`,
        "this is a documented hard stop — never retry it; retire the duplicate live sessions until exactly one answers, then spawn a fresh worker",
      );
    }
    halt(
      "ownership-unresolved",
      `the ownership check for worker "${spawned.name}" failed with exit code ${result.code}`,
      `investigate exit code ${result.code} from the agent-toolkit:spawn-agent ownership check, then re-run the stage`,
    );
  }

  const resolved = result.handle;
  if (resolved === undefined || resolved.trim() === "") {
    halt(
      "handle-unresolved",
      `the ownership check for worker "${spawned.name}" exited 0 but resolved no handle`,
      "re-spawn the worker so the ownership check resolves a handle, then re-run the stage",
    );
  }

  if (resolved !== spawned.handle) {
    halt(
      "handle-composed",
      `the reported handle "${spawned.handle}" is not the handle the ownership check resolved ("${resolved}")`,
      "report the handle the ownership check resolved rather than composing one, then re-run the stage",
    );
  }

  return {
    line: renderReceiptLine({
      handle: resolved,
      ledger: spawned.ledger,
      owned: result.code,
    }),
    handle: resolved,
    ledger: spawned.ledger,
  };
}

/** The one line, fields emitted in the exported order. */
function renderReceiptLine(parsed: ParsedSpawnReceipt): string {
  const values: Readonly<Record<SpawnReceiptField, string>> = {
    handle: parsed.handle,
    ledger: parsed.ledger,
    owned: String(parsed.owned),
  };
  const fields = SPAWN_RECEIPT_FIELDS.map((field) => `${field}=${values[field]}`);
  return `${RECEIPT_INDENT}${SPAWN_RECEIPT_PREFIX} ${fields.join(" ")}`;
}

// ---------------------------------------------------------------------------
// The grading side.
// ---------------------------------------------------------------------------

/**
 * The first receipt among `lines`, or `null` when none of them is one.
 *
 * "Receipt-shaped" is not enough: the prefix is fixed, the field order is
 * fixed, and an empty field is not a field. A line that misses any of those is
 * not a receipt, so a grader cannot be satisfied by prose that merely mentions
 * a spawn.
 */
export function parseSpawnReceipt(
  lines: readonly string[],
): ParsedSpawnReceipt | null {
  for (const line of lines) {
    const match = RECEIPT_RE.exec(line);
    if (match === null) continue;
    const captured = SPAWN_RECEIPT_FIELDS.reduce<Record<string, string>>(
      (acc, field, index) => {
        acc[field] = match[index + 1] ?? "";
        return acc;
      },
      {},
    );
    return {
      handle: captured.handle!,
      ledger: captured.ledger!,
      owned: Number(captured.owned!),
    };
  }
  return null;
}

/**
 * The first line that CLAIMS to be a receipt — it carries the fixed prefix —
 * whether or not it parses as one. Returned verbatim (untrimmed), or `null`
 * when no line even claims it.
 *
 * This exists because "absent" and "malformed" are different operator
 * situations with different remedies, and `parseSpawnReceipt` alone cannot
 * tell them apart: a transposed line does not parse, so it is indistinguishable
 * from a line that was never written. The operator who transposed two fields
 * must be told to fix the ORDER; the operator who omitted the line must be told
 * to ADD one. A grader that answers both with the same sentence has one guard
 * where it claims two, and cannot prove to a reader that the second exists.
 */
export function findSpawnReceiptLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (line.trimStart().startsWith(SPAWN_RECEIPT_PREFIX)) return line;
  }
  return null;
}

/**
 * Does this chain owe a receipt?
 *
 * The question the grading turns on, answered from the PLACEMENTS the chain
 * itself carries rather than re-derived in prose at each call site.
 *
 * The test is `!== "inline"`, not `=== "worker"`, and the direction is the
 * whole point: only a step that ran in the orchestrating session is excused,
 * so anything else — a placement this vocabulary does not carry yet, one added
 * upstream tomorrow — DEFAULTS TO OWING PROOF rather than to an excuse. The
 * `=== "worker"` form answered `false` for every such placement, which is this
 * FR's own fail-open shape one value over.
 *
 * Not widened further: a chain of nothing but inline steps spawned nothing and
 * owes nothing, which is why the inline path is graded exactly as it was
 * before this module existed.
 */
export function chainRequiresSpawnReceipt(chain: readonly ChainStep[]): boolean {
  return chain.some((step) => step.placement !== "inline");
}

// ---------------------------------------------------------------------------
// The command line.
//
// AUDIT-4 ITEM 3. `renderSpawnReceipt` carried AC.4, AC.5 and AC.6 while being
// referenced by ZERO files outside its own test, and `skills/deliver/SKILL.md`
// told a worker to TYPE the receipt by hand — i.e. to COMPOSE the values, the
// exact act AC.2 forbids. A guard nothing invokes is a guard that never fires,
// so the emission side gets the shipped `import.meta.main` idiom
// (`active_plan_ship_ready.ts`, `deliver_decision.ts`) and the operative
// surface ORDERS the command instead of dictating a line.
//
//   bun run spawn_receipt.ts <handle> <ledger> <name> <host> [owned-check-command]
//
// `<handle> <ledger> <name> <host>` are what the SPAWNING TOOL reported; the
// module derives none of them. `<host>` is the empty string when the tool
// reported no terminal host, which is how AC.6's halt is reachable from argv
// alone. `[owned-check-command]` is invoked as `<command> <ledger> <name>`:
// its EXIT CODE is the `owned` code and the first line of its stdout is the
// handle it RESOLVED. Still NO SPAWN MECHANICS HERE — the check arrives as an
// injected command exactly as the in-process path takes an injected runner.
//
// A clean resolve prints the ONE receipt line on stdout and exits 0. Every
// other outcome prints the NFR-10 envelope on STDERR, exits non-zero, and
// prints NOTHING on stdout: the record channel stays empty on a refusal, so a
// caller reading stdout gets a whole receipt or nothing, never a partial.
//
// Under `import` this block does not run, so the module stays side-effect free
// and its exported functions stay pure.
// ---------------------------------------------------------------------------

/** The ownership check used when the caller names none — the tool's own. */
const DEFAULT_OWNED_CHECK = "spawn-agent-owned";

if (import.meta.main) {
  const [handle, ledger, name, host, ownedCommand] = process.argv.slice(2);
  if (
    handle === undefined ||
    ledger === undefined ||
    name === undefined ||
    host === undefined
  ) {
    console.error(
      [
        "Refusing: the spawn receipt printer was given fewer than the four values the spawning tool reported",
        "Remedy: run `bun run spawn_receipt.ts <handle> <ledger> <name> <host> [owned-check-command]`, passing an empty <host> when the tool reported no terminal host",
        "Context: reason=incomplete-argv",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    try {
      const receipt = renderSpawnReceipt({
        spawned: { handle, ledger, name, host },
        owned: (query) => {
          const proc = Bun.spawnSync(
            [ownedCommand ?? DEFAULT_OWNED_CHECK, query.ledger, query.name],
            { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
          );
          const resolved = (proc.stdout.toString().split("\n")[0] ?? "").trim();
          return {
            code: proc.exitCode ?? 1,
            handle: resolved.length > 0 ? resolved : undefined,
          };
        },
      });
      console.log(receipt.line);
    } catch (error) {
      // stderr, never stdout — the fail-closed invariant above.
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

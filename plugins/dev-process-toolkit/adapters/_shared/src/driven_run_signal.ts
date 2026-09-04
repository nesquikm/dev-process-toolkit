// driven_run_signal (STE-549) — the runtime answer to "is an orchestrator
// driving this stage, or did a person type it?"
//
// THE DEFECT. Nothing readable at runtime told a skill which of those two it
// was in. The toolkit shipped exactly one machine-checkable invocation signal —
// `<dpt:auto-approve>v1</dpt:auto-approve>`, read by `check_marker_runtime.ts` —
// and that marker answers a DIFFERENT question: whether anybody is present to
// be asked. `/deliver` is forbidden from emitting it (skills/deliver/SKILL.md
// § Two hard prohibitions), precisely because its workers ARE interactive and
// their approval gates must stay live. So the one signal on the record is both
// unavailable to the orchestrator and about the wrong thing, and every stage
// was left inferring its own situation from the prose it was handed.
//
// WHY THE DISTINCTION IS NOT COSMETIC. Headless asks whether anyone is there to
// type. Driven asks whether the answer is already on the record. The four
// combinations are all real, and a worker `/deliver` spawns is the one that
// makes collapsing them unsafe: it is DRIVEN and fully INTERACTIVE at once.
// Fold the two signals together and you either silence gates that must stay
// live (treating driven as headless) or leave the M143 defect unfixed
// (treating headless as the only signal there is).
//
// THE SHAPE IS DELIBERATELY THE SHIPPED ONE. A distinct literal, a distinct
// reader, no shared truthiness, and a byte-grep rather than an inference:
// `isDrivenRun` never judges whether a prompt "looks orchestrated". A model
// asked to recognise orchestrator-shaped prose answers differently on different
// days, which is the whole reason the auto-approve marker was minted as bytes
// in the first place (STE-262).
//
// FORGERY IS TREATED THE SAME WAY THE SHIPPED MARKER TREATS IT, not better
// (AC-STE-549.5). Both readers are substring matches, so a user who pastes the
// literal into their own argument is read as carrying it — by BOTH readers,
// identically. That symmetry is the criterion: a driven reader that tried to be
// cleverer than `checkMarkerRuntime` would be a second, divergent notion of
// what "the signal is present" means, and the two would answer differently on
// the day it mattered. The defence against forgery is that the signal
// AUTHORIZES NOTHING: it suppresses a report block and a continuation offer,
// both of which a user who typed the marker deliberately has already asked for.
// It never approves a commit, a push, or a gate — those stay exactly where the
// gate taxonomy in `gate_class.ts` leaves them.
//
// Pure module: no env reads, no FS reads on the predicate path, no imports.

import { existsSync, readFileSync } from "node:fs";

/**
 * The canonical driven-run literal. Byte-distinct from
 * `<dpt:auto-approve>v1</dpt:auto-approve>` and sharing no substring with it,
 * so neither reader can ever answer for the other.
 */
export const DRIVEN_MARKER = "<dpt:driven>v1</dpt:driven>";

/** CLI tokens, mirroring `check_marker_runtime`'s `PRESENT` / `ABSENT` pair. */
export const DRIVEN_TOKEN = "DRIVEN";
export const STANDALONE_TOKEN = "STANDALONE";

export interface DrivenRunSignalResult {
  present: boolean;
}

/**
 * Pure byte-grep helper. Exact substring match for the canonical literal —
 * no regex, no whitespace tolerance, no version flexibility, no case folding.
 */
export function checkDrivenRuntime(promptBody: string): DrivenRunSignalResult {
  return { present: String(promptBody ?? "").includes(DRIVEN_MARKER) };
}

/**
 * THE ONE PREDICATE CONSUMERS READ (AC-STE-549.1).
 *
 * Every consumer asks this function rather than grepping for the literal
 * itself, so the literal has exactly one owner. A second reader spelled out at
 * a call site is the drift this indirection exists to prevent: it agrees today
 * and stops agreeing the day the literal moves.
 */
export function isDrivenRun(promptBody: string): boolean {
  return checkDrivenRuntime(promptBody).present;
}

// ---------------------------------------------------------------------------
// The driving sites (AC-STE-549.4 / AC-STE-549.6).
//
// A surface that DRIVES a stage without supplying the signal is a violation of
// the criterion, not an omission — so the sites are enumerated here, in the
// module that owns the literal, and graded by span rather than by a file-wide
// substring search. File-wide is exactly the check that cannot tell three
// surfaces apart: it passes with two of them empty.
//
// The spans are anchored on prose that names the invocation each site makes,
// because two of the three sites share a single line: `/deliver` invokes
// Phase 1 and Phase 2 in one sentence. A line-scoped read would score them as
// one site and a drop-one mutation on either would be invisible.
// ---------------------------------------------------------------------------

export interface DrivingSite {
  /** Stable id — the mutation leg and any probe key on it. */
  readonly id: string;
  /** Prose that names the invocation, unique within the file. */
  readonly anchor: string;
  /** What this surface drives, in the operator's words. */
  readonly drives: string;
}

export const DRIVING_SITES: readonly DrivingSite[] = [
  {
    id: "phase1_brainstorm_inline",
    anchor: "`/dev-process-toolkit:brainstorm` (Phase 1)",
    drives: "the inline Phase 1 design stage",
  },
  {
    id: "phase2_spec_write_inline",
    anchor: "`/dev-process-toolkit:spec-write` (Phase 2)",
    drives: "the inline Phase 2 spec-writing stage",
  },
  {
    id: "phase3_worker_kickoff",
    anchor: "**Driven signal**",
    drives: "every Phase 3 worker, through its kickoff task text",
  },
];

/**
 * The span of `body` a driving site owns: from its anchor to whichever comes
 * first — the next site's anchor, or the end of that line.
 *
 * Returns `null` when the anchor is absent, which a caller must distinguish
 * from "present and carrying no signal": a missing anchor means the surface
 * was renamed out from under this list, and answering `false` there would
 * report a supplied signal as withheld.
 */
export function drivingSiteSpan(body: string, siteId: string): string | null {
  const site = DRIVING_SITES.find((s) => s.id === siteId);
  if (!site) return null;
  const text = String(body ?? "");
  const start = text.indexOf(site.anchor);
  if (start < 0) return null;
  const after = start + site.anchor.length;
  const bounds = [text.indexOf("\n", after)];
  for (const other of DRIVING_SITES) {
    if (other.id === site.id) continue;
    const idx = text.indexOf(other.anchor, after);
    if (idx >= 0) bounds.push(idx);
  }
  const end = Math.min(...bounds.filter((n) => n >= 0));
  return text.slice(start, Number.isFinite(end) ? end : text.length);
}

/**
 * Does this driving surface supply the signal at this site? `false` for an
 * absent anchor as well as a signal-free span — both mean a stage invoked
 * there reads STANDALONE, which is the fact the criterion is about.
 */
export function drivingSiteSupplies(body: string, siteId: string): boolean {
  const span = drivingSiteSpan(body, siteId);
  return span === null ? false : isDrivenRun(span);
}

function buildIoErrorMessage(reason: string, source: string): string {
  return [
    `driven_run_signal: I/O error reading ${source}: ${reason}.`,
    `Remedy: verify the file path exists and is readable, or pipe the ` +
      `invocation body to stdin via \`-\`.`,
    `Context: helper=driven_run_signal, source=${source}, severity=error`,
  ].join("\n");
}

function readStdinSync(): string {
  return readFileSync(0, "utf-8");
}

async function main(argv: string[]): Promise<number> {
  const arg = argv[2];
  if (arg === undefined || arg === "") {
    process.stderr.write(
      buildIoErrorMessage(
        "missing argument",
        "argv[2] (expected file path or '-' for stdin)",
      ) + "\n",
    );
    return 2;
  }
  let body: string;
  if (arg === "-") {
    try {
      body = readStdinSync();
    } catch (e) {
      process.stderr.write(
        buildIoErrorMessage((e as Error).message ?? "unknown", "stdin") + "\n",
      );
      return 2;
    }
  } else {
    if (!existsSync(arg)) {
      process.stderr.write(buildIoErrorMessage("file not found", arg) + "\n");
      return 2;
    }
    try {
      body = readFileSync(arg, "utf-8");
    } catch (e) {
      process.stderr.write(
        buildIoErrorMessage((e as Error).message ?? "unknown", arg) + "\n",
      );
      return 2;
    }
  }
  process.stdout.write(
    (isDrivenRun(body) ? DRIVEN_TOKEN : STANDALONE_TOKEN) + "\n",
  );
  return 0;
}

// Front door: only runs when invoked directly, never on import.
if (import.meta.main) {
  const code = await main(process.argv);
  process.exit(code);
}

// fork_tdd_result_assert — STE-484. Count the `tdd-result` hand-off fences a
// /tdd run's FORKED children actually emitted, from a `claude -p
// --output-format stream-json` capture.
//
// WHY NEITHER GREP FORM WORKS (measured on the three archived 2026-08-16
// conformance captures shipped under `tests/fixtures/m127-falsifiability/`):
//
//  1. ``grep -c '^```tdd-result$'`` — line-anchored. STE-352 made
//     `--output-format stream-json --verbose` mandatory, so the capture is
//     NDJSON: every newline inside a payload is the two characters `\` `n`
//     inside a JSON string. There is no line start to anchor to, so the count
//     is 0 on EVERY capture, healthy or dead. Vacuous in the failing direction.
//  2. ``grep -c '```tdd-result'`` — bare/unanchored. `claude -p` injects the
//     invoked skill's SKILL.md body as a synthetic `user` event and that body
//     spells the fence tag, and the raw bytes carry each tool_result MIRRORED
//     under the event's `tool_use_result` key. On the shipped linear slice the
//     raw count is 18 where the real hand-offs number 8; strip every fork event
//     and it STILL returns non-zero off the injected prompt alone. Vacuous in
//     the passing direction.
//
// AND WHY `extractAssistantText` IS NOT THE REPAIR EITHER. It keeps only
// `assistant` events' text blocks — `user` events and `tool_result` blocks are
// excluded BY DESIGN (STE-421) — while the /tdd orchestrator's children run
// `context: fork`, so their hand-off blocks arrive precisely in the excluded
// events. Routing through it scores 0 on every healthy capture too.
//
// THE PROJECTION THAT DOES WORK: `tool_result` content from NON-SYNTHETIC
// `user` events, and nothing else. Not the synthetic SKILL body (which is the
// prompt, not the run), and not the `tool_use_result` mirror (which would
// double every hand-off). Measured against the shipped slices it yields
// linear 8 / jira 6 / none 6, against a raw 18 / 14 / 14.
//
// THE `none` LEG IS THE TRAP. Its six fence-bearing tool_results carry ZERO
// occurrences of the `(forked execution)` banner the linear and jira legs
// carry, so nothing here may key on that banner: the projection is structural
// (event type + block type), never textual.
//
// Usage (the CLI shim at the bottom, mirroring capability_row_assert.ts):
//   bun fork_tdd_result_assert.ts <capture.log> <min>
// stdout is the BARE integer count and nothing else, so a caller parsing a
// count reads a number rather than degrading to counting output lines;
// diagnostics go to stderr. Exit: count ≥ min ⇒ 0, below ⇒ 1, usage error ⇒ 2.

import {
  messageContentBlocks,
  parseStreamJsonEvents,
  type StreamJsonEvent,
} from "./stream_json_events";

/** The hand-off fence tag the /tdd orchestrator's children emit. */
export const FORK_TDD_RESULT_FENCE = "```tdd-result";

/** Occurrences of `needle` in `haystack`, non-overlapping. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * The text a single content block carries. A `tool_result`'s `content` is
 * either a plain string or a nested block list; both shapes are flattened, and
 * a block with neither contributes nothing.
 */
function blockText(block: StreamJsonEvent): string {
  const parts: string[] = [];
  if (typeof block.text === "string") parts.push(block.text);
  const content = block.content;
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const nested of content) {
      if (nested && typeof nested === "object") {
        parts.push(blockText(nested as StreamJsonEvent));
      } else if (typeof nested === "string") {
        parts.push(nested);
      }
    }
  }
  return parts.join("\n");
}

/**
 * The text of every `user`-event content block `keep` accepts, in stream order,
 * joined so each payload starts on its own line (fences stay line-anchored and
 * greppable). Both projections below are this one walk under a different
 * predicate — the fork/synthetic split is a filter, never a second reader, so
 * the two halves of `scoreForkTddResults` can never drift apart.
 *
 * Malformed lines are skipped — the same posture as the sibling readers, so a
 * truncated capture still yields a usable prefix instead of crashing a smoke
 * leg. Assistant text, tool_use inputs and every non-`user` event contribute
 * nothing to either projection.
 */
function projectUserText(
  ndjson: string,
  keep: (event: StreamJsonEvent, block: StreamJsonEvent) => boolean,
): string {
  const raw = typeof ndjson === "string" ? ndjson : "";
  const payloads: string[] = [];
  for (const event of parseStreamJsonEvents(raw)) {
    for (const block of messageContentBlocks(event, "user")) {
      if (keep(event, block)) payloads.push(blockText(block));
    }
  }
  return payloads.join("\n");
}

/**
 * Project the `tool_result` content of NON-SYNTHETIC `user` events out of a
 * stream-json NDJSON capture.
 *
 * Excluded, deliberately and structurally: the injected synthetic `user` SKILL
 * body (the prompt, not the run) and the `tool_use_result` mirror of every
 * tool_result (which would double each hand-off).
 */
export function extractForkToolResultText(ndjson: string): string {
  return projectUserText(
    ndjson,
    (event, block) => event.isSynthetic !== true && block.type === "tool_result",
  );
}

/** The injected synthetic-`user` events' own text, in stream order. */
function extractSyntheticText(ndjson: string): string {
  return projectUserText(ndjson, (event) => event.isSynthetic === true);
}

/** Fence count in the forked-child `tool_result` projection. Decides. */
export function countForkTddResults(ndjson: string): number {
  return occurrences(extractForkToolResultText(ndjson), FORK_TDD_RESULT_FENCE);
}

/** The fork / synthetic / raw split, as COUNTS — never presence booleans. */
export interface ForkTddResultScore {
  /** Fences in the forked-child `tool_result` projection. The verdict. */
  forkHits: number;
  /** Fences inside the injected synthetic SKILL body. Diagnostics. */
  syntheticHits: number;
  /** Fences in the raw NDJSON bytes — what the bare grep counted. Diagnostics. */
  rawHits: number;
}

/**
 * Score a capture three ways. `forkHits` decides; the other two exist so a
 * failing fixture can quote the fork-vs-raw split, which is what PROVES the
 * two exclusions happened rather than leaving them assumed.
 */
export function scoreForkTddResults(ndjson: string): ForkTddResultScore {
  const raw = typeof ndjson === "string" ? ndjson : "";
  return {
    forkHits: countForkTddResults(raw),
    syntheticHits: occurrences(extractSyntheticText(raw), FORK_TDD_RESULT_FENCE),
    rawHits: occurrences(raw, FORK_TDD_RESULT_FENCE),
  };
}

if (import.meta.main) {
  const [capturePath, minArg] = process.argv.slice(2);
  const min = Number.parseInt(minArg ?? "", 10);
  if (!capturePath || !/^\d+$/.test(minArg ?? "") || Number.isNaN(min)) {
    console.error("usage: bun fork_tdd_result_assert.ts <capture.log> <min>");
    process.exit(2);
  }
  const file = Bun.file(capturePath);
  // A missing capture is a real smoke signal, not a crash: it scores 0 and the
  // threshold decides, exactly as capability_row_assert.ts treats one.
  const ndjson = (await file.exists()) ? await file.text() : "";
  const score = scoreForkTddResults(ndjson);
  // stdout: the bare integer, nothing else. Everything a human needs goes to
  // stderr so it can never contaminate the parsed count.
  console.error(
    `fork tdd-result: fork=${score.forkHits} synthetic=${score.syntheticHits} ` +
      `raw=${score.rawHits} min=${min} ${capturePath}`,
  );
  console.log(String(score.forkHits));
  process.exit(score.forkHits >= min ? 0 : 1);
}

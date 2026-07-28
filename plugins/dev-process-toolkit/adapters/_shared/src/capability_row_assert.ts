// capability_row_assert — STE-421. Decide "did the child skill EMIT this
// capability row?" from a `claude -p --output-format stream-json` capture,
// and expose the decision as a one-line verdict + exit code the
// /smoke-test driver branches on.
//
// WHY A RAW GREP CAN NEVER BE SOUND (measured on the 2026-07-27 run, not
// assumed). `claude -p` injects the invoked skill's SKILL.md body into the
// transcript as a SINGLE SYNTHETIC `user` event —
// `{"type":"user","isSynthetic":true,"message":{"content":[{"type":"text",…}]}}`
// — NOT as a tool_result. That body enumerates the skill's own capability
// keys. So every key a skill DOCUMENTS is present in the raw log of EVERY
// capture of that skill, unconditionally, never run-dependently. On the
// 2026-07-27 `/spec-write` captures the single 83 KB synthetic-user event
// alone accounts for every raw hit of all five scored keys — on a run where
// `/spec-write` refused at its first-turn gate and emitted nothing at all.
// `grep -F '<key>' <capture>.log` therefore scored a total non-emission as a
// PASS on the presence fixtures, and would have scored a correct refusal as a
// marker-contract regression on the absence fixtures.
//
// THE FIX, in one sentence: project the capture through
// `extractAssistantText` (only `assistant` events' text blocks survive) and
// decide on that projection. tool_use inputs, tool_results, the synthetic
// skill body, and stderr noise all contribute zero.
//
// THE SECOND DISCRIMINATOR. A key that lands AFTER the STE-408 refusal marker
// in that projection is post-refusal EXPLANATORY PROSE ("the
// `spec_write_draft_default_applied` row is emitted by § 7 only after the
// interview completes — the run never reached § 7"), never an emission. Those
// occurrences are counted as `postRefusalHits` and subtracted, which is what
// stops a CORRECT refusal from reading as a marker-contract regression. The
// rule is positional, not marker-presence: the same token ahead of the marker
// still scores PRESENT.
//
// `rawHits` is retained and reported purely as diagnostics — it is the count
// the old method used, so a verdict line can show the operator exactly how far
// apart the two methods are. It never participates in the decision.
//
// Usage (the CLI shim at the bottom, mirroring socratic_first_turn_assert.ts):
//   bun capability_row_assert.ts <present|absent|any-of> <capture.log> <key…>
// Exit codes: expectation met ⇒ 0, not met ⇒ 1, usage error ⇒ 2.

import { REQUIRES_INPUT_REFUSED_MARKER } from "./requires_input";
import { extractAssistantText } from "./smoke_child_capture";

export { REQUIRES_INPUT_REFUSED_MARKER };

/** How a capture scored for one capability key. */
export interface CapabilityScore {
  /** The verdict: `assistantHits - postRefusalHits > 0`. */
  present: boolean;
  /** Occurrences in the assistant-text projection of the capture. */
  assistantHits: number;
  /** Occurrences in the raw NDJSON bytes. Diagnostics only — never decides. */
  rawHits: number;
  /** Assistant-text occurrences at or after the refusal marker. */
  postRefusalHits: number;
}

/** What the caller expects of the key set as a whole. */
export type CapabilityExpectation = "present" | "absent" | "any-of";

export interface CapabilityVerdict {
  /** Single line: `<expectation>: <ok|fail> <key>=… …`. */
  line: string;
  /** 0 when the expectation is met, 1 when it is not. */
  exitCode: number;
  /** Full score for every requested key, keyed by key name. */
  scores: Record<string, CapabilityScore>;
}

const EXPECTATIONS: ReadonlySet<string> = new Set<CapabilityExpectation>([
  "present",
  "absent",
  "any-of",
]);

/** Start indexes of every non-overlapping occurrence of `needle`. */
function occurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return out;
    out.push(at);
    from = at + needle.length;
  }
}

/**
 * Score one capability key against one stream-json capture.
 *
 * `present` is decided ONLY from the assistant-text projection, minus any
 * occurrence that follows the refusal marker. An empty / malformed / absent
 * capture scores all-zero rather than throwing — the smoke driver must be
 * able to run this over a truncated log without crashing the leg.
 */
export function scoreCapabilityKey(
  ndjson: string,
  key: string,
): CapabilityScore {
  const raw = typeof ndjson === "string" ? ndjson : "";
  const rawHits = occurrences(raw, key).length;

  const assistantText = raw.trim().length > 0 ? extractAssistantText(raw) : "";
  const hits = occurrences(assistantText, key);

  // First marker occurrence wins: everything downstream of the refusal is
  // wrap-up prose, however many times the marker is restated.
  const markerAt = assistantText.indexOf(REQUIRES_INPUT_REFUSED_MARKER);
  const postRefusalHits =
    markerAt < 0 ? 0 : hits.filter((at) => at > markerAt).length;

  const assistantHits = hits.length;
  return {
    present: assistantHits - postRefusalHits > 0,
    assistantHits,
    rawHits,
    postRefusalHits,
  };
}

function expectationMet(
  expectation: CapabilityExpectation,
  scores: CapabilityScore[],
): boolean {
  switch (expectation) {
    case "present":
      // Vacuously true on an empty key list, but the CLI rejects that as a
      // usage error before it can become a silent pass.
      return scores.every((s) => s.present);
    case "absent":
      return scores.every((s) => !s.present);
    case "any-of":
      return scores.some((s) => s.present);
  }
}

/**
 * Score a whole key set and render the driver-facing verdict.
 *
 * The line is single-line by construction (`\n` never appears in a key or in
 * the rendered counts) and always leads with the expectation so a smoke
 * summary row is self-describing without the surrounding prose.
 */
export function capabilityVerdict(
  ndjson: string,
  keys: readonly string[],
  expectation: CapabilityExpectation,
): CapabilityVerdict {
  const scores: Record<string, CapabilityScore> = {};
  for (const key of keys) scores[key] = scoreCapabilityKey(ndjson, key);

  const ok = expectationMet(
    expectation,
    keys.map((key) => scores[key]!),
  );
  const detail = keys
    .map((key) => {
      const s = scores[key]!;
      return `${key}=${s.present ? "present" : "absent"}(assistant=${s.assistantHits},post-refusal=${s.postRefusalHits},raw=${s.rawHits})`;
    })
    .join(" ");

  return {
    line: `${expectation}: ${ok ? "ok" : "fail"}${detail ? ` ${detail}` : ""}`,
    exitCode: ok ? 0 : 1,
    scores,
  };
}

if (import.meta.main) {
  const [expectation, capturePath, ...keys] = process.argv.slice(2);
  if (
    !expectation ||
    !EXPECTATIONS.has(expectation) ||
    !capturePath ||
    keys.length === 0
  ) {
    console.error(
      "usage: bun capability_row_assert.ts <present|absent|any-of> <capture.log> <key…>",
    );
    process.exit(2);
  }
  const file = Bun.file(capturePath);
  // A missing capture is a real smoke signal, not a crash: score it as an
  // empty capture and let the expectation decide (chain-integrity detection
  // is assertChainIntegrity's job, not this runner's).
  const ndjson = (await file.exists()) ? await file.text() : "";
  const verdict = capabilityVerdict(
    ndjson,
    keys,
    expectation as CapabilityExpectation,
  );
  console.log(verdict.line);
  process.exit(verdict.exitCode);
}

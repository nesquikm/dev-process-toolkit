// smoke_child_capture — readers and assertions for /smoke-test Phase 2's
// `claude -p --output-format stream-json` child captures (NDJSON at
// /tmp/dpt-smoke-<tracker>-<skill>.log). Three detector families live here,
// in file order: the STE-352 per-capture readers (AC-STE-352.1 +
// AC-STE-352.2) directly below, then the STE-356 allowlist-inert raw-text
// detector and the STE-355 end-of-run chain-integrity assertion, each under
// its own banner further down.
//
// Two capture failure modes hid the M94 STE-350 bug behind green smoke runs:
//
// - F2 text-mode blind spot: default text mode emits only the child's final
//   result message, so mid-stream assistant tokens (per-probe capability
//   rows, forked `tdd-result` fences) never reached the log.
//   extractAssistantText lifts ALL assistant text blocks out of the NDJSON
//   capture, in stream order, joined so each block starts on its own line —
//   fences stay line-anchored and greppable.
// - 0-byte grandchild: a child whose nested `claude -p` spawn was denied by
//   the permission classifier can still exit green with an empty capture.
//   checkChildSpawnCapture is the direct detector — an empty capture, or a
//   `permission_denials[]` entry whose tool_input.command head is `claude`,
//   is one high-severity finding with the canonical STE-350 diagnostic.
//
// Malformed / non-assistant lines are silently skipped (same posture as
// parseStreamJsonTranscript in socratic_first_turn_stream.ts) so a partial
// or truncated capture still yields a usable prefix. Both modules share the
// low-level NDJSON reader in stream_json_events.ts.

import { existsSync, readFileSync, statSync } from "node:fs";

import {
  assistantContentBlocks,
  parseStreamJsonEvents,
} from "./stream_json_events";

export interface ChildSpawnFinding {
  severity: "high";
  diagnostic: string;
}

// Every detector family emits the same finding shape — severity is always
// "high"; only the per-family diagnostic prefix differs.
function highFinding(diagnostic: string): ChildSpawnFinding {
  return { severity: "high", diagnostic };
}

const SPAWN_DIAGNOSTIC_PREFIX =
  "STE-350 regression: nested claude -p spawn denied/empty — ";

// Head-anchored `claude` spawn match: the denied command must START with the
// bare word `claude` — a command merely mentioning `claude -p` mid-string
// (e.g., a grep over a SKILL.md body) is NOT a nested-spawn denial.
const CLAUDE_SPAWN_HEAD_RE = /^claude(\s|$)/;

/**
 * Project every assistant event's text blocks out of a stream-json NDJSON
 * capture, in stream order. Blocks are joined so each starts on its own
 * line (```tdd-result fences stay line-anchored / greppable). tool_use
 * inputs, tool_results, and non-assistant events contribute no text.
 */
export function extractAssistantText(ndjson: string): string {
  const blocks: string[] = [];
  for (const event of parseStreamJsonEvents(ndjson)) {
    for (const block of assistantContentBlocks(event)) {
      if (block.type === "text" && typeof block.text === "string") {
        blocks.push(block.text);
      }
    }
  }
  return blocks.join("\n");
}

function spawnFinding(child: string): ChildSpawnFinding {
  return highFinding(`${SPAWN_DIAGNOSTIC_PREFIX}${child}`);
}

/**
 * Assert a child's capture is non-empty and non-denied.
 *
 * Returns [] on a healthy capture, or exactly one high-severity finding
 * when the capture is empty (the 0-byte-grandchild symptom) or a `result`
 * event carries a permission_denials entry whose tool_input.command head is
 * `claude` (a denied nested spawn).
 */
export function checkChildSpawnCapture(
  ndjson: string,
  child: string,
): ChildSpawnFinding[] {
  if (ndjson.trim().length === 0) return [spawnFinding(child)];

  for (const event of parseStreamJsonEvents(ndjson)) {
    if (event.type !== "result") continue;
    const denials = event.permission_denials;
    if (!Array.isArray(denials)) continue;
    for (const denial of denials) {
      if (!denial || typeof denial !== "object") continue;
      const toolInput = (denial as Record<string, unknown>).tool_input;
      if (!toolInput || typeof toolInput !== "object") continue;
      const command = (toolInput as Record<string, unknown>).command;
      if (
        typeof command === "string" &&
        CLAUDE_SPAWN_HEAD_RE.test(command.trimStart())
      ) {
        return [spawnFinding(child)];
      }
    }
  }
  return [];
}

// --- STE-356 AC-STE-356.3 — allowlist-inert runtime detector ----------------
//
// The 2026-07-02 conformance run (finding F4, high) showed grandchildren
// spawned in fresh test-project cwds IGNORING the scaffolded
// `.claude/settings.json` allow-list — captured logs opened with
//
//   Ignoring 10 permissions.allow entries from .claude/settings.json:
//   this workspace has not been trusted
//
// so the STE-252 policy artifact was inert at the grandchild layer and the
// canonical chain ran on auto-mode classifier goodwill. Allow-list inert =
// policy breach, always a high-severity finding.

const ALLOWLIST_INERT_DIAGNOSTIC_PREFIX =
  "STE-356 regression: allow-list inert — ";

// The warning is a stderr line interleaved into the 2>&1 NDJSON log, or
// echoed inside an assistant text block when a child relays its
// grandchild's stderr — so this is a RAW-TEXT detector (no NDJSON parsing).
// All three markers must be present; the entry count is deliberately not
// pinned ("Ignoring 3 …" fires the same as "Ignoring 10 …").
const ALLOWLIST_INERT_MARKERS = [
  "Ignoring",
  "permissions.allow entries",
  "has not been trusted",
] as const;

/**
 * Detect an inert allow-list in a capture (STE-356 AC-STE-356.3).
 *
 * Returns exactly one high-severity finding,
 * `STE-356 regression: allow-list inert — <child> (workspace untrusted)`,
 * when the capture's raw text carries all three warning markers — one
 * finding even if the warning repeats (child + grandchild both untrusted).
 * A healthy capture (or fewer than all three markers) yields [].
 * Emptiness/denial/truncation detection stays with checkChildSpawnCapture /
 * assertChainIntegrity — the detectors are orthogonal by design.
 */
export function checkAllowlistInert(
  raw: string,
  child: string,
): ChildSpawnFinding[] {
  const inert = ALLOWLIST_INERT_MARKERS.every((marker) =>
    raw.includes(marker),
  );
  if (!inert) return [];
  return [
    highFinding(
      `${ALLOWLIST_INERT_DIAGNOSTIC_PREFIX}${child} (workspace untrusted)`,
    ),
  ];
}

// --- STE-355 AC-STE-355.2 — end-of-run chain-integrity assertion -----------
//
// The 2026-07-02 conformance run truncated silently on both legs (F2 + F3):
// children fired grandchild spawns in the background and exited RC 0, so
// per-skill captures were left missing, empty, or result-less. The reliable
// truncation footprint on every captured leg was a stream-json capture with
// no top-level `type: "result"` event. STE-358 (AC-STE-358.2) later added
// the optional `runStart` freshness gate: iter-2 (2026-07-02 F2) showed a
// stale result-bearing capture surviving a wipe bypass would false-pass the
// content checks alone.

const CHAIN_DIAGNOSTIC_PREFIX = "STE-355 regression: chain truncated — ";

/** One expected per-skill capture: the child's name + its log path. */
export interface ChainCaptureExpectation {
  child: string;
  path: string;
}

function chainFinding(child: string, reason: string): ChildSpawnFinding {
  return highFinding(`${CHAIN_DIAGNOSTIC_PREFIX}${child} (${reason})`);
}

/**
 * Assert every expected per-skill capture completed (STE-355 AC-STE-355.2)
 * and, when `runStart` is given, is fresh (STE-358 AC-STE-358.2).
 *
 * A capture is healthy iff its file exists, is fresh (when `runStart` is
 * provided: `statSync(path).mtimeMs` is not strictly before it — mtime
 * exactly at run-start is fresh), is non-empty, and parseStreamJsonEvents
 * finds a top-level `type: "result"` event — a result-shaped token inside
 * assistant prose does not count. Each miss yields exactly one
 * high-severity finding naming the truncated child,
 * `STE-355 regression: chain truncated — <child> (<reason>)`, in input
 * (chain) order; healthy captures contribute nothing.
 *
 * The freshness gate runs BEFORE the content checks — a stale
 * result-bearing capture (last run's log surviving a wipe bypass, the
 * iter-2 2026-07-02 F2 shape) is `capture stale (pre-run)`, never healthy.
 * `runStart` accepts epoch ms or a Date; omitted, behavior is the
 * unchanged STE-355 contract (no freshness gate). Denial detection is
 * checkChildSpawnCapture's job — a denied-but-complete capture is
 * chain-healthy here.
 */
export function assertChainIntegrity(
  expected: ChainCaptureExpectation[],
  runStart?: number | Date,
): ChildSpawnFinding[] {
  const runStartMs = runStart instanceof Date ? runStart.getTime() : runStart;
  const findings: ChildSpawnFinding[] = [];
  for (const { child, path } of expected) {
    if (!existsSync(path)) {
      findings.push(chainFinding(child, "capture missing"));
      continue;
    }
    if (runStartMs !== undefined) {
      let mtimeMs: number | undefined;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        // Stat race (delete/EACCES after the existsSync check): skip the
        // freshness gate and fall through — readFileSync below degrades
        // the same miss to `capture unreadable`, never a driver crash.
      }
      if (mtimeMs !== undefined && mtimeMs < runStartMs) {
        findings.push(chainFinding(child, "capture stale (pre-run)"));
        continue;
      }
    }
    let ndjson: string;
    try {
      ndjson = readFileSync(path, "utf8");
    } catch {
      // Exists-but-unreadable (EACCES, EISDIR, delete race after the
      // existsSync check): a finding, never a driver crash — every other
      // miss in this function degrades to a finding the same way.
      findings.push(chainFinding(child, "capture unreadable"));
      continue;
    }
    if (ndjson.trim().length === 0) {
      findings.push(chainFinding(child, "capture empty"));
      continue;
    }
    const hasResult = parseStreamJsonEvents(ndjson).some(
      (event) => event.type === "result",
    );
    if (!hasResult) {
      findings.push(chainFinding(child, "result event absent"));
    }
  }
  return findings;
}

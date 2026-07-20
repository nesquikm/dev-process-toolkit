// socratic_first_turn (STE-237 AC-STE-237.5) —
// Pure-I/O arbiter for the Socratic first-turn contract. Walks a parsed
// transcript of a model response stream and asserts that no scaffolding
// tool call (Write / Edit / NotebookEdit) appears before the first
// AskUserQuestion tool_use OR the first RequiresInputRefusedError raise.
//
// Read-only orientation tools (Read, Grep, Glob, Bash) and free-form
// `text` entries are allowed before the first ask — that is the
// "pragmatic first-turn contract" described in
// docs/auto-mode-protocol.md § Socratic Loop Contract.
//
// Consumed by /smoke-test Phase 8's child-spawn fixture (AC-STE-237.4)
// and any future runtime detector. The helper's outcome is the single
// arbiter — drift between Phase 8 prose and the helper's contract is
// caught by socratic_first_turn.test.ts.

import { resolve, sep } from "node:path";

/** Tool names that count as scaffolding for the first-turn contract. */
export const SCAFFOLDING_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

export type ScaffoldingTool = (typeof SCAFFOLDING_TOOLS)[number];

// STE-404: tracker-create MCP tools are as consequential as scaffolding a
// file — creating a ticket before the first ask/refusal is the F4
// autonomous-reminder gate-bypass shape (2026-07-20 re-run: /spec-write went
// straight to createJiraIssue → DST-49 without asking). They are forbidden
// before the first ask/refusal just like SCAFFOLDING_TOOLS, but WITHOUT the
// STE-399 projectRoot path predicate — a tracker create has no path, so the
// violation is name-only and unconditional. `mcp__linear__save_issue` covers
// both create and update, but before the first ask/refusal in /spec-write it
// can only be a create (no prior FR exists to update), so flagging any
// first-turn save_issue is correct and conservative.
export const TRACKER_CREATE_TOOLS = [
  "mcp__atlassian__createJiraIssue",
  "mcp__linear__save_issue",
] as const;

export type TrackerCreateTool = (typeof TRACKER_CREATE_TOOLS)[number];

/** Tool name whose first occurrence satisfies the Socratic loop entry. */
export const ASK_TOOL = "AskUserQuestion";

/** Synthetic entry name marking a `RequiresInputRefusedError` raise in the stream. */
export const REFUSAL_MARKER = "RequiresInputRefusedError";

/**
 * One entry from the parsed model response stream. The shape is
 * intentionally minimal — production callers parse the upstream
 * tool_use / text / refusal records into this normalized form.
 */
export interface TranscriptEntry {
  type: "text" | "tool_use" | "refusal";
  /** Tool name when `type === 'tool_use'`; ignored otherwise. */
  name?: string;
  /**
   * Target path of a scaffolding tool_use (Write/Edit/NotebookEdit), lifted
   * from the tool_input by the stream parser (STE-399 AC-STE-399.5). Absent
   * for non-scaffolding tools and for scaffold events whose input carried no
   * path. Consumed by the `projectRoot` scope check in assertFirstTurnShape.
   */
  path?: string;
}

// STE-399 AC-STE-399.1: `vacuous` is the transcript that never asks, never
// refuses, and never scaffolds — the first-turn contract is un-violated but
// the loop was never entered. It is NOT a pass; the consuming CLI exits
// non-zero on it (a skill that did nothing must not read as compliant).
export type FirstTurnOutcome =
  | "ok-asked"
  | "ok-refused"
  | "violation"
  | "vacuous";

export interface FirstTurnShape {
  outcome: FirstTurnOutcome;
  /** Index in the transcript where the violating scaffold tool fired. */
  firstScaffoldEntry?: { index: number; tool: string };
  /** Index in the transcript where AskUserQuestion or refusal landed. */
  askIndex?: number;
}

export class SocraticFirstTurnViolationError extends Error {
  readonly toolName: string;
  readonly index: number;

  constructor(toolName: string, index: number) {
    const message = [
      `Verdict: Socratic first-turn contract violation — ${toolName} tool_use ` +
        `at transcript index ${index} fired before any AskUserQuestion or ` +
        `RequiresInputRefusedError raise.`,
      `Remedy: rewrite the skill body so every clarifying question is wrapped ` +
        `as an AskUserQuestion tool call, or refuse via requireOrRefuse(...) when ` +
        `no answer is available. Read-only tools (Read / Grep / Glob / Bash-read) ` +
        `are allowed for orientation before the first ask, but Write / Edit / ` +
        `NotebookEdit are forbidden.`,
      `Context: tool=${toolName}, index=${index}, helper=assertFirstTurnShape, ` +
        `protocol=docs/auto-mode-protocol.md § Socratic Loop Contract`,
    ].join("\n");
    super(message);
    this.name = "SocraticFirstTurnViolationError";
    this.toolName = toolName;
    this.index = index;
  }
}

function isScaffoldingTool(name: string | undefined): name is ScaffoldingTool {
  if (!name) return false;
  return (SCAFFOLDING_TOOLS as readonly string[]).includes(name);
}

function isTrackerCreateTool(
  name: string | undefined,
): name is TrackerCreateTool {
  if (!name) return false;
  return (TRACKER_CREATE_TOOLS as readonly string[]).includes(name);
}

/**
 * True when `p` resolves to `root` itself or a path strictly inside it.
 * Boundary-safe: `/root-sibling/x` is NOT inside `/root` (the `+ sep` guards
 * against the prefix-collision `/root` vs `/root-sibling`).
 */
function isPathInside(root: string, p: string): boolean {
  const r = resolve(root);
  const rp = resolve(p);
  return rp === r || rp.startsWith(r + sep);
}

/** Options for {@link assertFirstTurnShape}. */
export interface FirstTurnOptions {
  /**
   * When set, a scaffolding tool_use counts as a first-turn violation only
   * if its `path` resolves inside this root (STE-399 AC-STE-399.3/.4). A
   * scaffold whose path is outside the root is an out-of-project write (an
   * operator's global side-effect log, a skill's own temp scratch) and is
   * skipped, not a violation. Omitted ⇒ unchanged by-name behavior: any
   * scaffolding tool_use is a violation (AC-STE-399.6). A scaffold with no
   * observable path stays a conservative violation even when `projectRoot`
   * is set — an unlocatable early write is treated as suspicious.
   */
  projectRoot?: string;
}

/**
 * Walk the transcript front-to-back and classify the first turn.
 *
 * Returns the shape on success. Throws {@link SocraticFirstTurnViolationError}
 * (NFR-10 canonical message) when a scaffolding tool fires before the first
 * AskUserQuestion / refusal.
 */
export function assertFirstTurnShape(
  transcript: ReadonlyArray<TranscriptEntry>,
  opts?: FirstTurnOptions,
): FirstTurnShape {
  const projectRoot = opts?.projectRoot;
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i]!;
    if (entry.type === "refusal") {
      return { outcome: "ok-refused", askIndex: i };
    }
    if (entry.type === "tool_use") {
      if (entry.name === ASK_TOOL) {
        return { outcome: "ok-asked", askIndex: i };
      }
      if (entry.name === REFUSAL_MARKER) {
        return { outcome: "ok-refused", askIndex: i };
      }
      if (isScaffoldingTool(entry.name)) {
        // STE-399 AC-STE-399.3/.4: with a projectRoot, an out-of-project
        // scaffold write is not a first-turn violation — skip it and keep
        // scanning. Without a projectRoot (AC-STE-399.6) or without an
        // observable path, the scaffold is a violation (conservative).
        if (
          projectRoot !== undefined &&
          entry.path !== undefined &&
          !isPathInside(projectRoot, entry.path)
        ) {
          continue;
        }
        throw new SocraticFirstTurnViolationError(entry.name, i);
      }
      // STE-404: a tracker create before the first ask/refusal is the F4
      // gate-bypass shape. Name-only, path-agnostic (no projectRoot check) —
      // a create is scope-agnostic and always a first-turn violation.
      if (isTrackerCreateTool(entry.name)) {
        throw new SocraticFirstTurnViolationError(entry.name, i);
      }
    }
  }
  // STE-399 AC-STE-399.1: no ask, no refusal, no in-scope scaffold — the
  // first-turn contract is un-violated but the loop was never entered. This
  // is `vacuous`, NOT a pass; the consuming CLI exits non-zero on it so a
  // skill that did nothing cannot read as compliant.
  return { outcome: "vacuous" };
}

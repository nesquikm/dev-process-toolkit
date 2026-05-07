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

/** Tool names that count as scaffolding for the first-turn contract. */
export const SCAFFOLDING_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;

export type ScaffoldingTool = (typeof SCAFFOLDING_TOOLS)[number];

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
}

export type FirstTurnOutcome = "ok-asked" | "ok-refused" | "violation";

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

/**
 * Walk the transcript front-to-back and classify the first turn.
 *
 * Returns the shape on success. Throws {@link SocraticFirstTurnViolationError}
 * (NFR-10 canonical message) when a scaffolding tool fires before the first
 * AskUserQuestion / refusal.
 */
export function assertFirstTurnShape(
  transcript: ReadonlyArray<TranscriptEntry>,
): FirstTurnShape {
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
        throw new SocraticFirstTurnViolationError(entry.name, i);
      }
    }
  }
  // No ask, no refusal, no scaffold — treat as ok-asked with no askIndex.
  // Empty / read-only / text-only transcripts are vacuous (no first-turn
  // contract violation possible). Callers that want to assert "loop entered
  // at all" must check `askIndex !== undefined`.
  return { outcome: "ok-asked" };
}

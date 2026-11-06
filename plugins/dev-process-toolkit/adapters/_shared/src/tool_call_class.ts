// STE-716 / STE-717 — the tool-call classifier.
//
// One home for the rule that names a Bash call's `class` and a Skill call's
// `skill`. The tool-call capture hook (templates/hooks/_lib/hooks/
// tool-call-capture.ts) loads it by dynamic import only after its flag reads
// true; the timeline reader (tool_call_timeline.ts) loads it to classify a
// transcript's calls the same way. Command text is read and never kept.

import { resolveCommitTargetFromPayload } from "./commit_target_repo";
import { resolvePrTargetFromPayload } from "./pr_target_repo";
import { announcesGateReceipt, runsGateOutcome } from "./gate_receipt";

export type BashCallClass = "commit" | "pr-create" | "gate-receipt" | "other";

export interface BashCall {
  class: BashCallClass;
  /** The checkout root a `commit` writes to; null for every other class, or when it cannot be determined. */
  commitRepoRoot: string | null;
}

/** A Bash call's class, from its command and the working directory it runs in. */
export function classifyBashCall(command: string, cwd: string | undefined): BashCall {
  const payload = { cwd, tool_input: { command } };
  const commit = resolveCommitTargetFromPayload(payload);
  if (commit.isCommit) return { class: "commit", commitRepoRoot: commit.repoRoot };
  if (resolvePrTargetFromPayload(payload).isPr) return { class: "pr-create", commitRepoRoot: null };
  if (announcesGateReceipt(command) || runsGateOutcome(command)) return { class: "gate-receipt", commitRepoRoot: null };
  return { class: "other", commitRepoRoot: null };
}

/** A Skill call's `skill`: a toolkit skill's name, else `other`. */
export function skillClass(name: unknown): string {
  return typeof name === "string" && name.startsWith("dev-process-toolkit:") ? name : "other";
}

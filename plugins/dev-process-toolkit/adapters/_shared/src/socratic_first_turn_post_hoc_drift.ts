// socratic_first_turn_post_hoc_drift (STE-251 AC-STE-251.3) —
// /gate-check probe. Severity: error.
//
// Scans the latest commit on the active branch. When the commit subject
// matches the canonical /spec-write commit-shape patterns
// (`chore(specs): write FR <tracker-id>` OR
// `docs(specs): edit cross-cutting specs`) AND the body contains NEITHER
// an audit-row marker (`spec_write_draft_default_applied` /
// `spec_write_commit_default_applied`) NOR a refusal NFR-10 block
// (`Verdict: ... Refused` shape), surface
// `socratic_first_turn_post_hoc_drift_violation` and hard-fail the gate.
//
// Closes the F2 silent-commit path captured by /conformance-loop iter-1
// (commit `9b75b4b`, 2026-05-08): under `claude -p` non-tty stdin the
// model can fire AskUserQuestion (so first-turn passes), see "dismissed"
// responses, self-rationalize "picked safe defaults", and land a real
// commit + tracker writes without operator consent. The legitimate paths
// always leave one of the two markers in the body — the audit row when
// default-apply is exercised, or the refusal NFR-10 block when the
// operator was surfaced the failure. A commit on this subject pattern
// with neither marker is the bypass shape and the probe fails it.
//
// Vacuous on commits that don't match the canonical /spec-write subject
// patterns — the probe is targeted, not blanket. Vacuous when no commits
// are reachable (fresh repo) or git is not present.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Severity = "error" | "warning";

export interface PostHocDriftViolation {
  /** Capability key emitted in the closing summary. */
  capability: "socratic_first_turn_post_hoc_drift_violation";
  /** The commit hash (short) that triggered the violation. */
  commit: string;
  /** The full first-line subject of the offending commit. */
  subject: string;
  /** NFR-10 canonical message (Verdict / Remedy / Context). */
  message: string;
  /** `<commit-hash>:<line>` shape so the operator can `git show` it. */
  note: string;
  severity: Severity;
}

export interface PostHocDriftReport {
  violations: PostHocDriftViolation[];
}

/**
 * Subject regexes — the canonical /spec-write commit shapes that mark a
 * commit as in scope for the probe. Both are anchored to the start of
 * the subject line so a commit with these tokens mid-subject (e.g., a
 * revert that quotes the original) does not falsely activate.
 */
const SUBJECT_PATTERNS: ReadonlyArray<RegExp> = [
  /^chore\(specs\): write FR\b/,
  /^docs\(specs\): edit cross-cutting specs\b/,
];

/** Literal capability keys written into legitimate /spec-write commit bodies. */
const AUDIT_ROW_MARKERS: ReadonlyArray<string> = [
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
];

/**
 * Matches a Verdict-shaped NFR-10 line that ends with "Refused" anywhere on
 * the same line. Case-insensitive on "Refused" so the body can quote either
 * the canonical refusal-class wording or the verb form.
 */
const REFUSAL_BLOCK_REGEX = /Verdict:[^\n]*\brefused\b/i;

/**
 * Pure inspector — walks the (subject, body) pair and decides whether the
 * commit triggers the probe. Exported so unit tests can fixture commit
 * messages without touching git. When `out-of-scope`, the probe is vacuous
 * (no fire). When `legitimate`, the body carries one of the documented
 * markers and the commit passes. When `violation`, the subject matches the
 * scope but the body is missing every legitimacy marker.
 */
export function inspectCommit(
  subject: string,
  body: string,
): "out-of-scope" | "legitimate" | "violation" {
  const inScope = SUBJECT_PATTERNS.some((re) => re.test(subject));
  if (!inScope) return "out-of-scope";
  for (const marker of AUDIT_ROW_MARKERS) {
    if (body.includes(marker)) return "legitimate";
  }
  if (REFUSAL_BLOCK_REGEX.test(body)) return "legitimate";
  return "violation";
}

function buildMessage(commit: string, subject: string): string {
  return [
    `socratic_first_turn_post_hoc_drift_violation: ${commit}:1 — commit ` +
      `subject matches the canonical /spec-write shape ("${subject}") but the ` +
      `body carries NEITHER an audit-row marker (\`spec_write_draft_default_applied\` ` +
      `/ \`spec_write_commit_default_applied\`) NOR a refusal NFR-10 block ` +
      `(\`Verdict: ... Refused\` shape). This is the F2 silent-commit shape: ` +
      `under \`claude -p\` non-tty stdin the model self-rationalized "safe ` +
      `defaults" and committed without operator consent.`,
    `Remedy: re-run /spec-write interactively (tty) to capture explicit ` +
      `operator answers, OR re-invoke with the documented pre-bake CLI flag ` +
      `(\`--tracker=<mode>\` and friends) so the requireOrRefuse(...) helper ` +
      `at adapters/_shared/src/requires_input.ts records the audit row. If ` +
      `the original commit was legitimate but missing markers, amend the body ` +
      `to include the matching capability row before merging. Full contract: ` +
      `\`docs/auto-mode-protocol.md § Socratic Loop Contract\`.`,
    `Context: commit=${commit}, probe=socratic_first_turn_post_hoc_drift, severity=error`,
  ].join("\n");
}

function readLatestCommit(
  projectRoot: string,
): { hash: string; subject: string; body: string } | null {
  const gitDir = join(projectRoot, ".git");
  if (!existsSync(gitDir)) return null;
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["-C", projectRoot, "log", "-1", "--format=%H%n%s%n%b"],
      { encoding: "utf-8" },
    );
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  const hash = (lines[0] ?? "").trim();
  if (!hash) return null;
  const subject = lines[1] ?? "";
  const body = lines.slice(2).join("\n");
  return { hash: hash.slice(0, 12), subject, body };
}

/**
 * Run the post-hoc-drift probe against `projectRoot`. Vacuous when no git
 * directory is present or no commits are reachable; otherwise inspects the
 * latest commit's subject + body and returns a violation row when the
 * canonical /spec-write subject ships without either legitimacy marker.
 */
export async function runSocraticFirstTurnPostHocDriftProbe(
  projectRoot: string,
): Promise<PostHocDriftReport> {
  const head = readLatestCommit(projectRoot);
  if (head === null) return { violations: [] };
  const verdict = inspectCommit(head.subject, head.body);
  if (verdict !== "violation") return { violations: [] };
  const message = buildMessage(head.hash, head.subject);
  const violation: PostHocDriftViolation = {
    capability: "socratic_first_turn_post_hoc_drift_violation",
    commit: head.hash,
    subject: head.subject,
    message,
    note: `${head.hash}:1 — /spec-write commit shape with no legitimacy marker (audit row or refusal block)`,
    severity: "error",
  };
  return { violations: [violation] };
}

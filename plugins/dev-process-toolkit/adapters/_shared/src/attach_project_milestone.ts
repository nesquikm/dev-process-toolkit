// attach_project_milestone — STE-118 AC-STE-118.3.
//
// Binds a tracker ticket to a project milestone matching the local plan-file
// heading. Idempotent: re-running on an already-bound ticket replays steps
// 1+4 without side effects (Linear `save_issue` with the same milestone is
// a no-op when the binding matches).
//
// Verify round-trip: after the attach call, `getIssue` is called to confirm
// `projectMilestone.name` byte-equals the requested name. Mismatch → raise
// `MilestoneAttachmentError` (NFR-10 canonical shape) — closes the silent
// no-op trap (FR-67 pattern: Linear MCP echoes success but the binding
// silently dropped if param names drift).
//
// Match-by-name is intentional: the local plan-file heading is the source
// of truth (no reverse dependency on tracker-assigned IDs). Trade-off: two
// milestones sharing a name attach to the first match — operator error
// boundary (deduped at plan-file heading authorship time).

import { readFileSync } from "node:fs";

export class MilestoneAttachmentError extends Error {
  readonly expected: string;
  readonly actual: string | null;

  constructor(expected: string, actual: string | null) {
    super(
      `MilestoneAttachmentError: ticket binding mismatch — expected milestone "${expected}", got ${actual ? `"${actual}"` : "null"}.\n` +
        `Remedy: re-fetch the ticket via mcp__linear__get_issue and confirm the projectMilestone.name field; if Linear silently dropped the param, verify the adapter is forwarding \`milestone:\` as a string (not an ID) to mcp__linear__save_issue. Re-run /implement Phase 1 to retry.\n` +
        `Context: expected="${expected}", actual=${actual ? `"${actual}"` : "null"}, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneAttachmentError";
    this.expected = expected;
    this.actual = actual;
  }
}

export interface MilestoneOps {
  listMilestones(project: string): Promise<{ name: string }[]>;
  saveMilestone(project: string, opts: { name: string }): Promise<void>;
  upsertTicketMetadata(ticketId: string, meta: { milestone?: string }): Promise<string>;
  getIssue(ticketId: string): Promise<{ projectMilestone?: { name: string } | null }>;
}

export async function attachProjectMilestone(
  provider: MilestoneOps,
  project: string,
  milestoneName: string,
  ticketId: string,
): Promise<void> {
  const existing = await provider.listMilestones(project);
  const found = existing.find((m) => m.name === milestoneName);
  if (!found) {
    await provider.saveMilestone(project, { name: milestoneName });
  }
  await provider.upsertTicketMetadata(ticketId, { milestone: milestoneName });
  const fresh = await provider.getIssue(ticketId);
  const actual = fresh.projectMilestone?.name ?? null;
  if (actual !== milestoneName) {
    throw new MilestoneAttachmentError(milestoneName, actual);
  }
}

const PLAN_HEADING_REGEX = /^# (M\d+ — .+?)(?:\s*\{#M\d+\})?\s*$/m;

/**
 * Build the canonical milestone name from a plan-file path. Reads the H1
 * heading and strips the optional `{#M<N>}` anchor (per AC-STE-118.2).
 *
 * Throws if the file cannot be read or the heading is missing — callers
 * should treat absence as a hard error (the plan file is the source of
 * truth and should always have a recognizable heading).
 */
export function planFileHeadingToMilestoneName(planFilePath: string): string {
  const md = readFileSync(planFilePath, "utf-8");
  const m = md.match(PLAN_HEADING_REGEX);
  if (!m) {
    throw new Error(
      `planFileHeadingToMilestoneName: ${planFilePath} has no recognizable H1 heading (expected \`# M<N> — <title>\`)`,
    );
  }
  return m[1]!.trim();
}

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
import { parsePlanHeading } from "./plan_heading";

export class MilestoneAttachmentError extends Error {
  readonly expected: string;
  readonly actual: string | null;
  readonly binding: "object" | "label";

  // STE-329: the remedy is binding-aware — the `object` (Linear) path and the
  // `label` (Jira) path land at different MCP calls, so a single hardcoded
  // Linear remedy would misdirect a Jira operator hitting the label-verify trap.
  constructor(expected: string, actual: string | null, binding: "object" | "label" = "object") {
    const noun = binding === "label" ? "label" : "milestone";
    const remedy =
      binding === "label"
        ? `re-fetch the ticket via the tracker's get-issue call (e.g. mcp__atlassian__getJiraIssue) and confirm the \`labels\` array contains "${expected}"; if the label silently dropped, verify the attach wrote the read-merge-write union to editJiraIssue.additional_fields.labels (there is no top-level \`labels\` param). Re-run /implement Phase 1 to retry.`
        : `re-fetch the ticket via mcp__linear__get_issue and confirm the projectMilestone.name field; if Linear silently dropped the param, verify the adapter is forwarding \`milestone:\` as a string (not an ID) to mcp__linear__save_issue. Re-run /implement Phase 1 to retry.`;
    super(
      `MilestoneAttachmentError: ticket binding mismatch — expected ${noun} "${expected}", got ${actual ? `"${actual}"` : "null"}.\n` +
        `Remedy: ${remedy}\n` +
        `Context: expected="${expected}", actual=${actual ? `"${actual}"` : "null"}, binding=${binding}, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneAttachmentError";
    this.expected = expected;
    this.actual = actual;
    this.binding = binding;
  }
}

export interface MilestoneOps {
  listMilestones(project: string): Promise<{ name: string }[]>;
  saveMilestone(project: string, opts: { name: string }): Promise<void>;
  upsertTicketMetadata(ticketId: string, meta: { milestone?: string }): Promise<string>;
  getIssue(
    ticketId: string,
  ): Promise<{ projectMilestone?: { name: string } | null; labels?: string[] }>;
  /**
   * STE-329 AC-STE-329.3 — milestone-binding strategy. Linear binds a
   * projectMilestone OBJECT (`"object"`, the default when absent). Jira
   * tenants without milestone objects mirror the milestone M-token onto the
   * issue as a `milestone-<M-token>` label instead (`"label"`). The label
   * branch is create-on-write — it never enumerates or creates a milestone
   * object — so it skips listMilestones / saveMilestone / upsertTicketMetadata.
   */
  milestoneBinding?: "object" | "label";
  /**
   * STE-329 AC-STE-329.3 — read-merge-write label attach. Required only when
   * `milestoneBinding === "label"`. Implementations union the requested label
   * into the issue's current label set (never clobbering existing labels) and
   * are idempotent: re-adding an already-present label is a no-op.
   */
  addLabel?: (ticketId: string, label: string) => Promise<void>;
  /**
   * STE-198 AC-STE-198.1/.3 — capability probe. Adapters that lack
   * project-milestone support (Jira tenants with the feature off, custom
   * adapters without the capability) return `false` for `"project_milestone"`
   * so the helper short-circuits before any list/save call. When omitted
   * the helper defaults to `true` (existing call sites remain
   * source-compatible — Linear's adapter has always supported milestones).
   */
  supports?: (capability: string) => boolean;
}

/**
 * STE-198 AC-STE-198.2 — capability outcome of an attach attempt.
 *
 * - `null` ⇒ attach succeeded against an existing milestone (no row to
 *   surface in the closing summary).
 * - `"milestone_create_required"` ⇒ the project's `list_milestones`
 *   returned no entry matching the canonical name; the helper created
 *   one and bound the ticket. `createdName` carries the new milestone
 *   name so the summary row can render it.
 * - `"milestone_attach_skipped_adapter_limit"` ⇒ the adapter declared
 *   `supports("project_milestone") === false`; the helper short-circuits
 *   without any list/save/upsert calls.
 */
export type AttachProjectMilestoneCapability =
  | null
  | "milestone_create_required"
  | "milestone_attach_skipped_adapter_limit";

export interface AttachProjectMilestoneResult {
  capability: AttachProjectMilestoneCapability;
  createdName?: string;
}

/**
 * STE-362 AC-STE-362.1 — canonical transient-retry backoff schedule, shared
 * with the `upsertTicketMetadata` idempotency-retry shape (adapters/jira.md:
 * fast path first, then three backoff attempts waiting 1s / 2s / 4s;
 * cumulative ~7s on the failure path only). One exported constant — no
 * duplicated schedule.
 */
export const TRANSIENT_RETRY_SCHEDULE_MS: readonly number[] = [1000, 2000, 4000];

export interface AttachProjectMilestoneOptions {
  /** Injected wait for the backoff schedule (tests pass a recorder). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STE-362 AC-STE-362.1 — transient-only retry around one attach +
 * read-back-verify round-trip. The fast-path attempt runs with no wait; a
 * transient/network failure (Gateway-Timeout / 504 / connection reset /
 * equivalent) retries the WHOLE round-trip on the canonical `1s + 2s + 4s`
 * schedule. A `MilestoneAttachmentError` (binding mismatch — the write landed
 * but the read-back disagrees) is non-transient and NEVER retries: retrying a
 * mismatch would mask a real config bug (e.g., forwarding a milestone ID
 * instead of a name). The success path adds no latency (sleep fires only
 * after a caught transient error).
 */
async function retryTransient<T>(
  roundTrip: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let backoffIndex = 0;
  for (;;) {
    try {
      return await roundTrip();
    } catch (err) {
      if (err instanceof MilestoneAttachmentError) throw err; // non-transient
      if (backoffIndex >= TRANSIENT_RETRY_SCHEDULE_MS.length) throw err; // exhausted
      await sleep(TRANSIENT_RETRY_SCHEDULE_MS[backoffIndex]!);
      backoffIndex += 1;
    }
  }
}

export async function attachProjectMilestone(
  provider: MilestoneOps,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: AttachProjectMilestoneOptions,
): Promise<AttachProjectMilestoneResult> {
  const sleep = opts?.sleep ?? defaultSleep;

  // STE-198 AC-STE-198.1 (b): adapter declares no project_milestone capability.
  // Short-circuits BEFORE the retry wrapper — no backoff leg, no tracker call
  // (AC-STE-362.4 vacuity).
  if (provider.supports && !provider.supports("project_milestone")) {
    return { capability: "milestone_attach_skipped_adapter_limit" };
  }

  // STE-329 AC-STE-329.3 — `label` binding (Jira create-on-write). Mirror the
  // milestone M-token onto the issue as a `milestone-<M-token>` label via a
  // read-merge-write `addLabel` (union, idempotent). Never enumerates or
  // creates a milestone object — listMilestones / saveMilestone /
  // upsertTicketMetadata are not called on this branch.
  if (provider.milestoneBinding === "label") {
    if (!provider.addLabel) {
      throw new Error(
        "attachProjectMilestone: milestoneBinding === \"label\" requires an addLabel op on the provider",
      );
    }
    const addLabel = provider.addLabel;
    const label = milestoneLabel(milestoneName);
    // STE-362 AC-STE-362.1: the attach + read-back-verify round-trip retries
    // as a whole on a transient failure (the write may not have landed — a
    // bare re-read is not enough).
    return retryTransient(async () => {
      await addLabel(ticketId, label);
      const fresh = await provider.getIssue(ticketId);
      const labels = fresh.labels ?? [];
      if (!labels.includes(label)) {
        throw new MilestoneAttachmentError(label, null, "label");
      }
      return { capability: null };
    }, sleep);
  }

  const existing = await provider.listMilestones(project);
  const found = existing.find((m) => m.name === milestoneName);
  let createdName: string | undefined;
  if (!found) {
    // STE-198 AC-STE-198.1 (a) / AC-STE-198.3: auto-create branch.
    await provider.saveMilestone(project, { name: milestoneName });
    createdName = milestoneName;
  }
  // STE-362 AC-STE-362.1: attach + read-back-verify retried as one unit on
  // transient failure; a MilestoneAttachmentError inside surfaces immediately.
  await retryTransient(async () => {
    await provider.upsertTicketMetadata(ticketId, { milestone: milestoneName });
    const fresh = await provider.getIssue(ticketId);
    const actual = fresh.projectMilestone?.name ?? null;
    if (actual !== milestoneName) {
      throw new MilestoneAttachmentError(milestoneName, actual);
    }
  }, sleep);
  if (createdName !== undefined) {
    return { capability: "milestone_create_required", createdName };
  }
  return { capability: null };
}

/**
 * STE-329 AC-STE-329.2 — derive the Jira milestone label from a canonical
 * milestone name. Returns `milestone-<M-token>` where `<M-token>` is the
 * leading `M\d+` of the canonical name (e.g. `M86 — Jira Project-Milestone
 * Support` → `milestone-M86`). The label is `[A-Za-z0-9-]` only — Jira labels
 * forbid spaces, so the descriptive title must not leak in.
 *
 * Throws if the canonical name has no leading `M\d+` token (no silent empty
 * label).
 */
export function milestoneLabel(canonicalName: string): string {
  const m = canonicalName.match(/^(M\d+)/);
  if (!m) {
    throw new Error(
      `milestoneLabel: "${canonicalName}" has no leading M-token (expected a canonical name beginning with \`M<N>\`)`,
    );
  }
  return `milestone-${m[1]!}`;
}

/**
 * M97 (STE-363 + STE-364) — normalize an adapter's milestone-binding
 * strategy. `object` (Linear) is the default when the provider declares
 * none; `label` (Jira) must be declared explicitly.
 */
export function resolveMilestoneBinding(provider: MilestoneOps): "object" | "label" {
  return provider.milestoneBinding === "label" ? "label" : "object";
}

/**
 * M97 (STE-363 + STE-364) — shared present/missing predicate for a ticket's
 * milestone binding. The archival-boundary assertion and the backfill sweep
 * both classify through this one function so the two surfaces cannot drift:
 * `object` (Linear, default) ⇒ `projectMilestone.name` byte-equals the
 * canonical plan-heading name; `label` (Jira) ⇒ `labels` contains
 * `milestone-<M-token>` (milestoneLabel).
 */
export function milestoneBindingPresent(
  issue: { projectMilestone?: { name: string } | null; labels?: string[] },
  canonical: string,
  binding: "object" | "label",
): boolean {
  return binding === "label"
    ? (issue.labels ?? []).includes(milestoneLabel(canonical))
    : (issue.projectMilestone?.name ?? null) === canonical;
}

/**
 * Build the canonical milestone name from a plan-file path. Delegates to the
 * shared `parsePlanHeading` (./plan_heading) so it accepts both the current
 * `## M<N>: <title> {#M<N>}` (H2 + colon) form and the legacy
 * `# M<N> — <title>` (H1 + em-dash) form, normalizing either to the canonical
 * `M<N> — <title>` (em-dash) and stripping the optional `{#M<N>}` anchor.
 *
 * Throws if the file cannot be read or no milestone heading is present —
 * callers should treat absence as a hard error (the plan file is the source
 * of truth and should always have a recognizable heading).
 */
export function planFileHeadingToMilestoneName(planFilePath: string): string {
  const md = readFileSync(planFilePath, "utf-8");
  const name = parsePlanHeading(md);
  if (name === null) {
    throw new Error(
      `planFileHeadingToMilestoneName: ${planFilePath} has no recognizable milestone heading ` +
        `(expected \`# M<N> — <title>\` or \`## M<N>: <title>\` — H1/H2 depth, em-dash or colon separator)`,
    );
  }
  return name;
}

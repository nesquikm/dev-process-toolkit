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
import { isMilestoneToken } from "./milestone_token";
import { parsePlanHeading } from "./plan_heading";

export class MilestoneAttachmentError extends Error {
  readonly expected: string;
  readonly actual: string | null;
  readonly binding: "object" | "label" | "epic";

  // STE-329: the remedy is binding-aware — the `object` (Linear) path and the
  // `label` (Jira) path land at different MCP calls, so a single hardcoded
  // Linear remedy would misdirect a Jira operator hitting the label-verify trap.
  // STE-375 adds the `epic` binding (parent-Epic key verify).
  constructor(
    expected: string,
    actual: string | null,
    binding: "object" | "label" | "epic" = "object",
  ) {
    const noun = binding === "label" ? "label" : binding === "epic" ? "parent Epic" : "milestone";
    const remedy =
      binding === "label"
        ? `re-fetch the ticket via the tracker's get-issue call (e.g. mcp__atlassian__getJiraIssue) and confirm the \`labels\` array contains "${expected}"; if the label silently dropped, verify the attach wrote the read-merge-write union to editJiraIssue.additional_fields.labels (there is no top-level \`labels\` param). Re-run /implement Phase 1 to retry.`
        : binding === "epic"
          ? `re-fetch the ticket via the tracker's get-issue call (e.g. mcp__atlassian__getJiraIssue) and confirm the \`parent\` field is the Epic key "${expected}"; if the parent silently dropped, verify the attach wrote the Epic key to the issue's parent field. Re-run /implement Phase 1 to retry.`
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

/**
 * Read-back projection of a ticket consumed by the verify legs: the Linear
 * milestone object (`object` binding), the Jira milestone labels (`label`
 * binding), and — STE-375 — the ticket's current parent Epic key (`epic`
 * binding).
 */
export interface TicketMilestoneView {
  projectMilestone?: { name: string } | null;
  labels?: string[];
  parent?: string | null;
}

export interface MilestoneOps {
  listMilestones(project: string): Promise<{ name: string }[]>;
  saveMilestone(project: string, opts: { name: string }): Promise<void>;
  upsertTicketMetadata(ticketId: string, meta: { milestone?: string }): Promise<string>;
  getIssue(ticketId: string): Promise<TicketMilestoneView>;
  /**
   * STE-329 AC-STE-329.3 — milestone-binding strategy. Linear binds a
   * projectMilestone OBJECT (`"object"`, the default when absent). Jira
   * tenants without milestone objects mirror the milestone M-token onto the
   * issue as a `milestone-<M-token>` label instead (`"label"`). The label
   * branch is create-on-write — it never enumerates or creates a milestone
   * object — so it skips listMilestones / saveMilestone / upsertTicketMetadata.
   *
   * STE-375 AC-STE-375.1 — `"epic"` binds the milestone as an Epic issue:
   * find-or-create the Epic matched by the canonical name, then set the FR
   * Task's `parent` to the Epic's key. Never scatters a `milestone-M<N>`
   * label and never calls the object-path ops.
   */
  milestoneBinding?: "object" | "label" | "epic";
  /**
   * STE-375 AC-STE-375.1 — epic-binding ops. Required only when
   * `milestoneBinding === "epic"`. `listEpics` enumerates the project's
   * Epics (key + name) for the byte-equality name match; `createEpic`
   * creates the milestone Epic on a miss; `setParent` points the FR Task's
   * parent at the Epic's key.
   */
  listEpics?: (project: string) => Promise<{ key: string; name: string }[]>;
  createEpic?: (project: string, opts: { name: string }) => Promise<{ key: string }>;
  setParent?: (ticketId: string, epicKey: string) => Promise<void>;
  /**
   * STE-329 AC-STE-329.3 — read-merge-write label attach. Required only when
   * `milestoneBinding === "label"`. Implementations union the requested label
   * into the issue's current label set (never clobbering existing labels) and
   * are idempotent: re-adding an already-present label is a no-op.
   */
  addLabel?: (ticketId: string, label: string) => Promise<void>;
  /**
   * STE-375 AC-STE-375.4 — optional epic-availability probe: the injected
   * seam over `getJiraProjectIssueTypesMetadata` + the parent-settability
   * check. `false` ⇒ the `epic` binding degrades to the `label` binding and
   * the attach surfaces `milestone_epic_unsupported` (informational
   * capability row — never a throw). Absent ⇒ assume available (same
   * posture as the optional `supports` probe).
   */
  epicBindingAvailable?: (project: string) => Promise<boolean>;
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
 * - `"milestone_epic_unsupported"` (STE-375 AC-STE-375.4) ⇒ the `epic`
 *   binding's availability probe returned `false` (project issue-type
 *   metadata lacks Epic / parent unsettable); the attach degraded to the
 *   legacy `label` binding and still landed via the label path.
 */
export type AttachProjectMilestoneCapability =
  | null
  | "milestone_create_required"
  | "milestone_attach_skipped_adapter_limit"
  | "milestone_epic_unsupported";

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
 * failure retries the WHOLE round-trip on the canonical `1s + 2s + 4s`
 * schedule. Classification is **by exclusion**: only `MilestoneAttachmentError`
 * (binding mismatch — the write landed but the read-back disagrees) is
 * known-permanent and NEVER retries (retrying a mismatch would mask a real
 * config bug, e.g. forwarding a milestone ID instead of a name). Every other
 * throw — Gateway-Timeout / 504 / connection reset, but also e.g. a 401 — is
 * treated as possibly-transient and retried; MCP error shapes are too varied
 * for a reliable positive network-class match (same trade-off as the
 * `upsertTicketMetadata` idempotency retry), at the cost of ~7s extra latency
 * before a genuinely permanent non-mismatch error surfaces. The success path
 * adds no latency (sleep fires only after a caught error).
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

/**
 * STE-362 AC-STE-362.1 — one write + read-back-verify round-trip, retried as
 * a whole on transient failure (the write may not have landed — a bare
 * re-read is not enough). `read` projects the fresh ticket to the
 * binding-specific value that must byte-equal `expected`; a mismatch throws
 * MilestoneAttachmentError (known-permanent — surfaces immediately, never
 * retried). Shared by all three binding paths: `object`
 * (projectMilestone.name), `label` (labels union), `epic` (parent key).
 */
function writeAndVerify(
  provider: MilestoneOps,
  ticketId: string,
  sleep: (ms: number) => Promise<void>,
  round: {
    write: () => Promise<void>;
    expected: string;
    read: (fresh: TicketMilestoneView) => string | null;
    binding: "object" | "label" | "epic";
  },
): Promise<void> {
  return retryTransient(async () => {
    await round.write();
    const fresh = await provider.getIssue(ticketId);
    const actual = round.read(fresh);
    if (actual !== round.expected) {
      throw new MilestoneAttachmentError(round.expected, actual, round.binding);
    }
  }, sleep);
}

/**
 * STE-329 AC-STE-329.3 — `label` binding attach (Jira create-on-write).
 * Mirrors the milestone M-token onto the issue as a `milestone-<M-token>`
 * label via a read-merge-write `addLabel` (union, idempotent), then
 * read-back verifies. Shared by the declared `label` binding (`capability:
 * null` on success) and the `epic` binding's Epic-absent fallback
 * (STE-375 AC-STE-375.4 — `capability: "milestone_epic_unsupported"`).
 */
async function attachViaMilestoneLabel(
  provider: MilestoneOps,
  milestoneName: string,
  ticketId: string,
  sleep: (ms: number) => Promise<void>,
  capability: AttachProjectMilestoneCapability,
): Promise<AttachProjectMilestoneResult> {
  if (!provider.addLabel) {
    throw new Error(
      'attachProjectMilestone: the label milestone binding requires an addLabel op on the provider',
    );
  }
  const addLabel = provider.addLabel;
  const label = milestoneLabel(milestoneName);
  await writeAndVerify(provider, ticketId, sleep, {
    write: () => addLabel(ticketId, label),
    expected: label,
    // Presence projected to label-or-null so a mismatch reports actual=null
    // (the label is missing from the set, not "wrong").
    read: (fresh) => ((fresh.labels ?? []).includes(label) ? label : null),
    binding: "label",
  });
  return { capability };
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

  // STE-375 AC-STE-375.1 — `epic` binding (Jira milestone-as-Epic). Find or
  // create the milestone Epic matched by the canonical plan-heading name
  // (byte equality, STE-118 discipline), then set the FR Task's `parent` to
  // the Epic's key. Never scatters a `milestone-M<N>` label and never calls
  // the object-path ops (listMilestones / saveMilestone / upsertTicketMetadata).
  if (provider.milestoneBinding === "epic") {
    // STE-375 AC-STE-375.4 — Epic-absent fallback. The optional
    // `epicBindingAvailable` probe (injected seam over
    // `getJiraProjectIssueTypesMetadata` + the parent-settability check)
    // returning `false` degrades the binding to the legacy `label` path and
    // surfaces `milestone_epic_unsupported` as an INFORMATIONAL capability
    // row — never a throw. The probe runs before the epic-ops guard: a
    // degraded provider needs only `addLabel`. Probe absent ⇒ assume
    // available (same posture as the optional `supports` probe).
    if (provider.epicBindingAvailable && !(await provider.epicBindingAvailable(project))) {
      return attachViaMilestoneLabel(
        provider,
        milestoneName,
        ticketId,
        sleep,
        "milestone_epic_unsupported",
      );
    }
    const { listEpics, createEpic, setParent } = provider;
    if (!listEpics || !createEpic || !setParent) {
      throw new Error(
        'attachProjectMilestone: milestoneBinding === "epic" requires listEpics/createEpic/setParent ops on the provider',
      );
    }
    // STE-375 AC-STE-375.5 — the find-or-create leg retries as ONE unit on
    // transient failure (STE-362 canonical schedule). Each retry re-runs the
    // FIND leg first: a createEpic that landed server-side but timed out on
    // the response is found by name on the retry and reused — a blind
    // re-create would mint a duplicate Epic.
    const findOrCreate = await retryTransient(async () => {
      const epics = await listEpics(project);
      const found = epics.find((e) => e.name === milestoneName);
      if (found) {
        // STE-375 AC-STE-375.2 — idempotency pre-check: when the ticket's
        // `parent` already equals the milestone Epic's key, the attach is a
        // no-op — the parent is not rewritten and no second Epic is created.
        const current = await provider.getIssue(ticketId);
        return {
          epicKey: found.key,
          createdName: undefined as string | undefined,
          alreadyBound: (current.parent ?? null) === found.key,
        };
      }
      const created = await createEpic(project, { name: milestoneName });
      return { epicKey: created.key, createdName: milestoneName, alreadyBound: false };
    }, sleep);
    if (findOrCreate.alreadyBound) {
      return { capability: null };
    }
    const { epicKey, createdName } = findOrCreate;
    // Parent set + read-back verify (epic binding — the parent key must
    // byte-equal the milestone Epic's key).
    await writeAndVerify(provider, ticketId, sleep, {
      write: () => setParent(ticketId, epicKey),
      expected: epicKey,
      read: (fresh) => fresh.parent ?? null,
      binding: "epic",
    });
    if (createdName !== undefined) {
      return { capability: "milestone_create_required", createdName };
    }
    return { capability: null };
  }

  // STE-329 AC-STE-329.3 — `label` binding (Jira create-on-write). Mirror the
  // milestone M-token onto the issue as a `milestone-<M-token>` label via a
  // read-merge-write `addLabel` (union, idempotent). Never enumerates or
  // creates a milestone object — listMilestones / saveMilestone /
  // upsertTicketMetadata are not called on this branch.
  if (provider.milestoneBinding === "label") {
    return attachViaMilestoneLabel(provider, milestoneName, ticketId, sleep, null);
  }

  const existing = await provider.listMilestones(project);
  const found = existing.find((m) => m.name === milestoneName);
  let createdName: string | undefined;
  if (!found) {
    // STE-198 AC-STE-198.1 (a) / AC-STE-198.3: auto-create branch.
    await provider.saveMilestone(project, { name: milestoneName });
    createdName = milestoneName;
  }
  // Attach + read-back verify (object binding — the projectMilestone name
  // must byte-equal the canonical plan-heading name).
  await writeAndVerify(provider, ticketId, sleep, {
    write: async () => {
      await provider.upsertTicketMetadata(ticketId, { milestone: milestoneName });
    },
    expected: milestoneName,
    read: (fresh) => fresh.projectMilestone?.name ?? null,
    binding: "object",
  });
  if (createdName !== undefined) {
    return { capability: "milestone_create_required", createdName };
  }
  return { capability: null };
}

/**
 * STE-329 AC-STE-329.2 (+ STE-376 AC-STE-376.1) — derive the Jira milestone
 * label from a canonical milestone name. Returns `milestone-<M-token>` where
 * `<M-token>` is the leading milestone token of the canonical name under the
 * shared union grammar (`milestone_token`): `M86 — Jira Project-Milestone
 * Support` → `milestone-M86`, `M_PROJ_500 — Epic-keyed milestone` →
 * `milestone-M_PROJ_500`. The label is `[A-Za-z0-9_-]` only — Jira labels
 * forbid spaces, so the descriptive title must not leak in.
 *
 * Throws if the canonical name has no leading milestone token (no silent
 * empty label).
 */
export function milestoneLabel(canonicalName: string): string {
  const token = canonicalName.split(/\s/, 1)[0] ?? "";
  if (!isMilestoneToken(token)) {
    throw new Error(
      `milestoneLabel: "${canonicalName}" has no leading M-token (expected a canonical name beginning with \`M<N>\` or \`M_<epic-key>\`)`,
    );
  }
  return `milestone-${token}`;
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

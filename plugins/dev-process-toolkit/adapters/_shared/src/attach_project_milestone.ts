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
// The join is TOKEN-shaped rather than binding-shaped: since STE-540 the
// `object` (Linear) branch routes on the leading milestone token's kind just
// as STE-523's `epic` branch does, so a binding no longer picks a regime on
// its own. The two regimes are deliberate:
//
//   - Match-by-NAME — a grandfathered NUMERIC `M<N>` token, plus the whole
//     `label` (Jira legacy) binding. Under `object` that is the shipped
//     list/create/attach-by-name path; under `epic` STE-523 routes it onto
//     the milestone LABEL surface instead (the reader has always looked for
//     it there). The local plan-file heading is the source of truth (no
//     reverse dependency on tracker-assigned IDs). Trade-off: two milestones
//     sharing a name attach to the first match — operator error boundary
//     (deduped at plan-file heading authorship time).
//   - Match-by-KEY — an OPAQUE `M_<key>` token, on either surface: an
//     Epic-KEYED milestone under the `epic` binding (STE-521, keys sanitized
//     through `milestoneIdFromEpicKey`) and an identifier-KEYED Linear
//     milestone under the `object` binding (STE-540, identifiers sanitized
//     through `milestoneIdFromLinearMilestone`). Here the reverse dependency
//     already exists INSIDE the id: the token was derived from the key the
//     tracker allocated, while the Epic or milestone keeps whatever human
//     title was typed, so the canonical name can never equal it. Each
//     candidate's key is sanitized FORWARD and compared to the token — the
//     same expression `milestoneBindingPresent` applies to the bound ticket,
//     so writer and reader agree by construction instead of by matching
//     strings. A token whose Epic or milestone is not there is a refusal,
//     never a mint (minting would allocate a fresh key that can never
//     sanitize back to the token).

import { readFileSync } from "node:fs";
import {
  isMilestoneToken,
  milestoneIdFromEpicKey,
  milestoneIdFromLinearMilestone,
  parseMilestoneToken,
} from "./milestone_token";
import { parsePlanHeading } from "./plan_heading";

export class MilestoneAttachmentError extends Error {
  readonly expected: string;
  readonly actual: string | null;
  readonly binding: "object" | "label" | "epic" | "milestone-id";
  /**
   * STE-540 — the Linear milestone IDENTIFIER the attach wrote, carried on the
   * `milestone-id` binding so the remedy can name the thing that binds rather
   * than the token derived from it. Absent on every other binding.
   */
  readonly identifier?: string;

  // STE-329: the remedy is binding-aware — the `object` (Linear) path and the
  // `label` (Jira) path land at different MCP calls, so a single hardcoded
  // Linear remedy would misdirect a Jira operator hitting the label-verify trap.
  // STE-375 adds the `epic` binding (parent-Epic key verify).
  // STE-540 adds `milestone-id` (Linear identifier verify) — declared as its
  // OWN arm rather than left to the `object` default, because a new union
  // member that nobody branched on renders the old name remedy and reads like
  // a pass.
  constructor(
    expected: string,
    actual: string | null,
    binding: "object" | "label" | "epic" | "milestone-id" = "object",
    identifier?: string,
  ) {
    const noun =
      binding === "label"
        ? "label"
        : binding === "epic"
          ? "parent Epic"
          : binding === "milestone-id"
            ? "milestone identifier"
            : "milestone";
    const remedy =
      binding === "label"
        ? `re-fetch the ticket via the tracker's get-issue call (e.g. mcp__atlassian__getJiraIssue) and confirm the \`labels\` array contains "${expected}"; if the label silently dropped, verify the attach wrote the read-merge-write union to editJiraIssue.additional_fields.labels (there is no top-level \`labels\` param). Re-run /implement Phase 1 to retry.`
        : binding === "epic"
          ? `re-fetch the ticket via the tracker's get-issue call (e.g. mcp__atlassian__getJiraIssue) and confirm the \`parent\` field is the Epic key "${expected}"; if the parent silently dropped, verify the attach wrote the Epic key to the issue's parent field. Re-run /implement Phase 1 to retry.`
          : binding === "milestone-id"
            ? `re-fetch the ticket via mcp__linear__get_issue and confirm projectMilestone.id is the milestone identifier "${identifier ?? "unknown"}" — the milestone token "${expected}" was derived from it, so the NAME on the milestone is not what binds and renaming it fixes nothing. If Linear silently dropped the param, verify the adapter forwarded \`milestone: "${identifier ?? "unknown"}"\` to mcp__linear__save_issue. Re-run /implement Phase 1 to retry.`
            : // STE-540 — `mcp__linear__save_issue` documents `milestone` as
              // "Milestone name or ID", so BOTH forms are accepted. This
              // binding is the grandfathered numeric `M<N>` arm, which sends
              // the name; the identifier-keyed arm sends the identifier and
              // reports under the `milestone-id` binding above.
              `re-fetch the ticket via mcp__linear__get_issue and confirm the projectMilestone.name field; if Linear silently dropped the param, verify the adapter forwarded \`milestone: "${expected}"\` to mcp__linear__save_issue — the schema takes a "Milestone name or ID", and this binding sends the name. Re-run /implement Phase 1 to retry.`;
    super(
      `MilestoneAttachmentError: ticket binding mismatch — expected ${noun} "${expected}", got ${actual ? `"${actual}"` : "null"}.\n` +
        `Remedy: ${remedy}\n` +
        `Context: expected="${expected}", actual=${actual ? `"${actual}"` : "null"}, binding=${binding}, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneAttachmentError";
    this.expected = expected;
    this.actual = actual;
    this.binding = binding;
    this.identifier = identifier;
  }
}

/**
 * The attach's PERMANENT refusals — the ones no amount of retrying resolves.
 *
 * A refusal to attach is a decision about the state of the world (the Epic the
 * token names is not there; the Epic was never minted; the token parses as
 * neither kind), not a transient the tracker will recover from. Consumers must
 * be able to tell those apart from a network exhaustion or an expired
 * credential, because the operator's next move is opposite: one says "clear
 * the outage and retry", the other says "retrying changes nothing — do what
 * this refusal's own Remedy line says".
 *
 * Declared as ONE base class carrying ONE marker, read through ONE exported
 * predicate (`isMilestonePermanentRefusal`), so a consumer never grows a
 * widening `instanceof A || instanceof B || instanceof C` chain that a FOURTH
 * refusal class silently evades. A new permanent refusal extends this and is
 * classified everywhere by construction.
 *
 * The marker is a PROPERTY rather than the class identity alone so the
 * predicate survives the error crossing a module boundary that resolved a
 * second copy of this file — `instanceof` would quietly answer false there,
 * which is the same silent-evasion failure in another costume.
 */
export abstract class MilestonePermanentRefusalError extends Error {
  /** Marker read by `isMilestonePermanentRefusal`; never set anywhere else. */
  readonly permanentRefusal: true = true;
}

/**
 * True for an attach refusal that repeating the call cannot fix. See
 * `MilestonePermanentRefusalError` for why this is a marker read, not an
 * `instanceof` list.
 */
export function isMilestonePermanentRefusal(
  err: unknown,
): err is MilestonePermanentRefusalError {
  return (
    err instanceof Error && (err as { permanentRefusal?: unknown }).permanentRefusal === true
  );
}

/**
 * STE-521 AC-STE-521.6 / AC-STE-521.7 — an Epic-KEYED milestone whose Epic is
 * not in the project is a REFUSAL, never a mint. The token was derived FROM an
 * Epic that already exists (`GF-78` → `M_GF_78`), so a newly minted Epic gets
 * a fresh key that can never sanitize back to the token — the second Epic is
 * exactly the state `milestoneBindingPresent` will never accept. Raised
 * OUTSIDE `retryTransient` (a plain `Error` inside the wrapper is classified
 * possibly-transient and would pay the full 1s+2s+4s schedule before
 * surfacing).
 *
 * NFR-10 canonical shape: verdict line + `Remedy:` + `Context:`. The message
 * names the milestone token, the Epic key the attach looked for, and the
 * project it searched — the three facts every one of the operator's fixes
 * starts from.
 */
export class MilestoneEpicNotFoundError extends MilestonePermanentRefusalError {
  readonly token: string;
  readonly epicKey: string;
  readonly project: string;

  constructor(token: string, epicKey: string, project: string) {
    super(
      `MilestoneEpicNotFoundError: refusing to attach — no Epic in project "${project}" has a key that sanitizes to the milestone token "${token}" (the attach looked for the Epic key "${epicKey}"). The token was derived from an Epic that already exists, so creating one would mint a SECOND Epic under a key that can never match the token.\n` +
        `Remedy: pick one — (a) confirm the Epic "${epicKey}" still exists and is visible in project "${project}" (restore it if it was archived/deleted, or fix the project the adapter is searching); (b) if the Epic lives in a different project, point the attach at that project; (c) if the Epic is gone for good, re-derive the milestone id from an Epic that does exist (mint the Epic yourself, then re-run /spec-write so the plan heading carries the new \`M_<epic-key>\` token). Never hand-edit the token to a key that has no Epic.\n` +
        `Context: token="${token}", epicKey="${epicKey}", project="${project}", binding=epic, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneEpicNotFoundError";
    this.token = token;
    this.epicKey = epicKey;
    this.project = project;
  }
}

/**
 * STE-522 AC-STE-522.8 — the miss verdict for OUTCOME 4, the pre-key HUMAN
 * TITLE. Binding never creates. Minting a milestone Epic is now its own named,
 * ordered step (`mintMilestoneEpic`, `adapters/_shared/src/mint_milestone_epic.ts`):
 * create with the title alone, read the allocated key back, derive the
 * milestone id from that key, then write the plan file under it. An attach
 * that minted here would run that sequence backwards — the Epic would exist,
 * but no plan heading would have been derived from its key, which is the same
 * non-correspondence STE-521 refused on the Epic-KEYED leg. One rule now
 * covers both: an attach that cannot find its Epic says so.
 *
 * Raised OUTSIDE `retryTransient` (a plain `Error` inside the wrapper is
 * classified possibly-transient and would pay the full 1s+2s+4s schedule
 * before surfacing). A refusal is a decision, not a transient.
 *
 * NFR-10 canonical shape: verdict line + `Remedy:` + `Context:`. The message
 * names the milestone name searched for and the project searched, and it names
 * the step the operator must run first — a refusal whose remedy is "mint it"
 * has to say what mints it.
 */
export class MilestoneEpicUnmintedError extends MilestonePermanentRefusalError {
  readonly milestoneName: string;
  readonly project: string;

  constructor(milestoneName: string, project: string) {
    super(
      `MilestoneEpicUnmintedError: refusing to attach — no Epic in project "${project}" is named "${milestoneName}", and the attach never mints one. Minting a milestone Epic is a separate named step, because its correctness depends on an ORDER the attach cannot supply: the Epic is created with the human title alone, the tracker allocates a key, and the milestone id is derived from that key. An Epic minted here would carry a name no milestone id was ever derived from.\n` +
        `Remedy: mint the Epic first with \`mintMilestoneEpic\` (\`adapters/_shared/src/mint_milestone_epic.ts\`) — it creates the Epic under the human title, returns the allocated key and the \`M_<epic-key>\` milestone id derived from it; write the plan file under that id, then re-run the attach against the canonical \`M_<epic-key> — <Title>\` name. If the Epic already exists, its name and the attached milestone name must byte-match — fix whichever is wrong rather than creating a second Epic.\n` +
        `Context: milestoneName="${milestoneName}", project="${project}", binding=epic, outcome=pre-key-human-title, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneEpicUnmintedError";
    this.milestoneName = milestoneName;
    this.project = project;
  }
}

/**
 * STE-523 AC-STE-523.6 — the THIRD case at the `epic` binding's kind-routing
 * decision. An `epic`-kind token binds by parent Epic and a `numeric`-kind
 * token takes the label path; a leading token that parses to NEITHER has no
 * surface it can correctly be written to. Before this refusal such a token
 * fell through to the epic path, set a parent, and the reader's own `try`
 * swallowed the derivation failure into a plain `false` — a malformed
 * milestone id became a wrong write instead of an error.
 *
 * Raised OUTSIDE `retryTransient` (a plain `Error` inside the wrapper is
 * classified possibly-transient and would pay the full 1s+2s+4s schedule
 * before surfacing). A refusal is a decision, not a transient.
 *
 * NFR-10 canonical shape: verdict line + `Remedy:` + `Context:`. The message
 * names the offending TOKEN — not merely the canonical name it was cut from —
 * so the operator can see which few characters have to change.
 */
export class MilestoneTokenUnparseableError extends MilestonePermanentRefusalError {
  readonly token: string;
  readonly milestoneName: string;
  readonly project: string;

  constructor(token: string, milestoneName: string, project: string) {
    super(
      `MilestoneTokenUnparseableError: refusing to attach — the leading milestone token "${token}" (cut from the canonical name "${milestoneName}") parses as neither a numeric \`M<N>\` milestone nor an Epic-keyed \`M_<epic-key>\` milestone, so the attach cannot decide which surface to bind it on: the parent Epic (Epic-keyed) or the milestone label (numeric).\n` +
        `Remedy: fix the plan-file heading so it begins with a well-formed token — \`M<N>\` (e.g. \`M15\`) for a numeric milestone, or \`M_<epic-key>\` (e.g. \`M_GF_78\`) for an Epic-keyed one — then re-run the attach. Do not hand-bind the ticket: a parent set for an unparseable token is a write the reader never consults.\n` +
        `Context: token="${token}", milestoneName="${milestoneName}", project="${project}", binding=epic, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneTokenUnparseableError";
    this.token = token;
    this.milestoneName = milestoneName;
    this.project = project;
  }
}

/**
 * STE-540 AC-STE-540.5 — the Linear counterpart of `MilestoneEpicNotFoundError`.
 * An identifier-KEYED milestone token (`M_3fa85f`) was derived FROM the
 * identifier the tracker allocated, so a milestone minted on the miss would get
 * a fresh identifier that can never sanitize back to the token — the second
 * milestone is exactly the state `milestoneBindingPresent` will never accept.
 * Binding never creates: a token whose milestone is not in the project is a
 * refusal.
 *
 * Raised OUTSIDE `retryTransient` — a refusal is a decision, not a transient.
 *
 * NFR-10 canonical shape: verdict line + `Remedy:` + `Context:`. The message
 * names the token and the project it searched.
 */
export class MilestoneObjectNotFoundError extends MilestonePermanentRefusalError {
  readonly token: string;
  readonly milestoneName: string;
  readonly project: string;

  constructor(token: string, milestoneName: string, project: string) {
    super(
      `MilestoneObjectNotFoundError: refusing to attach — no milestone in project "${project}" has an identifier that sanitizes to the milestone token "${token}" (cut from the canonical name "${milestoneName}"). The token was derived from a milestone that already exists, so creating one would mint a SECOND milestone under an identifier that can never match the token.\n` +
        `Remedy: pick one — (a) confirm the milestone still exists and is visible in project "${project}" (restore it if it was archived/deleted, or fix the project the adapter is searching); (b) if the milestone lives in a different project, point the attach at that project; (c) if the milestone is gone for good, mint a new one with \`mintMilestoneLinear\` and re-run /spec-write so the plan heading carries the new \`M_<key>\` token. Never hand-edit the token to a key no milestone identifier derives to, and never rename a milestone to fix this — the NAME is not what binds.\n` +
        `Context: token="${token}", milestoneName="${milestoneName}", project="${project}", binding=milestone-id, helper=attachProjectMilestone`,
    );
    this.name = "MilestoneObjectNotFoundError";
    this.token = token;
    this.milestoneName = milestoneName;
    this.project = project;
  }
}

/**
 * Read-back projection of a ticket consumed by the verify legs: the Linear
 * milestone object (`object` binding), the Jira milestone labels (`label`
 * binding), and — STE-375 — the ticket's current parent Epic key (`epic`
 * binding). STE-540 widens the milestone projection with the tracker's own
 * OPTIONAL identifier — the field the `milestone-id` verify re-derives from.
 */
export interface TicketMilestoneView {
  projectMilestone?: { name: string; id?: string } | null;
  labels?: string[];
  parent?: string | null;
}

export interface MilestoneOps {
  /**
   * STE-539 — the identifier is OPTIONAL on the enumerated rows, so no
   * existing provider (or provider double) has to grow one. `mintMilestoneLinear`
   * is the consumer that reads it: its find-before-create leg needs the
   * identifier of a milestone that already carries the human title, and a row
   * that offers none is a refusal there rather than a blind re-create.
   */
  listMilestones(project: string): Promise<{ name: string; id?: string }[]>;
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
   * the FR Task's `parent` is set to the milestone Epic's key. It never calls
   * the object-path ops. The branch is NOT single-outcome — it routes on the
   * canonical name's leading milestone token (see `attachProjectMilestone`),
   * and a provider implementing it must be ready for all FOUR outcomes:
   *
   *   1. Epic-KEYED token (`M_GF_78`, STE-521) — the Epic is matched by KEY
   *      (each candidate's key sanitized forward through
   *      `milestoneIdFromEpicKey`) and the parent set to it. A miss REFUSES
   *      with `MilestoneEpicNotFoundError`; it never mints.
   *   2. NUMERIC token (`M15`, STE-523) — grandfathered. Those milestones
   *      predate Epics and are read off the LABEL surface, so the attach
   *      writes `milestone-M<N>` through `addLabel` and sets NO parent. It is
   *      the one epic-binding outcome that writes a label, and it is what
   *      makes this writer agree with `milestoneBindingPresent`.
   *   3. A name that CLAIMS a token (`<token> — <title>`) whose token parses
   *      as NEITHER kind — REFUSES with `MilestoneTokenUnparseableError`,
   *      writing nothing.
   *   4. A name claiming NO token — a pre-key HUMAN TITLE (STE-377's
   *      Epic-FIRST allocation: the Epic must exist before there is a key to
   *      derive an id from). The Epic is matched by NAME and parented. A miss
   *      REFUSES with `MilestoneEpicUnmintedError` (STE-522); it never mints.
   *      A real supported path, not a fallthrough.
   *
   * Ahead of all four sits the optional `epicBindingAvailable` probe:
   * `false` degrades the whole binding to the `label` path and surfaces
   * `milestone_epic_unsupported`.
   */
  milestoneBinding?: "object" | "label" | "epic";
  /**
   * STE-375 AC-STE-375.1 — epic-binding ops. Required only when
   * `milestoneBinding === "epic"` AND the token routes to the parent surface
   * (outcomes 1 and 4 above): a grandfathered numeric milestone needs only
   * `addLabel`, and both token refusals are raised before the ops guard.
   * `listEpics` enumerates the project's Epics (key + name) for the match —
   * by sanitized KEY for an Epic-keyed token, by byte-equal NAME for a
   * pre-key human title; `setParent` points the FR Task's parent at the
   * Epic's key. `createEpic` is NOT among them: since STE-522 the attach
   * never mints, on either arm. The op stays declared here because
   * `mintMilestoneEpic` — the one production caller — takes a provider
   * carrying it.
   */
  listEpics?: (project: string) => Promise<{ key: string; name: string }[]>;
  createEpic?: (project: string, opts: { name: string }) => Promise<{ key: string }>;
  /**
   * STE-539 AC-STE-539.1 — the Linear counterpart of `createEpic`: it creates
   * a project milestone OBJECT under the human title and returns the
   * identifier the tracker allocated for it. Like `createEpic` it is NOT an
   * attach op — the attach never mints on any binding. It stays declared here
   * because `mintMilestoneLinear` — its one production caller — takes a
   * provider carrying it, and because writer and reader then agree about the
   * op's shape by construction. Property-arrow style, matching its siblings.
   */
  createMilestone?: (project: string, opts: { name: string }) => Promise<{ id: string }>;
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
 *   name so the summary row can render it. Reachable ONLY from the
 *   grandfathered by-NAME arm of the `object` binding — since STE-540 an
 *   identifier-keyed token's miss is `MilestoneObjectNotFoundError`, and
 *   binding never creates on any other branch.
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
  /**
   * STE-377 AC-STE-377.1 — the tracker-assigned Epic key (the found and
   * already-bound legs of the `epic` binding both surface it; STE-522
   * removed the create leg, so minting surfaces the key itself) so
   * /spec-write can derive the milestone id via `milestoneIdFromEpicKey`
   * with no scan and no plan file written first. Absent off the epic path.
   */
  epicKey?: string;
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

/**
 * The real-time wait behind every optional `sleep` seam in the retry
 * apparatus. Exported so the mints — `mintMilestoneEpic` (Jira) and
 * `mintMilestoneLinear` (STE-539), the other `retryTransient` callers — use
 * the SAME default rather than a copy each: the schedule
 * (`TRANSIENT_RETRY_SCHEDULE_MS`), the loop (`retryTransient`) and the wait are
 * one set of three, and a divergent piece would let call sites of one contract
 * disagree about what "no injected sleep" means.
 */
export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STE-362 AC-STE-362.1 — transient-only retry around one attach +
 * read-back-verify round-trip. The fast-path attempt runs with no wait; a
 * failure retries the WHOLE round-trip on the canonical `1s + 2s + 4s`
 * schedule. Classification is **by exclusion**: only `MilestoneAttachmentError`
 * (binding mismatch — the write landed but the read-back disagrees) is
 * known-permanent and NEVER retries (retrying a mismatch would mask a real
 * config bug, e.g. binding the wrong milestone object — the example this line
 * used to give, "forwarding a milestone ID instead of a name", INVERTED with
 * STE-540: sending the identifier is now the correct write on the
 * identifier-keyed arm). Every other
 * throw — Gateway-Timeout / 504 / connection reset, but also e.g. a 401 — is
 * treated as possibly-transient and retried; MCP error shapes are too varied
 * for a reliable positive network-class match (same trade-off as the
 * `upsertTicketMetadata` idempotency retry), at the cost of ~7s extra latency
 * before a genuinely permanent non-mismatch error surfaces. The success path
 * adds no latency (sleep fires only after a caught error).
 */
export async function retryTransient<T>(
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
    binding: "object" | "label" | "epic" | "milestone-id";
    /** STE-540 — the identifier the `milestone-id` remedy names. */
    identifier?: string;
  },
): Promise<void> {
  return retryTransient(async () => {
    await round.write();
    const fresh = await provider.getIssue(ticketId);
    const actual = round.read(fresh);
    if (actual !== round.expected) {
      throw new MilestoneAttachmentError(
        round.expected,
        actual,
        round.binding,
        round.identifier,
      );
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

  // STE-375 AC-STE-375.1 — `epic` binding (Jira milestone-as-Epic). ONE
  // routing decision with FOUR outcomes, taken on the leading milestone token
  // of the canonical plan-heading name (STE-523 AC-STE-523.1). Each outcome
  // arrived with a different FR; read them as one table, because none of them
  // is a fallthrough:
  //
  //   token kind                    → surface                → Epic-miss verdict
  //   ------------------------------------------------------------------------
  //   1. Epic-KEYED `M_<key>`       → parent Epic, by KEY     → REFUSE (521)
  //   2. numeric `M<N>` (grandf.)   → milestone LABEL         → no Epic lookup
  //   3. claims a token, parses     → none — refuses (523)    → no Epic lookup
  //      as neither kind
  //   4. claims no token — pre-key  → parent Epic, by NAME    → REFUSE (522)
  //      HUMAN title
  //
  // Among the four, outcome 2 is the only one that writes a label; 1 and 4
  // are the only ones that set a parent, and NONE of them creates an Epic —
  // since STE-522 minting is its own step (`mintMilestoneEpic`), so an Epic
  // the attach cannot find is a refusal on both parent-surface arms. None
  // calls the object-path ops (listMilestones / saveMilestone /
  // upsertTicketMetadata). Ahead of all four sits the
  // availability probe immediately below: `false` degrades the whole binding
  // to the legacy label path before any token is even parsed.
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
    // STE-523 AC-STE-523.1 — route on the milestone token's KIND, not on the
    // declared binding alone. The READER (`milestoneBindingPresent`, epic
    // branch) already carries this clause: a grandfathered numeric `M<N>`
    // milestone under the epic binding predates Epics and was bound via the
    // LABEL surface, so the predicate stops looking at the parent and checks
    // `milestoneLabel(canonical)` membership instead. Without the same clause
    // here the writer set a parent the reader never consults — nothing threw,
    // the attach reported success, and the predicate stayed false, so a
    // backfill sweep reported the same tickets fixed on every pass forever.
    // `attachViaMilestoneLabel` is REUSED rather than re-implemented: it
    // writes `milestoneLabel(canonical)` and the reader checks
    // `milestoneLabel(canonical)`, so one function decides the string on both
    // sides and they cannot drift. Placed after the availability probe (a
    // degraded provider keeps its `milestone_epic_unsupported` row) and before
    // the epic-ops guard — a numeric token needs only `addLabel`. An
    // unparseable token is NOT captured by this `if`; outcome 3, immediately
    // below, decides it.
    const milestoneToken = leadingMilestoneToken(milestoneName);
    const parsedToken = parseMilestoneToken(milestoneToken);
    // ── OUTCOME 2: numeric token → the milestone LABEL surface.
    if (parsedToken?.kind === "numeric") {
      return attachViaMilestoneLabel(provider, milestoneName, ticketId, sleep, null);
    }
    // ── OUTCOME 3: a name that CLAIMS a token parsing as neither kind.
    // STE-523 AC-STE-523.6 — the third case. With the routing above, a token
    // is either Epic-keyed (parent surface) or numeric (label surface); one
    // that parses as neither is a malformed milestone id and must not be
    // silently routed to either surface. Thrown here — before the epic-ops
    // guard, before `listEpics`, and outside `retryTransient` — so nothing is
    // written and the refusal does not pay the transient backoff schedule.
    //
    // Scoped to names that CLAIM a token. A canonical milestone name is
    // `<token> — <title>` (`parsePlanHeading` normalizes every heading to
    // exactly that em-dash shape), so a name in that shape asserts its first
    // field is a milestone token and a field that will not parse is a
    // refusal. A name NOT in that shape carries no token field at all —
    // STE-377's Epic-FIRST allocation deliberately attaches a pre-key human
    // title (`Concurrent milestone A`), because the Epic must exist before
    // there is a key to derive an id from. `leadingMilestoneToken` would hand
    // back that title's first word; refusing on it would break claim-on-create
    // and would be naming a "token" the caller never wrote.
    if (parsedToken === null && milestoneName.startsWith(`${milestoneToken} — `)) {
      throw new MilestoneTokenUnparseableError(milestoneToken, milestoneName, project);
    }
    // ── OUTCOMES 1 and 4: the parent-Epic surface. Only these two reach the
    // epic ops — outcome 2 needs `addLabel` alone, and outcome 3 wrote
    // nothing at all.
    const { listEpics, setParent } = provider;
    if (!listEpics || !setParent) {
      throw new Error(
        'attachProjectMilestone: milestoneBinding === "epic" requires listEpics/setParent ops on the provider',
      );
    }
    // STE-521 AC-STE-521.1 — for an Epic-KEYED milestone the join is by key,
    // not by summary. The canonical name embeds the very key being looked for
    // (`M_GF_78 — Waiting States II`) while the Epic that gave the milestone
    // its id carries whatever human title was typed (`Waiting States II`), so
    // name equality could never succeed — and minting on the miss produced a
    // SECOND Epic under a key `milestoneBindingPresent` can never accept.
    // Keys sanitize FORWARD to tokens (`GF-78` → `M_GF_78`) and a token cannot
    // be de-sanitized back into a key, so each candidate's key is sanitized
    // forward and compared to the token — the reader's own expression with the
    // parent key swapped for the candidate's. The by-NAME arm below belongs
    // to OUTCOME 4 — a pre-key human title, the only name shape still
    // reaching it since STE-523 sent grandfathered numeric `M<N>` milestones
    // to the label surface. Since STE-522 that arm, too, only FINDS.
    // (`milestoneToken` / `parsedToken` are recovered above, at the
    // kind-routing decision — one extraction serves both.)
    // Non-null EXACTLY when the token is Epic-keyed: the key the match looks
    // for, and the key the refusal below names.
    const tokenEpicKey = parsedToken?.kind === "epic" ? parsedToken.key : null;
    const matchesMilestoneEpic = (e: { key: string; name: string }): boolean => {
      if (tokenEpicKey === null) return e.name === milestoneName;
      try {
        return milestoneIdFromEpicKey(e.key) === milestoneToken;
      } catch {
        return false;
      }
    };
    // STE-375 AC-STE-375.5 — the find leg retries as ONE unit on transient
    // failure (STE-362 canonical schedule). It was a find-OR-CREATE unit
    // until STE-522 moved minting out; the retry shape is kept because the
    // enumeration and the idempotency read-back still have to advance
    // together, and a mint that landed server-side in a separate step is
    // found by this leg on the next attach rather than duplicated.
    const { epicKey, alreadyBound } = await retryTransient<{
      epicKey: string | null;
      alreadyBound: boolean;
    }>(async () => {
      const epics = await listEpics(project);
      const found = epics.find(matchesMilestoneEpic);
      if (found) {
        // STE-375 AC-STE-375.2 — idempotency pre-check: when the ticket's
        // `parent` already equals the milestone Epic's key, the attach is a
        // no-op — the parent is not rewritten and no second Epic is created.
        const current = await provider.getIssue(ticketId);
        return { epicKey: found.key, alreadyBound: (current.parent ?? null) === found.key };
      }
      // A MISS on either arm, signalled out of the retry round-trip as a
      // sentinel and thrown below, so neither refusal pays the transient
      // backoff schedule. STE-521 AC-STE-521.6 / AC-STE-521.7 made the
      // Epic-KEYED miss a refusal; STE-522 AC-STE-522.8 makes the by-NAME
      // miss one too, and the branch is gone rather than narrowed: BINDING
      // NEVER CREATES. Minting moved to `mintMilestoneEpic`
      // (`adapters/_shared/src/mint_milestone_epic.ts`), which is the only
      // place that can run the create in the order that makes the resulting
      // key derivable into a milestone id. The two misses differ only in what
      // the refusal can name, so they carry different errors below.
      return { epicKey: null, alreadyBound: false };
    }, sleep);
    // `epicKey: null` is the miss sentinel the round-trip above threads out —
    // now emitted on BOTH arms, so the verdict routes on which match was run.
    // An Epic-KEYED miss can name the key it looked for (`tokenEpicKey` is
    // non-null exactly on that arm — the routing test below is that same fact,
    // asked of the value the refusal then names); a by-NAME miss can name only
    // the name.
    if (epicKey === null) {
      if (tokenEpicKey !== null) {
        throw new MilestoneEpicNotFoundError(milestoneToken, tokenEpicKey, project);
      }
      throw new MilestoneEpicUnmintedError(milestoneName, project);
    }
    if (alreadyBound) {
      return { capability: null, epicKey };
    }
    // Parent set + read-back verify (epic binding — the parent key must
    // byte-equal the milestone Epic's key).
    await writeAndVerify(provider, ticketId, sleep, {
      write: () => setParent(ticketId, epicKey),
      expected: epicKey,
      read: (fresh) => fresh.parent ?? null,
      binding: "epic",
    });
    return { capability: null, epicKey };
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

  // STE-540 AC-STE-540.1 — kind routing on the OBJECT branch, the Linear
  // mirror of what STE-523 did for the `epic` branch. Once the milestone token
  // is derived FROM the identifier Linear allocated
  // (`milestoneIdFromLinearMilestone(uuid)` → `M_<6 hex>`), the canonical name
  // is `M_3fa85f — Waiting States II` while the milestone object keeps whatever
  // human title was typed — so `m.name === milestoneName` can never succeed on
  // that pair, and its miss branch auto-CREATED a second milestone under a
  // fresh identifier that can never sanitize back to the token.
  //
  // Match-by-KEY instead: each candidate's identifier is sanitized FORWARD
  // through `milestoneTokenFromLinearId` (this module's one wrapper over
  // `milestoneIdFromLinearMilestone`) and compared to the token — the same
  // expression the minter derived the token with, the same one the verify and
  // `milestoneBindingPresent` derive through, so writer and reader agree by
  // construction rather than by matching strings. Nothing on this arm is
  // matched by NAME; the AC-540.4 fallback below sends the found milestone's
  // own name as a write param, but no name is ever compared.
  //
  // `milestoneIdFromLinearMilestone` — NOT `milestoneIdFromEpicKey`: the latter
  // is the `mode: jira` dispatch, and a token minted from a Linear identifier
  // would never round-trip through it.
  //
  // A NUMERIC `M<N>` token is grandfathered and falls through to the shipped
  // by-name list/create/attach path below, untouched.
  const objectToken = leadingMilestoneToken(milestoneName);
  if (parseMilestoneToken(objectToken)?.kind === "epic") {
    // `id` is OPTIONAL on the enumerated rows (STE-539 widened them so no
    // existing provider double had to grow the field), so a row that offers
    // none is SKIPPED rather than derived from — as is one whose identifier
    // does not derive. Both absences are `milestoneTokenFromLinearId`'s null,
    // the same expression the verify and the reader below derive through.
    //
    // Declared as a TYPE GUARD, not a plain predicate: what the find returns
    // is the row the write then sends an identifier from, so `id` being
    // present is a fact the type carries rather than one a `!` re-asserts.
    const matchesMilestoneObject = (
      m: { name: string; id?: string },
    ): m is { name: string; id: string } =>
      m.id !== undefined && milestoneTokenFromLinearId(m.id) === objectToken;
    const foundById = existing.find(matchesMilestoneObject);
    // AC-STE-540.5 — a miss REFUSES; binding never creates. Raised outside
    // `retryTransient` so the refusal does not pay the backoff schedule.
    if (!foundById) {
      throw new MilestoneObjectNotFoundError(objectToken, milestoneName, project);
    }
    const milestoneIdentifier = foundById.id;
    // AC-STE-540.2 — the write sends the IDENTIFIER (`Milestone name or ID`),
    // and the verify re-derives the token from the READ-BACK identifier: a
    // name-only verify accepts a silent swap that kept the name and changed
    // the milestone.
    await writeAndVerify(provider, ticketId, sleep, {
      // AC-STE-540.4 — name-resolution fallback. `Milestone name or ID` says
      // both forms are accepted, but a workspace that rejects the identifier
      // form must not turn a correct binding into a failed attach. So the
      // write retries ONCE with the FOUND milestone's own `name` — not the
      // requested canonical name, which a decoy milestone may also carry.
      //
      // The retry lives INSIDE `write`, deliberately: `retryTransient` wraps
      // the whole round-trip on the `1s + 2s + 4s` schedule, and a rejected
      // param is a fact about the workspace, not an outage — riding the
      // backoff would pay ~7s to learn the same thing. It also keeps the
      // enumeration count at one: `foundById` is already in hand, so the
      // fallback re-uses the step-1 lookup instead of re-listing.
      //
      // The catch is DELIBERATELY BROAD, and the cost is named rather than
      // hidden. It cannot tell "this workspace rejects the identifier form"
      // from a 504 — `retryTransient`'s own header records why (MCP error
      // shapes are too varied for a reliable positive network-class match) —
      // so a transient on the id write also spends this one name attempt.
      // What makes that safe is the VERIFY below, not the catch: `read`
      // re-derives the token from the read-back IDENTIFIER, so a name write
      // landing on a different milestone that happens to share the name is a
      // loud `MilestoneAttachmentError`, never a silent mis-bind. The name
      // ADDRESSES the write; the identifier is what is checked. The residual
      // is narrow and named: where two milestones share one name, a transient
      // can surface as that permanent refusal instead of being retried into a
      // success. Both directions are pinned in this FR's suite.
      write: async () => {
        try {
          await provider.upsertTicketMetadata(ticketId, { milestone: milestoneIdentifier });
        } catch {
          await provider.upsertTicketMetadata(ticketId, { milestone: foundById.name });
        }
      },
      expected: objectToken,
      read: (fresh) => milestoneTokenFromLinearId(fresh.projectMilestone?.id),
      binding: "milestone-id",
      identifier: milestoneIdentifier,
    });
    return { capability: null };
  }

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
 * The leading whitespace-delimited token of a canonical milestone name
 * (`M_GF_78 — Waiting States II` → `M_GF_78`, `M86 — Jira Support` → `M86`).
 *
 * ONE expression for the three sites in this module that recover a token from
 * a name — the attach's Epic-key match, the Jira label derivation, and the
 * `milestoneBindingPresent` read side. They must agree on what counts as the
 * token, since STE-521 makes the writer's match and the reader's check the
 * same function of the same field. Shape validation stays with the callers
 * (`parseMilestoneToken` / `isMilestoneToken`); an empty name yields `""`,
 * which no caller accepts as a token.
 */
export function leadingMilestoneToken(canonicalName: string): string {
  return canonicalName.split(/\s/, 1)[0] ?? "";
}

/**
 * STE-540 — ONE expression turning a Linear milestone IDENTIFIER into its
 * milestone token, `null` when there is no token to be had (no identifier on
 * the row/view, or an identifier that does not derive — a candidate that is
 * simply not this milestone, never a crash).
 *
 * Shared by the THREE sites that have to agree about it, and that is the whole
 * point of it existing: the writer's by-id match over the enumerated
 * milestones, that write's read-back verify, and the `milestoneBindingPresent`
 * reader. Those three arrived from different directions — a writer and a
 * reader that had each spelled the rule out in their own words is the drift
 * STE-523's comment block at the epic branch records as this module's
 * recurring defect, and this FR exists because it recurred. They now cannot
 * disagree: there is only one spelling.
 *
 * The COMPARISON deliberately stays with each caller — the writer picks a
 * milestone out of a list, the verify projects a read-back to a token, the
 * reader tests one already-bound issue. Those are three different questions
 * about the same derivation; folding them together would hide the difference
 * rather than remove it.
 */
function milestoneTokenFromLinearId(id: string | null | undefined): string | null {
  if (id === undefined || id === null || id === "") return null;
  try {
    return milestoneIdFromLinearMilestone(id);
  } catch {
    return null;
  }
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
  const token = leadingMilestoneToken(canonicalName);
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
 * none; `label` (Jira legacy) and `epic` (Jira Epic-first) must be declared
 * explicitly.
 */
export function resolveMilestoneBinding(provider: MilestoneOps): "object" | "label" | "epic" {
  if (provider.milestoneBinding === "label") return "label";
  if (provider.milestoneBinding === "epic") return "epic";
  return "object";
}

/**
 * M97 (STE-363 + STE-364) — shared present/missing predicate for a ticket's
 * milestone binding. The archival-boundary assertion, the backfill sweep, and
 * gate probe verification all classify through this one function so the
 * surfaces cannot drift: `object` (Linear, default) ⇒ `projectMilestone.name`
 * byte-equals the canonical plan-heading name; `label` (Jira legacy) ⇒
 * `labels` contains `milestone-<M-token>` (milestoneLabel); `epic` (Jira
 * Epic-first) ⇒ for an Epic-keyed milestone the ticket's `parent` key
 * sanitizes back to the milestone token (`milestoneIdFromEpicKey(parent) ===
 * M_<epic-key>` — the self-describing membership check), while a
 * grandfathered numeric `M<N>` milestone under the epic binding falls back to
 * the label surface (those milestones predate Epics and were attached via
 * labels).
 */
/**
 * STE-523 AC-STE-523.9 — the read side of the label surface. A canonical name
 * with no leading M-token has no label form at all, so no label for it can be
 * present on the issue: the honest answer is `false`, not an exception. The
 * `milestoneLabel` throw stays load-bearing for the WRITE path (an attach that
 * cannot name its label must fail loudly rather than write nothing and report
 * success); only this read predicate absorbs it — the same try/return-false
 * idiom the epic branch already uses for `milestoneIdFromEpicKey`.
 *
 * Scoped deliberately to the label DERIVATION: a token-bearing name still
 * reads its surface normally.
 */
function labelSurfacePresent(labels: string[], canonical: string): boolean {
  let expected: string;
  try {
    expected = milestoneLabel(canonical);
  } catch {
    return false;
  }
  return labels.includes(expected);
}

export function milestoneBindingPresent(
  issue: {
    projectMilestone?: { name: string; id?: string } | null;
    labels?: string[];
    parent?: string | null;
  },
  canonical: string,
  binding: "object" | "label" | "epic",
): boolean {
  if (binding === "label") {
    return labelSurfacePresent(issue.labels ?? [], canonical);
  }
  if (binding === "epic") {
    const token = leadingMilestoneToken(canonical);
    if (parseMilestoneToken(token)?.kind === "epic") {
      const parent = issue.parent ?? null;
      if (parent === null || parent === "") return false;
      try {
        return milestoneIdFromEpicKey(parent) === token;
      } catch {
        return false;
      }
    }
    // Grandfathered numeric milestone under the epic binding: label surface.
    return labelSurfacePresent(issue.labels ?? [], canonical);
  }
  // STE-540 cross-surface — the READER half of match-by-key. The `object`
  // branch of the writer above binds an EPIC-kind token by deriving each
  // candidate's identifier FORWARD through `milestoneIdFromLinearMilestone`
  // and comparing to the token; this predicate must read what that writer
  // wrote, using the SAME expression. A byte-equal NAME compare here would
  // report `false` for a correctly bound milestone (the object keeps the human
  // title, not the canonical name) and `true` for a decoy that merely carries
  // the canonical name under a different identifier — precisely the
  // writer/reader disagreement STE-523's comment block above records as the
  // recurring defect.
  //
  // "The SAME expression" is literal, not aspirational: both halves derive
  // through `milestoneTokenFromLinearId`, so an absent `id` and a non-UUID
  // identifier mean the same thing here that they mean at the write — not this
  // milestone, never a crash — and no future edit can move one half without
  // the other.
  //
  // A NUMERIC `M<N>` token is grandfathered: it keeps the shipped byte-equal
  // name compare, byte for byte.
  const objectToken = leadingMilestoneToken(canonical);
  if (parseMilestoneToken(objectToken)?.kind === "epic") {
    return milestoneTokenFromLinearId(issue.projectMilestone?.id) === objectToken;
  }
  return (issue.projectMilestone?.name ?? null) === canonical;
}

/**
 * Build the canonical milestone name from a plan-file path. Delegates to the
 * shared `parsePlanHeading` (./plan_heading) so it accepts the current
 * `## M<N> — <title> {#M<N>}` (H2 + em-dash) form plus the legacy
 * `# M<N> — <title>` (H1) and `## M<N>: <title>` (H2 + colon) forms — the
 * legacy shapes are still parsed, and every shape normalizes to the canonical
 * `M<N> — <title>` (em-dash) with the optional `{#M<N>}` anchor stripped.
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
        `(expected \`## M<N> — <title>\`; the legacy \`# M<N> — <title>\` H1 form and ` +
        `\`## M<N>: <title>\` colon form are still accepted)`,
    );
  }
  return name;
}

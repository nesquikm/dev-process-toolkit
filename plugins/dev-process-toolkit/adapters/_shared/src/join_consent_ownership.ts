// join_consent_ownership.ts — STE-650 AC.1: the ONE ownership predicate the
// tracker-write hook (gateJoinedLabels) and the live grader (gatedWrites) both
// call to decide whether a key's ownership route waives a forbidden join's
// consent. Neither caller re-implements it.
//
// Only a key this session CREATED is its own and needs no join consent. A key
// owned through an FR binding or a reuse, binding or import receipt still
// needs the answered consent. Review TWR-4: the exemption waives ONLY the
// consent half — the labels read-merge is checked for every joined Epic.
//
// STE-655 adds the other rules the hook and the grader must read alike: the
// labels-write envelope, the link-comment side rule, Linear relation targets,
// and the per-question consent verdict. Each is imported by both callers; this
// module imports nothing, so the hook stays import-light.

/** The route by which a session owns a ticket key. */
export type OwnershipRoute = "created" | "fr-binding" | "reuse-receipt" | "binding-receipt" | "import-receipt";

/**
 * True only when ownership by `route` exempts a write from the join consent.
 * Any other string — the hook's `"not-created"`, which is all it can tell
 * apart from `"created"` — is not exempt.
 */
export function exemptsJoinConsent(route: OwnershipRoute | string): boolean {
  return route === "created";
}

/**
 * STE-655 AC.8: the ONE labels-write envelope the hook (gateJoinedLabels) and
 * the live grader (gatedWrites) both read. Null when the write carries neither
 * `fields.labels` nor a top-level `update` block; otherwise `extraKeys` lists
 * the keys under `fields` other than `labels`, plus `update` when that block
 * is present. Other top-level keys (the format keys `contentFormat` /
 * `responseContentFormat`, `cloudId`, `issueIdOrKey`) are not edits and never
 * count.
 */
export function labelsEnvelope(input: unknown): { extraKeys: string[] } | null {
  if (input === null || typeof input !== "object") return null;
  const hasUpdate = Object.prototype.hasOwnProperty.call(input, "update");
  const raw = (input as { fields?: unknown }).fields;
  const fields = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const hasLabels = fields !== null && Object.prototype.hasOwnProperty.call(fields, "labels");
  // A labels write is `fields.labels` OR a top-level `update` block (which can
  // carry `update.labels`, or any other field edit — STE-655 review r0).
  if (!hasLabels && !hasUpdate) return null;
  const extraKeys = fields === null ? [] : Object.keys(fields).filter((k) => k !== "labels");
  // A top-level `update` block edits fields too (M_685ff6 review): it counts
  // as an extra key, though it sits beside `fields` rather than under it.
  // Format keys (contentFormat, responseContentFormat) are not edits (AC.9).
  if (hasUpdate) extraKeys.push("update");
  return { extraKeys };
}

/**
 * STE-655 AC.15: the ONE rule the hook (gateTicket) and the live grader
 * (gatedWrites) both read for how many sides of a link must be owned. A link
 * needs one owned side, unless it carries a non-empty `comment`: the comment
 * lands on a ticket the link names, and which one is unmeasured, so every
 * side must be owned.
 */
export function linkNeedsEverySide(input: unknown): boolean {
  if (input === null || typeof input !== "object") return false;
  const comment = (input as { comment?: unknown }).comment;
  if (typeof comment === "string") return comment.trim().length > 0;
  if (comment === null || typeof comment !== "object") return false;
  return Array.isArray(comment) ? comment.length > 0 : Object.keys(comment).length > 0;
}

/** STE-655 AC.16: the Linear `save_issue` fields that name a relation target. */
// The four relation fields AC-STE-655.16 names. `parentId` also names another
// issue but sets hierarchy, not a relation; it is NOT read here (an M4
// backlog item: grade a cross-team parentId as a link side).
export const RELATION_TARGET_FIELDS = ["relatedTo", "blockedBy", "blocks", "duplicateOf"] as const;

/**
 * STE-655 AC.16: the ONE reader the hook (gateTicket) and the live grader
 * (gatedWrites) share for a Linear `save_issue` update's relation targets.
 * Each target is a LINK SIDE for resolution only — it must resolve inside the
 * bound team — and never a subject: owning a target never permits writing the
 * issue `id`. Returns the raw values, flattened (a field may be one value or
 * a list); empty for any other tool or a call naming none.
 */
export function relationTargets(tool: string, input: unknown): unknown[] {
  if (tool !== "save_issue" || input === null || typeof input !== "object") return [];
  const i = input as Record<string, unknown>;
  const out: unknown[] = [];
  for (const f of RELATION_TARGET_FIELDS) {
    const v = i[f];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

/**
 * STE-650 AC-8 / STE-655 AC-12 — the ONE per-question consent verdict of one
 * answered AskUserQuestion on `label`, read by the hook and the live grader
 * alike. Each passes its own `answer` lookup (the hook reads a transcript
 * tool_result, the grader a bundle call's result text).
 *
 * `null` when no question in `questions` names the subject (`names`) and
 * offers `label` as an option — the ask says nothing about it. Otherwise true
 * only when every such question was answered exactly `label`: a "no" to one of
 * them is never overridden by a "yes" to another (review FO-2), and a question
 * about something else neither grants nor withholds it.
 */
export function perQuestionConsent(
  questions: unknown,
  label: string,
  names: (question: string) => boolean,
  answer: (question: string) => string | null,
): boolean | null {
  if (!Array.isArray(questions)) return null;
  const relevant = questions.filter((q) => {
    const question = (q as { question?: unknown } | null)?.question;
    if (typeof question !== "string" || !names(question)) return false;
    const options = (q as { options?: unknown } | null)?.options;
    return Array.isArray(options) && options.some((o) => (o as { label?: unknown } | null)?.label === label);
  });
  if (relevant.length === 0) return null;
  return relevant.every((q) => answer((q as { question: string }).question) === label);
}

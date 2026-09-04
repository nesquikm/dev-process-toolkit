// assert_milestone_binding_at_archive — STE-363 AC-STE-363.1 (M97).
//
// Archival-boundary milestone-binding assertion, called by /spec-archive
// (single-FR + milestone-group paths) and /implement Phase-4-close for each
// FR being archived in tracker mode with `project_milestone: true`. Fetches
// the FR's bound ticket and asserts its milestone binding is present via the
// adapter-aware surface, mirroring /gate-check probe #26
// (tracker_project_milestone_attached):
//
//   - `object` (Linear, default) ⇒ kind-routed since STE-540: an
//     identifier-keyed `M_<key>` milestone derives `projectMilestone.id`
//     FORWARD to the token (the milestone keeps its human title, so names
//     never match there); a grandfathered numeric `M<N>` byte-equals the
//     canonical plan-heading name (planFileHeadingToMilestoneName).
//   - `epic` (Jira's primary path) ⇒ for an Epic-KEYED milestone the ticket's
//     `parent` key sanitizes back to the milestone token; a grandfathered
//     numeric milestone under this binding falls back to the label surface,
//     which is where its writer puts it (STE-523).
//   - `label` (Jira's legacy fallback) ⇒ `labels` contains `milestone-<M-token>`.
//
// All THREE are live. An earlier version of this list named only the first and
// the last while the module already resolved and reasoned about `epic`
// throughout, which read as exhaustive and was not.
//
// On a miss the helper calls attachProjectMilestone ONCE (which carries the
// STE-362 transient retry and its own read-back verify) and then RE-READS the
// ticket, returning `asserted` only when the same present/missing predicate —
// same canonical name, same binding kind — says yes on that fresh read. An
// attach that merely did not throw is not an answer to the question this gate
// opened with (STE-524). A still-missing binding refuses with an NFR-10
// canonical detail. Never throws on a refusal: callers branch on the returned
// outcome.
//
// WHY THIS GATE MUST FAIL CLOSED. `/gate-check` probe #26
// (tracker_project_milestone_attached) — the probe that otherwise verifies
// this binding — walks only `status: active` FRs (`if (fm.status !== "active")
// continue;`), and archiving is precisely the transition that makes an FR
// non-active. That skip is correct: an archival sweep has no business
// re-fetching hundreds of archived tickets. Its consequence is that this
// gate, running at the archival boundary, is the LAST read of that binding —
// nothing downstream revisits it. So a false pass here is permanent and is
// discovered later only as archaeology, while a false refusal costs one
// operator one re-run. That asymmetry is the argument: verdict on the
// predicate's answer, never on the mere absence of a throw. Do not restore
// the unconditional `asserted` as a simplification.
//
// Vacuous (no tracker call, no assertion) on:
//   - `mode: none`
//   - adapter `supports("project_milestone") === false`
//   - FR without a `tracker:` binding or `milestone:` frontmatter
//   - missing/unparsable `specs/plan/<milestone>.md` (probe #27 owns that
//     diagnostic)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachProjectMilestone,
  isMilestonePermanentRefusal,
  MilestoneAttachmentError,
  milestoneBindingPresent,
  milestoneLabel,
  planFileHeadingToMilestoneName,
  resolveMilestoneBinding,
  type MilestoneOps,
} from "./attach_project_milestone";
import { parseFrFrontmatter } from "./tracker_project_milestone_attached";

export const MILESTONE_LABEL_ASSERTED_AT_ARCHIVE = "milestone_label_asserted_at_archive" as const;
export const MILESTONE_LABEL_ARCHIVE_REFUSED = "milestone_label_archive_refused" as const;

export type AssertMilestoneBindingAtArchiveResult =
  | { outcome: "vacuous"; token?: undefined; detail?: undefined }
  | { outcome: "asserted"; token: typeof MILESTONE_LABEL_ASSERTED_AT_ARCHIVE; detail: string }
  | { outcome: "refused"; token: typeof MILESTONE_LABEL_ARCHIVE_REFUSED; detail: string };

export interface AssertMilestoneBindingAtArchiveDeps {
  /** Repo root — locates `specs/plan/<milestone>.md`. */
  projectRoot: string;
  /** Task-tracking mode from CLAUDE.md (`none` ⇒ vacuous). */
  mode: string;
  /** Injected wait for the attach's transient-retry backoff (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Route → remedy registry (STE-524 AC-STE-524.11).
 *
 * The gate refuses on seven distinct routes, and for a long while every one of
 * them emitted the SAME advice. Three of them were misdirected by it, two
 * of those dangerously: telling an operator to "attach it manually" when the
 * ticket could not even be FETCHED, or when the post-attach re-read failed,
 * invites a DUPLICATE WRITE onto a binding that may be perfectly fine — the
 * exact defect class this milestone exists to close. The third sent the Epic
 * degrade back to `--backfill-milestone-labels`, which rewrites the label
 * already present and never touches the `parent` the predicate reads: advice
 * to repeat the failure.
 *
 * So the advice is keyed by CAUSE, and it lives here rather than at the raise
 * sites. One table means an eighth route cannot quietly inherit a seventh
 * route's line: it either registers a remedy of its own or it has none at all.
 * `{placeholder}` segments are interpolated per refusal (see `remedyFor`).
 *
 * Keep this registry IN THIS MODULE. The enumeration pin counts each route id
 * exactly twice in this file — once registered here, once raised below.
 */
export const ARCHIVE_REFUSAL_REMEDIES = {
  /** Route 1 — the canonical name is unusable; nothing was asked of the tracker. */
  unusable_milestone_name:
    "fix the milestone heading in {planFile} so it begins with a milestone token (`M<N>` or `M_<epic-key>`), then re-run the archival. The tracker was never contacted, so there is nothing to undo.",
  /** Route 2 — the ticket could not be fetched; NOTHING is known to be missing. */
  ticket_fetch_failed:
    "restore tracker access — connectivity, credentials, ticket visibility — and re-run the archival. Do not repair the binding by hand: the read never happened, so the binding may well be intact and a blind write would duplicate it.",
  /** Route 3 — the attach ran and read back a MISMATCH; a repair genuinely is due. */
  attach_binding_mismatch:
    "attach the milestone manually via the tracker's edit-issue call, or run /spec-archive --backfill-milestone-labels to backfill the binding, then re-run the archival.",
  /** Route 4 — the attach call itself failed (network exhaustion, auth). */
  attach_call_failed:
    "clear the failure the tracker reported above — outage, expired credentials, rate limit — then retry the archival. The write never completed, so nothing was left half-applied.",
  /** Route 5 — the attach reported success and the confirming re-read failed. */
  post_attach_reread_failed:
    "re-run the archival once the tracker answers reads again. Leave the binding alone in the meantime: the attach reported success, so writing it again would risk a second, duplicate binding.",
  /** Route 6 — the attach landed, yet the binding this gate reads is still absent. */
  attach_landed_binding_absent:
    "the write landed, but what landed is not the binding this assertion reads — on the Epic degrade the attach records a milestone label while the check reads the ticket's `parent`. Set the parent Epic on the ticket directly, then re-run the archival.",
  /** Route 7 — the attach REFUSED on a condition that repeating cannot change. */
  attach_refused_permanently:
    "do what the refusal above says — it is a permanent condition, so re-running the archival unchanged will refuse identically no matter how long you wait. The refusal names the exact fault and carries its own Remedy line; follow that, then re-run the archival. Nothing was written, so there is nothing to undo.",
} as const;

/** The route ids the refusal detail stamps into its `Context:` line. */
export type ArchiveRefusalRoute = keyof typeof ARCHIVE_REFUSAL_REMEDIES;

/** Interpolates a registry template's `{placeholder}` segments. */
function remedyFor(route: ArchiveRefusalRoute, vars: Record<string, string> = {}): string {
  return ARCHIVE_REFUSAL_REMEDIES[route].replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (whole, key: string) => vars[key] ?? whole,
  );
}

/**
 * The NFR-10 three-line shape, built in ONE place so no route can drift out of
 * it — and so no route can write remedy prose of its own: the advice always
 * comes from the registry above, and the `route=` stamp always names the entry
 * it came from.
 */
function refusalDetail(
  headline: string,
  route: ArchiveRefusalRoute,
  context: string,
  vars?: Record<string, string>,
): string {
  return [
    headline,
    `Remedy: ${remedyFor(route, vars)}`,
    `Context: ${context}, route=${route}, helper=assertMilestoneBindingAtArchive`,
  ].join("\n");
}

/**
 * The operator-facing word for the thing being asserted, per binding kind.
 * Hoisted so the affirmative and the refusal cannot name the same binding two
 * different ways — a fourth binding kind updates one place, not two.
 */
function bindingNoun(binding: "object" | "label" | "epic"): string {
  return binding === "label" ? "label" : binding === "epic" ? "parent-Epic binding for" : "milestone";
}

function asserted(
  ticketId: string,
  expected: string,
  binding: "object" | "label" | "epic",
): AssertMilestoneBindingAtArchiveResult {
  const noun = bindingNoun(binding);
  return {
    outcome: "asserted",
    token: MILESTONE_LABEL_ASSERTED_AT_ARCHIVE,
    detail: `${ticketId} carries ${noun} "${expected}" at the archival boundary`,
  };
}

function refused(
  ticketId: string,
  expected: string,
  binding: "object" | "label" | "epic",
  route: ArchiveRefusalRoute,
  cause?: string,
): AssertMilestoneBindingAtArchiveResult {
  const noun = bindingNoun(binding);
  const headline = cause
    ? `${MILESTONE_LABEL_ARCHIVE_REFUSED}: ${ticketId} could not be verified to carry ${noun} "${expected}" at the archival boundary — ${cause}.`
    : `${MILESTONE_LABEL_ARCHIVE_REFUSED}: ${ticketId} is missing ${noun} "${expected}" at the archival boundary — one attach attempt did not land.`;
  return {
    outcome: "refused",
    token: MILESTONE_LABEL_ARCHIVE_REFUSED,
    detail: refusalDetail(
      headline,
      route,
      `ticket=${ticketId}, expected="${expected}", binding=${binding}`,
    ),
  };
}

export async function assertMilestoneBindingAtArchive(
  provider: MilestoneOps,
  project: string,
  frFile: string,
  deps: AssertMilestoneBindingAtArchiveDeps,
): Promise<AssertMilestoneBindingAtArchiveResult> {
  // Vacuity: mode none — no tracker at all.
  if (deps.mode === "none") return { outcome: "vacuous" };
  // Vacuity: adapter declares no project_milestone capability.
  if (provider.supports && !provider.supports("project_milestone")) {
    return { outcome: "vacuous" };
  }
  // Frontmatter walk is SHARED with probe #26 (parseFrFrontmatter) — the
  // archival assertion and the gate probe interpret `milestone:` +
  // `tracker:` identically by construction, not by mirroring.
  const fm = parseFrFrontmatter(readFileSync(frFile, "utf-8"));
  // Vacuity: FR is local-only (no tracker binding) or has no milestone.
  if (!fm.trackerId || !fm.milestone) return { outcome: "vacuous" };

  const planPath = join(deps.projectRoot, "specs", "plan", `${fm.milestone}.md`);
  let canonical: string;
  try {
    canonical = planFileHeadingToMilestoneName(planPath);
  } catch {
    // Missing or heading-less plan file — probe #27 owns that diagnostic.
    return { outcome: "vacuous" };
  }

  const binding = resolveMilestoneBinding(provider);
  const ticketId = fm.trackerId;

  // The "never throws" contract holds from the FIRST line, not merely from
  // the fetch onward. `milestoneLabel` THROWS on a canonical name carrying no
  // leading M-token, so under the `label` binding a token-less name would
  // escape as an exception from a helper whose whole contract is that it
  // returns a verdict — aborting a milestone-group archival batch instead of
  // skipping one FR. Hardening at the contract boundary, not the repair of a
  // live crash: `planFileHeadingToMilestoneName` (the only production source
  // of `canonical`) cannot emit a token-less name — it either matches a
  // heading whose leading token satisfies `isMilestoneToken` or throws, which
  // the plan-parse guard above already converts to `vacuous`.
  //
  // The verdict is a REFUSAL, never `vacuous`. A name the gate cannot work
  // with is not "nothing to check": reporting it vacuous would make an
  // unusable milestone name read as a clean archival, which is the fail-open
  // class this gate exists to close. It sits BEFORE the fetch, so nothing is
  // asked of the tracker and nothing is written.
  //
  // The guard covers EVERY binding that NEEDS the milestone token, not merely
  // the one that derives a label from it. `epic` needs it just as much: its
  // predicate compares the ticket's sanitized parent key against the milestone
  // TOKEN, so with no token there is nothing to compare and it silently falls
  // through to the label surface, which cannot derive a label either. Left
  // unguarded that state was a LIVE MISDIRECTION — the attach matched an Epic
  // BY NAME and honestly set the parent, the re-check still read false, and
  // the operator was handed "set the parent Epic on the ticket directly" for a
  // parent that was already correct while the real fault was the milestone
  // NAME. Refusing here costs six tracker calls less and names the true fault.
  //
  // `object` is the ONE exemption, and only on its numeric arm: there it
  // compares `projectMilestone.name` against the canonical name verbatim and
  // needs no token at all, so a token-less name is an ordinary (if odd)
  // milestone name. (An identifier-keyed name DOES carry a token, and its arm
  // reads the identifier rather than the name.) It carries the
  // canonical name through and reaches the fetch unchanged.
  let expected: string;
  if (binding === "object") {
    expected = canonical;
  } else {
    try {
      // Derived for BOTH token-needing bindings — under `epic` purely to
      // establish that a token exists; the epic surface still compares against
      // the canonical name itself.
      const label = milestoneLabel(canonical);
      expected = binding === "label" ? label : canonical;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        outcome: "refused",
        token: MILESTONE_LABEL_ARCHIVE_REFUSED,
        detail: refusalDetail(
          `${MILESTONE_LABEL_ARCHIVE_REFUSED}: the milestone name "${canonical}" cannot be used to verify the ${bindingNoun(binding)} binding for ${ticketId} at the archival boundary — it carries no leading M-token (${msg}). Nothing was asked of the tracker; no attach was attempted.`,
          "unusable_milestone_name",
          `ticket=${ticketId}, canonical="${canonical}", binding=${binding}`,
          { planFile: `specs/plan/${fm.milestone}.md` },
        ),
      };
    }
  }

  // Present/missing classification is SHARED with the STE-364 backfill sweep
  // (milestoneBindingPresent) — the two M97 surfaces cannot drift.
  //
  // This gate reads that classification TWICE: once to ASK whether the binding
  // is there, and once after the attach to ANSWER it. Both go through this one
  // closure, which captures `ticketId`, `canonical` and `binding` — so no call
  // site can read a different ticket, compare against a different name, or
  // consult a different binding kind than the other. That is not tidiness: a
  // gate whose question and answer had drifted apart is the exact defect
  // STE-524 closes, and a second hand-written copy of the rule is how that
  // drift gets back in.
  //
  // Every read is guarded — a thrown getIssue (network, auth, dead ticket) is
  // RETURNED as a value, never raised, so the helper NEVER throws and a
  // milestone-group archival batch skips only this FR while the others
  // proceed. The refusal wording stays at the call sites, because the
  // operator's diagnosis differs: a ticket that could not be fetched at all is
  // not an attach whose write failed to stick.
  type BindingRead = { ok: true; present: boolean } | { ok: false; error: string };
  const readBinding = async (): Promise<BindingRead> => {
    let issue: Awaited<ReturnType<MilestoneOps["getIssue"]>>;
    try {
      issue = await provider.getIssue(ticketId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true, present: milestoneBindingPresent(issue, canonical, binding) };
  };

  const opening = await readBinding();
  if (!opening.ok) {
    return refused(
      ticketId,
      expected,
      binding,
      "ticket_fetch_failed",
      `ticket fetch failed (${opening.error})`,
    );
  }
  if (opening.present) {
    return asserted(ticketId, expected, binding);
  }

  // Miss ⇒ attach ONCE. attachProjectMilestone carries the STE-362 transient
  // retry and read-back-verifies the binding itself; a still-missing binding
  // surfaces as MilestoneAttachmentError, which we convert into a refusal
  // (never a throw at the archival boundary). A non-mismatch attach failure
  // (network exhaustion, auth) threads its message into the refusal detail so
  // the operator can tell a dead connection from a GB-11 silent drop.
  try {
    await attachProjectMilestone(provider, project, canonical, ticketId, {
      sleep: deps.sleep,
    });
  } catch (err) {
    if (err instanceof MilestoneAttachmentError) {
      return refused(ticketId, expected, binding, "attach_binding_mismatch");
    }
    const msg = err instanceof Error ? err.message : String(err);
    // A REFUSAL is not a failure to reach the tracker. The attach now declines
    // to bind on conditions that are decisions about the state of the world —
    // an Epic the token names that is not in the project, an Epic never
    // minted, a token that parses as neither kind — and telling the operator
    // to clear an outage and retry is advice that can never come true: the
    // next run refuses identically. So the permanent classes take a route of
    // their own, and the refusal's OWN instruction (already threaded into the
    // headline below) is the one that actually applies.
    //
    // Classified through the attach module's single exported predicate, NOT an
    // `instanceof` chain over the three known classes: a fourth permanent
    // refusal added later would silently evade a list here, which is exactly
    // the drift the route registry exists to stop.
    if (isMilestonePermanentRefusal(err)) {
      return refused(
        ticketId,
        expected,
        binding,
        "attach_refused_permanently",
        `the attach REFUSED to bind, permanently (${err.name}) — retrying cannot change it:\n${msg}`,
      );
    }
    return refused(
      ticketId,
      expected,
      binding,
      "attach_call_failed",
      `attach attempt failed (${msg})`,
    );
  }

  // Fail closed: an attach that did not throw is a WEAKER claim than the
  // question this gate opened with. attachProjectMilestone verifies its own
  // write by reading back THE FIELD IT WROTE — self-consistent, and silent
  // about whether that field is the one `milestoneBindingPresent` reads. Two
  // shipped states make the gap concrete: a binding that lands on the wrong
  // Epic, and the `epicBindingAvailable: false` degrade, which writes a
  // milestone LABEL while the epic-kind predicate reads `parent`. In both the
  // attach is honest and an unconditional `asserted` here is wrong.
  //
  // So the verdict is the predicate's answer on a FRESH read — literally the
  // same `readBinding` the opening question used, so the SAME predicate, the
  // SAME canonical name and the SAME binding kind are guaranteed by
  // construction rather than by two comments agreeing. It costs exactly one
  // extra getIssue, and only on this miss-then-attach leg (the already-present
  // path above returns without it). A re-read that itself fails is a refusal,
  // not a throw: a milestone-group batch skips this FR and the others proceed.
  const answer = await readBinding();
  if (!answer.ok) {
    return refused(
      ticketId,
      expected,
      binding,
      "post_attach_reread_failed",
      `the attach reported success, but the re-read that would confirm it failed (${answer.error}) — the binding is still unverified`,
    );
  }
  if (!answer.present) {
    return refused(
      ticketId,
      expected,
      binding,
      "attach_landed_binding_absent",
      `the attach reported success, but the binding is STILL absent on re-read — the attach verified only the field it wrote, which is not the field this assertion reads`,
    );
  }
  return asserted(ticketId, expected, binding);
}

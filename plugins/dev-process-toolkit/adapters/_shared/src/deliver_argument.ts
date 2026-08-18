// STE-497 — `/deliver`'s argument grammar.
//
// `/deliver` used to accept exactly one thing: a feature request in prose. A
// milestone identity (`M129`) is a well-formed "idea", so handing one over
// walked straight into the Socratic design phase for work whose plan is
// already on disk. This module is the one home for deciding WHAT an operator
// just handed `/deliver`, and what that argument routes to.
//
// Three kinds, and only three:
//
//   * `milestone_identity` — a milestone token under the SHARED union grammar
//     in `./milestone_token`. The union covers all three mint paths: the
//     Linear sequential form, the Jira Epic-keyed form, and the tracker-less
//     short-ULID form. Recognition rides that module and NEVER a private
//     numeric copy — a private pattern recognizes the sequential form and
//     silently misroutes the other two, which is the exact defect
//     AC-STE-497.2 forbids and which `milestone_token.test.ts`'s STE-335
//     consumer audit exists to catch.
//   * `fr_identity` — a tracker ref (`STE-497`, `DST-66`) or a minted id
//     (`fr_…`, validated through `ULID_REGEX` in `./ulid`).
//   * `feature_request` — everything else, which is the path `/deliver` has
//     always had. Recognition is anchored on the WHOLE argument, so prose that
//     merely mentions a token mid-sentence stays prose.
//
// Malformed identity-ish tokens (`M`, `M_`, `Mx`, `M5-extra`) are prose: the
// safe reading hands the operator the pipeline they have always had rather
// than refusing something the grammar never claimed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { isMilestoneToken } from "./milestone_token";
import { isStdinNonTty, renderRefusalMessage } from "./requires_input";
import { ULID_REGEX } from "./ulid";

/** What an operator can hand `/deliver`. */
export type DeliverArgumentKind =
  | "milestone_identity"
  | "fr_identity"
  | "feature_request";

/** The grammar's whole vocabulary, in routing-precedence order. */
export const DELIVER_ARGUMENT_KINDS: readonly DeliverArgumentKind[] = [
  "milestone_identity",
  "fr_identity",
  "feature_request",
] as const;

/**
 * A tracker ref as an operator types it: an uppercase team/project key, a
 * hyphen, and the issue number (`STE-497`, `DST-66`). Anchored — `M5-extra`
 * and `milestone-M5` are prose, not identities.
 */
const TRACKER_REF_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/;

/** True when the whole (trimmed) argument names an FR. */
function isFrIdentity(token: string): boolean {
  return TRACKER_REF_RE.test(token) || ULID_REGEX.test(token);
}

/** The verdict `classifyDeliverArgument` returns. */
export interface DeliverArgumentClassification {
  /** Which of the three kinds this argument is. */
  readonly kind: DeliverArgumentKind;
  /** The argument verbatim, as the operator typed it. */
  readonly raw: string;
  /** The recognized identity token, or `null` for a feature request. */
  readonly identity: string | null;
}

/**
 * Classify one `/deliver` argument. Surrounding whitespace is incidental — a
 * shell, a paste or a heredoc can add it — so recognition runs against the
 * trimmed argument while `raw` keeps what the operator actually typed.
 */
export function classifyDeliverArgument(
  raw: string,
): DeliverArgumentClassification {
  const token = raw.trim();
  if (isMilestoneToken(token)) {
    return { kind: "milestone_identity", raw, identity: token };
  }
  if (isFrIdentity(token)) {
    return { kind: "fr_identity", raw, identity: token };
  }
  return { kind: "feature_request", raw, identity: null };
}

// ===========================================================================
// Routing surface.
//
// Classification alone decides nothing an operator can see. `resolveDeliverArgument`
// below turns a classified argument into a routing: an identity is probed for
// the plan file it names and resolves against it, or it is REFUSED — never
// handed to the design phase, which exists for new work and nothing else.
// The probe is injected so the refusal path is testable without a fixture tree,
// and `defaultIdentityProbe` is the filesystem-backed one the skill uses.
// ===========================================================================

/** How an identity is turned into files on disk. Injectable for tests. */
export interface IdentityProbe {
  /** Absolute path of the plan file for a milestone token, or `null`. */
  locatePlan(milestone: string): string | null;
  /** Full text of the FR file for an FR identity, or `null`. */
  readFr(identity: string): string | null;
}

/** The design phase, as an observable side effect rather than an inference. */
export interface DeliverPhaseSink {
  enterDesign(request: string): void;
}

export interface ResolveDeliverArgumentInput {
  readonly raw: string;
  readonly probe: IdentityProbe;
  readonly phases?: DeliverPhaseSink;
  /**
   * Omit to DERIVE it from the process — that is the safe default and the one
   * you get by saying nothing. Pass a boolean only to test both branches.
   *
   * Defaulting this to `true` would be fail-open: a caller that forgot the flag
   * would resolve fully under `claude -p`, which is precisely what the non-tty
   * refusal exists to prevent.
   */
  readonly stdinIsTty?: boolean;
}

/** Where one `/deliver` argument routes. */
export interface DeliverRouting {
  readonly kind: DeliverArgumentKind;
  readonly identity: string | null;
  /** The milestone token this argument routes to, or `null`. */
  readonly milestone: string | null;
  /** Absolute path of the located plan file, or `null`. */
  readonly planPath: string | null;
  /** True only for the feature-request path. */
  readonly entersDesignPhase: boolean;
}

/**
 * The NFR-10 refusal `/deliver` raises rather than brainstorming an argument
 * it cannot deliver. Named so a caller can tell a `/deliver` routing refusal
 * apart from any other error that crosses the same boundary.
 */
export class DeliverArgumentRefusedError extends Error {
  override readonly name = "DeliverArgumentRefusedError";
}

/** First path in `candidates` that exists, else `null`. */
function firstExisting(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The filename stem an FR identity lives under, or `null` when the identity
 * names no representable file.
 *
 * Tracker refs are their own stem (`STE-497` → `STE-497.md`). A minted id is
 * stored under its SHORT tail — `id.slice(23, 29)`, the same offsets
 * `acPrefix` (`ac_prefix.ts`) uses and for the same reason: `ulid.ts` mints
 * monotonic ULIDs, so same-millisecond mints share their leading random chars
 * and only the tail is entropic.
 */
function frFileStem(identity: string): string | null {
  if (TRACKER_REF_RE.test(identity)) return identity;
  if (ULID_REGEX.test(identity)) return identity.slice(23, 29);
  return null;
}

/**
 * Build the filesystem-backed probe for a repo.
 *
 * Both lookups check the ACTIVE tree first and fall back to the archive.
 * `/implement` Phase 4 `git mv`s a closed milestone's plan and FRs into
 * `archive/`, so an active-only probe would report "no plan file" for every
 * milestone that has actually shipped — the loudest possible wrong answer.
 */
export function defaultIdentityProbe(repoRoot: string): IdentityProbe {
  const specsDir = join(repoRoot, "specs");
  return {
    locatePlan(milestone: string): string | null {
      // Guard the grammar before composing a path: an unvalidated token is a
      // path segment, and `..` is a well-formed one.
      if (!isMilestoneToken(milestone)) return null;
      return firstExisting([
        join(specsDir, "plan", `${milestone}.md`),
        join(specsDir, "plan", "archive", `${milestone}.md`),
      ]);
    },
    readFr(identity: string): string | null {
      const stem = frFileStem(identity);
      if (stem === null) return null;
      const path = firstExisting([
        join(specsDir, "frs", `${stem}.md`),
        join(specsDir, "frs", "archive", `${stem}.md`),
      ]);
      return path === null ? null : readFileSync(path, "utf-8");
    },
  };
}

/**
 * Render the routing refusal in the NFR-10 canonical shape.
 *
 * The three labelled lines are composed HERE rather than through
 * `requires_input`'s `renderRefusalMessage`, and that is a CHECKED decision,
 * not the missed reuse it looks like — especially in this file, which is the
 * one place both refusal envelopes coexist. `renderRefusalMessage` renders a
 * different class: its first line is `Verdict:`, not `Refusing:`, and it
 * appends the requires-input marker as a mandatory last line, which
 * `socratic_first_turn_stream.ts` scans assistant text for. Routing a ROUTING
 * refusal through it would make "this identity has no plan file" read to the
 * smoke harness as a first-turn requires-input refusal. `refuseNonTty` below
 * genuinely IS that class, so it — and only it — uses the shared envelope.
 * `pr_draft.ts` and `target_repo.ts` record the same decision for the same
 * two reasons.
 *
 * It names BOTH plausible intents. An operator who typed an identity meant one
 * of exactly two things — resume something that already exists, or start
 * something new — and a refusal that addresses only the first strands the
 * second reader with a dead end. The remedy for "I meant new work" is
 * concrete, because that is the path `/deliver` has always had.
 */
function refuse(parts: {
  verdict: string;
  context: string;
}): DeliverArgumentRefusedError {
  return new DeliverArgumentRefusedError(
    [
      `Refusing: ${parts.verdict}`,
      "Remedy: if you meant an existing milestone, check the identity — its " +
        "plan lives in `specs/plan/` or `specs/plan/archive/`; if you meant " +
        "to start new work, describe it in your own words as a feature " +
        "request instead, which is what the design phase is for.",
      `Context: ${parts.context}`,
    ].join("\n"),
  );
}

/** The non-tty refusal — the same gate the skill's FIRST ACTION states. */
function refuseNonTty(
  raw: string,
  kind: DeliverArgumentKind,
): DeliverArgumentRefusedError {
  return new DeliverArgumentRefusedError(
    renderRefusalMessage({
      verdict:
        "/deliver requires an interactive (tty) session; its Socratic " +
        "phases, worker approval gates and merge-policy prompts all need a " +
        "live operator. Recognizing an identity earns no carve-out — every " +
        "argument form refuses alike under non-interactive stdin.",
      remedy:
        "Re-run `/deliver` from an interactive terminal. The auto-approve " +
        "marker does not relax this gate.",
      context:
        `mode=deliver, phase=argument-routing, kind=${kind}, ` +
        `argument=${JSON.stringify(raw)}, stdin=non-tty`,
    }),
  );
}

/**
 * Resolve one `/deliver` argument to its routing, or refuse.
 *
 * Two claims live here, and the second is the one a naive reading drops: an
 * identity `/deliver` cannot deliver is REFUSED **and never falls through to
 * the design phase**. The design phase is a real side effect —
 * `phases.enterDesign(...)` — reached on the feature-request path ONLY, so
 * "never falls through" is observable rather than promised. Brainstorming a
 * milestone whose specs are already written (and often already merged) is the
 * shipped defect this ordering exists to prevent.
 */
export function resolveDeliverArgument(
  input: ResolveDeliverArgumentInput,
): DeliverRouting {
  const { raw, probe, phases } = input;
  // Derived, not defaulted — see the field's note. `??` and not `||` so an
  // explicit `false` survives.
  const stdinIsTty = input.stdinIsTty ?? !isStdinNonTty();
  const classification = classifyDeliverArgument(raw);

  // FIRST ACTION: the non-tty gate fires before any probe or phase is
  // touched, for every argument form — including identities that would
  // otherwise have resolved cleanly.
  if (!stdinIsTty) throw refuseNonTty(raw, classification.kind);

  if (classification.kind === "feature_request") {
    phases?.enterDesign(raw);
    return {
      kind: "feature_request",
      identity: null,
      milestone: null,
      planPath: null,
      entersDesignPhase: true,
    };
  }

  const identity = classification.identity!;
  let milestone: string;

  if (classification.kind === "milestone_identity") {
    milestone = identity;
  } else {
    const body = probe.readFr(identity);
    if (body === null) {
      throw refuse({
        verdict: `\`${identity}\` names no FR file on disk, so /deliver cannot tell which milestone it belongs to.`,
        context: `mode=deliver, phase=argument-routing, kind=fr_identity, identity=${identity}, fr=not-found`,
      });
    }
    // Through the shared frontmatter reader, so a CRLF- or BOM-authored FR
    // reads the same as an LF one rather than silently parsing as headerless.
    const frontmatter = parseFrontmatter(body, { lenient: true });
    const declared =
      typeof frontmatter.milestone === "string"
        ? frontmatter.milestone.trim()
        : "";
    if (!isMilestoneToken(declared)) {
      throw refuse({
        verdict: `\`${identity}\` declares no well-formed \`milestone:\` in its frontmatter, so /deliver cannot route it to a plan file.`,
        context: `mode=deliver, phase=argument-routing, kind=fr_identity, identity=${identity}, milestone=${declared === "" ? "(absent)" : declared}`,
      });
    }
    milestone = declared;
  }

  const planPath = probe.locatePlan(milestone);
  if (planPath === null) {
    throw refuse({
      verdict: `\`${identity}\` names no plan file on disk${milestone === identity ? "" : ` — it resolves to milestone \`${milestone}\`, which has none`}, so there is nothing for /deliver to deliver.`,
      context: `mode=deliver, phase=argument-routing, kind=${classification.kind}, identity=${identity}, milestone=${milestone}, plan=not-found`,
    });
  }

  return {
    kind: classification.kind,
    identity,
    milestone,
    planPath,
    entersDesignPhase: false,
  };
}

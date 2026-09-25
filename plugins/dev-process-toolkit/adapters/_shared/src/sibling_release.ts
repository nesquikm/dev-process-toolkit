// sibling_release — the one reader of a sibling repository's plan for a
// milestone (STE-588).
//
// A spanning milestone has a plan in each repository it names. This module
// finds the sibling's copy at either of its two homes — the live
// `specs/plan/<M>.md` and the archived `specs/plan/archive/<M>.md` — and reads
// its frontmatter through the shared parser, so CRLF and BOM fold once.
//
// It also holds refusal #4 (`siblingShipGate`, STE-589) and, for a repository
// with a shared-container `repo_tag`, the grade of the milestone's tracker
// children (`gradeChildren`, STE-610) — the undeclared side of a span, which
// the plan's `spans_repos:` alone cannot see.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DeclaredSibling,
  milestoneTrackerKeys,
  spanningSiblingState,
  trackerAdapterKey,
} from "./active_plan_ship_ready";
import { normalizeContainerItems, readJsonFile } from "./container_ownership";
import { readTrackerListing } from "./tracker_answer";
import { parseFrontmatter } from "./frontmatter";
import { milestoneIdFromLinearMilestone } from "./milestone_token";
import { SPANS_REPOS_KEY, SpansReposError, readSpansReposDeclaration } from "./spans_repos";
import { isToolkitManaged } from "./toolkit_managed";
import { oneLine } from "./tracker_receipts";
import { readWorkspaceBinding, type WorkspaceAdapterKey } from "./workspace_binding";

/**
 * The bare version (`1.4.0`) a `shipped_in:` value records, or `null` when it
 * is not a well-formed `v<X.Y.Z>` stamp — absent, `null`, empty, or malformed.
 *
 * WHY THIS LIVES HERE AND NOT IN `plan_ship_stamp.ts`, beside the writer whose
 * stamp it reads. This module is reachable, so importing `plan_ship_stamp.ts`
 * from here makes that module TRANSITIVELY reachable, and probe #81's
 * ordered-unreachable count drops from 129 to 128: `/ship-milestone` step 7's
 * order to run `stampShippedIn` stops counting. Yet no reader gains an order
 * they can execute by hand — the property probe #81 protects is unchanged, only
 * its import-topology proxy moves — so that drop is an artifact, and recording
 * it would cost a two-commit ledger landing for no real gain (decided
 * 2026-09-10, milestone M_79b1f6). Do not hoist it without reading that first.
 * The three private `STAMP_RE` copies elsewhere stay where they are; a guard in
 * the STE-589 suite pins their definitions.
 */
export function shipStampVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^v(\d+\.\d+\.\d+)$/.exec(value.trim())?.[1] ?? null;
}

/** What `/ship-milestone`'s refusal #4 hands back to the front door. */
export interface SiblingShipGateResult {
  /** `null` when the gate passes; otherwise the three-line house refusal. */
  readonly refusal: string | null;
  /**
   * One `Spans: <name>@<value>` line per non-self declared sibling; empty when
   * the gate refuses, since a refused run makes no commit to carry it.
   */
  readonly footer: string[];
  /**
   * One line per sibling that could not be located, so was not checked. A
   * release reaches these only under `--partial`: without it such a sibling
   * refuses (STE-609).
   */
  readonly unchecked: string[];
}

/**
 * Refusal #4: refuse a release while any declared sibling is not proved `idle`
 * (STE-609: busy, not-started, no-plan, unlocatable, not-a-repository,
 * not-toolkit-managed, different-container or unreadable), or while a
 * sibling's own `spans_repos:` declaration refuses from its root — unless
 * `partial` is set. The predicate is THE sibling predicate,
 * `spanningSiblingState` — never "the sibling has not shipped".
 */
export async function siblingShipGate(input: {
  projectRoot: string;
  planBody: string;
  milestone: string;
  partial: boolean;
}): Promise<SiblingShipGateResult> {
  const { projectRoot, planBody, milestone, partial } = input;
  // One read feeds the decision, the ids the refusal names, the footer and the
  // not-checked lines.
  let state: Awaited<ReturnType<typeof spanningSiblingState>>;
  try {
    state = await spanningSiblingState(projectRoot, planBody, milestone);
  } catch (error) {
    if (!(error instanceof SpansReposError)) throw error;
    // A malformed declaration refuses with the reader's own words — its bodies
    // spliced into this skill's shape, one line per label.
    return {
      refusal: shipRefusal(
        `${milestone} declares a malformed ${SPANS_REPOS_KEY}: — ${refusalLine(error.message, "Refusing")}`,
        refusalLine(error.message, "Remedy"),
        `milestone=${milestone}, ${refusalLine(error.message, "Context")}`,
      ),
      footer: [],
      unchecked: [],
    };
  }
  const { busy, busySiblings, siblings } = state;
  // --partial leaves a second half pending; a plan naming no sibling has none.
  if (partial && siblings.length === 0) {
    return {
      refusal: shipRefusal(
        `--partial on ${milestone}, whose plan declares no sibling in ${SPANS_REPOS_KEY}: — there is no second half to leave pending`,
        `drop --partial to ship ${milestone} whole, or declare its sibling repositories under ${SPANS_REPOS_KEY}: in the plan`,
        `milestone=${milestone}, flag=--partial`,
      ),
      footer: [],
      unchecked: [],
    };
  }
  const unchecked = siblings
    .filter((s) => s.root === null)
    .map(
      (s) =>
        `/ship-milestone: sibling ${s.name} at ${s.declaredPath} could not be located — not checked for active FRs bound to ${milestone}`,
    );
  // Only `idle` releases without --partial (STE-609): every other state from
  // the one classification refuses, naming EVERY held sibling with its state
  // and a remedy of its own. The state is READ here, never re-derived. A busy
  // sibling names each active id with every source that holds it (a worktree,
  // a local branch or a remote-tracking ref) and keeps the sibling-wait verdict
  // prefix; it never hides another held sibling of the same span.
  const held = siblings.filter((s) => s.state !== "idle");
  if (held.length > 0 && !partial) {
    const byName = new Map(busySiblings.map((b) => [b.name, b]));
    const described = held.map((s) => {
      const b = byName.get(s.name);
      if (s.state === "busy" && b) {
        return `${s.name} is busy: ${b.activeFrIds.length} active FRs (${b.activeFrs
          .map((fr) => `${fr.id} in ${fr.sources.join(", ")}`)
          .join("; ")})`;
      }
      return `${s.name} at ${s.declaredPath} is ${s.state}${s.reason ? `: ${s.reason}` : ""}`;
    });
    const verdict = busy.length > 0
      ? `${milestone} spans a sibling that still holds active work — ${described.join("; ")}`
      : `${milestone} spans a sibling that cannot be proved idle — ${described.join("; ")}`;
    // Refused before any footer read: there is no commit for a footer to go on.
    return {
      refusal: shipRefusal(
        verdict,
        `${[...new Set(held.map((s) => heldRemedy(s, milestone)))].join("; ")}; or pass --partial to ship this repository's half alone`,
        `milestone=${milestone}, sibling=${held.map((s) => s.name).join(",")}, state=${held.map((s) => s.state).join(",")}`,
      ),
      footer: [],
      unchecked,
    };
  }
  // The footer is measured: each sibling's plan is read afresh, every call.
  const footer = await Promise.all(
    siblings.map(async (s) => {
      const plan = s.root === null ? null : await readSiblingPlan(s.root, milestone);
      const version = shipStampVersion(plan?.frontmatter.shipped_in);
      return `Spans: ${s.name}@${version === null ? "pending" : `v${version}`}`;
    }),
  );
  return { refusal: null, footer, unchecked };
}

/** A child listing read whole: every page's items, and whether its final page proves it is the last. */
interface JoinedListing {
  items: Record<string, unknown>[];
  last: boolean;
}

/**
 * A child listing may be one page, or the JSON array of every page the
 * tracker returned, in order (M_685ff6 review: a Linear project past one
 * 250-row page could never release). Every page is read by the shared reader
 * (`tracker_answer.ts`), so the one rule for "not the last" is its canonical
 * `next`: each page but the last must hand one, never one an earlier page
 * handed, and page n>1 must record as its `requestCursor` exactly the `next`
 * of page n-1. A page the reader cannot read, a broken chain or a key on two
 * pages is the reason the listing cannot be joined. Whether the FINAL page
 * proves it is the last is returned as `last`, for the caller to grade.
 */
function joinPages(listing: unknown, adapter: "jira" | "linear"): JoinedListing | { error: string } {
  if (Array.isArray(listing) && listing.length === 0) return { error: "it is an empty array of pages" };
  const r = readTrackerListing(adapter, Array.isArray(listing) ? listing : [listing]);
  return r.ok ? { items: r.items, last: r.last } : { error: r.reason };
}

/**
 * Named ONCE, at the single exit every sibling remedy passes through, rather
 * than inside each case — so a case added later inherits it and cannot
 * reintroduce the defect by omission.
 *
 * WHY IT EXISTS (live leg 7, 2026-09-24). Every remedy below names an act in
 * ANOTHER repository, and every one of them is good advice to a human operator,
 * who understands without being told that "in sibling X" means going there and
 * working as that repository. They became defects the moment the skill's rule 4
 * told every child to fix what a refusal names: `spans_repos.ts`'s equivalent
 * remedy said "write specs/plan/<M>.md in the sibling repository first", a
 * child rooted in A obeyed it literally, wrote into B, and the
 * `sibling-file-write` guard correctly flagged the run.
 *
 * Neither the child nor the guard was at fault. The remedy named WHAT must
 * exist and not WHO must create it, and the acts named here are larger than a
 * file write — bootstrapping a repository, binding FRs, editing another
 * repository's CLAUDE.md.
 *
 * The general form, which is the same finding as rule 4 invalidating the
 * predicates arriving from the other side: A RULE THAT MAKES CHILDREN ACT ON
 * PROSE TURNS EVERY PIECE OF PROSE THEY CAN REACH INTO AN INTERFACE. None of
 * this toolkit's NFR-10 remedies were written as one.
 */
export const FROM_ITS_OWN_SESSION = " — the sibling's own operator does this from that repository's session, never from here";

/** Refusal #4's remedy for one held (non-idle) sibling — one per state. */
/**
 * The states whose remedy is an act on THIS repository, so the actor clause
 * would misdirect rather than clarify.
 *
 * Named as a SET rather than tested as "not idle", because the general rule —
 * these remedies name acts in another repository — is true of eight of the ten
 * and false of two, and a blanket append tells the reader to go elsewhere for a
 * change only they can make, in a file only they own. That is worse than the
 * defect being fixed: the original wording was right and under-specified; a
 * blanket clause makes it wrong.
 *
 *   idle             — no act at all, the remedy is empty
 *   unlocatable      — correct THIS repository's `spans_repos:` path
 *   not-a-repository — point THIS repository's `spans_repos:` path elsewhere
 *
 * A state added later that is genuinely local joins this set deliberately,
 * rather than inheriting a clause that sends its reader away.
 */
const LOCAL_ACT_STATES: ReadonlySet<string> = new Set(["idle", "unlocatable", "not-a-repository"]);

export function heldRemedy(s: DeclaredSibling, milestone: string): string {
  const mixed = MIXED_REMEDIES[s.state];
  if (mixed) return `${mixed.sibling(s)}${FROM_ITS_OWN_SESSION}; or, in this repository, ${mixed.local(s)}`;
  const act = heldRemedyAct(s, milestone);
  return LOCAL_ACT_STATES.has(s.state) ? act : `${act}${FROM_ITS_OWN_SESSION}`;
}

/**
 * STE-616 — the two states whose remedy offers an act in the sibling OR an
 * edit to THIS repository's `spans_repos:`. A single clause appended at the end
 * sat after the local half and sent its reader away from a file only they own;
 * a per-state boolean cannot say "the first half is theirs, the second yours",
 * so each half is spelled separately and the clause is placed between them.
 */
const MIXED_REMEDIES: Readonly<Record<string, { sibling: (s: DeclaredSibling) => string; local: (s: DeclaredSibling) => string }>> = {
  "not-toolkit-managed": {
    sibling: (s) => `run /dev-process-toolkit:setup in sibling ${s.name}`,
    local: () => `point its path under ${SPANS_REPOS_KEY}: at the toolkit-managed checkout`,
  },
  "different-container": {
    sibling: (s) => `bind sibling ${s.name} to this repository's tracker project in its CLAUDE.md`,
    local: () => `drop it from ${SPANS_REPOS_KEY}:`,
  },
};

/** The act each held state calls for, WITHOUT the actor clause `heldRemedy` appends. */
function heldRemedyAct(s: DeclaredSibling, milestone: string): string {
  switch (s.state) {
    case "busy":
      return `finish sibling ${s.name}'s active FRs bound to ${milestone}`;
    case "not-started":
      return `start ${milestone} in sibling ${s.name}: bind at least one FR to it and finish it`;
    case "no-plan":
      return `add the plan specs/plan/${milestone}.md to sibling ${s.name}`;
    case "unlocatable":
      return `correct ${s.name}'s path under ${SPANS_REPOS_KEY}: (a relative path resolves against the main worktree root), or check the sibling out at ${s.declaredPath}`;
    case "not-a-repository":
      return `point ${s.name}'s path under ${SPANS_REPOS_KEY}: at the sibling's git checkout, not a plain directory`;
    case "not-toolkit-managed":
    case "different-container":
      // Mixed: rendered from MIXED_REMEDIES by `heldRemedy`, never from here.
      return "";
    case "unreadable":
      return `repair sibling ${s.name} so it can be read — every git worktree, branch and remote-tracking ref, and its CLAUDE.md tracker declaration`;
    case "one-sided":
      return `declare this repository in sibling ${s.name}'s plan: run \`bun run \${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/spans_repos.ts <planFile> ${milestone} --declare <siblingPath>\` so its ${SPANS_REPOS_KEY}: names this repository back (if that plan's ${SPANS_REPOS_KEY}: names another repository instead, correct it there first)`;
    case "idle":
      return "";
  }
}

/**
 * The reason a sibling leg reports when the LOCAL plan's declaration refuses
 * to parse. `refusal` is the parser's NFR-10 message; its `Refusing:` line is
 * carried after `malformed <key>`. The key is spelled here, not borrowed from
 * the refusal's wording — a refusal that already leads with the key is not
 * repeated.
 */
export function malformedDeclarationReason(milestone: string, refusal: string): string {
  const refusing = refusalLine(refusal, "Refusing");
  const detail = refusing.startsWith(SPANS_REPOS_KEY)
    ? refusing.slice(SPANS_REPOS_KEY.length)
    : `: ${refusing}`;
  return `cannot grade the sibling half of ${milestone}: malformed ${SPANS_REPOS_KEY}${detail}`;
}

/**
 * The body of one labelled line of an NFR-10 refusal — its `Refusing:`,
 * `Remedy:` or `Context:` line — without the label, or `""` when the refusal
 * carries no such line. A row splices a BODY into its own shape, never the whole
 * three-line refusal, so it keeps exactly one line per label.
 */
export function refusalLine(refusal: string, label: "Refusing" | "Remedy" | "Context"): string {
  const prefix = `${label}: `;
  const line = refusal.split("\n").find((l) => l.startsWith(prefix));
  return line === undefined ? "" : line.slice(prefix.length);
}

/**
 * This skill's NFR-10 three-line refusal: `/ship-milestone: <verdict>`,
 * `Remedy: <remedy>`, `Context: <context>, skill=ship-milestone`. Every refusal
 * the gate and its front door emit is built here, so the labels, the skill
 * prefix and the trailing `skill=` key are spelled once.
 */
function shipRefusal(verdict: string, remedy: string, context: string): string {
  return [
    // Each line is flattened: its parts carry sibling-controlled text (FR ids
    // from filenames, paths, reasons), which must never start a line of its own.
    `/ship-milestone: ${oneLine(verdict)}`,
    `Remedy: ${oneLine(remedy)}`,
    `Context: ${oneLine(context)}, skill=ship-milestone`,
  ].join("\n");
}

/** What the children check (STE-610) hands back to the front door. */
export interface ChildrenGrade {
  /** `null` when the listing is complete and every child is accounted for. */
  readonly refusal: string | null;
  /** The milestone's children read from the listing, or `null` when it could not be read. */
  readonly count: number | null;
}

/**
 * The phrase a refusal carries when this module rejected its INPUT LISTING and
 * therefore never reached a release decision.
 *
 * Exported so the live grader can tell "refused on its input" from "reached the
 * decision and refused on a sibling" WITHOUT matching prose it does not own.
 * Both refusals exit 1, so the exit code cannot separate them, and a predicate
 * that cannot tell them apart grades a non-event — which failed S5's permit
 * twin on live leg 6 after the child read two refusals, fixed what each named,
 * and succeeded on its third attempt.
 */
export const CHILD_LISTING_REJECTED = "'s child listing cannot prove it is complete —";

/**
 * Grade the undeclared side of a shared-container release (STE-610): the
 * milestone's children as the tracker listed them — a Jira Epic's child issues,
 * or a Linear project's issues filtered to the milestone by their
 * project-milestone id. The listing refuses when it is malformed, not the last
 * page, empty, or missing
 * any of `ownKeys` (this repository's FR tickets bound to the milestone are
 * children by construction). A child carrying neither `repoTag` nor a
 * `declaredTags` entry refuses unless `partial` is set.
 */
export function gradeChildren(input: {
  listing: unknown;
  adapter: WorkspaceAdapterKey;
  milestone: string;
  repoTag: string;
  declaredTags: readonly string[];
  ownKeys: readonly string[];
  partial: boolean;
  source: string;
}): ChildrenGrade {
  const { adapter, milestone, repoTag, declaredTags, ownKeys, partial, source } = input;
  const context = `milestone=${milestone}, listing=${source}, adapter=${adapter}`;
  const incomplete = (verdict: string, count: number | null): ChildrenGrade => ({
    refusal: shipRefusal(
      `${milestone}${CHILD_LISTING_REJECTED} ${verdict}`,
      `save ${milestone}'s children as the tracker returns them — one page, or the JSON array of every page in order (Linear: page with \`cursor\` until \`hasNextPage\` is false, with \`includeArchived: true\`) — and pass it as --children <listingFile>`,
      context,
    ),
    count,
  });
  const joined = joinPages(input.listing, adapter === "jira" ? "jira" : "linear");
  if ("error" in joined) return incomplete(joined.error, null);
  // A Linear project's issues belong to the milestone only when their
  // milestone identifier derives to its token: the tracker has no such filter.
  const items =
    adapter === "linear"
      ? joined.items.filter((row) => {
          const id = (row as { projectMilestone?: { id?: unknown } | null }).projectMilestone?.id;
          try {
            return typeof id === "string" && milestoneIdFromLinearMilestone(id) === milestone;
          } catch {
            return false;
          }
        })
      : joined.items;
  let children: ReturnType<typeof normalizeContainerItems>;
  try {
    children = normalizeContainerItems(items, adapter, true);
  } catch (error) {
    return incomplete(`it is malformed: ${(error as Error).message}`, null);
  }
  // A release reads completeness from the page's OWN signal, through the one
  // rule every reader shares (`tracker_answer.ts`, which container_ownership's
  // pageIsLast also reads): a final page that does not prove it is the last
  // has not proved the child list complete.
  if (!joined.last) {
    return incomplete("its final page does not prove it is the last page of the listing (Jira `isLast: true` or wrapped `hasNextPage: false`, Linear `hasNextPage: false`)", null);
  }
  if (children.length === 0) {
    return incomplete("children=0 — a release needs at least one archived FR, whose ticket is a child", 0);
  }
  const keys = new Set(children.map((c) => c.key));
  const missing = ownKeys.filter((k) => !keys.has(k));
  if (missing.length > 0) {
    return incomplete(
      `it omits this repository's own FR tickets bound to ${milestone}: ${missing.map(oneLine).join(", ")}`,
      children.length,
    );
  }
  const accounted = new Set([repoTag, ...declaredTags]);
  const foreign = children.filter((c) => !c.labels.some((l) => accounted.has(l)));
  if (foreign.length > 0 && !partial) {
    return {
      refusal: shipRefusal(
        `${milestone} has children carrying neither this repository's tag nor a declared sibling's — ${foreign
          .map((c) => `${oneLine(c.key)} (labels: ${c.labels.length > 0 ? c.labels.map(oneLine).join(", ") : "none"})`)
          .join("; ")}`,
        `declare each child's repository under ${SPANS_REPOS_KEY}: in the plan, move the child out of ${milestone}, or pass --partial to ship this repository's half alone`,
        `${context}, children=${children.length}, unaccounted=${foreign.map((c) => oneLine(c.key)).join(",")}`,
      ),
      count: children.length,
    };
  }
  return { refusal: null, count: children.length };
}

/**
 * This repository's shared-container binding — its adapter and `repo_tag` —
 * or `null` when it has none (not toolkit-managed, mode none, or no `repo_tag`).
 */
function sharedBinding(projectRoot: string): { adapter: WorkspaceAdapterKey; repoTag: string } | null {
  if (!isToolkitManaged(projectRoot)) return null;
  const adapter = trackerAdapterKey(projectRoot);
  if (adapter === null) return null;
  const binding = readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  return binding.shared && binding.repoTag !== undefined ? { adapter, repoTag: binding.repoTag } : null;
}

/** A sibling repository's plan for one milestone, as read from disk. */
export interface SiblingPlan {
  /** Absolute path of the plan file that was read. */
  readonly file: string;
  /** The plan body, verbatim. */
  readonly body: string;
  /** The plan's frontmatter, read leniently through the shared parser. */
  readonly frontmatter: Record<string, unknown>;
}

/** The sibling's two plan paths for `milestone`: archived first, then live. */
export function siblingPlanPaths(siblingRoot: string, milestone: string): string[] {
  const name = `${milestone}.md`;
  return [
    join(siblingRoot, "specs", "plan", "archive", name),
    join(siblingRoot, "specs", "plan", name),
  ];
}

/**
 * Read the sibling's plan for `milestone` from whichever of its two paths
 * holds one, or `null` when neither does.
 */
export async function readSiblingPlan(
  siblingRoot: string,
  milestone: string,
): Promise<SiblingPlan | null> {
  for (const file of siblingPlanPaths(siblingRoot, milestone)) {
    let body: string;
    try {
      body = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    return { file, body, frontmatter: parseFrontmatter(body, { lenient: true }) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Front door (STE-589): refusal #4, as `/ship-milestone` orders it.
//
//   bun run adapters/_shared/src/sibling_release.ts <projectRoot> <planFile> <milestone> [--partial]
//     [--children <listingFile> | --offer]
//
// Refused: the refusal on stderr, empty stdout, exit 1. Otherwise: one
// `Spans:` line per non-self sibling on stdout, one not-checked line per
// unlocatable sibling on stderr (reachable only under --partial — without it
// an unlocatable sibling refuses), exit 0. In a repository with a `repo_tag`
// (STE-610) a release run passes `--children` and an offer surface `--offer`;
// one stderr line `children=<n>` or `children=not checked (offer)` follows.
// Without a `repo_tag` neither flag is required or read. Under `import` this
// block does not run, so the module stays side-effect free.
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const [projectRoot, planFile, milestone, ...rest] = process.argv.slice(2);
  if (projectRoot === undefined || planFile === undefined || milestone === undefined) {
    console.error(
      shipRefusal(
        "refusal #4 needs a project root, a plan file and a milestone.",
        "bun run adapters/_shared/src/sibling_release.ts <projectRoot> <planFile> <milestone> [--partial]",
        "phase=sibling-ship-gate, argv=incomplete",
      ),
    );
    process.exitCode = 1;
  } else {
    const planBody = await readFile(planFile, "utf-8").catch(() => null);
    const partial = rest.includes("--partial");
    const offer = rest.includes("--offer");
    const at = rest.indexOf("--children");
    const listingFile = at < 0 ? undefined : rest[at + 1] ?? "";
    let shared: ReturnType<typeof sharedBinding> = null;
    let bindingError: string | null = null;
    try {
      shared = sharedBinding(projectRoot);
    } catch (error) {
      bindingError = (error as Error).message;
    }
    if (planBody === null) {
      console.error(
        shipRefusal(
          `refusal #4 cannot read the plan file ${planFile}.`,
          "pass the path of the milestone's plan, live or archived, then re-run",
          `milestone=${milestone}, phase=sibling-ship-gate`,
        ),
      );
      process.exitCode = 1;
    } else if (bindingError !== null) {
      console.error(
        shipRefusal(
          `refusal #4 cannot read this repository's shared-container binding: ${bindingError}`,
          "repair the tracker sub-section of CLAUDE.md, then re-run",
          `milestone=${milestone}, phase=sibling-ship-gate`,
        ),
      );
      process.exitCode = 1;
    } else if (shared !== null && listingFile === undefined && !offer) {
      console.error(
        shipRefusal(
          `${milestone} is released from a shared tracker container, so refusal #4 must grade its children.`,
          "a release passes --children <listingFile> (the milestone's children as the tracker returns them); an offer surface passes --offer",
          `milestone=${milestone}, repo_tag=${shared.repoTag}, phase=sibling-ship-gate`,
        ),
      );
      process.exitCode = 1;
    } else {
      const result = await siblingShipGate({ projectRoot, planBody, milestone, partial });
      let children: ChildrenGrade | null = null;
      if (result.refusal === null && shared !== null && listingFile !== undefined) {
        let listing: unknown;
        try {
          listing = readJsonFile(listingFile, "child listing");
        } catch (error) {
          children = {
            refusal: shipRefusal(
              `${milestone}'s child listing cannot be read — ${(error as Error).message}`,
              "save the milestone's children as the tracker returns them and pass that file as --children <listingFile>",
              `milestone=${milestone}, listing=${listingFile}`,
            ),
            count: null,
          };
        }
        children ??= gradeChildren({
          listing,
          adapter: shared.adapter,
          milestone,
          repoTag: shared.repoTag,
          declaredTags: (readSpansReposDeclaration(planBody).entries ?? []).map((e) => e.name),
          ownKeys: await milestoneTrackerKeys(projectRoot, milestone),
          partial,
          source: listingFile,
        });
      }
      const refusal = result.refusal ?? children?.refusal ?? null;
      if (refusal !== null) {
        console.error(refusal);
        process.exitCode = 1;
      } else {
        for (const line of result.footer) console.log(line);
        for (const line of result.unchecked) console.error(line);
        if (children !== null) console.error(`children=${children.count}`);
        else if (shared !== null) console.error("children=not checked (offer)");
      }
    }
  }
}

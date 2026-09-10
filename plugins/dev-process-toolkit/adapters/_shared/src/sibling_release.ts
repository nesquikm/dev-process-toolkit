// sibling_release — the one reader of a sibling repository's plan for a
// milestone (STE-588).
//
// A spanning milestone has a plan in each repository it names. This module
// finds the sibling's copy at either of its two homes — the live
// `specs/plan/<M>.md` and the archived `specs/plan/archive/<M>.md` — and reads
// its frontmatter through the shared parser, so CRLF and BOM fold once.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spanningSiblingState } from "./active_plan_ship_ready";
import { parseFrontmatter } from "./frontmatter";
import { SPANS_REPOS_KEY, SpansReposError } from "./spans_repos";

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
  /** One line per sibling that could not be located, so was not checked. */
  readonly unchecked: string[];
}

/**
 * Refusal #4: refuse a release while a declared sibling still holds active FRs
 * bound to `milestone`, unless `partial` is set. The predicate is THE sibling
 * predicate, `spanningSiblingState` — never "the sibling has not shipped".
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
  if (busy.length > 0 && !partial) {
    const holding = busySiblings
      .map((s) => `${s.name}: ${s.activeFrIds.length} active FRs (${s.activeFrIds.join(", ")})`)
      .join("; ");
    // Refused before any footer read: there is no commit for a footer to go on.
    return {
      refusal: shipRefusal(
        `${milestone} spans a sibling that still holds active work — ${holding}`,
        `finish the sibling's active FRs first, or pass --partial to ship this repository's half alone`,
        `milestone=${milestone}`,
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
    `/ship-milestone: ${verdict}`,
    `Remedy: ${remedy}`,
    `Context: ${context}, skill=ship-milestone`,
  ].join("\n");
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
//
// Refused: the refusal on stderr, empty stdout, exit 1. Otherwise: one
// `Spans:` line per non-self sibling on stdout, one not-checked line per
// unlocatable sibling on stderr, exit 0. Under `import` this block does not
// run, so the module stays side-effect free.
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
    if (planBody === null) {
      console.error(
        shipRefusal(
          `refusal #4 cannot read the plan file ${planFile}.`,
          "pass the path of the milestone's plan, live or archived, then re-run",
          `milestone=${milestone}, phase=sibling-ship-gate`,
        ),
      );
      process.exitCode = 1;
    } else {
      const result = await siblingShipGate({
        projectRoot,
        planBody,
        milestone,
        partial: rest.includes("--partial"),
      });
      if (result.refusal !== null) {
        console.error(result.refusal);
        process.exitCode = 1;
      } else {
        for (const line of result.footer) console.log(line);
        for (const line of result.unchecked) console.error(line);
      }
    }
  }
}

// continuation_offer (STE-551) — a skill does not offer to run the step whose
// answer is already on the record.
//
// THE DEFECT, measured on this tree. Seven shipped closes end by offering, or
// printing, the step that comes next — `/brainstorm`'s "or I can start now",
// `/spec-write`'s closing `Next:` recommendation, `/implement`'s ship-ready
// close and its Phase 5 chain prompt, `/ship-milestone`'s "not automated"
// notice and its ceremony-PR prompt, and `/spec-archive`'s trailing `Next:`
// line. Every one of them is correct when a person is choosing. Under an
// orchestrator the same seven ask a question that was answered in the kickoff
// before the stage started: the chain already names the step.
//
// SIX OF THE SEVEN COST A TURN. THE SEVENTH IS A CORRECTNESS DEFECT. The
// FR-scoped last-active chain is `/implement -> /spec-archive ->
// /ship-milestone -> /pr`, and `/implement`'s own ship-ready offer runs
// `/spec-archive` and `/ship-milestone` itself when accepted. Both surfaces
// claim the close ceremony, so it runs TWICE — once because the chain named it
// and once because the offer asked. Neither surface can see that on its own,
// which is why the count in `closeCeremonyExecutions` is taken across a
// modelled RUN rather than read off either one.
//
// WHY A BRANCH AND NOT A DELETION. The offers were never wrong; they were
// unconditional. A person who runs `/brainstorm` alone should still be asked
// before specs get written, and deleting the prompt would remove a real gate
// rather than a redundant one. So the standalone path is untouched, byte for
// byte, and the driven path is the only thing this module adds.
//
// THREE PROPERTIES ARE LOAD-BEARING.
//
//   * ONE READER OF THE LITERAL. `offerFires` delegates to `isDrivenRun` and
//     never greps the marker itself. A second reader spelled out here would
//     agree today and stop agreeing the day the literal moves — the drift the
//     one-owner indirection exists to prevent. Asserted behaviourally over a
//     matrix, and by this module's source carrying no second copy.
//   * THE REGISTRY IS THE ONLY LIST. Every offer is named once, with the
//     shipped anchor it owns and the file that anchor lives in, so the scanner
//     grades the surfaces the registry claims to describe rather than a second
//     list hand-typed beside it. A registry that drifts off its surfaces
//     reddens instead of passing quietly.
//   * SUPPRESSION OMITS THE OFFER, NEVER THE STEP. `modelRun` executes the
//     chain either way: what the driven branch removes is the question, not
//     the work. An implementation that dropped the step along with the prompt
//     would satisfy "no offer" and break the run.
//
// AUTHORIZES NOTHING, exactly as the signal it reads authorizes nothing.
// Omitting an offer skips a question whose answer the orchestrator already
// supplied; it never approves a commit, a push, a merge, or a gate. That is
// why a forged marker is uninteresting here — a user who pastes the literal
// into their own prompt has asked for the chain to proceed and gets it.
//
// The runtime half is pure (ids and invocation TEXT in, booleans and modelled
// runs out). The scanner half reads SKILL.md bodies off disk and does nothing
// else: no git, no network, no child processes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isDrivenRun } from "./driven_run_signal";

// ---------------------------------------------------------------------------
// The registry (AC-STE-551.1 .. AC-STE-551.6)
// ---------------------------------------------------------------------------

/**
 * The two steps `/implement`'s ship-ready offer runs when it is accepted —
 * and, verbatim, the tail of the FR-scoped chain an orchestrator already
 * names. Stated once because the double-run in AC-STE-551.4 is precisely the
 * case where both readings are the same two steps.
 */
export const CLOSE_CEREMONY: readonly string[] = ["/spec-archive", "/ship-milestone"];

/** One shipped close that offers, or prints, the step that comes next. */
export interface ContinuationOffer {
  /** Stable id — what a mutation leg names, and what a violation cites. */
  readonly id: string;
  /** The skill that owns the offer, by directory name. */
  readonly skill: string;
  /** Repo-relative path of the surface, for a citable `file:line`. */
  readonly file: string;
  /**
   * The shipped prose the offer is made in, unique within its file. Anchors,
   * not line numbers: a line number is stale the next time anyone edits above
   * it, and a stale anchor is a red test rather than a silent mis-grade.
   */
  readonly anchor: string;
  /**
   * The chain steps the skill itself runs when the offer is ACCEPTED — empty
   * for the closes that only recommend a step to a human, who must then type
   * it. The distinction is the whole of the double-run: only an offer the
   * skill executes on its own can collide with a chain that names the same
   * step.
   */
  readonly runsWhenAccepted: readonly string[];
  /**
   * The chain steps this surface runs on the DRIVEN path — empty for every
   * offer whose step an orchestrator chain already names.
   *
   * A FIELD OF ITS OWN, not a view of `runsWhenAccepted`, because the two
   * answer opposite questions for the same surface: `implement_ship_ready_close`
   * runs the whole close ceremony when a person accepts it and must run NOTHING
   * when driven, and one field cannot say both. Without it a suppressed offer
   * was unmodelled — `modelRun` executed consequences only for an offer that
   * FIRED — so a clause telling the surface to "chain anyway" scored identically
   * to one that dropped its claim, which is exactly how three such clauses
   * shipped under a green suite.
   *
   * What the driven branch drops is the surface's CLAIM on the step, never the
   * step: the chain still runs it, once, under its own gates.
   */
  readonly runsWhenDriven: readonly string[];
  /** What the offer asks, in the operator's words. */
  readonly asks: string;
}

const skillFile = (skill: string): string =>
  `plugins/dev-process-toolkit/skills/${skill}/SKILL.md`;

/**
 * THE seven shipped offers, in file order within each skill.
 *
 * Two skills own two offers each, which is the case a file-level check cannot
 * see: a surface that adopted the driven branch for one of its two closes and
 * not the other reads as compliant to any `includes`, and as delinquent to the
 * span-scoped scanner below.
 */
export const CONTINUATION_OFFERS: readonly ContinuationOffer[] = [
  {
    id: "brainstorm_start_now",
    skill: "brainstorm",
    file: skillFile("brainstorm"),
    anchor: "or I can start now.",
    runsWhenAccepted: ["/spec-write"],
    runsWhenDriven: [],
    asks: "whether to run the spec-writing phase now instead of handing back",
  },
  {
    id: "spec_write_next_implement",
    skill: "spec-write",
    file: skillFile("spec-write"),
    anchor: "Next: Run `/dev-process-toolkit:implement M<N>` when specs are ready.",
    runsWhenAccepted: [],
    runsWhenDriven: [],
    asks: "which command a human should run once the specs are written",
  },
  {
    id: "implement_ship_ready_close",
    skill: "implement",
    file: skillFile("implement"),
    anchor: "is ship-ready — run the close ceremony now? [y/N]",
    runsWhenAccepted: CLOSE_CEREMONY,
    runsWhenDriven: [],
    asks: "whether to archive and ship the milestone now",
  },
  {
    id: "implement_phase5_close",
    skill: "implement",
    file: skillFile("implement"),
    anchor: "Run /ship-milestone M<N> now? (y/n):",
    runsWhenAccepted: ["/ship-milestone"],
    runsWhenDriven: [],
    asks: "whether to ship the milestone now",
  },
  {
    id: "ship_milestone_not_automated",
    skill: "ship-milestone",
    file: skillFile("ship-milestone"),
    anchor: "Next steps (not automated):",
    runsWhenAccepted: [],
    runsWhenDriven: [],
    asks: "what is left for a human to do by hand",
  },
  {
    id: "ship_milestone_ceremony_pr",
    skill: "ship-milestone",
    file: skillFile("ship-milestone"),
    anchor: "Open ceremony PR via /pr now? (y/n):",
    runsWhenAccepted: ["/pr"],
    runsWhenDriven: [],
    asks: "whether to open the ceremony PR now",
  },
  {
    id: "spec_archive_next",
    skill: "spec-archive",
    file: skillFile("spec-archive"),
    anchor: "Archived. Next: /ship-milestone M<N>",
    runsWhenAccepted: [],
    runsWhenDriven: [],
    asks: "which command a human should run after the archive commit",
  },
];

/** The offer registered under `id`, or `null` — never a default. */
export function continuationOffer(id: string): ContinuationOffer | null {
  return CONTINUATION_OFFERS.find((o) => o.id === id) ?? null;
}

/** Every offer one skill owns, in file order. */
export function offersForSkill(skill: string): readonly ContinuationOffer[] {
  return CONTINUATION_OFFERS.filter((o) => o.skill === skill);
}

/**
 * IS THIS OFFER MADE, for this invocation body? (AC-STE-551.1 .. .6)
 *
 * The one predicate every surface asks. It delegates to `isDrivenRun` rather
 * than greping the marker, so the literal keeps exactly one owner; the naming
 * exists only to give a close a word for what it is asking — "do I offer?" is
 * a different question from "am I driven?" even where today's answer is the
 * same byte. Should they ever come apart they come apart HERE, visibly, and
 * not in a forgotten grep at a call site.
 *
 * An unregistered id fires nothing: an offer that does not exist cannot be
 * made, and answering `true` there would invent a turn.
 */
export function offerFires(id: string, promptBody: string): boolean {
  if (continuationOffer(id) === null) return false;
  return !isDrivenRun(promptBody);
}

// ---------------------------------------------------------------------------
// The modelled run (AC-STE-551.4 / AC-STE-551.8)
//
// The defect lives BETWEEN two surfaces, so no reading of either one can see
// it: `/implement`'s prose cannot see the chain, and the chain cannot see the
// offer. What can see it is a run in which both are present, which is what
// this half models — a chain of steps, the body the run was invoked with, and
// which offers the run actually reached.
// ---------------------------------------------------------------------------

/** One step an orchestrator named, as `resumeChain` renders it. */
export interface ModelledRunStep {
  readonly skill: string;
  readonly target: string;
}

export interface ModelledRunInput {
  /** The chain the orchestrator named, in order. */
  readonly chain: readonly ModelledRunStep[];
  /** The invocation body every stage in the run was handed. */
  readonly promptBody: string;
  /**
   * The offers this run actually reaches — reachability is a real
   * precondition, not a formality: a run with no `/ship-milestone` step has no
   * ceremony-PR prompt to suppress.
   */
  readonly reachedOffers: readonly string[];
  /**
   * Offers restored to their UNGUARDED behaviour: they ignore the signal and
   * fire regardless, exactly as they do today. This is the control arm — a
   * "fixed" run that never differs from an unfixed one has proven nothing.
   */
  readonly restoredOffers?: readonly string[];
  /**
   * Registry entries swapped for the duration of this run, by id.
   *
   * THE ONE CONTROL LEVER for the driven path. The pre-fix arrangement — a
   * surface whose driven branch still PERFORMS the step its shipped clause
   * orders — is expressed as the registry saying exactly that and nothing else
   * about the run differing, which is what makes "this step runs once" a
   * measurement rather than a restatement. A `modelRun` that ignored the field
   * would leave every control arm at one execution, and every control arm would
   * then agree with its guarded arm for the wrong reason.
   */
  readonly offerOverrides?: readonly ContinuationOffer[];
}

export interface ModelledRunResult {
  /** Every chain step executed, in order, including repeats. */
  readonly executed: readonly string[];
  /** Every offer the operator was actually asked, in order, once each. */
  readonly operatorTurns: readonly string[];
}

const skillOf = (step: string): string => step.replace(/^\//, "");

/**
 * Execute the chain and record what the operator was asked.
 *
 * An offer fires when the run reaches it AND it is either restored or unfired
 * by the signal; a fired offer runs the steps it offered, which is how a
 * second execution of the close ceremony appears at all. A SUPPRESSED offer is
 * not inert: it runs `runsWhenDriven` and records no operator turn, which is
 * how a surface that keeps its claim on the driven path — the silent
 * double-run, costing nothing an operator could notice — becomes visible at
 * all.
 *
 * Each offer is taken at most once per run, question and consequence alike: a
 * step that executes twice does not re-ask a question the operator already
 * answered, nor re-take a consequence it already took, and without that bound
 * the counts would drift the moment a chain grew a repeat.
 */
export function modelRun(input: ModelledRunInput): ModelledRunResult {
  const executed: string[] = [];
  const operatorTurns: string[] = [];
  const reached = new Set(input.reachedOffers ?? []);
  const restored = new Set(input.restoredOffers ?? []);
  const overrides = new Map(
    (input.offerOverrides ?? []).map((offer) => [offer.id, offer] as const),
  );
  const taken = new Set<string>();

  // The registry, as this run sees it: overridden entries replace their
  // namesakes in place, and an override naming an offer the registry does not
  // carry is appended to its own skill rather than silently dropped.
  const offersFor = (skill: string): readonly ContinuationOffer[] => {
    const base = offersForSkill(skill).map((offer) => overrides.get(offer.id) ?? offer);
    const extra = [...overrides.values()].filter(
      (offer) => offer.skill === skill && !base.some((b) => b.id === offer.id),
    );
    return [...base, ...extra];
  };

  const execute = (step: string): void => {
    executed.push(step);
    for (const offer of offersFor(skillOf(step))) {
      if (!reached.has(offer.id) || taken.has(offer.id)) continue;
      const fires =
        restored.has(offer.id) || offerFires(offer.id, input.promptBody);
      taken.add(offer.id);
      if (fires) {
        operatorTurns.push(offer.id);
        for (const consequence of offer.runsWhenAccepted) execute(consequence);
        continue;
      }
      for (const consequence of offer.runsWhenDriven) execute(consequence);
    }
  };

  for (const step of input.chain) execute(step.skill);
  return { executed, operatorTurns };
}

/** How many times each chain step ran, across the whole modelled run. */
export function stepExecutionCounts(
  run: ModelledRunResult,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of run.executed) counts[step] = (counts[step] ?? 0) + 1;
  return counts;
}

/**
 * How many times the CLOSE CEREMONY ran — the count AC-STE-551.4 is about.
 *
 * Taken as the smallest per-step count rather than any one step's, because a
 * ceremony is only complete where every step of it ran: reading
 * `/ship-milestone` alone would score a run that archived twice and shipped
 * once as one clean ceremony.
 */
export function closeCeremonyExecutions(run: ModelledRunResult): number {
  const counts = stepExecutionCounts(run);
  return Math.min(...CLOSE_CEREMONY.map((step) => counts[step] ?? 0));
}

// ---------------------------------------------------------------------------
// The authoring half (AC-STE-551.7)
// ---------------------------------------------------------------------------

/**
 * THE clause every offering SKILL.md carries, stated here once.
 *
 * A shared literal with ONE OWNER, for the same reason the registry is one:
 * seven hand-written paraphrases of "don't ask when the answer is on the
 * record" are seven contracts that drift apart one reword at a time, and the
 * scanner below could then only grade whichever spelling it happened to know.
 *
 * ONE LINE, and appendable to an existing sentence, because two of the five
 * surfaces sit at the shipped line cap: the clause must be able to land
 * without costing a line. And byte-disjoint from the driven-SUPPRESSION clause
 * in `inline_terminal_block` IN BOTH DIRECTIONS — two clauses where one
 * contained the other would make both scanners' counts meaningless, since
 * every occurrence of the longer would score as an occurrence of the shorter.
 */
export const DRIVEN_OMISSION_CLAUSE =
  "Omit this offer when the invocation body carries the driven-run marker: " +
  "the step it offers was already fixed by the orchestrator that named it.";

/** How many times this authoring surface states the omission branch. */
export function drivenOmissionOccurrences(skillBody: string): number {
  return String(skillBody ?? "").split(DRIVEN_OMISSION_CLAUSE).length - 1;
}

/**
 * Does this surface document the branch for every offer it owns?
 *
 * Counted against what the file OWES, not against one, because a file-level
 * `includes` reports the half-adopted case — one of two closes branched — as
 * compliant, and that is exactly the regression the criterion is written
 * against.
 */
export function documentsDrivenOmission(skillBody: string, owed: number): boolean {
  return drivenOmissionOccurrences(skillBody) >= owed;
}

/** One offer whose shipped surface has not adopted the driven branch. */
export interface ContinuationOfferViolation {
  /** The offer, by registry id. */
  readonly offer: string;
  /** The skill that owns it. */
  readonly skill: string;
  /** Repo-relative path, for a citable `file:line`. */
  readonly file: string;
  /** 1-based line to cite — the offer's own anchor, where the branch is owed. */
  readonly line: number;
  /** Why this is a violation, in the operator's words. */
  readonly reason: string;
}

/**
 * The span of `body` an offer owns: from its anchor to the next offer's
 * anchor in the same file, or to the end of the file.
 *
 * SPANS, NOT A FILE-WIDE COUNT, because attribution is the whole point. A file
 * carrying one clause for its two closes is delinquent about a SPECIFIC one,
 * and a scanner that could only report "this file is one short" would send a
 * reader to re-read a close that is already correct. The consequence for an
 * author is the placement rule: the clause lands AFTER the anchor it belongs
 * to and before the next one.
 */
function offerSpan(body: string, offer: ContinuationOffer): string | null {
  const start = body.indexOf(offer.anchor);
  if (start < 0) return null;
  const after = start + offer.anchor.length;
  const bounds: number[] = [];
  for (const other of offersForSkill(offer.skill)) {
    if (other.id === offer.id) continue;
    const idx = body.indexOf(other.anchor, after);
    if (idx >= 0) bounds.push(idx);
  }
  return body.slice(start, bounds.length > 0 ? Math.min(...bounds) : body.length);
}

const lineOf = (body: string, index: number): number =>
  body.slice(0, Math.max(0, index)).split("\n").length;

/**
 * Every registered offer whose shipped SKILL.md has not adopted the branch.
 *
 * Two distinct failures, reported apart because they send a reader to
 * different places:
 *
 *   * THE ANCHOR IS GONE — the registry no longer describes the surface it
 *     claims to. Nothing can be graded about a close that has moved or been
 *     reworded, so this is reported first and the clause check for that offer
 *     is skipped rather than piling a second, misleading violation on top.
 *   * THE CLAUSE IS MISSING FROM THE OFFER'S SPAN — the close is still shipped
 *     and still unconditional.
 *
 * A path that does not exist is not a violation: a tree that does not carry a
 * skill cannot be delinquent about that skill's prose.
 */
export function scanContinuationOfferAdoption(
  projectRoot: string,
): ContinuationOfferViolation[] {
  const violations: ContinuationOfferViolation[] = [];
  const bodies = new Map<string, string | null>();

  for (const offer of CONTINUATION_OFFERS) {
    if (!bodies.has(offer.file)) {
      const abs = join(projectRoot, ...offer.file.split("/"));
      let body: string | null = null;
      if (existsSync(abs)) {
        try {
          body = readFileSync(abs, "utf-8");
        } catch {
          body = null; // an unreadable surface is not a violation
        }
      }
      bodies.set(offer.file, body);
    }
    const body = bodies.get(offer.file) ?? null;
    if (body === null) continue;

    const span = offerSpan(body, offer);
    if (span === null) {
      violations.push({
        offer: offer.id,
        skill: offer.skill,
        file: offer.file,
        line: Math.max(1, body.split("\n").length),
        reason:
          `\`${offer.id}\` names shipped prose that is no longer in ` +
          `\`${offer.file}\`: the offer moved or was reworded, so nothing ` +
          `here can grade whether it still asks when the answer is on the record`,
      });
      continue;
    }
    if (span.includes(DRIVEN_OMISSION_CLAUSE)) continue;
    violations.push({
      offer: offer.id,
      skill: offer.skill,
      file: offer.file,
      line: lineOf(body, body.indexOf(offer.anchor)),
      reason:
        `\`${offer.id}\` documents no driven branch: it still asks ${offer.asks} — a ` +
        `question the orchestrator's kickoff already answered — costing a ` +
        `turn, and where the chain names the same step, running it twice`,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// AC-STE-551.3, round 2 — the driven branch DROPS THE CLAIM, never performs
// the step.
//
// The audit found this FR's own clauses re-creating the double-run it exists
// to remove: three of the seven told the surface to perform, when driven, the
// step the orchestrator's chain already names. That is unreachable to
// everything above — a suppressed offer used to run nothing at all, so a
// clause saying "chain anyway" and one dropping its claim modelled
// identically.
//
// Two halves, because either alone ships the defect. A registry that says
// `runsWhenDriven: []` while the shipped clause still orders the step passes
// every modelled leg; a clause reworded while the registry keeps the step
// passes every prose leg. Both are graded, per offer, by name.
// ---------------------------------------------------------------------------

/** Every step any orchestrator chain names, deduped, in first-seen order. */
export function chainNamedSteps(
  chains: readonly (readonly string[])[],
): readonly string[] {
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const chain of chains) {
    for (const step of chain) {
      if (seen.has(step)) continue;
      seen.add(step);
      steps.push(step);
    }
  }
  return steps;
}

/** Repo-relative path of `/deliver`'s own surface — the one parsed below. */
const DELIVER_SKILL = skillFile("deliver");

/**
 * `/deliver`'s two INLINE phases, read off `/deliver`'s SKILL.md.
 *
 * The FR-scoped and milestone-scoped chains come from the shipped classifier,
 * but Phases 1–2 are named only in `/deliver`'s prose ("invoke
 * `/dev-process-toolkit:brainstorm` (Phase 1) … `/dev-process-toolkit:spec-write`
 * (Phase 2)"), so they are parsed rather than retyped: a hand-typed copy would
 * keep agreeing with a `/deliver` that had stopped running either one.
 *
 * THROWS when the surface is missing or the sentence no longer parses. An
 * empty return would be the same shape a healthy tree with no phases produces,
 * and every caller that unions this into its chain list would go quietly
 * vacuous — the exact failure this repository has recorded more than once.
 */
export function deliverInlinePhaseSteps(projectRoot: string): readonly string[] {
  const abs = join(projectRoot, ...DELIVER_SKILL.split("/"));
  if (!existsSync(abs)) {
    throw new Error(
      `cannot derive \`/deliver\`'s inline phases: ${DELIVER_SKILL} does not ` +
        `exist under \`${projectRoot}\``,
    );
  }
  const body = readFileSync(abs, "utf-8");
  const phases: { phase: number; step: string }[] = [];
  const pattern = /`\/dev-process-toolkit:([a-z][a-z0-9-]*)`[^`\n]*?\(Phase (\d+)\)/g;
  for (const match of body.matchAll(pattern)) {
    phases.push({ phase: Number(match[2]), step: `/${match[1]}` });
  }
  if (phases.length === 0) {
    throw new Error(
      `cannot derive \`/deliver\`'s inline phases: ${DELIVER_SKILL} names no ` +
        `\`(Phase N)\` step, so the sentence that declares them has moved`,
    );
  }
  phases.sort((a, b) => a.phase - b.phase);
  return chainNamedSteps([phases.map((p) => p.step)]);
}

/**
 * The PARAGRAPH one offer's driven clause lives in: from the clause occurrence
 * inside the offer's span to the next blank line, or `null` when the offer
 * documents no branch at all.
 *
 * Bounded at the paragraph rather than at the span, because the span of the
 * last offer in a file runs to the end of the file: a scanner reading that far
 * would score every later section's prose — other offers' rewrites, unrelated
 * chain documentation — against this one offer, and send a reader to fix a
 * close that was never wrong.
 */
export function drivenClauseParagraph(
  body: string,
  offer: ContinuationOffer,
): string | null {
  const span = offerSpan(body, offer);
  if (span === null) return null;
  const withinSpan = span.indexOf(DRIVEN_OMISSION_CLAUSE);
  if (withinSpan < 0) return null;
  const start = body.indexOf(offer.anchor) + withinSpan;
  const blank = body.indexOf("\n\n", start);
  return body.slice(start, blank < 0 ? body.length : blank);
}

/**
 * Verbs that MOVE the surface into the next step, and verbs that RUN it.
 *
 * Two shapes because the shipped orders take two: "Proceed straight into step
 * 3", "Chain straight into `/ship-milestone M<N>`", "Chain into `/pr`" all
 * carry the step as the object of `into`, while a bare "Run `/pr` now" names
 * it directly. The execution form deliberately allows only a short filler run
 * before the step token, so a printed hint (`Run: /ship-milestone M<N>`) and a
 * descriptive clause ("in a run whose chain already holds the push, the
 * `/pr` …") do not read as orders. Third-person forms ("the chain still runs
 * each step") never match: the bare imperative stem is required.
 */
const PERFORMANCE_PATTERNS: readonly RegExp[] = [
  /\b(?:proceed|chain|continue|carry on|go|move|hand off|hand back)\s+(?:straight\s+|right\s+|directly\s+|on\s+)?(?:into|to|with)\b[^.;\n—]*/gi,
  /\b(?:run|invoke|execute|open|start|launch|call|trigger|dispatch|perform)\s+(?:it\s+|them\s+|now\s+|straight\s+|right\s+)*`?\/[a-z][a-z0-9:-]*[^.;\n—]*/gi,
  // THE OBJECT IS NOT ALWAYS A SLASH TOKEN, and the measured miss is the one
  // that matters most: the clause carrying the milestone's real double-run
  // names its object in words ("run the close ceremony from here"), so a
  // pattern demanding `/step` scanned the affirmative revert of that very
  // clause clean. Audited 2026-09-05 across 13 rewordings; this is the arm
  // that closes the worst of them. Bare stem + whitespace is still required,
  // so "the chain still runs each step" and the printed hint "Run: /x" do not
  // match.
  /\b(?:run|invoke|execute|perform|start|repeat)\s+(?:it\s+|them\s+|now\s+)*(?:the|this|that|its|both)\s+(?:close\s+|release\s+|ship\s+|next\s+|same\s+)*(?:ceremony|ceremonies|step|steps|chain|phase|prompt|offer)\b[^.;\n—]*/gi,
];

/**
 * A negation GOVERNING the verb — the whole difference between the order and
 * the renunciation.
 *
 * "Do not chain into `/pr` from here either" and "Chain into `/pr` in the same
 * turn" contain the same verb and the same step; only the negation in front of
 * it decides which one the surface is being told to do. A negation that TRAILS
 * the verb ("Chain straight into `/ship-milestone` … never a gate") governs
 * something else entirely and must not clear the order, which is why this is
 * tested against the text BEFORE the match and only within its own sentence.
 */
const GOVERNING_NEGATION =
  // `rather than` and `instead of` are DELIBERATELY ABSENT, and their removal
  // is a correction rather than a tightening: they mark a CONTRAST whose
  // negation governs the discarded alternative, never the verb that follows.
  // "Rather than handing back, chain into `/pr` in the same turn" is a plain
  // affirmative order wearing a negation on the wrong clause, and it scanned
  // clean while it sat in this list (measured 2026-09-05).
  /\b(?:not|never|no|don't|doesn't|cannot|can't|without)\b/i;

/** Start index of the sentence containing `index`. */
const sentenceStart = (text: string, index: number): number => {
  const before = text.slice(0, index);
  let start = 0;
  for (const match of before.matchAll(/[.!?][`'")\]]*\s+/g)) {
    start = match.index + match[0].length;
  }
  const newline = before.lastIndexOf("\n");
  return Math.max(start, newline + 1);
};

/**
 * The offending substring, when this text ORDERS the surface to perform a
 * step — `null` when it does not.
 *
 * Returns the words themselves rather than a boolean so a violation is
 * readable at the point it is reported: "orders the surface to perform its
 * step when driven: Chain straight into `/ship-milestone M<N>` in the same
 * turn" sends an author to one sentence, where a bare `false` sends them to
 * re-read a whole surface.
 */
export function performanceDirectiveIn(text: string): string | null {
  const body = String(text ?? "");
  for (const pattern of PERFORMANCE_PATTERNS) {
    for (const match of body.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const at = match.index;
      const prefix = body.slice(sentenceStart(body, at), at);
      if (GOVERNING_NEGATION.test(prefix)) continue;
      const hit = match[0].replace(/[\s,]+$/, "");
      if (hit.length > 0) return hit;
    }
  }
  return null;
}

/** One offer whose driven path claims a step an orchestrator chain names. */
export interface DrivenClaimViolation {
  /** The offer, by registry id. */
  readonly offer: string;
  /** The skill that owns it. */
  readonly skill: string;
  /** Repo-relative path of the surface. */
  readonly file: string;
  /**
   * 1-based line to cite for a prose claim. `0` for a registry claim: the
   * subject there is the registry entry, not a position in the file, and a
   * plausible-looking line number would send a reader to prose that is fine.
   */
  readonly line: number;
  /** The chain-named step the driven path would run a second time. */
  readonly step: string;
  /** Which half found it: the registry entry, or the shipped clause. */
  readonly source: "registry" | "prose";
  /** Why this is a violation, in the operator's words. */
  readonly reason: string;
}

/** Every `/step` token named in a fragment of prose, in order. */
const stepTokensIn = (text: string): readonly string[] =>
  [...text.matchAll(/\/[a-z][a-z0-9-]*/g)].map((m) => m[0]);

/**
 * Registry half — every offer whose `runsWhenDriven` names a chain step.
 *
 * `offers` exists for the mutation legs: a control arm needs to state the
 * pre-fix registry and see it reported, and grading a hand-passed list through
 * the same code that grades the shipped one is the only way that report proves
 * anything about the shipped one.
 */
export function drivenRegistryClaims(
  chainSteps: readonly string[],
  offers: readonly ContinuationOffer[] = CONTINUATION_OFFERS,
): DrivenClaimViolation[] {
  const named = new Set(chainSteps);
  const violations: DrivenClaimViolation[] = [];
  for (const offer of offers) {
    for (const step of offer.runsWhenDriven ?? []) {
      if (!named.has(step)) continue;
      violations.push({
        offer: offer.id,
        skill: offer.skill,
        file: offer.file,
        line: 0,
        step,
        source: "registry",
        reason:
          `\`${offer.id}\` performs \`${step}\` on the driven path, and the ` +
          `orchestrator's chain already names \`${step}\`: the step would run ` +
          `twice, silently, at no operator turn — the double-run the driven ` +
          `branch exists to remove`,
      });
    }
  }
  return violations;
}

/**
 * Prose half — every shipped driven clause that ORDERS its surface to perform
 * a chain-named step.
 *
 * A directive naming nothing the chain names is not reported: this scan is
 * about the double-run, and widening it to every imperative in a driven clause
 * would bury the one finding that matters under prose that is merely brisk.
 * A missing surface, or an offer that documents no branch, is likewise not a
 * violation here — `scanContinuationOfferAdoption` owns both.
 */
export function scanDrivenClaimProse(
  projectRoot: string,
  chainSteps: readonly string[],
): DrivenClaimViolation[] {
  const named = new Set(chainSteps);
  const violations: DrivenClaimViolation[] = [];
  const bodies = new Map<string, string | null>();

  for (const offer of CONTINUATION_OFFERS) {
    if (!bodies.has(offer.file)) {
      const abs = join(projectRoot, ...offer.file.split("/"));
      let body: string | null = null;
      if (existsSync(abs)) {
        try {
          body = readFileSync(abs, "utf-8");
        } catch {
          body = null; // an unreadable surface is not a violation
        }
      }
      bodies.set(offer.file, body);
    }
    const body = bodies.get(offer.file) ?? null;
    if (body === null) continue;

    const paragraph = drivenClauseParagraph(body, offer);
    if (paragraph === null) continue;
    const hit = performanceDirectiveIn(paragraph);
    if (hit === null) continue;

    const step =
      stepTokensIn(hit).find((token) => named.has(token)) ??
      offer.runsWhenAccepted.find((token) => named.has(token)) ??
      null;
    if (step === null) continue;

    violations.push({
      offer: offer.id,
      skill: offer.skill,
      file: offer.file,
      line: lineOf(body, body.indexOf(hit)),
      step,
      source: "prose",
      reason:
        `\`${offer.id}\`'s driven clause orders the surface to perform ` +
        `\`${step}\` — "${hit}" — and the orchestrator's chain already names ` +
        `\`${step}\`: what the driven branch drops is this surface's claim on ` +
        `the step, never the step, so the order runs it a second time`,
    });
  }
  return violations;
}

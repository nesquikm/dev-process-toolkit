// deliver_decision — M133 STE-513: ONE runnable front door for every delivery
// decision `/deliver` makes before it spawns anything.
//
// The seven questions a `/deliver` run has to answer — what did the operator
// type, which repo does the milestone land in, where is the milestone being
// resumed from, what chain does that imply, what merge policy is in force,
// does the pre-spawn confirm gate relay, and under what name will the spawned
// worker be reachable — already have exactly one owner each.
// What did NOT exist was a way to ASK them all in one command: the skill prose
// re-derived the answers in narration, which is how a shipped answer and a
// narrated one drift apart without anything going red.
//
// This module decides NOTHING. It imports the seven owners, asks each its own
// question, and prints the answers as one labelled record. It carries no branch
// of its own over any of the five closed vocabularies (argument kinds, routes,
// resume states, merge policies, gate classes) — every such value arrives from
// the module that owns it, so a new member of any vocabulary is covered the day
// it ships rather than the day someone remembers this file.
//
// Read-only by construction: it spawns nothing, claims nothing, writes nothing
// and takes no lock. That is also why it passes `stdinIsTty: true` explicitly —
// `resolveDeliverArgument` refuses non-tty stdin because the INTERACTIVE
// pipeline needs a live operator for its Socratic phases and approval gates,
// and none of those exist here. A printer that inherited that gate could never
// be run by a test, a driver or a headless capture, which is the whole set of
// callers this command exists to serve.

import { readFileSync } from "node:fs";

import type { DeliverRouting } from "./deliver_argument";
import {
  defaultIdentityProbe,
  resolveDeliverArgument,
} from "./deliver_argument";
import { routeMilestone } from "./target_repo";
import type { ResumeChainStep } from "./resume_classifier";
import { classifyResume, resumeChain, stepLines } from "./resume_classifier";
import { readOrchestrationConfig } from "./orchestration_config";
import { runMergePolicy } from "./merge_policy_ratchet";
import { classifyGate, relayRequired } from "./gate_class";
import type { WorkerNameRule } from "./deliver_worker_name";
import {
  WorkerNameRefusedError,
  workerIdentitySegment,
  workerRemoteControlName,
} from "./deliver_worker_name";

// ---------------------------------------------------------------------------
// The record.
// ---------------------------------------------------------------------------

/**
 * The eight labelled fields, in the fixed order the record prints them.
 *
 * Exported because the order IS the contract: a consumer that wants to check a
 * record is complete, or to render one itself, reads this list rather than
 * retyping it and drifting.
 */
export const DECISION_FIELDS = [
  "argument_kind",
  "target_repo_route",
  "resume_state",
  "chain",
  "merge_policy",
  "gate_class",
  "gate_relays",
  "remote_control",
] as const;

export type DecisionField = (typeof DECISION_FIELDS)[number];

/** The one multi-line field: `chain:` on its own line, then the step lines. */
const CHAIN_FIELD: DecisionField = "chain";

/**
 * The gate this record reports on: `/deliver`'s pre-spawn chain-confirm gate,
 * the one the operator answers before any worker exists.
 */
export const CONFIRM_GATE = "deliver_chain_confirm";

/**
 * A step line carries its OWN placement — `  1. /implement M900 (worker)` —
 * the shape `resume_classifier` already renders resume plans in. Reused rather
 * than reinvented so the record and the plan an operator confirms read alike.
 */
const STEP_PLACEMENT_RE = /\((inline|worker)\)\s*$/;

/**
 * The NFR-10 refusal this command raises. Named so a caller can tell a decision
 * refusal apart from a routing refusal that crossed the same boundary — both
 * render the same three-line envelope, and only the name distinguishes them.
 */
export class DeliverDecisionError extends Error {
  override readonly name = "DeliverDecisionError";
}

/** The three line prefixes a canonical NFR-10 envelope always carries. */
const ENVELOPE_PREFIXES = ["Refusing: ", "Remedy: ", "Context: "] as const;

/** The canonical NFR-10 envelope: Refusing / Remedy / Context, in that order. */
function refuse(parts: {
  verdict: string;
  remedy: string;
  context: string;
}): DeliverDecisionError {
  return new DeliverDecisionError(
    [
      `${ENVELOPE_PREFIXES[0]}${parts.verdict}`,
      `${ENVELOPE_PREFIXES[1]}${parts.remedy}`,
      `${ENVELOPE_PREFIXES[2]}${parts.context}`,
    ].join("\n"),
  );
}

/** Does `message` already carry all three envelope lines? */
function carriesEnvelope(message: string): boolean {
  const lines = message.split("\n");
  return ENVELOPE_PREFIXES.every((prefix) =>
    lines.some((line) => line.startsWith(prefix)),
  );
}

/**
 * The envelope EVERY refusal this command prints must carry — including the
 * ones it did not raise itself.
 *
 * A refusal raised here or by a delegate arrives already enveloped and is
 * passed through untouched. A raw runtime failure does not: an argument that
 * resolves to a plan path which cannot be read (a directory where a file was
 * expected, a file the caller has no permission to open) reaches this boundary
 * as a bare `EACCES: ...`. That exits non-zero, which is half the promise, but
 * it is not the shape a caller can parse and not the shape the refusal contract
 * states — so it is wrapped rather than printed as it stands. The original text
 * is carried inside the verdict, so wrapping loses nothing.
 */
function envelopeFor(
  error: unknown,
  where: { argument: string | undefined; projectRoot: string },
): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (carriesEnvelope(raw)) return raw;
  return refuse({
    verdict:
      `the delivery decision record could not be assembled, and the failure ` +
      `arrived without a refusal of its own: ${raw}`,
    remedy:
      "check that the identity's specs are readable files in the project tree " +
      "you named, then re-run; if they are, this is a defect in the module " +
      "that failed and the text above is what to report.",
    context:
      `mode=deliver, phase=decision-record, argument=${JSON.stringify(
        where.argument ?? null,
      )}, projectRoot=${where.projectRoot}, refusal=unenveloped`,
  }).message;
}

/**
 * Render one decision record, or refuse.
 *
 * COMPLETENESS IS A REFUSAL, not a shorter record. A record with seven of eight
 * fields is the failure mode this exists to prevent: it reads as an answer, and
 * the field it dropped is exactly the one nobody then checks. So an absent or
 * blank field refuses, naming the field, and prints nothing at all.
 *
 * The chain field carries the same rule one level down: every step line must
 * name its own placement. A chain whose steps do not say where they run is a
 * chain an operator cannot confirm, so it is refused rather than printed.
 */
export function renderDecisionRecord(
  fields: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [];
  for (const field of DECISION_FIELDS) {
    const value = fields?.[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw refuse({
        verdict:
          `the delivery decision record carries no \`${field}\` field, and a ` +
          "record missing a field is a refusal, not a shorter record — a " +
          "partial record reads as an answer and hides the one question " +
          "nobody then asks.",
        remedy:
          `supply \`${field}\` from the module that owns that question, or ` +
          "do not render a record at all.",
        context: `mode=deliver, phase=decision-record, field=${field}, value=absent`,
      });
    }
    if (field !== CHAIN_FIELD) {
      lines.push(`${field}: ${value.trim()}`);
      continue;
    }
    const steps = value.split("\n").filter((line) => line.trim().length > 0);
    if (steps.length === 0) {
      throw refuse({
        verdict: `the \`${field}\` field carries no step lines, so the record states a chain nobody can run.`,
        remedy: `render \`${field}\` from the step list its owning module returns.`,
        context: `mode=deliver, phase=decision-record, field=${field}, steps=0`,
      });
    }
    for (const step of steps) {
      if (STEP_PLACEMENT_RE.test(step)) continue;
      throw refuse({
        verdict:
          `a \`${field}\` step line names no placement, so the record cannot ` +
          "say where that step runs — and a step whose placement is implied " +
          "is a step the operator confirms without seeing.",
        remedy:
          "render every step line with its own trailing placement, the shape " +
          "`  1. /skill TARGET (placement)` that resume plans already use.",
        context: `mode=deliver, phase=decision-record, field=${field}, step=${JSON.stringify(step)}`,
      });
    }
    lines.push(`${field}:`, ...steps);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The decision.
// ---------------------------------------------------------------------------

export interface DeliverDecisionInput {
  /** The argument as the operator typed it. */
  readonly argument: string | undefined;
  /** The project tree every question is asked about. */
  readonly projectRoot: string;
}

/**
 * The one line a degraded naming decision rides on, and the only line in the
 * record that carries the word "advisory".
 *
 * It opens with `#` rather than `advisory:` on purpose: every other line of the
 * record is `label: value`, and a ninth thing that parsed as a label would be
 * read as a ninth field by anything walking the labels.
 */
const ADVISORY_PREFIX = "# advisory: ";

/**
 * WHICH RULE the name broke, in words the operator can act on — one sentence
 * per rule, and no two of them interchangeable.
 *
 * "Could not derive a name" is not an answer to anybody: the fix differs by
 * rule — shorten the identity for the cap, rename the repository for the other
 * two — and nobody picks between them from the bare fact that no name was
 * composed. The naming module reports the leading-character and nothing-left
 * cases with a single composed-name sentence, so reading the refusal text back
 * would collapse them; the rule token is the discriminator instead.
 */
const REMOTE_CONTROL_ADVISORIES: Record<WorkerNameRule, string> = {
  over_cap:
    "remote_control is `none` — this run's identity is too long for a worker " +
    "name to carry a repository segment beside it under the 32-character " +
    "worker-name cap, so no name was composed and the worker spawns without " +
    "one. Rule broken: the length cap. Shorten the identity to get a named " +
    "worker.",
  leading_character:
    "remote_control is `none` — the repository basename's first character is " +
    "outside the worker-name grammar, which admits a lowercase letter as the " +
    "leading character and no other, so no name was composed and the " +
    "worker spawns without one. Rule broken: the leading-character rule. " +
    "Rename the repository so its basename begins with a lowercase letter to " +
    "get a named worker.",
  nothing_left:
    "remote_control is `none` — nothing is left of the repository basename " +
    "once it is folded into the worker-name grammar, so there was no " +
    "repository segment to build a name from and the worker spawns without " +
    "one. Rule broken: a basename may not fold away to an empty segment. " +
    "Rename the repository to a basename that survives folding to get a " +
    "named worker.",
  identity_nothing_left:
    "remote_control is `none` — nothing is left of this run's identity once it " +
    "is folded into the worker-name grammar, so the name would have carried no " +
    "identity segment at all and the worker spawns without one. Rule broken: an " +
    "identity may not fold away to an empty segment. Deliver an FR or a " +
    "milestone whose identity survives folding to get a named worker.",
  no_identity:
    "remote_control is `none` — this run resolved no unit of work to name a " +
    "worker after, so no name was composed and the worker spawns without " +
    "one. Rule broken: a worker name needs an identity segment. Deliver an " +
    "FR or a milestone to get a named worker.",
};

/**
 * The advisory for a refusal that named no rule.
 *
 * DEFENSIVE, and no production path reaches it. Every refusal this module's own
 * `refuse()` raises carries a rule, so `rule === null` requires an error built
 * by hand through the public constructor — which a caller legitimately can do,
 * and which the narrowness control in the M134 suite does. The branch stays
 * because the constructor allows it; what does NOT stay is the earlier claim
 * that it was "real rather than defensive", which was false for every path a
 * delivery run can take.
 *
 * What it must never do is guess. An advisory naming the wrong rule sends the
 * operator to rename a repository that was never the problem, so this says
 * exactly what is known and no more.
 */
const UNATTRIBUTED_ADVISORY =
  "remote_control is `none` — the worker name could not be derived and the " +
  "derivation named no rule, so the worker spawns without one. Run " +
  "`deliver_worker_name.ts` against this tree to see what it refused.";

/**
 * The `remote_control` value for this run — plus the advisory that rides with
 * the record when no name could be built.
 *
 * A name the grammar will not admit is a legibility problem, not a safety
 * one, so it must not take the whole record down before the operator ever sees
 * the gate they would have used to drop the bridge themselves. Rendering `none`
 * here keeps the field populated — a blank field is a refusal, an explicit
 * `none` is an answer — and the run goes on unbridged.
 *
 * The degradation is REPORTED, never silent: a run that quietly drops the
 * bridge leaves the operator wondering why their worker is unreachable, so the
 * caller prints one advisory row with the record. It rides in the record's own
 * bytes because those bytes are what the confirm gate shows — an advisory the
 * operator never sees is not an advisory.
 *
 * The catch is by TYPE, never by call site: only the naming module's own
 * refusal degrades. Anything else thrown from the same call — a bug, an
 * unreadable tree — propagates untouched, because a catch wide enough to
 * swallow those is the fail-open shape this guard exists to avoid.
 */
function deriveRemoteControl(
  projectRoot: string,
  routing: DeliverRouting,
): { readonly value: string; readonly advisory: string | null } {
  try {
    return {
      value: workerRemoteControlName({
        repoRoot: projectRoot,
        identity: workerIdentitySegment(routing),
      }),
      advisory: null,
    };
  } catch (error) {
    if (error instanceof WorkerNameRefusedError) {
      const said =
        error.rule === null
          ? UNATTRIBUTED_ADVISORY
          : REMOTE_CONTROL_ADVISORIES[error.rule];
      return { value: "none", advisory: `${ADVISORY_PREFIX}${said}` };
    }
    throw error;
  }
}

/**
 * Ask every owner its own question and render the answers as one record.
 *
 * There are FEWER owners than there are fields, and that is not a miscount:
 * `resume_classifier` answers two of the questions — the resume state and the
 * chain that state implies — so one owner covers two fields. Said here because
 * a reader who assumes the two totals must match will "fix" whichever one they
 * happen to read second.
 *
 * `orchestration_config` is consulted DIRECTLY for the configured policy rather
 * than only through `merge_policy_ratchet` — the ratchet reaches the config
 * module internally, so a record that read the policy only through it could not
 * show the two apart. Printing `configured -> effective` states both, which is
 * the pair an operator actually needs when an override is in play.
 */
export async function decideDelivery(
  input: DeliverDecisionInput,
): Promise<string> {
  const { argument, projectRoot } = input;
  if (typeof argument !== "string" || argument.trim().length === 0) {
    throw refuse({
      verdict:
        "no argument was given, so there is no delivery for this command to " +
        "decide anything about.",
      remedy:
        "re-run with the milestone or FR identity you want the decision " +
        "record for, e.g. `bun run deliver_decision.ts M133 [projectRoot]`.",
      context: `mode=deliver, phase=decision-record, argument=absent, projectRoot=${projectRoot}`,
    });
  }

  const routing = resolveDeliverArgument({
    raw: argument,
    probe: defaultIdentityProbe(projectRoot),
    // Explicit, and the reason is in the module header: this command spawns
    // nothing and claims nothing, so the interactive gate protects nothing
    // here while making the command unrunnable by every caller it has.
    stdinIsTty: true,
  });

  if (routing.planPath === null || routing.milestone === null) {
    throw refuse({
      verdict:
        `\`${argument.trim()}\` resolves to no milestone plan, so there is no ` +
        "chain, no route and no gate for a decision record to report on.",
      remedy:
        "hand this command an identity that already has specs on disk; new " +
        "work has no decision record until its plan exists.",
      context: `mode=deliver, phase=decision-record, kind=${routing.kind}, plan=not-found`,
    });
  }

  const planBody = readFileSync(routing.planPath, "utf-8");
  const routed = routeMilestone({ planBody, invokingRepo: projectRoot });

  let state: string;
  let chain: readonly ResumeChainStep[];
  if (routing.fr === null) {
    const classification = await classifyResume(projectRoot, {
      scope: "milestone",
      milestone: routing.milestone,
    });
    state = classification.state;
    chain = resumeChain(classification, routed.route);
  } else {
    const classification = await classifyResume(projectRoot, {
      scope: "fr",
      fr: routing.fr,
      milestone: routing.milestone,
    });
    state = classification.state;
    chain = resumeChain(classification, routed.route);
  }

  const configured = readOrchestrationConfig(projectRoot).mergePolicy;
  const effective = runMergePolicy(projectRoot).effective;

  const remote = deriveRemoteControl(projectRoot, routing);
  const record = renderDecisionRecord({
    argument_kind: routing.kind,
    target_repo_route: routed.route,
    resume_state: state,
    chain: stepLines(chain).join("\n"),
    merge_policy: `${configured} -> ${effective}`,
    gate_class: classifyGate(CONFIRM_GATE),
    gate_relays: relayRequired(CONFIRM_GATE, null) ? "yes" : "no",
    // The name the spawned worker will be reachable under, ASSEMBLED from the
    // module that owns the derivation rather than composed here — and reached
    // through the routing this run already resolved, never re-parsed off the
    // raw argument. Two spellings of one milestone resolve to one routing, so
    // taking the identity from the routing is what keeps the printed name the
    // same name the spawn will use.
    remote_control: remote.value,
  });

  // The advisory rides AFTER the record and outside its labelled lines: the
  // record's shape is the contract every consumer reads, and a degradation is
  // not a ninth field. Appended rather than logged, because the bytes returned
  // here are the bytes the confirm gate shows — an advisory printed anywhere
  // else is one the operator approving the gate never sees.
  return remote.advisory === null ? record : `${record}\n${remote.advisory}`;
}

// Read-only CLI mirroring `active_plan_ship_ready.ts`: the delivery decision is
// asked through this one entrypoint instead of being re-derived in skill prose.
// Imported by tests and by any consumer that wants `renderDecisionRecord`,
// `import.meta.main` is false and this block never runs — keeping the module
// free of side effects at import. Usage:
//
//   bun run deliver_decision.ts <argument> [projectRoot]
//
// `projectRoot` defaults to `process.cwd()`, the same `?? process.cwd()` shape
// the shipped idiom uses for its own positional. A refusal prints the canonical
// envelope on stderr, exits non-zero, and prints no partial record.
if (import.meta.main) {
  const argument = process.argv[2];
  const projectRoot = process.argv[3] ?? process.cwd();
  try {
    console.log(await decideDelivery({ argument, projectRoot }));
  } catch (error) {
    // stderr, never stdout: the record channel stays empty on a refusal, so a
    // caller reading stdout gets a whole record or nothing — never a partial.
    console.error(envelopeFor(error, { argument, projectRoot }));
    process.exitCode = 1;
  }
}

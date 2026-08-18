// merge_policy_ratchet — the run's merge policy can be TIGHTENED
// conversationally, and never loosened.
//
// `orchestration_config.ts` reads `merge_policy` from CLAUDE.md and nowhere
// else, so an operator sentence like "don't merge anything for the rest of this
// run" had no representation at all. This module gives that sentence one: a
// RUN-SCOPED override that changes what the rest of the run routes on, without
// touching a single byte of CLAUDE.md.
//
// TWO LAYERS, DELIBERATELY.
//
//   * `assertRatchet` is the pure, GUARD-DRIVEN pair check. Every loosening
//     pair is refused by its own entry in `LOOSENING_GUARDS`, so dropping one
//     guard flips exactly that pair's verdict and leaves its siblings refusing
//     — which is what makes each guard mutation-verifiable.
//   * `applyOverride` is the public entry point, and it enforces the
//     auto-target rule UNCONDITIONALLY and AHEAD of the guards. Nothing that
//     goes through it can produce an effective `auto`, not even with the entire
//     guard set dropped. That is the property the shipped `/deliver` guarantee
//     ("`auto` is never inferred") depends on, and it must not be delegated to
//     a guard list a caller can override.
//
// The closed value set is IMPORTED from `orchestration_config` — the shared
// authority — never retyped here. A second copy would keep reading green after
// the authority drifted.
//
// Pure value transforms and file READS only. This module holds no write
// capability whatsoever: the override is a run fact, not a config fact.

import {
  MERGE_POLICIES,
  readOrchestrationConfig,
  type MergePolicy,
} from "./orchestration_config";

/** How a transition from one merge policy to another is classified. */
export type TransitionVerdict = "tightening" | "identity" | "loosening";

/**
 * One refused loosening transition. Each loosening pair gets its OWN guard so
 * each can be dropped independently; a single predicate covering all three
 * would be mutation-verifiable only as a unit.
 */
export interface LooseningGuard {
  /** Stable id — the drop-one mutation keys on it. */
  readonly id: string;
  readonly from: MergePolicy;
  readonly to: MergePolicy;
  /** The operator-facing rendering the `/gate-check` probe demands in prose. */
  readonly prosePhrase: string;
  readonly reason: string;
  matches(from: MergePolicy, to: MergePolicy): boolean;
}

/** A proposed — and, once confirmed, active — run-scoped policy override. */
export interface PolicyOverride {
  readonly from: MergePolicy;
  readonly requested: MergePolicy;
  /** The operator's own words, or "" when built programmatically. */
  readonly text: string;
  /** Rendered back to the operator before it takes effect. */
  readonly restatement: string;
  /** False until `confirmOverride` has put the restatement on the record. */
  readonly active: boolean;
}

/** The merge policy in force for one `/deliver` run. */
export interface RunMergePolicy {
  /** What CLAUDE.md said. Never mutated by an override. */
  readonly configured: MergePolicy;
  /** What the rest of the run actually uses. */
  readonly effective: MergePolicy;
  readonly override: PolicyOverride | null;
}

/** Guard-list override — the seam the drop-one mutation drives. */
export type GuardOptions = { guards?: readonly LooseningGuard[] };

/** The one policy no spoken instruction may ever reach. */
export const FORBIDDEN_OVERRIDE_TARGET: MergePolicy = "auto";

/**
 * The only real enabling act for `auto`, quoted verbatim from the shipped
 * `/deliver` surface so the refusal tells the operator the truth.
 */
export const ENABLING_ACT_PHRASE =
  "the operator writing `merge_policy: auto` into the orchestration config themselves";

/** The prose token that marks a file as an override carrier. */
export const OVERRIDE_ANCHOR = "merge-policy override";

/**
 * Thrown by every refusal in this module. The message carries the NFR-10
 * canonical shape (Refusing: / Remedy: / Context:), mirroring
 * `MalformedOrchestrationConfigError`, so a caller renders it verbatim.
 */
export class MergePolicyRatchetError extends Error {
  constructor(reason: string, remedy: string, context: string) {
    super(
      [
        "merge-policy override refused",
        `Refusing: ${reason}`,
        `Remedy: ${remedy}`,
        `Context: mode=merge-policy-ratchet, ${context}`,
      ].join("\n"),
    );
    this.name = "MergePolicyRatchetError";
  }
}

const pairContext = (from: MergePolicy, to: MergePolicy): string =>
  `from=${from}, to=${to}`;

function guard(
  id: string,
  from: MergePolicy,
  to: MergePolicy,
  reason: string,
): LooseningGuard {
  return {
    id,
    from,
    to,
    prosePhrase: `\`${from}\` → \`${to}\``,
    reason,
    matches: (f, t) => f === from && t === to,
  };
}

/**
 * Exactly one guard per loosening pair, each matching its OWN pair and no
 * other. Two guards catching the same pair would leave a drop-one mutation
 * proving nothing about the guard it dropped.
 */
export const LOOSENING_GUARDS: readonly LooseningGuard[] = [
  guard(
    "offer_to_auto",
    "offer",
    "auto",
    "a run that asks before merging cannot be talked into merging by itself.",
  ),
  guard(
    "never_to_offer",
    "never",
    "offer",
    "a run told to stop merging cannot reopen the merge question mid-run.",
  ),
  guard(
    "never_to_auto",
    "never",
    "auto",
    "a run told to stop merging is the furthest thing from an auto-merging one.",
  ),
];

/**
 * The only accepted transitions. NONE of them targets `auto` — by
 * construction, which is why the override channel can never become the
 * inference path `/deliver` forbids.
 */
export const TIGHTENING_TRANSITIONS: readonly (readonly [
  MergePolicy,
  MergePolicy,
])[] = [
  ["offer", "never"],
  ["auto", "offer"],
  ["auto", "never"],
];

const guardsOf = (options?: GuardOptions): readonly LooseningGuard[] =>
  options?.guards ?? LOOSENING_GUARDS;

function requirePolicy(value: MergePolicy, role: string): MergePolicy {
  if (!(MERGE_POLICIES as readonly string[]).includes(value)) {
    throw new MergePolicyRatchetError(
      `\`${value}\` is not a legal merge policy for the ${role} of a transition.`,
      `use one of ${MERGE_POLICIES.join(" | ")} (exact lowercase literal).`,
      `role=${role}, value=${value}`,
    );
  }
  return value;
}

/**
 * Classify one ordered pair. Identity first (a no-op is not a loosening), then
 * the guards; anything no guard refuses is a tightening.
 */
export function classifyTransition(
  from: MergePolicy,
  to: MergePolicy,
  options?: GuardOptions,
): TransitionVerdict {
  requirePolicy(from, "source");
  requirePolicy(to, "target");
  if (from === to) return "identity";
  return guardsOf(options).some((g) => g.matches(from, to))
    ? "loosening"
    : "tightening";
}

export function isTightening(
  from: MergePolicy,
  to: MergePolicy,
  options?: GuardOptions,
): boolean {
  return classifyTransition(from, to, options) === "tightening";
}

/**
 * Refuse anything that is not a tightening. Purely guard-driven: with every
 * guard dropped, the loosening pairs pass here — the auto-target safety net
 * lives one layer up, in `applyOverride`, precisely so it survives that.
 */
export function assertRatchet(
  from: MergePolicy,
  to: MergePolicy,
  options?: GuardOptions,
): void {
  const verdict = classifyTransition(from, to, options);
  if (verdict === "tightening") return;
  if (verdict === "identity") {
    throw new MergePolicyRatchetError(
      `the run is already on \`${from}\` — moving it to \`${to}\` is a no-op, ` +
        "so nothing is left unchanged by declining it.",
      "state a policy the run is not already on, or say nothing at all.",
      pairContext(from, to),
    );
  }
  const hit = guardsOf(options).find((g) => g.matches(from, to));
  throw new MergePolicyRatchetError(
    `\`${from}\` → \`${to}\` would loosen the run's merge policy, and the ` +
      `ratchet only ever tightens. ${hit?.reason ?? ""}`.trim(),
    "tighten instead, or start a new run under the configured policy.",
    pairContext(from, to),
  );
}

// ---------------------------------------------------------------------------
// Prose → override.
// ---------------------------------------------------------------------------

/** Statements that restrict merging outright. */
const NEVER_PATTERNS: readonly RegExp[] = [
  /\b(don'?t|do not|never|no more|stop)\s+(auto[-\s]?)?merg\w*/i,
  /\bno\s+merg(es|ing)\b/i,
  /\bhold\s+(off\s+)?(on\s+)?(all\s+)?merg\w*/i,
];

/** Statements that ask to be consulted before each merge. */
const OFFER_PATTERNS: readonly RegExp[] = [
  /\bask\s+me\s+(first\s+)?(before|about)\b[^.]*\bmerg\w*/i,
  /\b(check|confirm)\s+with\s+me\s+before\b[^.]*\bmerg\w*/i,
  /\bconfirm\s+(every|each|before)\b[^.]*\bmerg\w*/i,
];

/** Statements that reach for `auto` — detected so they can be refused loudly. */
const AUTO_SEEKING_PATTERNS: readonly RegExp[] = [
  /\bauto[-\s]?merg\w*/i,
  /merge_policy\s*[:=]?\s*(to\s+)?auto\b/i,
  /\bauto\b[^.]*\b(run|policy|merge)/i,
  /\b(policy|merg\w*)\b[^.]*\bauto\b/i,
  /\bmerge\s+everything\b/i,
  /\bjust\s+merge\s+(them|it|everything)\b/i,
  /\bstop\s+asking\s+me\b[^.]*\bmerg\w*/i,
];

const matchesAny = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((re) => re.test(text));

/**
 * Resolve prose to the policy it names, or `null` when it names none.
 *
 * PRECEDENCE IS DELIBERATE AND FAIL-SAFE, not incidental. `NEVER_PATTERNS` is
 * tested before `OFFER_PATTERNS`, so a statement matching both resolves to the
 * TIGHTER of the two. The known cost is a statement like "don't merge without
 * asking me", which asks for `offer` and resolves to `never`.
 *
 * That direction is chosen rather than tolerated. Getting it wrong the other way
 * — resolving a statement that meant `never` to the looser `offer` — would hand
 * back merge authority the operator had just withdrawn, which is the
 * unrecoverable direction for a Tier-1 rule. Erring tight is recoverable in one
 * keystroke; erring loose merges something.
 *
 * The mis-resolution is also never silent: AC-STE-494.2's restate-once gate is
 * exactly the control for it. The operator is shown "tightens from `offer` to
 * `never`" BEFORE it takes effect and can decline, so the cost is one visible
 * correction rather than a wrong policy running the rest of the pipeline.
 */
function resolveStatement(text: string): MergePolicy | null {
  const t = (text ?? "").trim();
  if (t === "") return null;
  if (matchesAny(NEVER_PATTERNS, t)) return "never";
  if (matchesAny(OFFER_PATTERNS, t)) return "offer";
  if (matchesAny(AUTO_SEEKING_PATTERNS, t)) return FORBIDDEN_OVERRIDE_TARGET;
  return null;
}

/**
 * Is this prose a merge-policy override statement at all? Auto-seeking prose
 * counts — it IS an override statement, just one that is always refused.
 */
export function isOverrideStatement(text: string): boolean {
  return resolveStatement(text) !== null;
}

function restatementFor(
  from: MergePolicy,
  requested: MergePolicy,
  text: string,
): string {
  const quoted = text.trim() === "" ? "" : ` You said: "${text}".`;
  return (
    `Restating this merge-policy override once, before it takes effect.${quoted}` +
    ` The run's merge policy tightens from \`${from}\` to \`${requested}\`, and` +
    " that holds for the rest of this run — every remaining milestone routes on" +
    ` \`${requested}\`. It is a run fact only: it is not written to CLAUDE.md,` +
    ` which still says \`${from}\`. Persisting it is a separate and explicit ask.`
  );
}

function mintOverride(
  from: MergePolicy,
  requested: MergePolicy,
  text: string,
): PolicyOverride {
  requirePolicy(from, "source");
  requirePolicy(requested, "target");
  return {
    from,
    requested,
    text,
    restatement: restatementFor(from, requested, text),
    active: false,
  };
}

/** Build an override programmatically. Inactive until `confirmOverride`. */
export function proposeOverride(
  from: MergePolicy,
  requested: MergePolicy,
): PolicyOverride {
  return mintOverride(from, requested, "");
}

/**
 * Build an override from the operator's own words. Auto-seeking prose refuses
 * here rather than minting an override nobody could ever apply.
 */
export function overrideFromStatement(
  text: string,
  from: MergePolicy,
): PolicyOverride {
  const requested = resolveStatement(text);
  if (requested === null) {
    throw new MergePolicyRatchetError(
      `"${text}" is not a merge-policy override statement — it names no policy.`,
      "say which restriction you want, e.g. \"don't merge anything\" or " +
        '"ask me before every merge".',
      `from=${from}, statement=${JSON.stringify(text)}`,
    );
  }
  if (requested === FORBIDDEN_OVERRIDE_TARGET) {
    throw autoTargetRefusal(from, requested);
  }
  return mintOverride(from, requested, text);
}

/** Put the restatement on the record. Exactly once per override. */
export function confirmOverride(o: PolicyOverride): PolicyOverride {
  if (o.active) {
    throw new MergePolicyRatchetError(
      "this override is already active — confirming it a second time would " +
        "put the same scope on the record twice.",
      "apply the confirmed override, or propose a new one to tighten further.",
      pairContext(o.from, o.requested),
    );
  }
  return { ...o, active: true };
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

/** Read the run's merge policy from the project's CLAUDE.md. No override yet. */
export function runMergePolicy(projectRoot: string): RunMergePolicy {
  const { mergePolicy } = readOrchestrationConfig(projectRoot);
  return { configured: mergePolicy, effective: mergePolicy, override: null };
}

function autoTargetRefusal(
  from: MergePolicy,
  to: MergePolicy,
): MergePolicyRatchetError {
  return new MergePolicyRatchetError(
    `\`${from}\` → \`${to}\` — no spoken instruction may put this run on ` +
      `\`${FORBIDDEN_OVERRIDE_TARGET}\`. The conversational channel tightens ` +
      "only; it is not an enabling path, and treating it as one would loosen " +
      "the run's merge policy by inference.",
    `the only enabling act is ${ENABLING_ACT_PHRASE}, before the run starts.`,
    pairContext(from, to),
  );
}

/**
 * Apply a confirmed override to a run, returning a NEW run value.
 *
 * Layer order is load-bearing: the auto-target rule runs first and
 * unconditionally, so it holds even when the caller has dropped every
 * loosening guard. Only then do the guard-driven checks run.
 */
export function applyOverride(
  run: RunMergePolicy,
  o: PolicyOverride,
  options?: GuardOptions,
): RunMergePolicy {
  // LAYER 1 — unconditional, ahead of every guard.
  if (o.requested === FORBIDDEN_OVERRIDE_TARGET) {
    throw autoTargetRefusal(o.from, o.requested);
  }
  // An unrestated override has no scope at all; it changes nothing.
  if (!o.active) return run;
  if (o.from !== run.effective) {
    throw new MergePolicyRatchetError(
      `this override was minted against \`${o.from}\`, but the run is on ` +
        `\`${run.effective}\` — applying it would act on a stale reading.`,
      `re-state the override against the run's current policy (\`${run.effective}\`).`,
      `${pairContext(o.from, o.requested)}, effective=${run.effective}`,
    );
  }
  // LAYER 2 — the guard-driven ratchet.
  assertRatchet(o.from, o.requested, options);
  return {
    configured: run.configured,
    effective: o.requested,
    override: o,
  };
}

/** What `/deliver` does once a milestone's PR is open. */
export function postPrAction(run: RunMergePolicy): "ask" | "merge" | "stop" {
  switch (run.effective) {
    case "auto":
      return "merge";
    case "never":
      return "stop";
    default:
      return "ask";
  }
}

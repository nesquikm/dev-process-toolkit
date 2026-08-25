// gate_class (STE-493) — the approval-gate taxonomy and the standing-
// authorization lifecycle that rides on it.
//
// THE DEFECT. `/deliver`'s "Worker approval gates — relay to the operator"
// section relays EVERY worker gate through one undifferentiated queue: the
// `/implement` commit approval, the `/ship-milestone` release approval, the
// `/pr` push/PR confirmation, and any tracker-write prompts all arrive with
// the same weight. Gates are not interchangeable, though. Some decide WHAT
// gets built (only the operator can answer those). Some are pure mechanics
// with exactly one correct answer — the next milestone number, the branch
// name the convention already determines — and re-asking them spends operator
// attention on nothing. Some are irreversible or outward-facing and must never
// be answered by anyone but the operator, per action. With no vocabulary for
// the difference, the common operator instruction — drive the mechanics
// yourself, but never merge without me — is not expressible at all, and a live
// 2026-08-17 run burned operator attention on a milestone number already
// chosen while the irreversible actions sat in the same queue.
//
// THE FIX. A closed set of exactly three gate classes, each naming who
// decides, plus a registry binding the field-report gates to their class:
//
//   * `content`      — the operator decides, gate by gate. Never delegable.
//   * `mechanical`   — the worker may decide once a standing authorization is
//                      in effect; absent one, the operator decides.
//   * `irreversible` — the operator alone decides, per action. Never delegable
//                      by any standing authorization, however general.
//
// A standing authorization covers EXACTLY the mechanical class. The
// irreversible class is fenced off by `IRREVERSIBLE_GUARDS`, an exported list
// of one guard per named outward-facing action, so each guard can be dropped
// in isolation and shown to be load-bearing. A guard OVERRIDES a gate's
// declared class: a gate that registers itself `mechanical` while naming an
// irreversible action is classified `irreversible` anyway. The default stays
// relay-everything — a run in which the operator says nothing behaves exactly
// as it does today.
//
// This mechanism is DISTINCT from the auto-approve marker. That marker is a
// headless `claude -p` pre-authorization token; this is a live operator's
// spoken scope, restated back before it takes effect, and it never emits the
// marker.
//
// Pure module: no file, git, network, or child-process access.

export type GateClass = "content" | "mechanical" | "irreversible";

/**
 * AC-STE-493.1 — the closed set, in taxonomy order (least to most
 * consequential). A fourth class is a contract break, not an extension.
 */
export const GATE_CLASSES: readonly GateClass[] = [
  "content",
  "mechanical",
  "irreversible",
] as const;

/**
 * Who decides each class. Three distinct answers — three classes sharing a
 * decider would be one class wearing three names.
 */
export const CLASS_DECIDERS: Record<GateClass, string> = {
  content:
    "the operator decides, gate by gate — this answer shapes what gets built",
  mechanical:
    "the worker decides while a standing authorization is in effect; " +
    "otherwise the operator decides",
  irreversible:
    "the operator decides, per action — never delegable by a standing " +
    "authorization",
};

/** The operator vocabulary a standing authorization is recorded under. */
export const DELEGATION_ANCHOR = "standing authorization";

/**
 * The ONLY channel a delegation reaches later workers through: the kickoff
 * task text of a worker not yet spawned. Never a mid-run message.
 */
export const DELEGATION_CARRY_CHANNEL = "kickoff";

export interface GateDescriptor {
  readonly id: string;
  readonly gateClass: GateClass;
  readonly decider: string;
  readonly summary: string;
}

export interface IrreversibleGuard {
  /** Stable id — the drop-one mutation and the probe both key on it. */
  readonly id: string;
  /** The operator-facing phrase this guard forbids, e.g. `push to trunk`. */
  readonly actionPhrase: string;
  readonly reason: string;
  matches(gateText: string): boolean;
}

export interface Delegation {
  readonly text: string;
  /** The restatement rendered back to the operator before it takes effect. */
  readonly restatement: string;
  /** False until `confirmDelegation` has put the restatement on the record. */
  readonly active: boolean;
}

export type GateLike = string | GateDescriptor;

// ---------------------------------------------------------------------------
// The irreversible guards.
//
// One guard per named action, never one regex covering all five: a combined
// matcher is mutation-verifiable only as a unit, and a guard that cannot be
// dropped on its own cannot be shown to be load-bearing.
// ---------------------------------------------------------------------------

function guard(
  id: string,
  actionPhrase: string,
  reason: string,
  re: RegExp,
): IrreversibleGuard {
  return {
    id,
    actionPhrase,
    reason,
    matches: (gateText: string): boolean => re.test(String(gateText ?? "")),
  };
}

export const IRREVERSIBLE_GUARDS: readonly IrreversibleGuard[] = [
  guard(
    "merge",
    "merge a pull request",
    "a merge lands code on a shared branch other people build on; undoing it " +
      "rewrites history that has already been fetched",
    /\bmerg(?:e|es|ed|ing)\b/i,
  ),
  guard(
    "push_to_trunk",
    "push to trunk",
    "a push to the trunk branch is visible to every collaborator the instant " +
      "it lands and cannot be recalled",
    // VERB-ONLY, deliberately — and this is a WIDENING, recorded because the
    // narrow form shipped first and was the one real safety hole the STE-493
    // audit found. The original required `trunk|main|master` to appear after
    // the verb, which let "push to origin", "push the tag" and "force-push the
    // branch" through: a delegation would have silently covered them. Every
    // sibling guard here is verb-only and therefore fails closed-BROAD, and
    // this one was the sole exception whose misses fell on the UNSAFE side.
    //
    // Over-matching is the correct direction for a Tier-1 exclusion: the cost
    // of a false positive is one fresh instruction naming the action, while the
    // cost of a false negative is an unrecallable push. No MECHANICAL gate in
    // GATE_REGISTRY names a push, so widening cannot reclassify one.
    // `\bpush\b` also matches inside "force-push" — the hyphen is a word
    // boundary — so the hyphenated forms are covered without a second branch.
    /\bpush(?:es|ed|ing)?\b/i,
  ),
  guard(
    "deploy",
    "deploy to an environment",
    "a deploy changes what real users are running, and the previous state is " +
      "not always recoverable",
    /\bdeploy(?:s|ed|ing|ment|ments)?\b/i,
  ),
  guard(
    "publish",
    "publish a package or release",
    "a published artifact is fetched by consumers immediately and most " +
      "registries forbid unpublishing",
    /\bpublish(?:es|ed|ing)?\b/i,
  ),
  guard(
    "outward_facing",
    "send an outward-facing message",
    "an outward-facing message reaches people outside the run and cannot be " +
      "unsent once delivered",
    /\boutward[-\s]facing\b/i,
  ),
];

// ---------------------------------------------------------------------------
// The registry.
//
// Every registered gate carries its class's decider verbatim, so a class whose
// decider is edited cannot leave stale copies behind on its gates.
// ---------------------------------------------------------------------------

function gate(
  id: string,
  gateClass: GateClass,
  summary: string,
): GateDescriptor {
  return { id, gateClass, decider: CLASS_DECIDERS[gateClass], summary };
}

export const GATE_REGISTRY: readonly GateDescriptor[] = [
  // CONTENT — decides what gets built. No delegation touches these.
  gate(
    "implement_commit_approval",
    "content",
    "approve the implementation diff before it is committed",
  ),
  // The pre-spawn chain-confirm gate `deliver_decision` names as CONFIRM_GATE.
  // Registered so its `gate_class` field resolves THROUGH the registry rather
  // than through `classifyGateWith`'s unknown-gate fallback, which answers
  // `content` for every input and would carry this gate along the day that
  // fallback changes. Content, not mechanical: the operator decides what chain
  // runs, and no standing authorization reaches it. The summary deliberately
  // names no guarded action — a guard hit would OVERRIDE the declared class and
  // silently make this gate irreversible.
  //
  // What registration does NOT change, stated because an earlier draft of this
  // comment claimed otherwise: `deliver_decision`'s `gate_relays` field. That
  // call site passes no delegation, and `relayRequired(gate, null)` is `true`
  // for EVERY gate — registered or not, content, mechanical or irreversible —
  // so the field read `yes` before this registration and reads `yes` after it.
  // For THIS gate that is also its permanent answer: a content gate relays
  // whatever delegation is on the record. The field is correct and invariant,
  // not informative, and registration pins `gate_class` alone.
  gate(
    "deliver_chain_confirm",
    "content",
    "confirm the delivery chain before the first worker is spawned",
  ),

  // MECHANICAL — exactly the gates the 2026-08-17 field report named as
  // wasted operator attention: each has one correct answer, already
  // determined upstream.
  gate(
    "milestone_number_choice",
    "mechanical",
    "confirm the next milestone number the dispatcher already resolved",
  ),
  gate(
    "branch_name_choice",
    "mechanical",
    "confirm the branch name the naming convention already determines",
  ),
  gate(
    "tracker_write_prompt",
    "mechanical",
    "confirm a tracker field write for the item under work",
  ),

  // IRREVERSIBLE — the operator alone, per action.
  gate("merge_pr", "irreversible", "merge the open pull request"),
  gate("push_to_trunk", "irreversible", "push the release commit to trunk"),
  gate("deploy", "irreversible", "deploy the built artifact to production"),
  gate("publish", "irreversible", "publish the package to the registry"),
];

/** Registered gate by id, or `null` — never a throw, so callers can fall back. */
export function gateFor(id: string): GateDescriptor | null {
  if (typeof id !== "string" || id.length === 0) return null;
  return GATE_REGISTRY.find((g) => g.id === id) ?? null;
}

/**
 * The text a guard is run against. For a descriptor that is its summary alone
 * — NOT its id — so a registered gate is judged on the action it describes and
 * an id that merely spells an action word cannot trip a guard by accident.
 */
function gateText(gate: GateLike): string {
  if (typeof gate === "string") {
    const registered = gateFor(gate);
    return registered ? registered.summary : gate;
  }
  return gate.summary ?? "";
}

/**
 * True when any guard catches this gate. The guard list is injectable so each
 * guard can be dropped in isolation and the verdict shown to flip.
 */
export function isIrreversibleGate(
  gate: GateLike,
  guards: readonly IrreversibleGuard[] = IRREVERSIBLE_GUARDS,
): boolean {
  const text = gateText(gate);
  return guards.some((g) => g.matches(text));
}

/**
 * AC-STE-493.1 — the class of a gate.
 *
 * Order matters and is fail-closed:
 *   1. A guard hit wins outright, OVERRIDING any declared class. A gate that
 *      declares itself mechanical while naming an irreversible action is the
 *      mis-registration the guards exist to catch.
 *   2. A registered gate gets its declared class.
 *   3. Anything else falls back to `content` — unknown gates are relayed,
 *      never delegated.
 */
function classifyGateWith(
  gate: GateLike,
  guards: readonly IrreversibleGuard[],
): GateClass {
  if (isIrreversibleGate(gate, guards)) return "irreversible";
  const descriptor = typeof gate === "string" ? gateFor(gate) : gate;
  if (descriptor && GATE_CLASSES.includes(descriptor.gateClass)) {
    return descriptor.gateClass;
  }
  return "content";
}

export function classifyGate(gate: GateLike): GateClass {
  return classifyGateWith(gate, IRREVERSIBLE_GUARDS);
}

// ---------------------------------------------------------------------------
// Delegation lifecycle.
// ---------------------------------------------------------------------------

/**
 * Shapes an operator uses to hand the mechanics over. Deliberately narrow: a
 * statement that does not read as "you decide these yourself" is NOT a standing
 * authorization, and the fail-closed default is to keep relaying.
 */
const DELEGATION_PATTERNS: readonly RegExp[] = [
  /\b(?:drive|handle|run|do|decide|take)\b[^.]*\byourself\b/i,
  /\bstop asking\b/i,
  /\b(?:don'?t|do not|no need to)\s+(?:keep\s+)?ask(?:ing)?\b/i,
  /\byou\s+(?:decide|choose|pick)\b/i,
];

/**
 * The opposite instruction — the operator asking for MORE relay, not less.
 * Checked first so a sentence that both asks to be shown every gate and happens
 * to contain a delegation-shaped clause is never scored as a delegation.
 */
const RELAY_REQUEST_PATTERNS: readonly RegExp[] = [
  /\brelay\b[^.]*\b(?:everything|every|all)\b/i,
  /\bi want to see\b/i,
  /\b(?:ask|check with|confirm with)\s+me\s+(?:about|before|first|for|on)\b/i,
];

/**
 * AC-STE-493.3 — is this operator statement a standing authorization at all?
 *
 * A per-action instruction ("merge the PR now") is NOT one: authorization is
 * per-instruction and never accumulated into standing scope.
 */
export function isDelegationStatement(text: string): boolean {
  const stated = String(text ?? "").trim();
  if (stated.length === 0) return false;
  if (RELAY_REQUEST_PATTERNS.some((re) => re.test(stated))) return false;
  return DELEGATION_PATTERNS.some((re) => re.test(stated));
}

/**
 * NFR-10 canonical refusal: prose that is not a delegation was offered as one.
 * Minting a `Delegation` from it would put a scope on the record the operator
 * never stated.
 */
export class NotADelegationError extends Error {
  readonly stated: string;

  constructor(stated: string) {
    super(
      [
        `Refusing: "${stated}" does not read as a ${DELEGATION_ANCHOR}; ` +
          `restating it back would put a scope on the record the operator ` +
          `never stated.`,
        `Remedy: keep relaying every gate. If the operator meant to hand over ` +
          `the mechanical class, ask them to say so plainly (e.g. "drive it ` +
          `yourself") and propose the delegation from those words.`,
        `Context: mode=gate-class, anchor=${DELEGATION_ANCHOR}, ` +
          `channel=${DELEGATION_CARRY_CHANNEL}`,
      ].join("\n"),
    );
    this.name = "NotADelegationError";
    this.stated = stated;
  }
}

/**
 * The restatement rendered back to the operator. It names the class being
 * delegated, every action the delegation does NOT reach, the scope in time,
 * and the operator's own words — so agreeing to it is agreeing to a scope
 * that was said out loud, not to a paraphrase.
 */
function renderRestatement(text: string): string {
  const excluded = IRREVERSIBLE_GUARDS.map((g) => g.actionPhrase).join(", ");
  return (
    `You said: "${text}". Restating the ${DELEGATION_ANCHOR} before it takes ` +
    `effect: I will decide the mechanical gates myself for the rest of this ` +
    `run, and I will still bring you every other gate — including ${excluded}.`
  );
}

/**
 * AC-STE-493.3 — a delegation the operator has stated but not yet agreed to.
 *
 * `active: false` until `confirmDelegation` puts the restatement on the record:
 * a PROPOSED delegation covers nothing at all, not even a mechanical gate. The
 * restate-once step is what makes the scope reviewable before it has any
 * effect. Prose that is not a delegation is refused rather than coerced.
 */
export function proposeDelegation(text: string): Delegation {
  const stated = String(text ?? "");
  if (!isDelegationStatement(stated)) throw new NotADelegationError(stated);
  return { text: stated, restatement: renderRestatement(stated), active: false };
}

/**
 * Puts the restatement on the record; the delegation is in effect from here.
 * The operator's words and the restatement are carried through untouched — the
 * confirmed scope is byte-identical to the one that was read back.
 */
export function confirmDelegation(delegation: Delegation): Delegation {
  return { ...delegation, active: true };
}

/** True only for a delegation that has been restated and agreed to. */
function delegationInEffect(delegation: string | Delegation | null): boolean {
  if (delegation === null || delegation === undefined) return false;
  if (typeof delegation === "string") return isDelegationStatement(delegation);
  return delegation.active === true;
}

/**
 * Does this delegation cover this gate?
 *
 * Three ways to answer NO, in order: there is no delegation in effect (a
 * proposed-but-not-restated one included), a guard catches the gate, or the
 * gate is not mechanical. The guard list is injectable so each guard can be
 * dropped in isolation at the PUBLIC entry point and shown to be load-bearing.
 */
export function delegationCovers(
  delegation: string | Delegation | null,
  gate: GateLike,
  options?: { guards?: readonly IrreversibleGuard[] },
): boolean {
  if (!delegationInEffect(delegation)) return false;
  const guards = options?.guards ?? IRREVERSIBLE_GUARDS;
  return classifyGateWith(gate, guards) === "mechanical";
}

/**
 * AC-STE-493.5, the OTHER direction — the only way an irreversible gate is
 * ever answered by anyone but the operator at that gate: a FRESH instruction
 * that NAMES the action.
 *
 * Without this half the exclusion would degrade into "irreversible gates are
 * simply unreachable", which is not what the AC says — it says a general
 * delegation never reaches them and a specific instruction does.
 *
 * The test is per-action, and deliberately strict in three ways:
 *
 *   1. A DELEGATION-SHAPED statement authorizes nothing, however emphatic.
 *      "drive it yourself" and "stop asking me" are standing scope, and
 *      standing scope stops at the mechanical class by construction. Scoring
 *      them here would re-open the exclusion through the back door.
 *   2. The gate must actually be guarded. A gate no guard catches has no
 *      irreversible action to name, so there is nothing for a fresh
 *      instruction to authorize — its class already decides it.
 *   3. EVERY guard the gate trips must also be tripped by the instruction.
 *      An instruction naming ONE of two actions a gate performs authorizes
 *      neither: partial naming is not naming.
 *
 * The authorization is per-instruction and is never recorded — nothing here
 * mints a `Delegation`, so the same words cannot accumulate into standing
 * scope. The guard list is injectable for the same drop-one reason as the
 * other entry points.
 */
export function freshInstructionAuthorizes(
  instruction: string,
  gate: GateLike,
  guards: readonly IrreversibleGuard[] = IRREVERSIBLE_GUARDS,
): boolean {
  const stated = String(instruction ?? "").trim();
  if (stated.length === 0) return false;
  if (isDelegationStatement(stated)) return false;

  const tripped = guards.filter((g) => g.matches(gateText(gate)));
  if (tripped.length === 0) return false;
  return tripped.every((g) => g.matches(stated));
}

/**
 * AC-STE-493.2 — must this gate be relayed to the operator?
 *
 * Fail-closed and relay-by-default: the answer is TRUE unless the gate is
 * MECHANICAL *and* a confirmed delegation is in effect. With no delegation
 * recorded — the shipped default, and the only state a run in which the
 * operator says nothing can be in — every registered gate relays, exactly as
 * it does today. `classifyGate` already lets an irreversible guard override a
 * mis-registered class, so a gate naming an outward-facing action relays even
 * while a delegation is active.
 */
export function relayRequired(
  gate: GateLike,
  delegation: Delegation | null,
): boolean {
  if (classifyGate(gate) !== "mechanical") return true;
  return delegation?.active !== true;
}

/**
 * AC-STE-493.4 — carry a confirmed delegation into a worker's KICKOFF text.
 *
 * The base text is preserved byte-for-byte and the carried block is appended,
 * so the scope a worker is spawned under is the operator's own restatement —
 * the very words they agreed to — and not a paraphrase minted at spawn time.
 * Because the restatement already names every excluded action, the worker
 * cannot infer a wider scope than the one that was read back.
 *
 * Two ways to carry NOTHING, and both leave the text untouched:
 *   * no delegation at all — the silent-run half of AC-STE-493.2, where the
 *     kickoff text is byte-identical to today's;
 *   * a PROPOSED but unconfirmed delegation — restate-before-effect holds on
 *     this channel too: a scope nobody has agreed to is not carried anywhere.
 */
export function carryDelegation(
  kickoffText: string,
  delegation: Delegation | null,
): string {
  const base = String(kickoffText ?? "");
  if (!delegation || delegation.active !== true) return base;
  return [
    base,
    "",
    `Standing authorization in effect for this run, restated to the operator ` +
      `and carried here in the ${DELEGATION_CARRY_CHANNEL} text:`,
    delegation.restatement,
  ].join("\n");
}

/**
 * NFR-10 canonical refusal: a delegation was offered through a channel that is
 * not the kickoff text. The mid-run case is the dangerous one — it would widen
 * the scope of a session AFTER it started, so the worker's own transcript no
 * longer shows the terms it has been operating under.
 */
export class DelegationChannelError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(
      [
        `Refusing: a ${DELEGATION_ANCHOR} may only reach a worker through the ` +
          `${DELEGATION_CARRY_CHANNEL} task text of a worker that has not been ` +
          `spawned yet; "${channel}" would widen an already-running worker's ` +
          `scope mid-run, after its transcript recorded different terms.`,
        `Remedy: leave the running worker alone — it finishes under the scope ` +
          `it was spawned with — and carry the ${DELEGATION_ANCHOR} into the ` +
          `NEXT worker by appending the restatement to its ` +
          `${DELEGATION_CARRY_CHANNEL} text with \`carryDelegation\`.`,
        `Context: mode=gate-class, anchor=${DELEGATION_ANCHOR}, ` +
          `channel=${DELEGATION_CARRY_CHANNEL}, offered=${channel}`,
      ].join("\n"),
    );
    this.name = "DelegationChannelError";
    this.channel = channel;
  }
}

/**
 * AC-STE-493.4 — the channel check, fail-closed: the kickoff channel is the
 * only one that passes, and every other channel — the mid-run message above
 * all — is refused rather than downgraded to a warning.
 */
export function assertDelegationChannel(channel: string): void {
  const offered = String(channel ?? "");
  if (offered === DELEGATION_CARRY_CHANNEL) return;
  throw new DelegationChannelError(offered);
}

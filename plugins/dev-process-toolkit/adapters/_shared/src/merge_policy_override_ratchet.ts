// merge_policy_override_ratchet — /gate-check probe #79 (M129).
//
// THE DEFECT. `adapters/_shared/src/merge_policy_ratchet.ts` holds the
// tightening-only ratchet as CODE: every loosening pair is refused by its own
// entry in `LOOSENING_GUARDS`, and `applyOverride` refuses an `auto` target
// unconditionally, naming `ENABLING_ACT_PHRASE` as the only real way to turn
// `auto` on. The shipped prose an operator actually reads before saying "just
// merge them yourself from now on" lives somewhere else entirely —
// `skills/deliver/SKILL.md` today, a reference doc tomorrow. Nothing keeps the
// two in step. A fourth loosening guard added to the module, or a reworded
// pair, leaves the prose describing a ratchet that is looser than the one the
// code enforces; worse, prose that silently drops `never` → `offer` teaches the
// operator that a spoken instruction can reopen the merge question mid-run. The
// operator's mental model, not the module, decides whether they say the words at
// all, so a documented ratchet that omits the enabling act is a real safety gap
// even though the code still refuses the transition.
//
// THE FIX. Every file that names the override vocabulary — `OVERRIDE_ANCHOR`,
// i.e. "merge-policy override" — must also name EVERY refused loosening
// transition's operator-facing phrase AND the one real enabling act, sourced
// from `LOOSENING_GUARDS` / `ENABLING_ACT_PHRASE` rather than retyped. The
// required-phrase list is therefore derived, never a second copy: adding a
// guard automatically widens what the prose must say, and reddens this probe
// until it does.
//
// SCOPE, deliberately narrow in two directions and deliberately wide in a third,
// mirroring probe #78 `delegation_irreversible_exclusion`:
//
//   * CARRIER-scoped. A file that never names the anchor makes no claim about
//     the override channel and owes no ratchet prose. Without this the probe
//     would demand the four phrases of every markdown file in the tree — a false
//     red on nearly all of them, and a completely different (and wrong)
//     contract.
//   * FILE-scoped, not clause-scoped. The phrases must appear in the file, not
//     inside the same sentence as the anchor. `/deliver` states the opt-in
//     guarantee on one line and the ratchet's refusals on another; demanding
//     co-location would fail a compliant shipped skill.
//   * BOTH `skills/` AND `docs/`. Probe #77 walks skills only, because a
//     first-turn contract can only live in a SKILL.md. This ratchet can be
//     written down in either tree, and a reference doc that describes the
//     override while omitting a refused transition misleads exactly as badly as
//     a skill would. Restricting to skills/ would let the ratchet be documented
//     away in docs/.
//
// Those three scope rules, the plugin-rooted walk, and the violation shape are
// the MECHANISM, and it is shared with probe #78 through
// `carrier_phrase_probe.ts` rather than copied — the two probes were written in
// one registration sweep and a second copy is exactly where they would have
// drifted apart. What stays here is what makes this probe THIS probe: its id,
// its anchor, its derived phrase source, and its refusal text — so a #79 carrier
// that drops a refused transition reddens #79 and nothing else.
//
// Pure file reads only — no git, no network, no child processes.

import {
  runCarrierPhraseProbe,
  type CarrierPhraseProbeSpec,
  type CarrierPhraseViolation,
  type Severity,
} from "./carrier_phrase_probe";
import {
  ENABLING_ACT_PHRASE,
  LOOSENING_GUARDS,
  OVERRIDE_ANCHOR,
} from "./merge_policy_ratchet";

export type { Severity };

export type MergePolicyOverrideRatchetViolation = CarrierPhraseViolation;

export interface MergePolicyOverrideRatchetReport {
  violations: MergePolicyOverrideRatchetViolation[];
}

/** The probe id, as registered in `skills/gate-check/SKILL.md` row #79. */
export const PROBE_ID = "merge_policy_override_ratchet";

/**
 * The phrases a carrier must name, DERIVED from the shipped ratchet.
 *
 * Returns a fresh array on every call: callers sort it, and a shared array would
 * reorder the module's own guard list as a side effect. Deriving rather than
 * retyping is the whole anti-drift point — a fourth guard widens this list for
 * free, and a reworded pair moves the requirement with it. `ENABLING_ACT_PHRASE`
 * rides along because a prose ratchet that never says how `auto` really turns on
 * leaves the operator guessing that saying it might work.
 */
export function requiredRatchetPhrases(): string[] {
  return [...LOOSENING_GUARDS.map((g) => g.prosePhrase), ENABLING_ACT_PHRASE];
}

function reasonFor(phrase: string): string {
  return (
    `file names the ${OVERRIDE_ANCHOR} but never states "${phrase}", so the ` +
    `documented ratchet is looser than the one \`merge_policy_ratchet.ts\` ` +
    `enforces`
  );
}

function messageFor(
  reason: string,
  phrase: string,
  rel: string,
  line: number,
): string {
  return [
    `${PROBE_ID}: ${reason}`,
    `Refusing: to read this file as a complete statement of the ` +
      `${OVERRIDE_ANCHOR} while it never names \`${phrase}\` — an operator who ` +
      `reads it comes away believing the spoken channel is looser than it is, ` +
      `which the shipped ratchet refuses.`,
    `Remedy: extend the passage that names the ${OVERRIDE_ANCHOR} so it states ` +
      `every refused transition and the one real enabling act verbatim, sourced ` +
      `from \`LOOSENING_GUARDS\` and \`ENABLING_ACT_PHRASE\` in ` +
      `\`adapters/_shared/src/merge_policy_ratchet.ts\`; never retype the ` +
      `phrases, and never document a looser ratchet than the code enforces. A ` +
      `file that makes no override claim should not name the anchor at all.`,
    `Context: file=${rel}, line=${line}, phrase=${phrase}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/** Everything that makes this probe distinct from its engine-mate, #78. */
const SPEC: CarrierPhraseProbeSpec = {
  probeId: PROBE_ID,
  anchor: OVERRIDE_ANCHOR,
  requiredPhrases: requiredRatchetPhrases,
  reasonFor,
  messageFor,
};

/**
 * Walk `plugins/dev-process-toolkit/{skills,docs}/**\/*.md` under `projectRoot`
 * and flag every override carrier that fails to name a refused transition or the
 * enabling act. Pure function — no side effects, no writes.
 *
 * Vacuous (zero violations, no crash) when the plugin tree is absent, so a
 * consumer project that never installed the toolkit's own sources cannot fail.
 *
 * Call site: `/gate-check` conformance probe #79 + the M129 integration test at
 * `tests/m129-ste-494-merge-policy-ratchet.test.ts`.
 */
export async function runMergePolicyOverrideRatchetProbe(
  projectRoot: string,
): Promise<MergePolicyOverrideRatchetReport> {
  return { violations: await runCarrierPhraseProbe(projectRoot, SPEC) };
}

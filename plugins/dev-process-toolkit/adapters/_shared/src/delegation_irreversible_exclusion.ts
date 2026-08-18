// delegation_irreversible_exclusion — /gate-check probe #78 (M129).
//
// THE DEFECT. `adapters/_shared/src/gate_class.ts` holds the irreversible-class
// exclusion as CODE: a standing authorization delegates the mechanical class and
// is refused on every guarded action (`IRREVERSIBLE_GUARDS`). The shipped prose
// that an operator actually reads before typing "drive it yourself" lives
// somewhere else entirely — `skills/deliver/SKILL.md` today, a reference doc
// tomorrow. Nothing keeps the two in step. A sixth guard added to the module, or
// an action phrase reworded there, leaves the prose describing an exclusion that
// is narrower than the one the code enforces; worse, prose that silently drops
// an action teaches the operator that a general delegation reaches it. The
// operator's mental model, not the module, is what decides whether they type the
// words at all, so a documented exclusion that omits `publish a package or
// release` is a real safety gap even though the code still refuses it.
//
// THE FIX. Every file that names the delegation vocabulary — `DELEGATION_ANCHOR`,
// i.e. "standing authorization" — must also name EVERY guard's operator-facing
// action phrase, sourced from `IRREVERSIBLE_GUARDS` rather than retyped. The
// required-phrase list is therefore derived, never a second copy: adding a guard
// automatically widens what the prose must say, and reddens this probe until it
// does.
//
// SCOPE, deliberately narrow in two directions and deliberately wide in a third:
//
//   * CARRIER-scoped. A file that never names the anchor makes no claim about
//     delegation and owes no exclusion prose. Without this the probe would demand
//     the five phrases of every markdown file in the tree — a false red on nearly
//     all of them, and a completely different (and wrong) contract.
//   * FILE-scoped, not clause-scoped. The phrases must appear in the file, not
//     inside the same sentence as the anchor. `/deliver` states the taxonomy on
//     one line and the restate-once rule on another; demanding co-location would
//     fail a compliant shipped skill.
//   * BOTH `skills/` AND `docs/`. Probe #77 walks skills only, because a
//     first-turn contract can only live in a SKILL.md. This exclusion can be
//     written down in either tree, and a reference doc that describes the
//     delegation while omitting an excluded action misleads exactly as badly as a
//     skill would. Restricting to skills/ would let the exclusion be documented
//     away in docs/.
//
// Those three scope rules, the plugin-rooted walk, and the violation shape are
// the MECHANISM, and it is shared with probe #79 `merge_policy_override_ratchet`
// through `carrier_phrase_probe.ts` rather than copied. What stays here is what
// makes this probe THIS probe: its id, its anchor, its derived phrase source,
// and its refusal text — so a #78 carrier that drops an action phrase reddens
// #78 and nothing else.
//
// Pure file reads only — no git, no network, no child processes.

import {
  runCarrierPhraseProbe,
  type CarrierPhraseProbeSpec,
  type CarrierPhraseViolation,
  type Severity,
} from "./carrier_phrase_probe";
import { DELEGATION_ANCHOR, IRREVERSIBLE_GUARDS } from "./gate_class";

export type { Severity };

export type DelegationIrreversibleExclusionViolation = CarrierPhraseViolation;

export interface DelegationIrreversibleExclusionReport {
  violations: DelegationIrreversibleExclusionViolation[];
}

/** The probe id, as registered in `skills/gate-check/SKILL.md` row #78. */
export const PROBE_ID = "delegation_irreversible_exclusion";

/**
 * The action phrases a carrier must name, DERIVED from the shipped guard list.
 *
 * Returns a fresh array on every call: callers sort it, and a shared array would
 * reorder the module's own guard list as a side effect. Deriving rather than
 * retyping is the whole anti-drift point — a sixth guard widens this list for
 * free, and a reworded phrase moves the requirement with it.
 */
export function requiredExclusionPhrases(): string[] {
  return IRREVERSIBLE_GUARDS.map((g) => g.actionPhrase);
}

function reasonFor(phrase: string): string {
  return (
    `file names the ${DELEGATION_ANCHOR} but never states that it excludes ` +
    `"${phrase}", so the documented exclusion is narrower than the one ` +
    `\`IRREVERSIBLE_GUARDS\` enforces`
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
      `${DELEGATION_ANCHOR} while it never names \`${phrase}\` — an operator ` +
      `who reads it comes away believing a general delegation reaches that ` +
      `action, which the shipped exclusion refuses.`,
    `Remedy: extend the passage that names the ${DELEGATION_ANCHOR} so it lists ` +
      `every excluded action verbatim, sourced from \`IRREVERSIBLE_GUARDS\` in ` +
      `\`adapters/_shared/src/gate_class.ts\`; never retype the phrases, and ` +
      `never document a narrower exclusion than the code enforces. A file that ` +
      `makes no delegation claim should not name the anchor at all.`,
    `Context: file=${rel}, line=${line}, phrase=${phrase}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/** Everything that makes this probe distinct from its engine-mate, #79. */
const SPEC: CarrierPhraseProbeSpec = {
  probeId: PROBE_ID,
  anchor: DELEGATION_ANCHOR,
  requiredPhrases: requiredExclusionPhrases,
  reasonFor,
  messageFor,
};

/**
 * Walk `plugins/dev-process-toolkit/{skills,docs}/**\/*.md` under `projectRoot`
 * and flag every delegation carrier that fails to name an excluded action. Pure
 * function — no side effects, no writes.
 *
 * Vacuous (zero violations, no crash) when the plugin tree is absent, so a
 * consumer project that never installed the toolkit's own sources cannot fail.
 *
 * Call site: `/gate-check` conformance probe #78 + the M129 integration test at
 * `tests/m129-ste-493-gate-class.test.ts`.
 */
export async function runDelegationIrreversibleExclusionProbe(
  projectRoot: string,
): Promise<DelegationIrreversibleExclusionReport> {
  return { violations: await runCarrierPhraseProbe(projectRoot, SPEC) };
}

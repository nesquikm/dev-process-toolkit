// gate_marker_refusal (STE-313 AC-STE-313.{1,2,3,5}) — consolidated
// single-call arbiter for every marker-gated first-turn decision in
// `/spec-write` (draft gate + branch gate) and `/setup` (Socratic
// first-turn scaffold-Write ban).
//
// **Role + relationship to the existing two-step pattern.** Today, the
// SKILL.md gate sites at `skills/spec-write/SKILL.md` § 0b step 4 (draft
// gate) + § 7a (branch gate) and `skills/setup/SKILL.md` § Rules (Socratic
// first-turn) drive the decision via an explicit two-step pattern: (1)
// run `check_marker_runtime.ts` to byte-grep the prompt body; (2) call
// `requireOrRefuse(...)` with the resulting `markerPresent` flag. This
// helper is the SINGLE-CALL equivalent — same primitives
// (`checkMarkerRuntime` + `RequiresInputRefusedError`), same byte-identical
// refusal behavior. Both paths satisfy AC-STE-313.{1,2,3}. The helper
// additionally serves as the production runtime arbiter for the
// AC-STE-313.4 regression-fixture replay loop at
// `tests/marker-absent-non-tty.test.ts`, which loads each of the three
// captured fixture bodies (Group 1b, Group 5b, setup-2026-05-19.json)
// and drives them through this exact decision matrix.
//
// Collapses the four-state matrix `(marker ∈ {present, absent}) × (stdin ∈
// {tty, non-tty})` into:
//
//   - marker present                ⇒ outcome: 'apply'   (auto-apply)
//   - marker absent + tty           ⇒ outcome: 'prompt'  (interactive)
//   - marker absent + non-tty       ⇒ throws RequiresInputRefusedError
//
// The refusal carries the NFR-10 canonical Verdict / Remedy / Context shape
// naming the gate site (`draft` / `branch` / `setup-socratic`) so refusal
// messages are actionable and machine-parseable for the /gate-check probe
// `marker_helper_invoked_per_gate` (AC-STE-313.6).
//
// AC-STE-313.5 — paraphrase triggers (`"work without stopping"`,
// `"autonomous-mode"`, `"standing instruction"`, pre-baked `<command-args>`
// prose, `claude -p` non-tty inference) are NOT acceptable substitutes for
// the literal 39-byte marker `<dpt:auto-approve>v1</dpt:auto-approve>`. The
// helper consults `checkMarkerRuntime` (byte-grep) only — case-altered,
// version-altered, and paraphrased near-misses MUST still refuse.
//
// Pure I/O: callers pass a materialized `promptBody` string and the
// observed `isTty` flag. The helper does not read `process.stdin.isTTY`
// itself so unit tests can drive both branches deterministically.

import { checkMarkerRuntime } from "./check_marker_runtime";
import { RequiresInputRefusedError } from "./requires_input";

/** Canonical marker token — used by the remedy-message renderer below. */
const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

/**
 * Stable-order tuple of the three gate sites this helper arbitrates. The
 * order is part of the public contract — downstream parsers (the
 * /gate-check probe in AC-STE-313.6) iterate this tuple to disambiguate
 * refusal messages.
 */
export const GATE_SITES = ["draft", "branch", "setup-socratic"] as const;

export type GateSite = (typeof GATE_SITES)[number];

export type GateMarkerOutcome = "apply" | "prompt";

export interface EvaluateGateMarkerRefusalSpec {
  /**
   * Materialized prompt body to scan for the literal marker. Callers MUST
   * pass the verbatim body the prompt-bearing child received — paraphrases,
   * harness `<system-reminder>` blocks, and CLI flag prose are scanned the
   * same way: literal byte-grep, no inference.
   */
  promptBody: string;
  /**
   * `true` when stdin is a TTY (interactive session). `false` when running
   * under `claude -p` or any other non-tty stdin. Callers should resolve
   * this from `process.stdin.isTTY === false` upstream; this helper trusts
   * the flag verbatim so tests can drive both branches.
   */
  isTty: boolean;
  /** Which gate site is being arbitrated. Selects the refusal-message shape. */
  gateSite: GateSite;
}

export interface EvaluateGateMarkerRefusalResult {
  outcome: GateMarkerOutcome;
  markerPresent: boolean;
}

interface GateSiteDescriptor {
  skillName: string;
  stepName: string;
  /** Short remedy hint specific to the gate site. */
  remedyHint: string;
}

const GATE_SITE_DESCRIPTORS: Record<GateSite, GateSiteDescriptor> = {
  draft: {
    skillName: "/spec-write",
    stepName: "§ 0b step 4 (draft gate)",
    remedyHint:
      "Re-invoke /spec-write with the literal marker prefixed to the prompt " +
      "body, or run interactively (tty) so the draft gate can prompt before " +
      "Provider.sync(spec) fires.",
  },
  branch: {
    skillName: "/spec-write",
    stepName: "§ 7a requireCommittableBranch (branch gate)",
    remedyHint:
      "Pre-bake the branch decision via the documented CLI flag, prefix the " +
      "literal marker, or run interactively — otherwise `git checkout -b` " +
      "cannot fire under non-tty stdin.",
  },
  "setup-socratic": {
    skillName: "/setup",
    stepName: "Socratic first-turn (STE-237 scaffold-Write ban)",
    remedyHint:
      "Re-invoke /setup with the literal marker prefixed to the prompt body, " +
      "or run interactively — the Socratic loop's first tool call MUST be " +
      "AskUserQuestion under non-tty stdin without the marker.",
  },
};

function buildRefusalMessage(gateSite: GateSite): string {
  const desc = GATE_SITE_DESCRIPTORS[gateSite];
  const verdict =
    `${desc.skillName} ${desc.stepName} refuses to auto-apply: ` +
    `gate_site=${gateSite}, marker absent under non-tty stdin. ` +
    `Auto Mode requires the literal byte-string marker — harness ` +
    `<system-reminder> prose, "work without stopping" paraphrases, ` +
    `pre-baked <command-args>, and \`claude -p\` non-interactive inference ` +
    `are NOT acceptable triggers (see docs/auto-mode-protocol.md § The Rule).`;
  const remedy =
    `${desc.remedyHint} The single byte-checkable trigger is the literal ` +
    `marker \`${MARKER}\` — inject it at the head of the prompt body.`;
  const ctx =
    `skill=${desc.skillName}, step=${desc.stepName}, gate_site=${gateSite}, ` +
    `marker=absent, stdin=non-tty`;
  return [`Verdict: ${verdict}`, `Remedy: ${remedy}`, `Context: ${ctx}`].join(
    "\n",
  );
}

/**
 * Arbitrate one marker-gated first-turn decision. See module header for
 * the full four-state matrix; throws {@link RequiresInputRefusedError}
 * (NFR-10 canonical shape) on the refused case.
 */
export function evaluateGateMarkerRefusal(
  spec: EvaluateGateMarkerRefusalSpec,
): EvaluateGateMarkerRefusalResult {
  const { present: markerPresent } = checkMarkerRuntime(spec.promptBody);

  if (markerPresent) {
    return { outcome: "apply", markerPresent: true };
  }
  if (spec.isTty) {
    return { outcome: "prompt", markerPresent: false };
  }

  // marker absent + non-tty ⇒ refuse with NFR-10 shape.
  const desc = GATE_SITE_DESCRIPTORS[spec.gateSite];
  throw new RequiresInputRefusedError({
    message: buildRefusalMessage(spec.gateSite),
    skillName: desc.skillName,
    stepName: `${desc.stepName} [${spec.gateSite}]`,
    key: `gate_site:${spec.gateSite}`,
    markerPresent: false,
  });
}

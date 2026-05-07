// requires_input — STE-232 AC-STE-232.2 helper.
//
// `requireOrRefuse(spec, key, sentinel)` consolidates the four-outcome
// decision every `requires-input:` (and default-applicable) step needs:
//
//   1. user-supplied  — interactive answer, not the sentinel placeholder
//   2. pre-baked      — CLI flag answer, not the sentinel placeholder
//   3. default-applied — auto-approve marker present AND a default exists
//   4. refused         — none of the above; throws RequiresInputRefusedError
//
// `requires-input:` steps pass `defaultValue: undefined` so the marker can
// NEVER default-apply them — Auto Mode does not relax requires-input. That's
// the load-bearing contract this FR closes against the v2.13.0 incident
// (model-imputed `tracker_mode=none` despite step 7b being `requires-input:`).
//
// Pure I/O — no filesystem reads, no env-var reads. Callers resolve the
// pre-bake / user-supplied / marker inputs upstream and pass the materialized
// spec in. See `docs/auto-mode-protocol.md` for the cross-skill contract.

export type RequireOutcome =
  | "user-supplied"
  | "pre-baked"
  | "default-applied"
  | "refused";

export interface RequireOrRefuseSpec {
  /**
   * Resolved interactive answer captured from a TTY prompt. `undefined`
   * means the step was not interactively asked (or the prompt was skipped).
   * A value matching `sentinel` does NOT count as an answer — the resolver
   * upstream may have returned the placeholder when stdin was not a TTY.
   */
  userSuppliedValue?: unknown;
  /**
   * Resolved pre-baked answer from a CLI flag (e.g., `--tracker=linear`).
   * `undefined` means no flag was supplied. A value matching `sentinel`
   * does NOT count as an answer.
   */
  preBakedValue?: unknown;
  /**
   * `true` when the auto-approve marker `<dpt:auto-approve>v1</dpt:auto-approve>`
   * is observed in the run environment (STE-226 default-apply mechanism).
   * For `requires-input:` steps, the marker is informational only — refusal
   * still fires when no answer is supplied.
   */
  markerPresent: boolean;
  /**
   * Default value to apply when the marker is present and no answer was
   * supplied. `undefined` is the canonical signal for `requires-input:` steps
   * (no safe default exists).
   */
  defaultValue?: unknown;
  /** Skill identifier for refusal-message rendering, e.g., `/setup`. */
  skillName: string;
  /** Step identifier for refusal-message rendering, e.g., `step 7b`. */
  stepName: string;
  /**
   * Free-form reason carried by the `requires-input: <reason>` annotation.
   * Surfaces verbatim in the NFR-10 refusal Verdict so the operator
   * understands why no default exists.
   */
  refusalReason: string;
}

export interface RequireOrRefuseResult {
  outcome: Exclude<RequireOutcome, "refused">;
  value: unknown;
}

/**
 * Thrown when `requireOrRefuse` cannot resolve a value via any of the three
 * permitted sources (user-supplied, pre-baked, default-applied). Carries the
 * NFR-10 canonical message + structured fields so callers can introspect.
 */
export class RequiresInputRefusedError extends Error {
  public readonly skillName: string;
  public readonly stepName: string;
  public readonly key: string;
  public readonly markerPresent: boolean;

  constructor(opts: {
    message: string;
    skillName: string;
    stepName: string;
    key: string;
    markerPresent: boolean;
  }) {
    super(opts.message);
    this.name = "RequiresInputRefusedError";
    this.skillName = opts.skillName;
    this.stepName = opts.stepName;
    this.key = opts.key;
    this.markerPresent = opts.markerPresent;
  }
}

function buildRefusalMessage(
  spec: RequireOrRefuseSpec,
  key: string,
): string {
  const verdict =
    `${spec.skillName} ${spec.stepName} requires an explicit answer for ` +
    `"${key}"; ${spec.refusalReason} Auto Mode does not default-apply ` +
    `requires-input steps (see docs/auto-mode-protocol.md § The Rule).`;
  const remedy =
    `Pre-bake an answer via the documented CLI flag, or run the prompt ` +
    `interactively. The auto-approve marker ` +
    `\`<dpt:auto-approve>v1</dpt:auto-approve>\` is informational only for ` +
    `requires-input steps — it does not relax the requirement.`;
  const ctx =
    `skill=${spec.skillName}, step=${spec.stepName}, key=${key}, ` +
    `marker=${spec.markerPresent ? "present" : "absent"}`;
  return [`Verdict: ${verdict}`, `Remedy: ${remedy}`, `Context: ${ctx}`].join(
    "\n",
  );
}

/**
 * Decide whether a `requires-input:` (or default-applicable) step has a
 * concrete answer. Returns one of the three accepting outcomes; throws
 * {@link RequiresInputRefusedError} on the refused case.
 *
 * Precedence: user-supplied → pre-baked → default-applied → refused.
 */
export function requireOrRefuse(
  spec: RequireOrRefuseSpec,
  key: string,
  sentinel: unknown,
): RequireOrRefuseResult {
  if (
    spec.userSuppliedValue !== undefined &&
    spec.userSuppliedValue !== sentinel
  ) {
    return { outcome: "user-supplied", value: spec.userSuppliedValue };
  }
  if (spec.preBakedValue !== undefined && spec.preBakedValue !== sentinel) {
    return { outcome: "pre-baked", value: spec.preBakedValue };
  }
  if (spec.markerPresent && spec.defaultValue !== undefined) {
    return { outcome: "default-applied", value: spec.defaultValue };
  }
  throw new RequiresInputRefusedError({
    message: buildRefusalMessage(spec, key),
    skillName: spec.skillName,
    stepName: spec.stepName,
    key,
    markerPresent: spec.markerPresent,
  });
}

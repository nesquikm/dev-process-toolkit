// STE-305 — Wrapper-aware routing helper for /gate-check probes #8
// (`ticket_state_drift`, STE-54) and #14 (`active_ticket_drift`, STE-87).
//
// Pure function (no I/O) that centralizes the status-tolerance routing both
// probes share so neither has to duplicate STE-302's `statusToRole`
// classification or STE-304's three-way prompt/advisory branching.
//
// Inputs:
//   - `observedStatus`   the verbatim tracker status read from the FR.
//   - `expectedRole`     the canonical role the probe wants (`in_progress`
//                         for probe #14, `done` for probe #8).
//   - `config`           the loaded `TrackerConfig` (or `null` when the
//                         project hasn't opted into specs/tracker-config.yaml).
//   - `providerMode`     `'tracker'` for real-tracker mode, `'none'` for
//                         local-mode (probes are vacuous in mode=none).
//   - `isTty`            whether stdin is a tty (probe runner caller decides
//                         whether to prompt vs. emit advisory rows).
//   - `frId`             FR identifier surfaced in the advisory text.
//
// Outcomes (discriminated by `kind`):
//   - `pass`                      — observed status maps to a role that
//                                   matches `expectedRole`.
//   - `fail-genuine-drift`        — observed status maps to a non-matching
//                                   role (M23-class drift). Probe runner
//                                   gates the result with this row.
//   - `prompt-required`           — observed status is a non-key encounter
//                                   (known-non-key OR unknown) and stdin is
//                                   a tty: the probe runner is expected to
//                                   fire the wrapper's three-way prompt
//                                   (force/skip/cancel) per STE-304.
//   - `advisory-non-tty`          — same non-key encounter under non-tty:
//                                   the probe runner emits an advisory row
//                                   instead of GATE FAILED. AC.5 mandates
//                                   that non-tty downgrades the verdict;
//                                   `capabilityKey` surfaces a stable
//                                   literal token for the capabilities map.
//   - `strict-fallback-pass`      — `config === null` and observed equals
//                                   the strict expected status (pre-STE-302
//                                   semantics: caller resolves the strict
//                                   expected via per-adapter mapping).
//   - `strict-fallback-fail`      — `config === null` and observed mismatches
//                                   the strict expected status. Crucially:
//                                   even under non-tty, no advisory degrade.
//   - `vacuous-mode-none`         — `providerMode === 'none'`: short-circuit
//                                   before any tolerance branching.
//
// Capability key tokens (AC.8 — byte-exact):
//   - `tracker_status_advisory_non_tty`
//   - `tracker_status_genuine_drift`

import { statusToRole, type Role, type TrackerConfig } from "./tracker_config";

/**
 * Input arguments to {@link routeWithTolerance}. Exported so probe runners
 * can type-narrow when constructing the call.
 */
export interface ToleranceProbeRouting {
  observedStatus: string;
  expectedRole: Role;
  config: TrackerConfig | null;
  providerMode: "tracker" | "none";
  isTty: boolean;
  frId: string;
}

export type ToleranceRoutingOutcome =
  | { kind: "pass"; observedStatus: string; mappedRole: Role }
  | {
      kind: "fail-genuine-drift";
      observedStatus: string;
      expectedRole: Role;
      mappedRole: Role;
      capabilityKey: "tracker_status_genuine_drift";
    }
  | {
      kind: "prompt-required";
      observedStatus: string;
      expectedRole: Role;
      isUnknown: boolean;
    }
  | {
      kind: "advisory-non-tty";
      advisoryText: string;
      capabilityKey: "tracker_status_advisory_non_tty";
      isUnknown: boolean;
    }
  | { kind: "strict-fallback-pass" }
  | { kind: "strict-fallback-fail" }
  | { kind: "vacuous-mode-none" };

const ADVISORY_CAPABILITY_KEY = "tracker_status_advisory_non_tty" as const;
const GENUINE_DRIFT_CAPABILITY_KEY = "tracker_status_genuine_drift" as const;

/**
 * Build the advisory text surfaced under non-tty when the observed status is
 * a non-key encounter. Two variants:
 *
 *   - known-non-key (declared in `statuses:` but maps to no role) — caller
 *     is told to re-run `/gate-check` interactively to resolve.
 *   - unknown (not declared in `statuses:` at all) — same baseline + a
 *     `/setup` discovery hint so the operator can resync the project's
 *     status list before retrying.
 */
function buildAdvisoryText(args: {
  frId: string;
  observedStatus: string;
  expectedRole: Role;
  isUnknown: boolean;
}): string {
  const base =
    `${args.frId} sits in non-key status \`${args.observedStatus}\`; ` +
    `expected role \`${args.expectedRole}\`. ` +
    `Re-run /gate-check interactively to resolve.`;
  if (args.isUnknown) {
    return (
      `${base} Hint: status \`${args.observedStatus}\` is not declared in ` +
      `specs/tracker-config.yaml — re-run /setup to resync the project's ` +
      `status list, then retry.`
    );
  }
  return base;
}

/**
 * Route a status read through the STE-302 / STE-304 tolerance pipeline.
 * Pure function (no I/O): both probe #8 and probe #14 call this with their
 * `expectedRole` and consume the outcome to decide pass / fail / advisory.
 */
export function routeWithTolerance(
  args: ToleranceProbeRouting,
): ToleranceRoutingOutcome {
  const { observedStatus, expectedRole, config, providerMode, isTty, frId } =
    args;

  // mode: 'none' short-circuit — no tracker, nothing to compare.
  if (providerMode === "none") {
    return { kind: "vacuous-mode-none" };
  }

  // Config-absent fallback: pre-STE-302 strict-equality semantics. Without
  // `specs/tracker-config.yaml` we cannot consult `statusToRole`, so we fall
  // back to the legacy per-adapter default status labels (Backlog / In
  // Progress / In Review / Done — shipped by Linear and Jira adapters before
  // tracker-config.yaml existed). Crucially: no advisory degrade — projects
  // that haven't opted into tracker-config.yaml keep their strict behavior
  // even under non-tty.
  if (config === null) {
    const strictExpected = legacyStrictStatusFor(expectedRole);
    if (observedStatus === strictExpected) {
      return { kind: "strict-fallback-pass" };
    }
    return { kind: "strict-fallback-fail" };
  }

  // Real tracker mode + config present — consult statusToRole.
  const role = statusToRole(config, observedStatus);

  // Mapped role exists and is not the unknown sentinel.
  if (role !== null && role !== "unknown") {
    if (role === expectedRole) {
      return { kind: "pass", observedStatus, mappedRole: role };
    }
    // Mapped role mismatch — genuine M23-class drift.
    return {
      kind: "fail-genuine-drift",
      observedStatus,
      expectedRole,
      mappedRole: role,
      capabilityKey: GENUINE_DRIFT_CAPABILITY_KEY,
    };
  }

  // Non-key encounter: either known-non-key (role === null) or unknown
  // (role === "unknown"). Three-way branching by tty.
  const isUnknown = role === "unknown";
  if (isTty) {
    return {
      kind: "prompt-required",
      observedStatus,
      expectedRole,
      isUnknown,
    };
  }
  // Non-tty: advisory row, not GATE FAILED.
  return {
    kind: "advisory-non-tty",
    advisoryText: buildAdvisoryText({
      frId,
      observedStatus,
      expectedRole,
      isUnknown,
    }),
    capabilityKey: ADVISORY_CAPABILITY_KEY,
    isUnknown,
  };
}

/**
 * Pre-STE-302 default status mapping for the canonical four-role enum. The
 * `config === null` fallback uses this so projects that haven't opted into
 * `specs/tracker-config.yaml` keep their strict-equality semantics
 * (Linear/Jira shipped these labels as the per-adapter default).
 */
function legacyStrictStatusFor(role: Role): string {
  switch (role) {
    case "initial":
      return "Backlog";
    case "in_progress":
      return "In Progress";
    case "in_review":
      return "In Review";
    case "done":
      return "Done";
  }
}

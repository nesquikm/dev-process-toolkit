// STE-304 — tracker-tolerance Provider wrapper.
//
// `withTolerance(provider, specsDir, deps?)` returns a Provider-compatible
// object that reads STE-302's `specs/tracker-config.yaml` and consults
// `statusToRole` for every status-touching method. The wrapper composes with
// both `LocalProvider` (`mode: 'none'`) and `TrackerProvider`
// (`mode: 'tracker'`) identically; mode-none consumers simply pass through.
//
// Behavior summary (full AC list lives in
// `tests/tracker-tolerance-wrapper.test.ts`):
//
//   - mapped role matches expected → pass-through, no prompt, single
//     underlying read.
//   - known-non-key status (in `statuses:` but mapped to no role) → prompt
//     fired naming observed + expected + known list.
//   - unknown status (not in `statuses:` at all) → prompt fired with the
//     `/setup` re-run discovery hint.
//   - three closed-form options force / skip / cancel + always-on Other.
//   - non-tty stdin (regardless of marker) → `RequiresInputRefusedError`
//     before any prompt.
//   - `mode: 'none'` → wrapper is vacuous (zero `statusToRole` consultations).
//   - adapter-config absent → wrapper is a no-op (pre-STE-302 strict-equality
//     path preserved upstream).
//
// All side-channel concerns (askUserQuestion, stdin-tty detection,
// capability recording) are dependency-injected so the wrapper is unit
// testable without spawning a real prompt.

import {
  readTrackerConfig,
  statusToRole,
  type Role,
  type TrackerConfig,
} from "./tracker_config";
import { RequiresInputRefusedError } from "./requires_input";
import type {
  FRMetadata,
  FRSpec,
  LockResult,
  Provider,
  SyncResult,
} from "./provider";

// ---------------------------------------------------------------------------
// Public exports — Skipped sentinel + cancel error + DI surface
// ---------------------------------------------------------------------------

/**
 * Sentinel value returned by wrapper-instrumented status methods when the
 * operator picked the `skip` branch in the tolerance prompt. Callers should
 * pattern-match on `kind === "skipped"` rather than coerce to a status
 * string.
 */
export const Skipped = Object.freeze({
  kind: "skipped" as const,
  reason:
    "Operator chose `skip` in the tracker-tolerance prompt — caller should treat the read as inapplicable and proceed without a status assertion.",
});

/**
 * Structural shape of the {@link Skipped} sentinel. Useful for callers that
 * want a type-narrowing check independent of the frozen object identity.
 */
export interface SkippedSentinel {
  readonly kind: "skipped";
  readonly reason: string;
}

/**
 * Thrown when the operator selects `cancel` from the tracker-tolerance
 * prompt. Carries the NFR-10 canonical refusal shape
 * (`Refusing:` / `Remedy:` / `Context:`) so callers can render the message
 * verbatim.
 */
export class TrackerToleranceCancelledError extends Error {
  public readonly observedStatus: string;
  public readonly expectedRole: Role | null;
  public readonly gateSite: string;

  constructor(opts: {
    observedStatus: string;
    expectedRole: Role | null;
    gateSite: string;
    knownStatuses?: string[];
  }) {
    const verdict =
      `Refusing: tracker-tolerance prompt cancelled — observed status ` +
      `\`${opts.observedStatus}\` could not be reconciled with expected role ` +
      `\`${opts.expectedRole ?? "<none>"}\`, and the operator chose \`cancel\`.`;
    const remedy =
      `Remedy: re-run /setup to resync the project's status list, fix the ` +
      `ticket's tracker status by hand, or re-invoke and pick \`force\`/\`skip\` ` +
      `when the prompt re-appears.`;
    const ctx =
      `Context: gate=${opts.gateSite}, observed=${opts.observedStatus}, ` +
      `expected=${opts.expectedRole ?? "<none>"}` +
      (opts.knownStatuses
        ? `, known=[${opts.knownStatuses.join(", ")}]`
        : "");
    super([verdict, remedy, ctx].join("\n"));
    this.name = "TrackerToleranceCancelledError";
    this.observedStatus = opts.observedStatus;
    this.expectedRole = opts.expectedRole;
    this.gateSite = opts.gateSite;
  }
}

// ---------------------------------------------------------------------------
// AskUserQuestion DI shape
// ---------------------------------------------------------------------------

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

/**
 * Minimal structural shape of an AskUserQuestion request as consumed by the
 * wrapper. Real callers may pass richer payloads through to their host;
 * we constrain only the fields the wrapper itself populates.
 */
export interface AskUserQuestionRequest {
  question: string;
  options?: AskUserQuestionOption[];
  /**
   * Always-on Other fallback indicator. Hosts that model "Other" as an
   * implicit always-present option set this `true`; hosts that include
   * "Other" as a literal {@link AskUserQuestionOption} may leave it
   * `undefined`. Both surfaces satisfy AC.3.
   */
  allowOther?: boolean;
  /** Synonym for {@link allowOther}; the test asserts either name. */
  otherFallback?: boolean;
  /** Free-form context bag; passed through to the host verbatim. */
  context?: Record<string, unknown>;
}

export interface AskUserQuestionResponse {
  selectedLabel: string;
  otherText?: string;
}

export type AskUserQuestionFn = (
  request: AskUserQuestionRequest,
) => Promise<AskUserQuestionResponse>;

/**
 * Dependency-injection surface for the wrapper. All fields are optional so
 * that production callers can pass `withTolerance(provider, specsDir)`
 * verbatim and pick up sensible defaults.
 */
export interface TrackerToleranceDeps {
  /** Prompt asker — defaults to a throwing stub callers must replace. */
  askUserQuestion?: AskUserQuestionFn;
  /** Stdin-tty probe — defaults to `process.stdin.isTTY !== false`. */
  isStdinTty?: () => boolean;
  /**
   * Auto-approve marker indicator. Wrapper is informational-only on
   * marker presence — refusal still fires under non-tty regardless.
   */
  markerPresent?: boolean;
  /**
   * Canonical role the caller expects this status read to land on. When
   * supplied, the wrapper short-circuits pass-through whenever
   * `statusToRole(config, observed) === expectedRole`. When omitted, the
   * wrapper falls back to "any mapped role is a pass-through" semantics.
   */
  expectedRole?: Role;
  /**
   * Capability-row sink. Receives literal-token keys
   * (AC.7: `tracker_status_forced`, `tracker_status_skipped`,
   * `tracker_status_cancelled`, `tracker_status_unknown_encountered`,
   * `tracker_tolerance_refused_non_tty`). Caller wires this to the
   * closing-summary capability list.
   */
  recordCapability?: (key: string) => void;
  /** Gate site name surfaced in refusal messages. */
  gateSite?: string;
}

// ---------------------------------------------------------------------------
// Internal — outcome resolution
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "force" }
  | { kind: "skip" }
  | { kind: "cancel" };

const CAPABILITY_KEYS = {
  force: "tracker_status_forced",
  skip: "tracker_status_skipped",
  cancel: "tracker_status_cancelled",
  unknown: "tracker_status_unknown_encountered",
  refusedNonTty: "tracker_tolerance_refused_non_tty",
} as const;

const GATE_SITE_DEFAULT = "tracker_tolerance_prompt";

function defaultAsker(): AskUserQuestionFn {
  return async () => {
    throw new Error(
      "tracker-tolerance: askUserQuestion is required when a prompt fires; " +
        "pass `deps.askUserQuestion` to withTolerance().",
    );
  };
}

function defaultIsStdinTty(): boolean {
  // Mirrors requires_input.ts: only the literal boolean `false` counts as
  // non-tty. `undefined` on real terminals is treated as tty-ish.
  return (process.stdin as { isTTY?: boolean }).isTTY !== false;
}

function buildPromptRequest(opts: {
  observed: string;
  expectedRole: Role | null;
  config: TrackerConfig;
  isUnknown: boolean;
}): AskUserQuestionRequest {
  const knownList = opts.config.statuses.join(", ");
  const baseQuestion = opts.isUnknown
    ? `Tracker drift: observed status \`${opts.observed}\` is not declared ` +
      `in specs/tracker-config.yaml (known: ${knownList}). Expected role ` +
      `\`${opts.expectedRole ?? "<none>"}\`. ` +
      `Hint: re-run /setup to resync the project's status list, then retry.`
    : `Tracker tolerance: observed status \`${opts.observed}\` is declared ` +
      `but maps to no canonical role; expected role ` +
      `\`${opts.expectedRole ?? "<none>"}\` (known statuses: ${knownList}).`;
  return {
    question: baseQuestion,
    options: [
      {
        label: "force",
        description:
          "Treat the observed status as if it matched the expected role and proceed.",
      },
      {
        label: "skip",
        description:
          "Skip this status assertion; caller treats the read as inapplicable.",
      },
      {
        label: "cancel",
        description:
          "Abort the operation; surface a TrackerToleranceCancelledError to the operator.",
      },
    ],
    allowOther: true,
    otherFallback: true,
    context: {
      observed: opts.observed,
      expectedRole: opts.expectedRole,
      knownStatuses: opts.config.statuses,
      isUnknown: opts.isUnknown,
    },
  };
}

function classifyOutcome(label: string): Outcome | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === "force") return { kind: "force" };
  if (normalized === "skip") return { kind: "skip" };
  if (normalized === "cancel") return { kind: "cancel" };
  return null;
}

// ---------------------------------------------------------------------------
// withTolerance — main entry point
// ---------------------------------------------------------------------------

/**
 * Wrap a {@link Provider} so its status-touching methods consult the
 * project's `specs/tracker-config.yaml` (STE-302) and route any mismatch
 * through a three-way operator prompt (force / skip / cancel).
 *
 * Composition rules:
 *   - `mode: 'none'` providers (e.g., `LocalProvider`) pass through with
 *     zero `statusToRole` consultations.
 *   - Absent `specs/tracker-config.yaml` → wrapper is a no-op (pre-STE-302
 *     strict-equality path preserved by callers).
 *   - Non-tty stdin → `RequiresInputRefusedError` before any prompt, even
 *     with the auto-approve marker present.
 */
export function withTolerance(
  provider: Provider,
  specsDir: string,
  deps: TrackerToleranceDeps = {},
): Provider {
  const ask = deps.askUserQuestion ?? defaultAsker();
  const isTty = deps.isStdinTty ?? defaultIsStdinTty;
  const markerPresent = deps.markerPresent ?? false;
  const expectedRole = deps.expectedRole;
  const gateSite = deps.gateSite ?? GATE_SITE_DEFAULT;
  const record = deps.recordCapability ?? (() => {});

  // mode: 'none' → vacuous wrapper, no statusToRole consultations.
  if (provider.mode === "none") {
    return provider;
  }

  // Adapter-config absent → wrapper is a no-op (the wrapper has no project
  // vocabulary, so it must not prompt; upstream callers keep using strict
  // per-adapter status_mapping equality). Malformed YAML or schema violations
  // propagate as `TrackerConfigShapeError` from `readTrackerConfig` — we
  // deliberately do not swallow them; the caller renders the canonical
  // refusal upstream.
  const trackerConfig = readTrackerConfig(specsDir);
  if (trackerConfig === null) {
    return provider;
  }

  async function resolveStatus(observed: string): Promise<string | SkippedSentinel> {
    const role = statusToRole(trackerConfig, observed);
    // Pass-through when mapped role exists and matches expectation (or the
    // caller didn't pin an expectation).
    if (role !== null && role !== "unknown") {
      if (expectedRole === undefined || role === expectedRole) {
        return observed;
      }
    }

    // Non-tty refusal happens BEFORE any prompt — marker is informational.
    if (!isTty()) {
      record(CAPABILITY_KEYS.refusedNonTty);
      const verdict =
        `Verdict: tracker-tolerance prompt cannot run under non-tty stdin ` +
        `— observed status \`${observed}\` at gate \`${gateSite}\` needs an ` +
        `operator decision (force/skip/cancel).`;
      const remedy =
        `Remedy: re-invoke interactively (tty), or pre-bake a tolerance ` +
        `decision via the documented CLI surface. The auto-approve marker ` +
        `is informational only for tracker-tolerance prompts.`;
      const ctx =
        `Context: gate=${gateSite}, observed=${observed}, ` +
        `expected=${expectedRole ?? "<none>"}, marker=` +
        `${markerPresent ? "present" : "absent"}, stdin=non-tty`;
      throw new RequiresInputRefusedError({
        message: [verdict, remedy, ctx].join("\n"),
        skillName: "tracker-tolerance",
        stepName: gateSite,
        key: "tracker_tolerance_decision",
        markerPresent,
      });
    }

    const isUnknown = role === "unknown";
    if (isUnknown) {
      record(CAPABILITY_KEYS.unknown);
    }

    const request = buildPromptRequest({
      observed,
      expectedRole: expectedRole ?? null,
      config: trackerConfig,
      isUnknown,
    });
    const response = await ask(request);
    const outcome = classifyOutcome(response.selectedLabel);
    if (outcome === null) {
      // Operator picked "Other" or returned an unknown label — treat as a
      // cancel for the wrapper's purposes; surface the canonical error so
      // the caller still gets a deterministic gate.
      record(CAPABILITY_KEYS.cancel);
      throw new TrackerToleranceCancelledError({
        observedStatus: observed,
        expectedRole: expectedRole ?? null,
        gateSite,
        knownStatuses: trackerConfig.statuses,
      });
    }
    if (outcome.kind === "force") {
      record(CAPABILITY_KEYS.force);
      return observed;
    }
    if (outcome.kind === "skip") {
      record(CAPABILITY_KEYS.skip);
      return Skipped;
    }
    record(CAPABILITY_KEYS.cancel);
    throw new TrackerToleranceCancelledError({
      observedStatus: observed,
      expectedRole: expectedRole ?? null,
      gateSite,
      knownStatuses: trackerConfig.statuses,
    });
  }

  // Wrap status-touching methods. Other methods pass through unchanged so
  // composition with `LocalProvider`/`TrackerProvider` stays identical.
  const wrapped: Provider = {
    mode: provider.mode,
    listMilestones: provider.listMilestones.bind(provider),
    listActiveFRs: provider.listActiveFRs.bind(provider),
    getMetadata: provider.getMetadata.bind(provider),
    sync: provider.sync.bind(provider),
    getUrl: provider.getUrl.bind(provider),
    claimLock: provider.claimLock.bind(provider),
    releaseLock: provider.releaseLock.bind(provider),
    filenameFor: provider.filenameFor.bind(provider),
    async getTicketStatus(
      ticketId: string,
    ): Promise<{ status: string; assignee?: string | null }> {
      const underlying = await provider.getTicketStatus(ticketId);
      const resolved = await resolveStatus(underlying.status);
      if (typeof resolved === "string") {
        return { status: resolved, assignee: underlying.assignee };
      }
      // Skipped sentinel — surface verbatim. Cast through unknown so the
      // structural sentinel survives the Provider return-type narrowing;
      // callers pattern-match on `kind === "skipped"`.
      return resolved as unknown as { status: string; assignee?: string | null };
    },
  };
  return wrapped;
}

// Re-export shared types so test code can import the full surface from this
// module alone.
export type { FRMetadata, FRSpec, LockResult, Provider, SyncResult };

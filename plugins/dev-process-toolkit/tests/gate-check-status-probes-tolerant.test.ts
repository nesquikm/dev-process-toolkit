// STE-305 — Behavioral tests for the wrapper-aware routing helper that
// /gate-check probes #8 (ticket_state_drift, STE-54) and #14
// (active_ticket_drift, STE-87) consume to make their status comparison
// tolerance-aware.
//
// The helper — `routeWithTolerance(...)` exported from
// `adapters/_shared/src/tolerance_probe_routing.ts` — is a pure function
// (no I/O) that takes the observed status, the expected canonical role, the
// loaded tracker config (or `null` for the config-absent fallback), the
// `mode: 'none'` / 'tracker' provider mode, and the tty flag, and returns a
// discriminated outcome:
//
//   - { kind: "pass" }                          — mapped role matches expected
//   - { kind: "fail-genuine-drift", observed, expectedRole, mappedRole }
//                                               — mapped role mismatch (M23-class drift)
//   - { kind: "prompt-required", observed, expectedRole, isUnknown }
//                                               — non-key encounter under tty; probe runner fires
//                                                 the wrapper's three-way prompt
//   - { kind: "advisory-non-tty", advisoryText, capabilityKey, isUnknown }
//                                               — non-key encounter under non-tty;
//                                                 probe runner emits advisory + capability row
//   - { kind: "strict-fallback-pass" } | { kind: "strict-fallback-fail" }
//                                               — config-absent path: caller uses
//                                                 pre-STE-302 strict-equality semantics
//   - { kind: "vacuous-mode-none" }             — mode: none short-circuit
//
// The helper centralizes AC.1 / AC.2 / AC.3 / AC.5 / AC.6 / AC.7 logic so
// probes #8 and #14 can both invoke it without duplicating tolerance-routing
// branches.

import { describe, expect, test } from "bun:test";
import type { TrackerConfig } from "../adapters/_shared/src/tracker_config";
import { activeTicketDriftPasses } from "../adapters/_shared/src/active_ticket_drift_predicate";
import {
  routeWithTolerance,
  type ToleranceProbeRouting,
  type ToleranceRoutingOutcome,
} from "../adapters/_shared/src/tolerance_probe_routing";

const CFG: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Backlog", "In Progress", "In Review", "In QA", "Done"],
  roles: {
    initial: "Backlog",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
  },
};

function call(
  args: Partial<ToleranceProbeRouting> & {
    observedStatus: string;
    expectedRole: "in_progress" | "done";
  },
): ToleranceRoutingOutcome {
  // Use `"config" in args` so an explicit `config: null` propagates as null
  // (the `??` operator would coalesce null to CFG and break AC.6's
  // config-absent fallback assertions).
  return routeWithTolerance({
    observedStatus: args.observedStatus,
    expectedRole: args.expectedRole,
    config: "config" in args ? (args.config as TrackerConfig | null) : CFG,
    providerMode: args.providerMode ?? "tracker",
    isTty: args.isTty ?? true,
    frId: args.frId ?? "STE-305",
  });
}

describe("AC-STE-305.1 — probe #14 wrapper-aware: mapped role match passes (in_progress)", () => {
  test("active FR + observed 'In Progress' + expected 'in_progress' ⇒ pass", () => {
    const out = call({ observedStatus: "In Progress", expectedRole: "in_progress" });
    expect(out.kind).toBe("pass");
  });
});

describe("AC-STE-305.2 — probe #8 wrapper-aware: mapped role match passes (done)", () => {
  test("archived FR + observed 'Done' + expected 'done' ⇒ pass", () => {
    const out = call({ observedStatus: "Done", expectedRole: "done" });
    expect(out.kind).toBe("pass");
  });
});

describe("AC-STE-305.3 — genuine drift preserved: mapped-role mismatch ⇒ fail (both probes)", () => {
  test("active FR + observed 'Backlog' + expected 'in_progress' ⇒ fail-genuine-drift", () => {
    const out = call({ observedStatus: "Backlog", expectedRole: "in_progress" });
    expect(out.kind).toBe("fail-genuine-drift");
    if (out.kind === "fail-genuine-drift") {
      expect(out.observedStatus).toBe("Backlog");
      expect(out.expectedRole).toBe("in_progress");
      expect(out.mappedRole).toBe("initial");
    }
  });

  test("archived FR + observed 'In Progress' + expected 'done' ⇒ fail-genuine-drift", () => {
    const out = call({ observedStatus: "In Progress", expectedRole: "done" });
    expect(out.kind).toBe("fail-genuine-drift");
    if (out.kind === "fail-genuine-drift") {
      expect(out.mappedRole).toBe("in_progress");
    }
  });

  test("active FR + observed 'Done' + expected 'in_progress' ⇒ fail-genuine-drift (M23-class)", () => {
    // The exact classic M23 drift: ticket sitting at Done when probe expected in_progress.
    // STE-151 carve-outs apply at the probe-runner level (using plan_task_state);
    // the wrapper helper itself reports genuine drift here.
    const out = call({ observedStatus: "Done", expectedRole: "in_progress" });
    expect(out.kind).toBe("fail-genuine-drift");
  });
});

describe("AC-STE-305.4 — STE-151 carve-outs preserved: composed predicate still gates the probe-runner branch", () => {
  test("active FR + done ticket + plan has unchecked tasks ⇒ activeTicketDriftPasses returns true (carve-out wins before wrapper)", () => {
    // The wrapper helper reports drift here, but the probe-runner consults
    // activeTicketDriftPasses() FIRST; the carve-out short-circuits before
    // the tolerance routing runs. This test pins the contract that the
    // predicate's signature is unchanged across STE-305 — STE-151 carve-out
    // tests in gate-check-active-ticket-drift.test.ts continue to pass.
    const ok = activeTicketDriftPasses(
      { status: "Done", assignee: "u@e" },
      { uncheckedTasks: 2, totalTasks: 3, planStatus: "active" },
      { in_progress: "In Progress", done: "Done" },
      "u@e",
    );
    expect(ok).toBe(true);
  });

  test("fully-checked-single-FR exemption: done ticket + plan all-checked + total > 0 ⇒ predicate true (STE-180 widening intact)", () => {
    const ok = activeTicketDriftPasses(
      { status: "Done", assignee: "u@e" },
      { uncheckedTasks: 0, totalTasks: 3, planStatus: "active" },
      { in_progress: "In Progress", done: "Done" },
      "u@e",
    );
    expect(ok).toBe(true);
  });
});

describe("AC-STE-305.5 — non-tty advisory routing: non-key encounter under non-tty ⇒ ADVISORY (not GATE FAILED)", () => {
  test("known-non-key status (in statuses, no role) + non-tty ⇒ advisory-non-tty + capability key", () => {
    // "In QA" is declared in statuses: but maps to no canonical role.
    const out = call({
      observedStatus: "In QA",
      expectedRole: "in_progress",
      isTty: false,
    });
    expect(out.kind).toBe("advisory-non-tty");
    if (out.kind === "advisory-non-tty") {
      expect(out.capabilityKey).toBe("tracker_status_advisory_non_tty");
      expect(out.isUnknown).toBe(false);
      // Format: `<FR-id> sits in non-key status <observed>; expected role <role>. Re-run /gate-check interactively to resolve.`
      expect(out.advisoryText).toContain("STE-305");
      expect(out.advisoryText).toContain("In QA");
      expect(out.advisoryText).toContain("in_progress");
      expect(out.advisoryText).toMatch(/Re-run\s+\/gate-check\s+interactively/);
    }
  });

  test("unknown status (not in statuses) + non-tty ⇒ advisory-non-tty + discovery hint + capability key", () => {
    const out = call({
      observedStatus: "Triage",
      expectedRole: "in_progress",
      isTty: false,
    });
    expect(out.kind).toBe("advisory-non-tty");
    if (out.kind === "advisory-non-tty") {
      expect(out.capabilityKey).toBe("tracker_status_advisory_non_tty");
      expect(out.isUnknown).toBe(true);
      // Discovery hint surfaces re-run /setup to resync the project's status list.
      expect(out.advisoryText).toMatch(/\/setup/);
    }
  });

  test("known-non-key under tty ⇒ prompt-required (wrapper would fire AskUserQuestion)", () => {
    const out = call({
      observedStatus: "In QA",
      expectedRole: "in_progress",
      isTty: true,
    });
    expect(out.kind).toBe("prompt-required");
    if (out.kind === "prompt-required") {
      expect(out.observedStatus).toBe("In QA");
      expect(out.expectedRole).toBe("in_progress");
      expect(out.isUnknown).toBe(false);
    }
  });
});

describe("AC-STE-305.6 — config-absent fallback: strict equality preserved (wrapper is a no-op)", () => {
  test("config = null + observed matches strict expected ⇒ strict-fallback-pass", () => {
    const out = call({
      observedStatus: "In Progress",
      expectedRole: "in_progress",
      config: null,
    });
    expect(out.kind).toBe("strict-fallback-pass");
  });

  test("config = null + observed != strict expected ⇒ strict-fallback-fail (no advisory degrade)", () => {
    const out = call({
      observedStatus: "Backlog",
      expectedRole: "in_progress",
      config: null,
      isTty: false,
    });
    // Crucially: even under non-tty, config-absent does NOT route to advisory.
    // It falls back to strict equality so pre-STE-302 projects keep their behavior.
    expect(out.kind).toBe("strict-fallback-fail");
  });

  test("config = null + non-key observed under non-tty ⇒ strict-fallback-fail, NOT advisory", () => {
    // Important regression: a project that hasn't opted into tracker-config.yaml
    // must not surface the new advisory rows. The advisory path is gated on
    // having a real config to consult.
    const out = call({
      observedStatus: "In QA",
      expectedRole: "in_progress",
      config: null,
      isTty: false,
    });
    expect(out.kind).toBe("strict-fallback-fail");
  });
});

describe("AC-STE-305.7 — mode: none vacuous (zero wrapper consultations)", () => {
  test("providerMode = 'none' ⇒ vacuous-mode-none regardless of observed", () => {
    const out = call({
      observedStatus: "local-no-tracker",
      expectedRole: "in_progress",
      providerMode: "none",
    });
    expect(out.kind).toBe("vacuous-mode-none");
  });

  test("providerMode = 'none' + non-key observed + non-tty ⇒ still vacuous (short-circuits before tolerance branching)", () => {
    const out = call({
      observedStatus: "Some Local Status",
      expectedRole: "done",
      providerMode: "none",
      isTty: false,
    });
    expect(out.kind).toBe("vacuous-mode-none");
  });
});

describe("AC-STE-305.8 — capability key tokens are stable literals", () => {
  test("advisory-non-tty outcome surfaces literal 'tracker_status_advisory_non_tty' (byte-exact)", () => {
    const out = call({
      observedStatus: "In QA",
      expectedRole: "in_progress",
      isTty: false,
    });
    if (out.kind === "advisory-non-tty") {
      // Byte-exact literal; no paraphrase.
      expect(out.capabilityKey).toBe("tracker_status_advisory_non_tty");
    } else {
      throw new Error("expected advisory-non-tty outcome");
    }
  });

  test("fail-genuine-drift outcome exposes literal 'tracker_status_genuine_drift' capability key", () => {
    const out = call({ observedStatus: "Backlog", expectedRole: "in_progress" });
    if (out.kind === "fail-genuine-drift") {
      expect(out.capabilityKey).toBe("tracker_status_genuine_drift");
    } else {
      throw new Error("expected fail-genuine-drift outcome");
    }
  });
});

describe("AC-STE-305.9 — wrapper-mapped match (happy path) consults config once and returns observed verbatim", () => {
  test("mapped match passes through with the observed status preserved", () => {
    // The pass outcome must carry the observed status so the probe-runner
    // can render the row's observed/expected columns unchanged when other
    // failure modes (e.g., assignee mismatch) still gate the result.
    const out = call({ observedStatus: "In Progress", expectedRole: "in_progress" });
    expect(out.kind).toBe("pass");
    if (out.kind === "pass") {
      expect(out.observedStatus).toBe("In Progress");
      expect(out.mappedRole).toBe("in_progress");
    }
  });

  test("done-side happy path mirrors in_progress shape", () => {
    const out = call({ observedStatus: "Done", expectedRole: "done" });
    expect(out.kind).toBe("pass");
    if (out.kind === "pass") {
      expect(out.observedStatus).toBe("Done");
      expect(out.mappedRole).toBe("done");
    }
  });
});

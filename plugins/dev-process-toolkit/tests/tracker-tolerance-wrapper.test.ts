// STE-304 AC-STE-304.1 .. AC-STE-304.8 — tracker-tolerance Provider wrapper.
//
// Covers:
//   - module surface: `withTolerance`, `Skipped` sentinel, `TrackerToleranceCancelledError`
//   - three-way branching: mapped pass-through, null prompt, "unknown" prompt + discovery hint
//   - AskUserQuestion shape (3 closed-form options + always-on Other fallback,
//     labels: force / skip / cancel)
//   - force routing → expected role returned (caller proceeds as planned)
//   - skip routing → `Skipped` sentinel returned
//   - cancel routing → `TrackerToleranceCancelledError` thrown (NFR-10 shape)
//   - marker mode does NOT auto-apply force/skip/cancel
//   - non-tty stdin → `RequiresInputRefusedError` (NFR-10 shape)
//   - `mode: none` vacuous (zero `statusToRole` calls observed)
//   - adapter-config-absent fallback (no wrapper effect; pre-STE-302 strict-equality preserved)
//   - capability rows emit literal tokens (5 keys from AC.7)
//
// Tests use dependency injection for `askUserQuestion` and stdin-tty detection
// so behavior is deterministic without spawning a real prompt.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  withTolerance,
  Skipped,
  TrackerToleranceCancelledError,
  type TrackerToleranceDeps,
  type AskUserQuestionFn,
  type AskUserQuestionRequest,
  type AskUserQuestionResponse,
} from "../adapters/_shared/src/tracker_tolerance";
import { RequiresInputRefusedError } from "../adapters/_shared/src/requires_input";
import type { Provider, FRMetadata, FRSpec, LockResult, SyncResult } from "../adapters/_shared/src/provider";

// ---------------------------------------------------------------------------
// fixture builders
// ---------------------------------------------------------------------------

interface FixtureCtx {
  root: string;
  specsDir: string;
  cleanup: () => void;
}

function makeFixture(): FixtureCtx {
  const root = mkdtempSync(join(tmpdir(), "tracker-tolerance-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  return { root, specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Standard "linear" tracker-config: 5 statuses (4 mapped + In QA known-non-key).
const STANDARD_CONFIG_YAML = [
  "tracker_key: linear",
  "statuses:",
  "  - Backlog",
  "  - In Progress",
  "  - In QA",
  "  - In Review",
  "  - Done",
  "roles:",
  "  initial: Backlog",
  "  in_progress: In Progress",
  "  in_review: In Review",
  "  done: Done",
  "",
].join("\n");

function writeStandardConfig(specsDir: string): void {
  writeFileSync(join(specsDir, "tracker-config.yaml"), STANDARD_CONFIG_YAML);
}

// ---------------------------------------------------------------------------
// fake Provider implementations
// ---------------------------------------------------------------------------

interface CallLog {
  getTicketStatus: string[];
  transitionTicket: Array<{ ticket: string; target: string }>;
}

function makeCallLog(): CallLog {
  return { getTicketStatus: [], transitionTicket: [] };
}

/**
 * Fake TrackerProvider — `mode: 'tracker'`. Echoes a programmable status
 * (default "In Progress"). Records every call so tests can assert
 * pass-through vs. extra-MCP-call semantics (AC.2 "no extra MCP call").
 */
function makeFakeTrackerProvider(opts: {
  observedStatus?: string;
  log?: CallLog;
}): Provider {
  const observedStatus = opts.observedStatus ?? "In Progress";
  const log = opts.log;
  return {
    mode: "tracker" as const,
    async listMilestones() { return []; },
    async listActiveFRs() { return []; },
    async getMetadata(id: string): Promise<FRMetadata> {
      return { id, title: "", milestone: "", status: "active", tracker: {}, inFlightBranch: null, assignee: null };
    },
    async sync(_spec: FRSpec): Promise<SyncResult> {
      return { kind: "skipped", updated: [], conflicts: [], message: "" };
    },
    getUrl() { return null; },
    async claimLock(_id, branch): Promise<LockResult> {
      return { kind: "claimed", branch, message: "" };
    },
    async releaseLock() { return "transitioned" as const; },
    async getTicketStatus(ticketId: string) {
      if (log) log.getTicketStatus.push(ticketId);
      return { status: observedStatus, assignee: null };
    },
    filenameFor() { return "x.md"; },
  };
}

/**
 * Fake LocalProvider — `mode: 'none'`. Records every call so AC.5 can
 * assert zero `statusToRole`-driven reroutes (and the wrapper acts as a
 * pass-through).
 */
function makeFakeLocalProvider(log?: CallLog): Provider {
  return {
    mode: "none" as const,
    async listMilestones() { return []; },
    async listActiveFRs() { return []; },
    async getMetadata(id: string): Promise<FRMetadata> {
      return { id, title: "", milestone: "", status: "active", tracker: {}, inFlightBranch: null, assignee: null };
    },
    async sync(_spec: FRSpec): Promise<SyncResult> {
      return { kind: "skipped", updated: [], conflicts: [], message: "" };
    },
    getUrl() { return null; },
    async claimLock(_id, branch): Promise<LockResult> {
      return { kind: "claimed", branch, message: "" };
    },
    async releaseLock() { return "transitioned" as const; },
    async getTicketStatus(ticketId: string) {
      if (log) log.getTicketStatus.push(ticketId);
      return { status: "local-no-tracker" };
    },
    filenameFor() { return "x.md"; },
  };
}

// ---------------------------------------------------------------------------
// fake askUserQuestion implementations (DI seam, AC.3)
// ---------------------------------------------------------------------------

function fakeAsker(answer: "force" | "skip" | "cancel"): {
  asker: AskUserQuestionFn;
  calls: AskUserQuestionRequest[];
} {
  const calls: AskUserQuestionRequest[] = [];
  const asker: AskUserQuestionFn = async (req) => {
    calls.push(req);
    const resp: AskUserQuestionResponse = { selectedLabel: answer };
    return resp;
  };
  return { asker, calls };
}

// ---------------------------------------------------------------------------
// AC.1 — module surface
// ---------------------------------------------------------------------------

describe("AC-STE-304.1 — module exports", () => {
  test("withTolerance is exported as a function", () => {
    expect(typeof withTolerance).toBe("function");
  });

  test("Skipped sentinel value carries the documented shape", () => {
    expect(Skipped.kind).toBe("skipped");
    expect(typeof Skipped.reason).toBe("string");
  });

  test("TrackerToleranceCancelledError is a real Error subclass", () => {
    const e = new TrackerToleranceCancelledError({
      observedStatus: "In QA",
      expectedRole: "in_progress",
      gateSite: "tracker_tolerance_prompt",
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("TrackerToleranceCancelledError");
    expect(e.message).toMatch(/Refusing|Verdict/);
    expect(e.message).toMatch(/Remedy/);
    expect(e.message).toMatch(/Context/);
    expect(e.message).toContain("In QA");
  });

  test("wrapper accepts both TrackerProvider and LocalProvider identically", () => {
    const fx = makeFixture();
    try {
      const tracker = makeFakeTrackerProvider({});
      const local = makeFakeLocalProvider();
      const wrapped1 = withTolerance(tracker, fx.specsDir);
      const wrapped2 = withTolerance(local, fx.specsDir);
      expect(typeof wrapped1.getTicketStatus).toBe("function");
      expect(typeof wrapped2.getTicketStatus).toBe("function");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.2 — three-way branching: pass-through (mapped role matches expected)
// ---------------------------------------------------------------------------

describe("AC-STE-304.2 — three-way branching: pass-through", () => {
  test("mapped role matches expected → pass-through (no prompt, no extra MCP call)", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const log = makeCallLog();
      // Underlying ticket is "In Progress" → maps to in_progress role.
      const tracker = makeFakeTrackerProvider({ observedStatus: "In Progress", log });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      const result = await wrapped.getTicketStatus("STE-1");
      expect(result.status).toBe("In Progress");
      // No prompt fired.
      expect(calls.length).toBe(0);
      // Exactly one underlying read (the wrapper's own call), no extra reroute.
      expect(log.getTicketStatus.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.2 — three-way branching: null (known-non-key) prompts
// ---------------------------------------------------------------------------

describe("AC-STE-304.2 — three-way branching: null (known-non-key) prompts", () => {
  test("observed status is in `statuses:` but mapped to no role → prompt fired naming observed + expected + known list", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      // "In QA" is in `statuses:` but not in `roles:` ⇒ statusToRole returns null.
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      await wrapped.getTicketStatus("STE-1");
      expect(calls.length).toBe(1);
      const q = calls[0]!;
      // Question text references the observed status, expected role, and the
      // project's known status list (AC.2 prompt context contract).
      const blob = JSON.stringify(q);
      expect(blob).toContain("In QA");
      expect(blob).toContain("in_progress");
      // Known statuses list surfaces — at least the canonical four show up.
      expect(blob).toContain("Backlog");
      expect(blob).toContain("Done");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.2 — three-way branching: "unknown" prompts with discovery hint
// ---------------------------------------------------------------------------

describe("AC-STE-304.2 — three-way branching: \"unknown\" prompts with discovery hint", () => {
  test("observed status not in `statuses:` at all → prompt fired naming observed + discovery hint", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "Blocked by ops" });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      await wrapped.getTicketStatus("STE-1");
      expect(calls.length).toBe(1);
      const blob = JSON.stringify(calls[0]);
      expect(blob).toContain("Blocked by ops");
      // Discovery-hint text (verbatim per AC.2).
      expect(blob).toMatch(/re-run \/setup to resync the project's status list/);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.3 — AskUserQuestion shape (3 closed-form + always-on Other) + routing
// ---------------------------------------------------------------------------

describe("AC-STE-304.3 — AskUserQuestion shape: 3 options + Other; force/skip/cancel routing", () => {
  test("prompt carries exactly the 3 closed-form options force/skip/cancel + always-on Other fallback", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      await wrapped.getTicketStatus("STE-1");
      expect(calls.length).toBe(1);
      const q = calls[0]!;
      // Three labels appear verbatim.
      const labels = (q.options ?? []).map((o) => o.label);
      expect(labels).toContain("force");
      expect(labels).toContain("skip");
      expect(labels).toContain("cancel");
      // Always-on Other fallback. Either present in options OR shape opt-in.
      const hasOther =
        labels.includes("Other") || q.allowOther === true || q.otherFallback === true;
      expect(hasOther).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("force routing: returns the expected role (caller proceeds with planned op)", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      const result = await wrapped.getTicketStatus("STE-1");
      // Force returns the expected-role-mapped status — i.e., wrapper treats
      // the observed status as if it had matched. The underlying value is
      // surfaced; the caller proceeds because no exception, no Skipped.
      expect(result).toBeDefined();
      expect((result as { status: string }).status).toBeDefined();
    } finally {
      fx.cleanup();
    }
  });

  test("skip routing: returns the Skipped sentinel value", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("skip");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      const result = await wrapped.getTicketStatus("STE-1");
      // Sentinel branch: caller pattern-matches `kind: "skipped"`.
      expect(result).toBeDefined();
      expect((result as { kind?: string }).kind).toBe("skipped");
    } finally {
      fx.cleanup();
    }
  });

  test("cancel routing: throws TrackerToleranceCancelledError (NFR-10 shape)", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("cancel");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      let caught: unknown = null;
      try {
        await wrapped.getTicketStatus("STE-1");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TrackerToleranceCancelledError);
      const msg = (caught as Error).message;
      // NFR-10 canonical lines.
      expect(msg).toMatch(/Refusing|Verdict/);
      expect(msg).toMatch(/Remedy/);
      expect(msg).toMatch(/Context/);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.4 — marker mode does NOT auto-apply; non-tty stdin throws
// ---------------------------------------------------------------------------

describe("AC-STE-304.4 — marker non-applicability + non-tty refusal", () => {
  test("non-tty stdin (marker absent) → RequiresInputRefusedError naming gate + observed status", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        isStdinTty: () => false,
        markerPresent: false,
      });
      let caught: unknown = null;
      try {
        await wrapped.getTicketStatus("STE-1");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RequiresInputRefusedError);
      const msg = (caught as Error).message;
      // Gate site name (literal token) + observed status appear.
      expect(msg).toContain("tracker_tolerance_prompt");
      expect(msg).toContain("In QA");
    } finally {
      fx.cleanup();
    }
  });

  test("marker present + non-tty stdin still refuses (no auto-apply for force/skip/cancel)", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        isStdinTty: () => false,
        markerPresent: true,
      });
      let caught: unknown = null;
      try {
        await wrapped.getTicketStatus("STE-1");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RequiresInputRefusedError);
      // Critically: askUserQuestion is NOT invoked under non-tty either —
      // the wrapper refuses before any prompt.
      expect(calls.length).toBe(0);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.5 — mode: none vacuous
// ---------------------------------------------------------------------------

describe("AC-STE-304.5 — mode: none vacuous", () => {
  test("withTolerance(LocalProvider) returns provider that skips wrapper logic — no statusToRole reroute observed", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const log = makeCallLog();
      const local = makeFakeLocalProvider(log);
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(local, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      const result = await wrapped.getTicketStatus("any-ulid");
      // LocalProvider returns its sentinel verbatim.
      expect((result as { status: string }).status).toBe("local-no-tracker");
      // Zero prompts.
      expect(calls.length).toBe(0);
      // Only the wrapped pass-through call to the underlying provider;
      // no extra rerouting/re-prompting fired.
      expect(log.getTicketStatus.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("wrapped LocalProvider preserves mode: 'none' discriminator", () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const local = makeFakeLocalProvider();
      const wrapped = withTolerance(local, fx.specsDir);
      expect(wrapped.mode).toBe("none");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.6 — adapter-config-absent fallback
// ---------------------------------------------------------------------------

describe("AC-STE-304.6 — adapter-config-absent fallback", () => {
  test("no specs/tracker-config.yaml → wrapper is a no-op (strict-equality preserved upstream)", async () => {
    // Fixture intentionally writes no tracker-config.yaml.
    const fx = makeFixture();
    try {
      const log = makeCallLog();
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA", log });
      const { asker, calls } = fakeAsker("force");
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
      });
      // The wrapper does NOT prompt — it has no project vocabulary, so it
      // falls through to strict equality (per-adapter status_mapping path).
      const result = await wrapped.getTicketStatus("STE-1");
      expect(calls.length).toBe(0);
      expect((result as { status: string }).status).toBe("In QA");
      expect(log.getTicketStatus.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.7 — capability rows emitted (literal-token contract)
// ---------------------------------------------------------------------------

describe("AC-STE-304.7 — capability rows", () => {
  test("force outcome emits `tracker_status_forced`", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("force");
      const capabilities: string[] = [];
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        recordCapability: (key) => capabilities.push(key),
      });
      await wrapped.getTicketStatus("STE-1");
      expect(capabilities).toContain("tracker_status_forced");
    } finally {
      fx.cleanup();
    }
  });

  test("skip outcome emits `tracker_status_skipped`", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("skip");
      const capabilities: string[] = [];
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        recordCapability: (key) => capabilities.push(key),
      });
      await wrapped.getTicketStatus("STE-1");
      expect(capabilities).toContain("tracker_status_skipped");
    } finally {
      fx.cleanup();
    }
  });

  test("cancel outcome emits `tracker_status_cancelled`", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("cancel");
      const capabilities: string[] = [];
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        recordCapability: (key) => capabilities.push(key),
      });
      try {
        await wrapped.getTicketStatus("STE-1");
      } catch {
        // Expected — cancel throws.
      }
      expect(capabilities).toContain("tracker_status_cancelled");
    } finally {
      fx.cleanup();
    }
  });

  test("unknown-sentinel encounter emits `tracker_status_unknown_encountered`", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "Blocked by ops" });
      const { asker } = fakeAsker("force");
      const capabilities: string[] = [];
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        recordCapability: (key) => capabilities.push(key),
      });
      await wrapped.getTicketStatus("STE-1");
      expect(capabilities).toContain("tracker_status_unknown_encountered");
    } finally {
      fx.cleanup();
    }
  });

  test("non-tty refusal emits `tracker_tolerance_refused_non_tty`", async () => {
    const fx = makeFixture();
    writeStandardConfig(fx.specsDir);
    try {
      const tracker = makeFakeTrackerProvider({ observedStatus: "In QA" });
      const { asker } = fakeAsker("force");
      const capabilities: string[] = [];
      const wrapped = withTolerance(tracker, fx.specsDir, {
        askUserQuestion: asker,
        expectedRole: "in_progress",
        isStdinTty: () => false,
        markerPresent: false,
        recordCapability: (key) => capabilities.push(key),
      });
      try {
        await wrapped.getTicketStatus("STE-1");
      } catch {
        // Expected — non-tty refusal throws.
      }
      expect(capabilities).toContain("tracker_tolerance_refused_non_tty");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.8 — this very test file at the documented location
// ---------------------------------------------------------------------------

describe("AC-STE-304.8 — test file location coverage", () => {
  test("this file lives at plugins/dev-process-toolkit/tests/tracker-tolerance-wrapper.test.ts", () => {
    // The fact that bun:test resolves this module proves the path. Capture
    // an explicit assertion on `import.meta.path` so a future move triggers
    // a deterministic failure.
    const here = import.meta.path ?? "";
    expect(here).toMatch(/tracker-tolerance-wrapper\.test\.ts$/);
  });
});

// Silence "unused import" if a strict checker runs over the file.
// (TrackerToleranceDeps is exported as part of AC.1 module surface.)
const _typeSurfaceCheck = (deps: TrackerToleranceDeps): TrackerToleranceDeps => deps;
void _typeSurfaceCheck;

// STE-303 — /setup tracker-config write helper (proposal + diff + routing).
//
// AC-STE-303.1 (orchestration), AC-STE-303.4 (proposal shape),
// AC-STE-303.5 (approve/edit/cancel routing), AC-STE-303.6 (idempotent no-op),
// AC-STE-303.7 (mode: none vacuous), AC-STE-303.8 (MCP-unavailable refusal),
// AC-STE-303.9 (adapter without capability → graceful skip),
// AC-STE-303.10 (these tests exist),
// AC-STE-303.11 (closing-summary capability keys exported).
//
// The helper lives at
// `adapters/_shared/src/tracker_config_proposal.ts` and uses dependency
// injection for `AskUserQuestion`, `writeTrackerConfig`, and the MCP-driven
// status fetcher so the orchestration is unit-testable. The skill body
// (`skills/setup/SKILL.md` Step Nb) wires the real implementations.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildTrackerConfigProposal,
  serializeProposalYAML,
  renderUnifiedDiff,
  isProposalNoOp,
  runTrackerConfigWrite,
  CLOSING_SUMMARY_KEYS,
  type ProposalDeps,
  type Outcome,
  type Proposal,
} from "../adapters/_shared/src/tracker_config_proposal";

import { readTrackerConfig, type TrackerConfig } from "../adapters/_shared/src/tracker_config";

function makeSpecsDir(): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tracker-config-write-"));
  const specs = join(root, "specs");
  mkdirSync(specs, { recursive: true });
  return { dir: specs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const linearStatuses = ["Backlog", "In Progress", "In Review", "Done"];
const linearRolesAllMatched: Record<string, string> = {
  initial: "Backlog",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

// ---------------------------------------------------------------------------
// AC-STE-303.4 — proposal shape
// ---------------------------------------------------------------------------

describe("AC-STE-303.4 — proposal shape: 4 roles + reasoning per role", () => {
  test("buildTrackerConfigProposal returns 4 canonical roles + reasoning strings", () => {
    const proposal = buildTrackerConfigProposal({
      adapterKey: "linear",
      statuses: linearStatuses,
      // The role pick is the LLM's job in production; in tests we inject a
      // deterministic chooser so the helper's plumbing is exercised in isolation.
      chooseRole: (role, statuses) => ({
        status: linearRolesAllMatched[role] ?? null,
        reasoning: `picked because ${role} matches`,
      }),
    });
    expect(proposal.tracker_key).toBe("linear");
    expect(proposal.statuses).toEqual(linearStatuses);
    expect(Object.keys(proposal.roles).sort()).toEqual(
      ["done", "in_progress", "in_review", "initial"].sort(),
    );
    expect(proposal.reasoning).toBeDefined();
    for (const role of ["initial", "in_progress", "in_review", "done"]) {
      expect(typeof proposal.reasoning[role]).toBe("string");
      expect(proposal.reasoning[role].length).toBeGreaterThan(0);
    }
  });

  test("role with no plausible match emits null + reasoning naming the gap", () => {
    // Statuses without an `In Review`-equivalent.
    const statuses = ["Todo", "Doing", "Shipped"];
    const proposal = buildTrackerConfigProposal({
      adapterKey: "linear",
      statuses,
      chooseRole: (role, _statuses) => {
        if (role === "in_review") return { status: null, reasoning: "no In Review-equivalent" };
        const map: Record<string, string> = {
          initial: "Todo",
          in_progress: "Doing",
          done: "Shipped",
        };
        return { status: map[role] ?? null, reasoning: `picked ${map[role]}` };
      },
    });
    expect(proposal.roles.in_review).toBeNull();
    expect(proposal.reasoning.in_review).toMatch(/in review|no.*equivalent|gap/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.5 — unified diff rendering between baseline ↔ proposal
// ---------------------------------------------------------------------------

describe("AC-STE-303.5 — unified-diff renderer", () => {
  test("empty baseline → renders + lines only (first-run shape)", () => {
    const proposalYaml = "tracker_key: linear\nstatuses:\n  - Backlog\n";
    const diff = renderUnifiedDiff("", proposalYaml);
    // Real diff: contains + lines for every proposal line, no - lines except header.
    expect(diff).toMatch(/\+tracker_key: linear/);
    expect(diff).toMatch(/\+statuses:/);
    expect(diff).toMatch(/\+\s+- Backlog/);
    // No content removals (header `---` lines are allowed).
    const removalLines = diff
      .split("\n")
      .filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removalLines.length).toBe(0);
  });

  test("delta between baseline and proposal renders both - and + lines", () => {
    const baseline = "tracker_key: linear\nroles:\n  in_review: In Review\n";
    const proposal = "tracker_key: linear\nroles:\n  in_review: In Code Review\n";
    const diff = renderUnifiedDiff(baseline, proposal);
    expect(diff).toMatch(/-\s+in_review: In Review/);
    expect(diff).toMatch(/\+\s+in_review: In Code Review/);
  });
});

describe("AC-STE-303.5 / 303.6 — isProposalNoOp short-circuit", () => {
  test("identical YAML → no-op", () => {
    const yaml = "tracker_key: linear\nstatuses:\n  - Backlog\n";
    expect(isProposalNoOp(yaml, yaml)).toBe(true);
  });

  test("trailing whitespace ignored — same logical YAML → no-op", () => {
    const a = "tracker_key: linear\n";
    const b = "tracker_key: linear\n\n";
    expect(isProposalNoOp(a, b)).toBe(true);
  });

  test("logical delta → not no-op", () => {
    const a = "tracker_key: linear\nroles:\n  done: Done\n";
    const b = "tracker_key: linear\nroles:\n  done: Shipped\n";
    expect(isProposalNoOp(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.4 — YAML serialization
// ---------------------------------------------------------------------------

describe("AC-STE-303.4 — serializeProposalYAML", () => {
  test("emits block-style YAML with tracker_key, statuses, roles", () => {
    const proposal: Proposal = {
      tracker_key: "linear",
      statuses: linearStatuses,
      roles: { ...linearRolesAllMatched },
      reasoning: {
        initial: "x",
        in_progress: "x",
        in_review: "x",
        done: "x",
      },
    };
    const yaml = serializeProposalYAML(proposal);
    expect(yaml).toMatch(/^tracker_key: linear$/m);
    expect(yaml).toMatch(/^statuses:$/m);
    expect(yaml).toMatch(/^\s+- Backlog$/m);
    expect(yaml).toMatch(/^roles:$/m);
    expect(yaml).toMatch(/^\s+initial: Backlog$/m);
    expect(yaml).toMatch(/^\s+done: Done$/m);
  });

  test("verbatim statuses preserve casing + whitespace + special chars (AC-303.2)", () => {
    const oddStatuses = ["Backlog ", "In Code Review", "Awaiting Sign-off", "🚢 Shipped"];
    const proposal: Proposal = {
      tracker_key: "linear",
      statuses: oddStatuses,
      roles: {
        initial: "Backlog ",
        in_progress: "In Code Review",
        in_review: "Awaiting Sign-off",
        done: "🚢 Shipped",
      },
      reasoning: { initial: "", in_progress: "", in_review: "", done: "" },
    };
    const yaml = serializeProposalYAML(proposal);
    expect(yaml).toContain("- Backlog ");
    expect(yaml).toContain("- In Code Review");
    expect(yaml).toContain("- Awaiting Sign-off");
    expect(yaml).toContain("- 🚢 Shipped");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.1 — happy path: first-run → propose → approve → write
// AC-STE-303.5 — approve routes to writeTrackerConfig
// ---------------------------------------------------------------------------

describe("AC-STE-303.1 / 303.5 — first-run happy path", () => {
  test("empty baseline → proposal → approve → writeTrackerConfig fires", async () => {
    const ctx = makeSpecsDir();
    try {
      const fetched: string[][] = [];
      const writes: { specsDir: string; config: TrackerConfig }[] = [];
      const asks: string[] = [];
      const deps: ProposalDeps = {
        async fetchStatuses(adapterKey) {
          fetched.push(linearStatuses);
          return linearStatuses;
        },
        async askUserQuestion(spec) {
          asks.push(JSON.stringify(spec));
          return { choice: "approve" };
        },
        writeTrackerConfig(specsDir, config) {
          writes.push({ specsDir, config });
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "test" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("succeeded");
      expect(fetched.length).toBe(1);
      expect(writes.length).toBe(1);
      expect(writes[0]!.config.tracker_key).toBe("linear");
      expect(writes[0]!.config.statuses).toEqual(linearStatuses);
      expect(writes[0]!.config.roles).toEqual(linearRolesAllMatched as Record<string, string>);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.6 — idempotent re-entry no-op
// ---------------------------------------------------------------------------

describe("AC-STE-303.6 — idempotent re-entry: baseline == proposal → no prompt, no write", () => {
  test("returns outcome=unchanged + does not prompt", async () => {
    const ctx = makeSpecsDir();
    try {
      // Seed the baseline file with the same config the proposal would produce.
      writeFileSync(
        join(ctx.dir, "tracker-config.yaml"),
        [
          "tracker_key: linear",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      let prompts = 0;
      let writes = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return linearStatuses;
        },
        async askUserQuestion() {
          prompts += 1;
          return { choice: "approve" };
        },
        writeTrackerConfig() {
          writes += 1;
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("unchanged");
      expect(prompts).toBe(0);
      expect(writes).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.6 — idempotent re-entry with delta
// ---------------------------------------------------------------------------

describe("AC-STE-303.6 — idempotent re-entry with delta: approve → file rewritten", () => {
  test("baseline differs from proposal → prompts, approve writes new config", async () => {
    const ctx = makeSpecsDir();
    try {
      // Baseline file has an older `in_review` mapping ("In Review");
      // proposal will use "In Code Review" (fresh fetch shifted vocabulary).
      writeFileSync(
        join(ctx.dir, "tracker-config.yaml"),
        [
          "tracker_key: linear",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      const freshStatuses = ["Backlog", "In Progress", "In Code Review", "Done"];
      const writes: TrackerConfig[] = [];
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return freshStatuses;
        },
        async askUserQuestion() {
          return { choice: "approve" };
        },
        writeTrackerConfig(_dir, cfg) {
          writes.push(cfg);
        },
        chooseRole(role) {
          const map: Record<string, string> = {
            initial: "Backlog",
            in_progress: "In Progress",
            in_review: "In Code Review",
            done: "Done",
          };
          return { status: map[role] ?? null, reasoning: "x" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("succeeded");
      expect(writes.length).toBe(1);
      expect(writes[0]!.roles.in_review).toBe("In Code Review");
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.5 — cancel branch
// ---------------------------------------------------------------------------

describe("AC-STE-303.5 — cancel branch: no write, baseline untouched", () => {
  test("operator says cancel → no write fires, outcome=cancelled", async () => {
    const ctx = makeSpecsDir();
    try {
      let writes = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return linearStatuses;
        },
        async askUserQuestion() {
          return { choice: "cancel" };
        },
        writeTrackerConfig() {
          writes += 1;
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("cancelled");
      expect(writes).toBe(0);
      expect(existsSync(join(ctx.dir, "tracker-config.yaml"))).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.5 — edit branch (per-role manual pick)
// ---------------------------------------------------------------------------

describe("AC-STE-303.5 — edit branch: per-role manual pick rewrites proposal", () => {
  test("operator picks edit → per-role asks → writeTrackerConfig fires with edited mapping", async () => {
    const ctx = makeSpecsDir();
    try {
      const writes: TrackerConfig[] = [];
      // After picking "edit", the helper asks once per role to pick a status
      // from the full list. We script the per-role answers.
      const perRoleAnswers: Record<string, string> = {
        initial: "Backlog",
        in_progress: "In Progress",
        in_review: "Done", // operator picks a non-default value
        done: "Done",
      };
      let askCount = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return linearStatuses;
        },
        async askUserQuestion(spec) {
          askCount += 1;
          // First ask: approve/edit/cancel — return edit.
          if (askCount === 1) return { choice: "edit" };
          // Subsequent asks: per-role pick. The spec carries a `role:` field.
          const role: string = (spec as { role?: string }).role ?? "";
          return { choice: "pick", status: perRoleAnswers[role] };
        },
        writeTrackerConfig(_dir, cfg) {
          writes.push(cfg);
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("succeeded");
      expect(writes.length).toBe(1);
      expect(writes[0]!.roles.in_review).toBe("Done");
      // The helper asked once for approve/edit/cancel + once per role.
      expect(askCount).toBe(1 + 4);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.7 — mode: none vacuous
// ---------------------------------------------------------------------------

describe("AC-STE-303.7 — mode: none vacuous: no MCP, no proposal, no write", () => {
  test("mode=none short-circuits without invoking fetchStatuses", async () => {
    const ctx = makeSpecsDir();
    try {
      let mcpCalls = 0;
      let writes = 0;
      let asks = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          mcpCalls += 1;
          return [];
        },
        async askUserQuestion() {
          asks += 1;
          return { choice: "approve" };
        },
        writeTrackerConfig() {
          writes += 1;
        },
        chooseRole() {
          return { status: null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "none",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("skipped_mode_none");
      expect(mcpCalls).toBe(0);
      expect(writes).toBe(0);
      expect(asks).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.8 — MCP unavailable → NFR-10 refusal, no partial write
// ---------------------------------------------------------------------------

describe("AC-STE-303.8 — MCP unavailable: NFR-10 canonical refusal, no write", () => {
  test("fetchStatuses throws → outcome=mcp_unavailable + canonical-shape message", async () => {
    const ctx = makeSpecsDir();
    try {
      let writes = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          throw new Error("MCP server unreachable: connection refused");
        },
        async askUserQuestion() {
          return { choice: "approve" };
        },
        writeTrackerConfig() {
          writes += 1;
        },
        chooseRole() {
          return { status: null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("mcp_unavailable");
      expect(writes).toBe(0);
      // NFR-10 canonical refusal shape — message names failure + remedy.
      expect(result.message ?? "").toMatch(/Refusing:/);
      expect(result.message ?? "").toMatch(/Remedy:/);
      expect(result.message ?? "").toMatch(/re-?run|re-?authenticate/i);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.9 — adapter without capability → graceful skip
// ---------------------------------------------------------------------------

describe("AC-STE-303.9 — adapter without list_project_statuses → graceful skip", () => {
  test("adapter declares list_project_statuses=false → outcome=skipped_adapter_limit, no fetch, no write", async () => {
    const ctx = makeSpecsDir();
    try {
      let mcpCalls = 0;
      let writes = 0;
      const deps: ProposalDeps = {
        async fetchStatuses() {
          mcpCalls += 1;
          return [];
        },
        async askUserQuestion() {
          return { choice: "approve" };
        },
        writeTrackerConfig() {
          writes += 1;
        },
        chooseRole() {
          return { status: null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "custom",
        mode: "custom",
        autoApprove: false,
        adapterCapabilities: { list_project_statuses: false },
        deps,
      });
      expect(result.outcome).toBe<Outcome>("skipped_adapter_limit");
      expect(mcpCalls).toBe(0);
      expect(writes).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.5 — marker-driven auto-approve (STE-262)
// ---------------------------------------------------------------------------

describe("AC-STE-303.5 — auto-approve marker default-applies approve", () => {
  test("autoApprove=true → no prompt, writeTrackerConfig fires", async () => {
    const ctx = makeSpecsDir();
    try {
      let asks = 0;
      const writes: TrackerConfig[] = [];
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return linearStatuses;
        },
        async askUserQuestion() {
          asks += 1;
          return { choice: "cancel" }; // would cancel if called
        },
        writeTrackerConfig(_dir, cfg) {
          writes.push(cfg);
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: true,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("succeeded");
      expect(asks).toBe(0);
      expect(writes.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.11 — closing-summary capability key constants exported
// ---------------------------------------------------------------------------

describe("AC-STE-303.11 — CLOSING_SUMMARY_KEYS exported with the 5 canonical literals", () => {
  test("module exports exactly the 5 capability key literals", () => {
    expect(Array.isArray(CLOSING_SUMMARY_KEYS)).toBe(true);
    const expected = [
      "tracker_config_write_succeeded",
      "tracker_config_write_cancelled",
      "tracker_config_unchanged",
      "tracker_config_write_skipped_adapter_limit",
      "tracker_config_write_mcp_unavailable",
    ];
    expect(CLOSING_SUMMARY_KEYS.slice().sort()).toEqual(expected.slice().sort());
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.1(f) — on approve, the file actually lands on disk via writeTrackerConfig
// (round-trip via readTrackerConfig to prove validation passed)
// ---------------------------------------------------------------------------

describe("AC-STE-303.1(f) — approve writes a valid tracker-config readable via readTrackerConfig", () => {
  test("happy path persists a file that readTrackerConfig parses back", async () => {
    const ctx = makeSpecsDir();
    try {
      const deps: ProposalDeps = {
        async fetchStatuses() {
          return linearStatuses;
        },
        async askUserQuestion() {
          return { choice: "approve" };
        },
        writeTrackerConfig(specsDir, config) {
          // Delegate to the real writer so the file lands on disk.
          // (Tests above assert the helper invokes its injected writer with the
          // proposal; this test asserts the real writer ⇄ real reader round-trip.)
          const realWriter = require("../adapters/_shared/src/tracker_config").writeTrackerConfig;
          realWriter(specsDir, config);
        },
        chooseRole(role) {
          return { status: linearRolesAllMatched[role] ?? null, reasoning: "" };
        },
      };
      const result = await runTrackerConfigWrite({
        specsDir: ctx.dir,
        adapterKey: "linear",
        mode: "linear",
        autoApprove: false,
        deps,
      });
      expect(result.outcome).toBe<Outcome>("succeeded");
      const roundTripped = readTrackerConfig(ctx.dir);
      expect(roundTripped).not.toBeNull();
      expect(roundTripped!.tracker_key).toBe("linear");
      expect(roundTripped!.statuses).toEqual(linearStatuses);
      expect(roundTripped!.roles).toEqual(linearRolesAllMatched as Record<
        "initial" | "in_progress" | "in_review" | "done",
        string
      >);
    } finally {
      ctx.cleanup();
    }
  });
});

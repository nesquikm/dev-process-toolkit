// M126 / STE-478 — /spec-write's trunk-invocation control path must reach its
// commit and close with its OWN summary.
//
// THE MEASURED DEFECT, not a hypothesis. The 2026-08-16 jira conformance leg
// invoked `/spec-write` from `master` with the auto-approve marker present.
// The § 7a branch gate took the `created` outcome, `git checkout -b` ran, Jira
// Epic DST-74 and Task DST-75 were created — and then the run never came back
// to the § 7a commit. It ended with `A specs/frs/DST-75.md` still staged,
// `git log master..HEAD` = 0, and a **Gate Check Report** as the closing
// output. The real capture is retained verbatim at
// `tests/fixtures/branch-gate-trunk/spec-write-jira-branch-on-main-2026-08-16.log`
// (assistant-text projection preserved byte-for-byte from the 793 KB original;
// only the two 86 KB / 110 KB synthetic SKILL.md injections were windowed, and
// each window still carries both scored tokens so the raw-vs-assistant
// asymmetry the fixture exists to demonstrate survives the trim).
//
// WHY THE PROSE ALONE COULD NOT CATCH IT. § 7a says outcome `created` ⇒
// `git checkout -b`, and separately says the commit gate commits. Nothing in
// the shipped bytes says the first is a PRELUDE to the second rather than an
// alternative to it, and nothing says the closing output has to be
// `/spec-write`'s. A control path with two independently-true sentences and no
// stated ordering is exactly what an LLM can satisfy by doing half of it.
//
// SO THE ORDERING IS MOVED OUT OF PROSE AND INTO A MODULE.
// `adapters/_shared/src/spec_write_trunk_invocation_path.ts` enumerates the
// ordered steps and the three terminal states (one committed, two sanctioned
// staged-but-uncommitted exits), and classifies an observed run against them.
// The skill then QUOTES the module, so the two sides cannot drift apart
// silently — the producer/consumer asymmetry this repo has now hit five times.
// Every git fact in the AC.1 / AC.5 legs is MEASURED off a real repo through
// `observeTrunkGitState`, never asserted about text.
//
// AC.3's scoping is the whole reason this file does not grep. Both tokens
// appear in the raw NDJSON of the defective capture — they are enumerated in
// the injected SKILL.md body of EVERY `/spec-write` capture, unconditionally.
// `rawHits` is 1 and `assistantHits` is 0 on a run that emitted nothing. A
// raw grep scores the defect as a PASS.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  CANONICAL_CAPABILITY_KEYS,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import { scoreCapabilityKey } from "../adapters/_shared/src/capability_row_assert";
import { extractAssistantText } from "../adapters/_shared/src/smoke_child_capture";
import {
  buildHookedFixture,
  cleanup,
  git,
  PLUGIN_ROOT,
  REPO_ROOT,
  type HookedFixture,
} from "./_hooked-lock-fixture";

import type * as TrunkPath from "../adapters/_shared/src/spec_write_trunk_invocation_path";
import type { TrunkRunObservation } from "../adapters/_shared/src/spec_write_trunk_invocation_path";

// The module is loaded LAZILY, per test. A top-level import of a module that
// does not exist yet aborts the whole file with one opaque
// "Cannot find module" error, which tells the implementer nothing about which
// AC is unmet. Resolving it inside each test keeps all 20 failures granular
// and keeps every prose pin readable while the module is still absent.
function mod(): typeof TrunkPath {
  return require("../adapters/_shared/src/spec_write_trunk_invocation_path");
}

const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills/spec-write/SKILL.md");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "adapters/_shared/src/spec_write_trunk_invocation_path.ts",
);
const DEFECT_CAPTURE = join(
  PLUGIN_ROOT,
  "tests/fixtures/branch-gate-trunk/spec-write-jira-branch-on-main-2026-08-16.log",
);

// AC-STE-459.2's live-then-archive conditional — the house shape. Seven
// assertions in a sibling suite went red on archival before it existed.
const FR_478 = existsSync(join(REPO_ROOT, "specs/frs/STE-478.md"))
  ? join(REPO_ROOT, "specs/frs/STE-478.md")
  : join(REPO_ROOT, "specs/frs/archive/STE-478.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function skill(): string {
  return read(SPEC_WRITE_SKILL);
}

/**
 * The § 7 reference-shape fence — the shipped bytes that DEFINE what
 * "/spec-write's own summary" looks like. Every signal the module matches on
 * is required to be present here, so the module and the skill cannot drift.
 */
function referenceShapeFence(): string {
  const body = skill();
  const at = body.indexOf("Reference shape — emit at minimum");
  expect(at).toBeGreaterThan(-1);
  const open = body.indexOf("```", at);
  expect(open).toBeGreaterThan(at);
  const close = body.indexOf("```", open + 3);
  expect(close).toBeGreaterThan(open);
  const fence = body.slice(open + 3, close);
  // Non-vacuity: the fence must still carry the heading it is quoted for.
  expect(fence).toContain("## /spec-write summary");
  return fence;
}

/** The raw NDJSON of the measured defect capture. */
function defectCapture(): string {
  return read(DEFECT_CAPTURE);
}

/**
 * A HEALTHY closing summary, DERIVED from the shipped § 7 reference shape
 * rather than hand-written, plus the two literal tokens the trunk path owes.
 * Deriving it is the point: if § 7's shape changes, the green leg follows it.
 */
function healthySummary(): string {
  return [
    referenceShapeFence().trim(),
    "",
    "- `branch_gate_default_applied` — gate auto-created branch feat/m126-x",
    "- `spec_write_commit_default_applied` — commit auto-approved",
  ].join("\n");
}

/** The defective run's real closing output — a Gate Check Report. */
function defectiveClosingText(): string {
  return extractAssistantText(defectCapture());
}

/**
 * Stage a spec file in a real repo. Returns the repo-relative path staged.
 * The AC.1 / AC.5 git facts are measured off this, never asserted about.
 */
function stageSpecFile(f: HookedFixture, rel: string, body: string): string {
  const abs = join(f.root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  git(f.root, "add", "--", rel);
  return rel;
}

/** The trunk-path observation shape, with the marker-present defaults filled in. */
function observation(
  over: Partial<TrunkRunObservation> & Pick<TrunkRunObservation, "git">,
): TrunkRunObservation {
  return {
    markerPresent: true,
    isTty: false,
    declinedAtCommitGate: false,
    startedOnTrunk: true,
    assistantText: healthySummary(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// AC-STE-478.1 — the trunk path reaches its commit.
// ---------------------------------------------------------------------------

describe("AC-STE-478.1 — marker-present trunk invocation commits the specs it wrote", () => {
  test("the control path orders branch creation BEFORE the commit, and the commit is not terminal", () => {
    const ids = mod().TRUNK_INVOCATION_STEPS.map((s) => s.id);
    expect(ids).toContain("branch_gate");
    expect(ids).toContain("commit_gate");
    expect(ids).toContain("closing_summary");

    // Dense, strictly increasing order — an enumeration with a gap or a tie
    // cannot express "prelude, never substitute".
    const orders = mod().TRUNK_INVOCATION_STEPS.map((s) => s.order);
    expect(orders).toEqual(orders.map((_, i) => i + 1));

    const branchAt = ids.indexOf("branch_gate");
    const commitAt = ids.indexOf("commit_gate");
    const summaryAt = ids.indexOf("closing_summary");
    expect(branchAt).toBeLessThan(commitAt);
    expect(commitAt).toBeLessThan(summaryAt);

    // The defect in one assertion: branch creation must NOT be a terminal step.
    expect(mod().TRUNK_INVOCATION_STEPS[branchAt]!.terminal).toBe(false);
    expect(mod().TRUNK_INVOCATION_STEPS[commitAt]!.terminal).toBe(false);
    expect(mod().TRUNK_INVOCATION_STEPS[summaryAt]!.terminal).toBe(true);
    expect(mod().TRUNK_INVOCATION_STEPS.filter((s) => s.terminal)).toHaveLength(1);
  });

  test("a real repo that branched, wrote, staged AND committed classifies ok", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-ok" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-trunk");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      stageSpecFile(f, "specs/plan/M126.md", "# Plan\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");

      const state = mod().observeTrunkGitState(f.root, "master");
      // AC.1's two literal measurements.
      expect(state.commitsAhead).toBeGreaterThanOrEqual(1);
      expect(state.stagedSpecPaths).toEqual([]);
      expect(state.currentBranch).toBe("feat/m126-trunk");

      const verdict = mod().classifyTrunkInvocationRun(observation({ git: state }));
      expect(verdict.violations).toEqual([]);
      expect(verdict.terminalState).toBe("committed");
      expect(verdict.ok).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  test("the measured defect — branched and staged, never committed — classifies as a violation", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-defect" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m_dst_74-branch-gate");
      const staged = stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");

      const state = mod().observeTrunkGitState(f.root, "master");
      // The exact shape of the jira leg: `A specs/frs/DST-75.md`, zero ahead.
      expect(state.commitsAhead).toBe(0);
      expect(state.stagedSpecPaths).toEqual([staged]);

      const verdict = mod().classifyTrunkInvocationRun(observation({ git: state }));
      expect(verdict.ok).toBe(false);
      expect(verdict.violations).toContain(mod().TRUNK_VIOLATIONS.commitSkipped);
      expect(verdict.terminalState).toBe(mod().UNSANCTIONED_STAGED_UNCOMMITTED);
    } finally {
      cleanup(f);
    }
  });

  test("§ 7a says branch creation is a prelude to the commit, never a substitute", () => {
    const body = skill();
    expect(body).toContain(mod().TRUNK_PRELUDE_CLAUSE);

    // Falsifiability, both directions: the pin must be able to go red.
    const mutated = body.replace(mod().TRUNK_PRELUDE_CLAUSE, "the gate creates a branch");
    expect(mutated).not.toBe(body);
    expect(mutated.includes(mod().TRUNK_PRELUDE_CLAUSE)).toBe(false);

    // And it must live at the § 7a gate site, not somewhere the reader of the
    // branch gate will never reach.
    const gateAt = body.indexOf("### 7a. Stage spec changes and prompt for commit");
    const branchGateAt = body.indexOf("Universal pre-commit branch gate");
    const clauseAt = body.indexOf(mod().TRUNK_PRELUDE_CLAUSE);
    expect(gateAt).toBeGreaterThan(-1);
    expect(branchGateAt).toBeGreaterThan(-1);
    expect(clauseAt).toBeGreaterThan(-1);
    // Bounded on BOTH sides. An `||` of two lower bounds is satisfied by any
    // position from the branch gate to EOF — including § Rules, which is far
    // outside the § 7a reader's path this check exists to protect. The upper
    // bound is § 7's heading, so the clause has to sit inside § 7a itself.
    const reportSectionAt = body.indexOf("### 7. Report");
    expect(reportSectionAt).toBeGreaterThan(gateAt);
    expect(clauseAt).toBeGreaterThan(gateAt);
    expect(clauseAt).toBeLessThan(reportSectionAt);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-478.2 — the closing output is /spec-write's own summary.
// ---------------------------------------------------------------------------

describe("AC-STE-478.2 — the closing output is /spec-write's own summary block", () => {
  test("every signal the module matches on is present in the shipped § 7 reference shape", () => {
    const fence = referenceShapeFence();
    expect(mod().SPEC_WRITE_SUMMARY_SIGNALS.length).toBeGreaterThanOrEqual(3);
    for (const signal of mod().SPEC_WRITE_SUMMARY_SIGNALS) {
      expect(fence).toContain(signal);
    }
  });

  test("the FR table and the spec-file table are BOTH constituents, by literal membership", () => {
    // AC.2 names three constituents: the FR table, the spec-file table, and the
    // open-questions block. A `length >= 3` + fence-membership check is
    // satisfied by any three signals, so it does not pin WHICH — deleting both
    // header rows left the suite fully green under mutation. These two
    // assertions are the missing half.
    const signals = mod().SPEC_WRITE_SUMMARY_SIGNALS;
    expect(signals).toContain("| FR id      | FR file path                | Milestone |");
    expect(signals).toContain("| Spec file              | Change          |");
  });

  test("a summary carrying the heading but NEITHER table is not spec-write's own", () => {
    // The constituent AC.2 actually names. Built from the healthy summary with
    // every table row removed and nothing else touched — one variable.
    const tableless = healthySummary()
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("|"))
      .join("\n");
    // Non-vacuity: the two halves that survive are exactly the ones that stay.
    expect(tableless).toContain("## /spec-write summary");
    expect(tableless).toContain("Open questions / risks / inconsistencies (if any):");
    expect(tableless).not.toContain("| FR id");
    expect(tableless).not.toContain("| Spec file");

    expect(mod().closingSummaryIsSpecWriteOwn(tableless)).toBe(false);
    // Falsifiable in the other direction: the untouched original still passes.
    expect(mod().closingSummaryIsSpecWriteOwn(healthySummary())).toBe(true);
  });

  test("the derived healthy summary is recognised; the measured Gate Check Report is not", () => {
    expect(mod().closingSummaryIsSpecWriteOwn(healthySummary())).toBe(true);
    expect(mod().closingSummaryIsSpecWriteOwn(defectiveClosingText())).toBe(false);
  });

  test("the real capture's closing output is another skill's report, and is named as such", () => {
    const closing = defectiveClosingText();
    // Non-vacuity: this is the actual measured tail, not a synthesised one.
    expect(closing).toContain("Gate Check Report");
    expect(closing).not.toContain("## /spec-write summary");

    const matched = mod().FOREIGN_CLOSING_REPORT_SIGNATURES.filter((s) =>
      closing.includes(s),
    );
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  test("a run whose closing output is another skill's report is a violation", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-foreign" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-foreign");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");

      const state = mod().observeTrunkGitState(f.root, "master");
      // The commit DID land — so this leg isolates the summary defect alone.
      expect(state.commitsAhead).toBe(1);

      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, assistantText: defectiveClosingText() }),
      );
      expect(verdict.closingSummaryIsOwn).toBe(false);
      expect(verdict.violations).toContain(mod().TRUNK_VIOLATIONS.foreignClosingSummary);
      expect(verdict.violations).not.toContain(mod().TRUNK_VIOLATIONS.commitSkipped);
      expect(verdict.ok).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("§ 7 states the closing output must be /spec-write's own, never another skill's report", () => {
    const body = skill();
    expect(body).toContain(mod().CLOSING_SUMMARY_OWNERSHIP_CLAUSE);
    const mutated = body.replace(mod().CLOSING_SUMMARY_OWNERSHIP_CLAUSE, "emit a summary");
    expect(mutated).not.toBe(body);
    expect(mutated.includes(mod().CLOSING_SUMMARY_OWNERSHIP_CLAUSE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-478.3 — token emission is scoped to assistant text (STE-421).
// ---------------------------------------------------------------------------

describe("AC-STE-478.3 — both tokens emit as literal backticked tokens in assistant text", () => {
  const TOKENS = [
    "branch_gate_default_applied",
    "spec_write_commit_default_applied",
  ] as const;

  test("both tokens are ALREADY registered — this FR registers nothing new", () => {
    for (const token of TOKENS) {
      expect(CANONICAL_CAPABILITY_KEYS).toContain(token);
    }
  });

  test("every token the control path requires is a registered canonical key", () => {
    const registered = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    const required = mod().TRUNK_INVOCATION_STEPS.flatMap((s) => s.requiredTokens);
    expect(required.length).toBeGreaterThan(0);
    for (const token of required) {
      expect(registered.has(token)).toBe(true);
    }
    // The two AC.3 tokens are owed by the trunk path specifically.
    for (const token of TOKENS) {
      expect(required).toContain(token);
    }
  });

  test("a raw-log-only occurrence does not satisfy the contract — measured on the defect capture", () => {
    const raw = defectCapture();
    for (const token of TOKENS) {
      const score = scoreCapabilityKey(raw, token);
      // This is the trap in one pair of numbers: a raw grep says "found it".
      expect(score.rawHits).toBeGreaterThanOrEqual(1);
      expect(score.assistantHits).toBe(0);
      expect(score.present).toBe(false);
    }
  });

  test("the classifier reads the assistant-text projection, so the defect capture is missing both", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tokens" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-tokens");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");
      const state = mod().observeTrunkGitState(f.root, "master");

      const bad = mod().classifyTrunkInvocationRun(
        observation({ git: state, assistantText: defectiveClosingText() }),
      );
      expect(bad.missingTokens).toEqual([...TOKENS]);
      expect(bad.violations).toContain(mod().TRUNK_VIOLATIONS.missingCapabilityTokens);

      const good = mod().classifyTrunkInvocationRun(observation({ git: state }));
      expect(good.missingTokens).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("a bare mention without backticks does not count as an emission", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-backtick" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-backtick");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");
      const state = mod().observeTrunkGitState(f.root, "master");

      const unbackticked = healthySummary().replace(/`/g, "");
      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, assistantText: unbackticked }),
      );
      expect(verdict.missingTokens).toEqual([...TOKENS]);
    } finally {
      cleanup(f);
    }
  });

  test("the shipped skill prescribes both tokens in the closing summary", () => {
    const body = skill();
    for (const token of TOKENS) {
      expect(body).toContain("MUST emit `" + token + "`");
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-478.4 — exactly two sanctioned staged-but-uncommitted exits.
// ---------------------------------------------------------------------------

describe("AC-STE-478.4 — the only sanctioned staged-but-uncommitted exits are the two documented paths", () => {
  test("three terminal states; exactly two end staged-but-uncommitted", () => {
    const ids = mod().TRUNK_TERMINAL_STATES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([
      "committed",
      "staged_interactive_decline",
      "staged_marker_absent_non_tty_refusal",
    ]);

    const staged = mod().TRUNK_TERMINAL_STATES.filter((s) => s.stagedUncommitted);
    expect(staged.map((s) => s.id).sort()).toEqual([
      "staged_interactive_decline",
      "staged_marker_absent_non_tty_refusal",
    ]);
    for (const state of mod().TRUNK_TERMINAL_STATES) {
      expect(state.sanctioned).toBe(true);
      // Each carries the literal token its documented path emits.
      expect(state.token.length).toBeGreaterThan(0);
    }
  });

  test("the marker-absent non-tty refusal is a sanctioned staged exit", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-refusal" });
    try {
      const staged = stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");
      expect(state.stagedSpecPaths).toEqual([staged]);

      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, markerPresent: false, isTty: false }),
      );
      expect(verdict.terminalState).toBe("staged_marker_absent_non_tty_refusal");
      expect(verdict.violations).not.toContain(mod().TRUNK_VIOLATIONS.commitSkipped);
      expect(verdict.violations).not.toContain(mod().TRUNK_VIOLATIONS.unsanctionedStaged);
    } finally {
      cleanup(f);
    }
  });

  test("the interactive `n` decline is a sanctioned staged exit", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-decline" });
    try {
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const verdict = mod().classifyTrunkInvocationRun(
        observation({
          git: state,
          markerPresent: false,
          isTty: true,
          declinedAtCommitGate: true,
        }),
      );
      expect(verdict.terminalState).toBe("staged_interactive_decline");
      expect(verdict.violations).not.toContain(mod().TRUNK_VIOLATIONS.unsanctionedStaged);
    } finally {
      cleanup(f);
    }
  });

  test("marker present + non-tty + staged is NOT sanctioned — that is the defect", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-unsanctioned" });
    try {
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, markerPresent: true, isTty: false }),
      );
      expect(verdict.terminalState).toBe(mod().UNSANCTIONED_STAGED_UNCOMMITTED);
      expect(verdict.violations).toContain(mod().TRUNK_VIOLATIONS.unsanctionedStaged);
      expect(verdict.ok).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("each sanctioned staged exit's token is prescribed in the shipped skill", () => {
    const body = skill();
    for (const state of mod().TRUNK_TERMINAL_STATES) {
      if (!state.stagedUncommitted) continue;
      expect(body).toContain(state.token);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-478.4, trailing half — "…and neither creates tracker state without
// saying so."
//
// THE OTHER HALF OF THE MEASURED FAILURE. The jira leg did not merely skip the
// commit. It first created Jira Epic DST-74 and Task DST-75 — real, live,
// human-cleanup-shaped state in a real tracker — and then closed with a Gate
// Check Report that said nothing about them. Staged work an operator can find
// with `git status`; tracker items created by a run that never announced them
// are found only by accident, which is what makes this the expensive half.
//
// WHY "THE ID APPEARS SOMEWHERE" IS NOT DISCLOSURE. Measured on the retained
// capture: `DST-75` occurs 14 times and `DST-74` 5 times in the DEFECTIVE run's
// own assistant text — mid-run narration while the tickets were being created.
// A check asking "is the id present in assistant text?" scores the measured
// defect as DISCLOSED. That is AC.3's trap wearing different clothes: a pin
// that cannot fail on the very run it was written for is worthless. So
// disclosure is scoped to a literal CLOSING signal that names every created
// item, and the leg below proves the 19 incidental mentions do not rescue it.
// ---------------------------------------------------------------------------

describe("AC-STE-478.4 (tracker disclosure) — neither staged exit may leave tracker state unsaid", () => {
  /** The two items the jira leg really created before it stopped. */
  const JIRA_ITEMS = ["DST-74", "DST-75"] as const;

  function trackerCreated(ids: readonly string[] = JIRA_ITEMS) {
    return { mode: "jira" as const, createdIds: [...ids] };
  }

  /** A closing summary that DOES name the created tracker items. */
  function summaryDisclosing(ids: readonly string[] = JIRA_ITEMS): string {
    return [
      healthySummary(),
      "",
      `${mod().TRACKER_DISCLOSURE_SIGNAL} ${ids.join(", ")}`,
    ].join("\n");
  }

  test("both sanctioned staged exits declare that tracker state may exist AND must be disclosed", () => {
    const states = mod().TRUNK_TERMINAL_STATES;
    for (const state of states) {
      expect(typeof state.trackerStateMayExist).toBe("boolean");
      expect(typeof state.trackerDisclosureRequired).toBe("boolean");
    }

    // The premise: tracker items are created in Steps 2–3, well before § 7a —
    // so EVERY terminal is reachable with tracker state already live.
    expect(states.every((s) => s.trackerStateMayExist)).toBe(true);

    // The obligation is exactly the two staged exits. A committed run's tracker
    // binding rides in the commit it just landed; a staged one's rides nowhere.
    const owing = states.filter((s) => s.trackerDisclosureRequired).map((s) => s.id).sort();
    expect(owing).toEqual([
      "staged_interactive_decline",
      "staged_marker_absent_non_tty_refusal",
    ]);
    // …and it is the SAME two the AC's leading half already enumerates, so the
    // new field cannot drift into naming some third set.
    expect(owing).toEqual(
      states.filter((s) => s.stagedUncommitted).map((s) => s.id).sort(),
    );
    expect(states.find((s) => s.id === "committed")!.trackerDisclosureRequired).toBe(false);
  });

  test("the measured defect — DST-74 + DST-75 created, staged, never disclosed — is a violation", () => {
    const violation = mod().TRUNK_VIOLATIONS.undisclosedTrackerState;
    expect(typeof violation).toBe("string");
    expect(violation.length).toBeGreaterThan(0);
    // A distinct verdict, not an alias of one of the four that already exist.
    const others = [
      mod().TRUNK_VIOLATIONS.commitSkipped,
      mod().TRUNK_VIOLATIONS.foreignClosingSummary,
      mod().TRUNK_VIOLATIONS.missingCapabilityTokens,
      mod().TRUNK_VIOLATIONS.unsanctionedStaged,
    ];
    expect(others).not.toContain(violation);

    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-defect" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m_dst_74-branch-gate");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");
      expect(state.commitsAhead).toBe(0);

      const closing = defectiveClosingText();
      // NON-VACUITY, and the whole reason this check is scoped: the ids are all
      // over the defective run's own assistant text. A weaker check passes here.
      expect(closing).toContain("DST-74");
      expect(closing).toContain("DST-75");
      expect((closing.match(/DST-75/g) ?? []).length).toBeGreaterThanOrEqual(5);

      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, tracker: trackerCreated(), assistantText: closing }),
      );
      expect(verdict.violations).toContain(violation);
      expect([...verdict.undisclosedTrackerIds].sort()).toEqual(["DST-74", "DST-75"]);
      expect(verdict.ok).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("the marker-absent refusal: undisclosed reddens, disclosed greens — same repo, one variable", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-refusal" });
    try {
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const base = { git: state, markerPresent: false, isTty: false } as const;

      const silent = mod().classifyTrunkInvocationRun(
        observation({ ...base, tracker: trackerCreated() }),
      );
      // Still the SANCTIONED exit — the staged files are fine. What is not fine
      // is that two live Jira items go unnamed on the way out.
      expect(silent.terminalState).toBe("staged_marker_absent_non_tty_refusal");
      expect(silent.violations).toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect([...silent.undisclosedTrackerIds].sort()).toEqual(["DST-74", "DST-75"]);

      // The ONLY change: the closing output now says so.
      const spoken = mod().classifyTrunkInvocationRun(
        observation({
          ...base,
          tracker: trackerCreated(),
          assistantText: summaryDisclosing(),
        }),
      );
      expect(spoken.terminalState).toBe("staged_marker_absent_non_tty_refusal");
      expect(spoken.violations).not.toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect(spoken.undisclosedTrackerIds).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("the interactive `n` decline owes exactly the same disclosure", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-decline" });
    try {
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const base = {
        git: state,
        markerPresent: false,
        isTty: true,
        declinedAtCommitGate: true,
      } as const;

      const silent = mod().classifyTrunkInvocationRun(
        observation({ ...base, tracker: trackerCreated() }),
      );
      expect(silent.terminalState).toBe("staged_interactive_decline");
      expect(silent.violations).toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);

      const spoken = mod().classifyTrunkInvocationRun(
        observation({
          ...base,
          tracker: trackerCreated(),
          assistantText: summaryDisclosing(),
        }),
      );
      expect(spoken.violations).not.toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
    } finally {
      cleanup(f);
    }
  });

  test("a partial disclosure names only what is still hidden", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-partial" });
    try {
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const verdict = mod().classifyTrunkInvocationRun(
        observation({
          git: state,
          markerPresent: false,
          isTty: false,
          tracker: trackerCreated(),
          // The Epic is named; the Task the operator would have to hunt for is not.
          assistantText: summaryDisclosing(["DST-74"]),
        }),
      );
      expect(verdict.violations).toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect(verdict.undisclosedTrackerIds).toEqual(["DST-75"]);
    } finally {
      cleanup(f);
    }
  });

  test("`mode: none` is the vacuous case and stays vacuous", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-none" });
    try {
      stageSpecFile(f, "specs/frs/VDTAF4.md", "# FR\n");
      const state = mod().observeTrunkGitState(f.root, "master");

      const base = { git: state, markerPresent: false, isTty: false } as const;

      const empty = mod().classifyTrunkInvocationRun(
        observation({ ...base, tracker: { mode: "none" as const, createdIds: [] } }),
      );
      expect(empty.violations).not.toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect(empty.undisclosedTrackerIds).toEqual([]);

      // There is no tracker under `mode: none`, so nothing can have been created
      // in one. A caller that hands over ids anyway is still vacuous — the mode
      // decides, not the payload.
      const bogus = mod().classifyTrunkInvocationRun(
        observation({ ...base, tracker: { mode: "none" as const, createdIds: ["X-1"] } }),
      );
      expect(bogus.violations).not.toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect(bogus.undisclosedTrackerIds).toEqual([]);

      // And an observation carrying no tracker facts at all is the same fact:
      // nothing created, nothing owed.
      const absent = mod().classifyTrunkInvocationRun(observation({ ...base }));
      expect(absent.violations).not.toContain(mod().TRUNK_VIOLATIONS.undisclosedTrackerState);
      expect(absent.undisclosedTrackerIds).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("a run that COMMITTED does not owe the disclosure — the commit is the record", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-tracker-committed" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-tracker-committed");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");
      const state = mod().observeTrunkGitState(f.root, "master");

      const verdict = mod().classifyTrunkInvocationRun(
        observation({ git: state, tracker: trackerCreated() }),
      );
      expect(verdict.terminalState).toBe("committed");
      expect(verdict.violations).toEqual([]);
      expect(verdict.undisclosedTrackerIds).toEqual([]);
      expect(verdict.ok).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  test("§ 7a states the disclosure obligation and carries the literal signal the module matches on", () => {
    const body = skill();
    const clause = mod().TRACKER_DISCLOSURE_CLAUSE;

    // Producer/consumer pinned together: the signal the classifier greps for is
    // a literal substring of the shipped clause, so the two cannot drift.
    expect(clause).toContain(mod().TRACKER_DISCLOSURE_SIGNAL);
    expect(body).toContain(clause);

    // Falsifiability, both directions.
    const mutated = body.replace(clause, "mention the tracker");
    expect(mutated).not.toBe(body);
    expect(mutated.includes(clause)).toBe(false);

    // It has to sit inside § 7a — where the two staged exits are documented —
    // bounded on BOTH sides, not merely somewhere after the gate.
    const gateAt = body.indexOf("### 7a. Stage spec changes and prompt for commit");
    const reportSectionAt = body.indexOf("### 7. Report");
    const clauseAt = body.indexOf(clause);
    expect(gateAt).toBeGreaterThan(-1);
    expect(clauseAt).toBeGreaterThan(gateAt);
    expect(clauseAt).toBeLessThan(reportSectionAt);

    // Mechanism, not jargon: `skills/` sits at 246/246 tracker tokens, so the
    // clause cites the helper by name and spends no STE budget. (The 358-line
    // cap is guarded by the budget test below — this clause must land as an
    // in-place extension of an existing § 7a line.)
    expect(clause).toContain("trackerStateDisclosed");
    expect(clause).not.toMatch(/\bSTE-\d+/);
  });

  test("the disclosure helper is exported and is exactly the check the classifier applies", () => {
    const disclosed = mod().trackerStateDisclosed;
    expect(typeof disclosed).toBe("function");

    // Nothing created ⇒ nothing owed, whatever the text says.
    expect(disclosed(healthySummary(), [])).toBe(true);
    // Named in the closing signal ⇒ disclosed.
    expect(disclosed(summaryDisclosing(), ["DST-74", "DST-75"])).toBe(true);
    // Mentioned 19 times mid-run but absent from any closing signal ⇒ NOT.
    expect(disclosed(defectiveClosingText(), ["DST-74", "DST-75"])).toBe(false);
    // Partial ⇒ NOT.
    expect(disclosed(summaryDisclosing(["DST-74"]), ["DST-74", "DST-75"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-478.5 — the regression test drives the path and fails on either defect.
// ---------------------------------------------------------------------------

describe("AC-STE-478.5 — the regression fails when the commit is skipped OR the summary is replaced", () => {
  test("the module the skill quotes exists and the skill names its path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
    expect(skill()).toContain("spec_write_trunk_invocation_path");
  });

  test("skipping the commit reddens; landing it greens — same repo, one variable", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-e2e" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-e2e");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      stageSpecFile(f, "specs/plan/M126.md", "# Plan\n");

      const before = mod().observeTrunkGitState(f.root, "master");
      const skipped = mod().classifyTrunkInvocationRun(observation({ git: before }));
      expect(skipped.ok).toBe(false);
      expect(skipped.violations).toContain(mod().TRUNK_VIOLATIONS.commitSkipped);

      // The ONLY change between the two verdicts is the commit itself.
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");
      const after = mod().observeTrunkGitState(f.root, "master");
      const landed = mod().classifyTrunkInvocationRun(observation({ git: after }));
      expect(landed.ok).toBe(true);
      expect(landed.violations).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("replacing the closing summary with another skill's reddens the same green run", () => {
    const f = buildHookedFixture({ branch: "master", label: "ste478-swap" });
    try {
      git(f.root, "checkout", "--quiet", "-b", "feat/m126-swap");
      stageSpecFile(f, "specs/frs/DST-75.md", "# FR\n");
      git(f.root, "commit", "--quiet", "-m", "chore(specs): write FR DST-75");
      const state = mod().observeTrunkGitState(f.root, "master");

      expect(mod().classifyTrunkInvocationRun(observation({ git: state })).ok).toBe(true);

      // One variable swapped: the real Gate Check Report from the jira leg.
      const swapped = mod().classifyTrunkInvocationRun(
        observation({ git: state, assistantText: defectiveClosingText() }),
      );
      expect(swapped.ok).toBe(false);
      expect(swapped.violations).toContain(mod().TRUNK_VIOLATIONS.foreignClosingSummary);
    } finally {
      cleanup(f);
    }
  });

  test("the defect capture is the retained evidence, not a synthesised stand-in", () => {
    expect(existsSync(DEFECT_CAPTURE)).toBe(true);
    const raw = defectCapture();
    // The three facts that make it evidence rather than a fixture-shaped file.
    expect(raw).toContain('"type":"assistant"');
    expect(raw).toContain("DST-75");
    expect(extractAssistantText(raw).length).toBeGreaterThan(5000);
  });

  test("the FR records the trunk-invocation path as the scoped defect", () => {
    const fr = read(FR_478);
    expect(fr).toContain("trunk-invocation");
  });
});

// ---------------------------------------------------------------------------
// House caps — both are AT their pin with zero headroom for this FR.
// ---------------------------------------------------------------------------

describe("M126 / STE-478 — shipped-surface budget guards", () => {
  test("skills/spec-write/SKILL.md stays within the NFR-1 line cap (358)", () => {
    // Measured at 358/358 before this FR: every § 7a / § 7 clause it adds must
    // extend an EXISTING line. A new line breaches the cap.
    expect(skill().split("\n").length).toBeLessThanOrEqual(358);
  });

  test("the skills/ STE-token ceiling (246) is not breached by the new prose", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    let count = 0;
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (readFileSync(p, "utf-8").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [])
          .length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(246);
  });
});

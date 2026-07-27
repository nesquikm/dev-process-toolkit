// M116 STE-419 — enforce the first-turn Socratic contract in `/setup`.
//
// WHAT IS BROKEN. Given one stimulus — the harness autonomous-mode reminder,
// verbose pre-baked args covering every question, and NO auto-approve marker —
// three skills that share one contract behave three ways. `/brainstorm` and
// `/spec-write` refuse and touch nothing. `/setup` asks nothing, then edits the
// test project's `CLAUDE.md` and commits onto a second bootstrap branch.
// `assertFirstTurnShape` scores the recorded `/setup` transcript
// `violation tool=Edit index=19` BOTH with and without `projectRoot`, so it is
// a genuine in-project scaffold-before-ask, not an artifact of how the check
// was scoped.
//
// WHY THE DEFECT SURVIVED. `skills/setup/SKILL.md` DECLARES the contract twice
// — the `FIRST ACTION` blockquote and the § Rules Socratic-Loop-Contract bullet
// — and never OPERATIONALIZES it. The declaration names no decision procedure:
// the arbiter, the byte-grep helper and the `setup-socratic` gate site appear
// only inside the § Rules NOT-a-trigger anchor, never on the line that states
// what the first tool call must be. Meanwhile three `verification:`-annotated
// steps WRITE files (§ 2c Bun placeholder, § 6 `.claude/settings.json`,
// § 7 `.mcp.json`) and § 6c writes `.dpt/.gitignore` unconditionally, under a
// step contract that says verification "runs unconditionally regardless of
// prompt mode". Nothing in the file tells the runtime which of those must wait
// for the first ask or refusal.
//
// TEST STRATEGY, and why it is not a tautology. `/setup` is an LLM-runtime
// skill driven by SKILL.md prose; there is no `setup.ts` to unit-test. So the
// file splits in two:
//
//   * BEHAVIORAL BASELINE — the recorded transcript is replayed through the
//     shipped parser + helper and pinned at `violation tool=Edit index=19`,
//     with and without the project root. History cannot be fixed, so these
//     stay green forever; they exist so the contract pins below can never be
//     mistaken for a claim that the 2026-07-27 run passed.
//   * CONTRACT PINS — doc-conformance over `skills/setup/SKILL.md`. These are
//     what is RED today: the first-turn decision line must name the arbiter,
//     the gate site, the byte-grep helper, both non-throwing outcomes, and the
//     refusal marker (without which a `/setup` refusal reads `vacuous`, not
//     `ok-refused` — the omission `/spec-write`'s own blockquote does not
//     have); and a scaffold-write guard must enumerate every write-producing
//     step that must not fire before that ask or refusal.
//
// AC-STE-419.4 ADOPTS the STE-418 mechanism rather than inventing a second
// one: `adapters/_shared/src/gate_marker_refusal.ts` (whose `GATE_SITES`
// already carries `"setup-socratic"`) and
// `adapters/_shared/src/auto_answers.ts` (`extractAutoAnswers` /
// `resolveInterviewAnswer`, marker-gated, feeding `requireOrRefuse`'s
// `preBakedValue` slot). The pins below assert `/setup` reaches THOSE literals
// — the same module path, resolver and delimiter `/spec-write` already names —
// so the two skills agree on what an absent ask tool means.
//
// FIXTURE POLICY. The seven `tests/fixtures/socratic-first-turn/*-2026-07-27.json`
// captures are multi-hundred-KB run artifacts, deliberately NOT committed. The
// committed reproducer is `regression/setup-2026-07-27.json` (derived by the
// sibling FR STE-422, reused here rather than duplicated). Verdict-equivalence
// with the full capture is asserted under `test.skipIf` on its presence.
//
// HARD BUDGETS this FR's edits ride against, re-pinned at the top of this file
// so a bad fix trips them before anything else:
//   * `skills/setup/SKILL.md` sits at EXACTLY the 358-line cap measured as
//     `split("\n").length` ⇒ the wiring must extend existing lines in place.
//   * the `skills/` tree sits at 246/246 STE-N tokens ⇒ new SKILL prose cites
//     by mechanism, never by ticket id (`M<N>` tokens are not matched).
//   * overflow prose belongs in `docs/auto-mode-protocol.md` or
//     `docs/setup-reference.md` — both already cited by the SKILL, both without
//     a line cap.
// This file lives under `tests/`, which carries neither budget, so it cites
// ticket ids freely.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  AUTO_ANSWERS_CLOSE,
  AUTO_ANSWERS_OPEN,
  extractAutoAnswers,
  resolveInterviewAnswer,
} from "../adapters/_shared/src/auto_answers";
import {
  evaluateGateMarkerRefusal,
  GATE_SITES,
} from "../adapters/_shared/src/gate_marker_refusal";
import { runMarkerHelperInvokedPerGateProbe } from "../adapters/_shared/src/marker_helper_invoked_per_gate";
import {
  REQUIRES_INPUT_REFUSED_MARKER,
  requireOrRefuse,
  RequiresInputRefusedError,
} from "../adapters/_shared/src/requires_input";
import {
  assertFirstTurnShape,
  SCAFFOLDING_TOOLS,
  SocraticFirstTurnViolationError,
  type TranscriptEntry,
} from "../adapters/_shared/src/socratic_first_turn";
import {
  type AssertVerdict,
  verdictFor,
} from "../adapters/_shared/src/socratic_first_turn_assert";
import { runSocraticFirstTurnPostHocDriftProbe } from "../adapters/_shared/src/socratic_first_turn_post_hoc_drift";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import { runSocraticLoopUsesAskUserQuestionProbe } from "../adapters/_shared/src/socratic_loop_uses_ask_user_question";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SETUP_SKILL_PATH = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const SPEC_WRITE_SKILL_PATH = join(
  PLUGIN_ROOT,
  "skills",
  "spec-write",
  "SKILL.md",
);
const PROTOCOL_PATH = join(PLUGIN_ROOT, "docs", "auto-mode-protocol.md");

const CAPTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "socratic-first-turn");
const REGRESSION_DIR = join(CAPTURE_DIR, "regression");
const CAPTURE_DATE = "2026-07-27";

const DERIVED_SETUP_FIXTURE = join(
  REGRESSION_DIR,
  `setup-${CAPTURE_DATE}.json`,
);
const FULL_SETUP_CAPTURE = join(CAPTURE_DIR, `setup-${CAPTURE_DATE}.json`);

const read = (path: string): string => readFileSync(path, "utf-8");
const setupSkill = (): string => read(SETUP_SKILL_PATH);
const setupLines = (): string[] => setupSkill().split("\n");
/** Collapse hard wraps so a pinned sentence survives a cosmetic re-flow. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function transcriptOf(path: string): TranscriptEntry[] {
  return parseStreamJsonTranscript(read(path));
}

// ===========================================================================
// Byte-pinned literals the contract is written in terms of.
// ===========================================================================

/** The unique anchor sentence of `/setup`'s first-turn contract. */
const FIRST_TURN_MANDATE = "the first tool call this skill emits MUST be";

/** The STE-418 arbiter — the mechanism AC-STE-419.4 must ADOPT, not re-invent. */
const ARBITER_MODULE = "adapters/_shared/src/gate_marker_refusal.ts";
const ARBITER_FN = "evaluateGateMarkerRefusal";
/** `/setup`'s slot in `GATE_SITES`, present since STE-313. */
const SETUP_GATE_SITE = "setup-socratic";
/** The SOLE byte-checkable evaluation path (FR § Technical Design). */
const MARKER_GREP_MODULE = "adapters/_shared/src/check_marker_runtime.ts";
/** The sanctioned answer source, shared with `/spec-write`. */
const AUTO_ANSWERS_MODULE = "adapters/_shared/src/auto_answers.ts";
const AUTO_ANSWERS_RESOLVER = "resolveInterviewAnswer";

const AUTO_APPROVE_MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";
const SENTINEL = "__DPT_UNANSWERED__";

/**
 * Every artifact `/setup` writes at a step that fires BEFORE its interview
 * completes, and which the first-turn guard must therefore fence. Three of the
 * four sit at `verification:`-annotated steps whose own annotation says they
 * "run unconditionally regardless of prompt mode" — that contradiction is the
 * mechanism of the recorded defect, so the guard has to name them explicitly.
 */
const WRITE_PRODUCING_ARTIFACTS = [
  "src/.placeholder.test.ts", // § 2c — Bun scaffold-verify placeholder
  ".claude/settings.json", // § 6   — `verification:`, "Required, abort on failure"
  ".dpt/.gitignore", // § 6c  — unconditional, every run
  ".mcp.json", // § 7   — `verification:`, tracker mode
] as const;

// ===========================================================================
// NON-REGRESSION TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the two zero-headroom budgets survive the wiring", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test(`skills/setup/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // Measured the way the shipped cap test measures it: `split("\n").length`,
    // which counts the trailing empty element. The file sits AT the cap with
    // zero headroom — a single added line breaches this, so every literal the
    // pins below demand must be appended to an EXISTING line.
    expect(setupLines().length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (
          read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []
        ).length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the new first-turn prose adds no STE-N token to the SKILL", () => {
    // The ceiling above is a whole-tree total, so it can be satisfied by
    // deleting someone else's token. This pins the local rule: the decision
    // line itself cites its mechanism, never a ticket id. The pre-existing
    // `STE-251 AC-STE-251.1` label on that line is the one allowed occurrence.
    const tokens =
      requireDecisionLine().match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
    expect(tokens.sort()).toEqual(["AC-STE-251.1", "STE-251"]);
  });
});

describe("TRIPWIRE — the declared contract survives the operationalization", () => {
  // The blockquote and the § Rules bullet are the two places `/setup` already
  // states the contract. The fix EXTENDS them; a fix that rewrites or drops
  // them has traded one gap for another.

  const survives = (needle: string) => {
    expect(norm(setupSkill())).toContain(needle);
  };

  test("the FIRST ACTION blockquote's mandate survives", () => {
    survives(
      "the first tool call this skill emits MUST be `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise",
    );
    survives(
      "`Write` / `Edit` / `NotebookEdit` are forbidden before that ask/refusal",
    );
  });

  test("the blockquote's interactive-parity clause survives", () => {
    survives(
      "Interactive (tty) sessions are byte-identical to v2.17.0 — non-tty stdin only.",
    );
  });

  test("the § Rules Socratic Loop Contract bullet survives", () => {
    survives(
      "The first-turn contract additionally forbids `Write` / `Edit` / `NotebookEdit` tool calls before the first `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise",
    );
    survives(
      "Steps 7b, 7c, 7d, 7e, 7g are five separate prompt sites — ask one question per turn, wait for the answer, then ask the next.",
    );
  });

  test("the § Rules NOT-a-trigger anchor survives", () => {
    survives(
      "The runtime byte-grep at `adapters/_shared/src/check_marker_runtime.ts` is the SOLE byte-checkable evaluation path",
    );
    survives(
      '`evaluateGateMarkerRefusal({promptBody, isTty, gateSite: "setup-socratic"})`',
    );
  });
});

/**
 * Phrases that would make the contract self-defeating. A "fix" that resolves
 * the `verification:`-vs-first-turn contradiction by widening the carve-out
 * instead of narrowing the writes must fail here rather than pass elsewhere.
 */
const FORBIDDEN_SETUP_FIRST_TURN_DRIFT = [
  "verification steps are exempt",
  "verification writes are exempt",
  "scaffolding is allowed before",
  "the marker relaxes loop entry",
  "the marker relaxes the Socratic loop",
  "skip the first AskUserQuestion",
  "the Socratic loop is optional",
  "the interview may be skipped",
] as const;

describe("TRIPWIRE — no drift into a wider carve-out", () => {
  test("none of the self-defeating phrases appear in the SKILL", () => {
    const body = setupSkill().toLowerCase();
    for (const phrase of FORBIDDEN_SETUP_FIRST_TURN_DRIFT) {
      expect(body).not.toContain(phrase.toLowerCase());
    }
  });

  test("the drift list is non-empty (a shrunk list makes the pin vacuous)", () => {
    expect(FORBIDDEN_SETUP_FIRST_TURN_DRIFT.length).toBe(8);
  });
});

describe("TRIPWIRE — the three shipped probes stay clean over the real repo", () => {
  test("`socratic_loop_uses_ask_user_question` returns zero violations", async () => {
    const report = await runSocraticLoopUsesAskUserQuestionProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });

  test("`socratic_first_turn_post_hoc_drift` returns zero violations", async () => {
    const report = await runSocraticFirstTurnPostHocDriftProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });

  test("`marker_helper_invoked_per_gate` returns zero violations", async () => {
    // Session-log-driven, so it is vacuous with no log supplied — asserted
    // anyway because the fix touches the gate sites this probe arbitrates, and
    // a fix that makes it start firing on a clean tree is a fix that broke it.
    const report = await runMarkerHelperInvokedPerGateProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-419.1 / .2 — BEHAVIORAL BASELINE (the recorded defect, replayed)
// ===========================================================================

/** The Linear leg's test project, read out of committed bytes, never disk. */
function capturedProjectRoot(): string {
  const entry = transcriptOf(DERIVED_SETUP_FIXTURE).find(
    (e) =>
      e.type === "tool_use" &&
      typeof e.path === "string" &&
      basename(e.path) === "CLAUDE.md",
  );
  if (!entry?.path) {
    throw new Error(
      "STE-419: the committed `regression/setup-2026-07-27.json` fixture no " +
        "longer carries the in-project `<root>/CLAUDE.md` scaffold entry the " +
        "recorded defect turns on.",
    );
  }
  return dirname(entry.path);
}

const CAPTURED_PROJECT_ROOT = capturedProjectRoot();

/** The measured verdict, FR STE-419 § Requirement, Linear leg 2026-07-27. */
const RECORDED_VERDICT: AssertVerdict = {
  line: "setup: violation tool=Edit index=19",
  exitCode: 1,
};

describe("AC-STE-419.1 baseline — the recorded /setup transcript scores `violation`", () => {
  test("the fixture carries ZERO AskUserQuestion calls and ZERO refusals", () => {
    // The substance of the finding: `/setup` did not ask, and did not refuse.
    const t = transcriptOf(DERIVED_SETUP_FIXTURE);
    expect(t.length).toBeGreaterThan(0);
    expect(t.filter((e) => e.name === "AskUserQuestion")).toHaveLength(0);
    expect(t.filter((e) => e.type === "refusal")).toHaveLength(0);
  });

  test("assertFirstTurnShape throws SocraticFirstTurnViolationError at Edit@19", () => {
    const t = transcriptOf(DERIVED_SETUP_FIXTURE);
    let thrown: SocraticFirstTurnViolationError | null = null;
    try {
      assertFirstTurnShape(t, { projectRoot: CAPTURED_PROJECT_ROOT });
    } catch (e) {
      if (e instanceof SocraticFirstTurnViolationError) thrown = e;
      else throw e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.toolName).toBe("Edit");
    expect(thrown!.index).toBe(19);
  });

  test("the verdict is INVARIANT across projectRoot — not a scoping artifact", () => {
    // This is what separates STE-419 from STE-422: `/brainstorm`'s violation
    // dissolved once the runner was told where the project root was.
    // `/setup`'s does not, because the Edit landed inside the project.
    const t = transcriptOf(DERIVED_SETUP_FIXTURE);
    const scoped = verdictFor("setup", t, {
      projectRoot: CAPTURED_PROJECT_ROOT,
    });
    const unscoped = verdictFor("setup", t);
    expect(scoped).toEqual(RECORDED_VERDICT);
    expect(unscoped).toEqual(RECORDED_VERDICT);
    expect(scoped).toEqual(unscoped);
  });

  test("the recorded project root is the Linear leg's test project", () => {
    expect(basename(CAPTURED_PROJECT_ROOT)).toBe("dpt-test-project-linear");
  });
});

describe("AC-STE-419.2 baseline — the write landed INSIDE the project root", () => {
  test("the decisive entry is an in-project Edit of CLAUDE.md", () => {
    const scaffold = transcriptOf(DERIVED_SETUP_FIXTURE)[19]!;
    expect(scaffold.type).toBe("tool_use");
    expect(scaffold.name).toBe("Edit");
    expect(scaffold.path).toBe(`${CAPTURED_PROJECT_ROOT}/CLAUDE.md`);
    expect(SCAFFOLDING_TOOLS).toContain(scaffold.name!);
  });

  test("no scaffolding tool fired BEFORE it — the Edit is the first one", () => {
    // Pins the index the contract turns on: everything at 0..18 is read-only
    // orientation, which the contract permits. The violation is the Edit.
    const t = transcriptOf(DERIVED_SETUP_FIXTURE);
    const early = t
      .slice(0, 19)
      .filter((e) => (SCAFFOLDING_TOOLS as readonly string[]).includes(e.name ?? ""));
    expect(early).toHaveLength(0);
  });
});

describe("fixture equivalence — derived vs. the untracked full capture", () => {
  const present = existsSync(FULL_SETUP_CAPTURE);
  test.skipIf(!present)(
    "setup: the derived reproducer is verdict-equivalent to the full capture" +
      (present ? "" : " [SKIPPED — untracked capture absent]"),
    () => {
      const full = transcriptOf(FULL_SETUP_CAPTURE);
      const derived = transcriptOf(DERIVED_SETUP_FIXTURE);
      expect(full.length).toBeGreaterThan(0);

      for (const opts of [undefined, { projectRoot: CAPTURED_PROJECT_ROOT }]) {
        expect(verdictFor("setup", derived, opts)).toEqual(
          verdictFor("setup", full, opts),
        );
        expect(verdictFor("setup", full, opts)).toEqual(RECORDED_VERDICT);
      }
      // …and the full capture agrees on the absence that made it a finding.
      expect(full.filter((e) => e.name === "AskUserQuestion")).toHaveLength(0);
      expect(full.filter((e) => e.type === "refusal")).toHaveLength(0);
    },
  );
});

// ===========================================================================
// AC-STE-419.1 — CONTRACT PIN: the first-turn decision line is operational
// ===========================================================================

/** The one line stating what `/setup`'s first tool call must be. */
function requireDecisionLine(): string {
  const hits = setupLines().filter((l) => l.includes(FIRST_TURN_MANDATE));
  if (hits.length !== 1) {
    throw new Error(
      `STE-419: expected exactly one first-turn decision line in ` +
        `skills/setup/SKILL.md (anchored on "${FIRST_TURN_MANDATE}"), ` +
        `found ${hits.length}.`,
    );
  }
  return hits[0]!;
}

describe("AC-STE-419.1 — the first-turn decision routes through the shared arbiter", () => {
  test("the anchor line is unique — the pins below have one target", () => {
    expect(setupLines().filter((l) => l.includes(FIRST_TURN_MANDATE))).toHaveLength(1);
  });

  test("the decision line names the arbiter module and function", () => {
    // Naming them in the § Rules NOT-a-trigger anchor (where they live today)
    // documents what is NOT a trigger. It does not tell the runtime what to
    // CALL at the moment the first turn is decided. Co-location is the fix.
    const line = requireDecisionLine();
    expect(line).toContain(ARBITER_MODULE);
    expect(line).toContain(ARBITER_FN);
  });

  test("the decision line names the `setup-socratic` gate site", () => {
    expect(requireDecisionLine()).toContain(SETUP_GATE_SITE);
  });

  test("the gate site is the one the shipped arbiter already exposes", () => {
    // Non-vacuity for the pin above: `setup-socratic` is not a string this FR
    // invents — it has been in `GATE_SITES` since STE-313, unused by /setup.
    expect(GATE_SITES).toContain(SETUP_GATE_SITE);
  });

  test("the decision line names the byte-grep helper as the evaluation path", () => {
    expect(requireDecisionLine()).toContain(MARKER_GREP_MODULE);
  });

  test("the decision line states BOTH non-throwing outcomes, not just the refusal", () => {
    // Prose that documents only the refuse branch invites the runtime to
    // invent its own apply/prompt rule — which is how a skill ends up
    // scaffolding under a `verification:` annotation.
    const line = requireDecisionLine();
    expect(line).toContain("apply");
    expect(line).toContain("prompt");
    expect(line).toContain("RequiresInputRefusedError");
  });
});

describe("AC-STE-419.1 — a /setup refusal must read `ok-refused`, never `vacuous`", () => {
  test("the decision line mandates the requires-input-refused marker", () => {
    // THE asymmetry with `/spec-write`, whose blockquote already carries this
    // mandate. Without it a correct `/setup` refusal is byte-indistinguishable
    // at the Phase 8 surface from a child that simply did nothing.
    expect(requireDecisionLine()).toContain(REQUIRES_INPUT_REFUSED_MARKER);
  });

  test("the decision line says WHY — an unmarked refusal reads `vacuous`", () => {
    // Guards the cheap fix: dropping the marker literal in without the
    // consequence leaves the next editor free to delete it as decoration.
    expect(requireDecisionLine()).toMatch(/vacuous/i);
  });

  test("the marker literal is the shipped constant, not a look-alike", () => {
    expect(REQUIRES_INPUT_REFUSED_MARKER).toBe(
      "<dpt:requires-input-refused>v1</dpt:requires-input-refused>",
    );
  });

  test("`/spec-write` already carries this mandate — parity is the target", () => {
    // Non-vacuity: the pin is not an invention, it is the clause `/setup`'s
    // otherwise-parallel blockquote is missing.
    expect(read(SPEC_WRITE_SKILL_PATH)).toContain(REQUIRES_INPUT_REFUSED_MARKER);
  });

  test("END-TO-END: an arbiter refusal at this gate site projects `ok-refused`", () => {
    // The behavioral half of the pin — the shipped arbiter, the shipped
    // parser, the shipped helper, with no fixture in between.
    let message = "";
    try {
      evaluateGateMarkerRefusal({
        promptBody: "/dev-process-toolkit:setup existing",
        isTty: false,
        gateSite: "setup-socratic",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(REQUIRES_INPUT_REFUSED_MARKER);

    const transcript = parseStreamJsonTranscript(assistantTextCapture(message));
    expect(transcript[0]).toEqual({ type: "refusal" });
    expect(
      assertFirstTurnShape(transcript, { projectRoot: REPO_ROOT }).outcome,
    ).toBe("ok-refused");
  });

  test("NON-VACUITY: the same prose with the marker stripped reads `vacuous`", () => {
    let message = "";
    try {
      evaluateGateMarkerRefusal({
        promptBody: "/dev-process-toolkit:setup existing",
        isTty: false,
        gateSite: "setup-socratic",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    const stripped = message.split(REQUIRES_INPUT_REFUSED_MARKER).join("");
    expect(stripped).not.toContain(REQUIRES_INPUT_REFUSED_MARKER);
    const transcript = parseStreamJsonTranscript(assistantTextCapture(stripped));
    expect(
      assertFirstTurnShape(transcript, { projectRoot: REPO_ROOT }).outcome,
    ).toBe("vacuous");
  });
});

/** One assistant text block wrapped as a minimal stream-json capture. */
function assistantTextCapture(text: string): string {
  return [
    JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "m116-ste-419",
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }], stop_reason: "end_turn" },
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      permission_denials: [],
    }),
    "",
  ].join("\n");
}

// ===========================================================================
// AC-STE-419.2 — CONTRACT PIN: the scaffold-write guard names its steps
// ===========================================================================

/** Lines that enumerate every write-producing step the guard must fence. */
function guardLines(): string[] {
  return setupLines().filter((l) =>
    WRITE_PRODUCING_ARTIFACTS.every((a) => l.includes(a)),
  );
}

describe("AC-STE-419.2 — the guard enumerates every write-producing step", () => {
  test("NON-VACUITY: each artifact is already written somewhere in the SKILL", () => {
    // The pin is about CO-LOCATING these under one guard, not about inventing
    // new strings. If any of these ever stops being a /setup write, the
    // enumeration below must shrink deliberately, not silently.
    const body = setupSkill();
    for (const artifact of WRITE_PRODUCING_ARTIFACTS) {
      expect(body).toContain(artifact);
    }
  });

  test("exactly one line names all four write-producing artifacts together", () => {
    // Four literals scattered across a 358-line file is not a guard. Today
    // there is no such line — every one of these writes is described only at
    // its own step, three of them under a `verification:` annotation that says
    // the step "runs unconditionally regardless of prompt mode".
    expect(guardLines()).toHaveLength(1);
  });

  test("the guard forbids them before the FIRST ask or refusal", () => {
    const line = guardLines()[0] ?? "";
    expect(line).toMatch(/before (?:the |that )?first|before that ask/i);
    expect(line).toMatch(/AskUserQuestion|ask\/refusal/);
    expect(line).toMatch(/forbidden|must not|may not|never fire|deferred/i);
  });

  test("the guard covers the REFUSE branch too, not only the ask branch", () => {
    // AC-STE-419.2's second half — "the working tree is byte-unchanged if it
    // refuses" — only holds if the guard fences the refuse path as well.
    expect(guardLines()[0] ?? "").toMatch(/refus/i);
  });

  test("the guard closes the `verification:` carve-out explicitly", () => {
    // The mechanism of the recorded defect: § 2c / § 6 / § 7 are annotated
    // `verification:`, and the step contract at the top of the file says
    // verification "runs unconditionally regardless of prompt mode". Unless
    // the guard names that annotation, it reads as the weaker rule.
    expect(guardLines()[0] ?? "").toContain("verification:");
  });

  test("the SKILL still declares the annotation the guard narrows", () => {
    // Non-vacuity for the test above: the contradiction being resolved is
    // real, and the `verification:` kind itself must survive the fix.
    expect(norm(setupSkill())).toContain(
      "`verification:` — runs unconditionally regardless of prompt mode",
    );
  });
});

// ===========================================================================
// AC-STE-419.3 — pre-baked args are not an authorization
// ===========================================================================

const AUTONOMOUS_REMINDER =
  "The user has asked you to work without stopping for clarifying questions. " +
  "When you'd normally pause to check, make the reasonable call and continue; " +
  "they'll redirect if needed.";

/**
 * The 2026-07-27 stimulus, reconstructed: verbose args that appear to answer
 * every question `/setup` can ask, an autonomous-mode reminder, and NO marker.
 */
const PREBAKED_SETUP_BODY = [
  AUTONOMOUS_REMINDER,
  "/dev-process-toolkit:setup existing",
  "<command-args>--tracker=linear --team=STE " +
    '--project="DPT Smoke Test" --stack=bun-typescript ' +
    '--branch-template="{type}/m{N}-{slug}" --user-facing-docs=no ' +
    "--packages-docs=no --changelog-ci=no --token-stats=no --specs=yes " +
    "--yes --non-interactive</command-args>",
  "Do not stop to ask; every setting above is already decided.",
].join("\n");

/** The interview keys `/setup` resolves across steps 2, 7b, 7c, 7d, 7g and 8. */
const SETUP_INTERVIEW_ANSWERS: Record<string, string> = {
  stack: "bun-typescript",
  tracker_mode: "linear",
  branch_template: "{type}/m{N}-{slug}",
  user_facing_mode: "false",
  packages_mode: "false",
  changelog_ci_owned: "false",
  token_stats_enabled: "false",
  create_specs: "yes",
};

/** Wrap `lines` in a well-formed answers block. */
function answersBlock(lines: string[]): string {
  return [AUTO_ANSWERS_OPEN, ...lines, AUTO_ANSWERS_CLOSE].join("\n");
}

const SETUP_ANSWER_LINES = Object.entries(SETUP_INTERVIEW_ANSWERS).map(
  ([k, v]) => `${k}: ${v}`,
);

function captureSetupRefusal(promptBody: string): RequiresInputRefusedError {
  let captured: RequiresInputRefusedError | null = null;
  try {
    evaluateGateMarkerRefusal({
      promptBody,
      isTty: false,
      gateSite: "setup-socratic",
    });
  } catch (e) {
    if (e instanceof RequiresInputRefusedError) captured = e;
    else throw e;
  }
  if (captured === null) {
    throw new Error("expected RequiresInputRefusedError, none thrown");
  }
  return captured;
}

describe("AC-STE-419.3 — pre-baked args do NOT authorize skipping the ask", () => {
  test("the fixture is genuinely unmarked but verbose enough to look answered", () => {
    expect(PREBAKED_SETUP_BODY.includes(AUTO_APPROVE_MARKER)).toBe(false);
    expect(PREBAKED_SETUP_BODY).toContain("--tracker=linear");
    expect(PREBAKED_SETUP_BODY).toContain("--non-interactive");
    expect(PREBAKED_SETUP_BODY).toContain("work without stopping");
  });

  test("extractAutoAnswers is inert even with a well-formed block attached", () => {
    const withBlock = [
      PREBAKED_SETUP_BODY,
      answersBlock(SETUP_ANSWER_LINES),
    ].join("\n");
    expect(withBlock).toContain(AUTO_ANSWERS_OPEN);
    expect(withBlock).toContain(AUTO_ANSWERS_CLOSE);
    expect(extractAutoAnswers(withBlock)).toEqual({
      present: false,
      answers: {},
    });
  });

  test("resolveInterviewAnswer yields undefined for every /setup interview key", () => {
    for (const key of Object.keys(SETUP_INTERVIEW_ANSWERS)) {
      expect(resolveInterviewAnswer(PREBAKED_SETUP_BODY, key)).toBeUndefined();
    }
  });

  test("the setup-socratic gate refuses under non-tty, with the refusal marker", () => {
    const err = captureSetupRefusal(PREBAKED_SETUP_BODY);
    expect(err.name).toBe("RequiresInputRefusedError");
    expect(err.message).toMatch(/Verdict:/);
    expect(err.message).toMatch(/Remedy:/);
    expect(err.message).toMatch(/Context:/);
    expect(err.message).toContain("gate_site=setup-socratic");
    expect(err.message).toContain("marker=absent");
    expect(err.message).toContain("stdin=non-tty");
    expect(err.message).toContain(REQUIRES_INPUT_REFUSED_MARKER);
    expect(err.markerPresent).toBe(false);
  });

  test("the refusal projects `ok-refused` — the outcome AC-STE-419.1 demands", () => {
    const err = captureSetupRefusal(PREBAKED_SETUP_BODY);
    const shape = assertFirstTurnShape(
      parseStreamJsonTranscript(assistantTextCapture(err.message)),
      { projectRoot: REPO_ROOT },
    );
    expect(shape.outcome).toBe("ok-refused");
    expect(shape.outcome).not.toBe("violation");
  });

  test("requireOrRefuse still throws for tracker_mode — the prose never lands pre-baked", () => {
    expect(() =>
      requireOrRefuse(
        {
          preBakedValue: resolveInterviewAnswer(
            PREBAKED_SETUP_BODY,
            "tracker_mode",
          ),
          markerPresent: false,
          defaultValue: undefined,
          skillName: "/setup",
          stepName: "step 7b (tracker mode)",
          refusalReason:
            "tracker mode is a workspace-wide decision; no safe default exists.",
        },
        "tracker_mode",
        SENTINEL,
      ),
    ).toThrow(RequiresInputRefusedError);
  });

  test("CONTROL — the identical body WITH marker + block DOES unlock", () => {
    // Non-vacuity: the fixture fails for the missing marker, not because the
    // answers block is malformed or the keys are wrong.
    const marked = [
      AUTO_APPROVE_MARKER,
      PREBAKED_SETUP_BODY,
      answersBlock(SETUP_ANSWER_LINES),
    ].join("\n");
    const got = extractAutoAnswers(marked);
    expect(got.present).toBe(true);
    expect(got.answers).toEqual(SETUP_INTERVIEW_ANSWERS);
    expect(
      evaluateGateMarkerRefusal({
        promptBody: marked,
        isTty: false,
        gateSite: "setup-socratic",
      }).outcome,
    ).toBe("apply");
  });

  test("TRIPWIRE — the SKILL's non-trigger anchor keeps naming pre-baked args", () => {
    // The prose half of AC-STE-419.3, and the clause a bad fix is most likely
    // to trade away while "simplifying" the newly-wired decision line: the
    // verbose body must stay listed as NOT an authorization.
    expect(norm(setupSkill())).toContain(
      "The following are NOT acceptable auto-apply triggers",
    );
    expect(setupSkill()).toContain("pre-baked `<command-args>` prose");
    expect(setupSkill()).toContain(
      "the literal marker `<dpt:auto-approve>v1</dpt:auto-approve>` is the SOLE auto-apply trigger",
    );
  });
});

// ===========================================================================
// AC-STE-419.4 — the marker path ADOPTS the STE-418 mechanism
// ===========================================================================

const SANCTIONED_SETUP_BODY = [
  AUTO_APPROVE_MARKER,
  "/dev-process-toolkit:setup existing",
  answersBlock(SETUP_ANSWER_LINES),
].join("\n");

describe("AC-STE-419.4 — with the marker, /setup completes non-interactively", () => {
  test("the gate reads `apply` for the sanctioned body under non-tty", () => {
    const r = evaluateGateMarkerRefusal({
      promptBody: SANCTIONED_SETUP_BODY,
      isTty: false,
      gateSite: "setup-socratic",
    });
    expect(r.outcome).toBe("apply");
    expect(r.markerPresent).toBe(true);
  });

  test("resolveInterviewAnswer yields every /setup interview answer", () => {
    for (const [key, value] of Object.entries(SETUP_INTERVIEW_ANSWERS)) {
      expect(resolveInterviewAnswer(SANCTIONED_SETUP_BODY, key)).toBe(value);
    }
  });

  test("every key resolves through requireOrRefuse as `pre-baked`", () => {
    // ANSWERED, not skipped. The block is a transport for the pre-baked slot;
    // it never reaches `default-applied`, which stays reserved for gates that
    // have a documented safe default.
    for (const [key, value] of Object.entries(SETUP_INTERVIEW_ANSWERS)) {
      const result = requireOrRefuse(
        {
          preBakedValue: resolveInterviewAnswer(SANCTIONED_SETUP_BODY, key),
          markerPresent: true,
          defaultValue: undefined,
          skillName: "/setup",
          stepName: "Socratic interview",
          refusalReason: "no safe default exists for an interview answer.",
        },
        key,
        SENTINEL,
      );
      expect(result.outcome).toBe("pre-baked");
      expect(result.value).toBe(value);
    }
  });

  test("the marker ALONE still answers nothing — the block is load-bearing", () => {
    const markerOnly = `${AUTO_APPROVE_MARKER}\n/dev-process-toolkit:setup existing`;
    expect(extractAutoAnswers(markerOnly).present).toBe(false);
    expect(resolveInterviewAnswer(markerOnly, "tracker_mode")).toBeUndefined();
    expect(() =>
      requireOrRefuse(
        {
          preBakedValue: resolveInterviewAnswer(markerOnly, "tracker_mode"),
          markerPresent: true,
          defaultValue: undefined,
          skillName: "/setup",
          stepName: "step 7b (tracker mode)",
          refusalReason:
            "tracker mode is a workspace-wide decision; no safe default exists.",
        },
        "tracker_mode",
        SENTINEL,
      ),
    ).toThrow(RequiresInputRefusedError);
  });

  test("a malformed block fails CLOSED even with the marker present", () => {
    const unterminated = [
      AUTO_APPROVE_MARKER,
      AUTO_ANSWERS_OPEN,
      "tracker_mode: linear",
    ].join("\n");
    expect(extractAutoAnswers(unterminated)).toEqual({
      present: false,
      answers: {},
    });
  });
});

describe("AC-STE-419.4 — /setup SKILL.md reaches the SAME answer source", () => {
  test("the SKILL names the answer-source module by path", () => {
    // Today `/setup` has zero references to it. A shipped module the consumer
    // never names is unreachable prose — the exact defect the STE-418 wiring
    // round had to close for `/spec-write`.
    expect(setupSkill()).toContain(AUTO_ANSWERS_MODULE);
  });

  test("the SKILL names the resolver and the block's opening delimiter", () => {
    const body = setupSkill();
    expect(body).toContain(AUTO_ANSWERS_RESOLVER);
    expect(body).toContain(AUTO_ANSWERS_OPEN);
  });

  test("module path, resolver and delimiter are co-located on ONE line", () => {
    const hits = setupLines().filter(
      (l) =>
        l.includes(AUTO_ANSWERS_MODULE) &&
        l.includes(AUTO_ANSWERS_RESOLVER) &&
        l.includes(AUTO_ANSWERS_OPEN),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("the wiring prose states BOTH branch directions", () => {
    // Happy-path-only prose is how a runtime ends up inventing a fallback
    // instead of letting the refusal fire.
    const wiring = setupLines()
      .filter((l) => l.includes(AUTO_ANSWERS_MODULE))
      .join("\n");
    expect(wiring).toContain("preBakedValue");
    expect(wiring).toContain("pre-baked");
    expect(wiring).toContain("undefined");
    expect(wiring).toMatch(/refus/i);
  });

  test("the marker is stated as a hard PRECONDITION; an unmarked block is inert", () => {
    const wiring = setupLines()
      .filter((l) => l.includes(AUTO_ANSWERS_MODULE))
      .join("\n");
    expect(wiring).toMatch(/\binert\b/i);
    expect(wiring).toContain("marker");
  });

  test("the two skills agree — both name module, resolver and delimiter", () => {
    // "so the two skills agree on what an absent ask tool means": one shape,
    // named identically on both sides, not two parallel inventions.
    for (const path of [SETUP_SKILL_PATH, SPEC_WRITE_SKILL_PATH]) {
      const body = read(path);
      expect(body).toContain(AUTO_ANSWERS_MODULE);
      expect(body).toContain(AUTO_ANSWERS_RESOLVER);
      expect(body).toContain(AUTO_ANSWERS_OPEN);
    }
  });

  test("the protocol doc's answers-block section names /setup as a consumer", () => {
    // The contract doc currently documents `/spec-write` and the Phase 2
    // driver only. If `/setup` adopts the mechanism, the single source of
    // truth has to say so — otherwise the next reader concludes it did not.
    const doc = read(PROTOCOL_PATH);
    const start = doc.indexOf("## Sanctioned Answers Block");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = doc.indexOf("\n## ", start + 1);
    const section = doc.slice(start, next === -1 ? undefined : next);
    expect(section).toContain(AUTO_ANSWERS_MODULE);
    expect(section).toContain("/setup");
  });
});

// ===========================================================================
// AC-STE-419.5 — the interactive (tty) run is behaviorally unchanged
// ===========================================================================

describe("AC-STE-419.5 — the interactive path is untouched", () => {
  test("marker absent + tty ⇒ outcome=prompt at the setup gate site", () => {
    const r = evaluateGateMarkerRefusal({
      promptBody: PREBAKED_SETUP_BODY,
      isTty: true,
      gateSite: "setup-socratic",
    });
    expect(r.outcome).toBe("prompt");
    expect(r.markerPresent).toBe(false);
  });

  test("marker absent + tty ⇒ prompt at EVERY gate site (no site regressed)", () => {
    for (const gateSite of GATE_SITES) {
      expect(
        evaluateGateMarkerRefusal({
          promptBody: PREBAKED_SETUP_BODY,
          isTty: true,
          gateSite,
        }).outcome,
      ).toBe("prompt");
    }
  });

  test("marker present + tty ⇒ still `apply` (auto-mode unchanged interactively)", () => {
    expect(
      evaluateGateMarkerRefusal({
        promptBody: SANCTIONED_SETUP_BODY,
        isTty: true,
        gateSite: "setup-socratic",
      }).outcome,
    ).toBe("apply");
  });

  test("an unmarked answers block stays inert under tty too", () => {
    const ttyBody = [
      "please set this project up",
      answersBlock(SETUP_ANSWER_LINES),
    ].join("\n");
    expect(extractAutoAnswers(ttyBody)).toEqual({ present: false, answers: {} });
    expect(resolveInterviewAnswer(ttyBody, "tracker_mode")).toBeUndefined();
  });

  test("an AskUserQuestion first turn still reads `ok-asked`", () => {
    const ndjson = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "m116-ste-419-tty",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Detected a bun/TypeScript project." },
            {
              type: "tool_use",
              id: "toolu_01",
              name: "AskUserQuestion",
              input: {
                questions: [{ question: "Task Tracking: where do ACs live?" }],
              },
            },
          ],
          stop_reason: null,
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "asked",
        permission_denials: [],
      }),
      "",
    ].join("\n");
    const shape = assertFirstTurnShape(parseStreamJsonTranscript(ndjson), {
      projectRoot: REPO_ROOT,
    });
    expect(shape.outcome).toBe("ok-asked");
    expect(shape.askIndex).toBe(1);
  });

  test("the interactive step annotations survive verbatim", () => {
    // AC-STE-419.5 in prose terms: the fix constrains only what `/setup` may
    // do BEFORE its first ask or refusal, never what it does once legitimately
    // allowed to proceed. These are the annotations that drive the tty flow.
    const body = norm(setupSkill());
    expect(body).toContain(
      "`requires-input: tracker mode is a workspace-wide decision; no safe default exists.`",
    );
    expect(setupSkill()).toContain("default: `{type}/m{N}-{slug}`");
    expect(setupSkill()).toContain(
      "`requires-input: <reason>` — refuses to proceed without an answer.",
    );
    expect(setupSkill()).toContain("`default: all-false`");
    expect(setupSkill()).toContain("`default: commit`");
  });
});

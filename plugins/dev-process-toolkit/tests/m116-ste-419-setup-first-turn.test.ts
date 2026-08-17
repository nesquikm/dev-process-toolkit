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
import { isRequiresInputDeclaration } from "../adapters/_shared/src/requires_input_sentinel_coverage";
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

  test("NON-VACUITY: the same prose with the marker stripped is a non-pass", () => {
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
    // The non-pass label sharpened from `vacuous` to `violation`: a run that
    // wrote no scaffold and emitted neither an ask nor a recognisable refusal
    // is a breach that can name itself, not an inconclusive result. What this
    // leg asserts — that stripping the marker loses `ok-refused` — is unchanged.
    const outcome = assertFirstTurnShape(transcript, { projectRoot: REPO_ROOT }).outcome;
    expect(outcome).toBe("violation");
    expect(outcome).not.toBe("ok-refused");
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

// ===========================================================================
// POST-AUDIT — the PRODUCER half of `/setup`'s answer source was never wired
// ===========================================================================
//
// THE REGRESSION THIS MILESTONE INTRODUCED. Everything above makes `/setup`
// STRICTER: step 7b (`skills/setup/SKILL.md`,
// `requires-input: tracker mode … no safe default exists`) now routes through
// `requireOrRefuse`, and AC-STE-419.3 makes pre-baked `<command-args>` prose
// explicitly a NON-trigger. The sanctioned `<dpt:answers>v1` block is therefore
// `/setup`'s ONLY legitimate non-tty answer source.
//
// But only the CONSUMER half shipped. The `/setup` child heredoc in
// `.claude/skills/smoke-test/SKILL.md` still carries the auto-approve marker
// plus pre-baked prose (`stack=Bun+TS, tracker=<tracker>, …`) and NO
// `<dpt:answers>v1` block — the only block in the whole driver is the
// `/spec-write` one. With the marker present but no block,
// `resolveInterviewAnswer` returns `undefined` and step 7b refuses, so the next
// headless leg truncates at step 1 of 6 — one step EARLIER than the
// `/spec-write` failure M116 exists to close. Nothing above this line
// references the driver at all, so nothing pins it.
//
// THE SECOND, NARROWER HALF. `/setup` step 7f (tracker-config write) declares
// `requires-input:` too, and fires in EVERY tracker mode — so it runs on both
// smoke legs. `docs/auto-mode-protocol.md`'s `/setup` Consumers entry NAMES 7f
// as covered, but its eight-key list (`stack`, `tracker_mode`,
// `branch_template`, `user_facing_mode`, `packages_mode`, `changelog_ci_owned`,
// `token_stats_enabled`, `create_specs`) carries no key for it. Per the doc's
// own rule — "a key the block omits refuses individually" — 7f refuses
// unconditionally even once a block exists.
//
// WHY THE GATE LIST BELOW IS DERIVED, NOT TRANSCRIBED. The defect class is
// producer/consumer drift: a gate exists on one side and its answer key does
// not exist on the other. Transcribing the gate list here would let the two
// drift apart again the moment `/setup` grows a ninth `requires-input:` step.
// So the gates are parsed out of the shipped SKILL through the SHIPPED
// recognizer (`isRequiresInputDeclaration`, the single source of truth probe
// #x uses), and the keys are parsed out of the shipped driver through the
// SHIPPED parser (`extractAutoAnswers`).
//
// FRAMING, UNCHANGED. Nothing here weakens the Socratic Loop Contract. The
// block is a transport for `requireOrRefuse`'s `preBakedValue` slot: the
// interview is ANSWERED, never skipped, and the marker stays a hard
// precondition. The tripwires at the top of this file — and the drift/decoy
// pins below — exist so a "fix" that widens the trigger surface fails here.
//
// EDIT SURFACE. `.claude/skills/smoke-test/SKILL.md` and
// `docs/auto-mode-protocol.md` carry no line cap and no STE-token ceiling, so
// the fix belongs there. `skills/setup/SKILL.md` is AT its 358-line cap and
// `skills/` is at 246/246 STE-tokens — the TRIPWIRE describes at the top of
// this file already fail a fix that reaches for the SKILL carelessly.

// Repo-root-relative: a sweep scoped to PLUGIN_ROOT cannot see `.claude/skills/`.
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

const smokeSkill = existsSync(SMOKE_SKILL_PATH) ? read(SMOKE_SKILL_PATH) : null;
const describeIfSmokePresent = smokeSkill === null ? describe.skip : describe;

/**
 * The heredoc body of the `claude -p` spawn whose stdout redirects to
 * `logToken` — the text strictly between the `<<'PROMPT_EOF'` line and the
 * closing `PROMPT_EOF` line, so the first line is the child's first prompt-body
 * line. Same construction as `tests/m116-ste-418-wiring.test.ts`, deliberately
 * duplicated rather than exported from a test file.
 */
function heredocBody(logToken: string): string {
  const body = smokeSkill!;
  const at = body.indexOf(logToken);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = body.indexOf("<<'PROMPT_EOF'", at);
  expect(open).toBeGreaterThanOrEqual(0);
  const start = body.indexOf("\n", open) + 1;
  const close = body.indexOf("\nPROMPT_EOF", start);
  expect(close).toBeGreaterThan(start);
  return body.slice(start, close);
}

const setupHeredoc = (): string =>
  heredocBody("/tmp/dpt-smoke-<tracker>-setup.log");

/**
 * The `- \`/<skill>\`` bullet under `## Sanctioned Answers Block`'s
 * `**Consumers.**` intro, sliced to the next top-level bullet or heading.
 * Scoping matters: the eight `/setup` keys and the twelve `/spec-write` keys
 * live in sibling bullets of one section, so an unscoped substring search over
 * the whole doc would pass for either skill without its entry changing at all.
 */
function consumerEntry(doc: string, skill: string): string {
  const at = doc.indexOf("**Consumers.**");
  expect(at, "the doc lost its `**Consumers.**` intro").toBeGreaterThanOrEqual(
    0,
  );
  const region = doc.slice(at);
  const start = region.indexOf(`- \`${skill}\``);
  expect(
    start,
    `the Consumers list lost its \`${skill}\` entry`,
  ).toBeGreaterThanOrEqual(0);
  const rest = region.slice(start + 2); // step past the leading "- "
  const stop = rest.search(/\n(?:- |## )/);
  return rest.slice(0, stop === -1 ? rest.length : stop);
}

const setupConsumerEntry = (): string =>
  consumerEntry(read(PROTOCOL_PATH), "/setup");
const specWriteConsumerEntry = (): string =>
  consumerEntry(read(PROTOCOL_PATH), "/spec-write");

// ---------------------------------------------------------------------------
// Gate derivation — parsed from the shipped SKILL through the shipped
// recognizer, so a future `requires-input:` step is in scope automatically.
// ---------------------------------------------------------------------------

interface SetupGate {
  /** `7b`, `7f`, … — from the nearest preceding numbered step heading. */
  step: string;
  /** 1-based line in `skills/setup/SKILL.md`, for failure messages. */
  line: number;
  /** The declared reason, verbatim. */
  reason: string;
}

/** `### 7f. Tracker-config write` → `7f`. */
const STEP_HEADING_RE = /^#{2,4}\s+(\d+[a-z]?)\./;

/** The `<reason>` template placeholder in the § Step contract legend. */
const PLACEHOLDER_REASON_RE = /^<[^>]*>$/;

/** Reason text of a declaration line, in either recognized shape. */
function declaredReason(line: string): string | null {
  const spanRe = /`([^`\n]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(line)) !== null) {
    const inner = m[1]!;
    if (inner.startsWith("requires-input:")) {
      return inner.slice("requires-input:".length).trim();
    }
  }
  const bare = line.replace(/^[\s>|#*_+-]*`?/, "");
  if (bare.startsWith("requires-input:")) {
    return bare.slice("requires-input:".length).trim();
  }
  return null;
}

/**
 * A declaration states a REAL gate — one that refuses without an answer —
 * only when it carries a prose reason. Two shapes are excluded on purpose:
 *
 *   * `` `requires-input: <reason>` `` — the § Step contract legend that
 *     DEFINES the annotation kind, not a gate;
 *   * `` `requires-input: false` `` — step 7g's shorthand for "this is NOT a
 *     `requires-input:` gate" (its own prose says so). The shipped recognizer
 *     scores it a declaration because the span is reason-bearing; the filter
 *     below is where that known false positive is handled, visibly, once.
 */
function isRealGateReason(reason: string): boolean {
  if (reason === "") return false;
  if (PLACEHOLDER_REASON_RE.test(reason)) return false;
  return /\s/.test(reason);
}

/** Every `requires-input:` gate `/setup` actually declares, with its step. */
function setupGates(): SetupGate[] {
  const lines = setupLines();
  const gates: SetupGate[] = [];
  let step: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = STEP_HEADING_RE.exec(line);
    if (heading) step = heading[1]!;
    if (!isRequiresInputDeclaration(line)) continue;
    const reason = declaredReason(line);
    if (reason === null || !isRealGateReason(reason)) continue;
    if (step === null) continue;
    gates.push({ step, line: i + 1, reason });
  }
  return gates;
}

/**
 * The answer key `docs/auto-mode-protocol.md`'s `/setup` Consumers entry pairs
 * with `step`, or `null` when the entry names the step without naming a key.
 * The house shape the entry already uses for 7b is ``step 7b's `tracker_mode` ``.
 *
 * A positional window would be worse than useless here: the entry's flat
 * eight-key list sits AFTER every step mention, so any forward window wide
 * enough to reach 7b's key also swallows the list and passes for every step.
 * Requiring the key ADJACENT to the step reference is what makes the pin real.
 */
function pairedKeyFor(entry: string, step: string): string | null {
  const re = new RegExp(
    `(?:step|§)\\s*${step}(?:['’]s)?\\s*(?:[—–:=-]\\s*)?\`([A-Za-z0-9_]+)\``,
  );
  return re.exec(entry)?.[1] ?? null;
}

/** Keys the SHIPPED driver bakes into the `/setup` child heredoc. */
const bakedSetupKeys = (): string[] =>
  Object.keys(extractAutoAnswers(setupHeredoc()).answers);

describeIfSmokePresent(
  "POST-AUDIT — the /setup child heredoc emits a sanctioned answers block",
  () => {
    test("the marker is still the FIRST body line (STE-226 spawn contract)", () => {
      // Re-pinned here, not merely inherited: the block lands in this heredoc,
      // and pushing it above the marker would make `extractAutoAnswers` inert.
      expect(setupHeredoc().split("\n")[0]).toBe(AUTO_APPROVE_MARKER);
    });

    test("the slash command is still the line after the marker", () => {
      expect(setupHeredoc().split("\n")[1]).toBe("/dev-process-toolkit:setup");
    });

    test("the pre-baked orientation prose the chain depends on survives", () => {
      // NON-REGRESSION. This prose is CONTEXT, not an answer source — AC-STE-419.3
      // makes it explicitly a non-trigger. The block is added ALONGSIDE it; a
      // "fix" that deletes the settings.json acknowledgment aborts the chain at
      // the model-layer overwrite block instead of at step 7b.
      const h = setupHeredoc();
      expect(h).toContain("stack=Bun+TS");
      expect(h).toContain("take the idempotent-merge branch");
    });

    test("the heredoc carries a delimited answers block", () => {
      const h = setupHeredoc();
      expect(h).toContain(AUTO_ANSWERS_OPEN);
      expect(h).toContain(AUTO_ANSWERS_CLOSE);
    });

    test("the block opens AFTER the marker and closes after it opens", () => {
      const h = setupHeredoc();
      const marker = h.indexOf(AUTO_APPROVE_MARKER);
      const open = h.indexOf(AUTO_ANSWERS_OPEN);
      const close = h.indexOf(
        AUTO_ANSWERS_CLOSE,
        open + AUTO_ANSWERS_OPEN.length,
      );
      expect(marker).toBeGreaterThanOrEqual(0);
      expect(open).toBeGreaterThan(marker);
      expect(close).toBeGreaterThan(open);
    });

    test("END-TO-END: the SHIPPED parser accepts the SHIPPED driver text", () => {
      // The strongest available pin — the real consumer over the real producer,
      // no fixture in between. A block the driver emits but the parser rejects
      // leaves the chain truncated one step EARLIER than the 2026-07-27 run.
      const result = extractAutoAnswers(setupHeredoc());
      expect(result.present).toBe(true);
      expect(Object.keys(result.answers).length).toBeGreaterThan(0);
    });

    test("every answer the driver bakes in has a non-empty value", () => {
      // A `key:` with a blank value parses `present` but answers nothing — the
      // interview would resolve to empty strings and `/setup` would write a
      // hollow CLAUDE.md. Pin real content, not merely a well-formed shape.
      const entries = Object.entries(extractAutoAnswers(setupHeredoc()).answers);
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value).toBe("string");
        expect(
          value.trim().length,
          `answer for ${key} is empty`,
        ).toBeGreaterThan(0);
      }
    });

    test("resolveInterviewAnswer reaches every baked key through the shipped resolver", () => {
      // `extractAutoAnswers` proves the block parses; this proves the call
      // shape `/setup` SKILL.md names actually returns those answers.
      const h = setupHeredoc();
      const keys = bakedSetupKeys();
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(resolveInterviewAnswer(h, key)).toBe(
          extractAutoAnswers(h).answers[key]!,
        );
      }
    });

    test("TRIPWIRE — an UNMARKED /setup body stays inert; the block is never a trigger", () => {
      // The block must not become a second, standalone auto-apply trigger. The
      // first assertion keeps the second from passing vacuously: today the body
      // parses to nothing with or without the marker, which proves nothing.
      const h = setupHeredoc();
      expect(extractAutoAnswers(h).present).toBe(true);
      const unmarked = h.split(AUTO_APPROVE_MARKER).join("");
      expect(unmarked).not.toContain(AUTO_APPROVE_MARKER);
      expect(unmarked).toContain(AUTO_ANSWERS_OPEN);
      expect(extractAutoAnswers(unmarked)).toEqual({
        present: false,
        answers: {},
      });
      expect(resolveInterviewAnswer(unmarked, "tracker_mode")).toBeUndefined();
    });
  },
);

describeIfSmokePresent(
  "POST-AUDIT — producer/consumer drift between the /setup driver and the doc",
  () => {
    test("FLOOR: the driver's key set parses and covers the documented interview", () => {
      // Without a floor the DRIFT PIN below iterates an empty key set and
      // passes while checking nothing — the exact way this defect hid.
      const keys = bakedSetupKeys();
      expect(keys.length).toBeGreaterThanOrEqual(
        Object.keys(SETUP_INTERVIEW_ANSWERS).length,
      );
      for (const k of Object.keys(SETUP_INTERVIEW_ANSWERS)) {
        expect(keys, `the driver bakes no \`${k}\` answer`).toContain(k);
      }
    });

    test("DRIFT PIN: every parsed driver key is named in the /setup entry", () => {
      // Derived, not transcribed — add a key to the heredoc without documenting
      // a consumer and this fails, which is the actual defect class here.
      // Backticked match, matching the entry's house style, so a key cannot
      // pass by being a substring of ordinary prose.
      const entry = setupConsumerEntry();
      for (const key of bakedSetupKeys()) {
        expect(
          entry,
          `the driver bakes \`${key}\` but the doc names no consumer for it`,
        ).toContain(`\`${key}\``);
      }
    });

    test("the entry extractor is non-vacuous — one bullet, not the whole doc", () => {
      const entry = setupConsumerEntry();
      expect(entry.length).toBeGreaterThan(40);
      expect(entry).not.toContain("- `/spec-write`");
      expect(entry).not.toContain("## Socratic Loop Contract");
    });

    test("NON-VACUITY: /spec-write's own keys stay OUT of the /setup entry", () => {
      // Guards the lazy fix — pasting every conceivable key into the entry (or
      // into the heredoc) so the drift pin above goes green. The decoys are
      // deliberately REAL interview keys of the sibling consumer, so they are
      // exactly what a copy-paste would drag in.
      const setup = setupConsumerEntry();
      const specWrite = specWriteConsumerEntry();
      const baked = new Set(bakedSetupKeys());
      for (const decoy of ["feature_summary", "acceptance_criteria"]) {
        expect(
          specWrite,
          `\`${decoy}\` should be a documented /spec-write interview key`,
        ).toContain(`\`${decoy}\``);
        expect(
          setup,
          `the /setup entry claims \`${decoy}\`, which /setup never asks`,
        ).not.toContain(`\`${decoy}\``);
        expect(
          baked.has(decoy),
          `the /setup heredoc bakes \`${decoy}\`, which /setup never asks`,
        ).toBe(false);
      }
    });
  },
);

describe("POST-AUDIT — every declared /setup gate is answerable", () => {
  test("the gate list derives from the SKILL and is non-empty", () => {
    const gates = setupGates();
    expect(gates.length).toBeGreaterThanOrEqual(2);
    const steps = gates.map((g) => g.step);
    // FLOOR, not a transcription: both of these declare a prose reason today.
    expect(steps).toContain("7b"); // tracker mode
    expect(steps).toContain("7f"); // tracker-config write
  });

  test("the derivation excludes the legend and step 7g's `false` shorthand", () => {
    // Non-vacuity for `isRealGateReason`. The § Step contract legend
    // (`requires-input: <reason>`) DEFINES the kind, and 7g's
    // `requires-input: false` says in its own prose "this is not a
    // `requires-input` gate" — both score as declarations under the shipped
    // recognizer, and neither is a gate that can refuse.
    const steps = setupGates().map((g) => g.step);
    expect(steps).not.toContain("7g");
    expect(isRequiresInputDeclaration("`requires-input: false` (safe default)")).toBe(
      true,
    );
    expect(isRealGateReason("false")).toBe(false);
    expect(isRealGateReason("<reason>")).toBe(false);
    expect(
      isRealGateReason(
        "tracker mode is a workspace-wide decision; no safe default exists.",
      ),
    ).toBe(true);
  });

  test("step 7f is not a rare branch — it fires in EVERY tracker mode", () => {
    // Scope check for the finding: 7f is not a rare branch. Its own annotation
    // scopes it to `mode: linear` / `mode: jira` / `mode: <custom>`, which is
    // both smoke legs — so an unanswerable 7f blocks every headless tracker run.
    const gate = setupGates().find((g) => g.step === "7f");
    expect(gate, "step 7f no longer declares a `requires-input:` gate").toBeDefined();
    expect(setupSkill()).toContain("runs **only in tracker mode**");
  });

  test("the doc's /setup entry names each declared gate step", () => {
    const entry = setupConsumerEntry();
    for (const gate of setupGates()) {
      expect(
        entry,
        `the /setup Consumers entry never mentions step ${gate.step} ` +
          `(declared at skills/setup/SKILL.md:${gate.line})`,
      ).toMatch(new RegExp(`(?:step|§)\\s*${gate.step}\\b`));
    }
  });

  test("COVERAGE PIN: the doc pairs an answer key with every declared gate", () => {
    // The narrower half of the finding. The entry NAMES step 7f as covered but
    // pairs no key with it, so under the doc's own rule — "a key the block
    // omits refuses individually" — 7f refuses unconditionally even once a
    // block exists. 7b shows the shape that works: ``step 7b's `tracker_mode` ``.
    const entry = setupConsumerEntry();
    for (const gate of setupGates()) {
      expect(
        pairedKeyFor(entry, gate.step),
        `the /setup Consumers entry names no answer key for step ${gate.step} ` +
          `("${gate.reason}") — a gate with no key refuses unconditionally`,
      ).not.toBeNull();
    }
  });
});

describeIfSmokePresent(
  "POST-AUDIT — COVERAGE PIN: the driver bakes a key for every declared gate",
  () => {
    test("each declared gate's paired key is an answer the driver actually supplies", () => {
      // The end of the chain: SKILL declares the gate → doc pairs a key with it
      // → driver bakes that key → shipped parser returns it. A gate that breaks
      // any link refuses, and the headless leg truncates there.
      const entry = setupConsumerEntry();
      const baked = bakedSetupKeys();
      for (const gate of setupGates()) {
        const key = pairedKeyFor(entry, gate.step);
        expect(
          key,
          `no documented answer key for step ${gate.step}`,
        ).not.toBeNull();
        expect(
          baked,
          `the /setup child heredoc bakes no \`${key}\` answer for step ` +
            `${gate.step}, so that gate refuses and the headless leg truncates`,
        ).toContain(key!);
      }
    });

    test("and it resolves to a non-empty value through the shipped resolver", () => {
      const entry = setupConsumerEntry();
      const h = setupHeredoc();
      for (const gate of setupGates()) {
        const key = pairedKeyFor(entry, gate.step);
        expect(key).not.toBeNull();
        const value = resolveInterviewAnswer(h, key!);
        expect(typeof value, `step ${gate.step} answer is not a string`).toBe(
          "string",
        );
        expect(
          String(value).trim().length,
          `step ${gate.step}'s \`${key}\` answer is blank`,
        ).toBeGreaterThan(0);
      }
    });
  },
);
